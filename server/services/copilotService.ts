import { GoogleGenAI } from "@google/genai";
import { db } from "../db/connection";
import { AuthenticatedUser, hasProjectAccess } from "../middleware/auth";
import { MEP_REFERENCE_KNOWLEDGE } from "../../mep_brain";

export interface CopilotProjectContext {
  project: any;
  workPackages: any[];
  boqSummary: {
    count: number;
    totalAmount: number;
    byDiscipline: Array<{ discipline: string; count: number; total_amount: number }>;
    sampleItems: any[];
  };
  documents: any[];
  tasks: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    activeItems: any[];
  };
  punchlist: {
    total: number;
    openCount: number;
    byPriority: Array<{ priority: string; count: number }>;
    openItems: any[];
  };
  rfis: any[];
  materialRequests: any[];
  procurementItems: any[];
  risks: any[];
  actions: any[];
  decisions: any[];
  workforceToday: any[];
}

/**
 * Retrieve complete, live project intelligence context from the SQLite database.
 */
export function getProjectCopilotContext(projectId?: string, user?: AuthenticatedUser): CopilotProjectContext | null {
  if (!projectId || projectId === "all" || projectId === "ALL") {
    // Pick the most recent active project accessible to the user
    const firstProj = user?.role === "Admin"
      ? (db.prepare("SELECT * FROM projects ORDER BY rowid DESC LIMIT 1").get() as any)
      : (db.prepare(`
          SELECT p.* FROM projects p
          JOIN project_memberships pm ON p.id = pm.project_id
          WHERE pm.user_id = ? AND pm.active = 1
          ORDER BY p.rowid DESC LIMIT 1
        `).get(user?.user_id) as any || db.prepare("SELECT * FROM projects LIMIT 1").get() as any);
    if (!firstProj) return null;
    projectId = firstProj.id;
  }

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!project) return null;

  // Work packages
  const workPackages = db.prepare(`
    SELECT id, name, code, discipline, description, budget_allocated, status, assigned_subcontractor, start_date, end_date
    FROM work_packages
    WHERE project_id = ?
    ORDER BY created_at ASC
  `).all(projectId) as any[];

  // BOQ Summary
  const boqAgg = db.prepare(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(tender_amount), 0) as total
    FROM boq_items
    WHERE project_id = ?
  `).get(projectId) as any;

  const boqByDiscipline = db.prepare(`
    SELECT discipline, COUNT(*) as count, COALESCE(SUM(tender_amount), 0) as total_amount
    FROM boq_items
    WHERE project_id = ?
    GROUP BY discipline
    ORDER BY total_amount DESC
  `).all(projectId) as any[];

  const sampleBoqItems = db.prepare(`
    SELECT item_number, description, unit, tender_quantity, tender_rate, tender_amount, discipline, system, area
    FROM boq_items
    WHERE project_id = ?
    ORDER BY tender_amount DESC
    LIMIT 15
  `).all(projectId) as any[];

  // Documents
  const documents = db.prepare(`
    SELECT id, name, category, revision, date_added, attachment_name
    FROM documents
    WHERE project_id = ?
    ORDER BY date_added DESC
    LIMIT 25
  `).all(projectId) as any[];

  // Tasks
  const taskCount = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE project_id = ?").get(projectId) as any;
  const tasksByStatus = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM tasks
    WHERE project_id = ?
    GROUP BY status
  `).all(projectId) as any[];

  const activeTasks = db.prepare(`
    SELECT title, trade, assignee, start, end, progress, status, priority, wbs_code
    FROM tasks
    WHERE project_id = ?
    ORDER BY CASE WHEN status = 'In Progress' THEN 0 WHEN status = 'Not Started' THEN 1 ELSE 2 END, end ASC
    LIMIT 20
  `).all(projectId) as any[];

  // Punch list / Snags
  const punchAgg = db.prepare("SELECT COUNT(*) as c FROM punchlist WHERE project_id = ?").get(projectId) as any;
  const punchOpen = db.prepare("SELECT COUNT(*) as c FROM punchlist WHERE project_id = ? AND status != 'Closed'").get(projectId) as any;
  const punchByPriority = db.prepare(`
    SELECT priority, COUNT(*) as count
    FROM punchlist
    WHERE project_id = ? AND status != 'Closed'
    GROUP BY priority
  `).all(projectId) as any[];

  const openSnags = db.prepare(`
    SELECT id, item, trade, location, priority, date_raised, status
    FROM punchlist
    WHERE project_id = ? AND status != 'Closed'
    ORDER BY CASE priority WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END, date_raised DESC
    LIMIT 15
  `).all(projectId) as any[];

  // RFIs
  const rfis = db.prepare(`
    SELECT number, subject, trade, date_raised, due_date, status
    FROM rfis
    WHERE project_id = ?
    ORDER BY date_raised DESC
    LIMIT 15
  `).all(projectId) as any[];

  // Material requests & Procurement
  const materialRequests = db.prepare(`
    SELECT material, description, quantity, unit, required_date, status, location
    FROM material_requests
    WHERE project_id = ?
    ORDER BY required_date ASC
    LIMIT 15
  `).all(projectId) as any[];

  const procurementItems = db.prepare(`
    SELECT pr_number, material, quantity, unit, required_on_site, selected_supplier, po_number, status
    FROM procurement_items
    WHERE project_id = ?
    ORDER BY required_on_site ASC
    LIMIT 15
  `).all(projectId) as any[];

  // Risks
  const risks = db.prepare(`
    SELECT risk_no, title, category, probability, impact, risk_score, risk_level, mitigation, status
    FROM risks
    WHERE project_id = ?
    ORDER BY risk_score DESC
    LIMIT 10
  `).all(projectId) as any[];

  // Actions & Decisions
  const actions = db.prepare(`
    SELECT action_no, title, assigned_to_name, priority, status, due_date
    FROM project_actions
    WHERE project_id = ? AND status != 'Completed'
    LIMIT 10
  `).all(projectId) as any[];

  const decisions = db.prepare(`
    SELECT decision_no, title, decision_taken, decided_by, decision_date
    FROM project_decisions
    WHERE project_id = ?
    ORDER BY decision_date DESC
    LIMIT 10
  `).all(projectId) as any[];

  // Attendance
  const today = new Date().toISOString().split("T")[0];
  const workforceToday = db.prepare(`
    SELECT worker, punch_in, punch_out, status
    FROM attendance
    WHERE project_id = ? AND work_date = ?
    ORDER BY punch_in ASC
  `).all(projectId, today) as any[];

  return {
    project,
    workPackages,
    boqSummary: {
      count: boqAgg?.cnt || 0,
      totalAmount: boqAgg?.total || 0,
      byDiscipline: boqByDiscipline,
      sampleItems: sampleBoqItems,
    },
    documents,
    tasks: {
      total: taskCount?.c || 0,
      byStatus: tasksByStatus,
      activeItems: activeTasks,
    },
    punchlist: {
      total: punchAgg?.c || 0,
      openCount: punchOpen?.c || 0,
      byPriority: punchByPriority,
      openItems: openSnags,
    },
    rfis,
    materialRequests,
    procurementItems,
    risks,
    actions,
    decisions,
    workforceToday,
  };
}

