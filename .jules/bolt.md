## 2026-09-11 - Database Indexing Performance Optimization
**Learning:** SQLite query performance degrades when querying unindexed `project_id` foreign keys and user session fields across aggregate endpoints like `/api/portfolio` and `/api/dashboard`. Adding composite and single-column `CREATE INDEX IF NOT EXISTS` statements during database initialization (`initDb`) eliminates full-table scans.
**Action:** Always ensure foreign key and filtering columns (`project_id`, `user_id`, `active`, `expires_at`, `record_id`) have explicit database indexes in SQLite applications.
