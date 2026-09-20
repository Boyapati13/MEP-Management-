-- Migration: 0141_03_progress_report_snapshots.sql
-- Description: Adds snapshot storage and formal revision tracking to progress_reports

ALTER TABLE progress_reports ADD COLUMN revision_no INTEGER DEFAULT 0;
ALTER TABLE progress_reports ADD COLUMN supersedes_report_id TEXT;
ALTER TABLE progress_reports ADD COLUMN snapshot_schema_version INTEGER DEFAULT 1;
ALTER TABLE progress_reports ADD COLUMN snapshot_data TEXT;
ALTER TABLE progress_reports ADD COLUMN published_at TEXT;
ALTER TABLE progress_reports ADD COLUMN published_by TEXT;
