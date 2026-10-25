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

export function registerCommercialController(app: Express): void {
  // --- COMPANIES & DIRECTORY ---
  app.get("/api/companies", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client") {
        res.status(403).json({ error: "Access denied: company directory is confidential" });
        return;
      }
      if (req.user!.role === "Subcontractor") {
        const rows = db.prepare(`
          SELECT c.*,
            (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id OR u.company = c.name) as user_count,
            (SELECT COUNT(*) FROM work_packages wp WHERE wp.company_id = c.id) as package_count
          FROM companies c
          WHERE c.id = ? OR c.id IN (
            SELECT pc.company_id FROM project_companies pc
            WHERE pc.project_id IN (
              SELECT project_id FROM project_memberships WHERE user_id = ? AND active = 1
              UNION
              SELECT project_id FROM project_companies WHERE company_id = ?
            )
          )
          ORDER BY c.name ASC
        `).all(req.user!.company_id || "", req.user!.user_id, req.user!.company_id || "");
        res.json(rows.map(rowToDict));
        return;
      }
      const rows = db.prepare(`
        SELECT c.*,
          (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id OR u.company = c.name) as user_count,
          (SELECT COUNT(*) FROM work_packages wp WHERE wp.company_id = c.id) as package_count
        FROM companies c
        ORDER BY c.name ASC
      `).all();
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/companies", authRequired, (req, res) => {
    try {
      if (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager" && req.user!.role !== "CommercialManager") {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const data = req.body || {};
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO companies (id, name, type, trade, contact_person, email, phone, vat_number, status, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.name || "New Company",
        data.type || "Subcontractor",
        data.trade || "",
        data.contact_person || "",
        data.email || "",
        data.phone || "",
        data.vat_number || "",
        data.status || "Active",
        data.notes || "",
        now
      );
      writeAudit(req.user!.user_id, "companies", id, "SYSTEM", "create", null, data);
      res.status(201).json({ id, ...data, created_at: now });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/companies/:id", authRequired, (req, res) => {
    try {
      if (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager" && req.user!.role !== "CommercialManager") {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const existing = db.prepare("SELECT * FROM companies WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      const data = req.body || {};
      db.prepare(`
        UPDATE companies
        SET name=?, type=?, trade=?, contact_person=?, email=?, phone=?, vat_number=?, status=?, notes=?
        WHERE id=?
      `).run(
        data.name ?? existing.name,
        data.type ?? existing.type,
        data.trade ?? existing.trade,
        data.contact_person ?? existing.contact_person,
        data.email ?? existing.email,
        data.phone ?? existing.phone,
        data.vat_number ?? existing.vat_number,
        data.status ?? existing.status,
        data.notes ?? existing.notes,
        req.params.id
      );
      writeAudit(req.user!.user_id, "companies", req.params.id, "SYSTEM", "update", existing, data);
      res.json({ ok: true, id: req.params.id });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/companies/:id", authRequired, (req, res) => {
    try {
      if (req.user!.role !== "Admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      const existing = db.prepare("SELECT * FROM companies WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      db.prepare("DELETE FROM companies WHERE id=?").run(req.params.id);
      writeAudit(req.user!.user_id, "companies", req.params.id, "SYSTEM", "delete", existing, null);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- PROJECT PARTICIPATING COMPANIES ---
  app.get("/api/projects/:id/companies", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (!hasProjectAccess(req.user!, req.params.id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const rows = db.prepare(`
        SELECT pc.*, c.name as company_name, c.type as company_type, c.trade as company_trade, c.contact_person, c.email, c.phone
        FROM project_companies pc
        JOIN companies c ON c.id = pc.company_id
        WHERE pc.project_id = ?
        ORDER BY pc.created_at ASC
      `).all(req.params.id);
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/projects/:id/companies", authRequired, (req, res) => {
    try {
      if (!hasProjectAccess(req.user!, req.params.id) || (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager")) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const { company_id, role_in_project } = req.body || {};
      if (!company_id) {
        res.status(400).json({ error: "company_id is required" });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO project_companies (id, project_id, company_id, role_in_project, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, req.params.id, company_id, role_in_project || "Subcontractor", now);
      res.status(201).json({ id, project_id: req.params.id, company_id, role_in_project, created_at: now });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/projects/:id/companies/:companyId", authRequired, (req, res) => {
    try {
      if (!hasProjectAccess(req.user!, req.params.id) || (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager")) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      db.prepare("DELETE FROM project_companies WHERE project_id=? AND company_id=?").run(req.params.id, req.params.companyId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- WORK PACKAGES ---
  app.get("/api/work_packages", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client" || !canView(req.user!, "work_packages")) {
        res.status(403).json({ error: "No access to work packages" });
        return;
      }
      const projectId = req.query.project_id as string;
      let { where, params } = projectScopeSql(req.user!, projectId, "wp.project_id");
      if (!where) {
        res.status(403).json({ error: "No access to project" });
        return;
      }
      if (req.user!.role === "Subcontractor") {
        if (req.user!.work_package_id || req.user!.company_id) {
          where += " AND (wp.id = ? OR wp.company_id = ?)";
          params.push(req.user!.work_package_id || "", req.user!.company_id || "");
        } else {
          res.json([]);
          return;
        }
      }
      const rows = db.prepare(`
        SELECT wp.*,
          c.name as company_name,
          c.trade as company_trade,
          (SELECT COUNT(*) FROM tasks t WHERE t.work_package_id = wp.id) as task_count,
          (SELECT AVG(progress) FROM tasks t WHERE t.work_package_id = wp.id) as task_avg_progress,
          (SELECT COUNT(*) FROM clarifications cl WHERE cl.work_package_id = wp.id AND cl.status != 'Closed') as open_clarifications_count,
          (SELECT COUNT(*) FROM progress_submissions ps WHERE ps.work_package_id = wp.id AND ps.status = 'Submitted') as pending_submissions_count
        FROM work_packages wp
        LEFT JOIN companies c ON c.id = wp.company_id
        WHERE ${where}
        ORDER BY wp.code ASC, wp.name ASC
      `).all(...params);
      const mapped = rows.map(rowToDict);
      if (req.user!.role === "Client") {
        for (const r of mapped as any[]) {
          r.budget_allocated = 0;
        }
      }
      res.json(mapped);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/work_packages", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor" || !canEdit(req.user!, "work_packages")) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const data = req.body || {};
      if (!data.project_id || !hasProjectAccess(req.user!, data.project_id)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO work_packages (id, project_id, name, code, discipline, description, company_id, lead_contact, budget_allocated, status, start_date, target_date, created_at, site_id, wbs_item_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.project_id,
        data.name || "Untitled Work Package",
        data.code || "WP-01",
        data.discipline || "Mechanical",
        data.description || "",
        data.company_id || null,
        data.lead_contact || "",
        parseImportNumber(data.budget_allocated),
        data.status || "Planned",
        data.start_date || "",
        data.target_date || "",
        now,
        data.site_id || null,
        data.wbs_item_id || null
      );
      if (data.company_id) {
        // Link the company to the project, but never grant access to every employee.
        // Individual project memberships must be assigned explicitly by an authorized administrator.
        db.prepare(`INSERT OR IGNORE INTO project_companies (id, project_id, company_id, role_in_project, created_at) VALUES (?, ?, ?, 'Subcontractor', ?)`).run(
          crypto.randomUUID(), data.project_id, data.company_id, now
        );
      }
      writeAudit(req.user!.user_id, "work_packages", id, data.project_id, "create", null, data);
      res.status(201).json({ id, ...data, created_at: now });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/work_packages/:id", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor" || !canEdit(req.user!, "work_packages")) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const existing = db.prepare("SELECT * FROM work_packages WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Work package not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id)) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const data = req.body || {};
      const nextCompanyId = data.company_id !== undefined ? data.company_id : existing.company_id;
      db.prepare(`
        UPDATE work_packages
        SET name=?, code=?, discipline=?, description=?, company_id=?, lead_contact=?, budget_allocated=?, status=?, start_date=?, target_date=?, site_id=?, wbs_item_id=?
        WHERE id=?
      `).run(
        data.name ?? existing.name,
        data.code ?? existing.code,
        data.discipline ?? existing.discipline,
        data.description ?? existing.description,
        nextCompanyId,
        data.lead_contact ?? existing.lead_contact,
        data.budget_allocated !== undefined ? parseImportNumber(data.budget_allocated) : existing.budget_allocated,
        data.status ?? existing.status,
        data.start_date ?? existing.start_date,
        data.target_date ?? existing.target_date,
        data.site_id !== undefined ? data.site_id : existing.site_id,
        data.wbs_item_id !== undefined ? data.wbs_item_id : existing.wbs_item_id,
        req.params.id
      );
      if (nextCompanyId) {
        try {
          db.prepare(`INSERT OR IGNORE INTO project_companies (id, project_id, company_id, role_in_project, created_at) VALUES (?, ?, ?, 'Subcontractor', ?)`).run(
            crypto.randomUUID(), existing.project_id, nextCompanyId, new Date().toISOString()
          );
          db.prepare(`UPDATE tasks SET company_id=? WHERE work_package_id=?`).run(nextCompanyId, req.params.id);
          db.prepare(`UPDATE material_requests SET work_package_id=COALESCE(work_package_id, ?) WHERE project_id=? AND UPPER(discipline)=UPPER(?)`).run(
            req.params.id, existing.project_id, data.discipline ?? existing.discipline ?? ""
          );
          const companyUsers = db.prepare(`SELECT id FROM users WHERE company_id=?`).all(nextCompanyId) as any[];
          for (const cu of companyUsers) {
            db.prepare(`UPDATE users SET work_package_id = COALESCE(work_package_id, ?) WHERE id = ?`).run(req.params.id, cu.id);
            db.prepare(`
              INSERT INTO project_memberships (user_id, project_id, access_role, active)
              VALUES (?, ?, 'Subcontractor', 1)
              ON CONFLICT(user_id, project_id) DO UPDATE SET active=1
            `).run(cu.id, existing.project_id);
          }
        } catch {}
      }
      const updatedWp = db.prepare("SELECT * FROM work_packages WHERE id=?").get(req.params.id);
      writeAudit(req.user!.user_id, "work_packages", req.params.id, existing.project_id, "update", existing, updatedWp);
      res.json({ ok: true, id: req.params.id, ...(rowToDict(updatedWp) || {}) });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/work_packages/:id", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor" || !canDelete(req.user!)) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const existing = db.prepare("SELECT * FROM work_packages WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Work package not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id)) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      db.prepare("DELETE FROM work_packages WHERE id=?").run(req.params.id);
      writeAudit(req.user!.user_id, "work_packages", req.params.id, existing.project_id, "delete", existing, null);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- V1.4.1 EXTRACTED DOMAIN ROUTES ---
  registerWorkPackageRoutes(app, db, authRequired, hasProjectAccess, rowToDict);
  registerProcurementRoutes(app, db, authRequired, hasProjectAccess);
  registerRiskRoutes(app, db, authRequired, hasProjectAccess);
  registerTaskRoutes(app, db, authRequired, hasProjectAccess);
  registerOctoRoutes(app, db, authRequired, hasProjectAccess, writeAudit);

  // --- CLARIFICATIONS HUB (CLIENT <-> MAIN CONTRACTOR <-> SUBCONTRACTOR) ---
  app.get("/api/clarifications", authRequired, (req, res) => {
    try {
      const projectId = req.query.project_id as string;
      let { where, params } = projectScopeSql(req.user!, projectId, "cl.project_id");
      if (!where) {
        res.status(403).json({ error: "No access to project" });
        return;
      }
      if (req.user!.role === "Client") {
        if (req.user!.company_id) {
          where += " AND (cl.visibility IN ('Client', 'All') OR cl.from_company_id = ? OR cl.to_company_id = ?)";
          params.push(req.user!.company_id, req.user!.company_id);
        } else {
          where += " AND cl.visibility IN ('Client', 'All')";
        }
      } else if (req.user!.role === "Subcontractor") {
        const subClauses: string[] = [];
        const subParams: any[] = [];
        if (req.user!.work_package_id) {
          subClauses.push("cl.work_package_id = ?");
          subParams.push(req.user!.work_package_id);
        }
        if (req.user!.company_id) {
          subClauses.push("cl.from_company_id = ?");
          subParams.push(req.user!.company_id);
          subClauses.push("cl.to_company_id = ?");
          subParams.push(req.user!.company_id);
        }
        subClauses.push("cl.raised_by = ?");
        subParams.push(req.user!.name);
        subClauses.push("cl.id IN (SELECT record_id FROM record_owners WHERE module='clarifications' AND user_id=?)");
        subParams.push(req.user!.user_id);
        where += ` AND (${subClauses.join(" OR ")})`;
        params.push(...subParams);
      }
      const rows = db.prepare(`
        SELECT cl.*,
          fc.name as from_company_name,
          tc.name as to_company_name,
          wp.name as work_package_name,
          wp.code as work_package_code,
          (SELECT COUNT(*) FROM clarification_comments cc WHERE cc.clarification_id = cl.id) as comments_count
        FROM clarifications cl
        LEFT JOIN companies fc ON fc.id = cl.from_company_id
        LEFT JOIN companies tc ON tc.id = cl.to_company_id
        LEFT JOIN work_packages wp ON wp.id = cl.work_package_id
        WHERE ${where}
        ORDER BY cl.created_at DESC
      `).all(...params);
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/clarifications", authRequired, (req, res) => {
    try {
      const data = req.body || {};
      if (!data.project_id || !hasProjectAccess(req.user!, data.project_id)) {
        res.status(403).json({ error: "No access to project" });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const count = (db.prepare("SELECT COUNT(*) as c FROM clarifications WHERE project_id=?").get(data.project_id) as any)?.c || 0;
      const number = data.number || `CLR-${String(count + 1).padStart(3, "0")}`;
      
      let fromComp = data.from_company_id || null;
      let workPkg = data.work_package_id || null;
      let vis = data.visibility || "Internal";

      if (req.user!.role === "Client") {
        fromComp = req.user!.company_id || fromComp;
        vis = "Client";
      } else if (req.user!.role === "Subcontractor") {
        fromComp = req.user!.company_id || fromComp;
        workPkg = req.user!.work_package_id || workPkg;
        vis = "Internal";
      }

      db.prepare(`
        INSERT INTO clarifications (
          id, project_id, number, title, type, from_company_id, to_company_id,
          work_package_id, raised_by, discipline, priority, status, question_text,
          proposed_solution, cost_impact_flag, schedule_impact_flag, official_response,
          responded_by, responded_at, due_date, attachment_name, attachment_data, visibility, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.project_id,
        number,
        data.title || "Clarification Request",
        data.type || "Technical",
        fromComp,
        data.to_company_id || null,
        workPkg,
        req.user!.name || "User",
        data.discipline || "General",
        data.priority || "Medium",
        data.status || "Submitted",
        data.question_text || data.question || "",
        data.proposed_solution || "",
        data.cost_impact_flag ? 1 : 0,
        data.schedule_impact_flag ? 1 : 0,
        data.official_response || "",
        data.responded_by || "",
        data.responded_at || "",
        data.due_date || "",
        data.attachment_name || "",
        data.attachment_data || "",
        vis,
        now
      );
      db.prepare("INSERT OR IGNORE INTO record_owners VALUES (?, ?, ?)").run("clarifications", id, req.user!.user_id);
      writeAudit(req.user!.user_id, "clarifications", id, data.project_id, "create", null, data);
      res.status(201).json({ id, ...data, from_company_id: fromComp, work_package_id: workPkg, visibility: vis, number, created_at: now });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  const checkClarificationAccess = (user: AuthenticatedUser, cl: any): boolean => {
    if (!hasProjectAccess(user, cl.project_id)) return false;
    if (user.role === "Admin" || user.role === "ProjectManager" || user.role === "SiteEngineer" || user.role === "CommercialManager" || user.role === "QAQC") {
      return true;
    }
    if (user.role === "Client") {
      if (["Client", "All"].includes(cl.visibility || "Internal")) return true;
      if (user.company_id && (cl.from_company_id === user.company_id || cl.to_company_id === user.company_id)) return true;
      return false;
    }
    if (user.role === "Subcontractor") {
      if (user.work_package_id && cl.work_package_id === user.work_package_id) return true;
      if (user.company_id && (cl.from_company_id === user.company_id || cl.to_company_id === user.company_id)) return true;
      if (cl.raised_by === user.name) return true;
      const isOwner = db.prepare("SELECT 1 FROM record_owners WHERE module='clarifications' AND record_id=? AND user_id=?").get(cl.id, user.user_id);
      return Boolean(isOwner);
    }
    return false;
  };

  app.get("/api/clarifications/:id", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM clarifications WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Clarification not found" });
        return;
      }
      if (!checkClarificationAccess(req.user!, existing)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const comments = db.prepare("SELECT * FROM clarification_comments WHERE clarification_id=? ORDER BY created_at ASC").all(req.params.id).map(rowToDict);
      res.json({
        ...rowToDict(existing),
        comments,
        messages: comments
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/clarifications/:id", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM clarifications WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Clarification not found" });
        return;
      }
      if (!checkClarificationAccess(req.user!, existing)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        const isOwner = db.prepare("SELECT 1 FROM record_owners WHERE module='clarifications' AND record_id=? AND user_id=?").get(req.params.id, req.user!.user_id);
        if (!isOwner && existing.raised_by !== req.user!.name) {
          res.status(403).json({ error: "Only the author or contractor team may update this clarification" });
          return;
        }
      }
      const data = req.body || {};
      const now = new Date().toISOString();
      const updatedStatus = data.status || existing.status;
      const officialResponse = data.official_response !== undefined ? data.official_response : existing.official_response;
      const respondedBy = officialResponse ? (existing.responded_by || req.user!.name) : existing.responded_by;
      const respondedAt = officialResponse ? (existing.responded_at || now) : existing.responded_at;

      let visibility = existing.visibility;
      if (data.visibility !== undefined) {
        if (req.user!.role === "Admin" || req.user!.role === "ProjectManager") {
          visibility = data.visibility;
        }
      }

      db.prepare(`
        UPDATE clarifications
        SET title=?, type=?, discipline=?, priority=?, status=?, official_response=?,
            responded_by=?, responded_at=?, due_date=?, visibility=?, question_text=?, proposed_solution=?
        WHERE id=?
      `).run(
        data.title ?? existing.title,
        data.type ?? existing.type,
        data.discipline ?? existing.discipline,
        data.priority ?? existing.priority,
        updatedStatus,
        officialResponse,
        respondedBy,
        respondedAt,
        data.due_date ?? existing.due_date,
        visibility,
        data.question_text ?? (data.question ?? existing.question_text),
        data.proposed_solution ?? existing.proposed_solution,
        req.params.id
      );

      writeAudit(req.user!.user_id, "clarifications", req.params.id, existing.project_id, "update", existing, data);
      const updated = db.prepare("SELECT * FROM clarifications WHERE id=?").get(req.params.id) as any;
      res.json(rowToDict(updated));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/clarifications/:id/answer", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM clarifications WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Clarification not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id) || req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Only contractor management can submit an official answer" });
        return;
      }
      const { official_response, status } = req.body || {};
      const now = new Date().toISOString();
      const newStatus = status || "Answered";
      db.prepare(`
        UPDATE clarifications
        SET official_response=?, responded_by=?, responded_at=?, status=?
        WHERE id=?
      `).run(official_response || "", req.user!.name, now, newStatus, req.params.id);

      writeAudit(req.user!.user_id, "clarifications", req.params.id, existing.project_id, "answer", existing, { official_response, status: newStatus });
      res.json({ ok: true, id: req.params.id, status: newStatus, responded_by: req.user!.name, responded_at: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const postClarificationCommentHandler = (req: any, res: any) => {
    try {
      const existing = db.prepare("SELECT * FROM clarifications WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Clarification not found" });
        return;
      }
      if (!checkClarificationAccess(req.user!, existing)) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const text = req.body?.comment_text || req.body?.message || "";
      if (!text || !String(text).trim()) {
        res.status(400).json({ error: "Comment text is required" });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO clarification_comments (id, clarification_id, user_id, user_name, company_name, comment_text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, req.params.id, req.user!.user_id, req.user!.name, req.user!.company_name || req.user!.company || req.user!.role, text, now);

      res.status(201).json({ id, clarification_id: req.params.id, user_name: req.user!.name, comment_text: text, message: text, created_at: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
  app.post("/api/clarifications/:id/comment", authRequired, postClarificationCommentHandler);
  app.post("/api/clarifications/:id/messages", authRequired, postClarificationCommentHandler);

  app.get("/api/clarifications/:id/comments", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM clarifications WHERE id=?").get(req.params.id) as any;
      if (!existing || !checkClarificationAccess(req.user!, existing)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const rows = db.prepare("SELECT * FROM clarification_comments WHERE clarification_id=? ORDER BY created_at ASC").all(req.params.id);
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Convert Clarification to RFI (Section 16)
  app.post("/api/clarifications/:id/convert-to-rfi", authRequired, (req, res) => {
    try {
      const { id } = req.params;
      const clarification = db.prepare("SELECT * FROM clarifications WHERE id=?").get(id) as any;
      if (!clarification) {
        res.status(404).json({ error: "Clarification not found" });
        return;
      }
      if (!canAccessRecord(req.user!, clarification, "edit", "clarifications")) {
        res.status(403).json({ error: "No permission to convert this clarification" });
        return;
      }
      if (!canEdit(req.user!, "rfis")) {
        res.status(403).json({ error: "No permission to create RFIs" });
        return;
      }

      const existingRfis = db.prepare("SELECT count(*) as count FROM rfis WHERE project_id=?").get(clarification.project_id) as any;
      const rfiNum = `RFI-${String((existingRfis?.count || 0) + 1).padStart(3, "0")}`;
      const rfiId = crypto.randomUUID();
      const today = new Date().toISOString().slice(0, 10);
      const dueDate = clarification.due_date || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      db.prepare(`
        INSERT INTO rfis (id, project_id, number, subject, trade, raised_by, date_raised, due_date, status, source_clarification_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rfiId,
        clarification.project_id,
        rfiNum,
        clarification.title + ": " + clarification.question_text,
        clarification.discipline || "General",
        req.user!.name,
        today,
        dueDate,
        "Open",
        clarification.id
      );

      db.prepare("UPDATE clarifications SET status='Converted to RFI' WHERE id=?").run(id);

      const createdRfi = db.prepare("SELECT * FROM rfis WHERE id=?").get(rfiId);
      res.status(201).json({
        message: "Clarification converted to RFI successfully",
        rfi: createdRfi,
        clarification_id: clarification.id
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Convert Clarification to Potential Variation (Section 16)
  app.post("/api/clarifications/:id/convert-to-variation", authRequired, (req, res) => {
    try {
      const { id } = req.params;
      const clarification = db.prepare("SELECT * FROM clarifications WHERE id=?").get(id) as any;
      if (!clarification) {
        res.status(404).json({ error: "Clarification not found" });
        return;
      }
      if (!canAccessRecord(req.user!, clarification, "edit", "clarifications")) {
        res.status(403).json({ error: "No permission to convert this clarification" });
        return;
      }
      if (!canEdit(req.user!, "change_orders")) {
        res.status(403).json({ error: "No permission to create Change Orders / Variations" });
        return;
      }

      const existingCos = db.prepare("SELECT count(*) as count FROM change_orders WHERE project_id=?").get(clarification.project_id) as any;
      const coNum = `VO-${String((existingCos?.count || 0) + 1).padStart(3, "0")}`;
      const coId = crypto.randomUUID();
      const today = new Date().toISOString().slice(0, 10);

      db.prepare(`
        INSERT INTO change_orders (id, project_id, number, title, trade, reason, cost_impact, schedule_impact_days, date_raised, status, source_clarification_id, visibility)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        coId,
        clarification.project_id,
        coNum,
        clarification.title,
        clarification.discipline || "General",
        clarification.question_text + (clarification.proposed_solution ? `\nProposed Solution: ${clarification.proposed_solution}` : ""),
        req.body?.cost_impact || 0,
        req.body?.schedule_impact_days || 0,
        today,
        "Potential Variation",
        clarification.id,
        "Internal"
      );

      db.prepare("UPDATE clarifications SET status='Converted to Variation' WHERE id=?").run(id);

      const createdCo = db.prepare("SELECT * FROM change_orders WHERE id=?").get(coId);
      res.status(201).json({
        message: "Clarification converted to Variation successfully",
        variation: createdCo,
        clarification_id: clarification.id
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- PUBLISHED PROGRESS REPORTS (CLIENT VISIBILITY CONTROL) ---
  app.get("/api/progress_reports", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Subcontractor") {
        res.json([]);
        return;
      }
      const projectId = req.query.project_id as string;
      let { where, params } = projectScopeSql(req.user!, projectId, "pr.project_id");
      if (!where) {
        res.status(403).json({ error: "No access to project" });
        return;
      }
      if (req.user!.role === "Client") {
        where += " AND pr.status IN ('Published', 'Published to Client')";
      }
      const rows = db.prepare(`
        SELECT pr.*,
          (SELECT COUNT(*) FROM progress_report_photos p WHERE p.report_id = pr.id) as photo_count
        FROM progress_reports pr
        WHERE ${where}
        ORDER BY pr.period_end DESC, pr.created_at DESC
      `).all(...params);
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/progress_reports/:id", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const report = db.prepare("SELECT * FROM progress_reports WHERE id=?").get(req.params.id) as any;
      if (!report) {
        res.status(404).json({ error: "Report not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, report.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (req.user!.role === "Client" && !["Published", "Published to Client"].includes(report.status)) {
        res.status(403).json({ error: "This report has not been published to the client" });
        return;
      }
      const photos = db.prepare("SELECT * FROM progress_report_photos WHERE report_id=? ORDER BY created_at ASC").all(req.params.id);
      res.json({ ...rowToDict(report), photos: photos.map(rowToDict) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/progress_reports/:id", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM progress_reports WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Report not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id) || req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const data = req.body || {};
      const now = new Date().toISOString();
      let updatedStatus = data.status || existing.status;
      if ((updatedStatus === "Published" || updatedStatus === "Published to Client") && req.user!.role !== "Admin" && req.user!.role !== "ProjectManager") {
        updatedStatus = existing.status;
      }
      const publishedAt = (updatedStatus === "Published" || updatedStatus === "Published to Client") ? (existing.published_at || now) : existing.published_at;
      const publishedBy = (updatedStatus === "Published" || updatedStatus === "Published to Client") ? (existing.published_by || req.user!.name) : existing.published_by;

      db.prepare(`
        UPDATE progress_reports
        SET title=?, period_start=?, period_end=?, status=?, executive_summary=?,
            overall_progress_percent=?, planned_progress_percent=?, milestone_summary=?,
            hvac_progress=?, electrical_progress=?, plumbing_progress=?, fire_progress=?, bms_progress=?,
            safety_summary=?, manpower_peak=?, lookahead_narrative=?, key_risks_issues=?,
            published_at=?, published_by=?
        WHERE id=?
      `).run(
        data.title ?? existing.title,
        data.period_start ?? existing.period_start,
        data.period_end ?? existing.period_end,
        updatedStatus,
        data.executive_summary ?? existing.executive_summary,
        data.overall_progress_percent !== undefined ? parseImportNumber(data.overall_progress_percent) : (data.overall_progress_actual !== undefined ? parseImportNumber(data.overall_progress_actual) : existing.overall_progress_percent),
        data.planned_progress_percent !== undefined ? parseImportNumber(data.planned_progress_percent) : (data.overall_progress_planned !== undefined ? parseImportNumber(data.overall_progress_planned) : existing.planned_progress_percent),
        data.milestone_summary ?? existing.milestone_summary,
        data.hvac_progress !== undefined ? parseImportNumber(data.hvac_progress) : existing.hvac_progress,
        data.electrical_progress !== undefined ? parseImportNumber(data.electrical_progress) : existing.electrical_progress,
        data.plumbing_progress !== undefined ? parseImportNumber(data.plumbing_progress) : existing.plumbing_progress,
        data.fire_progress !== undefined ? parseImportNumber(data.fire_progress) : existing.fire_progress,
        data.bms_progress !== undefined ? parseImportNumber(data.bms_progress) : existing.bms_progress,
        data.safety_summary ?? existing.safety_summary,
        data.manpower_peak !== undefined ? parseInt(data.manpower_peak) : existing.manpower_peak,
        data.lookahead_narrative ?? existing.lookahead_narrative,
        data.key_risks_issues ?? existing.key_risks_issues,
        publishedAt,
        publishedBy,
        req.params.id
      );

      writeAudit(req.user!.user_id, "progress_reports", req.params.id, existing.project_id, "update", existing, data);
      const updated = db.prepare("SELECT * FROM progress_reports WHERE id=?").get(req.params.id) as any;
      res.json(rowToDict(updated));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Consolidated transactional publication & revision routes
  registerProgressRoutes(app, db, authRequired, hasProjectAccess, writeAudit);

  // Auto-compile live project data into a draft progress report
  app.post("/api/progress_reports/auto-compile", authRequired, (req, res) => {
    try {
      const { project_id, period_start, period_end } = req.body || {};
      if (!project_id || !hasProjectAccess(req.user!, project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Contractor management role required" });
        return;
      }

      const tasks = db.prepare("SELECT * FROM tasks WHERE project_id=?").all(project_id) as any[];
      const workTasks = tasks.filter(t => !t.is_milestone && !t.is_summary);
      const overall = workTasks.length
        ? Math.round(workTasks.reduce((acc, t) => acc + (t.progress || 0), 0) / workTasks.length)
        : 0;

      const calcDiscipline = (kw: string) => {
        const matching = workTasks.filter(t => (t.trade || "").toLowerCase().includes(kw) || (t.title || "").toLowerCase().includes(kw));
        return matching.length ? Math.round(matching.reduce((acc, t) => acc + (t.progress || 0), 0) / matching.length) : 0;
      };

      const hvacProg = calcDiscipline("hvac") || calcDiscipline("duct") || calcDiscipline("mech") || overall;
      const elecProg = calcDiscipline("elec") || calcDiscipline("cable") || calcDiscipline("light") || overall;
      const plumbProg = calcDiscipline("plumb") || calcDiscipline("pipe") || calcDiscipline("drain") || overall;
      const fireProg = calcDiscipline("fire") || calcDiscipline("sprinkler") || overall;
      const bmsProg = calcDiscipline("bms") || calcDiscipline("elv") || calcDiscipline("control") || overall;

      const logs = db.prepare("SELECT * FROM dailylogs WHERE project_id=?").all(project_id) as any[];
      const peakWorkers = logs.reduce((max, l) => Math.max(max, l.workers_count || 0), 0) || 28;

      const punchOpen = db.prepare("SELECT COUNT(*) as c FROM punchlist WHERE project_id=? AND status!='Closed'").get(project_id) as any;
      const incidents = db.prepare("SELECT COUNT(*) as c FROM safety_incidents WHERE project_id=?").get(project_id) as any;

      const countReports = (db.prepare("SELECT COUNT(*) as c FROM progress_reports WHERE project_id=?").get(project_id) as any)?.c || 0;
      const repNum = `MPR-${String(countReports + 1).padStart(3, "0")}`;

      const draft = {
        project_id,
        report_number: repNum,
        title: `Monthly MEP Progress Report #${countReports + 1}`,
        period_start: period_start || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
        period_end: period_end || new Date().toISOString().slice(0, 10),
        prepared_by: req.user!.name,
        status: "Draft",
        overall_progress_percent: overall,
        planned_progress_percent: Math.min(100, overall + 5),
        hvac_progress: hvacProg,
        electrical_progress: elecProg,
        plumbing_progress: plumbProg,
        fire_progress: fireProg,
        bms_progress: bmsProg,
        manpower_peak: peakWorkers,
        executive_summary: `Overall MEP installation across all floors has reached ${overall}% completion. First-fix containment and mechanical piping continue on schedule.`,
        milestone_summary: `Key containment and plant room primary equipment positioning completed successfully.`,
        safety_summary: `Zero lost time injuries (LTI). ${incidents?.c || 0} safety observations logged and resolved.`,
        lookahead_narrative: `Focus for the upcoming period is completion of primary duct risers, cable pulling, and secondary branch hydrostatic pressure testing.`,
        key_risks_issues: punchOpen?.c > 0 ? `${punchOpen.c} open snags currently monitored for consultant inspection walk.` : `No critical commercial or technical blockers at this stage.`
      };

      res.json(draft);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/progress_reports", authRequired, (req, res) => {
    try {
      const data = req.body || {};
      if (!data.project_id || !hasProjectAccess(req.user!, data.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO progress_reports (
          id, project_id, report_number, title, period_start, period_end, prepared_by, status,
          executive_summary, overall_progress_percent, planned_progress_percent, milestone_summary,
          hvac_progress, electrical_progress, plumbing_progress, fire_progress, bms_progress,
          safety_summary, manpower_peak, lookahead_narrative, key_risks_issues, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.project_id,
        data.report_number || `PR-${Date.now().toString().slice(-4)}`,
        data.title || "Progress Report",
        data.period_start || "",
        data.period_end || "",
        req.user!.name,
        data.status || "Draft",
        data.executive_summary || "",
        parseImportNumber(data.overall_progress_percent),
        parseImportNumber(data.planned_progress_percent),
        data.milestone_summary || "",
        parseImportNumber(data.hvac_progress),
        parseImportNumber(data.electrical_progress),
        parseImportNumber(data.plumbing_progress),
        parseImportNumber(data.fire_progress),
        parseImportNumber(data.bms_progress),
        data.safety_summary || "",
        parseInt(data.manpower_peak) || 0,
        data.lookahead_narrative || "",
        data.key_risks_issues || "",
        now
      );
      writeAudit(req.user!.user_id, "progress_reports", id, data.project_id, "create", null, data);
      res.status(201).json({ id, ...data, created_at: now });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/progress_reports/:id/photos", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const report = db.prepare("SELECT * FROM progress_reports WHERE id=?").get(req.params.id) as any;
      if (!report || !hasProjectAccess(req.user!, report.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const { title, caption, trade, location, photo_data } = req.body || {};
      if (!photo_data) {
        res.status(400).json({ error: "Photo data required" });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO progress_report_photos (id, report_id, title, caption, trade, location, photo_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, req.params.id, title || "Site Progress Photo", caption || "", trade || "MEP", location || "", photo_data, now);
      res.status(201).json({ id, report_id: req.params.id, title, caption, trade, location, created_at: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/progress_reports/photos/:photoId", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const photo = db.prepare("SELECT * FROM progress_report_photos WHERE id=?").get(req.params.photoId) as any;
      if (!photo) {
        res.status(404).json({ error: "Photo not found" });
        return;
      }
      const report = db.prepare("SELECT * FROM progress_reports WHERE id=?").get(photo.report_id) as any;
      if (!report || !hasProjectAccess(req.user!, report.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      db.prepare("DELETE FROM progress_report_photos WHERE id=?").run(req.params.photoId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- DOCUMENT REVISION CONTROL & TRANSMITTALS ---
  app.get("/api/documents/:id/revisions", authRequired, (req, res) => {
    try {
      const doc = db.prepare("SELECT * FROM documents WHERE id=?").get(req.params.id) as any;
      if (!doc || !hasProjectAccess(req.user!, doc.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (req.user!.role === "Client" && !["Client", "All"].includes(doc.visibility || "Internal")) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (req.user!.role === "Subcontractor") {
        const isOwner = db.prepare("SELECT 1 FROM record_owners WHERE module='documents' AND record_id=? AND user_id=?").get(doc.id, req.user!.user_id);
        const isAssigned = doc.subcontractor_id === req.user!.user_id;
        if (!isOwner && !isAssigned) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
      }
      const rows = db.prepare("SELECT * FROM document_revisions WHERE document_id=? ORDER BY created_at DESC").all(req.params.id);
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/documents/:id/new-revision", authRequired, (req, res) => {
    try {
      const doc = db.prepare("SELECT * FROM documents WHERE id=?").get(req.params.id) as any;
      if (!doc) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, doc.project_id) || !canEdit(req.user!, "documents")) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const newRevisionCode = req.body?.new_revision_code || req.body?.revision;
      const changeSummary = req.body?.change_summary || req.body?.notes;
      const attachmentName = req.body?.attachment_name;
      const attachmentData = req.body?.attachment_data;
      if (!newRevisionCode) {
        res.status(400).json({ error: "New revision code is required" });
        return;
      }
      const now = new Date().toISOString();
      const today = now.slice(0, 10);

      // Archive previous version
      const revId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO document_revisions (id, document_id, project_id, revision_code, superseded_date, changed_by, change_summary, attachment_name, attachment_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        revId,
        doc.id,
        doc.project_id,
        doc.revision || "Rev A",
        today,
        req.user!.name,
        changeSummary || "Superseded by " + newRevisionCode,
        doc.attachment_name || "",
        doc.attachment_data || "",
        now
      );

      // Update current document record
      db.prepare(`
        UPDATE documents
        SET revision=?, date_added=?, attachment_name=?, attachment_data=?, status='Approved'
        WHERE id=?
      `).run(
        newRevisionCode,
        today,
        attachmentName || doc.attachment_name,
        attachmentData || doc.attachment_data,
        doc.id
      );

      writeAudit(req.user!.user_id, "documents", doc.id, doc.project_id, "new_revision", { old_rev: doc.revision }, { new_rev: newRevisionCode, change_summary: changeSummary });
      res.status(201).json({ ok: true, document_id: doc.id, revision: newRevisionCode, superseded_revision_id: revId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Transmittals (both /api/document_transmittals and /api/transmittals)
  const getTransmittalsHandler = (req: any, res: any) => {
    try {
      const projectId = req.query.project_id as string;
      let { where, params } = projectScopeSql(req.user!, projectId, "dt.project_id");
      if (!where) {
        res.status(403).json({ error: "No access to project" });
        return;
      }
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        if (req.user!.company_id) {
          where += " AND (dt.sender_company_id = ? OR dt.recipient_company_id = ?)";
          params.push(req.user!.company_id, req.user!.company_id);
        } else {
          where += " AND (dt.sender_company_id IS NULL AND dt.recipient_company_id IS NULL)";
        }
      }
      const rows = db.prepare(`
        SELECT dt.*,
          sc.name as sender_company_name,
          rc.name as recipient_company_name,
          (SELECT COUNT(*) FROM transmittal_items ti WHERE ti.transmittal_id = dt.id) as items_count
        FROM document_transmittals dt
        LEFT JOIN companies sc ON sc.id = dt.sender_company_id
        LEFT JOIN companies rc ON rc.id = dt.recipient_company_id
        WHERE ${where}
        ORDER BY dt.date_sent DESC, dt.created_at DESC
      `).all(...params);
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
  app.get("/api/document_transmittals", authRequired, getTransmittalsHandler);
  app.get("/api/transmittals", authRequired, getTransmittalsHandler);

  const getTransmittalByIdHandler = (req: any, res: any) => {
    try {
      const transmittal = db.prepare("SELECT * FROM document_transmittals WHERE id=?").get(req.params.id) as any;
      if (!transmittal || !hasProjectAccess(req.user!, transmittal.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        if (!req.user!.company_id || (transmittal.sender_company_id !== req.user!.company_id && transmittal.recipient_company_id !== req.user!.company_id)) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
      }
      const items = db.prepare("SELECT * FROM transmittal_items WHERE transmittal_id=?").all(req.params.id);
      res.json({ ...rowToDict(transmittal), items: items.map(rowToDict) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
  app.get("/api/document_transmittals/:id", authRequired, getTransmittalByIdHandler);
  app.get("/api/transmittals/:id", authRequired, getTransmittalByIdHandler);

  const postTransmittalHandler = (req: any, res: any) => {
    try {
      const data = req.body || {};
      if (!data.project_id || !hasProjectAccess(req.user!, data.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if ((req.user!.role === "Client" || req.user!.role === "Subcontractor") && req.user!.company_id) {
        data.sender_company_id = req.user!.company_id;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const count = (db.prepare("SELECT COUNT(*) as c FROM document_transmittals WHERE project_id=?").get(data.project_id) as any)?.c || 0;
      const num = data.transmittal_number || `TRN-${String(count + 1).padStart(3, "0")}`;

      db.prepare(`
        INSERT INTO document_transmittals (id, project_id, transmittal_number, sender_company_id, recipient_company_id, subject, purpose, date_sent, due_date, status, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.project_id,
        num,
        data.sender_company_id || null,
        data.recipient_company_id || null,
        data.subject || "Document Transmittal",
        data.purpose || "For Approval",
        data.date_sent || now.slice(0, 10),
        data.due_date || "",
        data.status || "Transmitted",
        data.notes || "",
        now
      );

      if (Array.isArray(data.items)) {
        const insItem = db.prepare(`
          INSERT INTO transmittal_items (id, transmittal_id, document_id, document_title, document_number, revision, format, status, action_required, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of data.items) {
          insItem.run(
            crypto.randomUUID(),
            id,
            item.document_id || null,
            item.document_title || item.name || "Drawing",
            item.document_number || "",
            item.revision || "Rev A",
            item.format || "PDF",
            "Transmitted",
            item.action_required || "Review & Approve",
            item.notes || ""
          );
        }
      }

      writeAudit(req.user!.user_id, "transmittals", id, data.project_id, "create", null, data);
      res.status(201).json({ id, transmittal_number: num, ...data, created_at: now });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  };
  app.post("/api/document_transmittals", authRequired, postTransmittalHandler);
  app.post("/api/transmittals", authRequired, postTransmittalHandler);

  // --- SUBCONTRACTOR PROGRESS SUBMISSION & VERIFICATION WORKFLOW ---
  app.get("/api/progress_submissions", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client") {
        res.status(403).json({ error: "Access denied: subcontractor submissions are internal" });
        return;
      }
      const projectId = req.query.project_id as string;
      let { where, params } = projectScopeSql(req.user!, projectId, "ps.project_id");
      if (!where) {
        res.status(403).json({ error: "No access to project" });
        return;
      }
      if (req.user!.role === "Subcontractor") {
        const subConds: string[] = [];
        const subParams: any[] = [];
        if (req.user!.work_package_id) {
          subConds.push("ps.work_package_id = ?");
          subParams.push(req.user!.work_package_id);
        }
        if (req.user!.company_id) {
          subConds.push("ps.company_id = ?");
          subParams.push(req.user!.company_id);
        }
        subConds.push("ps.submitted_by = ?");
        subParams.push(req.user!.name);
        where += ` AND (${subConds.join(" OR ")})`;
        params.push(...subParams);
      }
      const rows = db.prepare(`
        SELECT ps.*,
          wp.name as work_package_name,
          wp.code as work_package_code,
          c.name as company_name
        FROM progress_submissions ps
        LEFT JOIN work_packages wp ON wp.id = ps.work_package_id
        LEFT JOIN companies c ON c.id = ps.company_id
        WHERE ${where}
        ORDER BY ps.created_at DESC
      `).all(...params);
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/progress_submissions/:id", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client") {
        res.status(403).json({ error: "Access denied: subcontractor submissions are internal" });
        return;
      }
      const submission = db.prepare(`
        SELECT ps.*, wp.name as work_package_name
        FROM progress_submissions ps
        LEFT JOIN work_packages wp ON wp.id = ps.work_package_id
        WHERE ps.id = ?
      `).get(req.params.id) as any;

      if (!submission) {
        res.status(404).json({ error: "Submission not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, submission.project_id)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      if (req.user!.role === "Subcontractor") {
        const isWpMatch = !req.user!.work_package_id || req.user!.work_package_id === submission.work_package_id;
        const isCoMatch = !req.user!.company_id || req.user!.company_id === submission.company_id;
        const isAuthor = submission.submitted_by === req.user!.name;
        if (!isWpMatch || !isCoMatch || !isAuthor) {
          res.status(403).json({ error: "Forbidden: no access to this submission" });
          return;
        }
      }
      res.json(rowToDict(submission));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/progress_submissions", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client") {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const data = req.body || {};
      if (!data.project_id || !hasProjectAccess(req.user!, data.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      let wpId = data.work_package_id || null;
      let compId = data.company_id || null;
      if (req.user!.role === "Subcontractor") {
        if (req.user!.work_package_id && data.work_package_id && data.work_package_id !== req.user!.work_package_id) {
          res.status(403).json({ error: "Cannot submit progress for another work package" });
          return;
        }
        if (req.user!.company_id && data.company_id && data.company_id !== req.user!.company_id) {
          res.status(403).json({ error: "Cannot submit progress for another company" });
          return;
        }
        wpId = req.user!.work_package_id || wpId;
        compId = req.user!.company_id || compId;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const claimedVal = data.claimed_percent !== undefined ? data.claimed_percent : data.claimed_percentage;
      db.prepare(`
        INSERT INTO progress_submissions (
          id, project_id, work_package_id, company_id, submitted_by, period_date,
          discipline, claimed_percent, quantity_installed, unit, notes, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Submitted', ?)
      `).run(
        id,
        data.project_id,
        wpId,
        compId,
        req.user!.name,
        data.period_date || now.slice(0, 10),
        data.discipline || "MEP",
        parseImportNumber(claimedVal),
        parseImportNumber(data.quantity_installed),
        data.unit || "%",
        data.notes || "",
        now
      );
      writeAudit(req.user!.user_id, "progress_submissions", id, data.project_id, "submit", null, data);
      res.status(201).json({ id, ...data, work_package_id: wpId, company_id: compId, claimed_percent: parseImportNumber(claimedVal), status: "Submitted", created_at: now });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/progress_submissions/:id", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM progress_submissions WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Submission not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id) || (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager" && req.user!.role !== "SiteEngineer")) {
        res.status(403).json({ error: "Only Project Managers or Site Engineers can review progress submissions" });
        return;
      }
      const data = req.body || {};
      const now = new Date().toISOString();
      const finalStatus = data.status || existing.status;
      const rawAdj = data.verified_percentage !== undefined ? data.verified_percentage : (data.verified_percent !== undefined ? data.verified_percent : data.adjusted_percent);
      const finalPercent = rawAdj !== undefined ? parseImportNumber(rawAdj) : (existing.adjusted_percent || existing.claimed_percent);
      const reviewComments = data.review_comments !== undefined ? data.review_comments : existing.review_comments;

      db.prepare(`
        UPDATE progress_submissions
        SET status=?, adjusted_percent=?, reviewed_by=?, review_comments=?, approved_at=?
        WHERE id=?
      `).run(finalStatus, finalPercent, req.user!.name, reviewComments || "", now, req.params.id);

      if ((finalStatus === "Approved" || finalStatus === "Approved with Adjustments") && existing.work_package_id) {
        db.prepare(`
          UPDATE tasks
          SET progress = MAX(progress, ?)
          WHERE work_package_id = ? AND status != 'Completed'
        `).run(finalPercent, existing.work_package_id);
      }

      writeAudit(req.user!.user_id, "progress_submissions", req.params.id, existing.project_id, "update", existing, data);
      const updated = db.prepare("SELECT * FROM progress_submissions WHERE id=?").get(req.params.id) as any;
      res.json({
        ...rowToDict(updated),
        verified_percentage: updated.adjusted_percent,
        verified_percent: updated.adjusted_percent
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/progress_submissions/:id/review", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM progress_submissions WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Submission not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id) || (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager" && req.user!.role !== "SiteEngineer")) {
        res.status(403).json({ error: "Only Project Managers or Site Engineers can review progress submissions" });
        return;
      }
      const { status, adjusted_percent, review_comments } = req.body || {};
      const now = new Date().toISOString();
      const finalStatus = status || "Approved";
      const finalPercent = adjusted_percent !== undefined ? parseImportNumber(adjusted_percent) : existing.claimed_percent;

      db.prepare(`
        UPDATE progress_submissions
        SET status=?, adjusted_percent=?, reviewed_by=?, review_comments=?, approved_at=?
        WHERE id=?
      `).run(finalStatus, finalPercent, req.user!.name, review_comments || "", now, req.params.id);

      if ((finalStatus === "Approved" || finalStatus === "Approved with Adjustments") && existing.work_package_id) {
        db.prepare(`
          UPDATE tasks
          SET progress = MAX(progress, ?)
          WHERE work_package_id = ? AND status != 'Completed'
        `).run(finalPercent, existing.work_package_id);
      }

      writeAudit(req.user!.user_id, "progress_submissions", req.params.id, existing.project_id, "review", existing, { status: finalStatus, adjusted_percent: finalPercent, review_comments });
      res.json({ ok: true, id: req.params.id, status: finalStatus, adjusted_percent: finalPercent, reviewed_by: req.user!.name });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/progress_submissions/:id/verify", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM progress_submissions WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Submission not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id) || (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager" && req.user!.role !== "SiteEngineer")) {
        res.status(403).json({ error: "Only Project Managers or Site Engineers can verify progress submissions" });
        return;
      }
      const data = req.body || {};
      const now = new Date().toISOString();
      const rawAdj = data.verified_percent !== undefined ? data.verified_percent : (data.verified_percentage !== undefined ? data.verified_percentage : data.adjusted_percent);
      const finalPercent = rawAdj !== undefined ? parseImportNumber(rawAdj) : existing.claimed_percent;
      const reviewComments = data.verification_notes || data.review_comments || "";

      db.prepare(`
        UPDATE progress_submissions
        SET status='Approved with Adjustments', adjusted_percent=?, reviewed_by=?, review_comments=?, approved_at=?
        WHERE id=?
      `).run(finalPercent, req.user!.name, reviewComments, now, req.params.id);

      if (existing.work_package_id) {
        db.prepare(`
          UPDATE tasks
          SET progress = MAX(progress, ?)
          WHERE work_package_id = ? AND status != 'Completed'
        `).run(finalPercent, existing.work_package_id);
      }

      writeAudit(req.user!.user_id, "progress_submissions", req.params.id, existing.project_id, "verify", existing, data);
      const updated = db.prepare("SELECT * FROM progress_submissions WHERE id=?").get(req.params.id) as any;
      res.json({
        ...rowToDict(updated),
        verified_percent: updated.adjusted_percent,
        verified_percentage: updated.adjusted_percent
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/projects/:id/client-summary", authRequired, (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      if (!hasProjectAccess(req.user!, projectId)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      if (req.user!.role !== "Client") {
        res.status(403).json({ error: "This endpoint is for the Client Portal only" });
        return;
      }
      const project = db.prepare("SELECT id, name, client, status, start_date, end_date FROM projects WHERE id=?").get(projectId) as any;
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Overall progress for Client is taken strictly from the latest Published Progress Report to ensure vetted verification
      const latestPublishedReport = db.prepare(`
        SELECT overall_progress_percent FROM progress_reports
        WHERE project_id = ? AND status IN ('Published', 'Published to Client')
        ORDER BY period_end DESC, published_at DESC LIMIT 1
      `).get(projectId) as any;

      const hasPublishedReport = Boolean(latestPublishedReport && latestPublishedReport.overall_progress_percent !== undefined && latestPublishedReport.overall_progress_percent !== null);
      const overallProgress = hasPublishedReport ? latestPublishedReport.overall_progress_percent : null;
      const progressStatus = hasPublishedReport ? "Published" : "Progress not yet published";

      const tasks = db.prepare("SELECT * FROM tasks WHERE project_id=?").all(projectId) as any[];
      const today = new Date().toISOString().slice(0, 10);
      const upcomingMilestones = tasks
        .filter(t => t.is_milestone && t.end >= today)
        .sort((a, b) => (a.end > b.end ? 1 : -1));
      const nextMilestone = upcomingMilestones[0]
        ? { title: upcomingMilestones[0].title, date: upcomingMilestones[0].end }
        : null;

      const publishedDocuments = db.prepare(
        "SELECT id, name, category, revision, date_added, published_at FROM documents WHERE project_id=? AND visibility IN ('Client','All') ORDER BY published_at DESC"
      ).all(projectId);
      const publishedChangeOrders = db.prepare(
        "SELECT id, number, title, cost_impact, schedule_impact_days, status, published_at FROM change_orders WHERE project_id=? AND visibility IN ('Client','All') ORDER BY published_at DESC"
      ).all(projectId);
      const decisionsAwaiting = (publishedChangeOrders as any[]).filter(
        co => !["Approved", "Rejected", "Certified", "Closed"].includes(co.status)
      ).length;

      res.json({
        project: { id: project.id, name: project.name, client: project.client, status: project.status, start_date: project.start_date, end_date: project.end_date },
        overall_progress: overallProgress,
        overall_progress_percent: overallProgress,
        progress_status: progressStatus,
        next_milestone: nextMilestone,
        published_documents: publishedDocuments,
        published_change_orders: publishedChangeOrders,
        open_client_items: { decisions_required: decisionsAwaiting, documents_published: (publishedDocuments as any[]).length },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // =====================================================================
  // PROJECT UPDATES & LIVE PROGRESS FEED API
  // =====================================================================

  app.get('/api/project_updates', authRequired, (req, res) => {
    if (!canView(req.user!, 'project_updates')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const category = req.query.category as string;
    const trade = req.query.trade as string;
    const { where, params } = projectScopeSql(req.user!, projectId);
    if (!where) { res.status(403).json({ error: 'No project access' }); return; }
    let sql = `SELECT u.*, p.name as project_name FROM project_updates u LEFT JOIN projects p ON p.id = u.project_id WHERE ${where}`;
    if (category && category !== 'All') { sql += ' AND u.category = ?'; params.push(category); }
    if (trade && trade !== 'All') { sql += ' AND u.trade = ?'; params.push(trade); }
    sql += ' ORDER BY u.pinned DESC, u.created_at DESC';
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  });

  app.post('/api/project_updates', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'project_updates')) { res.status(403).json({ error: 'No edit access' }); return; }
    const { project_id, title, category, content, progress_percent, trade, work_package_id, weather, location, pinned, attachment_data, attachment_name } = req.body || {};
    if (!project_id || !title || !content) {
      res.status(400).json({ error: 'project_id, title, and content are required' });
      return;
    }
    if (!hasProjectAccess(req.user!, project_id)) {
      res.status(403).json({ error: 'No access to this project' });
      return;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const authorName = req.user!.name || 'Site Engineer';
    const prg = (progress_percent !== undefined && progress_percent !== null && progress_percent !== '') ? parseInt(String(progress_percent), 10) : null;

    db.prepare(`
      INSERT INTO project_updates (
        id, project_id, title, category, content, progress_percent, trade,
        work_package_id, weather, location, pinned, attachment_data, attachment_name,
        created_by, created_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, project_id, title, category || 'Site Progress', content,
      prg, trade || null, work_package_id || null, weather || null, location || null,
      pinned ? 1 : 0, attachment_data || null, attachment_name || null,
      req.user!.user_id, authorName, now
    );

    if (prg !== null && (req.user!.role === 'Admin' || req.user!.role === 'ProjectManager')) {
      try {
        db.prepare('UPDATE projects SET progress=? WHERE id=?').run(prg, project_id);
      } catch {}
    }

    try {
      const members = db.prepare('SELECT DISTINCT user_id FROM project_memberships WHERE project_id=? AND user_id != ?').all(project_id, req.user!.user_id) as any[];
      for (const m of members) {
        createNotification(
          m.user_id, project_id, 'project_updates', id,
          `Project Update: ${title}`,
          `${authorName} posted a new ${category || 'update'}: "${title}"`
        );
      }
    } catch {}

    writeAudit(req.user!.user_id, 'project_updates', id, project_id, 'create', null, { title, category });
    res.status(201).json(db.prepare('SELECT * FROM project_updates WHERE id=?').get(id));
  });

  app.get('/api/project_updates/:id', authRequired, (req, res) => {
    if (!canView(req.user!, 'project_updates')) { res.status(403).json({ error: 'No access' }); return; }
    const update = db.prepare('SELECT u.*, p.name as project_name FROM project_updates u LEFT JOIN projects p ON p.id = u.project_id WHERE u.id=?').get(req.params.id) as any;
    if (!update) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, update.project_id)) { res.status(403).json({ error: 'No access' }); return; }
    res.json(update);
  });

  app.delete('/api/project_updates/:id', authRequired, (req, res) => {
    const update = db.prepare('SELECT * FROM project_updates WHERE id=?').get(req.params.id) as any;
    if (!update) { res.status(404).json({ error: 'Not found' }); return; }
    if (req.user!.role !== 'Admin' && update.created_by !== req.user!.user_id) {
      res.status(403).json({ error: 'Only Admin or update creator can delete' });
      return;
    }
    db.prepare('DELETE FROM project_updates WHERE id=?').run(req.params.id);
    writeAudit(req.user!.user_id, 'project_updates', req.params.id, update.project_id, 'delete', update, null);
    res.json({ ok: true });
  });

  app.get('/api/projects/:id/feed', authRequired, (req, res) => {
    const projectId = req.params.id;
    if (!hasProjectAccess(req.user!, projectId)) {
      res.status(403).json({ error: 'No access to this project' });
      return;
    }
    const feed: any[] = [];

    try {
      const updates = db.prepare('SELECT * FROM project_updates WHERE project_id=? ORDER BY created_at DESC LIMIT 30').all(projectId) as any[];
      for (const u of updates) {
        feed.push({
          id: u.id,
          type: 'update',
          category: u.category || 'Site Progress',
          title: u.title,
          content: u.content,
          progress_percent: u.progress_percent,
          trade: u.trade,
          weather: u.weather,
          location: u.location,
          author: u.created_by_name || 'Team Member',
          created_at: u.created_at,
          attachment_data: u.attachment_data,
          attachment_name: u.attachment_name,
        });
      }
    } catch {}

    try {
      const reports = db.prepare('SELECT * FROM progress_reports WHERE project_id=? ORDER BY created_at DESC LIMIT 10').all(projectId) as any[];
      for (const r of reports) {
        feed.push({
          id: r.id,
          type: 'report',
          category: 'Progress Report',
          title: r.title || `Progress Report: ${r.report_date || r.created_at?.slice(0, 10)}`,
          content: r.executive_summary || 'Formal progress report compiled and issued.',
          progress_percent: r.overall_progress_percent,
          author: 'Project Manager',
          created_at: r.created_at,
          status: r.status,
        });
      }
    } catch {}

    try {
      const logs = db.prepare('SELECT * FROM dailylogs WHERE project_id=? ORDER BY log_date DESC LIMIT 15').all(projectId) as any[];
      for (const l of logs) {
        feed.push({
          id: l.id,
          type: 'dailylog',
          category: 'Daily Site Log',
          title: `Site Log: ${l.log_date || l.date || 'Site Entry'} (${l.trade || 'All Trades'})`,
          content: [l.work_performed, l.delays ? `Delays: ${l.delays}` : '', l.safety_incidents ? `Safety: ${l.safety_incidents}` : ''].filter(Boolean).join(' • ') || 'Work recorded for site.',
          crew: l.crew || l.workers_count,
          weather: l.weather,
          trade: l.trade,
          author: 'Site Team',
          created_at: l.log_date ? `${l.log_date}T18:00:00.000Z` : l.created_at || new Date().toISOString(),
        });
      }
    } catch {}

    try {
      const milestones = db.prepare("SELECT * FROM tasks WHERE project_id=? AND is_milestone=1 AND status IN ('Completed', 'Closed') ORDER BY end DESC LIMIT 10").all(projectId) as any[];
      for (const m of milestones) {
        feed.push({
          id: m.id,
          type: 'milestone',
          category: 'Milestone Completed',
          title: `Milestone Achieved: ${m.title}`,
          content: `Trade: ${m.trade || 'General'} • Target Date: ${m.end || m.start || 'Achieved'}`,
          progress_percent: 100,
          trade: m.trade,
          author: 'Project Management',
          created_at: m.end ? `${m.end}T17:00:00.000Z` : new Date().toISOString(),
        });
      }
    } catch {}

    feed.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    res.json(feed.slice(0, 50));
  });

  app.get('/api/projects/:id/overview', authRequired, (req, res) => {
    const projectId = req.params.id;
    if (!hasProjectAccess(req.user!, projectId)) {
      res.status(403).json({ error: 'No access to this project' });
      return;
    }
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId) as any;
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const tasks = db.prepare('SELECT * FROM tasks WHERE project_id=? ORDER BY wbs_code ASC, start ASC').all(projectId) as any[];
    const workPackages = db.prepare('SELECT * FROM work_packages WHERE project_id=?').all(projectId) as any[];
    const members = db.prepare('SELECT u.id, u.name, u.role, u.email, pm.access_role FROM project_memberships pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id=?').all(projectId) as any[];
    const companies = db.prepare('SELECT c.*, pc.relationship FROM project_companies pc JOIN companies c ON c.id = pc.company_id WHERE pc.project_id=?').all(projectId) as any[];
    const recentUpdates = db.prepare('SELECT * FROM project_updates WHERE project_id=? ORDER BY created_at DESC LIMIT 6').all(projectId) as any[];
    const rfis = db.prepare('SELECT status FROM rfis WHERE project_id=?').all(projectId) as any[];
    const snags = db.prepare('SELECT status FROM punchlist WHERE project_id=?').all(projectId) as any[];
    const ncrs = db.prepare('SELECT status FROM ncrs WHERE project_id=?').all(projectId) as any[];

    const completedTasks = tasks.filter(t => ['completed', 'closed'].includes((t.status || '').toLowerCase())).length;
    const inProgressTasks = tasks.filter(t => ['in progress', 'under review'].includes((t.status || '').toLowerCase())).length;
    const avgProgress = tasks.length ? Math.round(tasks.reduce((sum, t) => sum + (t.progress || 0), 0) / tasks.length) : (project.progress || 0);

    const openSnags = snags.filter(s => !['closed', 'complete verified'].includes((s.status || '').toLowerCase())).length;
    const openRfis = rfis.filter(r => !['closed', 'answered'].includes((r.status || '').toLowerCase())).length;
    const openNcrs = ncrs.filter(n => !['closed', 'rectified'].includes((n.status || '').toLowerCase())).length;

    let health = (openNcrs > 2 || openSnags > 10) ? 'RED' : (openSnags > 0 || openRfis > 3) ? 'AMBER' : 'GREEN';

    res.json({
      project: {
        ...project,
        calculated_progress: avgProgress,
        health,
      },
      stats: {
        total_tasks: tasks.length,
        completed_tasks: completedTasks,
        in_progress_tasks: inProgressTasks,
        work_packages_count: workPackages.length,
        team_count: members.length,
        subcontractors_count: companies.length,
        open_snags: openSnags,
        open_rfis: openRfis,
        open_ncrs: openNcrs,
      },
      tasks: tasks.slice(0, 30),
      work_packages: workPackages,
      members,
      companies,
      recent_updates: recentUpdates,
    });
  });

  // --- PROJECT MASTER DETAILS & GOVERNANCE ---
  app.get('/api/projects/:id/master', authRequired, (req, res) => {
    const projectId = req.params.id;
    if (!hasProjectAccess(req.user!, projectId)) {
      res.status(403).json({ error: 'No access to this project' });
      return;
    }
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId) as any;
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const sites = db.prepare('SELECT * FROM sites WHERE project_id=? ORDER BY name').all(projectId) as any[];
    const workPackages = db.prepare(`
      SELECT wp.*, c.name as company_name, s.name as site_name
      FROM work_packages wp
      LEFT JOIN companies c ON c.id = wp.company_id
      LEFT JOIN sites s ON s.id = wp.site_id
      WHERE wp.project_id=?
      ORDER BY wp.code ASC
    `).all(projectId) as any[];
    const wbsItems = db.prepare('SELECT * FROM wbs_items WHERE project_id=? ORDER BY code ASC').all(projectId) as any[];
    const tasks = db.prepare(`
      SELECT t.*, s.name as site_name, wp.name as work_package_name, c.name as company_name, sup.name as supervisor_name, w.name as worker_name
      FROM tasks t
      LEFT JOIN sites s ON s.id = t.site_id
      LEFT JOIN work_packages wp ON wp.id = t.work_package_id
      LEFT JOIN companies c ON c.id = t.company_id
      LEFT JOIN users sup ON sup.id = t.supervisor_id
      LEFT JOIN workers w ON w.id = t.assigned_worker_id
      WHERE t.project_id=?
      ORDER BY t.wbs_code ASC, t.start ASC
    `).all(projectId) as any[];

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => ['completed', 'closed'].includes((t.status || '').toLowerCase())).length;
    const inProgressTasks = tasks.filter(t => ['in progress', 'under review'].includes((t.status || '').toLowerCase())).length;
    const blockedTasks = tasks.filter(t => (t.status || '').toLowerCase() === 'blocked').length;
    const avgProgress = totalTasks ? Math.round(tasks.reduce((sum, t) => sum + (t.progress || 0), 0) / totalTasks) : (project.progress || 0);

    let scheduleVarianceDays = 0;
    const targetEnd = project.forecast_end_date || project.end_date;
    if (project.baseline_end_date && targetEnd) {
      const baseMs = new Date(project.baseline_end_date).getTime();
      const targetMs = new Date(targetEnd).getTime();
      if (!isNaN(baseMs) && !isNaN(targetMs)) {
        scheduleVarianceDays = Math.round((targetMs - baseMs) / (1000 * 60 * 60 * 24));
      }
    }

    const trades = ['HVAC', 'Electrical', 'Plumbing', 'Fire Fighting', 'ELV'];
    const tradeDistribution: Record<string, { total: number; completed: number; in_progress: number; progress_avg: number }> = {};
    for (const tr of trades) {
      const trTasks = tasks.filter(t => (t.trade || '').toLowerCase() === tr.toLowerCase());
      const trComp = trTasks.filter(t => ['completed', 'closed'].includes((t.status || '').toLowerCase())).length;
      const trProg = trTasks.length ? Math.round(trTasks.reduce((s, t) => s + (t.progress || 0), 0) / trTasks.length) : 0;
      tradeDistribution[tr] = {
        total: trTasks.length,
        completed: trComp,
        in_progress: trTasks.filter(t => ['in progress', 'under review'].includes((t.status || '').toLowerCase())).length,
        progress_avg: trProg
      };
    }

    res.json({
      ...rowToDict(project),
      id: project.id,
      name: project.name,
      project_code: project.project_code || project.code,
      contract_value: project.contract_value ?? project.budget ?? 0,
      currency: project.currency || 'USD',
      stage: project.stage || 'Construction',
      contract_type: project.contract_type || 'Lump Sum',
      calculated_progress: avgProgress,
      schedule_variance_days: scheduleVarianceDays,
      variance_days: scheduleVarianceDays,
      sites_count: sites.length,
      work_packages_count: workPackages.length,
      tasks_count: totalTasks,
      trades_breakdown: trades.map(tr => ({
        trade: tr,
        total_tasks: tradeDistribution[tr]?.total || 0,
        completed_tasks: tradeDistribution[tr]?.completed || 0,
        in_progress: tradeDistribution[tr]?.in_progress || 0,
        avg_progress: tradeDistribution[tr]?.progress_avg || 0
      })),
      project: {
        ...project,
        project_code: project.project_code || project.code,
        contract_value: project.contract_value ?? project.budget ?? 0,
        currency: project.currency || 'USD',
        stage: project.stage || 'Construction',
        contract_type: project.contract_type || 'Lump Sum',
        calculated_progress: avgProgress,
        schedule_variance_days: scheduleVarianceDays,
        variance_days: scheduleVarianceDays,
      },
      stats: {
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
        in_progress_tasks: inProgressTasks,
        blocked_tasks: blockedTasks,
        sites_count: sites.length,
        work_packages_count: workPackages.length,
        wbs_count: wbsItems.length,
      },
      sites,
      work_packages: workPackages,
      wbs_items: wbsItems,
      trade_distribution: tradeDistribution,
    });
  });

  // --- WBS HIERARCHICAL TREE (Project -> WBS -> Work Package -> Site -> Tasks) ---
  app.get('/api/projects/:id/wbs-tree', authRequired, (req, res) => {
    const projectId = req.params.id;
    if (!hasProjectAccess(req.user!, projectId)) {
      res.status(403).json({ error: 'No access to this project' });
      return;
    }
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId) as any;
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const wbsItems = db.prepare('SELECT * FROM wbs_items WHERE project_id=? ORDER BY code ASC').all(projectId) as any[];
    const workPackages = db.prepare(`
      SELECT wp.*, c.name as company_name, s.name as site_name
      FROM work_packages wp
      LEFT JOIN companies c ON c.id = wp.company_id
      LEFT JOIN sites s ON s.id = wp.site_id
      WHERE wp.project_id=?
      ORDER BY wp.code ASC
    `).all(projectId) as any[];
    const tasks = db.prepare(`
      SELECT t.*, s.name as site_name, wp.name as work_package_name, c.name as company_name, sup.name as supervisor_name, w.name as worker_name
      FROM tasks t
      LEFT JOIN sites s ON s.id = t.site_id
      LEFT JOIN work_packages wp ON wp.id = t.work_package_id
      LEFT JOIN companies c ON c.id = t.company_id
      LEFT JOIN users sup ON sup.id = t.supervisor_id
      LEFT JOIN workers w ON w.id = t.assigned_worker_id
      WHERE t.project_id=?
      ORDER BY t.wbs_code ASC, t.start ASC
    `).all(projectId) as any[];

    const rootNodes = wbsItems.length > 0
      ? wbsItems
      : [{ id: 'wbs-root', code: 'WBS-01', name: 'General MEP Scope', discipline: 'Multi-Disciplinary' }];

    const tree = rootNodes.map(wbs => {
      const matchedPackages = workPackages.filter(wp => wp.wbs_item_id === wbs.id || (!wp.wbs_item_id && wp.discipline === wbs.discipline));
      const effectivePackages = matchedPackages.length > 0
        ? matchedPackages
        : [{ id: 'wp-gen', code: 'WP-GEN', name: 'General Package', company_name: 'Main Contractor', site_name: 'Main Site' }];

      const packagesWithTasks = effectivePackages.map(wp => {
        const pkgTasks = tasks.filter(t => t.work_package_id === wp.id || (wp.id === 'wp-gen' && (!t.work_package_id || t.wbs_code === wbs.code || t.wbs_item_id === wbs.id)));
        const totalTasks = pkgTasks.length;
        const comp = pkgTasks.filter(t => ['completed', 'closed'].includes((t.status || '').toLowerCase())).length;
        const avg = totalTasks ? Math.round(pkgTasks.reduce((s, t) => s + (t.progress || 0), 0) / totalTasks) : 0;
        return {
          ...wp,
          task_count: totalTasks,
          completed_task_count: comp,
          progress_percent: avg,
          tasks: pkgTasks
        };
      });

      const allWbsTasks = packagesWithTasks.flatMap(p => p.tasks);
      const wbsTaskCount = allWbsTasks.length;
      const wbsCompCount = allWbsTasks.filter(t => ['completed', 'closed'].includes((t.status || '').toLowerCase())).length;
      const wbsAvg = wbsTaskCount ? Math.round(allWbsTasks.reduce((s, t) => s + (t.progress || 0), 0) / wbsTaskCount) : 0;

      return {
        ...wbs,
        total_tasks: wbsTaskCount,
        completed_tasks: wbsCompCount,
        progress_percent: wbsAvg,
        work_packages: packagesWithTasks
      };
    });

    res.json({
      project_id: projectId,
      project_name: project.name,
      project_code: project.project_code || project.code,
      total_wbs_nodes: wbsItems.length,
      total_work_packages: workPackages.length,
      total_tasks: tasks.length,
      tree
    });
  });

}
