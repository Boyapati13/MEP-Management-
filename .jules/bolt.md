## 2026-09-10 - Unindexed SQLite relational filtering causes O(N) table scans across all entity queries
**Learning:** In this Node/Express SQLite architecture, `initDb()` created over 20 tables without any index on `project_id`, `user_id`, or foreign key columns. Because every API endpoint filters by `project_id` or `user_id` via `projectScopeSql`, every request triggered full table scans.
**Action:** Always verify `CREATE INDEX IF NOT EXISTS` for all foreign keys (`project_id`, `user_id`, `task_id`, `bucket_id`) in SQLite schemas to ensure $O(\log N)$ query complexity.
