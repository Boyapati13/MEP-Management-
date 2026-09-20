import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { DatabaseSync } from 'node:sqlite';

let passed = 0;
let failed = 0;

function assert(condition: boolean, desc: string, detail?: any) {
  if (condition) {
    console.log(`  [PASS] ${desc}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${desc}`);
    if (detail) console.error('     Detail:', detail);
    failed++;
  }
}

function waitForHealth(port: number, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const req = http.get({ hostname: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else if (Date.now() - start > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 300);
        }
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 300);
        }
      });
    };
    check();
  });
}

async function stopServer(proc: ChildProcess): Promise<void> {
  if (!proc || proc.killed) return;
  return new Promise((resolve) => {
    proc.on('exit', () => resolve());
    proc.kill('SIGTERM');
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolve();
    }, 2000);
  });
}

async function runMigrationSuite() {
  console.log('================================================================================');
  console.log('  MEP DATABASE MIGRATION & TEST ISOLATION SUITE');
  console.log('  Testing Fresh Install Initialization & Pre-V1.1 Schema Upgrade Paths');
  console.log('================================================================================\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mep-migration-test-'));
  const freshDbPath = path.join(tmpDir, 'test_fresh.db');
  const upgradeDbPath = path.join(tmpDir, 'test_upgrade.db');
  const TEST_PORT = 3199;

  try {
    // ========================================================================
    // PATH 1: FRESH INSTALL INITIALIZATION & IDEMPOTENT RESTART
    // ========================================================================
    console.log('>>> PATH 1: Fresh Database Initialization & Startup');

    assert(!fs.existsSync(freshDbPath), 'Fresh test database file does not exist prior to boot');

    const freshServer = spawn(process.execPath, [path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, MEP_DB_PATH: freshDbPath, PORT: String(TEST_PORT) },
      stdio: 'pipe'
    });

    const isHealthy = await waitForHealth(TEST_PORT);
    assert(isHealthy, 'Server successfully booted with fresh ephemeral database and responded 200 to /api/health');
    assert(fs.existsSync(freshDbPath), 'SQLite database file was generated automatically by initDb()');

    // Inspect database tables
    const db1 = new DatabaseSync(freshDbPath);
    const tables = (db1.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(t => t.name);

    const requiredTables = [
      'users', 'projects', 'companies', 'project_companies', 'project_memberships',
      'tasks', 'documents', 'rfis', 'submittals', 'punchlist', 'change_orders',
      'clarifications', 'clarification_comments', 'progress_reports', 'progress_submissions',
      'sessions', 'audit_logs',
      'sites', 'workers', 'worker_assignments', 'shift_templates', 'worker_schedules',
      'attendance', 'attendance_adjustments', 'public_holidays',
      'leave_types', 'leave_requests', 'leave_balances',
      'payroll_profiles', 'payroll_periods', 'payroll_entries', 'payroll_adjustments',
      'site_instructions', 'site_instruction_updates', 'site_instruction_attachments'
    ];

    for (const t of requiredTables) {
      assert(tables.includes(t), `Core table '${t}' initialized in fresh database`);
    }

    const adminUser = db1.prepare("SELECT * FROM users WHERE username='admin'").get() as any;
    assert(Boolean(adminUser && adminUser.role === 'Admin'), 'Bootstrap Admin account seeded in fresh database');
    db1.close();

    // Stop and restart to test idempotency
    await stopServer(freshServer);
    console.log('  Testing server restart on fresh database...');

    const freshServerRestart = spawn(process.execPath, [path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, MEP_DB_PATH: freshDbPath, PORT: String(TEST_PORT) },
      stdio: 'pipe'
    });

    const isHealthy2 = await waitForHealth(TEST_PORT);
    assert(isHealthy2, 'Server restarted cleanly without schema or initialization errors');

    const db2 = new DatabaseSync(freshDbPath);
    const adminCount = (db2.prepare("SELECT count(*) as count FROM users WHERE username='admin'").get() as any).count;
    assert(adminCount === 1, 'Bootstrap Admin count remains exactly 1 after restart (no duplicate seed)');
    db2.close();

    await stopServer(freshServerRestart);

    // ========================================================================
    // PATH 2: PRE-V1.1 SCHEMA UPGRADE & MIGRATION VERIFICATION
    // ========================================================================
    console.log('\n>>> PATH 2: Legacy Pre-V1.1 Schema Upgrade & Data Preservation');

    // Create a mock legacy database with pre-V1.1 schema
    const legacyDb = new DatabaseSync(upgradeDbPath);
    legacyDb.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        client TEXT,
        status TEXT,
        start_date TEXT,
        end_date TEXT,
        budget REAL
      );
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT,
        category TEXT,
        revision TEXT,
        date_added TEXT,
        attachment_name TEXT,
        attachment_data TEXT
      );
      CREATE TABLE change_orders (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        number TEXT,
        title TEXT,
        cost_impact REAL,
        status TEXT
      );
      CREATE TABLE rfis (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        number TEXT,
        subject TEXT,
        status TEXT
      );
    `);

    // Insert legacy pre-existing data
    legacyDb.exec(`
      INSERT INTO users (id, username, name, password_hash, role)
      VALUES ('legacy-pm-01', 'legacy_pm', 'Legacy Project Manager', 'hash123', 'ProjectManager');

      INSERT INTO projects (id, name, client, status, start_date, end_date, budget)
      VALUES ('legacy-proj-01', 'Legacy Office Refurb', 'Old Client Corp', 'Active', '2025-01-01', '2025-12-31', 500000);

      INSERT INTO documents (id, project_id, name, category, revision, date_added)
      VALUES ('legacy-doc-01', 'legacy-proj-01', 'Legacy Specification.pdf', 'Specification', 'Rev 0', '2025-01-15');
    `);
    legacyDb.close();

    assert(fs.existsSync(upgradeDbPath), 'Legacy database seeded with pre-V1.1 schema and records');

    // Boot server pointing to legacy database
    const upgradeServer = spawn(process.execPath, [path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, MEP_DB_PATH: upgradeDbPath, PORT: String(TEST_PORT) },
      stdio: 'pipe'
    });

    const isUpgradeHealthy = await waitForHealth(TEST_PORT);
    assert(isUpgradeHealthy, 'Server successfully migrated legacy database and booted cleanly');

    const upgradedDb = new DatabaseSync(upgradeDbPath);

    // Verify migrated columns in users table
    const userCols = (upgradedDb.prepare("PRAGMA table_info(users)").all() as any[]).map(c => c.name);
    assert(userCols.includes('status'), 'Migration added status column to users');
    assert(userCols.includes('company_id'), 'Migration added company_id column to users');
    assert(userCols.includes('work_package_id'), 'Migration added work_package_id column to users');

    // Verify migrated columns in documents table
    const docCols = (upgradedDb.prepare("PRAGMA table_info(documents)").all() as any[]).map(c => c.name);
    assert(docCols.includes('visibility'), 'Migration added visibility column to documents');
    assert(docCols.includes('published_at'), 'Migration added published_at column to documents');

    // Verify migrated columns in change_orders & rfis
    const coCols = (upgradedDb.prepare("PRAGMA table_info(change_orders)").all() as any[]).map(c => c.name);
    assert(coCols.includes('source_clarification_id'), 'Migration added source_clarification_id column to change_orders');
    assert(coCols.includes('visibility'), 'Migration added visibility column to change_orders');

    const rfiCols = (upgradedDb.prepare("PRAGMA table_info(rfis)").all() as any[]).map(c => c.name);
    assert(rfiCols.includes('source_clarification_id'), 'Migration added source_clarification_id column to rfis');

    // Verify V1.2.1 workforce/payroll migration schema on upgraded database
    const attendanceCols = (upgradedDb.prepare("PRAGMA table_info(attendance)").all() as any[]).map(c => c.name);
    for (const col of [
      'site_id', 'worker_id', 'company_id', 'work_package_id', 'supervisor_id',
      'elapsed_minutes', 'regular_minutes', 'break_minutes',
      'raw_overtime_minutes', 'approved_overtime_minutes',
      'late_minutes', 'attendance_status', 'ot_status', 'ot_reject_reason'
    ]) {
      assert(attendanceCols.includes(col), `Migration added attendance.${col}`);
    }

    const shiftCols = (upgradedDb.prepare("PRAGMA table_info(shift_templates)").all() as any[]).map(c => c.name);
    assert(shiftCols.includes('working_days_json'), 'Migration added working_days_json to shift_templates');

    const payrollEntryCols = (upgradedDb.prepare("PRAGMA table_info(payroll_entries)").all() as any[]).map(c => c.name);
    for (const col of [
      'elapsed_minutes', 'regular_minutes', 'break_minutes',
      'raw_overtime_minutes', 'approved_overtime_minutes'
    ]) {
      assert(payrollEntryCols.includes(col), `Migration added payroll_entries.${col}`);
    }

    const workforceTables = (upgradedDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(t => t.name);
    for (const table of [
      'sites', 'workers', 'worker_assignments', 'shift_templates', 'worker_schedules',
      'public_holidays', 'leave_requests', 'payroll_profiles', 'payroll_periods',
      'payroll_entries', 'site_instructions'
    ]) {
      assert(workforceTables.includes(table), `Migration created workforce table '${table}'`);
    }

    // Verify pre-existing data is completely intact
    const legacyUser = upgradedDb.prepare("SELECT * FROM users WHERE id='legacy-pm-01'").get() as any;
    assert(Boolean(legacyUser && legacyUser.name === 'Legacy Project Manager'), 'Pre-existing legacy user preserved after migration');

    const legacyDoc = upgradedDb.prepare("SELECT * FROM documents WHERE id='legacy-doc-01'").get() as any;
    assert(Boolean(legacyDoc && legacyDoc.name === 'Legacy Specification.pdf'), 'Pre-existing legacy document preserved after migration');
    assert(legacyDoc.visibility === 'Internal', 'Legacy document defaulted safely to Internal visibility');

    upgradedDb.close();
    await stopServer(upgradeServer);

    console.log('\n--- Cleaning up temporary migration database files ---');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    console.log('Cleanup complete.');

    console.log('\n================================================================================');
    console.log(`  MIGRATION SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Fatal migration test error:', err);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    process.exit(1);
  }
}

runMigrationSuite();