/**
 * Deterministic fallback generator that answers queries directly from the SQLite database.
 */
export function generateDeterministicCopilotAnswer(question: string, ctx: CopilotProjectContext): string {
  const q = question.toLowerCase();
  const p = ctx.project;
  const cur = p.currency || "USD";

  // 1. Budget / Financials / BOQ
  if (q.includes("budget") || q.includes("cost") || q.includes("financial") || q.includes("value") || q.includes("price") || q.includes("boq") || q.includes("bill of quantities")) {
    let out = `### 💰 Budget & Commercial Breakdown for **${p.name}**\n\n`;
    out += `- **Total Contract Value / Budget:** **${cur} ${Number(p.budget || p.contract_value || ctx.boqSummary.totalAmount || 0).toLocaleString()}**\n`;
    out += `- **Contract Type:** ${p.contract_type || "Lump Sum Subcontract"}\n`;
    out += `- **Total BOQ Line Items:** ${ctx.boqSummary.count} items (Totaling ${cur} ${Number(ctx.boqSummary.totalAmount).toLocaleString()})\n\n`;

    if (ctx.boqSummary.byDiscipline.length > 0) {
      out += `#### Trade Breakdown by Discipline:\n`;
      ctx.boqSummary.byDiscipline.forEach(d => {
        out += `- **${d.discipline}:** ${cur} ${Number(d.total_amount).toLocaleString()} (${d.count} BOQ items)\n`;
      });
      out += `\n`;
    }

    if (ctx.workPackages.length > 0) {
      out += `#### Allocated Work Packages:\n`;
      ctx.workPackages.forEach(wp => {
        out += `- **[${wp.code || 'WP'}] ${wp.name}:** ${cur} ${Number(wp.budget_allocated || 0).toLocaleString()} (Status: *${wp.status}*)\n`;
      });
    }
    return out;
  }

  // 2. Client / Contractor / Stakeholders
  if (q.includes("client") || q.includes("contractor") || q.includes("consultant") || q.includes("subcontractor") || q.includes("stakeholder") || q.includes("employer") || q.includes("who is")) {
    let out = `### 🏢 Project Parties & Key Stakeholders for **${p.name}**\n\n`;
    out += `- **Project Name:** ${p.name} (${p.code || 'MEP-PROJ'})\n`;
    out += `- **Client / Employer:** **${p.client || p.client_name || 'Primary Project Client'}**\n`;
    out += `- **Main Contractor:** **${p.main_contractor || 'Lead General Contractor'}**\n`;
    out += `- **Supervising Consultant:** **${p.consultant || 'MEP Engineering Consultant'}**\n`;
    out += `- **Site Location:** ${p.location || 'Site Location Not Specified'}\n`;
    out += `- **Current Stage:** ${p.stage || 'Execution'} · **Status:** ${p.status || 'Active'}\n`;
    return out;
  }

  // 3. Work Packages
  if (q.includes("work package") || q.includes("packages") || q.includes("trades") || q.includes("scope") || q.includes("subcontract")) {
    let out = `### 📦 Work Packages for **${p.name}**\n\n`;
    if (ctx.workPackages.length === 0) {
      out += `No work packages are registered yet. You can import a BOQ or create work packages in the Work Packages domain.\n`;
    } else {
      out += `Total Work Packages: **${ctx.workPackages.length}**\n\n`;
      ctx.workPackages.forEach((wp, idx) => {
        out += `${idx + 1}. **${wp.name}** (\`${wp.code || 'WP'}\`)\n`;
        out += `   - **Discipline:** ${wp.discipline || 'Multi-Trade'}\n`;
        out += `   - **Budget:** ${cur} ${Number(wp.budget_allocated || 0).toLocaleString()}\n`;
        out += `   - **Status:** ${wp.status} · Subcontractor: ${wp.assigned_subcontractor || 'In-House MEP Team'}\n`;
        if (wp.description) out += `   - **Scope:** ${wp.description}\n`;
      });
    }
    return out;
  }

  // 4. Punch List / Snags / Defects
  if (q.includes("punch") || q.includes("snag") || q.includes("defect") || q.includes("quality") || q.includes("ncr") || q.includes("open item")) {
    let out = `### ⚠️ Quality & Punch List Status for **${p.name}**\n\n`;
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

  // 5. Schedule / Dates / Tasks / Overdue
  if (q.includes("schedule") || q.includes("date") || q.includes("timeline") || q.includes("task") || q.includes("milestone") || q.includes("handover") || q.includes("delay") || q.includes("overdue") || q.includes("progress")) {
    let out = `### 📅 Programme Schedule & Milestones for **${p.name}**\n\n`;
    out += `- **Start Date:** ${p.start_date || 'Not set'}\n`;
    out += `- **Target Handover / Completion:** **${p.end_date || 'Not set'}**\n`;
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
      ctx.tasks.activeItems.slice(0, 8).forEach(t => {
        out += `- **${t.title}** (${t.trade || 'MEP'}) — Status: *${t.status}* (${t.progress || 0}%), Target: ${t.end || 'TBD'}\n`;
      });
    }
    return out;
  }

  // 6. Documents / Files / Contracts
  if (q.includes("document") || q.includes("file") || q.includes("contract") || q.includes("drawing") || q.includes("upload") || q.includes("spec")) {
    let out = `### 📑 Project Documents & Transmittals for **${p.name}**\n\n`;
    if (ctx.documents.length === 0) {
      out += `No documents have been uploaded for this project yet. Use the Documents & Contract section to upload contract agreements, BOQs, or drawings.\n`;
    } else {
      out += `Total Uploaded Documents: **${ctx.documents.length}**\n\n`;
      ctx.documents.slice(0, 12).forEach((d, idx) => {
        out += `${idx + 1}. **${d.name || d.attachment_name}**\n`;
        out += `   - **Category:** ${d.category || 'General'} · **Revision:** ${d.revision || '0'} · **Date:** ${d.date_added || 'N/A'}\n`;
      });
    }
    return out;
  }

  // 7. Materials & Procurement
  if (q.includes("material") || q.includes("procurement") || q.includes("purchase") || q.includes("order") || q.includes("supplier") || q.includes("delivery")) {
    let out = `### 🚚 Procurement & Materials Pipeline for **${p.name}**\n\n`;
    if (ctx.materialRequests.length === 0 && ctx.procurementItems.length === 0) {
      out += `No open material requests or procurement orders are currently tracked for this project.\n`;
    } else {
      if (ctx.materialRequests.length > 0) {
        out += `#### Material Requests on Site:\n`;
        ctx.materialRequests.slice(0, 6).forEach(m => {
          out += `- **${m.material}** (${m.quantity} ${m.unit || 'units'}) — Required: ${m.required_date || 'ASAP'} (Status: *${m.status}*)\n`;
        });
        out += `\n`;
      }
      if (ctx.procurementItems.length > 0) {
        out += `#### Procurement Items & Suppliers:\n`;
        ctx.procurementItems.slice(0, 6).forEach(pi => {
          out += `- **${pi.material}** (\`${pi.pr_number}\`) — Supplier: ${pi.selected_supplier || 'TBD'}, Expected: ${pi.required_on_site || 'TBD'} (Status: *${pi.status}*)\n`;
        });
      }
    }
    return out;
  }

  // 8. Risks, Actions & Decisions
  if (q.includes("risk") || q.includes("action") || q.includes("decision") || q.includes("blocker")) {
    let out = `### 🛡️ Risks, Actions & Governance for **${p.name}**\n\n`;
    if (ctx.risks.length > 0) {
      out += `#### Critical Project Risks:\n`;
      ctx.risks.slice(0, 5).forEach(r => {
        out += `- **[${r.risk_level || 'Medium'}] ${r.title}** (\`${r.risk_no}\`)\n   - Impact: ${r.impact || 'Moderate'} · Mitigation: ${r.mitigation || 'Active monitoring'}\n`;
      });
      out += `\n`;
    }
    if (ctx.actions.length > 0) {
      out += `#### Open Action Items:\n`;
      ctx.actions.slice(0, 5).forEach(a => {
        out += `- **${a.title}** (\`${a.action_no}\`) — Assigned: ${a.assigned_to_name || 'Lead'}, Due: ${a.due_date || 'Pending'}\n`;
      });
      out += `\n`;
    }
    if (ctx.decisions.length > 0) {
      out += `#### Recent Decisions:\n`;
      ctx.decisions.slice(0, 4).forEach(d => {
        out += `- **${d.title}**: *${d.decision_taken}* (Decided by: ${d.decided_by || 'Management'}, ${d.decision_date || ''})\n`;
      });
    }
    return out;
  }

  // 9. Workforce & Live Presence
  if (q.includes("workforce") || q.includes("worker") || q.includes("attendance") || q.includes("on site") || q.includes("presence") || q.includes("who is on site")) {
    let out = `### 👷 Live Workforce & Site Presence for **${p.name}**\n\n`;
    if (ctx.workforceToday.length === 0) {
      out += `No workers have punched in for **${p.name}** today yet. Attendance updates in real-time as workers clock in via the mobile shell or kiosk.\n`;
    } else {
      out += `**Currently on site today (${ctx.workforceToday.length} workers):**\n\n`;
      ctx.workforceToday.forEach(w => {
        out += `- **${w.worker}** — In: ${w.punch_in ? new Date(w.punch_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Logged'} (Status: *${w.status}*)\n`;
      });
    }
    return out;
  }

  // Default: Complete Executive Summary
  return `### 📋 Comprehensive Overview for **${p.name}**\n\n` +
    `Here is the live intelligence summary for **${p.name}** (\`${p.code || 'PROJ'}\`):\n\n` +
    `| Metric | Project Value |\n` +
    `| :--- | :--- |\n` +
    `| **Client / Employer** | ${p.client || p.client_name || 'Primary Client'} |\n` +
    `| **Main Contractor** | ${p.main_contractor || 'General Contractor'} |\n` +
    `| **Consultant** | ${p.consultant || 'Engineering Consultant'} |\n` +
    `| **Total Budget** | **${cur} ${Number(p.budget || p.contract_value || ctx.boqSummary.totalAmount || 0).toLocaleString()}** |\n` +
    `| **Timeline** | ${p.start_date || 'TBD'} → ${p.end_date || 'TBD'} |\n` +
    `| **Work Packages** | ${ctx.workPackages.length} registered packages |\n` +
    `| **BOQ Items** | ${ctx.boqSummary.count} lines (${cur} ${Number(ctx.boqSummary.totalAmount).toLocaleString()}) |\n` +
    `| **Open Punch Snags** | ${ctx.punchlist.openCount} open defect(s) |\n` +
    `| **Attached Documents** | ${ctx.documents.length} verified file(s) |\n\n` +
    `💡 *You can ask me specific questions about budget breakdowns, work packages, open snags, documents, programme tasks, procurement orders, or technical MEP engineering rules.*`;
}

