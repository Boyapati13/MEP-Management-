## 2026-03-31 - SQLite Table Scans on Project-Scoped Entities
**Learning:** In `server.ts`, almost all domain entities filter by `project_id` or `user_id` (e.g. portfolio overview, dashboard stats, generic CRUD, notifications). Without explicit B-tree indexes, SQLite performs $O(N)$ `SCAN TABLE` operations for every query, scaling poorly ($O(M \cdot N)$ in portfolio loops).
**Action:** Always maintain B-tree indexes (`CREATE INDEX IF NOT EXISTS`) for `project_id`, `user_id`, `task_id`, and `bucket_id` in `initDb()` to ensure $O(\log N)$ `SEARCH USING INDEX` query execution plans.
