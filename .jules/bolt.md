## 2026-03-31 - Prepared Statements & Memoized Project Scope
**Learning:** SQLite query performance under 50 concurrent client connections in Node `node:sqlite` relies heavily on prepared statement caching and per-request project authorization memoization (`canAccessProject`).
**Action:** Always verify prepared statement reuse and per-request memoization caches are preserved when touching auth/scoping logic.
