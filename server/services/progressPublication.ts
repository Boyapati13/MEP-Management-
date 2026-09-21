import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw err;
  }
}

/**
 * Transactional Progress Report Publication and Revisioning Engine.
 * Freezes live task, milestone, and claim data into immutable snapshot_data.
 * Manages formal revision ledger (Revision 0 is never modified; amendments create Revision 1 superseding Revision 0).
 */
export function publishProgressReport(
  db: DatabaseSync,
  reportId: string,
  user: { user_id: string; name: string }
): { success: boolean; report?: any; error?: string } {
  return withTransaction(db, () => {
    const report = db.prepare('SELECT * FROM progress_reports WHERE id = ?').get(reportId) as any;
    if (!report) {
      return { success: false, error: 'Report not found' };
    }

    const now = new Date().toISOString();

    // If already published, do not allow silent re-mutation
    if (report.status === 'Published') {
      return {
        success: false,
        error: 'Report is already published. To amend, create a new revision superseding this report.'
      };
    }

  // Compile immutable snapshot from live project data
  const projectId = report.project_id;

  // 1. Snapshot tasks progress
  const tasks = db.prepare(`
    SELECT id, title, trade, status, progress, start as start_date, end as end_date, work_package_id
    FROM tasks
    WHERE project_id = ?
    ORDER BY title
  `).all(projectId);

  // 2. Snapshot certified progress claims
  const claims = db.prepare(`
    SELECT id, work_package_id, company_id, claimed_percent, status
    FROM progress_submissions
    WHERE project_id = ?
  `).all(projectId);

  // 3. Snapshot work packages
  const packages = db.prepare(`
    SELECT id, code, name, discipline, status
    FROM work_packages
    WHERE project_id = ?
  `).all(projectId);

  // Calculate overall weighted project completion percentage
  let overallProgress = 0;
  if (tasks.length > 0) {
    const sum = tasks.reduce((acc: number, t: any) => acc + Number(t.progress || 0), 0);
    overallProgress = Math.round(sum / tasks.length);
  }

  const snapshot = {
    schema_version: 1,
    frozen_at: now,
    published_by_user_id: user.user_id,
    published_by_name: user.name,
    project_id: projectId,
    overall_progress_percent: overallProgress,
    tasks_count: tasks.length,
    work_packages: packages,
    progress_submissions: claims,
    tasks_summary: tasks.map((t: any) => ({ id: t.id, title: t.title, progress: t.progress, status: t.status }))
  };

  const snapshotJson = JSON.stringify(snapshot);

  // Update in SQLite
  db.prepare(`
    UPDATE progress_reports
    SET status = 'Published',
        published_at = ?,
        published_by = ?,
        overall_progress_percent = ?,
        snapshot_data = ?,
        snapshot_schema_version = 1,
        revision_no = COALESCE(revision_no, 0)
    WHERE id = ?
  `).run(now, user.name, overallProgress, snapshotJson, reportId);

    const updated = db.prepare('SELECT * FROM progress_reports WHERE id = ?').get(reportId);
    return { success: true, report: updated };
  });
}

/**
 * Creates a formal revision of an already published report.
 * The original report remains permanent and immutable.
 */
export function createReportRevision(
  db: DatabaseSync,
  originalReportId: string,
  user: { user_id: string; name: string }
): { success: boolean; new_report?: any; error?: string } {
  return withTransaction(db, () => {
    const original = db.prepare('SELECT * FROM progress_reports WHERE id = ?').get(originalReportId) as any;
    if (!original) return { success: false, error: 'Original report not found' };
    if (original.status !== 'Published') {
      return { success: false, error: 'Cannot revise an unpublished draft report' };
    }

    const newId = crypto.randomUUID();
    const nextRev = (Number(original.revision_no) || 0) + 1;
    const now = new Date().toISOString();
    const baseNo = original.report_no.split('-REV')[0];
    const newReportNo = `${baseNo}-REV${nextRev}`;

    db.prepare(`
      INSERT INTO progress_reports (
        id, project_id, report_no, title, period_start, period_end,
        executive_summary, status, revision_no, supersedes_report_id,
        created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Draft', ?, ?, ?, ?)
    `).run(
      newId,
      original.project_id,
      newReportNo,
      `${original.title} (Rev ${nextRev})`,
      original.period_start,
      original.period_end,
      original.executive_summary,
      nextRev,
      originalReportId,
      user.user_id,
      now
    );

    const newReport = db.prepare('SELECT * FROM progress_reports WHERE id = ?').get(newId);
    return { success: true, new_report: newReport };
  });
}
