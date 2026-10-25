import { Express, Request, Response } from "express";
import crypto from "crypto";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import { MEP_REFERENCE_KNOWLEDGE, MEP_DEFECT_PATTERNS, suggestFixFallback } from "../../mep_brain";
import { db, rowToDict } from "../db/connection";
import {
  SESSION_LIFETIME_MS,
  ROLE_DEFINITIONS,
  ROLE_PERMS,
  TABLE_CONFIG,
  VALID_TRANSITIONS,
  NOTIFY_WORTHY_STATUSES,
} from "../config/constants";
import {
  hashPassword,
  verifyPassword,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
} from "../middleware/rateLimit";
import {
  AuthenticatedUser,
  authRequired,
  getCurrentUser,
  canAccessProject,
  hasProjectAccess,
  canAccessCompany,
  canAccessWorkPackage,
  projectScopeSql,
  canView,
  canEdit,
  canDelete,
  canPerformAction,
  externalRecordDto,
  canAccessRecord,
} from "../middleware/auth";
import { auditSafeValue, writeAudit, createNotification } from "../services/auditService";
import {
  normaliseHeader,
  extractDocumentText,
  parseImportNumber,
  normaliseProjectDateCandidate,
  fallbackProjectSetupSuggestions,
} from "../services/documentParserService";
import {
  haversineDistance,
  geofenceStatus,
  getWorkerPrincipal,
  getActiveWorkerAssignment,
  canAccessWorker,
  canAccessSite,
  canAccessAttendance,
  canAccessSiteInstruction,
  canAccessPayroll,
  safeTimeZone,
  zonedParts,
  addIsoDays,
  weekdayNumber,
  parseWorkingDays,
  getWorkerShift,
  resolveWorkDateForPunch,
  isPublicHoliday,
  scheduledWorkingDay,
  attendanceStatusForRecord,
  recalculateAttendanceRecord,
  calculateDailyAttendanceStatus,
  chargeableLeaveDays,
} from "../services/workforceService";
import { registerWorkPackageRoutes } from "../routes/workPackageRoutes";
import { registerProcurementRoutes } from "../routes/procurementRoutes";
import { registerRiskRoutes } from "../routes/riskRoutes";
import { registerOctoRoutes } from "../routes/octoRoutes";
import { registerTaskRoutes } from "../routes/taskRoutes";
import { registerProgressRoutes } from "../routes/progressRoutes";
import { getNextSequence } from "../services/referenceSequence";
import { syncProcurementTaskBlocker } from "../services/blockerService";
import { calculateRiskScore } from "../services/riskService";
import {
  extractContractorDocumentIntelligence,
  applyContractorIntelligenceAndVerify,
  normalizeDate,
} from "../services/contractorDocIntelligence";

function resolveActualTable(table: string): string {
  if (table === "drawings") return "documents";
  if (table === "daily_logs") return "dailylogs";
  if (table === "wbs") return "wbs_items";
  if (table === "boq") return "boq_items";
  if (table === "actions") return "project_actions";
  if (table === "decisions") return "project_decisions";
  if (table === "project_risks") return "risks";
  return table;
}

function recalculateProjectProgress(projectId: string | undefined | null): void {
  if (!projectId) return;
  try {
    const avgRow = db.prepare(`SELECT ROUND(AVG(COALESCE(progress, 0))) as avg_prog FROM tasks WHERE project_id = ?`).get(projectId) as any;
    if (avgRow && avgRow.avg_prog !== null && avgRow.avg_prog !== undefined) {
      db.prepare(`UPDATE projects SET progress = ? WHERE id = ?`).run(Number(avgRow.avg_prog) || 0, projectId);
    }
  } catch {}
}

function syncRfiTaskBlocker(rfiRow: any): void {
  if (!rfiRow || !rfiRow.task_id || !rfiRow.project_id) return;
  try {
    const now = new Date().toISOString();
    const isResolved = ["answered", "closed", "resolved"].includes(String(rfiRow.status || "").toLowerCase());
    const existingBlocker = db.prepare(
      `SELECT * FROM task_blockers WHERE task_id = ? AND source_type = 'rfis' AND source_id = ?`
    ).get(rfiRow.task_id, rfiRow.id) as any;

    if (isResolved) {
      if (existingBlocker) {
        db.prepare(`UPDATE task_blockers SET status = 'Resolved', resolved = 1, resolved_at = ? WHERE id = ?`).run(now, existingBlocker.id);
      }
    } else {
      const desc = `Open RFI ${rfiRow.number || ""}: ${rfiRow.subject || rfiRow.question || "Technical Clarification"}`.trim();
      if (existingBlocker) {
        db.prepare(`UPDATE task_blockers SET description = ?, status = 'Active', resolved = 0, resolved_at = NULL WHERE id = ?`).run(desc, existingBlocker.id);
      } else {
        db.prepare(`
          INSERT INTO task_blockers (
            id, project_id, task_id, blocker_type, source_type, source_id,
            description, status, reported_by, resolved, created_at
          ) VALUES (?, ?, ?, 'RFI', 'rfis', ?, ?, 'Active', ?, 0, ?)
        `).run(crypto.randomUUID(), rfiRow.project_id, rfiRow.task_id, rfiRow.id, desc, rfiRow.raised_by || "system", now);
      }
    }
  } catch {}
}

