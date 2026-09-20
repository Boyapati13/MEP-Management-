-- Migration: 0141_01_reference_sequences.sql
-- Description: Creates the reference_sequences counter table and ensures uniqueness on action_no and decision_no

CREATE TABLE IF NOT EXISTS reference_sequences (
  project_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  next_val INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (project_id, entity_type)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_actions_no
ON project_actions (project_id, action_no);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_decisions_no
ON project_decisions (project_id, decision_no);
