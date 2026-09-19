## 2026-09-19 - SQLite Foreign Key Query Optimization via Secondary Indexes
**Learning:** SQLite tables without explicit indexes on frequently queried foreign keys (`project_id`, `user_id`, `task_id`) cause full table scans (`SCAN <table>`) across high-frequency API endpoints such as `/api/portfolio` and `/api/dashboard`, resulting in linear performance degradation as the database grows.
**Action:** Always define `CREATE INDEX IF NOT EXISTS` on key foreign key columns in `initDb()` for SQLite-backed Express endpoints to ensure O(log N) index lookups instead of O(N) full table scans.
