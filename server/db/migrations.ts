import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export function runMigrations(db: DatabaseSync, migrationsDir?: string) {
  const dir = migrationsDir || path.join(process.cwd(), 'migrations');
  if (!fs.existsSync(dir)) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const migrationId = path.parse(file).name;
    const existing = db.prepare('SELECT id FROM _migrations WHERE id = ?').get(migrationId);
    if (existing) continue;

    const raw = fs.readFileSync(path.join(dir, file), 'utf8');

    // Remove whole-line SQL comments before splitting.
    const sqlContent = raw
      .split(/\r?\n/)
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');

    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(Boolean);

    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const stmt of statements) {
        try {
          db.exec(stmt + ';');
        } catch (err: any) {
          const msg = String(err?.message || '').toLowerCase();

          // Migrations are deliberately safe to re-run against databases
          // that may already contain legacy columns created by initDb().
          if (
            msg.includes('duplicate column') ||
            msg.includes('already exists')
          ) {
            continue;
          }

          throw new Error(
            `Failed executing migration ${file}: ${err?.message}\nStatement: ${stmt}`
          );
        }
      }

      db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)').run(
        migrationId,
        new Date().toISOString()
      );
      db.exec('COMMIT;');
      console.log(`[MIGRATION] Applied ${file}`);
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch {}
      throw err;
    }
  }
}
