import path from "path";
import { DatabaseSync } from "node:sqlite";

export const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
export const DB_PATH = process.env.MEP_DB_PATH || path.join(process.cwd(), "mep_pm.db");
export const db = new DatabaseSync(DB_PATH);

// Performance Optimization (⚡ Bolt): Configure SQLite PRAGMAs upon database initialization
// - WAL mode allows concurrent readers and writers without blocking execution threads
// - synchronous = NORMAL maintains safety in WAL mode while eliminating redundant fsync calls
// - busy_timeout avoids SQLITE_BUSY lock exceptions under high concurrency
// - cache_size = -20000 allocates 20MB page cache in memory for hot tables and indexes
try {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA cache_size = -20000;");
} catch {}

export function rowToDict(row: any): Record<string, any> | null {
  if (!row) return null;
  return { ...row };
}
