## 2025-05-10 - Indexing project_id across all MEP domain tables
**Learning:** `projectScopeSql` scopes almost all domain GET endpoints by `project_id` (e.g., `WHERE project_id = ?` or `WHERE project_id IN (...)`). Without indexes on `project_id`, multi-project and scoped dashboard queries trigger full table scans across all domain entities as data grows.
**Action:** Always ensure `CREATE INDEX IF NOT EXISTS idx_<table_name>_project_id ON <table_name>(project_id)` is defined in `initDb()` for any new domain table added to the schema.
