import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export function runMigrations(db: DatabaseSync, migrationsDir?: string) {
  const dir = migrationsDir || path.join(process.cwd(), 'migrations');
  if (!fs.existsSync(dir)) return;

  // Ensure migration ledger exists
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

    const sqlContent = fs.readFileSync(path.join(dir, file), 'utf8');
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      try {
        db.exec(stmt + ';');
      } catch (err: any) {
        // Handle idempotent column addition or index exists
        const msg = String(err?.message || '').toLowerCase();
        if (msg.includes('duplicate column') || msg.includes('already exists')) {
          // Idempotent column or index
          continue;
        }
        throw new Error(`Failed executing migration ${file}: ${err?.message}\nStatement: ${stmt}`);
      }
    }

    db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)').run(
      migrationId,
      new Date().toISOString()
    );
    console.log(`[MIGRATION] Applied ${file}`);
  }
}
