import assert from 'node:assert/strict';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { registerOctoRoutes } from './server/routes/octoRoutes';

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p1'),('p2');
 CREATE TABLE tasks(id TEXT PRIMARY KEY,project_id TEXT,title TEXT,progress INTEGER,status TEXT);
 CREATE TABLE dailylogs(id TEXT PRIMARY KEY,project_id TEXT,date TEXT,notes TEXT);
 CREATE TABLE record_owners(module TEXT,record_id TEXT,user_id TEXT);`);
const app = express(); app.use(express.json());
const token = 'integration-test-secret-01234567890123456789';
process.env.OCTO_INGEST_TOKEN = token;
const audit: any[] = [];
const auth = (req: any, res: any, next: any) => {
  const role = req.headers['x-test-role'];
  if (!role) return res.sendStatus(401);
  req.user = { user_id: 'reviewer', role }; next();
};
registerOctoRoutes(app, db, auth, (user: any, project: string) => user.role === 'Admin' || project === 'p1', (...a: any[]) => audit.push(a));
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const url = `http://127.0.0.1:${(server.address() as any).port}`;
async function call(path: string, method = 'GET', body?: any, role = 'Admin', secret?: string) {
  const res = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}), ...(secret ? { Authorization: `Bearer ${secret}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const group = { group_id: '12000001@g.us', project_id: 'p1', name: 'Site A', active: true };
const message = { group_id: group.group_id, message_id: 'm1', sender: 'supervisor', body: '<script>alert(1)</script> Ductwork stopped: missing dampers', sent_at: '2026-10-17T10:00:00Z' };
try {
  assert.equal((await call('/api/octo/groups', 'GET', undefined, '')).status, 401);
  for (const role of ['Client', 'Worker', 'Subcontractor', 'SiteEngineer']) assert.equal((await call('/api/octo/groups', 'GET', undefined, role)).status, 403);
  assert.equal((await call('/api/octo/groups', 'PUT', group, 'ProjectManager')).status, 403);
  assert.equal((await call('/api/octo/groups', 'PUT', group)).status, 200);
  assert.equal((await call('/api/octo/groups', 'PUT', { ...group, project_id: 'p2' })).status, 409);
  assert.equal((await call('/api/integrations/octo/messages', 'POST', message, '', 'wrong')).status, 401);
  assert.equal((await call('/api/integrations/octo/messages', 'POST', { ...message, group_id: '120999@g.us' }, '', token)).status, 422);
  assert.equal((await call('/api/integrations/octo/messages', 'POST', { ...message, body: 'a'.repeat(10001) }, '', token)).status, 400);
  const saved = await call('/api/integrations/octo/messages', 'POST', message, '', token); assert.equal(saved.status, 201);
  assert.equal((await call('/api/integrations/octo/messages', 'POST', message, '', token)).data.duplicate, true);
  assert.equal((db.prepare('SELECT count(*) n FROM tasks').get() as any).n, 0);
  const inbox = await call('/api/octo/inbox?project_id=p1', 'GET', undefined, 'ProjectManager');
  assert.equal(inbox.data.length, 1); assert.equal(inbox.data[0].category, 'Issue'); assert.equal(inbox.data[0].body, message.body);
  assert.equal((await call('/api/octo/inbox?project_id=p2', 'GET', undefined, 'ProjectManager')).status, 404);
  await call('/api/octo/groups', 'PUT', { ...group, group_id: '12000002@g.us', project_id: 'p2' });
  const other = await call('/api/integrations/octo/messages', 'POST', { ...message, group_id: '12000002@g.us' }, '', token);
  assert.equal((await call(`/api/octo/inbox/${other.data.id}/review`, 'POST', { action: 'reject' }, 'ProjectManager')).status, 404);
  assert.equal((await call(`/api/octo/inbox/${saved.data.id}/review`, 'POST', { action: 'approve', record_type: 'task', text: 'x'.repeat(301) })).status, 400);
  const approval = await call(`/api/octo/inbox/${saved.data.id}/review`, 'POST', { action: 'approve', record_type: 'task', text: 'Resolve missing dampers' }, 'ProjectManager');
  assert.equal(approval.status, 200);
  assert.equal((db.prepare('SELECT title FROM tasks WHERE id=?').get(approval.data.record_id) as any).title, 'Resolve missing dampers');
  assert.equal((await call(`/api/octo/inbox/${saved.data.id}/review`, 'POST', { action: 'reject' })).status, 409);
  const second = await call('/api/integrations/octo/messages', 'POST', { ...message, message_id: 'm2' }, '', token);
  assert.equal((await call(`/api/octo/inbox/${second.data.id}/review`, 'POST', { action: 'approve', record_type: 'dailylog', text: 'Site update reviewed' })).status, 200);
  const third = await call('/api/integrations/octo/messages', 'POST', { ...message, message_id: 'm3' }, '', token);
  assert.equal((await call(`/api/octo/inbox/${third.data.id}/review`, 'POST', { action: 'reject' })).status, 200);
  await call('/api/octo/groups', 'PUT', { ...group, active: false });
  assert.equal((await call('/api/integrations/octo/messages', 'POST', { ...message, message_id: 'm4' }, '', token)).status, 422);
  assert.equal((db.prepare('SELECT count(*) n FROM tasks').get() as any).n, 1);
  assert.equal((db.prepare('SELECT count(*) n FROM dailylogs').get() as any).n, 1);
  assert.equal((db.prepare('SELECT count(*) n FROM record_owners').get() as any).n, 2);
  assert.ok(audit.length >= 6);
  console.log('PASS: Octo authentication, project isolation, deduplication, review, task/site-log creation and group pause');
} finally { server.close(); db.close(); }
