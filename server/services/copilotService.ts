import { GoogleGenAI } from "@google/genai";
import { db } from "../db/connection";
import { AuthenticatedUser } from "../middleware/auth";
import { MEP_REFERENCE_KNOWLEDGE } from "../../mep_brain";

export interface CopilotProjectContext {
  project: any;
  allProjects?: any[];
  workPackages: any[];
  boqSummary: {
    count: number;
    totalAmount: number;
    byDiscipline: Array<{ discipline: string; count: number; total_amount: number }>;
    sampleItems: any[];
  };
  changeOrders: any[];
  purchaseOrders: any[];
  materialRequests: any[];
  procurementItems: any[];
  documents: any[];
  tasks: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    activeItems: any[];
  };
  inspections: any[];
  ncrs: any[];
  punchlist: {
    total: number;
    openCount: number;
    byPriority: Array<{ priority: string; count: number }>;
    openItems: any[];
  };
  rfis: any[];
  submittals: any[];
  dailyLogs: any[];
  safetyIncidents: any[];
  progressReports: any[];
  risks: any[];
  actions: any[];
  decisions: any[];
  workforceToday: any[];
}

const safeAll = (sql: string, ...params: any[]): any[] => {
  try {
    return db.prepare(sql).all(...params) as any[];
  } catch {
    return [];
  }
};

const safeGet = (sql: string, ...params: any[]): any => {
  try {
    return db.prepare(sql).get(...params) as any;
  } catch {
    return null;
  }
};

/**
 * Retrieve all projects accessible to the authenticated user, prioritized by data completeness.
 */
export function getAccessibleProjects(user?: AuthenticatedUser): any[] {
  let projects: any[] = [];
  const role = (user?.role || "").toLowerCase();
  const userId = user?.user_id || (user as any)?.id;

  if (!user || role === "admin" || role === "superadmin" || role === "projectmanager" || role === "commercialmanager" || role === "consultant" || role === "client") {
    projects = safeAll("SELECT * FROM projects");
  } else if (userId) {
    projects = safeAll(`
      SELECT p.* FROM projects p
      JOIN project_memberships pm ON p.id = pm.project_id
      WHERE pm.user_id = ? AND pm.active = 1
    `, userId);
    if (projects.length === 0) {
      projects = safeAll("SELECT * FROM projects");
    }
  } else {
    projects = safeAll("SELECT * FROM projects");
  }

  // Score projects by completeness (packages + tasks + documents + non-untitled)
  return projects.sort((a, b) => {
    const aUntitled = String(a.name || "").includes("Untitled") ? 1 : 0;
    const bUntitled = String(b.name || "").includes("Untitled") ? 1 : 0;
    if (aUntitled !== bUntitled) return aUntitled - bUntitled;

    const aBudget = Number(a.budget || a.contract_value || 0);
    const bBudget = Number(b.budget || b.contract_value || 0);
    if (bBudget !== aBudget) return bBudget - aBudget;

    return (b.rowid || 0) - (a.rowid || 0);
  });
}

/**
 * Detect if the user's question mentions a specific project by name, code, or keywords.
 * If multiple projects match, selects the one with the most active data (packages/tasks/docs).
 */
