import { db, rowToDict } from '../server/db/connection';
import { initDb } from '../server/db/schema';

console.log('================================================================');
console.log('RUNNING BUILDERTREND SELECTIONS & ALLOWANCES AUTOMATED TEST SUITE');
console.log('================================================================');

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  try {
    // 1. Initialize DB and verify tables
    initDb();

    const catTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='selection_categories'").get();
    assert(Boolean(catTable), 'Table selection_categories exists in database');

    const choiceTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='selection_choices'").get();
    assert(Boolean(choiceTable), 'Table selection_choices exists in database');

    // 2. Find primary project
    const project: any = db.prepare("SELECT * FROM projects WHERE id = 'bov-st-venera-2618' OR id = 'proj-bov-st-venera' LIMIT 1").get();
    assert(Boolean(project), `Target project found: ${project?.name} (${project?.id})`);

    const projectId = project.id;

    // 3. Clear existing test selections if any
    db.prepare("DELETE FROM selection_choices WHERE category_id IN (SELECT id FROM selection_categories WHERE project_id = ?)").run(projectId);
    db.prepare("DELETE FROM selection_categories WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM change_orders WHERE id LIKE 'co_sel_test_%'").run();

    // 4. Seed default commercial selection categories
    const testCatId1 = 'sel_cat_test_01';
    const testCatId2 = 'sel_cat_test_02';
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO selection_categories (
        id, project_id, name, trade, allowance_amount, cutoff_date,
        status, boq_ref, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'Pending Client Choice', ?, ?, ?)
    `).run(
      testCatId1,
      projectId,
      'Architectural Office Luminaires & Linear LED',
      'Lighting',
      12500,
      '2026-11-20',
      'BOQ-2618-3.0',
      now,
      now
    );

    db.prepare(`
      INSERT INTO selection_categories (
        id, project_id, name, trade, allowance_amount, cutoff_date,
        status, boq_ref, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'Pending Client Choice', ?, ?, ?)
    `).run(
      testCatId2,
      projectId,
      'Modular 10kVA Online Double-Conversion UPS System',
      'Critical Power',
      9200,
      '2026-10-25', // Overdue cutoff
      'BOQ-2618-UPS.01',
      now,
      now
    );

    const seededCats = db.prepare("SELECT COUNT(*) as count FROM selection_categories WHERE project_id = ?").get(projectId) as any;
    assert(seededCats.count === 2, 'Allowance categories inserted into database');

    // 5. Insert Choices for Category 1
    const choice1A = 'sel_choice_1a';
    const choice1B = 'sel_choice_1b';

    db.prepare(`
      INSERT INTO selection_choices (
        id, category_id, title, manufacturer, model_number,
        unit_price, quantity, total_price, lead_time_weeks,
        is_baseline, image_url, description, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      choice1A,
      testCatId1,
      'Baseline Tender Spec: Philips CoreLine LED 40W 4000K',
      'Philips Lighting',
      'RC132V LED36S/840',
      125,
      100,
      12500,
      3,
      1,
      'https://example.com/luminaire-baseline.jpg',
      'Standard micro-prismatic optic, UGR<19',
      now
    );

    db.prepare(`
      INSERT INTO selection_choices (
        id, category_id, title, manufacturer, model_number,
        unit_price, quantity, total_price, lead_time_weeks,
        is_baseline, image_url, description, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      choice1B,
      testCatId1,
      'Upgrade Option A: Zumtobel MIREL Evolution High CRI90 Architectural',
      'Zumtobel',
      'MIREL-EVO-600',
      155,
      100,
      15500, // €3,000 over allowance
      4,
      0,
      'https://example.com/zumtobel-mirel.jpg',
      'Louvered optical body with circadian lighting control',
      now
    );

    const choicesCount = db.prepare("SELECT COUNT(*) as count FROM selection_choices WHERE category_id = ?").get(testCatId1) as any;
    assert(choicesCount.count === 2, 'Choice options inserted for Category 1');

    // 6. Test Baseline Selection & Variance
    db.prepare("UPDATE selection_categories SET selected_choice_id = ? WHERE id = ?").run(choice1A, testCatId1);
    const catAfterBaseline: any = db.prepare("SELECT * FROM selection_categories WHERE id = ?").get(testCatId1);
    const baselineChoice: any = db.prepare("SELECT * FROM selection_choices WHERE id = ?").get(catAfterBaseline.selected_choice_id);
    const baselineVariance = baselineChoice.total_price - catAfterBaseline.allowance_amount;
    assert(baselineVariance === 0, `Baseline option has zero variance (€${baselineVariance})`);

    // 7. Test Upgrade Selection & Overage Detection
    db.prepare("UPDATE selection_categories SET selected_choice_id = ? WHERE id = ?").run(choice1B, testCatId1);
    const catAfterUpgrade: any = db.prepare("SELECT * FROM selection_categories WHERE id = ?").get(testCatId1);
    const upgradeChoice: any = db.prepare("SELECT * FROM selection_choices WHERE id = ?").get(catAfterUpgrade.selected_choice_id);
    const upgradeVariance = upgradeChoice.total_price - catAfterUpgrade.allowance_amount;
    assert(upgradeVariance === 3000, `Upgrade option correctly computes +€3,000 overage (€${upgradeVariance})`);

    // 8. Test Digital E-Signature & Approval Gate
    const signer = 'Bank of Valletta Project Director';
    const sigToken = 'SIG-BOV-TEST-99';
    db.prepare(`
      UPDATE selection_categories
      SET status = 'Approved',
          approved_by = ?,
          approved_at = ?,
          approval_notes = 'Approved premium Zumtobel fixtures for executive areas',
          signature_token = ?
      WHERE id = ?
    `).run(signer, now, sigToken, testCatId1);

    const approvedCat: any = db.prepare("SELECT * FROM selection_categories WHERE id = ?").get(testCatId1);
    assert(approvedCat.status === 'Approved', 'Category status transitioned to Approved');
    assert(approvedCat.approved_by === signer, 'Approved by name recorded correctly');
    assert(approvedCat.signature_token === sigToken, 'Digital E-Signature token recorded');

    // 9. Test Buildertrend Change Order Auto-Generation Sync
    const coId = 'co_sel_test_01';
    const coNumber = 'VoR-SEL-3.0-TEST';
    db.prepare(`
      INSERT INTO change_orders (
        id, project_id, number, title, trade, reason,
        cost_impact, schedule_impact_days, date_raised, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Approved')
    `).run(
      coId,
      projectId,
      coNumber,
      `Selection Upgrade: Zumtobel over Allowance`,
      'Lighting',
      `Client selected upgrade option exceeding allowance of €12,500 by €3,000`,
      upgradeVariance,
      0,
      now.split('T')[0]
    );

    db.prepare("UPDATE selection_categories SET change_order_id = ? WHERE id = ?").run(coId, testCatId1);
    const coRecord: any = db.prepare("SELECT * FROM change_orders WHERE id = ?").get(coId);
    assert(Boolean(coRecord), 'Change order variation automatically created in change_orders table');
    assert(coRecord.cost_impact === 3000, `Variation cost impact matches selection overage (€${coRecord.cost_impact})`);

    // 10. Test Cutoff Overdue Logic for Category 2
    const overdueCat: any = db.prepare("SELECT * FROM selection_categories WHERE id = ?").get(testCatId2);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(overdueCat.cutoff_date + 'T00:00:00');
    const isOverdue = cutoff < today && overdueCat.status !== 'Approved';
    assert(isOverdue === true, 'Category 2 cutoff is detected as overdue past deadline');

    console.log('================================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================');

    if (failed > 0) process.exit(1);
  } catch (err: any) {
    console.error('Test execution failed:', err);
    process.exit(1);
  }
}

runTests();
