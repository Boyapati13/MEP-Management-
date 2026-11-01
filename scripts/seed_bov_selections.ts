import { db } from '../server/db/connection';
import crypto from 'crypto';

const projectId = 'bov-st-venera-2618';
console.log('Seeding rich commercial selections for project:', projectId);

// Clear existing selections for this project
db.prepare("DELETE FROM selection_choices WHERE category_id IN (SELECT id FROM selection_categories WHERE project_id = ?)").run(projectId);
db.prepare("DELETE FROM selection_categories WHERE project_id = ?").run(projectId);

const now = new Date().toISOString();
const inTwoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
const inFourWeeks = new Date(Date.now() + 28 * 86400000).toISOString().split('T')[0];
const pastThreeDays = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];

const seedData = [
  {
    name: 'Architectural Office Luminaires & Linear LED',
    trade: 'Lighting',
    allowance: 12500,
    cutoff: inTwoWeeks,
    boq_ref: 'BOQ-2618-3.0',
    status: 'Pending Client Choice',
    choices: [
      {
        title: 'Baseline Tender Spec: Philips CoreLine LED 40W 4000K',
        manufacturer: 'Philips Lighting',
        model: 'RC132V LED36S/840 PSD W60L60',
        unit_price: 125,
        qty: 100,
        is_baseline: 1,
        lead_weeks: 3,
        image: 'https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?w=500&auto=format&fit=crop&q=80',
        desc: 'Standard recessed 600x600 micro-prismatic optic, UGR<19, DALI dimmable.',
        specs: 'Lumens: 3600lm | CCT: 4000K | CRI: 80 | Life: 50,000h L80 | Warranty: 5 Years',
      },
      {
        title: 'Upgrade Option A: Zumtobel MIREL Evolution High CRI90 Architectural',
        manufacturer: 'Zumtobel',
        model: 'MIREL-EVO-600-3400-940-LDO',
        unit_price: 155,
        qty: 100,
        is_baseline: 0,
        lead_weeks: 4,
        image: 'https://images.unsplash.com/photo-1540932239986-30128078f3c5?w=500&auto=format&fit=crop&q=80',
        desc: 'Premium architectural louvered luminaire with tunable circadian support and glare rating UGR<16.',
        specs: 'Lumens: 3800lm | CCT: 4000K Tunable | CRI: 92 | Life: 70,000h L90 | Warranty: 7 Years',
      },
      {
        title: 'Design Option B: Artemide Acoustic Panel Integrated Linear LED',
        manufacturer: 'Artemide',
        model: 'EGG-ACOUSTIC-1200',
        unit_price: 180,
        qty: 100,
        is_baseline: 0,
        lead_weeks: 6,
        image: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=500&auto=format&fit=crop&q=80',
        desc: 'Sound absorbing felt body with recessed micro-downlights. High acoustic damping (NRC 0.85).',
        specs: 'Lumens: 4200lm | CCT: 3500K | CRI: 95 | Sound NRC: 0.85 | Warranty: 5 Years',
      },
    ],
  },
  {
    name: 'Modular 10kVA Online Double-Conversion UPS System',
    trade: 'Critical Power',
    allowance: 9200,
    cutoff: pastThreeDays, // Past due to demonstrate Buildertrend cutoff alert
    boq_ref: 'BOQ-2618-UPS.01',
    status: 'Pending Client Choice',
    choices: [
      {
        title: 'Baseline Tender Spec: Riello Multi Sentry 10kVA Tower',
        manufacturer: 'Riello UPS',
        model: 'MST-10-V2',
        unit_price: 9200,
        qty: 1,
        is_baseline: 1,
        lead_weeks: 4,
        image: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=500&auto=format&fit=crop&q=80',
        desc: 'VFI-SS-111 online double conversion, internal 10-min battery runtime at 80% load.',
        specs: 'Efficiency: 96.5% | PF: 0.9 | Runtime: 10 min | SNMP Card Included',
      },
      {
        title: 'Upgrade Option A: Schneider Galaxy VL 15kVA Modular N+1 with Li-Ion',
        manufacturer: 'Schneider Electric',
        model: 'GVL15K10H-LI',
        unit_price: 11450,
        qty: 1,
        is_baseline: 0,
        lead_weeks: 5,
        image: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=500&auto=format&fit=crop&q=80',
        desc: 'Hot-swappable power modules, Lithium-ion 15-year battery pack, EcoStruxure cloud telemetrics.',
        specs: 'Efficiency: 99% ECOnversion | PF: 1.0 | Battery: Li-Ion 15yr | Warranty: 10 Years',
      },
    ],
  },
  {
    name: 'Main Distribution Board (MDB) & Intelligent Metering',
    trade: 'Electrical',
    allowance: 14800,
    cutoff: inFourWeeks,
    boq_ref: 'BOQ-2618-E-01',
    status: 'Approved',
    selected_index: 1,
    approved_by: 'Bank of Valletta Facilities Directorate',
    approval_notes: 'Approved Schneider smart breaker package with Modbus gateway for central BMS logging.',
    choices: [
      {
        title: 'Baseline Tender Spec: ABB ArTu-K Form 2b Distribution Enclosure',
        manufacturer: 'ABB',
        model: 'ARTU-K-250A-F2',
        unit_price: 14800,
        qty: 1,
        is_baseline: 1,
        lead_weeks: 3,
        image: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=500&auto=format&fit=crop&q=80',
        desc: 'IP43 floor standing steel enclosure with Tmax XT MCCB incoming 250A.',
        specs: 'In: 250A | Icu: 36kA | Form: 2b | IP: IP43 | Standard DIN meters',
      },
      {
        title: 'Selected Option: Schneider PrismaSeT G with PowerTag Smart Cloud Breakers',
        manufacturer: 'Schneider Electric',
        model: 'LVS-PRISMA-G-250-IOT',
        unit_price: 16250,
        qty: 1,
        is_baseline: 0,
        lead_weeks: 4,
        image: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=500&auto=format&fit=crop&q=80',
        desc: 'Form 3b compartmentalized board with wireless PowerTag sub-metering on all 18 outgoing ways.',
        specs: 'In: 250A | Icu: 50kA | Form: 3b | Comms: Modbus TCP/IP & LoRaWAN | Wireless sensors',
      },
    ],
  },
  {
    name: 'Floor 1 & 2 Server Room 42U Racks & Structured Cat6A Patching',
    trade: 'ELV',
    allowance: 7600,
    cutoff: inTwoWeeks,
    boq_ref: 'BOQ-2618-8.0',
    status: 'Pending Client Choice',
    choices: [
      {
        title: 'Baseline Tender Spec: Legrand LCS3 42U Server Rack 800x1000',
        manufacturer: 'Legrand',
        model: 'LCS3-42U-8010',
        unit_price: 3800,
        qty: 2,
        is_baseline: 1,
        lead_weeks: 2,
        image: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=500&auto=format&fit=crop&q=80',
        desc: 'Perforated 80% airflow doors, high-density vertical cable trays, grounding kit.',
        specs: 'Capacity: 42U | Depth: 1000mm | Static Load: 1500kg | 24-Port Cat6A Panels x 8',
      },
      {
        title: 'Upgrade Option A: APC NetShelter SX with Integrated Zero-U Smart Switched PDU',
        manufacturer: 'APC by Schneider',
        model: 'AR3300-SMART-PDU',
        unit_price: 4650,
        qty: 2,
        is_baseline: 0,
        lead_weeks: 3,
        image: 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=500&auto=format&fit=crop&q=80',
        desc: 'Includes dual redundant IP-metered zero-U PDUs with environmental temp/humidity sensors.',
        specs: 'Capacity: 42U | Depth: 1200mm | Zero-U PDU x 4 | Environmental Probe x 2 | Smart lock',
      },
    ],
  },
];

