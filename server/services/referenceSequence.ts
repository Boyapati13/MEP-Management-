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

  // Initialize or increment sequence atomically
  db.exec(`
    INSERT INTO reference_sequences (project_id, entity_type, next_val)
    VALUES ('${projectId}', '${entityType}', 1)
    ON CONFLICT(project_id, entity_type)
    DO UPDATE SET next_val = reference_sequences.next_val + 1;
  `);

  const row = db.prepare(
    'SELECT next_val FROM reference_sequences WHERE project_id = ? AND entity_type = ?'
  ).get(projectId, entityType) as any;

  const currentVal = row ? Number(row.next_val) : 1;
  return `${prefix}-${String(currentVal).padStart(4, '0')}`;
}
