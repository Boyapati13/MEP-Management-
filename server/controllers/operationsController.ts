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
  WORKFLOW_STATUSES,
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

export function registerOperationsController(app: Express): void {
  // Project Subcontractors & Team Members
  app.get("/api/projects/:id/subcontractors", authRequired, (req, res) => {
    if (!hasProjectAccess(req.user!, req.params.id)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    // This endpoint includes login usernames because internal document owners
    // use it to assign a document to a subcontractor. External portal users
    // do not need that directory information.
    if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
      res.status(403).json({ error: "Internal project team access required" });
      return;
    }
    const rows = db.prepare(`
      SELECT u.id, u.name, u.username, pm.access_role
      FROM users u
      JOIN project_memberships pm ON pm.user_id = u.id
      WHERE pm.project_id = ? AND pm.active = 1 AND u.role = 'Subcontractor'
      ORDER BY u.name
    `).all(req.params.id);
    res.json(rows.map(rowToDict));
  });

  app.get("/api/projects/:id/members", authRequired, (req, res) => {
    // Admin-only: this returns names/usernames/roles, which is itself
    // sensitive to hand to a Subcontractor or Client. Also scoped to users
    // who actually have a membership row for this project - previously this
    // LEFT JOIN returned every user in the entire system regardless of
    // project, which was a company-wide user-directory leak.
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const rows = db.prepare(`
      SELECT u.id, u.name, u.username, u.role, pm.active, pm.access_role
      FROM project_memberships pm
      JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ?
      ORDER BY u.role, u.name
    `).all(req.params.id);
    res.json(rows.map(rowToDict));
  });

  app.put("/api/projects/:id/members", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const members = req.body?.members || [];
    for (const m of members) {
      db.prepare(`
        INSERT INTO project_memberships (user_id, project_id, access_role, active)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, project_id) DO UPDATE SET access_role=excluded.access_role, active=excluded.active
      `).run(m.user_id, req.params.id, m.access_role || "Member", m.active ? 1 : 0);
    }
    res.json({ ok: true });
  });

  // Projects Endpoints
  app.get("/api/projects", authRequired, (req, res) => {
    const { where, params } = projectScopeSql(req.user!, "ALL", "id");
    if (!where) {
      res.status(403).json({ error: "No access to projects" });
      return;
    }
    const rows = db.prepare(`SELECT * FROM projects WHERE ${where} ORDER BY name`).all(...params);
    const mapped = rows.map(r => externalRecordDto(rowToDict(r), req.user!, "projects"));
    res.json(mapped);
  });

  app.get("/api/projects/:id", authRequired, (req, res) => {
    if (!hasProjectAccess(req.user!, req.params.id)) {
      res.status(403).json({ error: "Forbidden: no access to this project" });
      return;
    }
    const project = db.prepare("SELECT * FROM projects WHERE id=?").get(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(externalRecordDto(rowToDict(project), req.user!, "projects"));
  });

  app.post("/api/projects", authRequired, (req, res) => {
    if (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager") {
      res.status(403).json({ error: "Admin or Project Manager access required to create project" });
      return;
    }
    const data = req.body || {};
    const id = crypto.randomUUID();
    const projectCode = data.project_code || data.code || `PRJ-${Math.floor(100 + Math.random() * 900)}`;
    const clientName = data.client_name || data.client || "";
    const contractVal = data.contract_value !== undefined ? parseImportNumber(data.contract_value) : parseImportNumber(data.budget);

    const cols = [
      "id", "name", "client", "status", "start_date", "end_date", "budget", "code", "location", "description", "progress",
      "project_code", "currency", "contract_value", "contract_type", "stage", "client_name", "main_contractor",
      "consultant", "project_manager_id", "project_manager_name", "site_address", "city", "country",
      "baseline_start_date", "baseline_end_date", "forecast_end_date"
    ];
    const values = [
      id,
      data.name || "Untitled Project",
      clientName,
      data.status || "Active",
      data.start_date || "",
      data.end_date || "",
      contractVal,
      projectCode,
      data.location || null,
      data.description || null,
      data.progress ? parseInt(data.progress, 10) : 0,
      projectCode,
      data.currency || "USD",
      contractVal,
      data.contract_type || "Lump Sum",
      data.stage || "Construction",
      clientName,
      data.main_contractor || null,
      data.consultant || null,
      data.project_manager_id || req.user!.user_id,
      data.project_manager_name || req.user!.name,
      data.site_address || null,
      data.city || null,
      data.country || null,
      data.baseline_start_date || data.start_date || null,
      data.baseline_end_date || data.end_date || null,
      data.forecast_end_date || data.end_date || null
    ];
    db.prepare(`INSERT INTO projects (${cols.join(",")}) VALUES (${cols.map(() => '?').join(',')})`).run(...values);
    db.prepare(`
      INSERT OR IGNORE INTO project_memberships (user_id, project_id, access_role)
      VALUES (?, ?, 'Project Manager')
    `).run(req.user!.user_id, id);
    writeAudit(req.user!.user_id, "projects", id, id, "create", null, data);
    const created = db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    res.status(201).json(rowToDict(created));
  });

  app.put("/api/projects/:id", authRequired, (req, res) => {
    if (!hasProjectAccess(req.user!, req.params.id) || (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager")) {
      res.status(403).json({ error: "Admin or Project Manager access required" });
      return;
    }
    const existing = db.prepare("SELECT * FROM projects WHERE id=?").get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const data = req.body || {};
    const cols = [
      "name", "client", "status", "start_date", "end_date", "budget", "code", "location", "description", "progress",
      "project_code", "currency", "contract_value", "contract_type", "stage", "client_name", "main_contractor",
      "consultant", "project_manager_id", "project_manager_name", "site_address", "city", "country",
      "baseline_start_date", "baseline_end_date", "forecast_end_date"
    ];
    const updates: string[] = [];
    const vals: any[] = [];
    for (const c of cols) {
      if (c in data) {
        updates.push(`${c}=?`);
        if (c === "budget" || c === "contract_value") {
          vals.push(parseImportNumber(data[c]));
        } else if (c === "progress") {
          vals.push(parseInt(data[c], 10));
        } else {
          vals.push(data[c]);
        }
      }
    }
    // Cross-sync code and project_code
    if (("project_code" in data) && !("code" in data)) {
      updates.push("code=?");
      vals.push(data.project_code);
    } else if (("code" in data) && !("project_code" in data)) {
      updates.push("project_code=?");
      vals.push(data.code);
    }
    // Cross-sync client and client_name
    if (("client_name" in data) && !("client" in data)) {
      updates.push("client=?");
      vals.push(data.client_name);
    } else if (("client" in data) && !("client_name" in data)) {
      updates.push("client_name=?");
      vals.push(data.client);
    }
    // Cross-sync budget and contract_value
    if (("contract_value" in data) && !("budget" in data)) {
      updates.push("budget=?");
      vals.push(parseImportNumber(data.contract_value));
    } else if (("budget" in data) && !("contract_value" in data)) {
      updates.push("contract_value=?");
      vals.push(parseImportNumber(data.budget));
    }
    if (updates.length > 0) {
      vals.push(req.params.id);
      db.prepare(`UPDATE projects SET ${updates.join(",")} WHERE id=?`).run(...vals);
    }
    const updated = db.prepare("SELECT * FROM projects WHERE id=?").get(req.params.id);
    writeAudit(req.user!.user_id, "projects", req.params.id, req.params.id, "update", existing, updated);
    res.json(rowToDict(updated));
  });

  app.delete("/api/projects/:id", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const id = req.params.id;
    db.prepare("DELETE FROM project_memberships WHERE project_id=?").run(id);
    db.prepare("DELETE FROM project_companies WHERE project_id=?").run(id);
    db.prepare("DELETE FROM notifications WHERE project_id=?").run(id);
    try { db.prepare("DELETE FROM clarification_messages WHERE clarification_id IN (SELECT id FROM clarifications WHERE project_id=?)").run(id); } catch {}
    try { db.prepare("DELETE FROM clarifications WHERE project_id=?").run(id); } catch {}
    try { db.prepare("DELETE FROM progress_submissions WHERE project_id=?").run(id); } catch {}
    try { db.prepare("DELETE FROM progress_reports WHERE project_id=?").run(id); } catch {}
    try { db.prepare("DELETE FROM document_transmittals WHERE project_id=?").run(id); } catch {}
    try { db.prepare("DELETE FROM transmittals WHERE project_id=?").run(id); } catch {}
    try { db.prepare("DELETE FROM work_packages WHERE project_id=?").run(id); } catch {}
    // A few TABLE_CONFIG keys (e.g. "drawings", "daily_logs") are URL
    // aliases for a real table under a different name ("documents",
    // "dailylogs") rather than real tables of their own - resolve those
    // before deleting, and de-duplicate so each real table is only hit once.
    const realTables = new Set<string>();
    for (const table of Object.keys(TABLE_CONFIG)) {
      realTables.add(table === "drawings" ? "documents" : table === "daily_logs" ? "dailylogs" : table === "boq" ? "boq_items" : table === "wbs" ? "wbs_items" : table === "actions" ? "project_actions" : table === "decisions" ? "project_decisions" : table === "project_risks" ? "risks" : table);
    }
    for (const table of realTables) {
      try { db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(id); } catch {}
    }
    db.prepare("DELETE FROM projects WHERE id=?").run(id);
    writeAudit(req.user!.user_id, "projects", id, id, "delete");
    res.json({ ok: true });
  });

  // Portfolio Dashboard
  app.get("/api/portfolio", authRequired, (req, res) => {
    if (!canView(req.user!, "dashboard")) {
      res.status(403).json({ error: "No view access" });
      return;
    }
    const { where, params } = projectScopeSql(req.user!, "ALL", "id");
    const projects = db.prepare(`SELECT * FROM projects WHERE ${where}`).all(...params) as any[];
    const today = new Date().toISOString().split("T")[0];
    const cards = [];

    for (const project of projects) {
      const pid = project.id;
      const tasks = db.prepare("SELECT * FROM tasks WHERE project_id=?").all(pid) as any[];
      const rfis = db.prepare("SELECT * FROM rfis WHERE project_id=?").all(pid) as any[];
      const punch = db.prepare("SELECT * FROM punchlist WHERE project_id=?").all(pid) as any[];
      const deps = db.prepare("SELECT * FROM dependencies WHERE project_id=?").all(pid) as any[];
      const costs = db.prepare("SELECT planned, actual FROM costs WHERE project_id=?").all(pid) as any[];
      const variations = db.prepare("SELECT cost_impact, status FROM change_orders WHERE project_id=?").all(pid) as any[];
      const procurement = db.prepare("SELECT status, expected_delivery FROM procurement_items WHERE project_id=?").all(pid) as any[];

      const progress = tasks.length ? Math.round(tasks.reduce((sum, t) => sum + (t.progress || 0), 0) / tasks.length) : 0;
      const approvedVariations = variations
        .filter(v => ["approved", "closed", "paid"].includes((v.status || "").toLowerCase()))
        .reduce((sum, v) => sum + (v.cost_impact || 0), 0);
      const pendingVariations = variations
        .filter(v => !["approved", "closed", "paid", "rejected"].includes((v.status || "").toLowerCase()))
        .reduce((sum, v) => sum + (v.cost_impact || 0), 0);
      const planned = costs.reduce((sum, c) => sum + (c.planned || 0), 0);
      const actual = costs.reduce((sum, c) => sum + (c.actual || 0), 0);
      const openSnags = punch.filter(p => !["closed", "closed verified", "complete verified"].includes((p.status || "").toLowerCase())).length;
      const overdue = rfis.filter(r => r.due_date && r.due_date < today && !["closed", "answered"].includes((r.status || "").toLowerCase())).length;
      const blocked = deps.filter(d => ["blocked", "overdue"].includes((d.status || "").toLowerCase())).length;
      const lateMaterials = procurement.filter(p => p.expected_delivery && p.expected_delivery < today && !["delivered", "installed"].includes((p.status || "").toLowerCase())).length;

      let health = (blocked || lateMaterials || overdue >= 3) ? "RED" : (openSnags || pendingVariations || overdue) ? "AMBER" : "GREEN";
      if (["closed", "completed"].includes((project.status || "").toLowerCase()) && (openSnags || pendingVariations)) {
        health = "BLUE";
      }

      cards.push({
        ...project,
        contract_value: project.budget || 0,
        approved_variations: approvedVariations,
        revised_contract_value: (project.budget || 0) + approvedVariations,
        project_completion: progress,
        programme_completion: progress,
        commercial_completion: planned ? Math.round((actual / planned) * 100) : 0,
        procurement_completion: procurement.length
          ? Math.round((procurement.filter(p => ["delivered", "installed"].includes((p.status || "").toLowerCase())).length / procurement.length) * 100)
          : 0,
        open_snags: openSnags,
        overdue_actions: overdue,
        major_blockers: blocked,
        pending_variations: pendingVariations,
        cost_variance: actual - planned,
        late_materials: lateMaterials,
        health,
      });
    }
    res.json(cards);
  });

  // Operations Today
  app.get("/api/operations/today", authRequired, (req, res) => {
    if (!canView(req.user!, "dashboard")) {
      res.status(403).json({ error: "No view access" });
      return;
    }
    const selectedDate = (req.query.date as string) || new Date().toISOString().split("T")[0];
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId, "id");
    if (!where) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    const projects = db.prepare(`SELECT * FROM projects WHERE ${where}`).all(...params) as any[];
    const digest = [];

    for (const project of projects) {
      const pid = project.id;
      const tasks = db.prepare("SELECT * FROM tasks WHERE project_id=? AND start<=? AND end>=? ORDER BY start, title").all(pid, selectedDate, selectedDate) as any[];
      const logs = db.prepare("SELECT * FROM dailylogs WHERE project_id=? AND date=? ORDER BY rowid DESC").all(pid, selectedDate) as any[];
      const photos = db.prepare("SELECT id, name, attachment_name, date_added FROM documents WHERE project_id=? AND category='Site Photo' AND date_added=? AND attachment_data IS NOT NULL ORDER BY rowid DESC").all(pid, selectedDate) as any[];
      const boq = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(installed_quantity),0) AS installed, COALESCE(SUM(tender_quantity),0) AS tender FROM boq_items WHERE project_id=?").get(pid) as any;

      digest.push({
        project: rowToDict(project),
        tasks: tasks.map(rowToDict),
        logs: logs.map(rowToDict),
        photo_count: photos.length,
        latest_photo: photos[0] ? rowToDict(photos[0]) : null,
        boq: rowToDict(boq),
        crew: logs.reduce((sum, l) => sum + (parseInt(l.crew || 0) || 0), 0),
        progress: tasks.length ? Math.round(tasks.reduce((sum, t) => sum + (parseInt(t.progress || 0) || 0), 0) / tasks.length) : 0,
      });
    }
    res.json({ date: selectedDate, projects: digest });
  });

  // Attendance
  app.get("/api/attendance", authRequired, (req, res) => {
    if (!canView(req.user!, "attendance")) {
      res.status(403).json({ error: "No view access" });
      return;
    }
    const projectId = req.query.project_id as string;
    const scoped = projectScopeSql(req.user!, projectId, "a.project_id");
    if (!scoped.where) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    let where = scoped.where;
    const params: any[] = [...scoped.params];

    if (req.user!.role === "Worker") {
      where += " AND a.user_id=?";
      params.push(req.user!.user_id);
    } else if (req.user!.role === "Subcontractor") {
      if (!req.user!.company_id) { res.json([]); return; }
      where += " AND w.company_id=?";
      params.push(req.user!.company_id);
    } else if (req.user!.role === "SiteSupervisor") {
      where += " AND EXISTS (SELECT 1 FROM worker_assignments wa WHERE wa.worker_id=a.worker_id AND wa.project_id=a.project_id AND wa.supervisor_id=? AND wa.status='Active')";
      params.push(req.user!.user_id);
    }

    const rows = db.prepare(
      "SELECT a.*, w.company_id as worker_company_id, w.trade as worker_trade FROM attendance a " +
      "LEFT JOIN workers w ON w.id=a.worker_id WHERE " + where + " ORDER BY a.punch_in DESC"
    ).all(...params) as any[];
    const now = new Date();
    const result = rows
      .filter(row => canAccessAttendance(req.user!, row, "view"))
      .map(row => {
        const record = { ...row };
        const start = new Date(row.punch_in);
        const end = row.punch_out ? new Date(row.punch_out) : now;
        record.hours = Math.round((Math.max(0, end.getTime() - start.getTime()) / 3600000) * 100) / 100;
        return record;
      });
    res.json(result);
  });

  app.post("/api/attendance/punch-in", authRequired, (req, res) => {
    if (req.user!.role === "Worker") {
      res.status(410).json({ error: "Workers must use /api/attendance/gps-punch-in with an assigned site and GPS location" });
      return;
    }
    let projectId = req.body?.project_id;
    if (!projectId) {
      const defaultProj = db.prepare("SELECT project_id FROM project_memberships WHERE user_id=? AND active=1 LIMIT 1").get(req.user!.user_id) as any;
      if (defaultProj) projectId = defaultProj.project_id;
    }
    if (!projectId || !hasProjectAccess(req.user!, projectId)) {
      res.status(403).json({ error: "No project access" });
      return;
    }
    if (!canEdit(req.user!, "attendance")) {
      res.status(403).json({ error: "No edit access" });
      return;
    }
    const active = db.prepare("SELECT id FROM attendance WHERE user_id=? AND punch_out IS NULL").get(req.user!.user_id);
    if (active) {
      res.status(409).json({ error: "You are already punched in to a project" });
      return;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const today = now.split("T")[0];
    const notes = req.body?.shift_notes || req.body?.notes || "";
    db.prepare("INSERT INTO attendance (id, project_id, user_id, worker, work_date, punch_in, punch_out, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, 'Open', ?)").run(
      id, projectId, req.user!.user_id, req.user!.name, today, now, null, notes
    );
    writeAudit(req.user!.user_id, "attendance", id, projectId, "punch_in", null, { worker: req.user!.name, punch_in: now });
    res.status(201).json({
      id,
      project_id: projectId,
      user_id: req.user!.user_id,
      worker: req.user!.name,
      work_date: today,
      punch_in: now,
      punch_out: null,
      status: "Open",
      notes,
    });
  });

  app.post("/api/attendance/punch-out", authRequired, (req, res) => {
    const active = db.prepare("SELECT * FROM attendance WHERE user_id=? AND punch_out IS NULL").get(req.user!.user_id) as any;
    if (!active) {
      res.status(409).json({ error: "You are not currently punched in" });
      return;
    }
    const now = new Date().toISOString();
    db.prepare("UPDATE attendance SET punch_out=?, status='Closed' WHERE id=?").run(now, active.id);
    writeAudit(req.user!.user_id, "attendance", active.id, active.project_id, "punch_out", active, { punch_out: now });
    const updated = db.prepare("SELECT * FROM attendance WHERE id=?").get(active.id) as any;
    const start = new Date(updated.punch_in);
    const end = new Date(updated.punch_out);
    updated.hours = Math.round((Math.max(0, end.getTime() - start.getTime()) / 3600000) * 100) / 100;
    res.json(rowToDict(updated));
  });

  // Dashboard Overview
  app.get("/api/dashboard", authRequired, (req, res) => {
    if (!canView(req.user!, "dashboard")) {
      res.status(403).json({ error: "No view access" });
      return;
    }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId);
    if (!where) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }

    const tasks = db.prepare(`SELECT * FROM tasks WHERE ${where}`).all(...params) as any[];
    const rfis = db.prepare(`SELECT * FROM rfis WHERE ${where}`).all(...params) as any[];
    const submittals = db.prepare(`SELECT * FROM submittals WHERE ${where}`).all(...params) as any[];
    const punch = db.prepare(`SELECT * FROM punchlist WHERE ${where}`).all(...params) as any[];
    const costs = db.prepare(`SELECT * FROM costs WHERE ${where}`).all(...params) as any[];
    const boqItems = db.prepare(`SELECT * FROM boq_items WHERE ${where}`).all(...params) as any[];
    const changeOrders = db.prepare(`SELECT * FROM change_orders WHERE ${where}`).all(...params) as any[];
    const safetyIncidents = db.prepare(`SELECT * FROM safety_incidents WHERE ${where}`).all(...params) as any[];
    const materialReqs = db.prepare(`SELECT * FROM material_requests WHERE ${where}`).all(...params) as any[];
    const purchaseOrders = db.prepare(`SELECT * FROM purchase_orders WHERE ${where}`).all(...params) as any[];
    const inspections = db.prepare(`SELECT * FROM inspections WHERE ${where}`).all(...params) as any[];

    const today = new Date().toISOString().split("T")[0];
    const isOverdue = (r: any) => {
      if (!r.due_date) return false;
      const closedLike = ["closed", "completed", "approved"].some(s => (r.status || "").toLowerCase().includes(s));
      return !closedLike && r.due_date < today;
    };

    const openRfi = rfis.filter(r => r.status !== "Closed" && r.status !== "Answered").length;
    const openPunch = punch.filter(p => p.status !== "Closed").length;
    const overdue = [...rfis, ...submittals].filter(isOverdue).length;
    const avgProgress = tasks.length ? Math.round(tasks.reduce((sum, t) => sum + (t.progress || 0), 0) / tasks.length) : 0;
    const totalPlanned = costs.reduce((sum, c) => sum + (c.planned || 0), 0);
    const totalActual = costs.reduce((sum, c) => sum + (c.actual || 0), 0);
    const pendingChangeOrders = changeOrders.filter(c => c.status === "Pending").length;
    const openSafety = safetyIncidents.filter(s => s.status !== "Closed").length;
    const poCommittedValue = purchaseOrders.reduce((sum, po) => sum + (Number(po.amount) || 0), 0);
    const boqTenderValue = boqItems.reduce((sum, b) => sum + (Number(b.tender_amount) || 0), 0);
    const boqInstalledValue = boqItems.reduce((sum, b) => sum + ((Number(b.installed_quantity) || 0) * (Number(b.tender_rate) || 0)), 0);
    const boqCertifiedValue = boqItems.reduce((sum, b) => sum + ((Number(b.certified_quantity) || 0) * (Number(b.tender_rate) || 0)), 0);
    const verifiedInspectionsCount = inspections.filter(i => ["pass", "approved"].includes(String(i.result || i.status || "").toLowerCase())).length;

    const tasksByTrade: Record<string, number> = {};
    for (const t of tasks) {
      if (t.trade) {
        tasksByTrade[t.trade] = (tasksByTrade[t.trade] || 0) + 1;
      }
    }

    res.json({
      total_tasks: tasks.length,
      avg_progress: avgProgress,
      open_rfi: openRfi,
      open_punch: openPunch,
      overdue_count: overdue,
      planned_cost: totalPlanned,
      actual_cost: totalActual,
      cost_variance: totalActual - totalPlanned,
      po_committed_value: poCommittedValue,
      material_requests_count: materialReqs.length,
      purchase_orders_count: purchaseOrders.length,
      verified_inspections_count: verifiedInspectionsCount,
      tasks_by_trade: tasksByTrade,
      pending_change_orders: pendingChangeOrders,
      open_safety_incidents: openSafety,
      boq_line_count: boqItems.length,
      boq_tender_value: boqTenderValue,
      boq_installed_value: boqInstalledValue,
      boq_certified_value: boqCertifiedValue,
    });
  });

  // Global Search
  app.get("/api/search", authRequired, (req, res) => {
    const q = ((req.query.q as string) || "").trim();
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId);
    const { where: projWhere, params: projParams } = projectScopeSql(req.user!, projectId, "id");
    if (!where || !projWhere) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }

    const like = `%${q}%`;
    const results: any[] = [];
    const searchable: Record<string, string[]> = {
      projects: ["name", "client", "status"],
      tasks: ["title", "trade", "assignee", "status"],
      rfis: ["number", "subject", "trade", "status"],
      documents: ["name", "category", "revision"],
      boq_items: ["item_number", "description", "discipline", "system", "unit"],
      purchase_orders: ["po_number", "vendor", "description", "status"],
      change_orders: ["number", "title", "trade", "status"],
      equipment: ["name", "type", "assigned_to", "status"],
      dependencies: ["description", "dependency_owner", "status", "next_action"],
      procurement_items: ["pr_number", "material", "selected_supplier", "status"],
      risks: ["title", "category", "owner", "status"],
      ncrs: ["number", "description", "responsible_party", "status"],
      commissioning_tests: ["system", "equipment", "test_type", "status"],
      handover_items: ["contractor", "system", "item_type", "status"],
    };

    for (const [table, columns] of Object.entries(searchable)) {
      const searchModule = table === "projects" ? "projects" : (TABLE_CONFIG[table]?.module || table);
      if (table !== "projects" && !canView(req.user!, searchModule)) continue;
      let scope = table === "projects" ? projWhere : where;
      const baseParams = table === "projects" ? [...projParams] : [...params];
      if (table === "documents" && req.user!.role === "Subcontractor") {
        scope += " AND (subcontractor_id = ? OR id IN (SELECT record_id FROM record_owners WHERE module='documents' AND user_id=?))";
        baseParams.push(req.user!.user_id, req.user!.user_id);
      } else if ((table === "tasks" || table === "submittals" || table === "punchlist" || table === "dailylogs") && req.user!.role === "Subcontractor") {
        const scConds: string[] = ["id IN (SELECT record_id FROM record_owners WHERE module=? AND user_id=?)"];
        baseParams.push(searchModule, req.user!.user_id);
        if (req.user!.work_package_id) {
          scConds.push("work_package_id = ?");
          baseParams.push(req.user!.work_package_id);
        }
        if (req.user!.company_id) {
          scConds.push("company_id = ?");
          baseParams.push(req.user!.company_id);
        }
        if (!req.user!.work_package_id && !req.user!.company_id) {
          scConds.push("1=1");
        }
        scope += ` AND (${scConds.join(" OR ")})`;
      }
      if ((table === "documents" || table === "change_orders") && req.user!.role === "Client") {
        scope += " AND visibility IN ('Client', 'All')";
      }
      const clauses = columns.map(c => `${c} LIKE ?`).join(" OR ");
      const queryParams = [...baseParams, ...columns.map(() => like)];
      const rawRows = db.prepare(`SELECT * FROM ${table} WHERE ${scope} AND (${clauses}) LIMIT 25`).all(...queryParams) as any[];
      const rows = rawRows.filter(r => table === "projects" ? hasProjectAccess(req.user!, r.id) : canAccessRecord(req.user!, r, "view", searchModule));
      for (const row of rows) {
        const record = rowToDict(row) as any;
        if (table === "documents" && record) delete record.attachment_data;
        if (table === "projects" && req.user!.role === "Client" && record) delete record.budget;
        results.push({
          module: table,
          id: row.id,
          project_id: row.project_id || row.id,
          title: row.title || row.name || row.description || row.subject || row.material || row.number,
          record,
        });
      }
    }
    res.json(results.slice(0, 100));
  });

  // Audit Logs
  app.get("/api/audit", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId, "id");
    if (!where) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    const rows = db.prepare(`
      SELECT audit_logs.*, users.name AS user_name
      FROM audit_logs
      LEFT JOIN users ON users.id = audit_logs.user_id
      WHERE audit_logs.project_id IN (SELECT id FROM projects WHERE ${where})
      ORDER BY audit_logs.created_at DESC LIMIT 500
    `).all(...params);
    res.json(rows.map(rowToDict));
  });

  // Export CSV
  app.get("/api/export/:table", authRequired, (req, res) => {
    const table = req.params.table;
    const exportConfig = {
      ...TABLE_CONFIG,
      projects: {
        cols: ["id", "name", "client", "status", "start_date", "end_date", "budget"],
        module: "projects",
      },
    };
    const cfg = (exportConfig as any)[table];
    if (!cfg) {
      res.status(404).json({ error: "Unknown export target" });
      return;
    }
    if (!canView(req.user!, cfg.module)) {
      res.status(403).json({ error: `No view access to ${cfg.module}` });
      return;
    }
    const projectId = req.query.project_id as string;
    let { where, params } = table === "projects" ? projectScopeSql(req.user!, projectId, "id") : projectScopeSql(req.user!, projectId);
    if (!where) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    if (table === "documents" && req.user!.role === "Subcontractor") {
      where += " AND (subcontractor_id = ? OR id IN (SELECT record_id FROM record_owners WHERE module='documents' AND user_id=?))";
      params.push(req.user!.user_id, req.user!.user_id);
    } else if ((table === "tasks" || table === "submittals" || table === "punchlist" || table === "dailylogs") && req.user!.role === "Subcontractor") {
      const scConds: string[] = ["id IN (SELECT record_id FROM record_owners WHERE module=? AND user_id=?)"];
      params.push(cfg.module, req.user!.user_id);
      if (req.user!.work_package_id) {
        scConds.push("work_package_id = ?");
        params.push(req.user!.work_package_id);
      }
      if (req.user!.company_id) {
        scConds.push("company_id = ?");
        params.push(req.user!.company_id);
      }
      if (!req.user!.work_package_id && !req.user!.company_id) {
        scConds.push("1=1");
      }
      where += ` AND (${scConds.join(" OR ")})`;
    }
    if ((table === "documents" || table === "change_orders") && req.user!.role === "Client") {
      where += " AND visibility IN ('Client', 'All')";
    }
    const rawRows = db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...params) as any[];
    const rows = rawRows.filter(r => table === "projects" ? hasProjectAccess(req.user!, r.id) : canAccessRecord(req.user!, r, "view", cfg.module));
    let cols = cfg.cols.filter((c: string) => c !== "attachment_data");
    if (table === "projects" && (req.user!.role === "Client" || req.user!.role === "Subcontractor")) {
      cols = cols.filter((c: string) => c !== "budget");
    }
    const csvHeader = cols.join(",");
    const csvRows = rows.map((r: any) =>
      cols.map((c: string) => {
        const v = r[c] ?? "";
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(",")
    );
    const content = [csvHeader, ...csvRows].join("\r\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${table}.csv`);
    res.send(content);
  });

  // Specialized Workflow Actions
  app.post("/api/procurement_items/:id/create-po", authRequired, (req, res) => {
    const item = db.prepare("SELECT * FROM procurement_items WHERE id=?").get(req.params.id) as any;
    if (!item) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!hasProjectAccess(req.user!, item.project_id)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    if (!canEdit(req.user!, "procurement")) {
      res.status(403).json({ error: "No edit access" });
      return;
    }
    if (item.po_number) {
      res.status(409).json({ error: "Purchase order already exists", po_number: item.po_number });
      return;
    }
    const poNumber = req.body?.po_number || `PO-${Date.now()}`;
    const today = new Date().toISOString().split("T")[0];
    db.prepare(`
      INSERT INTO purchase_orders (id, project_id, po_number, vendor, trade, description, amount, order_date, expected_delivery, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), item.project_id, poNumber, item.selected_supplier || "", "",
      item.material || "", 0, item.po_date || today, item.expected_delivery, "Ordered"
    );
    db.prepare("UPDATE procurement_items SET po_number=?, status=? WHERE id=?").run(poNumber, "Ordered", req.params.id);
    writeAudit(req.user!.user_id, "procurement", req.params.id, item.project_id, "create_po", null, { po_number: poNumber });
    res.status(201).json({ ok: true, po_number: poNumber });
  });

  app.post("/api/dependencies/:id/complete", authRequired, (req, res) => {
    const dep = db.prepare("SELECT * FROM dependencies WHERE id=?").get(req.params.id) as any;
    if (!dep) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!hasProjectAccess(req.user!, dep.project_id)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    if (!canEdit(req.user!, "dependencies")) {
      res.status(403).json({ error: "No edit access" });
      return;
    }
    const completedDate = req.body?.completed_date || new Date().toISOString().split("T")[0];
    db.prepare("UPDATE dependencies SET status=?, completed_date=? WHERE id=?").run("Complete", completedDate, req.params.id);
    if (dep.task_id) {
      const openRow = db.prepare(
        "SELECT COUNT(*) as count FROM dependencies WHERE task_id=? AND status NOT IN ('Complete','Completed') AND id<>?"
      ).get(dep.task_id, req.params.id) as { count: number };
      if (openRow.count === 0) {
        db.prepare(
          "UPDATE tasks SET status=? WHERE id=? AND status IN ('Blocked','Awaiting Material','Awaiting Contractor')"
        ).run("Ready to Start", dep.task_id);
      }
    }
    writeAudit(req.user!.user_id, "dependencies", req.params.id, dep.project_id, "complete", { status: dep.status }, { status: "Complete", completed_date: completedDate });
    res.json({ ok: true, status: "Complete", completed_date: completedDate });
  });

  app.get("/api/commissioning_tests/:id/readiness", authRequired, (req, res) => {
    const row = db.prepare("SELECT * FROM commissioning_tests WHERE id=?").get(req.params.id) as any;
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!hasProjectAccess(req.user!, row.project_id)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    const prerequisites: Record<string, any> = {
      power_available: row.power_available,
      installation_complete: row.installation_complete,
      controls_complete: row.controls_complete || row.controls_online,
      interface_complete: row.interface_complete || row.interface_ready,
      drawings_approved: row.drawings_approved,
    };
    const missing = Object.keys(prerequisites).filter(k => !prerequisites[k]);
    const isReady = missing.length === 0;
    res.json({ ready: isReady, is_ready: isReady, missing, prerequisites });
  });

  app.get("/api/handover/:projectId/readiness", authRequired, (req, res) => {
    const pid = req.params.projectId;
    if (!hasProjectAccess(req.user!, pid)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    const rows = db.prepare("SELECT * FROM handover_items WHERE project_id=?").all(pid) as any[];
    const total = rows.length;
    const approved = rows.filter(r => r.approved || ["approved", "closed"].includes((r.status || "").toLowerCase())).length;
    const submitted = rows.filter(r => r.submitted || r.approved || ["submitted", "under review", "approved", "closed"].includes((r.status || "").toLowerCase())).length;
    const missing = rows.filter(r => !r.approved && !["approved", "closed"].includes((r.status || "").toLowerCase())).map(rowToDict);
    res.json({
      total,
      submitted,
      approved,
      readiness_percent: total ? Math.round((approved / total) * 100) : 0,
      missing,
    });
  });

  app.get("/api/tasks/:id/history", authRequired, (req, res) => {
    const task = db.prepare("SELECT project_id FROM tasks WHERE id=?").get(req.params.id) as any;
    if (!task) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!hasProjectAccess(req.user!, task.project_id)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    const rows = db.prepare("SELECT * FROM task_status_history WHERE task_id=? ORDER BY changed_at DESC").all(req.params.id);
    res.json(rows.map(rowToDict));
  });

  // Task completion with photo evidence
  app.post("/api/tasks/:id/complete-with-evidence", authRequired, (req, res) => {
    if (!canEdit(req.user!, "tasks")) {
      res.status(403).json({ error: "No edit access to tasks" });
      return;
    }
    const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(req.params.id) as any;
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (!hasProjectAccess(req.user!, task.project_id)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }

    const { evidence_url, evidence_notes, actual_end_date } = req.body || {};
    const today = new Date().toISOString().slice(0, 10);
    const finishDate = actual_end_date || today;

    db.prepare(`
      UPDATE tasks 
      SET status='Completed', 
          progress=100, 
          actual_end_date=?, 
          evidence_url=COALESCE(?, evidence_url), 
          evidence_notes=COALESCE(?, evidence_notes) 
      WHERE id=?
    `).run(finishDate, evidence_url || null, evidence_notes || null, task.id);

    // Record status history
    if (task.status !== 'Completed') {
      db.prepare("INSERT INTO task_status_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        crypto.randomUUID(), task.project_id, task.id, req.user!.name,
        task.status || 'In Progress', 'Completed', new Date().toISOString(), evidence_notes || 'Task marked completed with evidence photo'
      );
    }

    // Auto-archive evidence photo into documents repository as Site Photo
    const finalPhoto = evidence_url || task.evidence_url;
    if (finalPhoto) {
      try {
        const existingDoc = db.prepare("SELECT id FROM documents WHERE project_id=? AND name LIKE ?").get(task.project_id, `%${task.title}%Evidence%`) as any;
        const docName = `${task.title} - Completion Evidence Photo`;
        if (!existingDoc) {
          db.prepare(`
            INSERT INTO documents (id, project_id, name, category, work_package_id, revision, status, date_added, attachment_name, attachment_data, uploaded_by, visibility)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            crypto.randomUUID(),
            task.project_id,
            docName,
            'Site Photo',
            task.work_package_id || null,
            'Rev 0',
            'Approved',
            finishDate,
            `${(task.wbs_code || 'TASK')}_evidence.jpg`,
            finalPhoto,
            req.user!.name,
            'Internal'
          );
        } else {
          db.prepare(`
            UPDATE documents SET attachment_data=?, date_added=? WHERE id=?
          `).run(finalPhoto, finishDate, existingDoc.id);
        }
      } catch (docErr) {
        console.error("Auto-archiving task evidence photo error:", docErr);
      }
    }

    writeAudit(req.user!.user_id, "tasks", task.id, task.project_id, "complete_with_evidence", task, { status: "Completed", progress: 100, evidence_url: !!finalPhoto });
    const updated = db.prepare("SELECT * FROM tasks WHERE id=?").get(task.id) as any;
    res.json(rowToDict(updated));
  });

  app.post("/api/:table/:id/transition", authRequired, (req, res) => {
    const table = req.params.table;
    const recordId = req.params.id;
    const newStatus = req.body?.status || req.body?.stage;
    const comment = req.body?.comment || null;

    const cfg = TABLE_CONFIG[table];
    if (!cfg || !cfg.cols.includes("status")) {
      res.status(400).json({ error: "No status workflow for this module" });
      return;
    }
    const actualTable = table === "drawings" ? "documents" : table === "daily_logs" ? "dailylogs" : table;
    const existing = db.prepare(`SELECT * FROM ${actualTable} WHERE id=?`).get(recordId) as any;
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!canAccessRecord(req.user!, existing, "edit", cfg.module)) {
      res.status(403).json({ error: "No access to transition this record" });
      return;
    }
    if (!WORKFLOW_STATUSES[table]) {
      res.status(400).json({ error: "No controlled workflow for this module" });
      return;
    }
    const oldStatus = existing.status || "";
    const allowed = WORKFLOW_STATUSES[table][oldStatus] || [];
    if (!allowed.includes(newStatus)) {
      res.status(422).json({ error: `Cannot transition ${oldStatus || "blank"} to ${newStatus}`, allowed });
      return;
    }
    db.prepare(`UPDATE ${table} SET status=? WHERE id=?`).run(newStatus, recordId);
    db.prepare("INSERT INTO task_status_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), existing.project_id, recordId, req.user!.name, oldStatus, newStatus, new Date().toISOString(), comment
    );
    writeAudit(req.user!.user_id, cfg.module, recordId, existing.project_id, "transition", { status: oldStatus }, { status: newStatus, comment });
    const updated = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(recordId);
    res.json(rowToDict(updated));
  });

}