for (const catData of seedData) {
  const catId = 'sel_cat_' + crypto.randomUUID().slice(0, 8);
  db.prepare(`
    INSERT INTO selection_categories (
      id, project_id, name, trade, allowance_amount, cutoff_date,
      status, approved_by, approved_at, approval_notes, signature_token,
      boq_ref, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    catId,
    projectId,
    catData.name,
    catData.trade,
    catData.allowance,
    catData.cutoff,
    catData.status,
    catData.approved_by || null,
    catData.approved_by ? now : null,
    catData.approval_notes || null,
    catData.approved_by ? 'SIG-BOV-' + crypto.randomBytes(3).toString('hex').toUpperCase() : null,
    catData.boq_ref,
    now,
    now
  );

  let selectedChoiceId: string | null = null;

  for (let i = 0; i < catData.choices.length; i++) {
    const ch = catData.choices[i];
    const choiceId = 'sel_opt_' + crypto.randomUUID().slice(0, 8);
    const total = ch.qty * ch.unit_price;

    db.prepare(`
      INSERT INTO selection_choices (
        id, category_id, title, manufacturer, model_number,
        unit_price, quantity, total_price, lead_time_weeks,
        is_baseline, image_url, description, technical_specs, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      choiceId,
      catId,
      ch.title,
      ch.manufacturer,
      ch.model,
      ch.unit_price,
      ch.qty,
      total,
      ch.lead_weeks,
      ch.is_baseline,
      ch.image,
      ch.desc,
      ch.specs,
      now
    );

    if (catData.selected_index != null && catData.selected_index === i) {
      selectedChoiceId = choiceId;
    } else if (catData.selected_index == null && ch.is_baseline) {
      selectedChoiceId = choiceId;
    }
  }

  if (selectedChoiceId) {
    db.prepare('UPDATE selection_categories SET selected_choice_id = ? WHERE id = ?').run(selectedChoiceId, catId);
  }
}

console.log('Seeded successfully:', seedData.length, 'categories with full choices.');
