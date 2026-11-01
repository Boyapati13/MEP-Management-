const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('mep_pm.db');

const tables = [
  'projects', 'work_packages', 'tasks', 'boq_items', 'documents',
  'inspections', 'commissioning_tests', 'purchase_orders', 'change_orders',
  'users', 'project_memberships', 'sites', 'dailylogs', 'workers', 'punchlist', 'ncrs'
];

for (const t of tables) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    console.log(`[${t}]:`, cols.join(', '));
  } catch (e) {
    console.log(`[${t}]: error`, e.message);
  }
}
