import { Request, Response } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { canViewProgrammeProcurementRisk } from '../auth/policies';
import { evaluateProcurementImpact } from '../services/procurementRisk';

export function registerProcurementRoutes(app: any, db: DatabaseSync, authRequired: any, hasProjectAccess: any) {
  app.get('/api/procurement/programme-impact', authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const projectId = req.query.project_id as string;
      const hasAccess = Boolean(projectId && hasProjectAccess(user, projectId));

      if (!canViewProgrammeProcurementRisk(user, hasAccess)) {
        res.status(403).json({ error: 'Forbidden: No access to procurement programme impact' });
        return;
      }

      let query = `
        SELECT po.*,
          t.title as task_title, t.start as task_start, t.end as task_end, t.status as task_status,
          t.trade as task_trade, wp.code as work_package_code, wp.name as work_package_name,
          wp.company_id as work_package_company_id
        FROM purchase_orders po
        LEFT JOIN tasks t ON t.id = po.task_id
        LEFT JOIN work_packages wp ON wp.id = t.work_package_id
        WHERE po.project_id=? AND po.task_id IS NOT NULL
      `;
      const params: any[] = [projectId];

      // If subcontractor, restrict to own work package or company
      if (user.role === 'Subcontractor') {
        query += ` AND (t.work_package_id = ? OR wp.company_id = ?)`;
        params.push(user.work_package_id || 'NONE', user.company_id || 'NONE');
      }

      const pos = db.prepare(query).all(...params) as any[];

      const impactItems = pos.map(po => {
        const deliveryDate = po.expected_delivery_date || po.expected_delivery;
        const taskStart = po.task_start;
        const impact = evaluateProcurementImpact(taskStart, deliveryDate, po.status);

        const base = {
          po_id: po.id,
          po_number: po.po_number,
          description: po.description || po.item_name,
          status: po.status,
          expected_delivery: deliveryDate,
          actual_delivery: po.actual_delivery_date,
          task_id: po.task_id,
          task_title: po.task_title,
          task_start: po.task_start,
          task_trade: po.task_trade,
          work_package_code: po.work_package_code,
          buffer_days: impact.buffer_days,
          risk_level: impact.risk_level,
          is_blocked: impact.is_blocked,
          message: impact.impact_description
        };

        // Redact commercial fields for Subcontractor
        if (user.role === 'Subcontractor') {
          return base;
        }

        return {
          ...base,
          vendor: po.vendor,
          amount: po.amount
        };
      });

      const criticalCount = impactItems.filter(i => i.risk_level === 'Critical').length;
      const warningCount = impactItems.filter(i => i.risk_level === 'Warning').length;
      const onTrackCount = impactItems.filter(i => i.risk_level === 'On Track' || i.risk_level === 'Delivered').length;

      res.json({
        project_id: projectId,
        summary: {
          total_linked: impactItems.length,
          critical_lead_time_risks: criticalCount,
          tight_lead_time_warnings: warningCount,
          on_track_count: onTrackCount
        },
        items: impactItems
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