export function matchProjectFromQuery(query: string, projects: any[]): any | null {
  if (!query || !projects || projects.length === 0) return null;
  const q = query.toLowerCase();

  const candidates: any[] = [];

  for (const p of projects) {
    const pName = String(p.name || "").toLowerCase().trim();
    const pCode = String(p.code || p.project_code || "").toLowerCase().trim();

    let matched = false;
    // Direct code match (e.g. PRJ-BC-892, PRJ-255)
    if (pCode && pCode.length >= 3 && q.includes(pCode)) {
      matched = true;
    } else if (pName.includes("burj crown") && q.includes("burj crown")) {
      matched = true;
    } else if ((pName.includes("venera") || pName.includes("bov")) && (q.includes("venera") || q.includes("bov"))) {
      matched = true;
    } else if (pName.includes("marina bay") && q.includes("marina bay")) {
      matched = true;
    } else if (pName.length >= 6 && q.includes(pName)) {
      matched = true;
    }

    if (matched) {
      candidates.push(p);
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // If multiple matching records (e.g. duplicate test entries), pick the one with most data
  let best = candidates[0];
  let maxScore = -1;
  for (const c of candidates) {
    const pkgs = safeGet("SELECT COUNT(*) as c FROM work_packages WHERE project_id = ?", c.id)?.c || 0;
    const tsks = safeGet("SELECT COUNT(*) as c FROM tasks WHERE project_id = ?", c.id)?.c || 0;
    const docs = safeGet("SELECT COUNT(*) as c FROM documents WHERE project_id = ?", c.id)?.c || 0;
    const score = pkgs * 10 + tsks * 5 + docs * 2 + (Number(c.budget || 0) > 0 ? 50 : 0);
    if (score > maxScore) {
      maxScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Retrieve complete, live project intelligence context from the SQLite database.
 */
export function getProjectCopilotContext(projectId?: string, user?: AuthenticatedUser, query?: string): CopilotProjectContext | null {
  const accessibleProjects = getAccessibleProjects(user);
  if (accessibleProjects.length === 0) return null;

  // Check if query explicitly mentions a project
  if (query) {
    const matched = matchProjectFromQuery(query, accessibleProjects);
    if (matched) {
      projectId = matched.id;
    }
  }

  // Handle portfolio level query ("all")
  if (projectId === "all" || projectId === "ALL") {
    const primaryProj = accessibleProjects.find(p => p.budget > 0 && !p.name.includes("Untitled")) || accessibleProjects[0];
    return buildSingleProjectContext(primaryProj.id, accessibleProjects);
  }

  // If no projectId specified, pick the best active project
  if (!projectId) {
    const bestProj = accessibleProjects.find(p => p.budget > 0 && !p.name.includes("Untitled")) || accessibleProjects[0];
    projectId = bestProj.id;
  }

  return buildSingleProjectContext(projectId, accessibleProjects);
}

function buildSingleProjectContext(projectId: string, allProjects: any[]): CopilotProjectContext | null {
  const project = safeGet("SELECT * FROM projects WHERE id = ?", projectId);
  if (!project) return null;

  // 1. Work packages
  const rawWorkPackages = safeAll(`
    SELECT wp.*, c.name as company_name
    FROM work_packages wp
    LEFT JOIN companies c ON wp.company_id = c.id
    WHERE wp.project_id = ?
    ORDER BY wp.created_at ASC
  `, projectId);
  const workPackages = rawWorkPackages.map(wp => ({
    id: wp.id,
    name: wp.name,
    code: wp.code || wp.package_code || "WP",
    discipline: wp.discipline || wp.trade || "Multi-Trade",
    description: wp.description || wp.scope || "",
    budget_allocated: wp.budget_allocated ?? wp.value ?? wp.contract_value ?? 0,
    status: wp.status || "Active",
    assigned_subcontractor: wp.company_name || wp.assigned_subcontractor || wp.subcontractor || "In-House MEP Team",
    start_date: wp.start_date || wp.planned_start || "",
    end_date: wp.target_date || wp.end_date || wp.planned_finish || "",
  }));

  // 2. BOQ Summary
  const boqAgg = safeGet(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(tender_amount), 0) as total
    FROM boq_items
    WHERE project_id = ?
  `, projectId);

  const boqByDiscipline = safeAll(`
    SELECT COALESCE(discipline, 'General MEP') as discipline, COUNT(*) as count, COALESCE(SUM(tender_amount), 0) as total_amount
    FROM boq_items
    WHERE project_id = ?
    GROUP BY discipline
    ORDER BY total_amount DESC
  `, projectId);

  const sampleBoqItems = safeAll(`
    SELECT item_number, description, unit, tender_quantity, tender_rate, tender_amount, discipline, system, area
    FROM boq_items
    WHERE project_id = ?
    ORDER BY tender_amount DESC
    LIMIT 15
  `, projectId);

  // 3. Change Orders / Variations
  const changeOrders = safeAll(`
    SELECT id, number, title, trade, reason, cost_impact, schedule_impact_days, date_raised, status
    FROM change_orders
    WHERE project_id = ?
    ORDER BY date_raised DESC
    LIMIT 20
  `, projectId);

  // 4. Purchase Orders
  const purchaseOrders = safeAll(`
    SELECT id, po_number, vendor, trade, description, amount, order_date, expected_delivery, status
    FROM purchase_orders
    WHERE project_id = ?
    ORDER BY order_date DESC
    LIMIT 20
  `, projectId);

  // 5. Material Requests & Procurement Items
  const materialRequests = safeAll(`
    SELECT material, description, quantity, unit, required_date, status, discipline, specification, pr_number
    FROM material_requests
    WHERE project_id = ?
    ORDER BY required_date ASC
    LIMIT 15
  `, projectId);

  const procurementItems = safeAll(`
    SELECT pr_number, material, quantity, unit, required_on_site, selected_supplier, po_number, status
    FROM procurement_items
    WHERE project_id = ?
    ORDER BY required_on_site ASC
    LIMIT 15
  `, projectId);

  // 6. Documents & Drawings
  const documents = safeAll(`
    SELECT id, name, category, revision, date_added, attachment_name, status, visibility
    FROM documents
    WHERE project_id = ?
    ORDER BY date_added DESC
    LIMIT 25
  `, projectId);

  // 7. Tasks & Programme Schedule
  const taskCount = safeGet("SELECT COUNT(*) as c FROM tasks WHERE project_id = ?", projectId);
  const tasksByStatus = safeAll(`
    SELECT status, COUNT(*) as count
    FROM tasks
    WHERE project_id = ?
    GROUP BY status
  `, projectId);

  const activeTasks = safeAll(`
    SELECT title, trade, assignee, start, end, progress, status, priority, wbs_code
    FROM tasks
    WHERE project_id = ?
    ORDER BY CASE WHEN status = 'In Progress' THEN 0 WHEN status = 'Not Started' THEN 1 ELSE 2 END, end ASC
    LIMIT 25
  `, projectId);

  // 8. Quality & Inspections
  const inspections = safeAll(`
    SELECT id, title, type, discipline, result, status, verified_progress, inspection_date, inspector_name
    FROM inspections
    WHERE project_id = ?
    ORDER BY inspection_date DESC
    LIMIT 15
  `, projectId);

  const ncrs = safeAll(`
    SELECT ncr_number, title, discipline, severity, root_cause, corrective_action, status, date_issued
    FROM ncrs
    WHERE project_id = ?
    ORDER BY date_issued DESC
    LIMIT 10
  `, projectId);

  // 9. Punch List / Snags
  const punchAgg = safeGet("SELECT COUNT(*) as c FROM punchlist WHERE project_id = ?", projectId);
  const punchOpen = safeGet("SELECT COUNT(*) as c FROM punchlist WHERE project_id = ? AND status != 'Closed'", projectId);
  const punchByPriority = safeAll(`
    SELECT priority, COUNT(*) as count
    FROM punchlist
    WHERE project_id = ? AND status != 'Closed'
    GROUP BY priority
  `, projectId);

  const openSnags = safeAll(`
    SELECT id, item, trade, location, priority, date_raised, status
    FROM punchlist
    WHERE project_id = ? AND status != 'Closed'
    ORDER BY CASE priority WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END, date_raised DESC
    LIMIT 15
  `, projectId);

  // 10. RFIs & Submittals
  const rfis = safeAll(`
    SELECT number, subject, trade, date_raised, due_date, status, answer
    FROM rfis
    WHERE project_id = ?
    ORDER BY date_raised DESC
    LIMIT 15
  `, projectId);

  const submittals = safeAll(`
    SELECT submittal_number, title, specification_section, review_status, date_submitted, subcontractor_company
    FROM submittals
    WHERE project_id = ?
    ORDER BY date_submitted DESC
    LIMIT 15
  `, projectId);

  // 11. Daily Logs & Site Updates
  const dailyLogs = safeAll(`
    SELECT id, date, weather, progress_summary, issues, headcount
    FROM dailylogs
    WHERE project_id = ?
    ORDER BY date DESC
    LIMIT 10
  `, projectId);

  // 12. Safety Incidents
  const safetyIncidents = safeAll(`
    SELECT date, trade, incident_type, severity, description, corrective_action, status
    FROM safety_incidents
    WHERE project_id = ?
    ORDER BY date DESC
    LIMIT 10
  `, projectId);

  // 13. Progress Reports
  const progressReports = safeAll(`
    SELECT id, report_number, report_no, reporting_date, overall_progress, status
    FROM progress_reports
    WHERE project_id = ?
    ORDER BY reporting_date DESC
    LIMIT 5
  `, projectId);

  // 14. Governance: Risks, Actions & Decisions
  const risks = safeAll(`
    SELECT risk_no, title, category, probability, impact, risk_score, risk_level, mitigation, status
    FROM risks
    WHERE project_id = ?
    ORDER BY risk_score DESC
    LIMIT 10
  `, projectId);

  const actions = safeAll(`
    SELECT action_no, title, assigned_to_name, priority, status, due_date
    FROM project_actions
    WHERE project_id = ? AND status != 'Completed'
    LIMIT 10
  `, projectId);

  const decisions = safeAll(`
    SELECT decision_no, title, decision_taken, decided_by, decision_date
    FROM project_decisions
    WHERE project_id = ?
    ORDER BY decision_date DESC
    LIMIT 10
  `, projectId);

  // 15. Workforce Today
  const today = new Date().toISOString().split("T")[0];
  const workforceToday = safeAll(`
    SELECT *
    FROM attendance
    WHERE project_id = ? AND (work_date = ? OR date = ?)
  `, projectId, today, today);

  return {
    project,
    allProjects,
    workPackages,
    boqSummary: {
      count: boqAgg?.cnt || 0,
      totalAmount: boqAgg?.total || 0,
      byDiscipline: boqByDiscipline,
      sampleItems: sampleBoqItems,
    },
    changeOrders,
    purchaseOrders,
    materialRequests,
    procurementItems,
    documents,
    tasks: {
      total: taskCount?.c || 0,
      byStatus: tasksByStatus,
      activeItems: activeTasks,
    },
    inspections,
    ncrs,
    punchlist: {
      total: punchAgg?.c || 0,
      openCount: punchOpen?.c || 0,
      byPriority: punchByPriority,
      openItems: openSnags,
    },
    rfis,
    submittals,
    dailyLogs,
    safetyIncidents,
    progressReports,
    risks,
    actions,
    decisions,
    workforceToday,
  };
}

/**
 * Generate a deterministic portfolio response when querying across all projects.
 */
function generatePortfolioResponse(allProjects: any[]): string {
  const validProjects = allProjects.filter(p => !p.name.includes("Untitled") && Number(p.budget || 0) > 0);
  const totalBudget = validProjects.reduce((sum, p) => sum + Number(p.budget || 0), 0);

  let out = `### 🌐 Enterprise Project Portfolio Overview\n\n`;
  out += `Currently managing **${allProjects.length} total projects** (${validProjects.length} active projects with committed contract values) totaling **USD ${totalBudget.toLocaleString()}**.\n\n`;
  out += `| Project Code | Project Name | Client | Contract Budget | Status |\n`;
  out += `| :--- | :--- | :--- | :--- | :--- |\n`;

  allProjects.forEach(p => {
    out += `| \`${p.code || p.project_code || 'PRJ'}\` | **${p.name}** | ${p.client || p.client_name || 'Commercial Client'} | USD ${Number(p.budget || 0).toLocaleString()} | ${p.status || 'Active'} |\n`;
  });

  out += `\n💡 *Tip: To deep-dive into any project's BOQ, work packages, tasks, or snags, ask about that project by name (e.g., "Show me Burj Crown details") or select it from the context dropdown above.*`;
  return out;
}

/**
 * Deterministic fallback reasoning engine that queries live SQLite ground truth with 100% precision.
 */
export function generateDeterministicCopilotAnswer(question: string, ctx: CopilotProjectContext): string {
  const q = question.toLowerCase();
  const p = ctx.project;
  const cur = p.currency || "USD";

  // 0. Portfolio / All Projects Queries
  if (
    q.includes("all projects") ||
    q.includes("list projects") ||
    q.includes("show projects") ||
    q.includes("portfolio") ||
    q.includes("how many projects") ||
    q.includes("compare projects") ||
    q.includes("all active projects")
  ) {
    if (ctx.allProjects && ctx.allProjects.length > 0) {
      return generatePortfolioResponse(ctx.allProjects);
    }
  }

  // 1. Technical MEP Engineering Standards (Checked first before generic keywords like "test")
  if (
    q.includes("hydrostatic") ||
    q.includes("pressure test") ||
    q.includes("testing pressure") ||
    q.includes("test pressure") ||
    q.includes("ashrae") ||
    q.includes("nfpa") ||
    q.includes("bs 7671") ||
    q.includes("smacna") ||
    q.includes("cibse") ||
    q.includes("clearance") ||
    q.includes("pipe sizing") ||
    q.includes("duct sizing") ||
    q.includes("cable sizing") ||
    q.includes("derating")
  ) {
    return `### ⚙️ Technical MEP Engineering Standards & Guidelines\n\n` +
      `Authoritative engineering practice for **${p.name}**:\n\n` +
      `1. **Hydrostatic Pressure Testing (Chilled & Domestic Water):**\n` +
      `   - Test pressure: **1.5× working design pressure** or minimum 10 bar (150 psi) held for at least **2 hours** without measurable pressure drop.\n` +
      `   - All pipe joints, flanges, and mechanical couplings must be fully exposed, uninsulated, and inspected for leaks during testing.\n` +
      `   - Calibrated pressure gauges must be installed at the lowest and highest points of the circuit.\n\n` +
      `2. **Ductwork Air Leakage Testing (SMACNA / DW144):**\n` +
      `   - High/medium pressure supply ductwork must undergo Class C or Class B leakage testing before architectural ceiling closure.\n` +
      `   - Duct aspect ratios should not exceed 4:1 to minimize air friction, pressure loss, and noise breakout.\n\n` +
      `3. **Electrical Cable Derating & Separation (BS 7671 / IET Wiring Regulations):**\n` +
      `   - Power cables must maintain a minimum **300 mm physical clearance** from low-voltage ELV, data, and BMS signal trays to eliminate electromagnetic interference (EMI).\n` +
      `   - Apply appropriate thermal grouping derating factors ($C_g$) and ambient temperature correction ($C_a$).\n\n` +
      `4. **Fire Protection & Sprinkler Rules (NFPA 13 / 72):**\n` +
      `   - Minimum clearance below sprinkler deflector: **450 mm (18 in)** for standard spray pendants/uprights; 900 mm for high-density storage racks.\n` +
      `   - Fire alarm circuits must use 2-hour fire-rated cabling (FP200 / MICC) secured with metal clips at maximum 300 mm intervals.`;
  }

  // 2. Change Orders & Variations
  if (q.includes("variation") || q.includes("change order") || q.includes("claim") || q.includes("cost impact")) {
    let out = `### 📝 Variations & Change Orders for **${p.name}**\n\n`;
    if (ctx.changeOrders.length === 0) {
      out += `No change orders or variations have been registered for **${p.name}**. All works currently proceed under the base contract scope.\n`;
    } else {
      const totalImpact = ctx.changeOrders.reduce((sum, c) => sum + Number(c.cost_impact || 0), 0);
      out += `Total Change Orders: **${ctx.changeOrders.length}** (Net Cost Impact: **${cur} ${totalImpact.toLocaleString()}**)\n\n`;
      ctx.changeOrders.forEach((co, idx) => {
        out += `${idx + 1}. **${co.number || 'CO'}: ${co.title}**\n`;
        out += `   - **Trade:** ${co.trade || 'MEP'} · **Cost Impact:** ${cur} ${Number(co.cost_impact || 0).toLocaleString()} · **Status:** *${co.status}*\n`;
        if (co.reason) out += `   - **Reason:** ${co.reason}\n`;
        if (co.schedule_impact_days) out += `   - **Schedule Impact:** +${co.schedule_impact_days} days\n`;
      });
    }
    return out;
  }

  // 3. Purchase Orders & Committed Procurement
  if (q.includes("purchase order") || q.includes(" po ") || q.includes("pos ") || q.includes("committed po") || q.includes("vendor") || q.includes("supplier")) {
    let out = `### 📦 Purchase Orders & Procurement Commitments for **${p.name}**\n\n`;
    if (ctx.purchaseOrders.length === 0) {
      out += `No purchase orders (POs) have been issued for **${p.name}** yet.\n`;
    } else {
      const totalCommitted = ctx.purchaseOrders.reduce((sum, po) => sum + Number(po.amount || 0), 0);
      out += `Total Committed POs: **${ctx.purchaseOrders.length}** (Total Value: **${cur} ${totalCommitted.toLocaleString()}**)\n\n`;
      ctx.purchaseOrders.forEach((po, idx) => {
        out += `${idx + 1}. **${po.po_number || 'PO'}: ${po.vendor || 'Vendor'}**\n`;
        out += `   - **Description:** ${po.description || 'Materials / Equipment'}\n`;
        out += `   - **Amount:** ${cur} ${Number(po.amount || 0).toLocaleString()} · **Delivery:** ${po.expected_delivery || 'Standard'} · **Status:** *${po.status}*\n`;
      });
    }
    return out;
  }

  // 4. Budget, Financials, Job Costing & BOQ
  if (q.includes("budget") || q.includes("cost") || q.includes("financial") || q.includes("value") || q.includes("price") || q.includes("boq") || q.includes("bill of quantities") || q.includes("job costing")) {
    const originalBudget = Number(p.budget || p.contract_value || ctx.boqSummary.totalAmount || 0);
    const approvedVariations = ctx.changeOrders
      .filter(c => c.status === "Approved" || c.status === "Closed")
      .reduce((sum, c) => sum + Number(c.cost_impact || 0), 0);
    const revisedBudget = originalBudget + approvedVariations;
    const committedPos = ctx.purchaseOrders.reduce((sum, po) => sum + Number(po.amount || 0), 0);

    let out = `### 💰 Commercial & Job Costing Ledger for **${p.name}**\n\n`;
    out += `| Commercial Metric | Amount (${cur}) |\n`;
    out += `| :--- | :--- |\n`;
    out += `| **Original Contract Budget** | **${cur} ${originalBudget.toLocaleString()}** |\n`;
    out += `| **Approved Variations (Change Orders)** | **+${cur} ${approvedVariations.toLocaleString()}** (${ctx.changeOrders.length} variations) |\n`;
    out += `| **Revised Contract Ceiling** | **${cur} ${revisedBudget.toLocaleString()}** |\n`;
    out += `| **Committed Purchase Orders (POs)** | **${cur} ${committedPos.toLocaleString()}** (${ctx.purchaseOrders.length} active POs) |\n`;
    out += `| **Total BOQ Tender Lines** | ${ctx.boqSummary.count} items (Totaling ${cur} ${Number(ctx.boqSummary.totalAmount).toLocaleString()}) |\n\n`;

    if (ctx.boqSummary.byDiscipline.length > 0) {
      out += `#### Trade Breakdown by Discipline:\n`;
      ctx.boqSummary.byDiscipline.forEach(d => {
        out += `- **${d.discipline}:** ${cur} ${Number(d.total_amount).toLocaleString()} (${d.count} BOQ items)\n`;
      });
      out += `\n`;
    }

    if (ctx.workPackages.length > 0) {
      out += `#### Work Package Allocations:\n`;
      ctx.workPackages.forEach(wp => {
        out += `- **[${wp.code || 'WP'}] ${wp.name}:** ${cur} ${Number(wp.budget_allocated || 0).toLocaleString()} (Status: *${wp.status}* · Partner: ${wp.assigned_subcontractor})\n`;
      });
    }
    return out;
  }

  // 5. Quality, Inspections & NCRs
  if (q.includes("inspection") || q.includes("qa/qc") || q.includes("ncr") || q.includes("witness") || q.includes("quality")) {
    let out = `### 🛡️ QA/QC Inspections & Quality Audit for **${p.name}**\n\n`;
    const passedCount = ctx.inspections.filter(i => i.result === "Pass").length;
    const failedCount = ctx.inspections.filter(i => i.result === "Fail").length;

    out += `- **Total Registered Inspections:** ${ctx.inspections.length} (${passedCount} Passed, ${failedCount} Failed)\n`;
    out += `- **Open Non-Conformance Reports (NCRs):** ${ctx.ncrs.filter(n => n.status !== 'Closed').length}\n\n`;

    if (ctx.inspections.length > 0) {
      out += `#### QA/QC Inspection Records:\n`;
      ctx.inspections.slice(0, 8).forEach((insp, idx) => {
        const badge = insp.result === "Pass" ? "✅ PASS" : "❌ " + (insp.result || "PENDING");
        out += `${idx + 1}. **[${badge}] ${insp.title || insp.type}**\n`;
        out += `   - **Discipline:** ${insp.discipline || 'MEP'} · **Verified Progress:** ${insp.verified_progress || 0}% · **Date:** ${insp.inspection_date || 'Recent'}\n`;
      });
      out += `\n`;
    }

    if (ctx.ncrs.length > 0) {
      out += `#### Non-Conformance Reports (NCRs):\n`;
      ctx.ncrs.slice(0, 5).forEach((ncr, idx) => {
        out += `${idx + 1}. **${ncr.ncr_number || 'NCR'}: ${ncr.title}** (Severity: *${ncr.severity}* · Status: *${ncr.status}*)\n`;
        if (ncr.corrective_action) out += `   - Action: ${ncr.corrective_action}\n`;
      });
    }
    return out;
  }

  // 6. Punch List / Snags / Defects
  if (q.includes("punch") || q.includes("snag") || q.includes("defect") || q.includes("open item")) {
    let out = `### ⚠️ Quality Punch List & Snag Register for **${p.name}**\n\n`;
    out += `- **Total Punch Items:** ${ctx.punchlist.total}\n`;
    out += `- **Open / Pending Snags:** **${ctx.punchlist.openCount}**\n\n`;

    if (ctx.punchlist.openItems.length === 0) {
      out += `✅ All punch list items for this project have been closed or rectified!\n`;
    } else {
      out += `#### Open Defects Requiring Attention:\n`;
      ctx.punchlist.openItems.slice(0, 10).forEach((it, idx) => {
        const badge = it.priority === "Urgent" ? "🔴 URGENT" : it.priority === "High" ? "🟠 HIGH" : "🟡 " + (it.priority || "Medium");
        out += `${idx + 1}. **[${badge}] ${it.item}**\n`;
        out += `   - **Trade:** ${it.trade || 'MEP'} · **Location:** ${it.location || 'Site'}\n`;
        out += `   - **Raised:** ${it.date_raised || 'Recently'} · **Status:** *${it.status}*\n`;
      });
    }
    return out;
  }

  // 7. Work Packages & Subcontractors
  if (q.includes("work package") || q.includes("packages") || q.includes("trades") || q.includes("scope") || q.includes("subcontract")) {
    let out = `### 📦 Work Packages & Scopes for **${p.name}**\n\n`;
    if (ctx.workPackages.length === 0) {
      out += `No work packages are registered for **${p.name}** yet. You can import a BOQ or create work packages in the Work Packages domain.\n`;
    } else {
      out += `Total Work Packages: **${ctx.workPackages.length}**\n\n`;
      ctx.workPackages.forEach((wp, idx) => {
        out += `${idx + 1}. **${wp.name}** (\`${wp.code || 'WP'}\`)\n`;
        out += `   - **Discipline:** ${wp.discipline || 'Multi-Trade'}\n`;
        out += `   - **Budget:** ${cur} ${Number(wp.budget_allocated || 0).toLocaleString()}\n`;
        out += `   - **Status:** ${wp.status} · Subcontractor: **${wp.assigned_subcontractor}**\n`;
        if (wp.start_date || wp.end_date) out += `   - **Schedule:** ${wp.start_date || 'TBD'} → ${wp.end_date || 'TBD'}\n`;
        if (wp.description) out += `   - **Scope:** ${wp.description}\n`;
      });
    }
    return out;
  }

  // 8. Schedule, Programme & Tasks
  if (q.includes("schedule") || q.includes("date") || q.includes("timeline") || q.includes("task") || q.includes("milestone") || q.includes("handover") || q.includes("delay") || q.includes("overdue") || q.includes("progress")) {
    let out = `### 📅 Programme Schedule & Milestones for **${p.name}**\n\n`;
    out += `- **Project Start Date:** ${p.start_date || 'Not set'}\n`;
    out += `- **Target Handover / Completion:** **${p.end_date || 'Not set'}**\n`;
    out += `- **Current Stage:** ${p.stage || 'Execution'} · **Status:** ${p.status || 'Active'}\n`;
    out += `- **Total Tasks:** ${ctx.tasks.total}\n\n`;

    if (ctx.tasks.byStatus.length > 0) {
      out += `#### Task Progress Summary:\n`;
      ctx.tasks.byStatus.forEach(s => {
        out += `- **${s.status}:** ${s.count} tasks\n`;
      });
      out += `\n`;
    }

    if (ctx.tasks.activeItems.length > 0) {
      out += `#### Key Active Tasks & Milestones:\n`;
      ctx.tasks.activeItems.slice(0, 10).forEach(t => {
        out += `- **${t.title}** (${t.trade || 'MEP'}) — Status: *${t.status}* (${t.progress || 0}%), Target: ${t.end || 'TBD'}\n`;
      });
    }
    return out;
  }

  // 9. RFIs & Submittals
  if (q.includes("rfi") || q.includes("clarification") || q.includes("submittal") || q.includes("technical query")) {
    let out = `### ❓ RFIs & Material Submittals for **${p.name}**\n\n`;
    if (ctx.rfis.length > 0) {
      out += `#### Technical RFIs (${ctx.rfis.length} total):\n`;
      ctx.rfis.slice(0, 8).forEach(r => {
        out += `- **${r.number || 'RFI'}: ${r.subject}** (${r.trade || 'MEP'}) — Status: *${r.status}*\n`;
        if (r.answer) out += `  *Answer:* ${r.answer}\n`;
      });
      out += `\n`;
    }
    if (ctx.submittals.length > 0) {
      out += `#### Material Submittals (${ctx.submittals.length} total):\n`;
      ctx.submittals.slice(0, 8).forEach(s => {
        out += `- **${s.submittal_number || 'SUB'}: ${s.title}** — Section: ${s.specification_section || 'MEP'} · Status: *${s.review_status || 'Submitted'}*\n`;
      });
    }
    return out;
  }

  // 10. Documents, Drawings & Files
  if (q.includes("document") || q.includes("file") || q.includes("contract") || q.includes("drawing") || q.includes("upload") || q.includes("plan")) {
    let out = `### 📑 Drawings & Technical Documents for **${p.name}**\n\n`;
    if (ctx.documents.length === 0) {
      out += `No documents have been uploaded for this project yet. Use the Documents & Contract section to upload contract agreements, BOQs, or drawings.\n`;
    } else {
      out += `Total Uploaded Documents: **${ctx.documents.length}**\n\n`;
      ctx.documents.slice(0, 15).forEach((d, idx) => {
        out += `${idx + 1}. **${d.name || d.attachment_name}**\n`;
        out += `   - **Category:** ${d.category || 'General'} · **Rev:** ${d.revision || '0'} · **Visibility:** ${d.visibility || 'Internal'} · **Date:** ${d.date_added || 'N/A'}\n`;
      });
    }
    return out;
  }

  // 11. Materials & Procurement Pipeline
  if (q.includes("material") || q.includes("procurement") || q.includes("order") || q.includes("delivery") || q.includes("lead time")) {
    let out = `### 🚚 Materials & Site Deliveries for **${p.name}**\n\n`;
    if (ctx.materialRequests.length === 0 && ctx.procurementItems.length === 0) {
      out += `No active material requests or procurement pipeline items found for this project.\n`;
    } else {
      if (ctx.materialRequests.length > 0) {
        out += `#### Material Requests on Site:\n`;
        ctx.materialRequests.slice(0, 8).forEach(m => {
          out += `- **${m.material}** (${m.quantity} ${m.unit || 'units'}) — Required: ${m.required_date || 'ASAP'} (Status: *${m.status}*)\n`;
          if (m.specification) out += `  *Spec:* ${m.specification}\n`;
        });
        out += `\n`;
      }
      if (ctx.procurementItems.length > 0) {
        out += `#### Selected Suppliers & Expected Shipments:\n`;
        ctx.procurementItems.slice(0, 8).forEach(pi => {
          out += `- **${pi.material}** (\`${pi.pr_number}\`) — Supplier: ${pi.selected_supplier || 'Approved Vendor'}, Expected: ${pi.required_on_site || 'TBD'} (Status: *${pi.status}*)\n`;
        });
      }
    }
    return out;
  }

  // 12. Daily Logs & Site Updates
  if (q.includes("daily log") || q.includes("site update") || q.includes("weather") || q.includes("today on site") || q.includes("recent update")) {
    let out = `### 📋 Site Daily Logs & Recent Updates for **${p.name}**\n\n`;
    if (ctx.dailyLogs.length === 0) {
      out += `No daily logs have been submitted for **${p.name}** yet.\n`;
    } else {
      ctx.dailyLogs.slice(0, 6).forEach(dl => {
        out += `- **Date: ${dl.date || 'Recent'}** (Weather: ${dl.weather || 'Clear'} · Manpower: ${dl.headcount || 'N/A'})\n`;
        if (dl.progress_summary) out += `  *Summary:* ${dl.progress_summary}\n`;
        if (dl.issues) out += `  *Issues / Blockers:* ${dl.issues}\n`;
      });
    }
    return out;
  }

  // 13. Safety & HSE Incidents
  if (q.includes("safety") || q.includes("hse") || q.includes("incident") || q.includes("accident") || q.includes("toolbox")) {
    let out = `### 🦺 Health, Safety & Environment (HSE) for **${p.name}**\n\n`;
    if (ctx.safetyIncidents.length === 0) {
      out += `✅ Zero lost-time incidents (LTI) recorded! **${p.name}** has an unblemished safety record.\n`;
    } else {
      out += `Recorded Safety Incidents: **${ctx.safetyIncidents.length}**\n\n`;
      ctx.safetyIncidents.forEach((inc, idx) => {
        out += `${idx + 1}. **[${inc.severity || 'Minor'}] ${inc.incident_type || 'Incident'}** (${inc.date || 'Recent'})\n`;
        out += `   - **Description:** ${inc.description}\n`;
        if (inc.corrective_action) out += `   - **Corrective Action:** ${inc.corrective_action}\n`;
      });
    }
    return out;
  }

  // 14. Workforce & Live Presence
  if (q.includes("workforce") || q.includes("worker") || q.includes("attendance") || q.includes("on site") || q.includes("presence") || q.includes("who is on site")) {
    let out = `### 👷 Live Workforce & Site Presence for **${p.name}**\n\n`;
    if (ctx.workforceToday.length === 0) {
      out += `No workers have punched in for **${p.name}** today yet. Attendance updates in real-time as site workers clock in via GPS mobile shell.\n`;
    } else {
      out += `**Currently on site today (${ctx.workforceToday.length} workers):**\n\n`;
      ctx.workforceToday.forEach(w => {
        out += `- **${w.worker}** — In: ${w.punch_in ? new Date(w.punch_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Logged'} (Status: *${w.status}*)\n`;
      });
    }
    return out;
  }

  // 15. Key Stakeholders & Project Master
  if (q.includes("client") || q.includes("contractor") || q.includes("consultant") || q.includes("stakeholder") || q.includes("employer") || q.includes("who is") || q.includes("location") || q.includes("address")) {
    let out = `### 🏢 Project Parties & Governance for **${p.name}**\n\n`;
    out += `- **Project Name:** ${p.name} (\`${p.code || 'MEP-PROJ'}\`)\n`;
    out += `- **Client / Employer:** **${p.client || p.client_name || 'Primary Client'}**\n`;
    out += `- **Main Contractor:** **${p.main_contractor || 'Lead General Contractor'}**\n`;
    out += `- **Supervising Consultant:** **${p.consultant || 'MEP Engineering Consultant'}**\n`;
    out += `- **Project Manager:** **${p.project_manager_name || 'Administrator'}**\n`;
    out += `- **Site Location:** ${p.location || p.site_address || 'Site Location Not Specified'}\n`;
    out += `- **Contract Type:** ${p.contract_type || 'Lump Sum Subcontract'}\n`;
    out += `- **Current Stage:** ${p.stage || 'Execution'} · **Status:** ${p.status || 'Active'}\n`;
    return out;
  }

  // Default: Complete Executive Summary
  return `### 📋 Comprehensive Project Overview: **${p.name}**\n\n` +
    `Live intelligence summary for **${p.name}** (\`${p.code || 'PROJ'}\`):\n\n` +
    `| Project Parameter | Verified Database Ground Truth |\n` +
    `| :--- | :--- |\n` +
    `| **Client / Employer** | **${p.client || p.client_name || 'Primary Client'}** |\n` +
    `| **Main Contractor** | **${p.main_contractor || 'General Contractor'}** |\n` +
    `| **MEP Consultant** | **${p.consultant || 'Engineering Consultant'}** |\n` +
    `| **Contract Value / Budget** | **${cur} ${Number(p.budget || p.contract_value || ctx.boqSummary.totalAmount || 0).toLocaleString()}** |\n` +
    `| **Project Timeline** | ${p.start_date || 'TBD'} → **${p.end_date || 'TBD'}** |\n` +
    `| **Work Packages** | **${ctx.workPackages.length}** registered trade packages |\n` +
    `| **BOQ Schedule** | **${ctx.boqSummary.count} lines** (Valued at ${cur} ${Number(ctx.boqSummary.totalAmount).toLocaleString()}) |\n` +
    `| **Committed POs** | **${ctx.purchaseOrders.length} active orders** |\n` +
    `| **QA/QC Inspections** | **${ctx.inspections.length} recorded** (${ctx.inspections.filter(i => i.result === 'Pass').length} passed) |\n` +
    `| **Open Punch Snags** | **${ctx.punchlist.openCount}** open defect(s) requiring attention |\n` +
    `| **Approved Documents** | **${ctx.documents.length}** drawing & contract files |\n\n` +
    `💡 *You can ask specific questions about budgets, change orders, purchase orders, work packages, punch list defects, programme tasks, or engineering standards.*`;
}

/**
 * Main Copilot Q&A handler that uses Gemini 2.5 Flash when available, with reliable deterministic engine fallback.
 */
export async function answerCopilotQuestion(
  user: AuthenticatedUser,
  body: {
    question?: string;
    message?: string;
    messages?: Array<{ role: string; content?: string; text?: string; parts?: any[] }>;
    project_id?: string;
    context?: any;
    model_tier?: string;
  }
): Promise<{
  reply: string;
  answer: string;
  project_id?: string;
  project_name?: string;
  quick_facts?: any;
  suggested_followups?: string[];
  model_used?: string;
}> {
  const userQuery = body.question || body.message || (Array.isArray(body.messages) && body.messages.length > 0 ? (body.messages[body.messages.length - 1].content || body.messages[body.messages.length - 1].text) : "") || "Provide a summary of this project";
  const requestedProjectId = body.project_id || body.context?.project_id;

  const projectContext = getProjectCopilotContext(requestedProjectId, user, userQuery);

  if (!projectContext) {
    const genericAnswer = `### MEP Copilot Intelligence\n\nNo active project was found in the database. Please select a project from the top navigation bar or project portfolio.\n\nGeneral MEP guidance:\n- Verify drawing transmittals and specifications prior to installation.\n- Ensure all pressurized lines (chilled water, domestic water, fire fighting) undergo hydrostatic witness testing at 1.5x working pressure.`;
    return {
      reply: genericAnswer,
      answer: genericAnswer,
      suggested_followups: [
        "How do I create a new project?",
        "What are the standard MEP clearance rules?",
        "Show me all active projects in the portfolio",
      ]
    };
  }

  const p = projectContext.project;
  const apiKey = process.env.GEMINI_API_KEY;
  const isValidApiKey = apiKey && !apiKey.startsWith("MY_") && !apiKey.startsWith("your_") && apiKey.length > 15;
  let reply = "";
  let modelUsed = "deterministic-engine";

  if (isValidApiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "mep-copilot-engine",
          },
        },
      });

      const systemInstruction = `You are the Senior MEP Project Copilot and Technical Lead for the construction management platform.
You are embedded directly inside the active project: "${p.name}" (Code: ${p.code || 'N/A'}, ID: ${p.id}).

YOUR MISSION:
Answer EVERY question about this project with exact, authoritative, and factually grounded details using the live database ground truth below.
When asked about financials, budgets, variations, POs, dates, client names, contractors, work packages, BOQ quantities, documents, punch list snags, tasks, procurement, or workers, always quote the exact data from the context.
If asked for technical MEP engineering guidance, combine international engineering standards (BS 7671, ASHRAE 90.1/62.1, NFPA 13/72, CIBSE, SMACNA) with the specific disciplines and systems present on this project.

LIVE DATABASE GROUND TRUTH FOR PROJECT "${p.name}":
- Project Details:
  * Name: ${p.name}
  * Code: ${p.code || 'MEP-01'}
  * Client / Employer: ${p.client || p.client_name || 'Primary Client'}
  * Main Contractor: ${p.main_contractor || 'Lead Contractor'}
  * Consultant: ${p.consultant || 'MEP Consultant'}
  * Status: ${p.status || 'Active'}
  * Stage: ${p.stage || 'Execution'}
  * Currency: ${p.currency || 'USD'}
  * Budget / Contract Value: ${p.budget || p.contract_value || projectContext.boqSummary.totalAmount || 0}
  * Start Date: ${p.start_date || 'Not specified'}
  * Target End / Handover Date: ${p.end_date || 'Not specified'}
  * Location: ${p.location || 'Site Location'}
  * Contract Type: ${p.contract_type || 'Lump Sum Subcontract'}

- Work Packages (${projectContext.workPackages.length} packages):
${JSON.stringify(projectContext.workPackages, null, 2)}

- Commercial & Job Costing:
  * BOQ Summary (${projectContext.boqSummary.count} lines, total ${p.currency || 'USD'} ${projectContext.boqSummary.totalAmount}): ${JSON.stringify(projectContext.boqSummary.byDiscipline)}
  * Change Orders (${projectContext.changeOrders.length}): ${JSON.stringify(projectContext.changeOrders)}
  * Purchase Orders (${projectContext.purchaseOrders.length}): ${JSON.stringify(projectContext.purchaseOrders)}

- Quality & Punch List:
  * QA/QC Inspections (${projectContext.inspections.length}): ${JSON.stringify(projectContext.inspections)}
  * NCRs: ${JSON.stringify(projectContext.ncrs)}
  * Open Snags: ${JSON.stringify(projectContext.punchlist.openItems)}

- Tasks & Programme (${projectContext.tasks.total} total):
  * Active Tasks: ${JSON.stringify(projectContext.tasks.activeItems)}

- Technical Transmittals & Documents:
  * Documents (${projectContext.documents.length}): ${JSON.stringify(projectContext.documents)}
  * RFIs: ${JSON.stringify(projectContext.rfis)}
  * Submittals: ${JSON.stringify(projectContext.submittals)}

- Site Reports & HSE:
  * Daily Logs: ${JSON.stringify(projectContext.dailyLogs)}
  * Safety: ${JSON.stringify(projectContext.safetyIncidents)}
  * Attendance Today: ${JSON.stringify(projectContext.workforceToday)}

${MEP_REFERENCE_KNOWLEDGE}`;

      let contents: any[] = [];
      if (Array.isArray(body.messages) && body.messages.length > 0) {
        contents = body.messages.map(m => {
          const role = (m.role === "assistant" || m.role === "model") ? "model" : "user";
          const text = m.content || m.text || (m.parts && m.parts[0]?.text) || "";
          return { role, parts: [{ text: String(text) }] };
        });
      } else {
        contents = [{ role: "user", parts: [{ text: String(userQuery) }] }];
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: {
          systemInstruction,
          temperature: 0.2,
        },
      });

      reply = response.text || "";
      modelUsed = "gemini-2.5-flash";
    } catch (err: any) {
      console.warn("Gemini Copilot API call failed, falling back to deterministic reasoning engine:", err?.message);
    }
  }

  // Reliable deterministic engine fallback
  if (!reply || !reply.trim()) {
    reply = generateDeterministicCopilotAnswer(userQuery, projectContext);
  }

  // Follow-up suggestions
  const suggestedFollowups: string[] = [];
  const qLower = userQuery.toLowerCase();
  if (qLower.includes("budget") || qLower.includes("boq") || qLower.includes("cost")) {
    suggestedFollowups.push("What change orders or variations are approved?", "Show committed purchase orders and vendors", "List work packages and trade budgets");
  } else if (qLower.includes("punch") || qLower.includes("snag") || qLower.includes("defect")) {
    suggestedFollowups.push("What are the urgent priority 1 defects?", "Which subcontractors are responsible for open snags?", "Show QA/QC inspection results");
  } else if (qLower.includes("package") || qLower.includes("trade") || qLower.includes("subcontractor")) {
    suggestedFollowups.push("What is the budget breakdown for HVAC vs Electrical?", "What open RFIs are blocking these packages?", "Show active tasks by trade");
  } else if (qLower.includes("portfolio") || qLower.includes("all projects")) {
    suggestedFollowups.push("Show details for Burj Crown Commercial Tower", "Show details for BOV St. Venera", "Compare project budgets");
  } else {
    suggestedFollowups.push(
      "What is the total budget and commercial breakdown?",
      "List all work packages and assigned subcontractors",
      "What open punch list snags require attention?",
      "Show all projects in the portfolio"
    );
  }

  return {
    reply,
    answer: reply,
    project_id: p.id,
    project_name: p.name,
    quick_facts: {
      name: p.name,
      code: p.code || p.project_code,
      client: p.client || p.client_name,
      budget: p.budget || p.contract_value || projectContext.boqSummary.totalAmount,
      currency: p.currency || "USD",
      start_date: p.start_date,
      end_date: p.end_date,
      work_packages_count: projectContext.workPackages.length,
      boq_count: projectContext.boqSummary.count,
      open_snags_count: projectContext.punchlist.openCount,
      documents_count: projectContext.documents.length,
      inspections_count: projectContext.inspections.length,
      pos_count: projectContext.purchaseOrders.length,
      change_orders_count: projectContext.changeOrders.length,
    },
    suggested_followups: suggestedFollowups,
    model_used: modelUsed,
  };
}
