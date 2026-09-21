import { DatabaseSync } from 'node:sqlite';

/**
 * Generates a collision-safe, monotonic reference number for a project entity.
 * Uses atomic upsert on reference_sequences table.
 * Example outputs: ACT-0001, DEC-0001, SI-0001, PR-0001
 */
export function getNextSequence(
  db: DatabaseSync,
  projectId: string,
  entityType: 'action' | 'decision' | 'site_instruction' | 'progress_report' | 'rfi' | 'submittal'
): string {
  const prefixMap: Record<string, string> = {
    action: 'ACT',
    decision: 'DEC',
    site_instruction: 'SI',
    progress_report: 'PR',
    rfi: 'RFI',
    submittal: 'SUB'
  };

  const prefix = prefixMap[entityType] || entityType.toUpperCase().slice(0, 3);

  // Initialize or increment sequence atomically with RETURNING
  const row = db.prepare(`
    INSERT INTO reference_sequences (project_id, entity_type, next_val)
    VALUES (?, ?, 1)
    ON CONFLICT(project_id, entity_type)
    DO UPDATE SET next_val = reference_sequences.next_val + 1
    RETURNING next_val
  `).get(projectId, entityType) as any;

  const currentVal = row && row.next_val != null ? Number(row.next_val) : 1;
  return `${prefix}-${String(currentVal).padStart(4, '0')}`;
}