function syncInspectionVerifiedProgress(inspRow: any, userName: string): void {
  if (!inspRow?.project_id) return;
  const isPassed =
    ["pass", "passed", "approved"].includes(String(inspRow.result || "").toLowerCase()) ||
    ["pass", "passed", "approved"].includes(String(inspRow.status || "").toLowerCase());
  if (!isPassed) return;

  // Passing an inspection is not equivalent to certifying the entire work package
  // or its BOQ quantities. Those require separately approved measurements.
  // Only an explicitly measured percentage may update the linked task.
  if (!inspRow.task_id || inspRow.verified_progress === null ||
      inspRow.verified_progress === undefined || inspRow.verified_progress === "") return;
  const verifiedPct = Number(inspRow.verified_progress);
  if (!Number.isFinite(verifiedPct) || verifiedPct < 0 || verifiedPct > 100) {
    throw new Error("Inspection verified_progress must be between 0 and 100");
  }
  const task = db.prepare(
    "SELECT id, project_id, progress FROM tasks WHERE id = ? AND project_id = ?"
  ).get(inspRow.task_id, inspRow.project_id) as any;
  if (!task) throw new Error("Inspection task does not belong to this project");

  const now = new Date().toISOString();
  const newProgress = Math.max(Number(task.progress) || 0, verifiedPct);
  db.prepare(`
    UPDATE tasks SET progress = ?, status = ?, verified_by = ?, verified_at = ?
    WHERE id = ? AND project_id = ?
  `).run(newProgress, newProgress >= 100 ? "Completed" : "In Progress",
    userName, now, task.id, inspRow.project_id);
  recalculateProjectProgress(inspRow.project_id);
}

