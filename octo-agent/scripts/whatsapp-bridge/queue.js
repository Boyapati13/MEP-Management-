import { DatabaseSync } from 'node:sqlite';

export class DeliveryQueue {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS delivery (id TEXT PRIMARY KEY, payload TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);`);
  }
  add(payload) {
    // Composite source ID prevents duplicate events across reconnects and restarts.
    this.db.prepare('INSERT OR IGNORE INTO delivery (id,payload) VALUES (?,?)')
      .run(JSON.stringify([payload.group_id, payload.message_id]), JSON.stringify(payload));
  }
  pending() { return this.db.prepare('SELECT id,payload FROM delivery WHERE delivered=0 ORDER BY rowid LIMIT 50').all(); }
  ack(id) { this.db.prepare('UPDATE delivery SET delivered=1 WHERE id=?').run(id); }
  close() { this.db.close(); }
}

export function projectMessage(msg, allowedGroups) {
  const group_id = msg.key?.remoteJid || '';
  if (!group_id.endsWith('@g.us') || !allowedGroups.has(group_id) || !msg.key?.id) return null;
  const content = msg.message?.ephemeralMessage?.message || msg.message || {};
  const body = content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || content.documentMessage?.caption || '';
  if (!body.trim() || body.length > 10000) return null;
  const stamp = Number(msg.messageTimestamp);
  if (!Number.isFinite(stamp) || stamp <= 0 || !Number.isFinite(new Date(stamp * 1000).getTime())) return null;
  return { group_id, message_id: msg.key.id, sender: msg.key.participant || 'unknown', body, sent_at: new Date(stamp * 1000).toISOString() };
}
