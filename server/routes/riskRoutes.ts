import { Request, Response } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { canViewRiskMatrix, canAccessRisk } from '../auth/policies';
import { normalizeRiskScale, calculateRiskScore } from '../services/riskService';

export function registerRiskRoutes(app: any, db: DatabaseSync, authRequired: any, hasProjectAccess: any) {
  app.get(['/api/project_risks/matrix', '/api/risks/matrix'], authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const projectId = req.query.project_id as string;
      const hasAccess = Boolean(projectId && hasProjectAccess(user, projectId));

      if (!canViewRiskMatrix(user, hasAccess)) {
        res.status(403).json({ error: 'Forbidden: No access to risk heat map matrix' });
        return;
      }

      let query = `
        SELECT r.*, t.title as linked_task_title, wp.code as work_package_code
        FROM risks r
        LEFT JOIN tasks t ON t.id = r.linked_task_id
        LEFT JOIN work_packages wp ON wp.id = r.work_package_id
        WHERE r.project_id=?
      `;
      const params: any[] = [projectId];

      if (user.role === 'Subcontractor') {
        if (user.work_package_id) {
          query += ` AND (r.work_package_id = ? OR t.work_package_id = ?)`;
          params.push(user.work_package_id, user.work_package_id);
        } else {
          // Subcontractor without work package assigned sees no internal project risks
          res.json({ project_id: projectId, grid: {}, matrix_grid: {}, total_risks: 0, summary: { total: 0, total_risks: 0, critical: 0, high: 0, medium: 0, low: 0 } });
          return;
        }
      }

      query += ' ORDER BY r.risk_score DESC, r.target_date ASC';
      const risks = db.prepare(query).all(...params) as any[];

      const grid: Record<string, any[]> = {};
      for (let p = 1; p <= 5; p++) {
        for (let i = 1; i <= 5; i++) {
          grid[`${p}_${i}`] = [];
        }
      }

      let lowCount = 0;
      let medCount = 0;
      let highCount = 0;
      let critCount = 0;

      for (const r of risks) {
        if (!canAccessRisk(user, r)) continue;

        const evaluated = calculateRiskScore(r.probability, r.impact);
        const cellKey = `${evaluated.probability_numeric}_${evaluated.impact_numeric}`;

        if (grid[cellKey]) {
          grid[cellKey].push({
            ...r,
            calculated_score: evaluated.score,
            calculated_level: evaluated.level
          });
        }

        if (evaluated.level === 'Critical') critCount++;
        else if (evaluated.level === 'High') highCount++;
        else if (evaluated.level === 'Medium') medCount++;
        else lowCount++;
      }

      res.json({
        project_id: projectId,
        grid,
        matrix_grid: grid,
        total_risks: risks.length,
        summary: {
          total: risks.length,
          total_risks: risks.length,
          critical: critCount,
          high: highCount,
          medium: medCount,
          low: lowCount
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
