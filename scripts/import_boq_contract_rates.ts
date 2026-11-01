import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';

const db = new DatabaseSync('mep_pm.db');
const projectId = 'bov-st-venera-2618';

export function importContractRates(csvOrJsonPath: string) {
  if (!fs.existsSync(csvOrJsonPath)) {
    throw new Error(`File not found: ${csvOrJsonPath}`);
  }

  const content = fs.readFileSync(csvOrJsonPath, 'utf8');
  let rateMap = new Map<string, number>();

  if (csvOrJsonPath.endsWith('.json')) {
    const list = JSON.parse(content);
    for (const item of list) {
      const num = item.item_number || item.num || item.item;
      const rate = parseFloat(item.contract_unit_rate || item.rate || item.tender_rate || 0);
      if (num) rateMap.set(String(num).trim(), rate);
    }
  } else {
    // Parse CSV
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const itemNumIdx = header.findIndex(h => h.includes('item'));
    const rateIdx = header.findIndex(h => h.includes('rate') || h.includes('price'));

    if (itemNumIdx === -1 || rateIdx === -1) {
      throw new Error('CSV must contain item_number and rate columns');
    }

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      const num = parts[itemNumIdx]?.trim();
      const rawRate = parts[parts.length - 1]?.trim(); // usually last column
      const rate = parseFloat(rawRate);
      if (num && !isNaN(rate)) {
        rateMap.set(num, rate);
      }
    }
  }

  console.log(`📊 Found ${rateMap.size} rates in ${csvOrJsonPath}`);

  let updatedCount = 0;
  let totalContractValue = 0;

  const updateStmt = db.prepare(`
    UPDATE boq_items 
    SET tender_rate = ?, tender_amount = ? 
    WHERE project_id = ? AND item_number = ?
  `);

  const boqItems = db.prepare(`
    SELECT id, item_number, tender_quantity 
    FROM boq_items 
    WHERE project_id = ?
  `).all(projectId) as any[];

  for (const item of boqItems) {
    if (rateMap.has(item.item_number)) {
      const rate = rateMap.get(item.item_number)!;
      const amount = Math.round(item.tender_quantity * rate * 100) / 100;
      updateStmt.run(rate, amount, projectId, item.item_number);
      totalContractValue += amount;
      updatedCount++;
    }
  }

  totalContractValue = Math.round(totalContractValue * 100) / 100;

  // Update project contract value
  db.prepare(`
    UPDATE projects 
    SET budget = ?, contract_value = ? 
    WHERE id = ?
  `).run(totalContractValue, totalContractValue, projectId);

  console.log(`✅ Updated ${updatedCount} BOQ items. Total contract value: €${totalContractValue.toLocaleString()}`);
  return { updatedCount, totalContractValue };
}

// CLI direct run
if (process.argv[2]) {
  importContractRates(process.argv[2]);
}
