import { Request, Response } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { publishProgressReport, createReportRevision } from '../services/progressPublication';

export function registerProgressRoutes(app: any, db: DatabaseSync, authRequired: any, hasProjectAccess: any, writeAudit: any) {
  // Authoritative Publish Routes (by URL param or body)
  app.post(['/api/progress_reports/:id/publish', '/api/progress-reports/:id/publish', '/api/progress-reports/publish', '/api/progress_reports/publish'], authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      let reportId = req.params.id || req.body.id || req.body.report_id;

      if (!reportId && req.body.project_id) {
        // Create initial draft progress report from body
        const newId = crypto.randomUUID();
        const now = new Date().toISOString();
        const reportNo = `PR-${Date.now().toString().slice(-4)}`;
        db.prepare(`
          INSERT INTO progress_reports (
            id, project_id, report_no, title, period_start, period_end,
            executive_summary, status, revision_no, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Draft', 0, ?, ?)
        `).run(
          newId,
          req.body.project_id,
          reportNo,
          req.body.title || `Progress Report ${reportNo}`,
          req.body.period_start || req.body.period_date || now.slice(0, 10),
          req.body.period_end || req.body.period_date || now.slice(0, 10),
          req.body.narrative || req.body.executive_summary || '',
          user.user_id,
          now
        );
        reportId = newId;
      }

      if (!reportId) {
        res.status(400).json({ error: 'Report ID or project_id is required' });
        return;
      }

      const existing = db.prepare('SELECT * FROM progress_reports WHERE id=?').get(reportId) as any;
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

      const result = publishProgressReport(db, reportId, user);
      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      writeAudit(user.user_id, 'progress_reports', reportId, existing.project_id, 'publish', existing, result.report);
      res.json(result.report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Formal Revision Route
  app.post(['/api/progress_reports/:id/revise', '/api/progress-reports/:id/revise', '/api/progress-reports/revise', '/api/progress_reports/revise'], authRequired, (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const reportId = req.params.id || req.body.original_report_id || req.body.report_id;
      if (!reportId) {
        res.status(400).json({ error: 'Original report ID is required' });
        return;
      }

      const existing = db.prepare('SELECT * FROM progress_reports WHERE id=?').get(reportId) as any;
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

      const result = createReportRevision(db, reportId, user);
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
  app.post(['/api/progress_submissions/:id/verify', '/api/progress-submissions/:id/verify', '/api/progress-reports/verify/:id'], authRequired, (req: Request, res: Response) => {
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
