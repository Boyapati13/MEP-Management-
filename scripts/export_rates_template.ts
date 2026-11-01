import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

const db = new DatabaseSync('mep_pm.db');
const items = db.prepare(`
  SELECT item_number, description, unit, tender_quantity 
  FROM boq_items 
  WHERE project_id = 'bov-st-venera-2618' 
  ORDER BY id ASC
`).all() as any[];

let csv = 'item_number,description,unit,quantity,contract_unit_rate\n';
for (const it of items) {
  const safeDesc = `"${(it.description || '').replace(/"/g, '""')}"`;
  csv += `${it.item_number},${safeDesc},${it.unit},${it.tender_quantity},\n`;
}

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(path.join('data', 'bov_st_venera_rates_template.csv'), csv, 'utf8');
console.log(`✅ Created CSV contract rates template with ${items.length} items at data/bov_st_venera_rates_template.csv`);