function syncBoqToMaterialRequestAndCosts(boqRow: any, userId: string): void {
  if (!boqRow || !boqRow.project_id || !boqRow.description) return;
  try {
    const specText =
      boqRow.specification ||
      `${boqRow.discipline || "MEP"} — ${boqRow.system || "General"} | ${boqRow.description} (BOQ #${boqRow.item_number || "1.01"}, UOM: ${boqRow.unit || "Item"})`;
    const reqDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const existingMr = db.prepare(
      `SELECT * FROM material_requests WHERE project_id = ? AND (boq_item_id = ? OR LOWER(COALESCE(material, item, '')) = LOWER(?)) LIMIT 1`
    ).get(boqRow.project_id, boqRow.id, boqRow.description) as any;

    if (existingMr) {
      db.prepare(`
        UPDATE material_requests
        SET material = ?, item = ?, specification = ?, spec = ?, description = ?,
            discipline = ?, system = ?, quantity = ?, unit = ?, boq_reference = ?, wbs_code = ?, boq_item_id = ?
        WHERE id = ?
      `).run(
        boqRow.description,
        boqRow.description,
        specText,
        specText,
        specText,
        boqRow.discipline || "MEP",
        boqRow.system || "General",
        Number(boqRow.revised_quantity ?? boqRow.tender_quantity ?? 1),
        boqRow.unit || "Item",
        boqRow.item_number || "1.01",
        boqRow.item_number || "1.01",
        boqRow.id,
        existingMr.id
      );
    } else {
      db.prepare(`
        INSERT INTO material_requests (
          id, project_id, location, discipline, system, material, item, specification, spec,
          description, quantity, unit, required_date, boq_reference, boq_item_id, wbs_code,
          supplier, requested_by, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft')
      `).run(
        crypto.randomUUID(),
        boqRow.project_id,
        boqRow.area || "Site-Wide",
        boqRow.discipline || "MEP",
        boqRow.system || "General",
        boqRow.description,
        boqRow.description,
        specText,
        specText,
        specText,
        Number(boqRow.tender_quantity ?? 1),
        boqRow.unit || "Item",
        reqDate,
        boqRow.item_number || "1.01",
        boqRow.id,
        boqRow.item_number || "1.01",
        "Approved MEP Vendor",
        userId
      );
    }

    const existingCost = db.prepare(
      `SELECT * FROM costs WHERE project_id = ? AND LOWER(description) = LOWER(?) LIMIT 1`
    ).get(boqRow.project_id, boqRow.description) as any;
    const plannedAmt = Number(boqRow.tender_amount ?? 0);
    const actualAmt = (Number(boqRow.installed_quantity ?? 0) > 0 && Number(boqRow.tender_rate ?? 0) > 0)
      ? Math.round(Number(boqRow.installed_quantity) * Number(boqRow.tender_rate) * 100) / 100
      : (existingCost?.actual || 0);

    if (existingCost) {
      db.prepare(`UPDATE costs SET planned = ?, actual = ? WHERE id = ?`).run(plannedAmt, actualAmt, existingCost.id);
    } else if (plannedAmt > 0) {
      db.prepare(`INSERT INTO costs (id, project_id, category, description, planned, actual, date) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        crypto.randomUUID(),
        boqRow.project_id,
        boqRow.discipline || "MEP",
        boqRow.description,
        plannedAmt,
        actualAmt,
        today
      );
    }
  } catch {}
}

export function registerCrudController(app: Express): void {
  // Generic CRUD for all configured tables
  for (const [table, cfg] of Object.entries(TABLE_CONFIG)) {
    const { cols, module } = cfg;

    // List
    app.get(`/api/${table}`, authRequired, (req, res) => {
      if (!canView(req.user!, module)) {
        res.status(403).json({ error: `No view access to ${module}` });
        return;
      }
      const actualTable = resolveActualTable(table);
      if (actualTable === "project_actions") {
        const today = new Date().toISOString().slice(0, 10);
        try {
          db.prepare("UPDATE project_actions SET status='Overdue' WHERE status NOT IN ('Completed', 'Closed') AND due_date IS NOT NULL AND due_date != '' AND due_date < ?").run(today);
        } catch {}
      }
      const projectId = req.query.project_id as string;
      let { where, params } = projectScopeSql(req.user!, projectId, `${actualTable}.project_id`);
      if (!where) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      if (req.user!.role === "Subcontractor") {
        if (table === "documents" || table === "drawings") {
          const docConds: string[] = [
            "documents.subcontractor_id = ?",
            "documents.id IN (SELECT record_id FROM record_owners WHERE module='documents' AND user_id=?)"
          ];
          params.push(req.user!.user_id, req.user!.user_id);
          if (req.user!.work_package_id) {
            docConds.push("documents.work_package_id = ?");
            params.push(req.user!.work_package_id);
          }
          if (req.user!.company_id) {
            docConds.push("documents.company_id = ?");
            params.push(req.user!.company_id);
          }
          where += ` AND (${docConds.join(" OR ")})`;
        } else if (table === "tasks" || table === "submittals" || table === "punchlist" || table === "dailylogs" || table === "daily_logs") {
          const conditions: string[] = [
            `${actualTable}.id IN (SELECT record_id FROM record_owners WHERE module=? AND user_id=?)`
          ];
          params.push(module, req.user!.user_id);
          if (req.user!.work_package_id) {
            conditions.push(`${actualTable}.work_package_id = ?`);
            params.push(req.user!.work_package_id);
          }
          if (req.user!.company_id) {
            conditions.push(`${actualTable}.company_id = ?`);
            params.push(req.user!.company_id);
          }
          if (!req.user!.work_package_id && !req.user!.company_id) {
            conditions.push("1=1");
          }
          where += ` AND (${conditions.join(" OR ")})`;
        } else {
          where += ` AND ${actualTable}.id IN (SELECT record_id FROM record_owners WHERE module=? AND user_id=?)`;
          params.push(module, req.user!.user_id);
        }
      }
      // Client visibility: enforced here in the query itself, not just hidden
      // in the UI. A Client only ever sees documents/change_orders explicitly
      // published to them - everything else stays invisible even to a
      // direct API call, regardless of what the frontend shows or hides.
      if (req.user!.role === "Client" && (table === "documents" || table === "drawings" || table === "change_orders")) {
        where += " AND visibility IN ('Client', 'All')";
      }

      let rows: any[];
      if (actualTable === "documents") {
        rows = db.prepare(`
          SELECT documents.*, users.name as subcontractor_name, users.username as subcontractor_username
          FROM documents
          LEFT JOIN users ON users.id = documents.subcontractor_id
          WHERE ${where}
          ORDER BY documents.date_added DESC
        `).all(...params);
      } else if (actualTable === "tasks") {
        rows = db.prepare(`
          SELECT tasks.*,
            s.name as site_name,
            wp.name as work_package_name,
            wp.code as work_package_code,
            c.name as company_name,
            sup.name as supervisor_name,
            w.name as worker_name
          FROM tasks
          LEFT JOIN sites s ON s.id = tasks.site_id
          LEFT JOIN work_packages wp ON wp.id = tasks.work_package_id
          LEFT JOIN companies c ON c.id = tasks.company_id
          LEFT JOIN users sup ON sup.id = tasks.supervisor_id
          LEFT JOIN workers w ON w.id = tasks.assigned_worker_id
          WHERE ${where}
          ORDER BY tasks.wbs_code ASC, tasks.start ASC
        `).all(...params);
      } else {
        rows = db.prepare(`SELECT * FROM ${actualTable} WHERE ${where}`).all(...params);
      }
      const accessibleRows = rows.filter(r => canAccessRecord(req.user!, r, "view", module));
      res.json(accessibleRows.map(r => externalRecordDto(rowToDict(r), req.user!, module)));
    });

    // Direct GET by ID with full authorization check
    app.get(`/api/${table}/:id`, authRequired, (req, res) => {
      const actualTable = resolveActualTable(table);
      let record: any;
      if (actualTable === "documents") {
        record = db.prepare(`
          SELECT documents.*, users.name as subcontractor_name, users.username as subcontractor_username
          FROM documents
          LEFT JOIN users ON users.id = documents.subcontractor_id
          WHERE documents.id = ?
        `).get(req.params.id);
      } else if (actualTable === "tasks") {
        record = db.prepare(`
          SELECT tasks.*,
            s.name as site_name,
            wp.name as work_package_name,
            wp.code as work_package_code,
            c.name as company_name,
            sup.name as supervisor_name,
            w.name as worker_name
          FROM tasks
          LEFT JOIN sites s ON s.id = tasks.site_id
          LEFT JOIN work_packages wp ON wp.id = tasks.work_package_id
          LEFT JOIN companies c ON c.id = tasks.company_id
          LEFT JOIN users sup ON sup.id = tasks.supervisor_id
          LEFT JOIN workers w ON w.id = tasks.assigned_worker_id
          WHERE tasks.id = ?
        `).get(req.params.id);
      } else {
        record = db.prepare(`SELECT * FROM ${actualTable} WHERE id = ?`).get(req.params.id);
      }

      if (!record) {
        res.status(404).json({ error: "Record not found" });
        return;
      }

      if (!canAccessRecord(req.user!, record, "view", module)) {
        res.status(403).json({ error: "Forbidden: no permission to access this record" });
        return;
      }

      res.json(externalRecordDto(rowToDict(record), req.user!, module));
    });

    // Create
    app.post(`/api/${table}`, authRequired, (req, res) => {
      const data = req.body || {};
      // Internal records start unpublished regardless of request payload.
      // Client-originated document submissions are the one explicit
      // exception: they are visible back to that Client portal by definition,
      // but this does NOT grant the Client contractor-side publish authority.
      delete data.visibility;
      delete data.published_by;
      delete data.published_at;
      const isSubcontractorDocument = (table === "documents" || table === "drawings") && req.user!.role === "Subcontractor";
      const isClientDocumentSubmission = table === "documents" && req.user!.role === "Client";
      if (!isSubcontractorDocument && !isClientDocumentSubmission && !canEdit(req.user!, module)) {
        res.status(403).json({ error: `No edit access to ${module}` });
        return;
      }
      if (!hasProjectAccess(req.user!, data.project_id)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }

      // Subcontractor work package and company boundary enforcement
      if (req.user!.role === "Subcontractor") {
        if (req.user!.work_package_id) {
          if (data.work_package_id && data.work_package_id !== req.user!.work_package_id) {
            res.status(403).json({ error: "Cannot create records for another work package" });
            return;
          }
          data.work_package_id = req.user!.work_package_id;
        }
        if (req.user!.company_id) {
          if (data.company_id && data.company_id !== req.user!.company_id) {
            res.status(403).json({ error: "Cannot create records for another company" });
            return;
          }
          data.company_id = req.user!.company_id;
        }
      }

      if (isClientDocumentSubmission) {
        const allowedClientCategories = new Set(["Client Submission", "Clarification Attachment", "Client Drawing", "Other"]);
        data.category = allowedClientCategories.has(String(data.category || "")) ? data.category : "Client Submission";
        data.name = String(data.name || data.attachment_name || "Client Submission").slice(0, 300);
        data.revision = String(data.revision || "Rev 0").slice(0, 80);
        data.date_added = data.date_added || new Date().toISOString().slice(0, 10);
        data.visibility = "Client";
        data.published_by = null;
        data.published_at = null;
        data.subcontractor_id = null;
        data.uploaded_by = req.user!.name;
        delete data.markup_data;
      }

      // Normalization helpers for rich MEP fields
      if (table === "punchlist") {
        if (!data.item && data.description) data.item = data.description;
        if (!data.location && data.floor) data.location = data.floor;
        if (!data.date_raised) data.date_raised = new Date().toISOString().slice(0, 10);
      } else if (table === "dailylogs" || table === "daily_logs") {
        if (!data.date && data.log_date) data.date = data.log_date;
        if (!data.notes && data.work_performed) data.notes = data.work_performed;
        if (!data.trade) data.trade = req.user!.specialization || "General MEP";
        if (!data.weather) data.weather = "Clear / Normal";
        if (!data.crew) data.crew = String(data.workers_count || 12);
      } else if (table === "submittals") {
        if (!data.item && data.title) data.item = data.title;
        if (!data.date_submitted) data.date_submitted = new Date().toISOString().slice(0, 10);
        if (!data.due_date) data.due_date = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      } else if (table === "drawings") {
        if (!data.category) data.category = "Drawing";
      } else if (table === "wbs_items" || table === "wbs") {
        if (data.active === undefined) data.active = 1;
      } else if (table === "plan_task_checklist") {
        if (data.is_checked === undefined) data.is_checked = 0;
      } else if (table === "boq_items" || table === "boq") {
        data.item_number = data.item_number || data.item_code || "1.01";
        data.description = data.description || data.material || data.item || "MEP Line Item";
        data.unit = data.unit || data.uom || "Item";
        data.tender_quantity = Number(data.tender_quantity ?? data.quantity ?? 1);
        data.tender_rate = Number(data.tender_rate ?? data.unit_rate ?? 0);
        data.tender_amount = Number(data.tender_amount ?? data.total_amount ?? (data.tender_quantity * data.tender_rate));
        data.revised_quantity = Number(data.revised_quantity ?? data.tender_quantity);
        data.installed_quantity = Number(data.installed_quantity ?? data.completed_qty ?? 0);
        data.claimed_quantity = Number(data.claimed_quantity ?? 0);
        data.certified_quantity = Number(data.certified_quantity ?? 0);
        data.discipline = data.discipline || data.trade || "MEP";
        data.system = data.system || `${data.discipline} System`;
        data.specification =
          data.specification ||
          data.spec ||
          `${data.discipline} — ${data.system} | ${data.description} (BOQ #${data.item_number}, UOM: ${data.unit})`;
        data.created_at = data.created_at || new Date().toISOString();
      } else if (table === "material_requests") {
        const linkedBoq = data.boq_item_id
          ? (db.prepare("SELECT * FROM boq_items WHERE id = ?").get(data.boq_item_id) as any)
          : data.boq_reference
          ? (db.prepare("SELECT * FROM boq_items WHERE project_id = ? AND item_number = ?").get(data.project_id, data.boq_reference) as any)
          : null;
        const matName = data.material || data.item || linkedBoq?.description || data.description || "MEP Material";
        const specVal =
          data.specification ||
          data.spec ||
          linkedBoq?.specification ||
          (linkedBoq ? `${linkedBoq.discipline || "MEP"} — ${linkedBoq.system || "System"} | ${linkedBoq.description} (BOQ #${linkedBoq.item_number})` : data.description || `${data.discipline || "MEP"} Standard Specification`);
        data.material = matName;
        data.item = matName;
        data.specification = specVal;
        data.spec = specVal;
        data.description = data.description || specVal;
        data.discipline = data.discipline || linkedBoq?.discipline || "MEP";
        data.system = data.system || linkedBoq?.system || "General";
        data.unit = data.unit || linkedBoq?.unit || "Item";
        data.quantity = Number(data.quantity ?? linkedBoq?.tender_quantity ?? 1);
        data.boq_item_id = data.boq_item_id || linkedBoq?.id || null;
        data.boq_reference = data.boq_reference || data.wbs_code || linkedBoq?.item_number || null;
        data.wbs_code = data.wbs_code || data.boq_reference || null;
        data.status = data.status || "Draft";
        data.requested_by = data.requested_by || req.user!.name;
      } else if (table === "rfis") {
        data.subject = data.subject || data.title || data.question || "RFI Clarification";
        data.question = data.question || data.subject || data.title || "";
        data.status = data.status || "Open";
        if (data.drawing_id && !data.drawing_ref) {
          const doc = db.prepare("SELECT name FROM documents WHERE id = ?").get(data.drawing_id) as any;
          if (doc?.name) data.drawing_ref = doc.name;
        }
      } else if (table === "inspections") {
        data.type = data.type || data.title || "QA/QC Site Inspection";
        data.title = data.title || data.type;
        data.status = data.status || data.result || "Scheduled";
        data.result = data.result || (["approved", "pass", "passed"].includes(String(data.status).toLowerCase()) ? "Pass" : data.status);
        data.inspector = data.inspector || req.user!.name;
        data.date = data.date || new Date().toISOString().slice(0, 10);
      }

      const id = crypto.randomUUID();
      data.id = id;
      if (table === "documents" || table === "drawings") {
        if (req.user!.role === "Subcontractor") {
          data.subcontractor_id = req.user!.user_id;
          data.uploaded_by = req.user!.name;
        } else if (req.user!.role === "Client") {
          // Values were normalized above for the dedicated Client submission path.
          data.subcontractor_id = null;
          data.uploaded_by = req.user!.name;
          data.visibility = "Client";
          data.published_by = null;
          data.published_at = null;
        } else {
          data.uploaded_by = data.uploaded_by || req.user!.name;
          if (!data.subcontractor_id) {
            data.subcontractor_id = null;
          }
        }
      }
      const actualTable = resolveActualTable(table);

      if (actualTable === "project_actions") {
        if (!data.action_no) {
          data.action_no = getNextSequence(db, data.project_id, "action");
        }
        data.created_by = req.user!.user_id;
        data.created_at = new Date().toISOString();
      }
      if (actualTable === "project_decisions") {
        if (!data.decision_no) {
          data.decision_no = getNextSequence(db, data.project_id, "decision");
        }
        data.created_by = req.user!.user_id;
        data.created_at = new Date().toISOString();
      }
      if (actualTable === "risks" && (data.probability !== undefined || data.impact !== undefined)) {
        if (data.probability !== undefined) {
          const p = Number(data.probability);
          if (!isNaN(p) && (p < 1 || p > 5)) {
            res.status(400).json({ error: "probability must be between 1 and 5" });
            return;
          }
        }
        if (data.impact !== undefined) {
          const i = Number(data.impact);
          if (!isNaN(i) && (i < 1 || i > 5)) {
            res.status(400).json({ error: "impact must be between 1 and 5" });
            return;
          }
        }
        const evaluated = calculateRiskScore(data.probability, data.impact);
        data.risk_score = evaluated.score;
        data.risk_level = evaluated.level;
        data.created_by = data.created_by || req.user!.user_id;
        data.created_at = data.created_at || new Date().toISOString();
      }

      const values = cols.map(c => (c === "id" ? id : data[c] !== undefined ? data[c] : null));
      const placeholders = cols.map(() => "?").join(",");
      db.prepare(`INSERT INTO ${actualTable} (${cols.join(",")}) VALUES (${placeholders})`).run(...values);
      db.prepare("INSERT OR IGNORE INTO record_owners VALUES (?, ?, ?)").run(module, id, req.user!.user_id);

      if (actualTable === "purchase_orders") {
        if (data.task_id) {
          try {
            syncProcurementTaskBlocker(db, {
              id,
              project_id: data.project_id,
              task_id: data.task_id,
              po_number: data.po_number,
              item_name: data.description,
              expected_delivery_date: data.expected_delivery_date || data.expected_delivery,
              status: data.status
            });
          } catch {}
        }
        if (Number(data.amount) > 0 && data.project_id) {
          try {
            const today = new Date().toISOString().slice(0, 10);
            db.prepare(`INSERT INTO costs (id, project_id, category, description, planned, actual, date) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
              crypto.randomUUID(),
              data.project_id,
              "Procurement PO",
              `${data.po_number || "PO"} — ${data.vendor || "Vendor"}: ${data.description || "Material Order"}`,
              Number(data.amount),
              Number(data.amount),
              today
            );
          } catch {}
        }
      }

      if (actualTable === "boq_items") {
        syncBoqToMaterialRequestAndCosts(data, req.user!.user_id);
      }
      if (actualTable === "tasks") {
        recalculateProjectProgress(data.project_id);
      }
      if (actualTable === "rfis") {
        syncRfiTaskBlocker(data);
      }
      if (actualTable === "inspections") {
        syncInspectionVerifiedProgress(data, req.user!.name);
      }

      writeAudit(req.user!.user_id, module, id, data.project_id, "create", null, data);
      res.status(201).json(data);
    });

    // Update
    app.put(`/api/${table}/:id`, authRequired, (req, res) => {
      const isDoc = (table === "documents" || table === "drawings") && req.user!.role === "Subcontractor";
      if (!isDoc && !canEdit(req.user!, module)) {
        res.status(403).json({ error: `No edit access to ${module}` });
        return;
      }
      const actualTable = resolveActualTable(table);
      const existing = db.prepare(`SELECT * FROM ${actualTable} WHERE id=?`).get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (!canAccessRecord(req.user!, existing, "edit", module)) {
        res.status(403).json({ error: "No edit access to this record" });
        return;
      }

      const data = req.body || {};

      // Immutable governance fields protection
      const immutableFields = ["id", "project_id", "created_by", "created_at", "action_no", "decision_no", "reference"];
      for (const field of immutableFields) {
        if (field in data && data[field] !== undefined && data[field] !== null && existing[field] && String(data[field]) !== String(existing[field])) {
          res.status(400).json({ error: `Field '${field}' is immutable and cannot be altered` });
          return;
        }
      }

      if (actualTable === "risks" && (data.probability !== undefined || data.impact !== undefined)) {
        if (data.probability !== undefined) {
          const p = Number(data.probability);
          if (!isNaN(p) && (p < 1 || p > 5)) {
            res.status(400).json({ error: "probability must be between 1 and 5" });
            return;
          }
        }
        if (data.impact !== undefined) {
          const i = Number(data.impact);
          if (!isNaN(i) && (i < 1 || i > 5)) {
            res.status(400).json({ error: "impact must be between 1 and 5" });
            return;
          }
        }
        const prob = data.probability !== undefined ? data.probability : existing.probability;
        const imp = data.impact !== undefined ? data.impact : existing.impact;
        const evaluated = calculateRiskScore(prob, imp);
        data.risk_score = evaluated.score;
        data.risk_level = evaluated.level;
      }

      if (req.user!.role === "Subcontractor") {
        if (data.work_package_id && req.user!.work_package_id && data.work_package_id !== req.user!.work_package_id) {
          res.status(403).json({ error: "Cannot assign record to another work package" });
          return;
        }
        if (data.company_id && req.user!.company_id && data.company_id !== req.user!.company_id) {
          res.status(403).json({ error: "Cannot assign record to another company" });
          return;
        }
      }

      // Publishing (making a record Client-visible) is a separate authority
      // from ordinary edit access - a Site Engineer or QA/QC user can edit a
      // document's content, but that shouldn't let them decide what a client
      // gets to see. Restricted to the roles who actually own the client
      // relationship, regardless of who can otherwise edit this module.
      if ("visibility" in data && (data.visibility === "Client" || data.visibility === "All")) {
        if (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager") {
          res.status(403).json({ error: "Only an Admin or Project Manager can publish records to the client" });
          return;
        }
      }
      // published_by/published_at are accountability fields - always
      // server-stamped, never trusted from the request body. Publishing
      // (setting visibility to Client/All) records who did it and when.
      delete data.published_by;
      delete data.published_at;
      if ("visibility" in data && data.visibility !== existing.visibility && (data.visibility === "Client" || data.visibility === "All")) {
        data.published_by = req.user!.user_id;
        data.published_at = new Date().toISOString();
      }
      // A published record whose meaningful content is edited afterward is
      // automatically un-published, rather than silently letting the client
      // keep seeing content that no longer matches what was reviewed under
      // that publish timestamp. Republishing (explicitly setting visibility
      // again in the same request) is still allowed in one step.
      if (
        (existing.visibility === "Client" || existing.visibility === "All") &&
        !("visibility" in data) &&
        Object.keys(data).some(k => k !== "id" && k !== "project_id" && k !== "visibility" && k !== "published_by" && k !== "published_at")
      ) {
        data.visibility = "Internal";
        data.published_by = null;
        data.published_at = null;
      }
      if (actualTable === "material_requests") {
        if (data.material && !data.item) data.item = data.material;
        if (data.item && !data.material) data.material = data.item;
        if (data.specification && !data.spec) data.spec = data.specification;
        if (data.spec && !data.specification) data.specification = data.spec;
      }
      if (actualTable === "boq_items") {
        if (data.quantity !== undefined && data.tender_quantity === undefined) data.tender_quantity = Number(data.quantity);
        if (data.unit_rate !== undefined && data.tender_rate === undefined) data.tender_rate = Number(data.unit_rate);
        if (data.completed_qty !== undefined && data.installed_quantity === undefined) data.installed_quantity = Number(data.completed_qty);
        if (data.spec !== undefined && data.specification === undefined) data.specification = data.spec;
      }

      const editableCols = cols.filter(c => c !== "id" && c !== "project_id");
      const updates: string[] = [];
      const values: any[] = [];
      for (const c of editableCols) {
        if (c in data) {
          updates.push(`${c}=?`);
          values.push(data[c]);
        }
      }
      if (updates.length > 0) {
        values.push(req.params.id);
        db.prepare(`UPDATE ${actualTable} SET ${updates.join(",")} WHERE id=?`).run(...values);
      }
      const updated = db.prepare(`SELECT * FROM ${actualTable} WHERE id=?`).get(req.params.id) as any;

      if (actualTable === "purchase_orders") {
        try {
          syncProcurementTaskBlocker(db, {
            id: req.params.id,
            project_id: updated.project_id,
            task_id: updated.task_id,
            po_number: updated.po_number,
            item_name: updated.description,
            expected_delivery_date: updated.expected_delivery_date || updated.expected_delivery,
            status: updated.status
          });
        } catch {}
      }

      if (actualTable === "boq_items") {
        syncBoqToMaterialRequestAndCosts(updated, req.user!.user_id);
      }
      if (actualTable === "tasks") {
        recalculateProjectProgress(updated.project_id);
      }
      if (actualTable === "rfis") {
        syncRfiTaskBlocker(updated);
      }
      if (actualTable === "inspections") {
        syncInspectionVerifiedProgress(updated, req.user!.name);
      }

      if (actualTable === "tasks" && updated.evidence_url) {
        try {
          const existingDoc = db.prepare("SELECT id FROM documents WHERE project_id=? AND name LIKE ?").get(updated.project_id, `%${updated.title}%Evidence%`) as any;
          const today = new Date().toISOString().slice(0, 10);
          const docName = `${updated.title} - Completion Evidence Photo`;
          if (!existingDoc) {
            db.prepare(`
              INSERT INTO documents (id, project_id, name, category, work_package_id, revision, status, date_added, attachment_name, attachment_data, uploaded_by, visibility)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              crypto.randomUUID(),
              updated.project_id,
              docName,
              'Site Photo',
              updated.work_package_id || null,
              'Rev 0',
              'Approved',
              today,
              `${(updated.wbs_code || 'TASK')}_evidence.jpg`,
              updated.evidence_url,
              req.user!.name,
              'Internal'
            );
          } else {
            db.prepare(`
              UPDATE documents SET attachment_data=?, date_added=? WHERE id=?
            `).run(updated.evidence_url, today, existingDoc.id);
          }
        } catch (docErr) {
          console.error("Auto-archiving task evidence photo error:", docErr);
        }
      }

      if ("status" in data && "status" in existing && data.status !== existing.status) {
        db.prepare("INSERT INTO task_status_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), existing.project_id, req.params.id, req.user!.name,
          existing.status, data.status, new Date().toISOString(), data.status_comment || null
        );
        if (NOTIFY_WORTHY_STATUSES.has(data.status)) {
          const owner = db.prepare("SELECT user_id FROM record_owners WHERE module=? AND record_id=?").get(module, req.params.id) as any;
          if (owner && owner.user_id !== req.user!.user_id) {
            const label = existing.title || existing.number || existing.item || existing.name || module;
            createNotification(
              owner.user_id, existing.project_id, module, req.params.id,
              `${label} is now ${data.status}`,
              `${req.user!.name} changed the status of "${label}" to ${data.status}.`
            );
          }
        }
      }
      if ("assigned_to" in data && data.assigned_to && data.assigned_to !== existing.assigned_to) {
        const label = existing.title || existing.number || existing.item || module;
        createNotification(
          data.assigned_to, existing.project_id, module, req.params.id,
          `You were assigned: ${label}`,
          `${req.user!.name} assigned you to "${label}".`
        );
      }
      writeAudit(req.user!.user_id, module, req.params.id, existing.project_id, "update", existing, updated);
      res.json(rowToDict(updated));
    });

    // Delete
    app.delete(`/api/${table}/:id`, authRequired, (req, res) => {
      const actualTable = resolveActualTable(table);
      const existing = db.prepare(`SELECT * FROM ${actualTable} WHERE id=?`).get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (!canAccessRecord(req.user!, existing, "delete", module)) {
        res.status(403).json({ error: "No delete access to this record" });
        return;
      }
      db.prepare(`DELETE FROM ${actualTable} WHERE id=?`).run(req.params.id);
      db.prepare("DELETE FROM record_owners WHERE module=? AND record_id=?").run(module, req.params.id);
      if (actualTable === "tasks") {
        recalculateProjectProgress(existing.project_id);
      }
      writeAudit(req.user!.user_id, module, req.params.id, existing.project_id, "delete", existing, null);
      res.json({ ok: true });
    });
  }
}
