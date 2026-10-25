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

export function registerControlTowerController(app: Express): void {
  // =====================================================================
  // PROJECT MANAGEMENT CORE & CONTROL TOWER API (V1.3)
  // =====================================================================

  // --- PROJECT CONTROL TOWER & DETERMINISTIC ATTENTION ENGINE ---
  app.get('/api/control-tower', authRequired, (req, res) => {
    if (!canView(req.user!, 'dashboard') && !canView(req.user!, 'tasks')) {
      res.status(403).json({ error: 'No access' });
      return;
    }
    const projectId = req.query.project_id as string;
    const { where: mainWhere } = projectScopeSql(req.user!, projectId);
    if (!mainWhere) {
      res.status(403).json({ error: 'No project access' });
      return;
    }

    const today = new Date().toISOString().split('T')[0];

    // 1. Manpower Radar: Live Present Headcount vs Scheduled/Expected
    const attScope = projectScopeSql(req.user!, projectId, 'a.project_id');
    const presentWorkers = db.prepare(`
      SELECT a.*, w.name as worker_name, w.trade as worker_trade, w.company_id as worker_company_id, c.name as company_name, s.name as site_name
      FROM attendance a
      LEFT JOIN workers w ON w.id = a.worker_id
      LEFT JOIN companies c ON c.id = w.company_id
      LEFT JOIN sites s ON s.id = a.site_id
      WHERE a.work_date = ? AND a.punch_out IS NULL AND ${attScope.where}
    `).all(today, ...attScope.params) as any[];

    // Expected staffing today from worker_assignments
    const assignScope = projectScopeSql(req.user!, projectId, 'wa.project_id');
    const activeAssignments = db.prepare(`
      SELECT wa.*, w.name as worker_name, w.trade, w.company_id, c.name as company_name
      FROM worker_assignments wa
      JOIN workers w ON w.id = wa.worker_id
      LEFT JOIN companies c ON c.id = w.company_id
      WHERE wa.status = 'Active' AND wa.start_date <= ? AND (wa.end_date IS NULL OR wa.end_date >= ?)
      AND ${assignScope.where}
    `).all(today, today, ...assignScope.params) as any[];

    // Present count by trade
    const presentByTrade: Record<string, number> = {};
    for (const w of presentWorkers) {
      const t = w.worker_trade || 'General';
      presentByTrade[t] = (presentByTrade[t] || 0) + 1;
    }

    // Expected count by trade
    const expectedByTrade: Record<string, number> = {};
    for (const w of activeAssignments) {
      const t = w.trade || 'General';
      expectedByTrade[t] = (expectedByTrade[t] || 0) + 1;
    }

    // 2. Deterministic Attention Engine Queue
    const attentionItems: any[] = [];

    // Attention Type A: Critical Blocked Tasks (Severity: CRITICAL)
    const taskScope = projectScopeSql(req.user!, projectId, 't.project_id');
    const blockedTasks = db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.status = 'Blocked' AND ${taskScope.where}
      ORDER BY t.end ASC
    `).all(...taskScope.params) as any[];

    for (const t of blockedTasks) {
      attentionItems.push({
        id: `blocker-task-${t.id}`,
        type: 'BLOCKED_TASK',
        severity: t.priority === 'Critical' || t.priority === 'High' ? 'CRITICAL' : 'HIGH',
        title: `Task Blocked: ${t.title}`,
        subtitle: `Trade: ${t.trade || 'General'} • WBS: ${t.wbs_code || 'N/A'}`,
        project_id: t.project_id,
        project_name: t.project_name,
        target_id: t.id,
        target_module: 'tasks',
        created_at: t.start,
        action_label: 'View Blocker',
      });
    }

    // Attention Type B: Urgent Open Site Instructions
    const instrScope = projectScopeSql(req.user!, projectId, 'si.project_id');
    const urgentInstructions = db.prepare(`
      SELECT si.*, p.name as project_name
      FROM site_instructions si
      JOIN projects p ON p.id = si.project_id
      WHERE si.status NOT IN ('Closed', 'Verified') AND si.priority IN ('Critical', 'Urgent', 'High')
      AND ${instrScope.where}
      ORDER BY si.created_at ASC
    `).all(...instrScope.params) as any[];

    for (const si of urgentInstructions) {
      attentionItems.push({
        id: `instruction-${si.id}`,
        type: 'URGENT_INSTRUCTION',
        severity: si.priority === 'Critical' || si.priority === 'Urgent' ? 'CRITICAL' : 'HIGH',
        title: `Site Instruction: ${si.title}`,
        subtitle: `Status: ${si.status} • Priority: ${si.priority}`,
        project_id: si.project_id,
        project_name: si.project_name,
        target_id: si.id,
        target_module: 'site-instructions',
        created_at: si.created_at,
        action_label: 'Open Instruction',
      });
    }

    // Attention Type C: Pending Overtime Approvals
    if (['Admin', 'ProjectManager', 'SiteSupervisor'].includes(req.user!.role)) {
      const otScope = projectScopeSql(req.user!, projectId, 'a.project_id');
      const pendingOT = db.prepare(`
        SELECT a.*, w.name as worker_name, w.trade, p.name as project_name
        FROM attendance a
        JOIN workers w ON w.id = a.worker_id
        JOIN projects p ON p.id = a.project_id
        WHERE a.ot_status = 'Pending' AND a.raw_overtime_minutes > 0
        AND ${otScope.where}
        ORDER BY a.work_date DESC LIMIT 15
      `).all(...otScope.params) as any[];

      for (const ot of pendingOT) {
        attentionItems.push({
          id: `ot-${ot.id}`,
          type: 'PENDING_OVERTIME',
          severity: 'HIGH',
          title: `Overtime Pending: ${ot.worker_name} (${Math.round((ot.raw_overtime_minutes || 0) / 60 * 10) / 10}h)`,
          subtitle: `Date: ${ot.work_date} • Trade: ${ot.trade || 'General'}`,
          project_id: ot.project_id,
          project_name: ot.project_name,
          target_id: ot.id,
          target_module: 'attendance-exceptions',
          created_at: ot.work_date,
          action_label: 'Review OT',
        });
      }
    }

    // Attention Type D: Pending Leave Requests
    if (['Admin', 'ProjectManager', 'SiteSupervisor'].includes(req.user!.role)) {
      const leaveScope = projectScopeSql(req.user!, projectId, 'lr.project_id');
      const pendingLeave = db.prepare(`
        SELECT lr.*, w.name as worker_name, lt.name as leave_type_name, p.name as project_name
        FROM leave_requests lr
        JOIN workers w ON w.id = lr.worker_id
        JOIN leave_types lt ON lt.id = lr.leave_type_id
        JOIN projects p ON p.id = lr.project_id
        WHERE lr.status = 'Pending' AND ${leaveScope.where}
        ORDER BY lr.start_date ASC LIMIT 10
      `).all(...leaveScope.params) as any[];

      for (const lr of pendingLeave) {
        attentionItems.push({
          id: `leave-${lr.id}`,
          type: 'PENDING_LEAVE',
          severity: 'MEDIUM',
          title: `Leave Approval: ${lr.worker_name} (${lr.leave_type_name})`,
          subtitle: `${lr.start_date} to ${lr.end_date} (${lr.days_requested} days)`,
          project_id: lr.project_id,
          project_name: lr.project_name,
          target_id: lr.id,
          target_module: 'leave-approvals',
          created_at: lr.created_at,
          action_label: 'Review Leave',
        });
      }
    }

    // Attention Type E: Overdue Tasks (end < today and progress < 100)
    const overdueScope = projectScopeSql(req.user!, projectId, 't.project_id');
    const overdueTasks = db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.end < ? AND (t.progress < 100 OR t.progress IS NULL) AND t.status != 'Completed'
      AND ${overdueScope.where}
      ORDER BY t.end ASC LIMIT 15
    `).all(today, ...overdueScope.params) as any[];

    for (const ot of overdueTasks) {
      attentionItems.push({
        id: `overdue-task-${ot.id}`,
        type: 'OVERDUE_TASK',
        severity: ot.priority === 'Critical' ? 'CRITICAL' : 'HIGH',
        title: `Overdue Task: ${ot.title} (${ot.progress || 0}%)`,
        subtitle: `Due: ${ot.end} • Trade: ${ot.trade || 'General'}`,
        project_id: ot.project_id,
        project_name: ot.project_name,
        target_id: ot.id,
        target_module: 'tasks',
        created_at: ot.end,
        action_label: 'View Task',
      });
    }

    // Sort attention items: CRITICAL first, then HIGH, then MEDIUM
    const severityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    attentionItems.sort((a, b) => (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99));

    const radar = {
      present_count: presentWorkers.length,
      expected_count: activeAssignments.length,
      variance_percent: activeAssignments.length > 0
        ? Math.round(((presentWorkers.length - activeAssignments.length) / activeAssignments.length) * 100)
        : 0,
      present_by_trade: presentByTrade,
      expected_by_trade: expectedByTrade,
      present_workers: presentWorkers.slice(0, 20),
    };

    res.json({
      today,
      radar,
      attention_items: attentionItems,
      metrics: {
        total_blocked_tasks: blockedTasks.length,
        total_urgent_instructions: urgentInstructions.length,
        total_overdue_tasks: overdueTasks.length,
        total_attention_items: attentionItems.length,
      },
    });
  });

  // --- 2-WEEK LOOKAHEAD SCHEDULE & DEPENDENCY ENGINE ---
  app.get('/api/tasks/lookahead', authRequired, (req, res) => {
    if (!canView(req.user!, 'tasks')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId, 't.project_id');
    if (!where) { res.status(403).json({ error: 'No project access' }); return; }

    const days = parseInt(req.query.days as string) || 14;
    const startDate = (req.query.start_date as string) || new Date().toISOString().split('T')[0];
    const targetDateObj = new Date(startDate);
    targetDateObj.setDate(targetDateObj.getDate() + days);
    const endDate = targetDateObj.toISOString().split('T')[0];

    const tasks = db.prepare(`
      SELECT t.*, p.name as project_name, w.name as assigned_worker_name, wp.name as work_package_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN workers w ON w.id = t.assigned_worker_id
      LEFT JOIN work_packages wp ON wp.id = t.work_package_id
      WHERE t.status != 'Completed'
        AND t.start <= ?
        AND t.end >= ?
        AND ${where}
      ORDER BY t.start ASC, t.priority DESC
    `).all(endDate, startDate, ...params) as any[];

    const taskIds = tasks.map(t => t.id);
    const dependencies = taskIds.length > 0
      ? db.prepare(`
          SELECT d.*, pred.title as predecessor_title, pred.status as predecessor_status, pred.progress as predecessor_progress, pred.end as predecessor_end
          FROM dependencies d
          LEFT JOIN tasks pred ON pred.id = d.predecessor_task_id
          WHERE d.task_id IN (${taskIds.map(() => '?').join(',')})
        `).all(...taskIds) as any[]
      : [];

    const blockers = taskIds.length > 0
      ? db.prepare(`
          SELECT task_id, COUNT(*) as active_blockers
          FROM task_blockers
          WHERE task_id IN (${taskIds.map(() => '?').join(',')}) AND status = 'Active'
          GROUP BY task_id
        `).all(...taskIds) as any[]
      : [];

    const blockerMap = new Map(blockers.map(b => [b.task_id, b.active_blockers]));

    const depMap = new Map<string, any[]>();
    for (const d of dependencies) {
      if (!depMap.has(d.task_id)) depMap.set(d.task_id, []);
      depMap.get(d.task_id)!.push(d);
    }

    const today = new Date().toISOString().split('T')[0];
    const enrichedTasks = tasks.map(t => {
      const taskDeps = depMap.get(t.id) || [];
      const activeBlockerCount = blockerMap.get(t.id) || 0;

      const riskyPredecessors = taskDeps.filter(d =>
        d.predecessor_status === 'Blocked' ||
        (d.predecessor_end < today && (d.predecessor_progress || 0) < 100 && d.predecessor_status !== 'Completed')
      );

      const hasRisk = riskyPredecessors.length > 0;

      return {
        ...t,
        active_blocker_count: activeBlockerCount,
        predecessor_risk: hasRisk,
        risky_predecessors: riskyPredecessors.map(rp => ({
          predecessor_id: rp.predecessor_task_id,
          title: rp.predecessor_title,
          status: rp.predecessor_status,
          end: rp.predecessor_end,
          progress: rp.predecessor_progress,
        })),
        dependencies_count: taskDeps.length,
      };
    });

    res.json({
      start_date: startDate,
      end_date: endDate,
      window_days: days,
      tasks: enrichedTasks,
      metrics: {
        total_lookahead_tasks: enrichedTasks.length,
        blocked_tasks: enrichedTasks.filter(t => t.status === 'Blocked' || t.active_blocker_count > 0).length,
        predecessor_risk_tasks: enrichedTasks.filter(t => t.predecessor_risk).length,
        in_progress_tasks: enrichedTasks.filter(t => t.status === 'In Progress').length,
        not_started_tasks: enrichedTasks.filter(t => t.status === 'Not Started').length,
      }
    });
  });

  // --- TASK BLOCKERS REGISTER & LIFECYCLE ---
  app.get('/api/blockers', authRequired, (req, res) => {
    if (!canView(req.user!, 'tasks')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId, 'b.project_id');
    if (!where) { res.status(403).json({ error: 'No project access' }); return; }

    const taskId = req.query.task_id as string;
    let sql = `
      SELECT b.*, t.title as task_title, t.trade as task_trade, p.name as project_name
      FROM task_blockers b
      JOIN tasks t ON t.id = b.task_id
      JOIN projects p ON p.id = b.project_id
      WHERE ${where}
    `;
    const qParams = [...params];
    if (taskId) {
      sql += ' AND b.task_id = ?';
      qParams.push(taskId);
    }
    sql += " ORDER BY CASE WHEN b.status = 'Active' THEN 0 ELSE 1 END, b.created_at DESC";

    const rows = db.prepare(sql).all(...qParams);
    res.json(rows);
  });

  app.get('/api/tasks/:id/blockers', authRequired, (req, res) => {
    if (!canView(req.user!, 'tasks')) { res.status(403).json({ error: 'No access' }); return; }
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id) as any;
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    if (!hasProjectAccess(req.user!, task.project_id)) { res.status(403).json({ error: 'No access' }); return; }

    const blockers = db.prepare('SELECT * FROM task_blockers WHERE task_id=? ORDER BY created_at DESC').all(req.params.id);
    res.json(blockers);
  });

  app.post('/api/tasks/:id/blockers', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'tasks')) { res.status(403).json({ error: 'No edit access' }); return; }
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id) as any;
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    if (!hasProjectAccess(req.user!, task.project_id)) { res.status(403).json({ error: 'No access' }); return; }

    const { blocker_type, description, blocking_trade, impact_days } = req.body;
    if (!description) { res.status(400).json({ error: 'description is required' }); return; }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO task_blockers (id, task_id, project_id, blocker_type, description, blocking_trade, impact_days, status, reported_by, reported_by_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?)
    `).run(
      id,
      task.id,
      task.project_id,
      blocker_type || 'Trade Interface',
      description,
      blocking_trade || null,
      impact_days ? Number(impact_days) : 1,
      req.user!.user_id,
      req.user!.name || req.user!.email || 'User',
      now
    );

    // Update task status to Blocked
    db.prepare("UPDATE tasks SET status='Blocked' WHERE id=?").run(task.id);

    try {
      db.prepare("INSERT INTO task_status_history (id, task_id, from_status, to_status, changed_by, notes, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(crypto.randomUUID(), task.id, task.status, 'Blocked', req.user!.user_id, `Blocker raised: ${description}`, now);
    } catch {}

    writeAudit(req.user!.user_id, 'task_blockers', id, task.project_id, 'create', null, { task_id: task.id, description, blocker_type });

    res.status(201).json(db.prepare('SELECT * FROM task_blockers WHERE id=?').get(id));
  });

  app.post('/api/tasks/:id/blockers/:blockerId/resolve', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'tasks')) { res.status(403).json({ error: 'No edit access' }); return; }
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id) as any;
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    if (!hasProjectAccess(req.user!, task.project_id)) { res.status(403).json({ error: 'No access' }); return; }

    const blocker = db.prepare('SELECT * FROM task_blockers WHERE id=? AND task_id=?').get(req.params.blockerId, req.params.id) as any;
    if (!blocker) { res.status(404).json({ error: 'Blocker not found' }); return; }

    const { resolution_notes } = req.body;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE task_blockers
      SET status='Resolved', resolved_by=?, resolved_by_name=?, resolution_notes=?, resolved_at=?
      WHERE id=?
    `).run(
      req.user!.user_id,
      req.user!.name || req.user!.email || 'User',
      resolution_notes || 'Blocker resolved',
      now,
      blocker.id
    );

    const remainingActive = db.prepare("SELECT COUNT(*) as count FROM task_blockers WHERE task_id=? AND status='Active'").get(task.id) as any;

    let updatedTaskStatus = task.status;
    if ((remainingActive?.count || 0) === 0 && task.status === 'Blocked') {
      updatedTaskStatus = (task.progress && task.progress > 0) ? 'In Progress' : 'Not Started';
      db.prepare("UPDATE tasks SET status=? WHERE id=?").run(updatedTaskStatus, task.id);

      try {
        db.prepare("INSERT INTO task_status_history (id, task_id, from_status, to_status, changed_by, notes, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(crypto.randomUUID(), task.id, 'Blocked', updatedTaskStatus, req.user!.user_id, `All blockers resolved. ${resolution_notes || ''}`, now);
      } catch {}
    }

    writeAudit(req.user!.user_id, 'task_blockers', blocker.id, task.project_id, 'resolve', blocker, { resolution_notes });

    res.json({
      ok: true,
      blocker: db.prepare('SELECT * FROM task_blockers WHERE id=?').get(blocker.id),
      remaining_active_blockers: remainingActive?.count || 0,
      task_status: updatedTaskStatus,
    });
  });

}