/**
 * Main Copilot Q&A handler that uses Gemini 3.8 Flash with full live project context.
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
  const projectId = body.project_id || body.context?.project_id;
  const userQuery = body.question || body.message || (Array.isArray(body.messages) && body.messages.length > 0 ? (body.messages[body.messages.length - 1].content || body.messages[body.messages.length - 1].text) : "") || "Provide a summary of this project";

  const projectContext = getProjectCopilotContext(projectId, user);

  // If no project found in DB
  if (!projectContext) {
    const genericAnswer = `### MEP Copilot Intelligence\n\nNo active project was selected or found in the database. Please select a project from the top navigation bar or project portfolio to query live budget, work packages, BOQ lines, documents, and snags.\n\nGeneral MEP guidance:\n- Verify drawing transmittals and specifications prior to installation.\n- Ensure all pressurized lines (chilled water, domestic water, fire fighting) undergo hydrostatic witness testing at 1.5x working pressure.`;
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
  let reply = "";
  let modelUsed = "deterministic-engine";

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const systemInstruction = `You are the Senior MEP Project Copilot and Technical Lead for the construction management platform.
You are embedded directly inside the active project: "${p.name}" (Code: ${p.code || 'N/A'}, ID: ${p.id}).

YOUR MISSION:
Answer EVERY question about this project with exact, authoritative, and factually grounded details using the live database ground truth below.
When asked about financials, budgets, dates, client names, contractors, work packages, BOQ quantities, documents, punch list snags, tasks, procurement, or workers, always quote the exact data from the context.
If asked for technical MEP engineering guidance, combine international engineering standards (BS 7671, ASHRAE 90.1/62.1, NFPA 13/72, CIBSE, SMACNA) with the specific disciplines and systems present on this project.
If asked to draft a letter, inspection request, or variation notice, draft a professional, ready-to-issue document referencing the actual project parties, dates, and trade scopes.

FORMATTING RULES:
- Use clean Markdown with bold headings, bullet points, and tables where helpful.
- Keep responses thorough, clear, actionable, and professional.
- Do NOT make up figures or dates that contradict the live database ground truth.

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

- BOQ Financial Breakdown (${projectContext.boqSummary.count} line items, total ${p.currency || 'USD'} ${projectContext.boqSummary.totalAmount}):
  * By Discipline: ${JSON.stringify(projectContext.boqSummary.byDiscipline)}
  * Top Items: ${JSON.stringify(projectContext.boqSummary.sampleItems)}

- Uploaded Documents & Contracts (${projectContext.documents.length} files):
${JSON.stringify(projectContext.documents, null, 2)}

- Punch List Defects (${projectContext.punchlist.total} total, ${projectContext.punchlist.openCount} open):
  * Open Snags: ${JSON.stringify(projectContext.punchlist.openItems)}

- Active Tasks & Programme (${projectContext.tasks.total} total):
  * Status breakdown: ${JSON.stringify(projectContext.tasks.byStatus)}
  * Sample Active Tasks: ${JSON.stringify(projectContext.tasks.activeItems)}

- Procurement & Materials:
  * Material Requests: ${JSON.stringify(projectContext.materialRequests)}
  * Procurement Items: ${JSON.stringify(projectContext.procurementItems)}

- Risks & Governance:
  * Top Risks: ${JSON.stringify(projectContext.risks)}
  * Open Actions: ${JSON.stringify(projectContext.actions)}
  * Decisions: ${JSON.stringify(projectContext.decisions)}

- Workforce Today:
${JSON.stringify(projectContext.workforceToday)}

${MEP_REFERENCE_KNOWLEDGE}`;

      // Assemble conversation contents
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
        model: "gemini-3.8-flash",
        contents,
        config: {
          systemInstruction,
          temperature: 0.2, // Low temperature for high factual accuracy grounded in project data
        },
      });

      reply = response.text || "";
      modelUsed = "gemini-3.8-flash";
    } catch (err: any) {
      console.warn("Gemini Copilot API call failed, falling back to deterministic reasoning engine:", err?.message);
    }
  }

  // Fallback to deterministic engine if Gemini did not return a response
  if (!reply || !reply.trim()) {
    reply = generateDeterministicCopilotAnswer(userQuery, projectContext);
  }

  // Generate context-aware follow-up suggestions
  const suggestedFollowups: string[] = [];
  const qLower = userQuery.toLowerCase();
  if (qLower.includes("budget") || qLower.includes("boq")) {
    suggestedFollowups.push("What are the allocated work packages and scopes?", "What open punch list items exist?", "Draft a progress payment summary");
  } else if (qLower.includes("punch") || qLower.includes("snag")) {
    suggestedFollowups.push("What are the priority 1 urgent defects?", "Which subcontractors are responsible for open snags?", "Draft a subcontractor rectification notice");
  } else if (qLower.includes("package") || qLower.includes("trade")) {
    suggestedFollowups.push("What is the total budget for HVAC vs Electrical?", "What documents are attached to these packages?", "Show active tasks by trade");
  } else {
    suggestedFollowups.push(
      "What is the total budget and trade breakdown?",
      "List all work packages and assigned subcontractors",
      "What open punch list snags require attention?",
      "Who is on site today?"
    );
  }

  return {
    reply,
    answer: reply,
    project_id: p.id,
    project_name: p.name,
    quick_facts: {
      name: p.name,
      code: p.code,
      client: p.client || p.client_name,
      budget: p.budget || p.contract_value || projectContext.boqSummary.totalAmount,
      currency: p.currency || "USD",
      start_date: p.start_date,
      end_date: p.end_date,
      work_packages_count: projectContext.workPackages.length,
      boq_count: projectContext.boqSummary.count,
      open_snags_count: projectContext.punchlist.openCount,
      documents_count: projectContext.documents.length,
    },
    suggested_followups: suggestedFollowups,
    model_used: modelUsed,
  };
}
