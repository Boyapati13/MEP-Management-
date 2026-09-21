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

  // Tables to completely truncate (wipe all test/demo records)
  const tablesToTruncate = [
    'attendance',
    'audit_logs',
    'boq_items',
    'change_orders',
    'clarifications',
    'clarification_comments',
    'commissioning_tests',
    'dailylogs',
    'document_revisions',
    'documents',
    'handover_items',
    'ncrs',
    'notifications',
    'plan_buckets',
    'plan_tasks',
    'progress_reports',
    'progress_report_photos',
    'progress_submissions',
    'project_actions',
    'project_decisions',
    'project_memberships',
    'projects',
    'punchlist',
    'purchase_orders',
    'material_requests',
    'record_owners',
    'reference_sequences',
    'rfis',
    'safety_incidents',
    'sessions',
    'sites',
    'site_instructions',
    'submittals',
    'task_blockers',
    'task_status_history',
    'tasks',
    'transmittal_items',
    'transmittals',
    'variations',
    'wbs_items',
    'work_packages',
    'workers'
  ];

  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const table of tablesToTruncate) {
      try {
        db.exec(`DELETE FROM "${table}";`);
      } catch (err: any) {
        // Table may not exist in all schema variations
      }
    }

    // Keep ONLY the bootstrap 'admin' user; remove all test/seed users
    try {
      db.exec(`DELETE FROM users WHERE username != 'admin';`);
    } catch {}

    db.exec('COMMIT;');
    console.log('[CLEAN-DB] Successfully purged all test and demo records from tables.');
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw err;
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
