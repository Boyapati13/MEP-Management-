import { Request, Response } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { calculateTaskReadiness } from '../services/taskReadiness';
import { canAccessWorkPackage } from '../auth/workPackageAccess';

export function registerTaskRoutes(app: any, db: DatabaseSync, authRequired: any, hasProjectAccess: any) {
  app.get('/api/tasks/:id/readiness', authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      if (user.role === 'Client' || user.role === 'Worker') {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      const task = db.prepare('SELECT id, project_id, work_package_id FROM tasks WHERE id = ?').get(req.params.id) as any;
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      if (!hasProjectAccess(user, task.project_id)) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      // If user is Subcontractor, enforce work package scope
      if (user.role === 'Subcontractor') {
        if (!task.work_package_id) {
          res.status(404).json({ error: 'Task not found' });
          return;
        }

        const wp = db.prepare('SELECT id, company_id FROM work_packages WHERE id = ?').get(task.work_package_id) as any;
        if (!wp || !canAccessWorkPackage(user, wp)) {
          res.status(404).json({ error: 'Task not found' });
          return;
        }
      }

      const readiness = calculateTaskReadiness(db, req.params.id);
      res.json(readiness);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
