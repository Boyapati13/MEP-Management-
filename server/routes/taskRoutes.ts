import { Request, Response } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { calculateTaskReadiness } from '../services/taskReadiness';

export function registerTaskRoutes(app: any, db: DatabaseSync, authRequired: any, hasProjectAccess: any) {
  app.get('/api/tasks/:id/readiness', authRequired, (req: Request, res: Response) => {
    try {
      const task = db.prepare('SELECT id, project_id FROM tasks WHERE id = ?').get(req.params.id) as any;
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      if (!hasProjectAccess(req.user!, task.project_id)) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      const readiness = calculateTaskReadiness(db, req.params.id);
      res.json(readiness);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
