/**
 * MEP Management Platform — Reset & Clean Database
 * Removes all demo, test, and transient execution data from the SQLite database.
 * Leaves the database in a clean, production-ready state with only the bootstrap
 * Administrator account and standard baseline system configuration (e.g. leave types).
 *
 * Usage:
 *   npx tsx scripts/reset_clean_db.ts
 */
import { DatabaseSync } from 'node:sqlite';
import * as path from 'path';
import * as fs from 'fs';

const DB_PATH = process.env.MEP_DB_PATH || path.join(process.cwd(), 'mep_pm.db');

export function cleanDatabase(dbPath: string = DB_PATH) {
  console.log(`[CLEAN-DB] Cleaning database at: ${dbPath}`);

  if (!fs.existsSync(dbPath)) {
    console.log(`[CLEAN-DB] Database file does not exist at ${dbPath}. Nothing to clean.`);
    return;
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 10000;');
  db.exec('PRAGMA foreign_keys = OFF;');

  const allTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const { name: table } of allTables) {
      if (table === 'users' || table === 'leave_types' || table === 'schema_migrations') {
        continue;
      }
      try {
        db.exec(`DELETE FROM "${table}";`);
      } catch (err: any) {
        // Table may not exist in all schema variations
      }
    }

    // Keep ONLY the bootstrap 'admin' user; remove all test/seed users
    try {
      db.exec(`DELETE FROM users WHERE username != 'admin';`);
      db.exec(`
        UPDATE users
        SET email = 'admin@mepfieldhub.com',
            name = 'Administrator',
            company = 'MEP FieldHub Enterprise',
            stakeholder_type = 'Main Admin',
            status = 'Active',
            must_change_password = 0
        WHERE username = 'admin';
      `);
    } catch {}

    db.exec('COMMIT;');
    console.log('[CLEAN-DB] Successfully purged all test and demo records from all tables.');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }

  // Reclaim disk space and defragment SQLite database file
  console.log('[CLEAN-DB] Executing VACUUM to reclaim disk space...');
  db.exec('VACUUM;');

  // Verify integrity and remaining record counts
  const integrity = db.prepare('PRAGMA integrity_check;').get() as any;
  const projectCount = (db.prepare('SELECT COUNT(*) as c FROM projects;').get() as any)?.c ?? 0;
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users;').get() as any)?.c ?? 0;
  const taskCount = (db.prepare('SELECT COUNT(*) as c FROM tasks;').get() as any)?.c ?? 0;
  const auditCount = (db.prepare('SELECT COUNT(*) as c FROM audit_logs;').get() as any)?.c ?? 0;

  console.log(`[CLEAN-DB] Integrity check: ${JSON.stringify(integrity)}`);
  console.log(`[CLEAN-DB] State after cleanup:`);
  console.log(`  - Projects:   ${projectCount}`);
  console.log(`  - Users:      ${userCount} (bootstrap admin only)`);
  console.log(`  - Tasks:      ${taskCount}`);
  console.log(`  - Audit logs: ${auditCount}`);

  db.close();

  const finalSize = fs.statSync(dbPath).size;
  console.log(`[CLEAN-DB] Database file size: ${(finalSize / 1024).toFixed(1)} KB`);

  // Remove auxiliary test databases if present
  const tempDbs = ['mep_test.db', 'test_ci.db', 'test_ci.db-wal', 'test_ci.db-shm'];
  for (const f of tempDbs) {
    const full = path.join(process.cwd(), f);
    if (fs.existsSync(full)) {
      try {
        fs.unlinkSync(full);
        console.log(`[CLEAN-DB] Removed temporary database file: ${f}`);
      } catch {}
    }
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('reset_clean_db.ts')) {
  cleanDatabase();
}
