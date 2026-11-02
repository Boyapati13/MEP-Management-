# Bolt's Performance Journal

## 2026-11-02 - SQLite Prepared Statement Caching & Query Consolidation in Auth Middleware
**Learning:** Re-preparing SQLite queries on every HTTP request in authentication middleware (`getCurrentUser`) introduces significant overhead (~5s vs ~830ms over 100k calls, an ~83% latency reduction). Consolidating multi-table round trips (`sessions`, `users`, and `companies`) into a single `LEFT JOIN` with a persistent prepared statement eliminates redundant statement compilation and round-trip lock contention on Node's native `DatabaseSync`.
**Action:** When working on frequently traversed middleware or high-frequency endpoints, prefer caching prepared statements at module scope and consolidating relational checks into single joined queries rather than calling `db.prepare()` repeatedly in request handlers.
