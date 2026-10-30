## 2026-10-30 - SQLite WAL Mode & High-Frequency Foreign Key Indexing Performance

**Learning:** Node's native `node:sqlite` (`DatabaseSync`) defaults to standard rollback journal mode without Write-Ahead Logging (WAL) or page cache allocation. Under high concurrency (50 client workers / 500 requests), disk sync stalls and unindexed foreign key lookups in `dependencies`, `tasks`, `attendance`, `site_instructions`, `submittals`, `rfis`, and `punchlist` cause table scan bottlenecks in Control Tower and Lookahead APIs.

**Action:** Always initialize SQLite connections with `PRAGMA journal_mode = WAL;`, `PRAGMA synchronous = NORMAL;`, `PRAGMA busy_timeout = 5000;`, and `PRAGMA cache_size = -20000;` alongside targeted composite and foreign key indexes on high-frequency query columns (`task_id`, `work_package_id`, `project_id, work_date`, `project_id, status`).
