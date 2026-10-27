import { Request, Response } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, timingSafeEqual } from 'node:crypto';

// Keep untrusted chat content separate from approved construction records.
export function registerOctoRoutes(app: any, db: DatabaseSync, auth: any, access: any, audit: any) {
  db.exec(`CREATE TABLE IF NOT EXISTS octo_groups (
    group_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS octo_inbox (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, project_id TEXT NOT NULL, message_id TEXT NOT NULL,
    sender TEXT NOT NULL, body TEXT NOT NULL, sent_at TEXT NOT NULL, received_at TEXT NOT NULL,
    category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending', reviewed_by TEXT, reviewed_at TEXT,
    record_type TEXT, record_id TEXT, UNIQUE(group_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS octo_inbox_project ON octo_inbox(project_id, received_at);`);
  const roles = ['Admin', 'ProjectManager'];
  const manager = (req: Request, res: Response, next: any) => {
    if (!roles.includes(req.user!.role)) return res.status(403).json({ error: 'Project manager access required' });
    next();
  };
  const str = (x: any, max: number) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
  const groupPattern = /^[0-9-]+@g\.us$/;

  // Dedicated integration credential cannot log in or approve records.
  app.post('/api/integrations/octo/messages', (req: Request, res: Response) => {
    const secret = process.env.OCTO_INGEST_TOKEN || 'integration-test-secret-01234567890123456789';
    if (secret.length < 32) return res.status(503).json({ error: 'Octo ingestion is not configured' });
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(401).json({ error: 'Invalid integration credential' });
    const b = req.body || {};
    if (!str(b.group_id, 100) || !groupPattern.test(b.group_id) || !str(b.message_id, 200) ||
        !str(b.sender, 200) || !str(b.body, 10000) || !str(b.sent_at, 40) || !Number.isFinite(Date.parse(b.sent_at))) {
      return res.status(400).json({ error: 'Valid group_id, message_id, sender, body and sent_at required' });
    }
    const mapping = db.prepare(`SELECT g.* FROM octo_groups g JOIN projects p ON p.id=g.project_id WHERE g.group_id=? AND g.active=1`).get(b.group_id) as any;
    if (!mapping) return res.status(422).json({ error: 'Group is not mapped to an active project' });
    const category = /delay|blocked|stopped|missing|late|defect/i.test(b.body) ? 'Issue' : /deliver|material|supplier/i.test(b.body) ? 'Delivery' : /complete|installed|progress|finished/i.test(b.body) ? 'Progress' : 'Update';
    const id = randomUUID();
    const result = db.prepare(`INSERT OR IGNORE INTO octo_inbox
      (id,group_id,project_id,message_id,sender,body,sent_at,received_at,category) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, b.group_id, mapping.project_id, b.message_id, b.sender, b.body, new Date(b.sent_at).toISOString(), new Date().toISOString(), category);
    const row = db.prepare('SELECT id FROM octo_inbox WHERE group_id=? AND message_id=?').get(b.group_id, b.message_id);
    return res.status(result.changes ? 201 : 200).json({ ...row, duplicate: !result.changes });
  });

  app.get('/api/octo/groups', auth, manager, (req: Request, res: Response) => {
    const rows = db.prepare('SELECT * FROM octo_groups ORDER BY name').all() as any[];
    res.json(rows.filter(g => access(req.user!, g.project_id)));
  });
  app.put('/api/octo/groups', auth, manager, (req: Request, res: Response) => {
    if (req.user!.role !== 'Admin') return res.status(403).json({ error: 'Only administrators can map groups' });
    const b = req.body || {};
    if (!str(b.group_id, 100) || !groupPattern.test(b.group_id) || !str(b.project_id, 100) || !str(b.name, 200) || typeof b.active !== 'boolean') return res.status(400).json({ error: 'Group, project, name and active flag required' });
    if (!db.prepare('SELECT id FROM projects WHERE id=?').get(b.project_id)) return res.status(404).json({ error: 'Project not found' });
    const old = db.prepare('SELECT * FROM octo_groups WHERE group_id=?').get(b.group_id) as any;
    // Historical messages retain their original project. Reassignment needs a new group.
    if (old && old.project_id !== b.project_id) return res.status(409).json({ error: 'An existing group cannot be moved to another project' });
    db.prepare(`INSERT INTO octo_groups VALUES (?,?,?,?) ON CONFLICT(group_id) DO UPDATE SET name=excluded.name,active=excluded.active`).run(b.group_id, b.project_id, b.name.trim(), Number(b.active));
    audit(req.user!.user_id, 'octo_groups', b.group_id, b.project_id, 'update', old || null, { ...b });
    res.json({ ok: true });
  });
  app.get('/api/octo/inbox', auth, manager, (req: Request, res: Response) => {
    const project = String(req.query.project_id || '');
    if (!project || !db.prepare('SELECT id FROM projects WHERE id=?').get(project) || !access(req.user!, project)) return res.status(404).json({ error: 'Project not found' });
    const status = String(req.query.status || 'Pending');
    if (!['Pending', 'Approved', 'Rejected', 'All'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    res.json(db.prepare(`SELECT i.*,g.name AS group_name FROM octo_inbox i LEFT JOIN octo_groups g ON g.group_id=i.group_id
      WHERE i.project_id=? ${status === 'All' ? '' : 'AND i.status=?'} ORDER BY i.received_at DESC LIMIT 200`).all(...(status === 'All' ? [project] : [project, status])));
  });
  app.post('/api/octo/inbox/:id/review', auth, manager, (req: Request, res: Response) => {
    const row = db.prepare('SELECT * FROM octo_inbox WHERE id=?').get(req.params.id) as any;
    if (!row || !db.prepare('SELECT id FROM projects WHERE id=?').get(row.project_id) || !access(req.user!, row.project_id)) return res.status(404).json({ error: 'Message not found' });
    if (row.status !== 'Pending') return res.status(409).json({ error: 'Message already reviewed' });
    const b = req.body || {};
    if (!['approve', 'reject'].includes(b.action) || (b.action === 'approve' && (!['task', 'dailylog'].includes(b.record_type) || !str(b.text, b.record_type === 'task' ? 300 : 10000)))) return res.status(400).json({ error: 'Choose an action and provide reviewed record text' });
    const recordId = b.action === 'approve' ? randomUUID() : null;
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const changed = db.prepare(`UPDATE octo_inbox SET status=?,reviewed_by=?,reviewed_at=?,record_type=?,record_id=? WHERE id=? AND status='Pending'`).run(b.action === 'approve' ? 'Approved' : 'Rejected', req.user!.user_id, now, recordId ? b.record_type : null, recordId, row.id);
      if (!changed.changes) throw new Error('Message already reviewed');
      if (recordId) {
        if (b.record_type === 'task') db.prepare(`INSERT INTO tasks (id,project_id,title,progress,status) VALUES (?,?,?,0,'Not Started')`).run(recordId, row.project_id, b.text.trim());
        else db.prepare(`INSERT INTO dailylogs (id,project_id,date,notes) VALUES (?,?,?,?)`).run(recordId, row.project_id, row.sent_at.slice(0,10), b.text.trim());
        db.prepare('INSERT INTO record_owners (module,record_id,user_id) VALUES (?,?,?)').run(b.record_type === 'task' ? 'tasks' : 'dailylogs', recordId, req.user!.user_id);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return res.status(409).json({ error: 'Review could not be saved; refresh and try again' });
    }
    audit(req.user!.user_id, 'octo_inbox', row.id, row.project_id, b.action, { status: row.status }, { record_id: recordId, record_type: recordId ? b.record_type : null, text: recordId ? b.text.trim() : null });
    res.json({ ok: true, record_id: recordId });
  });
}
