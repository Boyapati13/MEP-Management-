import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeliveryQueue, projectMessage } from './queue.js';

test('only explicitly selected group text is collected without a trigger word', () => {
  const msg = { key: { remoteJid: '123@g.us', participant: '456@s.whatsapp.net', id: 'm1' }, message: { conversation: 'Level 3 completed' }, messageTimestamp: 1792231200 };
  assert.equal(projectMessage(msg, new Set()), null);
  assert.equal(projectMessage({ ...msg, key: { ...msg.key, remoteJid: '456@s.whatsapp.net' } }, new Set(['456@s.whatsapp.net'])), null);
  assert.equal(projectMessage(msg, new Set(['123@g.us'])).body, 'Level 3 completed');
  assert.equal(projectMessage({ ...msg, messageTimestamp: NaN }, new Set(['123@g.us'])), null);
  assert.equal(projectMessage({ ...msg, message: { conversation: 'x'.repeat(10001) } }, new Set(['123@g.us'])), null);
});
test('messages survive a restart, duplicate source IDs are ignored, acknowledgement persists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'octo-queue-')); const path = join(dir, 'queue.db');
  try {
    let q = new DeliveryQueue(path); const p = { group_id: '123@g.us', message_id: 'm1', body: 'Update' };
    q.add(p); q.add(p); assert.equal(q.pending().length, 1); q.close();
    q = new DeliveryQueue(path); assert.equal(q.pending().length, 1); q.ack(q.pending()[0].id); q.close();
    q = new DeliveryQueue(path); q.add(p); assert.equal(q.pending().length, 0); q.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
