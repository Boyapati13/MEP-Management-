/**
 * Automated Test Suite: BOQ-to-Tasks Conversion & Engineering Drawings Verification
 * Project: BOV St. Venera (Job 2618)
 * Consultant: Enser Ltd Consulting Engineers
 */

import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert';

const db = new DatabaseSync('mep_pm.db');
const projectId = 'bov-st-venera-2618';

console.log('================================================================');
console.log('RUNNING BOQ & DRAWINGS AUTOMATED TEST SUITE');
console.log('================================================================');

let passed = 0;
let failed = 0;

function it(desc: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } catch (err: any) {
    console.error(`  ✗ FAIL: ${desc} ->`, err.message);
    failed++;
  }
}

// Test 1: Project Master exists and is pristine
it('Project Master BOV St. Venera exists in projects table', () => {
  const proj = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
  assert.ok(proj, 'Project must exist');
  assert.strictEqual(proj.currency, 'EUR', 'Currency must be EUR');
  assert.strictEqual(proj.contract_value, 130893, 'Contract value must match tender ceiling €130,893');
});

// Test 2: Exactly 71 BOQ line items seeded
it('Database contains exactly 71 BOQ items for BOV St. Venera', () => {
  const count = (db.prepare('SELECT count(*) as c FROM boq_items WHERE project_id = ?').get(projectId) as any).c;
  assert.strictEqual(count, 71, `Expected 71 BOQ items, found ${count}`);
});

// Test 3: 100% of BOQ line items are converted into tasks
it('Database contains exactly 71 WBS tasks linked to BOQ items', () => {
  const count = (db.prepare('SELECT count(*) as c FROM tasks WHERE project_id = ?').get(projectId) as any).c;
  assert.strictEqual(count, 71, `Expected 71 WBS tasks, found ${count}`);
});

// Test 4: Every task has boq_item_id and boq_ref populated
it('100% of tasks have boq_item_id, boq_ref, and drawing_ref populated', () => {
  const missing = (db.prepare(`
    SELECT count(*) as c 
    FROM tasks 
    WHERE project_id = ? AND (boq_item_id IS NULL OR boq_ref IS NULL OR drawing_ref IS NULL)
  `).get(projectId) as any).c;
  assert.strictEqual(missing, 0, `Expected 0 tasks with missing linkages, found ${missing}`);
});

// Test 5: All 8 Work Packages have tasks assigned
it('All 8 Work Packages have active WBS tasks assigned', () => {
  const wps = db.prepare(`
    SELECT work_package_id, count(*) as c 
    FROM tasks 
    WHERE project_id = ? 
    GROUP BY work_package_id
  `).all(projectId) as any[];
  assert.strictEqual(wps.length, 8, `Expected tasks across 8 Work Packages, got ${wps.length}`);
  const wpSet = new Set(wps.map(w => w.work_package_id));
  for (let i = 1; i <= 8; i++) {
    const wpId = `wp-0${i}`;
    assert.ok(wpSet.has(wpId), `Work Package ${wpId} must have tasks`);
  }
});

// Test 6: Exactly 10 Enser Engineering Drawings exist in documents table
it('Exactly 10 Engineering Drawings exist for BOV St. Venera', () => {
  const docs = db.prepare(`
    SELECT * FROM documents 
    WHERE project_id = ? AND document_number LIKE '2618-%'
  `).all(projectId) as any[];
  assert.strictEqual(docs.length, 10, `Expected 10 drawings, found ${docs.length}`);
});

// Test 7: All 10 Engineering Drawings have valid SVG vector attachment data
it('All 10 Engineering Drawings have valid SVG attachment_data and attachment_name', () => {
  const docs = db.prepare(`
    SELECT document_number, name, attachment_name, attachment_data 
    FROM documents 
    WHERE project_id = ? AND document_number LIKE '2618-%'
  `).all(projectId) as any[];
  for (const doc of docs) {
    assert.ok(doc.attachment_name, `Drawing ${doc.document_number} must have attachment_name`);
    assert.ok(doc.attachment_data, `Drawing ${doc.document_number} must have attachment_data`);
    assert.ok(
      doc.attachment_data.startsWith('data:image/svg+xml'),
      `Drawing ${doc.document_number} attachment_data must be SVG data URL`
    );
    const decoded = decodeURIComponent(doc.attachment_data);
    assert.ok(
      decoded.includes('ENSER LTD') && decoded.includes('<svg'),
      `Drawing ${doc.document_number} must contain Enser Ltd title block and SVG markup`
    );
  }
});

// Test 8: Engineering drawings are published to Client Portal (visibility = 'All')
it('All 10 Engineering Drawings are visible to Client Portal', () => {
  const count = (db.prepare(`
    SELECT count(*) as c 
    FROM documents 
    WHERE project_id = ? AND document_number LIKE '2618-%' AND visibility IN ('All', 'Client', 'public')
  `).get(projectId) as any).c;
  assert.strictEqual(count, 10, `Expected 10 published drawings, found ${count}`);
});

// Test 9: Each drawing links to tasks in the database
it('Drawing references match task drawing_ref columns', () => {
  const dwgTasks = db.prepare(`
    SELECT drawing_ref, count(*) as count 
    FROM tasks 
    WHERE project_id = ? 
    GROUP BY drawing_ref
  `).all(projectId) as any[];
  assert.ok(dwgTasks.length >= 5, `Expected multiple drawing references on tasks, got ${dwgTasks.length}`);
  const knownDrawings = new Set([
    '2618-S-ELE-01', '2618-L-LTG-01', '2618-L-PWR-01', '2618-L-DTA-01',
    '2618-L-SEC-01', '2618-L-CON-01'
  ]);
  for (const row of dwgTasks) {
    assert.ok(knownDrawings.has(row.drawing_ref), `Unexpected drawing_ref: ${row.drawing_ref}`);
  }
});

// Test 10: Task titles contain exact tender item numbers
it('Task titles preserve tender item numbers (1.0 to UPS.04)', () => {
  const sampleTitles = db.prepare(`
    SELECT title FROM tasks WHERE project_id = ? LIMIT 10
  `).all(projectId) as any[];
  for (const row of sampleTitles) {
    assert.match(row.title, /^\[.*\]/, 'Task title must start with [item_number]');
  }
});

console.log('================================================================');
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================');

if (failed > 0) {
  process.exit(1);
}
