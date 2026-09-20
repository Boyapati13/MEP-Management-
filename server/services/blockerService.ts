import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { evaluateProcurementImpact } from './procurementRisk';

/**
 * Manages automated lifecycle of procurement task blockers with deterministic idempotency.
 * Auto-creates when buffer < 0.
 * Auto-resolves when buffer >= 0 or item delivered.
 * NEVER resolves manual blockers.
 */
export function syncProcurementTaskBlocker(
  db: DatabaseSync,
  po: {
    id: string;
    project_id: string;
    task_id?: string | null;
    po_number?: string | null;
    item_name?: string | null;
    expected_delivery_date?: string | null;
    status?: string | null;
  }
): { blocker_id?: string; action: 'created' | 'updated' | 'resolved' | 'none' } {
  if (!po.task_id) return { action: 'none' };

  // Fetch linked task start date
  const task = db.prepare('SELECT id, project_id, title, start_date FROM tasks WHERE id = ?').get(po.task_id) as any;
  if (!task) return { action: 'none' };

  const impact = evaluateProcurementImpact(
    task.start_date,
    po.expected_delivery_date,
    po.status
  );

  const now = new Date().toISOString();

  // Find existing system blocker
  const existingBlocker = db.prepare(
    `SELECT id, resolved FROM task_blockers
     WHERE task_id = ? AND blocker_type = 'Procurement' AND source_type = 'purchase_order' AND source_id = ?`
  ).get(po.task_id, po.id) as any;

  if (impact.is_blocked) {
    const delayDays = Math.max(1, Math.abs(impact.buffer_days));
    const desc = `Procurement Delay: PO ${po.po_number || ''} (${po.item_name || 'Materials'}) forecast ${po.expected_delivery_date} is after task start ${task.start_date}`;

    if (existingBlocker) {
      db.prepare(`
        UPDATE task_blockers
        SET impact_days = ?, description = ?, resolved = 0, resolved_at = NULL, severity = 'Critical'
        WHERE id = ?
      `).run(delayDays, desc, existingBlocker.id);

      // Also ensure task status reflects blocked if not completed
      db.prepare(`UPDATE tasks SET status = 'Blocked' WHERE id = ? AND status NOT IN ('Completed', 'Closed')`).run(po.task_id);

      return { blocker_id: existingBlocker.id, action: 'updated' };
    } else {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO task_blockers (
          id, project_id, task_id, blocker_type, source_type, source_id,
          description, impact_days, severity, resolved, created_at
        ) VALUES (?, ?, ?, 'Procurement', 'purchase_order', ?, ?, ?, 'Critical', 0, ?)
      `).run(id, task.project_id, po.task_id, po.id, desc, delayDays, now);

      db.prepare(`UPDATE tasks SET status = 'Blocked' WHERE id = ? AND status NOT IN ('Completed', 'Closed')`).run(po.task_id);

      return { blocker_id: id, action: 'created' };
    }
  } else {
    // Unblocked (buffer >= 0 or Delivered) -> auto-resolve system blocker if active
    if (existingBlocker && !existingBlocker.resolved) {
      db.prepare(`
        UPDATE task_blockers
        SET resolved = 1, resolved_at = ?
        WHERE id = ?
      `).run(now, existingBlocker.id);

      // Check if there are other unresolved blockers on this task
      const remaining = db.prepare(
        `SELECT COUNT(*) as cnt FROM task_blockers WHERE task_id = ? AND resolved = 0`
      ).get(po.task_id) as any;

      if (!remaining || remaining.cnt === 0) {
        db.prepare(`UPDATE tasks SET status = 'In Progress' WHERE id = ? AND status = 'Blocked'`).run(po.task_id);
      }

      return { blocker_id: existingBlocker.id, action: 'resolved' };
    }
  }

  return { action: 'none' };
}
