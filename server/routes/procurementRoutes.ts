import { Request, Response } from 'express';
import crypto from 'crypto';
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

  // Convert Material Request (with BOQ Material & Specification) into a Purchase Order & sync Cost Tracking
  app.post(['/api/material_requests/:id/create-po', '/api/material-requests/:id/create-po'], authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      if (user.role === 'Client' || user.role === 'Subcontractor' || user.role === 'Worker') {
        res.status(403).json({ error: 'Internal commercial/procurement permission required to issue Purchase Orders' });
        return;
      }
      const mr = db.prepare('SELECT * FROM material_requests WHERE id = ?').get(req.params.id) as any;
      if (!mr) {
        res.status(404).json({ error: 'Material Request not found' });
        return;
      }
      if (!hasProjectAccess(user, mr.project_id)) {
        res.status(403).json({ error: 'No access to project' });
        return;
      }

      const body = req.body || {};
      const boqItem = mr.boq_item_id
        ? (db.prepare('SELECT * FROM boq_items WHERE id = ?').get(mr.boq_item_id) as any)
        : mr.boq_reference
        ? (db.prepare('SELECT * FROM boq_items WHERE project_id = ? AND item_number = ?').get(mr.project_id, mr.boq_reference) as any)
        : null;

      const materialName = mr.material || mr.item || boqItem?.description || 'MEP Material';
      const specText = mr.specification || mr.spec || mr.description || boqItem?.specification || `${mr.discipline || 'MEP'} Specification`;
      const qty = Number(body.quantity ?? mr.quantity ?? boqItem?.tender_quantity ?? 1);
      const unitRate = Number(body.unit_rate ?? boqItem?.tender_rate ?? 100);
      const poAmount = Number(body.amount ?? (boqItem?.tender_amount ? boqItem.tender_amount : qty * unitRate));
      const vendor = body.vendor || mr.supplier || 'Approved MEP Supplier';
      const poCount = ((db.prepare('SELECT COUNT(*) as c FROM purchase_orders WHERE project_id = ?').get(mr.project_id) as any)?.c || 0) + 1;
      const poNumber = body.po_number || `PO-${String(poCount).padStart(4, '0')}`;
      const expectedDelivery = body.expected_delivery || mr.required_date || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      const poId = crypto.randomUUID();
      const today = new Date().toISOString().slice(0, 10);

      db.prepare(`
        INSERT INTO purchase_orders (
          id, project_id, po_number, vendor, description, amount, status,
          issue_date, expected_delivery, expected_delivery_date,
          boq_item_id, work_package_id, task_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        poId,
        mr.project_id,
        poNumber,
        vendor,
        `${materialName} | Spec: ${specText}`,
        poAmount,
        body.status || 'Ordered',
        today,
        expectedDelivery,
        expectedDelivery,
        mr.boq_item_id || boqItem?.id || null,
        mr.work_package_id || null,
        body.task_id || null
      );

      db.prepare(`UPDATE material_requests SET status = 'Ordered', supplier = ? WHERE id = ?`).run(vendor, mr.id);
      if (mr.boq_reference) {
        db.prepare(`UPDATE procurement_items SET status = 'Ordered', po_number = ?, selected_supplier = ? WHERE project_id = ? AND boq_reference = ?`).run(
          poNumber, vendor, mr.project_id, mr.boq_reference
        );
      }

      // Sync committed/actual cost into `costs` table for Cost Tracking
      const disciplineCategory = mr.discipline || boqItem?.discipline || 'MEP Procurement';
      const existingCost = db.prepare(`SELECT * FROM costs WHERE project_id = ? AND (LOWER(description) = LOWER(?) OR category = ?) LIMIT 1`).get(
        mr.project_id, materialName, disciplineCategory
      ) as any;

      if (existingCost) {
        db.prepare(`UPDATE costs SET actual = COALESCE(actual, 0) + ? WHERE id = ?`).run(poAmount, existingCost.id);
      } else {
        db.prepare(`INSERT INTO costs (id, project_id, category, description, planned, actual, date) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          crypto.randomUUID(), mr.project_id, disciplineCategory, `${materialName} (${poNumber})`, poAmount, poAmount, today
        );
      }

      const createdPo = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId);
      res.status(201).json({
        ok: true,
        purchase_order: createdPo,
        material_request_id: mr.id,
        material: materialName,
        specification: specText,
        cost_synced: poAmount
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
