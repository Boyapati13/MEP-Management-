import { Request, Response } from 'express';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { canViewProgrammeProcurementRisk } from '../auth/policies';
import { evaluateProcurementImpact } from '../services/procurementRisk';
import { writeAudit } from '../services/auditService';

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
      const proj = db.prepare('SELECT currency, tax_rate FROM projects WHERE id = ?').get(mr.project_id) as any;
      const poCurrency = body.currency || proj?.currency || 'USD';
      const poTaxRate = Number(body.tax_rate ?? proj?.tax_rate ?? 0);
      const poTaxAmount = Math.round(poAmount * (poTaxRate / 100) * 100) / 100;
      const poGrossTotal = Math.round((poAmount + poTaxAmount) * 100) / 100;

      db.prepare(`
        INSERT INTO purchase_orders (
          id, project_id, po_number, vendor, description, amount, status,
          issue_date, expected_delivery, expected_delivery_date,
          boq_item_id, work_package_id, task_id, currency, tax_rate, tax_amount, gross_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        body.task_id || null,
        poCurrency,
        poTaxRate,
        poTaxAmount,
        poGrossTotal
      );

      db.prepare(`UPDATE material_requests SET status = 'Ordered', supplier = ?, po_id = ?, po_number = ? WHERE id = ?`).run(vendor, poId, poNumber, mr.id);
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

  // List Site Material Receipts (GRN & Missing/Shortage Ledger)
  app.get('/api/site_material_receipts', authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const projectId = req.query.project_id as string;
      const missingOnly = req.query.missing_only === '1' || req.query.missing_only === 'true';
      let sql = 'SELECT * FROM site_material_receipts WHERE 1=1';
      const params: any[] = [];
      if (projectId && projectId !== 'ALL') {
        if (!hasProjectAccess(user, projectId)) {
          res.status(403).json({ error: 'No access to project' });
          return;
        }
        sql += ' AND project_id = ?';
        params.push(projectId);
      }
      if (missingOnly) {
        sql += ' AND missing_quantity > 0';
      }
      sql += ' ORDER BY created_at DESC LIMIT 300';
      res.json(db.prepare(sql).all(...params));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Record Site Material Receipt & Missing/Shortage on a Material Request
  app.post('/api/material_requests/:id/receive', authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      if (user.role === 'Client') {
        res.status(403).json({ error: 'Clients cannot record site material receipts' });
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
      const orderedQty = Number(mr.quantity ?? 1);
      const receivedQty = Number(body.received_quantity ?? 0);
      const missingQty = body.missing_quantity !== undefined && body.missing_quantity !== ''
        ? Math.max(0, Number(body.missing_quantity))
        : Math.max(0, orderedQty - receivedQty);
      if (!Number.isFinite(receivedQty) || receivedQty < 0 || !Number.isFinite(missingQty) || missingQty < 0) {
        res.status(400).json({ error: 'received_quantity and missing_quantity must be non-negative numbers' });
        return;
      }

      const storageLocation = body.storage_location || mr.storage_location || 'Site Store';
      const deliveryNoteRef = body.delivery_note_ref || '';
      const discrepancyReason = body.discrepancy_reason || '';
      const now = new Date().toISOString();
      const receivedDate = body.received_date || now.slice(0, 10);

      let nextStatus = 'Received';
      if (missingQty > 0 && receivedQty > 0) nextStatus = 'Partial / Missing';
      else if (missingQty > 0 && receivedQty <= 0) nextStatus = 'Missing / Discrepancy';

      db.prepare(`
        UPDATE material_requests
        SET status = ?, received_quantity = ?, missing_quantity = ?, storage_location = ?,
            delivery_note_ref = ?, discrepancy_reason = ?, received_by = ?, received_at = ?
        WHERE id = ?
      `).run(
        nextStatus,
        receivedQty,
        missingQty,
        storageLocation,
        deliveryNoteRef || null,
        discrepancyReason || null,
        user.name || user.user_id,
        now,
        mr.id
      );

      if (mr.po_id) {
        db.prepare(`
          UPDATE purchase_orders
          SET status = ?, actual_delivery_date = ?, received_quantity = ?, missing_quantity = ?,
              storage_location = ?, delivery_note_ref = ?, discrepancy_reason = ?
          WHERE id = ?
        `).run(nextStatus, receivedDate, receivedQty, missingQty, storageLocation, deliveryNoteRef || null, discrepancyReason || null, mr.po_id);
      }

      if (mr.boq_reference) {
        db.prepare(`
          UPDATE procurement_items
          SET delivered_quantity = ?, outstanding_quantity = ?, actual_delivery = ?, storage_location = ?, status = ?
          WHERE project_id = ? AND boq_reference = ?
        `).run(receivedQty, missingQty, receivedDate, storageLocation, nextStatus, mr.project_id, mr.boq_reference);
      }

      const receiptId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO site_material_receipts (
          id, project_id, material_request_id, po_id, po_number, material, boq_reference,
          ordered_quantity, received_quantity, missing_quantity, unit, storage_location,
          delivery_note_ref, discrepancy_reason, status, received_by, received_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        receiptId,
        mr.project_id,
        mr.id,
        mr.po_id || null,
        mr.po_number || null,
        mr.material || mr.description || 'MEP Material',
        mr.boq_reference || null,
        orderedQty,
        receivedQty,
        missingQty,
        mr.unit || 'Item',
        storageLocation,
        deliveryNoteRef || null,
        discrepancyReason || null,
        nextStatus,
        user.name || user.user_id,
        now,
        now
      );

      writeAudit(user.user_id, 'material_requests', mr.id, mr.project_id, 'receive', mr, {
        status: nextStatus,
        received_quantity: receivedQty,
        missing_quantity: missingQty,
        storage_location: storageLocation,
        delivery_note_ref: deliveryNoteRef,
      });

      if (receivedQty > 0) {
        const matLabel = mr.material || mr.description || 'MEP Material';
        const existingInv = db.prepare(
          `SELECT * FROM inventory_items WHERE project_id = ? AND LOWER(material) = LOWER(?) LIMIT 1`
        ).get(mr.project_id, matLabel) as any;
        const invId = existingInv?.id || crypto.randomUUID();
        if (existingInv) {
          db.prepare(`UPDATE inventory_items SET current_stock = current_stock + ?, storage_location = ?, last_updated = ? WHERE id = ?`)
            .run(receivedQty, storageLocation, now, invId);
        } else {
          db.prepare(
            `INSERT INTO inventory_items (id, project_id, sku, material, category, unit, storage_location, current_stock, min_stock_level, unit_cost, boq_reference, last_updated, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5, 0, ?, ?, ?)`
          ).run(invId, mr.project_id, mr.boq_reference || `SKU-${invId.slice(0, 6).toUpperCase()}`, matLabel, mr.discipline || 'MEP Material', mr.unit || 'Unit', storageLocation, receivedQty, mr.boq_reference || null, now, now);
        }
        db.prepare(
          `INSERT INTO stock_movements (id, project_id, inventory_item_id, movement_type, quantity, reference_no, notes, created_by, created_at)
           VALUES (?, ?, ?, 'IN_GRN', ?, ?, ?, ?, ?)`
        ).run(crypto.randomUUID(), mr.project_id, invId, receivedQty, deliveryNoteRef || mr.po_number || receiptId, `Received on site from Material Request`, user.name || user.user_id, now);
        writeAudit(user.user_id, 'inventory_items', invId, mr.project_id, 'grn_in', null, { material: matLabel, receivedQty });
      }

      res.status(201).json({
        ok: true,
        status: nextStatus,
        material_request: db.prepare('SELECT * FROM material_requests WHERE id = ?').get(mr.id),
        receipt: db.prepare('SELECT * FROM site_material_receipts WHERE id = ?').get(receiptId),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Record Site Material Receipt & Missing/Shortage directly on a Purchase Order
  app.post('/api/purchase_orders/:id/receive', authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      if (user.role === 'Client') {
        res.status(403).json({ error: 'Clients cannot record site material receipts' });
        return;
      }
      const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as any;
      if (!po) {
        res.status(404).json({ error: 'Purchase Order not found' });
        return;
      }
      if (!hasProjectAccess(user, po.project_id)) {
        res.status(403).json({ error: 'No access to project' });
        return;
      }

      const body = req.body || {};
      const orderedQty = Number(body.ordered_quantity ?? po.quantity ?? 1);
      const receivedQty = Number(body.received_quantity ?? 0);
      const missingQty = body.missing_quantity !== undefined && body.missing_quantity !== ''
        ? Math.max(0, Number(body.missing_quantity))
        : Math.max(0, orderedQty - receivedQty);
      const storageLocation = body.storage_location || po.storage_location || 'Site Store';
      const deliveryNoteRef = body.delivery_note_ref || '';
      const discrepancyReason = body.discrepancy_reason || '';
      const now = new Date().toISOString();
      const receivedDate = body.received_date || now.slice(0, 10);

      let nextStatus = 'Received';
      if (missingQty > 0 && receivedQty > 0) nextStatus = 'Partial / Missing';
      else if (missingQty > 0 && receivedQty <= 0) nextStatus = 'Missing / Discrepancy';

      db.prepare(`
        UPDATE purchase_orders
        SET status = ?, actual_delivery_date = ?, received_quantity = ?, missing_quantity = ?,
            storage_location = ?, delivery_note_ref = ?, discrepancy_reason = ?
        WHERE id = ?
      `).run(nextStatus, receivedDate, receivedQty, missingQty, storageLocation, deliveryNoteRef || null, discrepancyReason || null, po.id);

      db.prepare(`
        UPDATE material_requests
        SET status = ?, received_quantity = ?, missing_quantity = ?, storage_location = ?,
            delivery_note_ref = ?, discrepancy_reason = ?, received_by = ?, received_at = ?
        WHERE po_id = ?
      `).run(nextStatus, receivedQty, missingQty, storageLocation, deliveryNoteRef || null, discrepancyReason || null, user.name || user.user_id, now, po.id);

      const receiptId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO site_material_receipts (
          id, project_id, po_id, po_number, material, ordered_quantity, received_quantity,
          missing_quantity, unit, storage_location, delivery_note_ref, discrepancy_reason,
          status, received_by, received_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        receiptId,
        po.project_id,
        po.id,
        po.po_number || null,
        po.description || po.vendor || 'PO Delivery',
        orderedQty,
        receivedQty,
        missingQty,
        'Lot',
        storageLocation,
        deliveryNoteRef || null,
        discrepancyReason || null,
        nextStatus,
        user.name || user.user_id,
        now,
        now
      );

      writeAudit(user.user_id, 'purchase_orders', po.id, po.project_id, 'receive', po, {
        status: nextStatus,
        received_quantity: receivedQty,
        missing_quantity: missingQty,
      });

      if (receivedQty > 0) {
        const matLabel = po.description || po.vendor || 'PO Delivery';
        const existingInv = db.prepare(
          `SELECT * FROM inventory_items WHERE project_id = ? AND LOWER(material) = LOWER(?) LIMIT 1`
        ).get(po.project_id, matLabel) as any;
        const invId = existingInv?.id || crypto.randomUUID();
        if (existingInv) {
          db.prepare(`UPDATE inventory_items SET current_stock = current_stock + ?, storage_location = ?, last_updated = ? WHERE id = ?`)
            .run(receivedQty, storageLocation, now, invId);
        } else {
          db.prepare(
            `INSERT INTO inventory_items (id, project_id, sku, material, category, unit, storage_location, current_stock, min_stock_level, unit_cost, boq_reference, last_updated, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5, 0, ?, ?, ?)`
          ).run(invId, po.project_id, po.po_number || `SKU-${invId.slice(0, 6).toUpperCase()}`, matLabel, po.trade || 'MEP Material', 'Lot', storageLocation, receivedQty, null, now, now);
        }
        db.prepare(
          `INSERT INTO stock_movements (id, project_id, inventory_item_id, movement_type, quantity, reference_no, notes, created_by, created_at)
           VALUES (?, ?, ?, 'IN_GRN', ?, ?, ?, ?, ?)`
        ).run(crypto.randomUUID(), po.project_id, invId, receivedQty, deliveryNoteRef || po.po_number || receiptId, `Received on site from Purchase Order`, user.name || user.user_id, now);
        writeAudit(user.user_id, 'inventory_items', invId, po.project_id, 'grn_in', null, { material: matLabel, receivedQty });
      }

      res.status(201).json({
        ok: true,
        status: nextStatus,
        purchase_order: db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(po.id),
        receipt: db.prepare('SELECT * FROM site_material_receipts WHERE id = ?').get(receiptId),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // =========================================================================
  // SITE INVENTORY & WAREHOUSE MANAGEMENT (STOCK LEDGER, ISSUE & RETURN)
  // =========================================================================
  app.get('/api/inventory', authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const projectId = req.query.project_id as string;
      let sql = 'SELECT * FROM inventory_items WHERE 1=1';
      const params: any[] = [];
      if (projectId && projectId !== 'ALL') {
        if (!hasProjectAccess(user, projectId)) {
          res.status(403).json({ error: 'No access to project' });
          return;
        }
        sql += ' AND project_id = ?';
        params.push(projectId);
      }
      sql += ' ORDER BY material ASC';
      const rows = (db.prepare(sql).all(...params) as any[]).map(r => ({
        ...r,
        low_stock: Number(r.current_stock || 0) <= Number(r.min_stock_level || 0),
      }));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/inventory', authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      if (user.role === 'Client') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const { project_id, sku, material, category, unit, storage_location, current_stock, min_stock_level, unit_cost, boq_reference } = req.body || {};
      if (!project_id || !material) {
        res.status(400).json({ error: 'project_id and material required' });
        return;
      }
      if (!hasProjectAccess(user, project_id)) {
        res.status(403).json({ error: 'No access to project' });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const qty = Math.max(0, Number(current_stock || 0));
      db.prepare(
        `INSERT INTO inventory_items (id, project_id, sku, material, category, unit, storage_location, current_stock, min_stock_level, unit_cost, boq_reference, last_updated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        project_id,
        sku || `SKU-${id.slice(0, 6).toUpperCase()}`,
        material,
        category || 'MEP Material',
        unit || 'Unit',
        storage_location || 'Site Store',
        qty,
        Math.max(0, Number(min_stock_level ?? 5)),
        Math.max(0, Number(unit_cost || 0)),
        boq_reference || null,
        now,
        now
      );
      if (qty > 0) {
        db.prepare(
          `INSERT INTO stock_movements (id, project_id, inventory_item_id, movement_type, quantity, unit_cost, notes, created_by, created_at)
           VALUES (?, ?, ?, 'IN_GRN', ?, ?, 'Initial store stock', ?, ?)`
        ).run(crypto.randomUUID(), project_id, id, qty, Number(unit_cost || 0), user.name || user.user_id, now);
      }
      writeAudit(user.user_id, 'inventory_items', id, project_id, 'create', null, { material, current_stock: qty });
      res.status(201).json(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/inventory/:id/issue', authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      if (user.role === 'Client') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id) as any;
      if (!item) {
        res.status(404).json({ error: 'Inventory item not found' });
        return;
      }
      if (!hasProjectAccess(user, item.project_id)) {
        res.status(403).json({ error: 'No access to project' });
        return;
      }
      const { quantity, work_package_id, task_id, issued_to, reference_no, notes } = req.body || {};
      const qty = Number(quantity || 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        res.status(400).json({ error: 'Positive issue quantity required' });
        return;
      }
      if (qty > Number(item.current_stock || 0)) {
        res.status(400).json({ error: `Insufficient stock on hand (${item.current_stock} ${item.unit} available)` });
        return;
      }
      const now = new Date().toISOString();
      db.prepare(`UPDATE inventory_items SET current_stock = current_stock - ?, last_updated = ? WHERE id = ?`)
        .run(qty, now, item.id);
      const mvId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO stock_movements (id, project_id, inventory_item_id, movement_type, quantity, unit_cost, work_package_id, task_id, issued_to, reference_no, notes, created_by, created_at)
         VALUES (?, ?, ?, 'OUT_ISSUE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(mvId, item.project_id, item.id, qty, Number(item.unit_cost || 0), work_package_id || null, task_id || null, issued_to || null, reference_no || null, notes || null, user.name || user.user_id, now);
      writeAudit(user.user_id, 'inventory_items', item.id, item.project_id, 'issue', item, { quantity: qty, issued_to });
      res.status(201).json({
        ok: true,
        item: db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(item.id),
        movement: db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(mvId),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/inventory/:id/return', authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      if (user.role === 'Client') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id) as any;
      if (!item) {
        res.status(404).json({ error: 'Inventory item not found' });
        return;
      }
      if (!hasProjectAccess(user, item.project_id)) {
        res.status(403).json({ error: 'No access to project' });
        return;
      }
      const { quantity, reference_no, notes } = req.body || {};
      const qty = Number(quantity || 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        res.status(400).json({ error: 'Positive return quantity required' });
        return;
      }
      const now = new Date().toISOString();
      db.prepare(`UPDATE inventory_items SET current_stock = current_stock + ?, last_updated = ? WHERE id = ?`)
        .run(qty, now, item.id);
      const mvId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO stock_movements (id, project_id, inventory_item_id, movement_type, quantity, unit_cost, reference_no, notes, created_by, created_at)
         VALUES (?, ?, ?, 'RETURN', ?, ?, ?, ?, ?, ?)`
      ).run(mvId, item.project_id, item.id, qty, Number(item.unit_cost || 0), reference_no || null, notes || 'Returned unused material to site store', user.name || user.user_id, now);
      writeAudit(user.user_id, 'inventory_items', item.id, item.project_id, 'return', item, { quantity: qty });
      res.status(201).json({
        ok: true,
        item: db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(item.id),
        movement: db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(mvId),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/inventory/movements', authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const projectId = req.query.project_id as string;
      let sql = `SELECT sm.*, ii.material, ii.sku, ii.unit
                 FROM stock_movements sm
                 JOIN inventory_items ii ON ii.id = sm.inventory_item_id
                 WHERE 1=1`;
      const params: any[] = [];
      if (projectId && projectId !== 'ALL') {
        if (!hasProjectAccess(user, projectId)) {
          res.status(403).json({ error: 'No access to project' });
          return;
        }
        sql += ' AND sm.project_id = ?';
        params.push(projectId);
      }
      sql += ' ORDER BY sm.created_at DESC LIMIT 300';
      res.json(db.prepare(sql).all(...params));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Global FX Reference Rates (USD Base)
  app.get('/api/fx/rates', authRequired, (_req: Request, res: Response) => {
    res.json({
      base: 'USD',
      rates: {
        USD: 1,
        EUR: 0.92,
        GBP: 0.79,
        AED: 3.6725,
        SAR: 3.75,
        QAR: 3.64,
        SGD: 1.34,
        INR: 84.2,
        AUD: 1.52,
      },
      updated_at: new Date().toISOString(),
    });
  });
}
