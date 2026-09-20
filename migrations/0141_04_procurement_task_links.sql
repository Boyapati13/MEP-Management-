-- Migration: 0141_04_procurement_task_links.sql
-- Description: Indexes procurement task links and adds explicit subcontractor access scope columns

CREATE INDEX IF NOT EXISTS idx_po_task ON purchase_orders (project_id, task_id);
CREATE INDEX IF NOT EXISTS idx_po_wp ON purchase_orders (project_id, work_package_id);
CREATE INDEX IF NOT EXISTS idx_mr_task ON material_requests (project_id, task_id);

ALTER TABLE users ADD COLUMN access_scope TEXT DEFAULT 'work_package';
ALTER TABLE users ADD COLUMN allowed_work_package_ids TEXT;
