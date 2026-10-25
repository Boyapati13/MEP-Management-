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

export function registerWorkforceController(app: Express): void {
  // =====================================================================
  // WORKFORCE MODULE API (V1.2)
  // =====================================================================

  // --- SITES ---
  app.get('/api/sites', authRequired, (req, res) => {
    if (!canView(req.user!, 'sites')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId);
    if (!where) { res.status(403).json({ error: 'No project access' }); return; }
    const rows = db.prepare(`SELECT * FROM sites WHERE ${where} ORDER BY name`).all(...params);
    res.json(rows);
  });

  app.post('/api/sites', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'sites')) { res.status(403).json({ error: 'No edit access' }); return; }
    const { project_id, name, address, city, country, latitude, longitude, geofence_radius_m, geofence_warning_radius_m, timezone } = req.body;
    if (!project_id || !name) { res.status(400).json({ error: 'project_id and name required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO sites (id,project_id,name,address,city,country,latitude,longitude,geofence_radius_m,geofence_warning_radius_m,timezone,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, project_id, name, address||null, city||null, country||null, latitude||null, longitude||null, geofence_radius_m||100, geofence_warning_radius_m||150, timezone||'UTC', 'Active', req.user!.user_id, now);
    writeAudit(req.user!.user_id, 'sites', id, project_id, 'create', null, { name });
    res.status(201).json(db.prepare('SELECT * FROM sites WHERE id=?').get(id));
  });

  app.get('/api/sites/:id', authRequired, (req, res) => {
    if (!canView(req.user!, 'sites')) { res.status(403).json({ error: 'No access' }); return; }
    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(req.params.id) as any;
    if (!site) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, site.project_id)) { res.status(403).json({ error: 'No access' }); return; }
    res.json(site);
  });

  app.put('/api/sites/:id', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'sites')) { res.status(403).json({ error: 'No edit access' }); return; }
    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(req.params.id) as any;
    if (!site) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, site.project_id)) { res.status(403).json({ error: 'No access' }); return; }
    const { name, address, city, country, latitude, longitude, geofence_radius_m, geofence_warning_radius_m, timezone, status } = req.body;
    db.prepare(`UPDATE sites SET name=COALESCE(?,name),address=COALESCE(?,address),city=COALESCE(?,city),country=COALESCE(?,country),latitude=COALESCE(?,latitude),longitude=COALESCE(?,longitude),geofence_radius_m=COALESCE(?,geofence_radius_m),geofence_warning_radius_m=COALESCE(?,geofence_warning_radius_m),timezone=COALESCE(?,timezone),status=COALESCE(?,status) WHERE id=?`)
      .run(name||null, address||null, city||null, country||null, latitude||null, longitude||null, geofence_radius_m||null, geofence_warning_radius_m||null, timezone||null, status||null, req.params.id);
    writeAudit(req.user!.user_id, 'sites', req.params.id, site.project_id, 'update', site, req.body);
    res.json(db.prepare('SELECT * FROM sites WHERE id=?').get(req.params.id));
  });

  // Site control screen
  app.get('/api/sites/:id/control', authRequired, (req, res) => {
    if (!canView(req.user!, 'sites')) { res.status(403).json({ error: 'No access' }); return; }
    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(req.params.id) as any;
    if (!site) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, site.project_id)) { res.status(403).json({ error: 'No access' }); return; }
    const today = new Date().toISOString().split('T')[0];
    const presentWorkers = db.prepare(
      `SELECT a.*, w.trade, w.employment_type, w.employee_id FROM attendance a LEFT JOIN workers w ON w.id = a.worker_id WHERE a.site_id=? AND a.work_date=? AND a.punch_out IS NULL`
    ).all(req.params.id, today);
    const todayAttendance = db.prepare(
      `SELECT a.*, w.trade FROM attendance a LEFT JOIN workers w ON w.id = a.worker_id WHERE a.site_id=? AND a.work_date=?`
    ).all(req.params.id, today);
    const openInstructions = db.prepare(
      `SELECT * FROM site_instructions WHERE site_id=? AND status NOT IN ('Closed') ORDER BY priority DESC, created_at DESC`
    ).all(req.params.id);
    const pendingLeave = db.prepare(
      `SELECT lr.*, lt.name as leave_type_name FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id WHERE lr.project_id=? AND lr.status='Pending' ORDER BY lr.created_at DESC`
    ).all(site.project_id);
    res.json({ site, present_workers: presentWorkers, today_attendance: todayAttendance, open_instructions: openInstructions, pending_leave: pendingLeave, today: today });
  });

  // --- WORKERS ---
  app.get('/api/workers', authRequired, (req, res) => {
    if (!canView(req.user!, 'workers')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const siteId = req.query.site_id as string;
    const scoped = projectScopeSql(req.user!, projectId, 'w.project_id');
    if (!scoped.where) { res.status(403).json({ error: 'No project access' }); return; }
    let where = scoped.where;
    const params: any[] = [...scoped.params];

    if (siteId) {
      const site = db.prepare('SELECT * FROM sites WHERE id=?').get(siteId) as any;
      if (!site || !canAccessSite(req.user!, site, 'view')) { res.status(403).json({ error: 'No site access' }); return; }
      where += ' AND w.site_id=?';
      params.push(siteId);
    }

    if (req.user!.role === 'SiteSupervisor') {
      where += " AND EXISTS (SELECT 1 FROM worker_assignments wa WHERE wa.worker_id=w.id AND wa.supervisor_id=? AND wa.status='Active')";
      params.push(req.user!.user_id);
    } else if (req.user!.role === 'Worker') {
      where += ' AND w.user_id=?';
      params.push(req.user!.user_id);
    } else if (req.user!.role === 'Subcontractor') {
      if (!req.user!.company_id) { res.json([]); return; }
      where += ' AND w.company_id=?';
      params.push(req.user!.company_id);
      if (req.user!.work_package_id) {
        where += ' AND (w.work_package_id=? OR EXISTS (SELECT 1 FROM worker_assignments wa WHERE wa.worker_id=w.id AND wa.work_package_id=? AND wa.status=\'Active\'))';
        params.push(req.user!.work_package_id, req.user!.work_package_id);
      }
    }

    const rows = db.prepare(
      'SELECT w.*, c.name as company_name FROM workers w LEFT JOIN companies c ON c.id=w.company_id WHERE ' + where + ' ORDER BY w.name'
    ).all(...params) as any[];
    res.json(rows.filter(row => canAccessWorker(req.user!, row, 'view')).map(rowToDict));
  });

  app.post('/api/workers', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'workers')) { res.status(403).json({ error: 'No edit access' }); return; }
    const { project_id, site_id, company_id, user_id, name, employee_id, trade, employment_type, nationality, phone, email, supervisor_id, work_package_id } = req.body;
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    if (project_id && !hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }

    if (site_id) {
      const site = db.prepare('SELECT * FROM sites WHERE id=?').get(site_id) as any;
      if (!site || site.project_id !== project_id || site.status !== 'Active') { res.status(422).json({ error: 'site_id must be an active site in the project' }); return; }
    }
    if (company_id && project_id) {
      const pc = db.prepare('SELECT 1 FROM project_companies WHERE project_id=? AND company_id=?').get(project_id, company_id);
      if (!pc) { res.status(422).json({ error: 'company_id must participate in the project' }); return; }
    }
    if (work_package_id) {
      const wp = db.prepare('SELECT * FROM work_packages WHERE id=?').get(work_package_id) as any;
      if (!wp || wp.project_id !== project_id || (company_id && wp.company_id && wp.company_id !== company_id)) {
        res.status(422).json({ error: 'work_package_id is not valid for this project/company' }); return;
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO workers (id,project_id,site_id,company_id,user_id,name,employee_id,trade,employment_type,nationality,phone,email,supervisor_id,work_package_id,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, project_id||null, site_id||null, company_id||null, user_id||null, name, employee_id||null, trade||null, employment_type||'Permanent', nationality||null, phone||null, email||null, supervisor_id||null, work_package_id||null, 'Active', now);
    if (user_id) db.prepare('UPDATE users SET worker_id=? WHERE id=?').run(id, user_id);
    writeAudit(req.user!.user_id, 'workers', id, project_id||null, 'create', null, { name, company_id, site_id, work_package_id });
    res.status(201).json(db.prepare('SELECT * FROM workers WHERE id=?').get(id));
  });

  app.get('/api/workers/:id', authRequired, (req, res) => {
    if (!canView(req.user!, 'workers')) { res.status(403).json({ error: 'No access' }); return; }
    const worker = db.prepare('SELECT w.*, c.name as company_name FROM workers w LEFT JOIN companies c ON c.id=w.company_id WHERE w.id=?').get(req.params.id) as any;
    if (!worker) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessWorker(req.user!, worker, 'view')) { res.status(403).json({ error: 'No access' }); return; }
    res.json(rowToDict(worker));
  });

  app.put('/api/workers/:id', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'workers')) { res.status(403).json({ error: 'No edit access' }); return; }
    const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(req.params.id) as any;
    if (!worker) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessWorker(req.user!, worker, 'edit')) { res.status(403).json({ error: 'No access' }); return; }

    const { name, trade, employment_type, nationality, phone, email, supervisor_id, site_id, status, work_package_id } = req.body;
    if (site_id) {
      const site = db.prepare('SELECT * FROM sites WHERE id=?').get(site_id) as any;
      if (!site || site.project_id !== worker.project_id) { res.status(422).json({ error: 'site_id must belong to worker project' }); return; }
    }
    if (work_package_id) {
      const wp = db.prepare('SELECT * FROM work_packages WHERE id=?').get(work_package_id) as any;
      if (!wp || wp.project_id !== worker.project_id || (worker.company_id && wp.company_id && wp.company_id !== worker.company_id)) {
        res.status(422).json({ error: 'work_package_id is not valid for worker project/company' }); return;
      }
    }

    db.prepare('UPDATE workers SET name=COALESCE(?,name),trade=COALESCE(?,trade),employment_type=COALESCE(?,employment_type),nationality=COALESCE(?,nationality),phone=COALESCE(?,phone),email=COALESCE(?,email),supervisor_id=COALESCE(?,supervisor_id),site_id=COALESCE(?,site_id),status=COALESCE(?,status),work_package_id=COALESCE(?,work_package_id) WHERE id=?')
      .run(name||null, trade||null, employment_type||null, nationality||null, phone||null, email||null, supervisor_id||null, site_id||null, status||null, work_package_id||null, req.params.id);
    writeAudit(req.user!.user_id, 'workers', req.params.id, worker.project_id, 'update', worker, req.body);
    res.json(db.prepare('SELECT * FROM workers WHERE id=?').get(req.params.id));
  });

  app.get('/api/workers/:id/profile', authRequired, (req, res) => {
    if (!canView(req.user!, 'workers')) { res.status(403).json({ error: 'No access' }); return; }
    const worker = db.prepare('SELECT w.*, c.name as company_name FROM workers w LEFT JOIN companies c ON c.id=w.company_id WHERE w.id=?').get(req.params.id) as any;
    if (!worker) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessWorker(req.user!, worker, 'view')) { res.status(403).json({ error: 'No access' }); return; }
    const recentAttendance = db.prepare('SELECT * FROM attendance WHERE worker_id=? ORDER BY work_date DESC LIMIT 30').all(req.params.id);
    const tasks = db.prepare('SELECT * FROM tasks WHERE assigned_worker_id=? ORDER BY start DESC LIMIT 20').all(req.params.id);
    const instructions = db.prepare('SELECT * FROM site_instructions WHERE assigned_worker_id=? ORDER BY created_at DESC LIMIT 20').all(req.params.id);
    const leaveRequests = db.prepare('SELECT lr.*, lt.name as leave_type_name FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id WHERE lr.worker_id=? ORDER BY lr.created_at DESC LIMIT 20').all(req.params.id);
    const payrollEntries = canAccessPayroll(req.user!)
      ? db.prepare('SELECT pe.*, pp.period_name, pp.period_start, pp.period_end FROM payroll_entries pe JOIN payroll_periods pp ON pp.id=pe.payroll_period_id WHERE pe.worker_id=? ORDER BY pp.period_start DESC LIMIT 12').all(req.params.id)
      : [];
    res.json({ worker: rowToDict(worker), attendance: recentAttendance, tasks, instructions, leave_requests: leaveRequests, payroll_entries: payrollEntries });
  });

  // --- WORKER ASSIGNMENTS ---
  app.get('/api/worker_assignments', authRequired, (req, res) => {
    if (!canView(req.user!, 'worker_assignments')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const scoped = projectScopeSql(req.user!, projectId, 'wa.project_id');
    if (!scoped.where) { res.status(403).json({ error: 'No project access' }); return; }
    let where = scoped.where;
    const params = [...scoped.params];
    if (req.user!.role === 'Worker') {
      const worker = getWorkerPrincipal(req.user!.user_id);
      if (!worker) { res.json([]); return; }
      where += ' AND wa.worker_id=?'; params.push(worker.id);
    } else if (req.user!.role === 'SiteSupervisor') {
      where += ' AND wa.supervisor_id=?'; params.push(req.user!.user_id);
    } else if (req.user!.role === 'Subcontractor') {
      if (!req.user!.company_id) { res.json([]); return; }
      where += ' AND w.company_id=?'; params.push(req.user!.company_id);
    }
    const rows = db.prepare(
      'SELECT wa.*, w.name as worker_name, w.trade, w.company_id, s.name as site_name FROM worker_assignments wa ' +
      'LEFT JOIN workers w ON w.id=wa.worker_id LEFT JOIN sites s ON s.id=wa.site_id WHERE ' + where + ' ORDER BY wa.created_at DESC'
    ).all(...params);
    res.json(rows);
  });

  app.post('/api/worker_assignments', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'worker_assignments')) { res.status(403).json({ error: 'No edit access' }); return; }
    const { worker_id, project_id, site_id, work_package_id, supervisor_id, role_on_site, start_date, end_date } = req.body;
    if (!worker_id || !project_id || !site_id) { res.status(400).json({ error: 'worker_id, project_id and site_id required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }

    const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(worker_id) as any;
    if (!worker || worker.status !== 'Active') { res.status(422).json({ error: 'Active worker required' }); return; }
    if (worker.project_id && worker.project_id !== project_id) { res.status(422).json({ error: 'Worker belongs to another project' }); return; }
    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(site_id) as any;
    if (!site || site.project_id !== project_id || site.status !== 'Active') { res.status(422).json({ error: 'Active site in the same project required' }); return; }
    if (work_package_id) {
      const wp = db.prepare('SELECT * FROM work_packages WHERE id=?').get(work_package_id) as any;
      if (!wp || wp.project_id !== project_id || (worker.company_id && wp.company_id && wp.company_id !== worker.company_id)) {
        res.status(422).json({ error: 'Invalid work package for worker project/company' }); return;
      }
    }
    if (start_date && end_date && end_date < start_date) { res.status(422).json({ error: 'end_date cannot precede start_date' }); return; }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO worker_assignments (id,worker_id,project_id,site_id,work_package_id,supervisor_id,role_on_site,start_date,end_date,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, worker_id, project_id, site_id, work_package_id||null, supervisor_id||null, role_on_site||null, start_date||null, end_date||null, 'Active', now);
    db.prepare('UPDATE workers SET site_id=?,work_package_id=COALESCE(?,work_package_id),supervisor_id=COALESCE(?,supervisor_id) WHERE id=?')
      .run(site_id, work_package_id||null, supervisor_id||null, worker_id);
    writeAudit(req.user!.user_id, 'worker_assignments', id, project_id, 'create', null, req.body);
    res.status(201).json(db.prepare('SELECT * FROM worker_assignments WHERE id=?').get(id));
  });

  app.delete('/api/worker_assignments/:id', authRequired, (req, res) => {
    if (!canDelete(req.user!)) { res.status(403).json({ error: 'No delete access' }); return; }
    const wa = db.prepare('SELECT * FROM worker_assignments WHERE id=?').get(req.params.id) as any;
    if (!wa) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, wa.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    db.prepare('DELETE FROM worker_assignments WHERE id=?').run(req.params.id);
    writeAudit(req.user!.user_id, 'worker_assignments', req.params.id, wa.project_id, 'delete', wa, null);
    res.json({ ok: true });
  });

  // --- LIVE WORKFORCE DASHBOARD ---
  app.get('/api/workforce/today', authRequired, (req, res) => {
    if (!canView(req.user!, 'workforce')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const siteId = req.query.site_id as string;
    const scoped = projectScopeSql(req.user!, projectId, 'wa.project_id');
    if (!scoped.where) { res.status(403).json({ error: 'No project access' }); return; }

    if (siteId) {
      const site = db.prepare('SELECT * FROM sites WHERE id=?').get(siteId) as any;
      if (!site || !canAccessSite(req.user!, site, 'view')) { res.status(403).json({ error: 'No site access' }); return; }
    }

    let where = scoped.where + " AND wa.status='Active' AND w.status='Active' AND s.status='Active'";
    const params: any[] = [...scoped.params];
    if (siteId) { where += ' AND wa.site_id=?'; params.push(siteId); }
    if (req.user!.role === 'SiteSupervisor') { where += ' AND wa.supervisor_id=?'; params.push(req.user!.user_id); }
    if (req.user!.role === 'Subcontractor') {
      if (!req.user!.company_id) { res.json({ today: null, expected_count: 0, present_count: 0, late_count: 0, leave_count: 0, sick_count: 0, absent_count: 0, not_punched_count: 0, exception_count: 0, workers: [] }); return; }
      where += ' AND w.company_id=?'; params.push(req.user!.company_id);
    }
    if (req.user!.role === 'Worker') {
      const worker = getWorkerPrincipal(req.user!.user_id);
      if (!worker) { res.status(403).json({ error: 'Worker profile required' }); return; }
      where += ' AND wa.worker_id=?'; params.push(worker.id);
    }

    const assignments = db.prepare(
      'SELECT wa.*, w.name as worker_name, w.user_id, w.trade, w.employment_type, w.employee_id, w.company_id, ' +
      'c.name as company_name, s.name as site_name, s.timezone FROM worker_assignments wa ' +
      'JOIN workers w ON w.id=wa.worker_id JOIN sites s ON s.id=wa.site_id ' +
      'LEFT JOIN companies c ON c.id=w.company_id WHERE ' + where + ' ORDER BY s.name,w.name'
    ).all(...params) as any[];

    const now = new Date();
    const workerRows: any[] = [];
    const seen = new Set<string>();
    for (const a of assignments) {
      const workDate = zonedParts(now, a.timezone || 'UTC').date;
      if ((a.start_date && a.start_date > workDate) || (a.end_date && a.end_date < workDate)) continue;
      const key = a.worker_id + ':' + a.site_id;
      if (seen.has(key)) continue;
      seen.add(key);
      const status = calculateDailyAttendanceStatus(a.worker_id, a.project_id, a.site_id, workDate);
      const attendance = db.prepare('SELECT * FROM attendance WHERE worker_id=? AND project_id=? AND site_id=? AND work_date=? ORDER BY punch_in DESC LIMIT 1')
        .get(a.worker_id, a.project_id, a.site_id, workDate) as any;
      workerRows.push({
        worker_id: a.worker_id,
        worker_name: a.worker_name,
        employee_id: a.employee_id,
        company_id: a.company_id,
        company_name: a.company_name,
        trade: a.trade,
        project_id: a.project_id,
        site_id: a.site_id,
        site_name: a.site_name,
        work_package_id: a.work_package_id,
        supervisor_id: a.supervisor_id,
        work_date: workDate,
        status,
        punch_in: attendance?.punch_in || null,
        punch_out: attendance?.punch_out || null,
        late_minutes: attendance?.late_minutes || 0,
        geofence_status: attendance?.punch_in_geofence_status || null,
      });
    }

    const activePresent = workerRows.filter(w => w.punch_in && !w.punch_out);
    const late = workerRows.filter(w => w.status === 'Late');
    const leave = workerRows.filter(w => w.status === 'Annual Leave' || w.status === 'Leave');
    const sick = workerRows.filter(w => w.status === 'Sick Leave');
    const absent = workerRows.filter(w => w.status === 'Absent');
    const exceptions = workerRows.filter(w => w.status === 'Attendance Exception');
    const expected = workerRows.filter(w => !['Rest Day','Public Holiday'].includes(w.status));
    const pendingOt = workerRows.flatMap(w => {
      const row = db.prepare("SELECT * FROM attendance WHERE worker_id=? AND project_id=? AND work_date=? AND raw_overtime_minutes>0 AND ot_status='Pending' ORDER BY punch_in DESC LIMIT 1")
        .get(w.worker_id, w.project_id, w.work_date) as any;
      return row ? [{ ...row, worker_name: w.worker_name }] : [];
    });
    const todayValues = [...new Set(workerRows.map(w => w.work_date))];

    res.json({
      today: todayValues.length === 1 ? todayValues[0] : null,
      dates_by_timezone: todayValues,
      expected_count: expected.length,
      present_count: activePresent.length,
      completed_count: workerRows.filter(w => w.punch_out).length,
      late_count: late.length,
      leave_count: leave.length,
      sick_count: sick.length,
      absent_count: absent.length,
      not_punched_count: absent.length,
      exception_count: exceptions.length,
      workers: workerRows,
      present_workers: activePresent,
      exceptions,
      pending_overtime: pendingOt,
    });
  });

  // Workforce calendar (per worker per day P/L/A status)
  app.get('/api/workforce/calendar', authRequired, (req, res) => {
    if (!canView(req.user!, 'workforce')) { res.status(403).json({ error: 'No access' }); return; }
    const { project_id, worker_id, month, year } = req.query as any;
    if (!project_id) { res.status(400).json({ error: 'project_id required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const y = parseInt(year || new Date().getFullYear().toString());
    const m = parseInt(month || (new Date().getMonth()+1).toString());
    const startDate = `${y}-${String(m).padStart(2,'0')}-01`;
    const endDate = `${y}-${String(m).padStart(2,'0')}-31`;
    let where = 'a.project_id=? AND a.work_date>=? AND a.work_date<=?';
    const params: any[] = [project_id, startDate, endDate];
    if (worker_id) { where += ' AND a.worker_id=?'; params.push(worker_id); }
    if (req.user!.role === 'Worker') {
      const workerRow = db.prepare('SELECT id FROM workers WHERE user_id=?').get(req.user!.user_id) as any;
      if (workerRow) { where += ' AND a.worker_id=?'; params.push(workerRow.id); }
    }
    const attendance = db.prepare(`SELECT a.work_date, a.worker_id, a.punch_in, a.punch_out, a.status, a.regular_hours, a.overtime_hours, w.name as worker_name FROM attendance a LEFT JOIN workers w ON w.id=a.worker_id WHERE ${where} ORDER BY a.work_date, w.name`).all(...params);
    const leaves = db.prepare(`SELECT lr.*, lt.code as leave_code FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id WHERE lr.project_id=? AND lr.start_date<=? AND lr.end_date>=? AND lr.status='Approved'`).all(project_id, endDate, startDate);
    res.json({ year: y, month: m, attendance, approved_leaves: leaves });
  });

  // GPS-aware punch-in (server-time authority, server-side Haversine geofencing)
  app.post('/api/attendance/gps-punch-in', authRequired, (req, res) => {
    const projectId = String(req.body?.project_id || '');
    const siteId = String(req.body?.site_id || '');
    if (!projectId || !siteId) { res.status(400).json({ error: 'project_id and site_id required' }); return; }
    if (!hasProjectAccess(req.user!, projectId)) { res.status(403).json({ error: 'No project access' }); return; }
    if (!canEdit(req.user!, 'attendance')) { res.status(403).json({ error: 'No edit access' }); return; }

    const worker = getWorkerPrincipal(req.user!.user_id);
    if (!worker || worker.status !== 'Active') { res.status(403).json({ error: 'Active worker profile required' }); return; }

    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(siteId) as any;
    if (!site || site.status !== 'Active' || site.project_id !== projectId) {
      res.status(403).json({ error: 'Worker is not authorized for this active project site' }); return;
    }

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const resolved = resolveWorkDateForPunch(worker.id, site, nowDate);
    const assignment = getActiveWorkerAssignment(worker.id, projectId, siteId, resolved.workDate);
    if (!assignment) { res.status(403).json({ error: 'No active worker assignment for this project, site and work date' }); return; }

    const active = db.prepare('SELECT id FROM attendance WHERE user_id=? AND punch_out IS NULL').get(req.user!.user_id);
    if (active) { res.status(409).json({ error: 'Already punched in' }); return; }

    const { lat, lng, accuracy } = req.body;
    const latitude = Number(lat);
    const longitude = Number(lng);
    const accuracyM = Number(accuracy);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        !Number.isFinite(accuracyM) || accuracyM < 0) {
      res.status(400).json({ error: 'Valid lat, lng and non-negative GPS accuracy are required' }); return;
    }
    if (site.latitude == null || site.longitude == null) {
      res.status(409).json({ error: 'Site GPS coordinates are not configured' }); return;
    }
    let geofence: string | null = null;
    let distanceM: number | null = null;
    {
      distanceM = haversineDistance(latitude, longitude, site.latitude, site.longitude);
      geofence = geofenceStatus(distanceM, site, accuracyM);
    }

    const shift = resolved.shift || getWorkerShift(worker.id, resolved.workDate);
    const id = crypto.randomUUID();
    const notes = req.body?.shift_notes || req.body?.notes || '';
    db.prepare(
      'INSERT INTO attendance (id,project_id,user_id,worker,work_date,punch_in,punch_out,status,notes,site_id,worker_id,' +
      'punch_in_lat,punch_in_lng,punch_in_accuracy,punch_in_geofence_status,punch_in_distance_m,shift_template_id,' +
      'company_id,work_package_id,supervisor_id,elapsed_minutes,regular_minutes,break_minutes,raw_overtime_minutes,' +
      'approved_overtime_minutes,late_minutes,attendance_status,ot_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      id, projectId, req.user!.user_id, worker.name || req.user!.name, resolved.workDate, now, null, 'Open', notes,
      siteId, worker.id, latitude, longitude,
      accuracyM, geofence, distanceM, shift?.id || null,
      worker.company_id || null, assignment.work_package_id || worker.work_package_id || null,
      assignment.supervisor_id || worker.supervisor_id || null, 0, 0, 0, 0, 0, 0,
      geofence && geofence !== 'Valid' ? 'Attendance Exception' : 'Present', 'None'
    );
    const created = recalculateAttendanceRecord(id) || db.prepare('SELECT * FROM attendance WHERE id=?').get(id);
    writeAudit(req.user!.user_id, 'attendance', id, projectId, 'gps_punch_in', null, {
      worker_id: worker.id, site_id: siteId, work_date: resolved.workDate, punch_in: now, geofence, distance_m: distanceM
    });
    res.status(201).json(created);
  });

  

  // GPS-aware punch-out (server-time authority, server-side Haversine geofencing)
  app.post('/api/attendance/gps-punch-out', authRequired, (req, res) => {
    const active = db.prepare('SELECT * FROM attendance WHERE user_id=? AND punch_out IS NULL').get(req.user!.user_id) as any;
    if (!active) { res.status(409).json({ error: 'Not punched in' }); return; }
    if (!canAccessAttendance(req.user!, active, 'edit')) { res.status(403).json({ error: 'No access' }); return; }

    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(active.site_id) as any;
    if (!site || site.project_id !== active.project_id) { res.status(409).json({ error: 'Attendance site is no longer valid for the project' }); return; }

    const { lat, lng, accuracy } = req.body;
    const latitude = Number(lat);
    const longitude = Number(lng);
    const accuracyM = Number(accuracy);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        !Number.isFinite(accuracyM) || accuracyM < 0) {
      res.status(400).json({ error: 'Valid lat, lng and non-negative GPS accuracy are required' }); return;
    }
    if (site.latitude == null || site.longitude == null) {
      res.status(409).json({ error: 'Site GPS coordinates are not configured' }); return;
    }
    const now = new Date().toISOString();
    let geofence: string | null = null;
    let distanceM: number | null = null;
    {
      distanceM = haversineDistance(latitude, longitude, site.latitude, site.longitude);
      geofence = geofenceStatus(distanceM, site, accuracyM);
    }

    db.prepare(
      "UPDATE attendance SET punch_out=?,status='Closed',punch_out_lat=?,punch_out_lng=?,punch_out_accuracy=?," +
      "punch_out_geofence_status=?,punch_out_distance_m=? WHERE id=?"
    ).run(
      now, latitude, longitude,
      accuracyM, geofence, distanceM, active.id
    );

    let updated = recalculateAttendanceRecord(active.id) as any;
    const nextOtStatus = (updated?.raw_overtime_minutes || 0) > 0 ? 'Pending' : 'None';
    db.prepare('UPDATE attendance SET ot_status=?,approved_overtime_minutes=0,ot_approved_by=NULL,ot_approved_at=NULL,ot_reject_reason=NULL WHERE id=?')
      .run(nextOtStatus, active.id);
    updated = db.prepare('SELECT * FROM attendance WHERE id=?').get(active.id) as any;
    writeAudit(req.user!.user_id, 'attendance', active.id, active.project_id, 'gps_punch_out', active, {
      punch_out: now,
      elapsed_minutes: updated.elapsed_minutes,
      break_minutes: updated.break_minutes,
      regular_minutes: updated.regular_minutes,
      raw_overtime_minutes: updated.raw_overtime_minutes,
      geofence,
    });
    res.json(updated);
  });

  

  // Attendance exceptions (missing punch / geofence violations)
  app.get('/api/attendance/exceptions', authRequired, (req, res) => {
    if (!canView(req.user!, 'attendance')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const scoped = projectScopeSql(req.user!, projectId, 'a.project_id');
    if (!scoped.where) { res.status(403).json({ error: 'No project access' }); return; }

    const days = Math.max(1, Math.min(90, parseInt(req.query.days as string || '7', 10) || 7));
    const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    let where = scoped.where + ' AND a.work_date>=?';
    const params: any[] = [...scoped.params, since];

    if (req.user!.role === 'Worker') {
      where += ' AND a.user_id=?'; params.push(req.user!.user_id);
    } else if (req.user!.role === 'Subcontractor') {
      if (!req.user!.company_id) { res.json([]); return; }
      where += ' AND w.company_id=?'; params.push(req.user!.company_id);
    } else if (req.user!.role === 'SiteSupervisor') {
      where += " AND EXISTS (SELECT 1 FROM worker_assignments wa WHERE wa.worker_id=a.worker_id AND wa.project_id=a.project_id AND wa.supervisor_id=? AND wa.status='Active')";
      params.push(req.user!.user_id);
    }

    const rows = db.prepare(
      "SELECT a.*, w.name as worker_name, w.trade, w.company_id as worker_company_id, s.name as site_name " +
      "FROM attendance a LEFT JOIN workers w ON w.id=a.worker_id LEFT JOIN sites s ON s.id=a.site_id WHERE " +
      where + " AND ((a.punch_out IS NULL AND a.work_date < date('now')) " +
      "OR a.punch_in_geofence_status IN ('Outside Geofence','GPS Accuracy Poor') " +
      "OR a.punch_out_geofence_status IN ('Outside Geofence','GPS Accuracy Poor') " +
      "OR a.attendance_status='Attendance Exception') ORDER BY a.work_date DESC"
    ).all(...params) as any[];

    res.json(rows.filter(row => canAccessAttendance(req.user!, row, 'view')));
  });

  // Overtime approval (blocks self-approval)
  app.post('/api/attendance/:id/overtime-approve', authRequired, (req, res) => {
    if (!['Admin','ProjectManager','SiteSupervisor'].includes(req.user!.role)) { res.status(403).json({ error: 'No approval authority' }); return; }
    const record = db.prepare('SELECT * FROM attendance WHERE id=?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessAttendance(req.user!, record, 'edit')) { res.status(403).json({ error: 'No access' }); return; }
    if (record.user_id === req.user!.user_id) { res.status(403).json({ error: 'Cannot approve own overtime' }); return; }

    const { action, reject_reason } = req.body;
    if (!['Approved','Rejected'].includes(action)) { res.status(400).json({ error: 'action must be Approved or Rejected' }); return; }
    const now = new Date().toISOString();
    const approvedMinutes = action === 'Approved' ? Number(record.raw_overtime_minutes || 0) : 0;
    db.prepare('UPDATE attendance SET ot_status=?,approved_overtime_minutes=?,ot_approved_by=?,ot_approved_at=?,ot_reject_reason=? WHERE id=?')
      .run(action, approvedMinutes, req.user!.user_id, now, action === 'Rejected' ? (reject_reason||null) : null, req.params.id);
    writeAudit(req.user!.user_id, 'attendance', req.params.id, record.project_id, `ot_${action.toLowerCase()}`, record, { action, approved_overtime_minutes: approvedMinutes });
    createNotification(record.user_id, record.project_id, 'attendance', req.params.id, `Overtime ${action}`, `Your overtime for ${record.work_date} was ${action.toLowerCase()} by ${req.user!.name}`);
    res.json(db.prepare('SELECT * FROM attendance WHERE id=?').get(req.params.id));
  });

  

  // Attendance adjustment (correction request)
  app.post('/api/attendance/:id/adjust', authRequired, (req, res) => {
    const record = db.prepare('SELECT * FROM attendance WHERE id=?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessAttendance(req.user!, record, 'edit')) { res.status(403).json({ error: 'No access' }); return; }
    if (req.user!.role === 'Worker' && record.user_id !== req.user!.user_id) { res.status(403).json({ error: 'Workers may only correct their own attendance' }); return; }

    const { adjusted_punch_in, adjusted_punch_out, adjustment_reason } = req.body;
    if (!adjustment_reason) { res.status(400).json({ error: 'adjustment_reason required' }); return; }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO attendance_adjustments (id,attendance_id,project_id,worker_id,user_id,original_punch_in,original_punch_out,adjusted_punch_in,adjusted_punch_out,adjustment_reason,status,submitted_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, req.params.id, record.project_id, record.worker_id||null, record.user_id, record.punch_in, record.punch_out, adjusted_punch_in||null, adjusted_punch_out||null, adjustment_reason, 'Pending', req.user!.user_id, now);
    writeAudit(req.user!.user_id, 'attendance_adjustments', id, record.project_id, 'submit', null, req.body);
    res.status(201).json(db.prepare('SELECT * FROM attendance_adjustments WHERE id=?').get(id));
  });

  app.post('/api/attendance_adjustments/:id/approve', authRequired, (req, res) => {
    if (!['Admin','ProjectManager','SiteSupervisor'].includes(req.user!.role)) { res.status(403).json({ error: 'No approval authority' }); return; }
    const adj = db.prepare('SELECT * FROM attendance_adjustments WHERE id=?').get(req.params.id) as any;
    if (!adj) { res.status(404).json({ error: 'Not found' }); return; }
    const record = db.prepare('SELECT * FROM attendance WHERE id=?').get(adj.attendance_id) as any;
    if (!record || !canAccessAttendance(req.user!, record, 'edit')) { res.status(403).json({ error: 'No access' }); return; }
    if (adj.submitted_by === req.user!.user_id || record.user_id === req.user!.user_id) { res.status(403).json({ error: 'Cannot approve own adjustment' }); return; }

    const { action, reject_reason } = req.body;
    if (!['Approved','Rejected'].includes(action)) { res.status(400).json({ error: 'action must be Approved or Rejected' }); return; }
    const now = new Date().toISOString();
    db.prepare('UPDATE attendance_adjustments SET status=?,approved_by=?,approved_at=?,reject_reason=? WHERE id=?')
      .run(action, req.user!.user_id, now, reject_reason||null, req.params.id);

    if (action === 'Approved') {
      if (adj.adjusted_punch_in) db.prepare('UPDATE attendance SET punch_in=? WHERE id=?').run(adj.adjusted_punch_in, adj.attendance_id);
      if (adj.adjusted_punch_out) db.prepare('UPDATE attendance SET punch_out=?,status=\'Closed\' WHERE id=?').run(adj.adjusted_punch_out, adj.attendance_id);
      if (adj.adjusted_punch_in && record.worker_id && record.site_id) {
        const site = db.prepare('SELECT * FROM sites WHERE id=?').get(record.site_id) as any;
        if (site) {
          const resolved = resolveWorkDateForPunch(record.worker_id, site, new Date(adj.adjusted_punch_in));
          db.prepare('UPDATE attendance SET work_date=?,shift_template_id=? WHERE id=?').run(resolved.workDate, resolved.shift?.id || record.shift_template_id || null, adj.attendance_id);
        }
      }
      const recalculated = recalculateAttendanceRecord(adj.attendance_id) as any;
      const approvedMinutes = recalculated?.ot_status === 'Approved' ? Number(recalculated.raw_overtime_minutes || 0) : 0;
      db.prepare('UPDATE attendance SET approved_overtime_minutes=? WHERE id=?').run(approvedMinutes, adj.attendance_id);
    }

    writeAudit(req.user!.user_id, 'attendance_adjustments', req.params.id, adj.project_id, action.toLowerCase(), adj, { action });
    createNotification(adj.user_id, adj.project_id, 'attendance', adj.attendance_id, `Attendance Adjustment ${action}`, `Your attendance correction request was ${action.toLowerCase()}`);
    res.json(db.prepare('SELECT * FROM attendance_adjustments WHERE id=?').get(req.params.id));
  });

  

  // --- SHIFT TEMPLATES ---
  app.get('/api/shift_templates', authRequired, (req, res) => {
    if (!canView(req.user!, 'shift_templates')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId);
    if (!where) { res.status(403).json({ error: 'No project access' }); return; }
    res.json(db.prepare('SELECT * FROM shift_templates WHERE ' + where + ' ORDER BY name').all(...params));
  });

  app.post('/api/shift_templates', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'shift_templates')) { res.status(403).json({ error: 'No edit access' }); return; }
    const { project_id, name, start_time, end_time, grace_minutes, break_minutes, regular_hours, ot_threshold_hours, working_days_json } = req.body;
    if (!project_id || !name || !start_time || !end_time) { res.status(400).json({ error: 'project_id, name, start_time, end_time required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const workingDays = JSON.stringify(parseWorkingDays(working_days_json));
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO shift_templates (id,project_id,name,start_time,end_time,grace_minutes,break_minutes,regular_hours,ot_threshold_hours,status,created_at,working_days_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, project_id, name, start_time, end_time, grace_minutes??15, break_minutes??60, regular_hours??8, ot_threshold_hours??8, 'Active', now, workingDays);
    res.status(201).json(db.prepare('SELECT * FROM shift_templates WHERE id=?').get(id));
  });

  app.put('/api/shift_templates/:id', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'shift_templates')) { res.status(403).json({ error: 'No edit access' }); return; }
    const tmpl = db.prepare('SELECT * FROM shift_templates WHERE id=?').get(req.params.id) as any;
    if (!tmpl) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, tmpl.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const { name, start_time, end_time, grace_minutes, break_minutes, regular_hours, ot_threshold_hours, status, working_days_json } = req.body;
    const workingDays = working_days_json === undefined ? null : JSON.stringify(parseWorkingDays(working_days_json));
    db.prepare('UPDATE shift_templates SET name=COALESCE(?,name),start_time=COALESCE(?,start_time),end_time=COALESCE(?,end_time),grace_minutes=COALESCE(?,grace_minutes),break_minutes=COALESCE(?,break_minutes),regular_hours=COALESCE(?,regular_hours),ot_threshold_hours=COALESCE(?,ot_threshold_hours),status=COALESCE(?,status),working_days_json=COALESCE(?,working_days_json) WHERE id=?')
      .run(name||null, start_time||null, end_time||null, grace_minutes??null, break_minutes??null, regular_hours??null, ot_threshold_hours??null, status||null, workingDays, req.params.id);
    res.json(db.prepare('SELECT * FROM shift_templates WHERE id=?').get(req.params.id));
  });

  app.get('/api/worker_schedules', authRequired, (req, res) => {
    const projectId = req.query.project_id as string;
    const workerId = req.query.worker_id as string;
    if (!projectId || !hasProjectAccess(req.user!, projectId)) { res.status(403).json({ error: 'No project access' }); return; }
    let sql = 'SELECT ws.*, st.project_id, st.name as shift_name, st.start_time, st.end_time, st.working_days_json FROM worker_schedules ws JOIN shift_templates st ON st.id=ws.shift_template_id JOIN workers w ON w.id=ws.worker_id WHERE st.project_id=?';
    const params: any[] = [projectId];
    if (workerId) {
      const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(workerId) as any;
      if (!worker || !canAccessWorker(req.user!, worker, 'view')) { res.status(403).json({ error: 'No worker access' }); return; }
      sql += ' AND ws.worker_id=?'; params.push(workerId);
    }
    if (req.user!.role === 'Worker') {
      const worker = getWorkerPrincipal(req.user!.user_id);
      if (!worker) { res.json([]); return; }
      sql += ' AND ws.worker_id=?'; params.push(worker.id);
    } else if (req.user!.role === 'SiteSupervisor') {
      sql += " AND EXISTS (SELECT 1 FROM worker_assignments wa WHERE wa.worker_id=ws.worker_id AND wa.project_id=? AND wa.supervisor_id=? AND wa.status='Active')";
      params.push(projectId, req.user!.user_id);
    } else if (req.user!.role === 'Subcontractor') {
      if (!req.user!.company_id) { res.json([]); return; }
      sql += ' AND w.company_id=?'; params.push(req.user!.company_id);
    }
    sql += ' ORDER BY ws.effective_from DESC';
    res.json(db.prepare(sql).all(...params));
  });

  app.post('/api/worker_schedules', authRequired, (req, res) => {
    if (!['Admin','ProjectManager','SiteSupervisor'].includes(req.user!.role)) { res.status(403).json({ error: 'No schedule authority' }); return; }
    const { worker_id, shift_template_id, effective_from, effective_to } = req.body;
    if (!worker_id || !shift_template_id || !effective_from) { res.status(400).json({ error: 'worker_id, shift_template_id and effective_from required' }); return; }
    if (effective_to && effective_to < effective_from) { res.status(422).json({ error: 'effective_to cannot precede effective_from' }); return; }
    const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(worker_id) as any;
    const shift = db.prepare('SELECT * FROM shift_templates WHERE id=?').get(shift_template_id) as any;
    if (!worker || !shift) { res.status(404).json({ error: 'Worker or shift template not found' }); return; }
    if (!hasProjectAccess(req.user!, shift.project_id) || (worker.project_id && worker.project_id !== shift.project_id)) {
      res.status(403).json({ error: 'Worker and shift must be in an authorized project' }); return;
    }
    if (req.user!.role === 'SiteSupervisor' && !canAccessWorker(req.user!, worker, 'view')) {
      res.status(403).json({ error: 'No worker access' }); return;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO worker_schedules (id,worker_id,shift_template_id,effective_from,effective_to,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, worker_id, shift_template_id, effective_from, effective_to||null, now);
    writeAudit(req.user!.user_id, 'worker_schedules', id, shift.project_id, 'create', null, { worker_id, shift_template_id, effective_from, effective_to });
    res.status(201).json(db.prepare('SELECT * FROM worker_schedules WHERE id=?').get(id));
  });

  app.get('/api/public_holidays', authRequired, (req, res) => {
    const projectId = req.query.project_id as string;
    if (!projectId || !hasProjectAccess(req.user!, projectId)) { res.status(403).json({ error: 'No project access' }); return; }
    const siteId = req.query.site_id as string;
    let sql = 'SELECT * FROM public_holidays WHERE (project_id=? OR project_id IS NULL)';
    const params: any[] = [projectId];
    if (siteId) { sql += ' AND (site_id=? OR site_id IS NULL)'; params.push(siteId); }
    sql += ' ORDER BY holiday_date';
    res.json(db.prepare(sql).all(...params));
  });

  app.post('/api/public_holidays', authRequired, (req, res) => {
    if (!['Admin','ProjectManager'].includes(req.user!.role)) { res.status(403).json({ error: 'No edit access' }); return; }
    const { project_id, site_id, country_code, holiday_date, name, paid } = req.body;
    if (!project_id || !holiday_date || !name) { res.status(400).json({ error: 'project_id, holiday_date and name required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    if (site_id) {
      const site = db.prepare('SELECT * FROM sites WHERE id=?').get(site_id) as any;
      if (!site || site.project_id !== project_id) { res.status(422).json({ error: 'site_id must belong to project' }); return; }
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO public_holidays (id,project_id,site_id,country_code,holiday_date,name,paid,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, project_id, site_id||null, country_code||null, holiday_date, name, paid === false ? 0 : 1, now);
    res.status(201).json(db.prepare('SELECT * FROM public_holidays WHERE id=?').get(id));
  });

  

  // --- SITE INSTRUCTIONS ---
  app.get('/api/site_instructions', authRequired, (req, res) => {
    if (!canView(req.user!, 'site_instructions')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const scoped = projectScopeSql(req.user!, projectId, 'si.project_id');
    if (!scoped.where) { res.status(403).json({ error: 'No project access' }); return; }
    const rows = db.prepare(
      'SELECT si.*, w.name as assigned_worker_name, s.name as site_name FROM site_instructions si ' +
      'LEFT JOIN workers w ON w.id=si.assigned_worker_id LEFT JOIN sites s ON s.id=si.site_id WHERE ' +
      scoped.where + ' ORDER BY si.created_at DESC'
    ).all(...scoped.params) as any[];
    res.json(rows.filter(row => canAccessSiteInstruction(req.user!, row, 'view')));
  });

  app.post('/api/site_instructions', authRequired, (req, res) => {
    if (!['Admin','ProjectManager'].includes(req.user!.role)) { res.status(403).json({ error: 'Only Admin or ProjectManager can issue official site instructions' }); return; }
    const { project_id, site_id, work_package_id, instruction_type, title, description, priority, assigned_worker_id, assigned_supervisor_id, due_date, location, related_document_id, related_rfi_id, related_ncr_id, related_boq_item_id } = req.body;
    if (!project_id || !instruction_type || !title) { res.status(400).json({ error: 'project_id, instruction_type, title required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    if (site_id) {
      const site = db.prepare('SELECT * FROM sites WHERE id=?').get(site_id) as any;
      if (!site || site.project_id !== project_id || site.status !== 'Active') { res.status(422).json({ error: 'site_id must be an active site in this project' }); return; }
    }
    if (work_package_id) {
      const wp = db.prepare('SELECT * FROM work_packages WHERE id=?').get(work_package_id) as any;
      if (!wp || wp.project_id !== project_id) { res.status(422).json({ error: 'work_package_id must belong to project' }); return; }
    }
    if (assigned_worker_id) {
      const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(assigned_worker_id) as any;
      if (!worker || worker.status !== 'Active') { res.status(422).json({ error: 'Active assigned worker required' }); return; }
      if (site_id) {
        const workDate = due_date || zonedParts(new Date(), (db.prepare('SELECT timezone FROM sites WHERE id=?').get(site_id) as any)?.timezone || 'UTC').date;
        const assignment = getActiveWorkerAssignment(worker.id, project_id, site_id, workDate);
        if (!assignment) { res.status(422).json({ error: 'Assigned worker has no active assignment for this project/site' }); return; }
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM site_instructions WHERE project_id=?').get(project_id) as any;
    const instrNum = `SI-${String((countRow.cnt||0)+1).padStart(4,'0')}`;
    db.prepare('INSERT INTO site_instructions (id,project_id,site_id,work_package_id,instruction_number,instruction_type,title,description,priority,status,assigned_worker_id,assigned_supervisor_id,issued_by,issued_at,due_date,location,related_document_id,related_rfi_id,related_ncr_id,related_boq_item_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, project_id, site_id||null, work_package_id||null, instrNum, instruction_type, title, description||null, priority||'Medium', 'Draft', assigned_worker_id||null, assigned_supervisor_id||null, req.user!.user_id, now, due_date||null, location||null, related_document_id||null, related_rfi_id||null, related_ncr_id||null, related_boq_item_id||null, now);
    writeAudit(req.user!.user_id, 'site_instructions', id, project_id, 'create', null, { title, instruction_type });
    res.status(201).json(db.prepare('SELECT * FROM site_instructions WHERE id=?').get(id));
  });

  app.get('/api/site_instructions/:id', authRequired, (req, res) => {
    const instr = db.prepare('SELECT si.*, w.name as assigned_worker_name, s.name as site_name FROM site_instructions si LEFT JOIN workers w ON w.id=si.assigned_worker_id LEFT JOIN sites s ON s.id=si.site_id WHERE si.id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessSiteInstruction(req.user!, instr, 'view')) { res.status(403).json({ error: 'No access' }); return; }
    const updates = db.prepare('SELECT * FROM site_instruction_updates WHERE instruction_id=? ORDER BY created_at ASC').all(req.params.id);
    const attachments = db.prepare('SELECT * FROM site_instruction_attachments WHERE instruction_id=? ORDER BY created_at ASC').all(req.params.id);
    res.json({ ...instr, updates, attachments });
  });

  app.put('/api/site_instructions/:id', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessSiteInstruction(req.user!, instr, 'update')) { res.status(403).json({ error: 'No access' }); return; }
    if (!['Draft','Assigned'].includes(instr.status)) { res.status(400).json({ error: 'Can only edit Draft or Assigned instructions' }); return; }
    const { title, description, priority, due_date, location, assigned_worker_id, assigned_supervisor_id } = req.body;
    db.prepare('UPDATE site_instructions SET title=COALESCE(?,title),description=COALESCE(?,description),priority=COALESCE(?,priority),due_date=COALESCE(?,due_date),location=COALESCE(?,location),assigned_worker_id=COALESCE(?,assigned_worker_id),assigned_supervisor_id=COALESCE(?,assigned_supervisor_id) WHERE id=?')
      .run(title||null, description||null, priority||null, due_date||null, location||null, assigned_worker_id||null, assigned_supervisor_id||null, req.params.id);
    writeAudit(req.user!.user_id, 'site_instructions', req.params.id, instr.project_id, 'update', instr, req.body);
    res.json(db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id));
  });

  function advanceInstruction(instrId: string, newStatus: string, userId: string, userName: string, updateType: string, content: string, extraFields?: Record<string,any>): { error?: string; ok?: boolean; instruction?: any } {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(instrId) as any;
    if (!instr) return { error: 'Instruction not found' };
    const now = new Date().toISOString();
    const allowed = ((WORKFLOW_STATUSES.site_instructions as any)[instr.status] || []) as string[];
    if (!allowed.includes(newStatus)) return { error: `Cannot move from ${instr.status} to ${newStatus}` };
    const updateData: any = { status: newStatus, ...(extraFields||{}) };
    const setClauses = Object.keys(updateData).map((k: string) => `${k}=?`).join(',');
    db.prepare(`UPDATE site_instructions SET ${setClauses} WHERE id=?`).run(...(Object.values(updateData) as any[]), instrId);
    db.prepare('INSERT INTO site_instruction_updates (id,instruction_id,user_id,user_name,update_type,content,old_status,new_status,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(crypto.randomUUID(), instrId, userId, userName, updateType, content, instr.status, newStatus, now);
    return { ok: true, instruction: db.prepare('SELECT * FROM site_instructions WHERE id=?').get(instrId) };
  }

  app.post('/api/site_instructions/:id/assign', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessSiteInstruction(req.user!, instr, 'assign')) { res.status(403).json({ error: 'No assignment authority' }); return; }
    const { assigned_worker_id, assigned_supervisor_id } = req.body;
    if (!assigned_worker_id) { res.status(400).json({ error: 'assigned_worker_id required' }); return; }
    const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(assigned_worker_id) as any;
    if (!worker || worker.status !== 'Active') { res.status(422).json({ error: 'Active worker required' }); return; }
    if (instr.site_id) {
      const assignmentDate = instr.due_date || zonedParts(new Date(), (db.prepare('SELECT timezone FROM sites WHERE id=?').get(instr.site_id) as any)?.timezone || 'UTC').date;
      if (!getActiveWorkerAssignment(worker.id, instr.project_id, instr.site_id, assignmentDate)) {
        res.status(422).json({ error: 'Worker is not assigned to this instruction site/project' }); return;
      }
    }
    db.prepare('UPDATE site_instructions SET assigned_worker_id=?,assigned_supervisor_id=?,issued_at=? WHERE id=?')
      .run(assigned_worker_id, assigned_supervisor_id||null, new Date().toISOString(), req.params.id);
    const result = advanceInstruction(req.params.id, 'Assigned', req.user!.user_id, req.user!.name, 'Assignment', `Assigned by ${req.user!.name}`);
    if (result.error) { res.status(400).json(result); return; }
    if (worker.user_id) createNotification(worker.user_id, instr.project_id, 'site_instructions', req.params.id, `Instruction Assigned: ${instr.title}`, `You have been assigned instruction ${instr.instruction_number}`);
    writeAudit(req.user!.user_id, 'site_instructions', req.params.id, instr.project_id, 'assign', instr, req.body);
    res.json(result.instruction);
  });

  app.post('/api/site_instructions/:id/acknowledge', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (req.user!.role !== 'Worker' || !canAccessSiteInstruction(req.user!, instr, 'update')) { res.status(403).json({ error: 'Not assigned to you' }); return; }
    const now = new Date().toISOString();
    db.prepare('UPDATE site_instructions SET acknowledged_at=? WHERE id=?').run(now, req.params.id);
    const result = advanceInstruction(req.params.id, 'Acknowledged', req.user!.user_id, req.user!.name, 'Acknowledgement', req.body.comment||'Acknowledged');
    if (result.error) { res.status(400).json(result); return; }
    writeAudit(req.user!.user_id, 'site_instructions', req.params.id, instr.project_id, 'acknowledge', instr, {});
    res.json(result.instruction);
  });

  app.post('/api/site_instructions/:id/start', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (req.user!.role !== 'Worker' || !canAccessSiteInstruction(req.user!, instr, 'update')) { res.status(403).json({ error: 'Not assigned to you' }); return; }
    db.prepare('UPDATE site_instructions SET started_at=? WHERE id=?').run(new Date().toISOString(), req.params.id);
    const result = advanceInstruction(req.params.id, 'In Progress', req.user!.user_id, req.user!.name, 'Started', req.body.comment||'Work started');
    if (result.error) { res.status(400).json(result); return; }
    res.json(result.instruction);
  });

  app.post('/api/site_instructions/:id/evidence', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (req.user!.role !== 'Worker' || !canAccessSiteInstruction(req.user!, instr, 'update')) { res.status(403).json({ error: 'Not assigned to you' }); return; }
    const { comment, attachment_name, attachment_data } = req.body;
    const now = new Date().toISOString();
    db.prepare('UPDATE site_instructions SET evidence_submitted_at=? WHERE id=?').run(now, req.params.id);
    if (attachment_name && attachment_data) {
      db.prepare('INSERT INTO site_instruction_attachments (id,instruction_id,uploaded_by,attachment_name,attachment_data,attachment_type,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(crypto.randomUUID(), req.params.id, req.user!.user_id, attachment_name, attachment_data, 'Evidence', now);
    }
    const result = advanceInstruction(req.params.id, 'Ready for Verification', req.user!.user_id, req.user!.name, 'Evidence', comment||'Evidence submitted');
    if (result.error) { res.status(400).json(result); return; }
    res.json(result.instruction);
  });

  app.post('/api/site_instructions/:id/verify', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessSiteInstruction(req.user!, instr, 'verify')) { res.status(403).json({ error: 'No verification authority' }); return; }
    const { action, comment } = req.body;
    if (!['Verified','In Progress'].includes(action)) { res.status(400).json({ error: 'action must be Verified or In Progress (reject back)' }); return; }
    const now = new Date().toISOString();
    if (action === 'Verified') db.prepare('UPDATE site_instructions SET verified_by=?,verified_at=? WHERE id=?').run(req.user!.user_id, now, req.params.id);
    const result = advanceInstruction(req.params.id, action, req.user!.user_id, req.user!.name, action === 'Verified' ? 'Verification' : 'Rejection', comment||`${action} by ${req.user!.name}`);
    if (result.error) { res.status(400).json(result); return; }
    writeAudit(req.user!.user_id, 'site_instructions', req.params.id, instr.project_id, action.toLowerCase(), instr, { action, comment });
    res.json(result.instruction);
  });

  app.post('/api/site_instructions/:id/close', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessSiteInstruction(req.user!, instr, 'close')) { res.status(403).json({ error: 'No close authority' }); return; }
    const now = new Date().toISOString();
    db.prepare('UPDATE site_instructions SET closed_at=? WHERE id=?').run(now, req.params.id);
    const result = advanceInstruction(req.params.id, 'Closed', req.user!.user_id, req.user!.name, 'Closure', req.body.comment||'Closed');
    if (result.error) { res.status(400).json(result); return; }
    writeAudit(req.user!.user_id, 'site_instructions', req.params.id, instr.project_id, 'close', instr, { comment: req.body.comment||null });
    res.json(result.instruction);
  });

  app.get('/api/site_instructions/:id/updates', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessSiteInstruction(req.user!, instr, 'view')) { res.status(403).json({ error: 'No access' }); return; }
    res.json(db.prepare('SELECT * FROM site_instruction_updates WHERE instruction_id=? ORDER BY created_at ASC').all(req.params.id));
  });

  app.post('/api/site_instructions/:id/updates', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessSiteInstruction(req.user!, instr, 'update')) { res.status(403).json({ error: 'No access' }); return; }
    const { content, update_type } = req.body;
    if (!content) { res.status(400).json({ error: 'content required' }); return; }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO site_instruction_updates (id,instruction_id,user_id,user_name,update_type,content,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, req.params.id, req.user!.user_id, req.user!.name, update_type||'Comment', content, now);
    res.status(201).json(db.prepare('SELECT * FROM site_instruction_updates WHERE id=?').get(id));
  });

  

  // --- LEAVE MANAGEMENT ---
  app.get('/api/leave_types', authRequired, (req, res) => {
    res.json(db.prepare('SELECT * FROM leave_types ORDER BY name').all());
  });

  app.get('/api/leave_requests', authRequired, (req, res) => {
    if (!canView(req.user!, 'leave_requests')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    let where = '1=1';
    const params: any[] = [];
    if (projectId) {
      if (!hasProjectAccess(req.user!, projectId)) { res.status(403).json({ error: 'No project access' }); return; }
      where += ' AND lr.project_id=?'; params.push(projectId);
    }
    // Workers only see own requests
    if (req.user!.role === 'Worker') { where += ' AND lr.user_id=?'; params.push(req.user!.user_id); }
    // Supervisors see requests from supervised workers
    else if (req.user!.role === 'SiteSupervisor') {
      where += ' AND lr.worker_id IN (SELECT id FROM workers WHERE supervisor_id=?)'; params.push(req.user!.user_id);
    }
    const rows = db.prepare(`SELECT lr.*, lt.name as leave_type_name, lt.code as leave_type_code, lt.is_paid FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id WHERE ${where} ORDER BY lr.created_at DESC`).all(...params);
    res.json(rows);
  });

  app.post('/api/leave_requests', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'leave_requests')) { res.status(403).json({ error: 'No edit access' }); return; }
    const { project_id, leave_type_id, start_date, end_date, reason } = req.body;
    if (!project_id || !leave_type_id || !start_date || !end_date) { res.status(400).json({ error: 'project_id, leave_type_id, start_date, end_date required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    if (end_date < start_date) { res.status(422).json({ error: 'end_date cannot precede start_date' }); return; }
    const workerRow = getWorkerPrincipal(req.user!.user_id);
    if (!workerRow) { res.status(403).json({ error: 'Worker profile required for leave request' }); return; }
    const assignment = db.prepare("SELECT 1 FROM worker_assignments WHERE worker_id=? AND project_id=? AND status='Active' LIMIT 1").get(workerRow.id, project_id);
    if (!assignment) { res.status(403).json({ error: 'Active project assignment required for leave request' }); return; }
    const days = chargeableLeaveDays(workerRow.id, project_id, start_date, end_date);
    if (days <= 0) { res.status(422).json({ error: 'Requested range contains no chargeable working days' }); return; }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO leave_requests (id,project_id,worker_id,user_id,leave_type_id,start_date,end_date,days_requested,reason,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, project_id, workerRow.id, req.user!.user_id, leave_type_id, start_date, end_date, days, reason||null, 'Pending', now);
    const yr = new Date(start_date + 'T12:00:00Z').getUTCFullYear();
    db.prepare('INSERT INTO leave_balances (id,worker_id,user_id,leave_type_id,year,pending_days,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,leave_type_id,year) DO UPDATE SET pending_days=pending_days+?, updated_at=?')
      .run(crypto.randomUUID(), workerRow.id, req.user!.user_id, leave_type_id, yr, days, now, days, now);
    writeAudit(req.user!.user_id, 'leave_requests', id, project_id, 'submit', null, { ...req.body, chargeable_days: days });
    res.status(201).json(db.prepare('SELECT lr.*, lt.name as leave_type_name FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id WHERE lr.id=?').get(id));
  });

  app.get('/api/leave_requests/:id', authRequired, (req, res) => {
    if (!canView(req.user!, 'leave_requests')) { res.status(403).json({ error: 'No access' }); return; }
    const lr = db.prepare('SELECT lr.*, lt.name as leave_type_name FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id WHERE lr.id=?').get(req.params.id) as any;
    if (!lr) { res.status(404).json({ error: 'Not found' }); return; }
    if (req.user!.role === 'Worker' && lr.user_id !== req.user!.user_id) { res.status(403).json({ error: 'No access' }); return; }
    res.json(lr);
  });

  // Leave approval (blocks self-approval)
  app.post('/api/leave_requests/:id/approve', authRequired, (req, res) => {
    if (!['Admin','ProjectManager','SiteSupervisor'].includes(req.user!.role)) { res.status(403).json({ error: 'No approval authority' }); return; }
    const lr = db.prepare('SELECT * FROM leave_requests WHERE id=?').get(req.params.id) as any;
    if (!lr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, lr.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    if (lr.user_id === req.user!.user_id) { res.status(403).json({ error: 'Cannot approve own leave request' }); return; }
    if (req.user!.role === 'SiteSupervisor') {
      const supervised = lr.worker_id && db.prepare(
        "SELECT 1 FROM worker_assignments WHERE worker_id=? AND project_id=? AND supervisor_id=? AND status='Active' LIMIT 1"
      ).get(lr.worker_id, lr.project_id, req.user!.user_id);
      if (!supervised) { res.status(403).json({ error: 'Leave request is outside supervisor scope' }); return; }
    }
    if (lr.status !== 'Pending') { res.status(400).json({ error: 'Leave request is not pending' }); return; }
    const now = new Date().toISOString();
    db.prepare('UPDATE leave_requests SET status=?,approved_by=?,approved_at=?,reject_reason=NULL WHERE id=?')
      .run('Approved', req.user!.user_id, now, req.params.id);
    const yr = new Date(lr.start_date + 'T12:00:00Z').getUTCFullYear();
    db.prepare('UPDATE leave_balances SET pending_days=MAX(0,pending_days-?),taken_days=taken_days+?,balance_days=balance_days-?,updated_at=? WHERE user_id=? AND leave_type_id=? AND year=?')
      .run(lr.days_requested, lr.days_requested, lr.days_requested, now, lr.user_id, lr.leave_type_id, yr);
    createNotification(lr.user_id, lr.project_id, 'leave_requests', req.params.id, 'Leave Approved', `Your ${lr.days_requested}-day leave request has been approved`);
    writeAudit(req.user!.user_id, 'leave_requests', req.params.id, lr.project_id, 'approve', lr, { action: 'Approved' });
    res.json(db.prepare('SELECT * FROM leave_requests WHERE id=?').get(req.params.id));
  });

  app.post('/api/leave_requests/:id/reject', authRequired, (req, res) => {
    if (!['Admin','ProjectManager','SiteSupervisor'].includes(req.user!.role)) { res.status(403).json({ error: 'No approval authority' }); return; }
    const lr = db.prepare('SELECT * FROM leave_requests WHERE id=?').get(req.params.id) as any;
    if (!lr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, lr.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    if (lr.user_id === req.user!.user_id) { res.status(403).json({ error: 'Cannot reject own leave request' }); return; }
    if (req.user!.role === 'SiteSupervisor') {
      const supervised = lr.worker_id && db.prepare(
        "SELECT 1 FROM worker_assignments WHERE worker_id=? AND project_id=? AND supervisor_id=? AND status='Active' LIMIT 1"
      ).get(lr.worker_id, lr.project_id, req.user!.user_id);
      if (!supervised) { res.status(403).json({ error: 'Leave request is outside supervisor scope' }); return; }
    }
    if (lr.status !== 'Pending') { res.status(400).json({ error: 'Leave request is not pending' }); return; }
    const { reject_reason } = req.body;
    const now = new Date().toISOString();
    db.prepare('UPDATE leave_requests SET status=?,approved_by=?,approved_at=?,reject_reason=? WHERE id=?')
      .run('Rejected', req.user!.user_id, now, reject_reason||null, req.params.id);
    const yr = new Date(lr.start_date + 'T12:00:00Z').getUTCFullYear();
    db.prepare('UPDATE leave_balances SET pending_days=MAX(0,pending_days-?),updated_at=? WHERE user_id=? AND leave_type_id=? AND year=?')
      .run(lr.days_requested, now, lr.user_id, lr.leave_type_id, yr);
    createNotification(lr.user_id, lr.project_id, 'leave_requests', req.params.id, 'Leave Rejected', `Your leave request was rejected. Reason: ${reject_reason||'Not specified'}`);
    writeAudit(req.user!.user_id, 'leave_requests', req.params.id, lr.project_id, 'reject', lr, { reject_reason: reject_reason||null });
    res.json(db.prepare('SELECT * FROM leave_requests WHERE id=?').get(req.params.id));
  });

  app.get('/api/leave_balances', authRequired, (req, res) => {
    if (!canView(req.user!, 'leave_requests')) { res.status(403).json({ error: 'No access' }); return; }
    let where = '1=1';
    const params: any[] = [];
    if (req.user!.role === 'Worker') { where += ' AND lb.user_id=?'; params.push(req.user!.user_id); }
    const year = req.query.year || new Date().getFullYear();
    where += ' AND lb.year=?'; params.push(year);
    const rows = db.prepare(`SELECT lb.*, lt.name as leave_type_name, lt.code FROM leave_balances lb JOIN leave_types lt ON lt.id=lb.leave_type_id WHERE ${where} ORDER BY lt.name`).all(...params);
    res.json(rows);
  });

  // --- PAYROLL (Admin & CommercialManager only) ---
  app.get('/api/payroll_profiles', authRequired, (req, res) => {
    if (!canAccessPayroll(req.user!)) { res.status(403).json({ error: 'No access to payroll financial data' }); return; }
    const workerId = req.query.worker_id as string;
    if (workerId) {
      const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(workerId) as any;
      if (!worker) { res.status(404).json({ error: 'Worker not found' }); return; }
      if (req.user!.role !== 'Admin' && !hasProjectAccess(req.user!, worker.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
      const profile = db.prepare('SELECT * FROM payroll_profiles WHERE worker_id=?').get(workerId);
      res.json(profile ? [profile] : []);
      return;
    }
    if (req.user!.role === 'Admin') {
      res.json(db.prepare('SELECT pp.*, w.name as worker_name, w.project_id FROM payroll_profiles pp JOIN workers w ON w.id=pp.worker_id ORDER BY w.name').all());
      return;
    }
    const scoped = projectScopeSql(req.user!, 'ALL', 'w.project_id');
    if (!scoped.where) { res.status(403).json({ error: 'No project access' }); return; }
    res.json(db.prepare(
      'SELECT pp.*, w.name as worker_name, w.project_id FROM payroll_profiles pp JOIN workers w ON w.id=pp.worker_id WHERE ' +
      scoped.where + ' ORDER BY w.name'
    ).all(...scoped.params));
  });

  app.post('/api/payroll_profiles', authRequired, (req, res) => {
    if (!canAccessPayroll(req.user!)) { res.status(403).json({ error: 'No access' }); return; }
    const { worker_id, basic_daily_rate, basic_monthly_rate, rate_type, currency, ot_multiplier, housing_allowance, transport_allowance, food_allowance, bank_account, bank_name, effective_from } = req.body;
    if (!worker_id) { res.status(400).json({ error: 'worker_id required' }); return; }
    const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(worker_id) as any;
    if (!worker) { res.status(404).json({ error: 'Worker not found' }); return; }
    if (req.user!.role !== 'Admin' && !hasProjectAccess(req.user!, worker.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const numeric = [basic_daily_rate, basic_monthly_rate, ot_multiplier, housing_allowance, transport_allowance, food_allowance]
      .filter(v => v !== undefined && v !== null)
      .map(Number);
    if (numeric.some(v => !Number.isFinite(v) || v < 0)) { res.status(422).json({ error: 'Payroll rates and allowances must be non-negative numbers' }); return; }

    const existing = db.prepare('SELECT * FROM payroll_profiles WHERE worker_id=?').get(worker_id) as any;
    const id = existing?.id || crypto.randomUUID();
    const now = new Date().toISOString();
    if (existing) {
      db.prepare('UPDATE payroll_profiles SET basic_daily_rate=?,basic_monthly_rate=?,rate_type=?,currency=?,ot_multiplier=?,housing_allowance=?,transport_allowance=?,food_allowance=?,bank_account=?,bank_name=?,effective_from=?,updated_at=? WHERE worker_id=?')
        .run(Number(basic_daily_rate||0), Number(basic_monthly_rate||0), rate_type||'Daily', currency||'USD', Number(ot_multiplier??1.5), Number(housing_allowance||0), Number(transport_allowance||0), Number(food_allowance||0), bank_account||null, bank_name||null, effective_from||null, now, worker_id);
    } else {
      db.prepare('INSERT INTO payroll_profiles (id,worker_id,basic_daily_rate,basic_monthly_rate,rate_type,currency,ot_multiplier,housing_allowance,transport_allowance,food_allowance,bank_account,bank_name,effective_from,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, worker_id, Number(basic_daily_rate||0), Number(basic_monthly_rate||0), rate_type||'Daily', currency||'USD', Number(ot_multiplier??1.5), Number(housing_allowance||0), Number(transport_allowance||0), Number(food_allowance||0), bank_account||null, bank_name||null, effective_from||null, now, now);
    }
    writeAudit(req.user!.user_id, 'payroll_profiles', id, worker.project_id, existing ? 'update' : 'create', existing, { worker_id, rate_type, currency });
    res.status(existing ? 200 : 201).json(db.prepare('SELECT * FROM payroll_profiles WHERE worker_id=?').get(worker_id));
  });

  app.put('/api/payroll_profiles/:id', authRequired, (req, res) => {
    if (!canAccessPayroll(req.user!)) { res.status(403).json({ error: 'No access' }); return; }
    const profile = db.prepare('SELECT pp.*, w.project_id FROM payroll_profiles pp JOIN workers w ON w.id=pp.worker_id WHERE pp.id=?').get(req.params.id) as any;
    if (!profile) { res.status(404).json({ error: 'Not found' }); return; }
    if (req.user!.role !== 'Admin' && !hasProjectAccess(req.user!, profile.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const now = new Date().toISOString();
    const { basic_daily_rate, basic_monthly_rate, rate_type, currency, ot_multiplier, housing_allowance, transport_allowance, food_allowance, bank_account, bank_name } = req.body;
    const numeric = [basic_daily_rate, basic_monthly_rate, ot_multiplier, housing_allowance, transport_allowance, food_allowance]
      .filter(v => v !== undefined && v !== null)
      .map(Number);
    if (numeric.some(v => !Number.isFinite(v) || v < 0)) { res.status(422).json({ error: 'Payroll rates and allowances must be non-negative numbers' }); return; }
    db.prepare('UPDATE payroll_profiles SET basic_daily_rate=COALESCE(?,basic_daily_rate),basic_monthly_rate=COALESCE(?,basic_monthly_rate),rate_type=COALESCE(?,rate_type),currency=COALESCE(?,currency),ot_multiplier=COALESCE(?,ot_multiplier),housing_allowance=COALESCE(?,housing_allowance),transport_allowance=COALESCE(?,transport_allowance),food_allowance=COALESCE(?,food_allowance),bank_account=COALESCE(?,bank_account),bank_name=COALESCE(?,bank_name),updated_at=? WHERE id=?')
      .run(basic_daily_rate??null, basic_monthly_rate??null, rate_type||null, currency||null, ot_multiplier??null, housing_allowance??null, transport_allowance??null, food_allowance??null, bank_account||null, bank_name||null, now, req.params.id);
    writeAudit(req.user!.user_id, 'payroll_profiles', req.params.id, profile.project_id, 'update', profile, { rate_type, currency });
    res.json(db.prepare('SELECT * FROM payroll_profiles WHERE id=?').get(req.params.id));
  });

  app.get('/api/payroll_periods', authRequired, (req, res) => {
    if (!canAccessPayroll(req.user!)) { res.status(403).json({ error: 'No access to payroll financial data' }); return; }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId);
    if (!where) { res.status(403).json({ error: 'No project access' }); return; }
    res.json(db.prepare(`SELECT * FROM payroll_periods WHERE ${where} ORDER BY period_start DESC`).all(...params));
  });

  app.post('/api/payroll_periods', authRequired, (req, res) => {
    if (!['Admin','CommercialManager'].includes(req.user!.role)) { res.status(403).json({ error: 'No access' }); return; }
    const { project_id, period_name, period_start, period_end } = req.body;
    if (!project_id || !period_name || !period_start || !period_end) { res.status(400).json({ error: 'project_id, period_name, period_start, period_end required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO payroll_periods (id,project_id,period_name,period_start,period_end,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, project_id, period_name, period_start, period_end, 'Open', req.user!.user_id, now);
    res.status(201).json(db.prepare('SELECT * FROM payroll_periods WHERE id=?').get(id));
  });

  app.get('/api/payroll_periods/:id', authRequired, (req, res) => {
    if (!canAccessPayroll(req.user!)) { res.status(403).json({ error: 'No access to payroll financial data' }); return; }
    const period = db.prepare('SELECT * FROM payroll_periods WHERE id=?').get(req.params.id) as any;
    if (!period) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, period.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const entries = db.prepare('SELECT pe.*, w.name as worker_name, w.trade, w.employee_id FROM payroll_entries pe JOIN workers w ON w.id=pe.worker_id WHERE pe.payroll_period_id=? ORDER BY w.name').all(req.params.id);
    const adjustments = db.prepare('SELECT * FROM payroll_adjustments WHERE payroll_period_id=?').all(req.params.id);
    res.json({ ...period, entries, adjustments });
  });

  app.post('/api/payroll_periods/:id/lock', authRequired, (req, res) => {
    if (req.user!.role !== 'Admin') { res.status(403).json({ error: 'Only Admin can lock payroll' }); return; }
    const period = db.prepare('SELECT * FROM payroll_periods WHERE id=?').get(req.params.id) as any;
    if (!period) { res.status(404).json({ error: 'Not found' }); return; }
    if (period.status === 'Locked') { res.status(400).json({ error: 'Already locked' }); return; }
    const now = new Date().toISOString();
    db.prepare('UPDATE payroll_periods SET status=?,locked_by=?,locked_at=? WHERE id=?').run('Locked', req.user!.user_id, now, req.params.id);
    writeAudit(req.user!.user_id, 'payroll_periods', req.params.id, period.project_id, 'lock', period, { locked_at: now });
    res.json(db.prepare('SELECT * FROM payroll_periods WHERE id=?').get(req.params.id));
  });

  // Compute payroll entries from attendance data
  app.post('/api/payroll_periods/:id/compute', authRequired, (req, res) => {
    if (!canAccessPayroll(req.user!)) { res.status(403).json({ error: 'No access' }); return; }
    const period = db.prepare('SELECT * FROM payroll_periods WHERE id=?').get(req.params.id) as any;
    if (!period) { res.status(404).json({ error: 'Not found' }); return; }
    if (period.status === 'Locked') { res.status(400).json({ error: 'Period is locked' }); return; }
    if (!hasProjectAccess(req.user!, period.project_id)) { res.status(403).json({ error: 'No project access' }); return; }

    const attendance = db.prepare(
      'SELECT a.*, w.id as wid FROM attendance a JOIN workers w ON w.id=a.worker_id ' +
      'WHERE a.project_id=? AND a.work_date>=? AND a.work_date<=? AND a.punch_out IS NOT NULL'
    ).all(period.project_id, period.period_start, period.period_end) as any[];

    const byWorker = new Map<string, any[]>();
    for (const row of attendance) {
      if (!row.wid) continue;
      if (!byWorker.has(row.wid)) byWorker.set(row.wid, []);
      byWorker.get(row.wid)!.push(row);
    }

    const paidLeaveCandidates = db.prepare(
      "SELECT DISTINCT lr.worker_id FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id " +
      "WHERE lr.project_id=? AND lr.status='Approved' AND lt.is_paid=1 AND lr.start_date<=? AND lr.end_date>=? AND lr.worker_id IS NOT NULL"
    ).all(period.project_id, period.period_end, period.period_start) as any[];
    for (const row of paidLeaveCandidates) {
      if (!byWorker.has(row.worker_id)) byWorker.set(row.worker_id, []);
    }

    const now = new Date().toISOString();
    let totalGross = 0;
    let totalNet = 0;
    let workersComputed = 0;
    for (const [workerId, rows] of byWorker) {
      const profile = db.prepare('SELECT * FROM payroll_profiles WHERE worker_id=?').get(workerId) as any;
      if (!profile) continue;

      const elapsedMinutes = rows.reduce((s: number, r: any) => s + Number(r.elapsed_minutes || 0), 0);
      const breakMinutes = rows.reduce((s: number, r: any) => s + Number(r.break_minutes || 0), 0);
      const regularMinutes = rows.reduce((s: number, r: any) => s + Number(r.regular_minutes || Math.round(Number(r.regular_hours || 0) * 60)), 0);
      const rawOtMinutes = rows.reduce((s: number, r: any) => s + Number(r.raw_overtime_minutes || Math.round(Number(r.overtime_hours || 0) * 60)), 0);
      const approvedOtMinutes = rows.reduce((s: number, r: any) => {
        if (r.ot_status !== 'Approved') return s;
        return s + Number(r.approved_overtime_minutes || r.raw_overtime_minutes || Math.round(Number(r.overtime_hours || 0) * 60));
      }, 0);

      const paidLeaves = db.prepare(
        "SELECT lr.start_date,lr.end_date FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id " +
        "WHERE lr.worker_id=? AND lr.project_id=? AND lr.status='Approved' AND lt.is_paid=1 AND lr.start_date<=? AND lr.end_date>=?"
      ).all(workerId, period.project_id, period.period_end, period.period_start) as any[];
      let paidLeaveDays = 0;
      for (const leave of paidLeaves) {
        const clippedStart = leave.start_date < period.period_start ? period.period_start : leave.start_date;
        const clippedEnd = leave.end_date > period.period_end ? period.period_end : leave.end_date;
        paidLeaveDays += chargeableLeaveDays(workerId, period.project_id, clippedStart, clippedEnd);
      }

      const regularHours = regularMinutes / 60;
      const approvedOvertimeHours = approvedOtMinutes / 60;
      const standardDailyMinutes = 480;
      const regularDays = regularMinutes / standardDailyMinutes + paidLeaveDays;
      const basicPay = profile.rate_type === 'Daily' ? regularDays * Number(profile.basic_daily_rate || 0) : Number(profile.basic_monthly_rate || 0);
      const hourlyBase = Number(profile.basic_daily_rate || 0) / 8;
      const overtimePay = approvedOvertimeHours * hourlyBase * Number(profile.ot_multiplier || 1.5);
      const grossPay = basicPay + overtimePay + Number(profile.housing_allowance || 0) + Number(profile.transport_allowance || 0) + Number(profile.food_allowance || 0);
      const netPay = grossPay;

      totalGross += grossPay;
      totalNet += netPay;
      workersComputed++;

      db.prepare(
        'INSERT INTO payroll_entries (id,payroll_period_id,worker_id,project_id,regular_days,regular_hours,overtime_hours,leave_days,' +
        'basic_pay,overtime_pay,housing_allowance,transport_allowance,food_allowance,gross_pay,net_pay,currency,computed_at,created_at,' +
        'elapsed_minutes,regular_minutes,break_minutes,raw_overtime_minutes,approved_overtime_minutes) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(payroll_period_id,worker_id) DO UPDATE SET regular_days=excluded.regular_days,regular_hours=excluded.regular_hours,' +
        'overtime_hours=excluded.overtime_hours,leave_days=excluded.leave_days,basic_pay=excluded.basic_pay,overtime_pay=excluded.overtime_pay,' +
        'housing_allowance=excluded.housing_allowance,transport_allowance=excluded.transport_allowance,food_allowance=excluded.food_allowance,' +
        'gross_pay=excluded.gross_pay,net_pay=excluded.net_pay,currency=excluded.currency,computed_at=excluded.computed_at,' +
        'elapsed_minutes=excluded.elapsed_minutes,regular_minutes=excluded.regular_minutes,break_minutes=excluded.break_minutes,' +
        'raw_overtime_minutes=excluded.raw_overtime_minutes,approved_overtime_minutes=excluded.approved_overtime_minutes'
      ).run(
        crypto.randomUUID(), period.id, workerId, period.project_id,
        Math.round(regularDays * 100) / 100,
        Math.round(regularHours * 100) / 100,
        Math.round(approvedOvertimeHours * 100) / 100,
        paidLeaveDays,
        Math.round(basicPay * 100) / 100,
        Math.round(overtimePay * 100) / 100,
        Number(profile.housing_allowance || 0),
        Number(profile.transport_allowance || 0),
        Number(profile.food_allowance || 0),
        Math.round(grossPay * 100) / 100,
        Math.round(netPay * 100) / 100,
        profile.currency || 'USD',
        now, now,
        elapsedMinutes, regularMinutes, breakMinutes, rawOtMinutes, approvedOtMinutes
      );
    }

    db.prepare('UPDATE payroll_periods SET total_gross=?,total_net=? WHERE id=?')
      .run(Math.round(totalGross*100)/100, Math.round(totalNet*100)/100, period.id);
    writeAudit(req.user!.user_id, 'payroll_periods', period.id, period.project_id, 'compute', null, {
      workers: workersComputed, total_gross: totalGross, approved_ot_only: true
    });
    res.json({ ok: true, workers_computed: workersComputed, total_gross: Math.round(totalGross*100)/100, total_net: Math.round(totalNet*100)/100 });
  });

  

  // Payroll adjustments (bonuses, deductions)
  app.post('/api/payroll_adjustments', authRequired, (req, res) => {
    if (!canAccessPayroll(req.user!)) { res.status(403).json({ error: 'No access' }); return; }
    const { payroll_entry_id, payroll_period_id, worker_id, type, description, amount, is_deduction } = req.body;
    if (!payroll_entry_id || !payroll_period_id || !worker_id || !type || !description || amount == null) {
      res.status(400).json({ error: 'Missing required fields' }); return;
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) { res.status(422).json({ error: 'amount must be a non-negative number' }); return; }
    const period = db.prepare('SELECT * FROM payroll_periods WHERE id=?').get(payroll_period_id) as any;
    if (!period) { res.status(404).json({ error: 'Payroll period not found' }); return; }
    if (period.status === 'Locked') { res.status(400).json({ error: 'Period is locked' }); return; }
    if (req.user!.role !== 'Admin' && !hasProjectAccess(req.user!, period.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const entry = db.prepare('SELECT * FROM payroll_entries WHERE id=? AND payroll_period_id=? AND worker_id=?').get(payroll_entry_id, payroll_period_id, worker_id) as any;
    if (!entry) { res.status(422).json({ error: 'Payroll entry does not match period and worker' }); return; }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO payroll_adjustments (id,payroll_entry_id,payroll_period_id,worker_id,type,description,amount,is_deduction,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, payroll_entry_id, payroll_period_id, worker_id, type, description, numericAmount, is_deduction?1:0, req.user!.user_id, now);
    const delta = is_deduction ? -numericAmount : numericAmount;
    db.prepare('UPDATE payroll_entries SET deductions=deductions+?,net_pay=net_pay+?,gross_pay=gross_pay+? WHERE id=?')
      .run(is_deduction?numericAmount:0, delta, is_deduction?0:delta, payroll_entry_id);
    writeAudit(req.user!.user_id, 'payroll_adjustments', id, period.project_id, 'create', null, { payroll_entry_id, worker_id, type, amount: numericAmount, is_deduction: Boolean(is_deduction) });
    res.status(201).json(db.prepare('SELECT * FROM payroll_adjustments WHERE id=?').get(id));
  });

  // --- WORKFORCE REPORTS ---
  app.get('/api/reports/workforce/daily', authRequired, (req, res) => {
    if (!canView(req.user!, 'workforce')) { res.status(403).json({ error: 'No access' }); return; }
    const { project_id, date, site_id } = req.query as any;
    if (!project_id) { res.status(400).json({ error: 'project_id required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const reportDate = date || new Date().toISOString().split('T')[0];
    let where = 'a.project_id=? AND a.work_date=?';
    const params: any[] = [project_id, reportDate];
    if (site_id) { where += ' AND a.site_id=?'; params.push(site_id); }
    const attendance = db.prepare(`SELECT a.*, w.name as worker_name, w.trade, w.employee_id, w.employment_type, c.name as company_name, s.name as site_name FROM attendance a LEFT JOIN workers w ON w.id=a.worker_id LEFT JOIN companies c ON c.id=w.company_id LEFT JOIN sites s ON s.id=a.site_id WHERE ${where} ORDER BY w.name`).all(...params);
    const summary = {
      date: reportDate,
      total_present: (attendance as any[]).filter(r => r.punch_in).length,
      total_completed: (attendance as any[]).filter(r => r.punch_out).length,
      total_regular_hours: Math.round((attendance as any[]).reduce((s: number, r: any) => s+(r.regular_hours||0), 0)*100)/100,
      total_overtime_hours: Math.round((attendance as any[]).reduce((s: number, r: any) => s+(r.overtime_hours||0), 0)*100)/100,
      geofence_violations: (attendance as any[]).filter(r => r.punch_in_geofence_status === 'Outside Geofence').length,
    };
    res.json({ summary, records: attendance });
  });

  app.get('/api/reports/workforce/payroll-hours', authRequired, (req, res) => {
    if (!['Admin','CommercialManager','ProjectManager'].includes(req.user!.role)) { res.status(403).json({ error: 'No access' }); return; }
    const { project_id, period_start, period_end } = req.query as any;
    if (!project_id || !period_start || !period_end) { res.status(400).json({ error: 'project_id, period_start, period_end required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const rows = db.prepare(`SELECT w.id as worker_id, w.name as worker_name, w.trade, w.employee_id, SUM(a.regular_hours) as total_regular_hours, SUM(a.overtime_hours) as total_overtime_hours, COUNT(a.id) as days_worked FROM attendance a JOIN workers w ON w.user_id=a.user_id WHERE a.project_id=? AND a.work_date>=? AND a.work_date<=? AND a.punch_out IS NOT NULL GROUP BY w.id ORDER BY w.name`).all(project_id, period_start, period_end);
    res.json({ project_id, period_start, period_end, workers: rows });
  });

}
