import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('mep_pm.db');
const projectId = 'bov-st-venera-2618';

console.log('🔄 Setting BOQ to Unpriced Tender (No synthetic/random prices)...');

// 1. Reset all 71 BOQ items to unpriced (tender_rate = 0, tender_amount = 0)
const boqRes = db.prepare(`
  UPDATE boq_items 
  SET tender_rate = 0, tender_amount = 0 
  WHERE project_id = ?
`).run(projectId);

console.log(`✅ Updated ${boqRes.changes} BOQ line items: rates and amounts cleared to €0.00 (Unpriced).`);

// 2. Clean task descriptions to remove any synthetic "@ €..." price markers
const tasks = db.prepare(`
  SELECT id, description FROM tasks WHERE project_id = ?
`).all(projectId) as { id: string; description: string }[];

let cleanedTasks = 0;
const updateTaskStmt = db.prepare(`UPDATE tasks SET description = ? WHERE id = ?`);

for (const t of tasks) {
  if (t.description && t.description.includes('@ €')) {
    // E.g. "Qty: 1 L/S @ €2500. Drawing:" -> "Qty: 1 L/S. Drawing:"
    const cleaned = t.description.replace(/ @ €[0-9.]+/g, '');
    updateTaskStmt.run(cleaned, t.id);
    cleanedTasks++;
  }
}

console.log(`✅ Cleaned synthetic price references from ${cleanedTasks} task descriptions.`);

// 3. Update project budget and contract value to indicate unpriced tender
db.prepare(`
  UPDATE projects 
  SET budget = 0, contract_value = 0 
  WHERE id = ?
`).run(projectId);

// 4. Update work packages budget allocations to 0 (unpriced)
db.prepare(`
  UPDATE work_packages 
  SET budget_allocated = 0 
  WHERE project_id = ?
`).run(projectId);

console.log('✅ Project Master and Work Packages budget set to €0.00 (Unpriced Tender).');
console.log('🎉 BOQ is now 100% clean and unpriced as in the original Enser Ltd RFQ document.');
