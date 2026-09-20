import { Request, Response } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { publishProgressReport, createReportRevision } from '../services/progressPublication';

export function registerProgressRoutes(app: any, db: DatabaseSync, authRequired: any, hasProjectAccess: any, writeAudit: any) {
  // Authoritative Single Publish Route
  app.post('/api/progress_reports/:id/publish', authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const existing = db.prepare('SELECT * FROM progress_reports WHERE id=?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }

      if (!hasProjectAccess(user, existing.project_id)) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }

      if (user.role !== 'Admin' && user.role !== 'ProjectManager') {
        res.status(403).json({ error: 'Only Project Managers and Admins can publish progress reports' });
        return;
      }

      const result = publishProgressReport(db, req.params.id, user);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      writeAudit(user.user_id, 'progress_reports', req.params.id, existing.project_id, 'publish', existing, result.report);
      res.json(result.report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Formal Revision Route
  app.post('/api/progress_reports/:id/revise', authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const existing = db.prepare('SELECT * FROM progress_reports WHERE id=?').get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }

      if (!hasProjectAccess(user, existing.project_id)) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }

      if (user.role !== 'Admin' && user.role !== 'ProjectManager') {
        res.status(403).json({ error: 'Only Project Managers and Admins can revise progress reports' });
        return;
      }

      const result = createReportRevision(db, req.params.id, user);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      writeAudit(user.user_id, 'progress_reports', result.new_report.id, existing.project_id, 'create_revision', null, result.new_report);
      res.status(201).json(result.new_report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PM Verification Route for Subcontractor Claims
  app.post('/api/progress_submissions/:id/verify', authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const claim = db.prepare('SELECT * FROM progress_submissions WHERE id=?').get(req.params.id) as any;
      if (!claim) {
        res.status(404).json({ error: 'Progress submission not found' });
        return;
      }

      if (!hasProjectAccess(user, claim.project_id)) {
        res.status(403).json({ error: 'No access to project' });
        return;
      }

      // Role check: Only PM or Admin can verify
      if (user.role !== 'Admin' && user.role !== 'ProjectManager' && user.role !== 'CommercialManager') {
        res.status(403).json({ error: 'Only Project Managers or Commercial Managers can verify progress claims' });
        return;
      }

      // Conflict of interest check: Verifier cannot belong to the same company as the claim
      if (user.company_id && user.company_id === claim.company_id) {
        res.status(403).json({ error: 'Subcontractors or claim submitters cannot verify their own progress claims' });
        return;
      }

      const { certified_percentage, certified_amount, notes, status } = req.body;
      const certPct = Number(certified_percentage ?? claim.claimed_percentage ?? 0);
      const certAmt = Number(certified_amount ?? claim.claimed_amount ?? 0);
      const nextStatus = status || 'Approved';
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE progress_submissions
        SET certified_percentage = ?,
            certified_amount = ?,
            status = ?,
            verified_by = ?,
            verified_at = ?,
            verification_notes = ?
        WHERE id = ?
      `).run(certPct, certAmt, nextStatus, user.name, now, notes || null, req.params.id);

      writeAudit(user.user_id, 'progress_submissions', req.params.id, claim.project_id, 'verify', claim, {
        certified_percentage: certPct,
        certified_amount: certAmt,
        status: nextStatus,
        verified_by: user.name
      });

      const updated = db.prepare('SELECT * FROM progress_submissions WHERE id=?').get(req.params.id);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
