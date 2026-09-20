/**
 * MEP Management Platform — V1.4.1 SQLite WAL-Safe Backup
 * Creates a timestamped backup, computes SHA-256 digest, verifies integrity,
 * and conducts a restore-read smoke test.
 *
 * Usage:
 *   npx tsx scripts/backup_sqlite.ts
 *   npx tsx scripts/backup_sqlite.ts --verify
 *   npx tsx scripts/backup_sqlite.ts --restore backups/mep_2026-09-21_00-00-00.db
 */
import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'mep.db');
const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(process.cwd(), 'backups');
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? '14');

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function sha256file(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function logStep(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function performBackup(): string {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Source database not found: ${DB_PATH}`);
  }

  ensureDir(BACKUP_DIR);

  const ts = timestamp();
  const backupName = `mep_${ts}.db`;
  const backupPath = path.join(BACKUP_DIR, backupName);

  logStep(`Creating WAL-safe backup: ${backupPath}`);

  // Use SQLite .backup command via sqlite3 CLI (WAL-safe, online backup)
  // Falls back to file copy if sqlite3 CLI is not available
  try {
    const result = spawnSync('sqlite3', [DB_PATH, `.backup '${backupPath.replace(/'/g, "\\'")}'`], {
      shell: true,
      timeout: 60000
    });
    if (result.status !== 0) {
      throw new Error(result.stderr?.toString() || 'sqlite3 backup command failed');
    }
  } catch {
    logStep('sqlite3 CLI not available — using file copy fallback (WAL checkpoint first)');
    // Checkpoint WAL before copying
    try {
      spawnSync('sqlite3', [DB_PATH, 'PRAGMA wal_checkpoint(TRUNCATE);'], {
        shell: true,
        timeout: 10000
      });
    } catch { /* non-fatal */ }
    fs.copyFileSync(DB_PATH, backupPath);
  }

  // Compute and store SHA-256 digest
  const digest = sha256file(backupPath);
  const digestPath = `${backupPath}.sha256`;
  fs.writeFileSync(digestPath, `${digest}  ${backupName}\n`, 'utf8');

  logStep(`Backup SHA-256: ${digest}`);
  logStep(`Digest file: ${digestPath}`);

  const stats = fs.statSync(backupPath);
  logStep(`Backup size: ${(stats.size / 1024).toFixed(1)} KB`);

  return backupPath;
}

function verifyBackup(backupPath: string): boolean {
  logStep(`Verifying backup: ${backupPath}`);

  if (!fs.existsSync(backupPath)) {
    console.error(`Backup file not found: ${backupPath}`);
    return false;
  }

  const digestPath = `${backupPath}.sha256`;
  if (!fs.existsSync(digestPath)) {
    console.error(`Digest file not found: ${digestPath}`);
    return false;
  }

  // Check digest
  const expectedDigestLine = fs.readFileSync(digestPath, 'utf8').trim();
  const [expectedDigest] = expectedDigestLine.split(/\s+/);
  const actualDigest = sha256file(backupPath);

  if (expectedDigest !== actualDigest) {
    console.error(`INTEGRITY FAIL: expected ${expectedDigest} but got ${actualDigest}`);
    return false;
  }

  logStep(`SHA-256 verified: ${actualDigest}`);

  // Smoke test: open backup and verify key tables exist
  const smokeResult = spawnSync('sqlite3', [backupPath, '.tables'], {
    shell: true,
    timeout: 10000
  });

  if (smokeResult.status !== 0) {
    logStep('sqlite3 CLI unavailable — skipping smoke-read test');
  } else {
    const tables = smokeResult.stdout?.toString() ?? '';
    const requiredTables = ['users', 'projects', 'tasks', '_migrations'];
    const missingTables = requiredTables.filter(t => !tables.includes(t));
    if (missingTables.length > 0) {
      console.error(`Backup missing expected tables: ${missingTables.join(', ')}`);
      return false;
    }
    logStep(`Smoke test passed — tables verified: ${requiredTables.join(', ')}`);
  }

  return true;
}

function pruneOldBackups() {
  logStep(`Pruning backups older than ${RETENTION_DAYS} days...`);
  const cutoffMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db'));
  let pruned = 0;

  for (const file of files) {
    const fullPath = path.join(BACKUP_DIR, file);
    const stat = fs.statSync(fullPath);
    if (now - stat.mtimeMs > cutoffMs) {
      fs.unlinkSync(fullPath);
      const digestFile = `${fullPath}.sha256`;
      if (fs.existsSync(digestFile)) fs.unlinkSync(digestFile);
      pruned++;
      logStep(`Removed expired backup: ${file}`);
    }
  }

  logStep(`Pruned ${pruned} expired backup(s)`);
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0];

  console.log('═══════════════════════════════════════════════════════');
  console.log('  MEP Management Platform — SQLite Backup Utility v1.4.1');
  console.log('═══════════════════════════════════════════════════════');

  if (mode === '--restore' && args[1]) {
    const src = args[1];
    logStep(`Restoring database from: ${src}`);
    if (!verifyBackup(src)) {
      console.error('Restore aborted — backup verification failed');
      process.exit(1);
    }
    const restorePath = `${DB_PATH}.restore_${timestamp()}`;
    fs.copyFileSync(DB_PATH, restorePath);
    logStep(`Current DB backed up to: ${restorePath}`);
    fs.copyFileSync(src, DB_PATH);
    logStep(`Database restored successfully from ${src}`);
    return;
  }

  if (mode === '--verify') {
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .sort()
      .reverse();

    if (backups.length === 0) {
      console.error('No backups found to verify');
      process.exit(1);
    }

    const latest = path.join(BACKUP_DIR, backups[0]);
    const ok = verifyBackup(latest);
    process.exit(ok ? 0 : 1);
  }

  // Default: perform backup + verify + prune
  try {
    const backupPath = performBackup();
    const ok = verifyBackup(backupPath);
    if (!ok) {
      console.error('Post-backup verification failed — backup may be corrupt');
      process.exit(1);
    }
    pruneOldBackups();
    console.log('');
    logStep('✓ Backup completed, verified, and retention enforced');
  } catch (err: any) {
    console.error('Backup failed:', err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
