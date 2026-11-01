import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';

console.log('🧪 Starting Task List BOQ & Work Package Automated Test Suite...\n');

const db = new DatabaseSync('mep_pm.db');

// 1. Verify tasks JOIN with boq_items and work_packages
console.log('1. Testing Tasks API SQL Query Join with boq_items & work_packages...');
const tasksWithBoq = db.prepare(`
  SELECT 
    tasks.id,
    tasks.title,
    tasks.description,
    tasks.trade,
    tasks.status,
    tasks.drawing_ref,
    wp.code as work_package_code,
    wp.name as work_package_name,
    b.item_number as boq_item_number,
    b.unit as boq_unit,
    b.tender_quantity as boq_quantity
  FROM tasks
  LEFT JOIN work_packages wp ON wp.id = tasks.work_package_id
  LEFT JOIN boq_items b ON b.id = tasks.boq_item_id
  WHERE tasks.project_id = 'bov-st-venera-2618'
  ORDER BY tasks.wbs_code ASC
`).all() as any[];

assert.strictEqual(tasksWithBoq.length, 71, 'Expected 71 tasks for BOV St. Venera');
console.log(`  ✅ Successfully returned ${tasksWithBoq.length} tasks with joined BOQ data.`);

// 2. Verify all tasks have valid BOQ item numbers
console.log('2. Testing BOQ Item Numbers on tasks...');
const missingBoqNum = tasksWithBoq.filter(t => !t.boq_item_number);
assert.strictEqual(missingBoqNum.length, 0, 'Every task must have a valid boq_item_number');
console.log('  ✅ 100% of tasks have boq_item_number populated (e.g. 1.0, E-01, D-06.0, UPS-01).');

// 3. Verify tender quantities and units
console.log('3. Testing Tender Quantities and Units...');
const sampleQtyTask = tasksWithBoq.find(t => t.boq_item_number === 'E-01');
assert.ok(sampleQtyTask, 'Task E-01 must exist');
assert.strictEqual(sampleQtyTask.boq_unit, 'No', 'Task E-01 unit must be No');
assert.strictEqual(sampleQtyTask.boq_quantity, 1, 'Task E-01 quantity must be 1');

const sampleCableTask = tasksWithBoq.find(t => t.boq_item_number === 'D-06.0');
assert.ok(sampleCableTask, 'Task D-06.0 must exist');
assert.strictEqual(sampleCableTask.boq_unit, 'm', 'Task D-06.0 unit must be meters');
assert.strictEqual(sampleCableTask.boq_quantity, 3070, 'Task D-06.0 quantity must be 3070');
console.log(`  ✅ Tender quantities & units verified: E-01 (${sampleQtyTask.boq_quantity} ${sampleQtyTask.boq_unit}), D-06.0 (${sampleCableTask.boq_quantity} ${sampleCableTask.boq_unit}).`);

// 4. Verify engineering drawing references
console.log('4. Testing Engineering Drawing References...');
const sampleDrawingTask = tasksWithBoq.find(t => t.drawing_ref === '2618-S-ELE-01');
assert.ok(sampleDrawingTask, 'Tasks must reference 2618-S-ELE-01');
const missingDrawings = tasksWithBoq.filter(t => !t.drawing_ref);
assert.strictEqual(missingDrawings.length, 0, 'Every task must have an engineering drawing reference');
console.log('  ✅ 100% of tasks have engineering drawing references attached.');

// 5. Verify 8 Work Package groupings
console.log('5. Testing Work Package groupings (WP-01 to WP-08)...');
const packageCodes = Array.from(new Set(tasksWithBoq.map(t => t.work_package_code))).sort();
const expectedPackages = ['WP-01', 'WP-02', 'WP-03', 'WP-04', 'WP-05', 'WP-06', 'WP-07', 'WP-08'];
assert.deepStrictEqual(packageCodes, expectedPackages, 'All 8 tender work packages must be represented');

const wpCounts: Record<string, number> = {};
for (const t of tasksWithBoq) {
  wpCounts[t.work_package_code] = (wpCounts[t.work_package_code] || 0) + 1;
}
console.log('  Work package distribution:', wpCounts);
console.log('  ✅ All 8 Work Packages (WP-01 to WP-08) correctly group all 71 tasks.');

// 6. Verify full technical specification text
console.log('6. Testing Full Technical Scope & Specification text...');
const emptyDesc = tasksWithBoq.filter(t => !t.description || t.description.trim().length === 0);
assert.strictEqual(emptyDesc.length, 0, 'No task should have an empty description');
const avgDescLen = Math.round(tasksWithBoq.reduce((acc, t) => acc + t.description.length, 0) / tasksWithBoq.length);
console.log(`  ✅ Average specification length: ${avgDescLen} characters (full Enser tender specifications).`);

console.log('\n🎉 ALL 6 TASK LIST BOQ & WORK PACKAGE TESTS PASSED SUCCESSFULLY! (100% Pass Rate)');
