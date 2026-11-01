import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';

console.log('🧪 Starting Buildertrend Project Messages & Communication Hub Test Suite...\n');

const db = new DatabaseSync('mep_pm.db');
const projectId = 'bov-st-venera-2618';

// 1. Verify project_messages table exists
console.log('1. Testing project_messages table existence and schema...');
const tableCheck = db.prepare(`
  SELECT count(*) as count FROM pragma_table_info('project_messages')
`).get() as any;
assert.ok(tableCheck.count > 0, 'project_messages table must exist');
console.log(`  ✅ Table verified with ${tableCheck.count} columns.`);

// 2. Verify seeded message threads exist for bov-st-venera-2618
console.log('2. Testing Seeded Threads across Channels (Client, Subcontractor, Team)...');
const threads = db.prepare(`
  SELECT * FROM project_messages 
  WHERE project_id = ? AND parent_id IS NULL
  ORDER BY created_at ASC
`).all(projectId) as any[];

assert.ok(threads.length >= 3, `Expected at least 3 threads, found ${threads.length}`);
const channels = new Set(threads.map(t => t.channel));
assert.ok(channels.has('client'), 'Client channel thread must exist');
assert.ok(channels.has('subcontractor'), 'Subcontractor channel thread must exist');
assert.ok(channels.has('team'), 'Internal team channel thread must exist');
console.log(`  ✅ Found ${threads.length} threads spanning channels: ${Array.from(channels).join(', ')}.`);

// 3. Verify Contextual Linking to project items (Tasks and Drawings)
console.log('3. Testing Contextual Record Linking (Tasks & Drawings)...');
const clientThread = threads.find(t => t.channel === 'client');
assert.ok(clientThread, 'Client thread must exist');
assert.strictEqual(clientThread.linked_item_type, 'task');
assert.ok(clientThread.linked_item_label.includes('E-12.01'), 'Must be linked to luminaire task E-12.01');

const subThread = threads.find(t => t.channel === 'subcontractor');
assert.ok(subThread, 'Subcontractor thread must exist');
assert.strictEqual(subThread.linked_item_type, 'task');
assert.ok(subThread.linked_item_label.includes('D-06.0'), 'Must be linked to Cat 6 task D-06.0');

const teamThread = threads.find(t => t.channel === 'team');
assert.ok(teamThread, 'Team thread must exist');
assert.strictEqual(teamThread.linked_item_type, 'drawing');
assert.ok(teamThread.linked_item_label.includes('2618-S-ELE-01'), 'Must be linked to single line drawing 2618-S-ELE-01');
console.log('  ✅ 100% of sample threads are linked directly to authentic Enser tender tasks & drawings.');

// 4. Verify Threaded Replies and Reply Counts
console.log('4. Testing Threaded Replies & Hierarchical Conversations...');
for (const t of threads) {
  const replies = db.prepare(`
    SELECT * FROM project_messages 
    WHERE parent_id = ? AND project_id = ?
    ORDER BY created_at ASC
  `).all(t.id, projectId) as any[];

  assert.strictEqual(replies.length, t.reply_count, `Reply count mismatch for thread ${t.id}`);
  console.log(`  Thread "${t.subject.slice(0, 35)}..." has ${replies.length} replies.`);
}
console.log('  ✅ Hierarchical replies and parent reply counters verified.');

// 5. Test inserting a new conversation thread
console.log('5. Testing Thread Creation & Dynamic Posting...');
const testMsgId = `test-msg-${Date.now()}`;
db.prepare(`
  INSERT INTO project_messages (
    id, project_id, channel, parent_id, subject, body,
    sender_id, sender_name, sender_role, priority,
    linked_item_type, linked_item_id, linked_item_label,
    is_pinned, is_unread, reply_count, created_at, updated_at
  ) VALUES (
    ?, ?, 'client', NULL, 'Test Selection Consultation', 'Can we review the floor box finish?',
    'admin', 'Administrator', 'Project Manager', 'Normal',
    'selection', 'sel-floorbox', 'SEL-002 Floor Boxes',
    0, 1, 0, datetime('now'), datetime('now')
  )
`).run(testMsgId, projectId);

const created = db.prepare("SELECT * FROM project_messages WHERE id = ?").get(testMsgId) as any;
assert.ok(created, 'Created thread must be readable');
assert.strictEqual(created.subject, 'Test Selection Consultation');
console.log('  ✅ New thread created successfully.');

// 6. Test replying to the new thread
console.log('6. Testing Thread Reply Insertion...');
const testRepId = `test-rep-${Date.now()}`;
db.prepare(`
  INSERT INTO project_messages (
    id, project_id, channel, parent_id, subject, body,
    sender_id, sender_name, sender_role, priority,
    is_pinned, is_unread, reply_count, created_at, updated_at
  ) VALUES (
    ?, ?, 'client', ?, 'Re: Test Selection Consultation', 'Yes, brushed stainless steel is approved.',
    'usr-client-01', 'Mark Farrugia', 'Client PM', 'Normal',
    0, 0, 0, datetime('now'), datetime('now')
  )
`).run(testRepId, projectId, testMsgId);

db.prepare(`
  UPDATE project_messages 
  SET reply_count = reply_count + 1, last_reply_at = datetime('now') 
  WHERE id = ?
`).run(testMsgId);

const updatedParent = db.prepare("SELECT * FROM project_messages WHERE id = ?").get(testMsgId) as any;
assert.strictEqual(updatedParent.reply_count, 1, 'Parent reply count must increment to 1');
console.log('  ✅ Thread reply posted and parent counter updated.');

// Clean up test data
db.prepare("DELETE FROM project_messages WHERE id IN (?, ?)").run(testMsgId, testRepId);
console.log('  ✅ Test data cleaned up.');

console.log('\n🎉 ALL 6 PROJECT MESSAGES HUB TESTS PASSED SUCCESSFULLY! (100% Pass Rate)');
