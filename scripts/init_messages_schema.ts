import { initDb } from '../server/db/schema';
import { DatabaseSync } from 'node:sqlite';

console.log('Initializing schema and project_messages table...');
initDb();

const db = new DatabaseSync('mep_pm.db');
const projectId = 'bov-st-venera-2618';

const count = db.prepare("SELECT count(*) as cnt FROM project_messages WHERE project_id = ?").get(projectId) as any;
if (!count || count.cnt === 0) {
  console.log('Seeding initial threads for bov-st-venera-2618...');
  const now = new Date();
  const d1 = new Date(now.getTime() - 2 * 86400000).toISOString();
  const d2 = new Date(now.getTime() - 1 * 86400000).toISOString();
  const d3 = new Date(now.getTime() - 4 * 3600000).toISOString();
  const d4 = new Date(now.getTime() - 2 * 3600000).toISOString();

  // Thread 1: Client Message
  const t1Id = 'msg-bov-client-01';
  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      attachment_name, attachment_url, attachment_type,
      is_pinned, is_unread, reply_count, last_reply_at, created_at, updated_at
    ) VALUES (?, ?, 'client', NULL, ?, ?, ?, ?, ?, 'Normal', 'task', 'task-e-12-01', ?, ?, ?, ?, 1, 1, 2, ?, ?, ?)
  `).run(
    t1Id, projectId,
    'Level 1 Executive Boardroom & Hospitality Suite Luminaire Temperature',
    "Following the architect's sample board review yesterday, the bank's property board has confirmed a preference for 3000K Warm White luminaires for all client-facing reception and boardroom areas on Level 1, instead of standard 4000K. Please verify that this does not impact the delivery lead time.",
    'usr-client-01', 'Mark Farrugia', 'Client Project Manager (BOV)',
    'Task # E-12.01 · Recessed modular LED panels (WP-05)',
    'BOV_L1_Boardroom_Finish_Palette.pdf', 'https://example.com/palette.pdf', 'application/pdf',
    d3, d1, d3
  );

  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      is_pinned, is_unread, reply_count, created_at, updated_at
    ) VALUES (?, ?, 'client', ?, ?, ?, ?, ?, ?, 'Normal', 'task', 'task-e-12-01', ?, 0, 0, 0, ?, ?)
  `).run(
    'msg-rep-01a', projectId, t1Id,
    'Re: Level 1 Executive Boardroom & Hospitality Suite Luminaire Temperature',
    "We contacted Philips / Signify technical sales. The 3000K optical modules share the exact same housing and driver specifications as the 4000K tender baseline, and the supplier confirmed zero lead time impact for the 35 units required for Zone 1.",
    'admin', 'David Spiteri', 'MEP Project Manager',
    'Task # E-12.01 · Recessed modular LED panels (WP-05)',
    d2, d2
  );

  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      is_pinned, is_unread, reply_count, created_at, updated_at
    ) VALUES (?, ?, 'client', ?, ?, ?, ?, ?, ?, 'Normal', 'task', 'task-e-12-01', ?, 0, 0, 0, ?, ?)
  `).run(
    'msg-rep-01b', projectId, t1Id,
    'Re: Level 1 Executive Boardroom & Hospitality Suite Luminaire Temperature',
    "Enser Ltd approves the 3000K variant on Drawing 2618-L-LTG-01 subject to maintaining average 500 lux across the meeting table surface in accordance with CIBSE Code for Lighting.",
    'usr-enser-01', 'Ing. Christian Borg', 'Consultant Electrical Engineer (Enser Ltd)',
    'Task # E-12.01 · Recessed modular LED panels (WP-05)',
    d3, d3
  );

  // Thread 2: Subcontractor Message
  const t2Id = 'msg-bov-sub-02';
  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      attachment_name, attachment_url, attachment_type,
      is_pinned, is_unread, reply_count, last_reply_at, created_at, updated_at
    ) VALUES (?, ?, 'subcontractor', NULL, ?, ?, ?, ?, ?, 'Urgent', 'task', 'task-d-06-0', ?, ?, ?, ?, 0, 1, 1, ?, ?, ?)
  `).run(
    t2Id, projectId,
    'Level 2 Main Riser Containment Clearances & Cat 6 Trunking Alignment',
    "Urgent coordination on Level 2: the chilled water piping bracket in Shaft B is positioned 180mm closer to the cable tray flange than indicated on drawing 2618-S-ELE-01. We require site engineer confirmation before pulling the Cat 6 bundles to ensure minimum 150mm separation from chilled water lines.",
    'usr-sub-01', 'Kevin Bonnici', 'Lead Electrical Subcontractor (ElectroData Ltd)',
    'Task # D-06.0 · 4-pair Cat 6 UTP (3,070m) (WP-06)',
    'Level2_ShaftB_Pipe_Clearance.png', 'https://example.com/clearance.png', 'image/png',
    d4, d2, d4
  );

  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      is_pinned, is_unread, reply_count, created_at, updated_at
    ) VALUES (?, ?, 'subcontractor', ?, ?, ?, ?, ?, ?, 'Urgent', 'task', 'task-d-06-0', ?, 0, 0, 0, ?, ?)
  `).run(
    'msg-rep-02a', projectId, t2Id,
    'Re: Level 2 Main Riser Containment Clearances & Cat 6 Trunking Alignment',
    "Inspected on site at 14:00 with HVAC foreman. We will offset the cable basket by 100mm towards the structural masonry wall using Unistrut brackets. The Cat 6 cables will have a safe 220mm clearance from the insulated pipework.",
    'usr-eng-01', 'Marco Vella', 'Site Mechanical & Electrical Engineer',
    'Task # D-06.0 · 4-pair Cat 6 UTP (3,070m) (WP-06)',
    d4, d4
  );

  // Thread 3: Team Message
  const t3Id = 'msg-bov-team-03';
  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      is_pinned, is_unread, reply_count, last_reply_at, created_at, updated_at
    ) VALUES (?, ?, 'team', NULL, ?, ?, ?, ?, ?, 'Normal', 'drawing', 'dwg-2618-s-ele-01', ?, 0, 0, 1, ?, ?, ?)
  `).run(
    t3Id, projectId,
    'Enser Ltd Witness Testing for Submain Panel DB-L1 & Earth Fault Relay',
    "Please ensure that the factory test reports and calibrated injection test kits are prepared for the 400A MCCB with integrated electronic trip unit for DB-L1. Testing is scheduled for Wednesday 10:30 AM.",
    'usr-enser-01', 'Ing. Christian Borg', 'Consultant Electrical Engineer (Enser Ltd)',
    'Drawing 2618-S-ELE-01 · Electrical Distribution Single Line',
    d4, d3, d4
  );

  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      is_pinned, is_unread, reply_count, created_at, updated_at
    ) VALUES (?, ?, 'team', ?, ?, ?, ?, ?, ?, 'Normal', 'drawing', 'dwg-2618-s-ele-01', ?, 0, 0, 0, ?, ?)
  `).run(
    'msg-rep-03a', projectId, t3Id,
    'Re: Enser Ltd Witness Testing for Submain Panel DB-L1 & Earth Fault Relay',
    "Understood. The panel builder has issued the calibrated test certificates (traceable to UKAS/EN standards), and our electrical testing engineer will have the secondary injection test kit set up 30 minutes prior.",
    'admin', 'David Spiteri', 'MEP Project Manager',
    'Drawing 2618-S-ELE-01 · Electrical Distribution Single Line',
    d4, d4
  );
  console.log('Seeding complete.');
} else {
  console.log(`Table already has ${count.cnt} messages.`);
}
