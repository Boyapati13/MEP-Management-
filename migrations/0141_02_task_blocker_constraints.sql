-- Migration: 0141_02_task_blocker_constraints.sql
-- Description: Partial unique index for system-generated task blockers (protects against duplicate automated blockers while allowing multiple manual blockers)

CREATE UNIQUE INDEX IF NOT EXISTS uq_system_task_blocker
ON task_blockers (task_id, blocker_type, source_type, source_id)
WHERE source_type IS NOT NULL AND source_id IS NOT NULL;
