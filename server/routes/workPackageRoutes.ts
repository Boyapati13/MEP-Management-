import { Request, Response } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { canAccessWorkPackage } from '../auth/workPackageAccess';

export function registerWorkPackageRoutes(app: any, db: DatabaseSync, authRequired: any, hasProjectAccess: any, rowToDict: any) {
  app.get('/api/work_packages/:id/command-center', authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      if (user.role === 'Client' || user.role === 'Worker') {
        res.status(404).json({ error: 'Work package not found' });
        return;
      }

      const wp = db.prepare(`
        SELECT wp.*,
          c.name as company_name, c.trade as company_trade,
          s.name as site_name,
          wbs.name as wbs_name, wbs.code as wbs_code
        FROM work_packages wp
        LEFT JOIN companies c ON c.id = wp.company_id
        LEFT JOIN sites s ON s.id = wp.site_id
        LEFT JOIN wbs_items wbs ON wbs.id = wp.wbs_item_id
        WHERE wp.id=?
      `).get(req.params.id) as any;

      if (!wp) {
        res.status(404).json({ error: 'Work package not found' });
        return;
      }

      if (!hasProjectAccess(user, wp.project_id)) {
        res.status(404).json({ error: 'Work package not found' });
        return;
      }

      // Explicit Subcontractor access scope check
      if (!canAccessWorkPackage(user, wp)) {
        res.status(404).json({ error: 'Work package not found' });
        return;
      }

      // Tasks aggregation
      const tasks = db.prepare(`
        SELECT t.*,
          sup.name as supervisor_name,
          w.name as worker_name
        FROM tasks t
        LEFT JOIN users sup ON sup.id = t.supervisor_id
        LEFT JOIN workers w ON w.id = t.assigned_worker_id
        WHERE t.work_package_id=?
        ORDER BY t.start ASC
      `).all(req.params.id) as any[];

      const totalTasks = tasks.length;
      const completedTasks = tasks.filter(t => t.status === 'Completed' || t.progress === 100).length;
      const inProgressTasks = tasks.filter(t => t.status === 'In Progress').length;
      const blockedTasks = tasks.filter(t => t.status === 'Blocked').length;
      const notStartedTasks = tasks.filter(t => t.status === 'Not Started' || (!t.status && t.progress === 0)).length;
      const avgProgress = totalTasks > 0
        ? Math.round(tasks.reduce((sum, t) => sum + (Number(t.progress) || 0), 0) / totalTasks)
        : 0;

      // Progress submissions / claims
      const claims = db.prepare(`
        SELECT * FROM progress_submissions WHERE work_package_id=? ORDER BY period_date DESC, created_at DESC LIMIT 10
      `).all(req.params.id) as any[];
      const totalClaimedAmount = claims.reduce((acc, c) => acc + (Number(c.claimed_amount) || 0), 0);
      const totalCertifiedAmount = claims.filter(c => c.status === 'Approved' || c.status === 'Approved with Adjustments')
        .reduce((acc, c) => acc + (Number(c.adjusted_amount || c.claimed_amount) || 0), 0);

      // Blockers
      const blockers = db.prepare(`
        SELECT b.*, t.title as task_title
        FROM task_blockers b
        JOIN tasks t ON t.id = b.task_id
        WHERE t.work_package_id=? AND b.resolved = 0
        ORDER BY b.created_at DESC
      `).all(req.params.id) as any[];

      // Assigned manpower
      const workers = db.prepare(`
        SELECT DISTINCT w.*, c.name as company_name
        FROM workers w
        LEFT JOIN companies c ON c.id = w.company_id
        WHERE w.work_package_id=? OR w.id IN (SELECT assigned_worker_id FROM tasks WHERE work_package_id=? AND assigned_worker_id IS NOT NULL)
      `).all(req.params.id, req.params.id) as any[];

      // Open clarifications
      const clarifications = db.prepare(`
        SELECT * FROM clarifications WHERE work_package_id=? AND status != 'Closed' ORDER BY created_at DESC
      `).all(req.params.id) as any[];

      // Linked Purchase orders
      const wpDiscipline = wp.discipline || wp.trade || null;
      const pos = db.prepare(`
        SELECT po.* FROM purchase_orders po
        WHERE (po.trade = ? AND ? IS NOT NULL) OR po.task_id IN (SELECT id FROM tasks WHERE work_package_id=?)
      `).all(wpDiscipline, wpDiscipline, req.params.id) as any[];

      // Grouped manpower distributions (assigned vs present today)
      const today = new Date().toISOString().slice(0, 10);
      const presentRows = db.prepare(`
        SELECT a.worker_id, w.trade, w.company_id, c.name as company_name
        FROM attendance a
        JOIN workers w ON w.id = a.worker_id
        LEFT JOIN companies c ON c.id = w.company_id
        WHERE a.work_date = ? AND a.punch_out IS NULL
          AND (w.work_package_id = ? OR w.id IN (SELECT assigned_worker_id FROM tasks WHERE work_package_id=?))
      `).all(today, req.params.id, req.params.id) as any[];

      const manpowerByTrade: Record<string, { assigned: number; present: number }> = {};
      workers.forEach((w: any) => {
        const trade = w.trade || 'General';
        if (!manpowerByTrade[trade]) manpowerByTrade[trade] = { assigned: 0, present: 0 };
        manpowerByTrade[trade].assigned++;
      });
      presentRows.forEach((p: any) => {
        const trade = p.trade || 'General';
        if (!manpowerByTrade[trade]) manpowerByTrade[trade] = { assigned: 0, present: 0 };
        manpowerByTrade[trade].present++;
      });

      res.json({
        work_package: rowToDict(wp),
        metrics: {
          total_tasks: totalTasks,
          completed_tasks: completedTasks,
          in_progress_tasks: inProgressTasks,
          blocked_tasks: blockedTasks,
          not_started_tasks: notStartedTasks,
          avg_progress: avgProgress,
          total_claimed_amount: totalClaimedAmount,
          total_certified_amount: totalCertifiedAmount,
          active_blockers_count: blockers.length,
          manpower_count: workers.length,
          present_today_count: presentRows.length,
          open_clarifications_count: clarifications.length
        },
        manpower_distribution: {
          by_trade: manpowerByTrade,
          present_today: presentRows.length,
          total_assigned: workers.length
        },
        tasks: tasks.map(rowToDict),
        claims: claims.map(rowToDict),
        blockers: blockers.map(rowToDict),
        workers: workers.map(rowToDict),
        clarifications: clarifications.map(rowToDict),
        purchase_orders: pos.map(rowToDict)
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
