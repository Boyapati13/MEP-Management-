/**
 * Master Database Reset & Seed Script: BOV St. Venera Refurbishment (Job No. 2618)
 * 
 * Based directly on Enser Ltd Building Services Consulting Engineers:
 * Request for Quotation — Level 1 and Level 2 Refurbishment - Electrical Installation
 * Client: Bank of Valletta plc (BOV plc)
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

const db = new DatabaseSync('mep_pm.db');
db.exec('PRAGMA busy_timeout = 10000;');

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

const defaultPassword = 'ChangeMe123!';
const defaultHash = hashPassword(defaultPassword);
const now = new Date().toISOString();

console.log('===============================================================');
console.log('RESETTING DATABASE & SEEDING BOV ST. VENERA (JOB 2618) REAL ERP');
console.log('===============================================================');

// 1. Wipe all test tables
const tablesToWipe = [
  'attendance', 'attendance_adjustments', 'audit_logs', 'boq_items',
  'change_orders', 'clarification_comments', 'clarifications',
  'commissioning_tests', 'dailylogs', 'document_revisions', 'document_transmittals',
  'documents', 'handover_items', 'inspections', 'material_requests',
  'ncrs', 'notifications', 'plan_buckets', 'plan_task_checklist', 'plan_tasks',
  'procurement_items', 'progress_report_photos', 'progress_reports',
  'progress_submissions', 'project_actions', 'project_companies', 'project_decisions',
  'project_memberships', 'projects', 'punchlist', 'purchase_orders',
  'record_owners', 'reference_sequences', 'rfis', 'risks', 'safety_incidents',
  'sessions', 'site_instruction_attachments', 'site_instruction_updates',
  'site_instructions', 'sites', 'submittals', 'task_blockers', 'task_status_history',
  'tasks', 'timesheets', 'transmittal_items', 'wbs_items', 'work_packages',
  'worker_assignments', 'workers'
];

db.exec('BEGIN IMMEDIATE;');
for (const t of tablesToWipe) {
  try {
    db.exec(`DELETE FROM "${t}";`);
  } catch (err) {
    // Ignore missing tables
  }
}

// Remove transient test users (keep or re-create standard roles)
db.exec(`DELETE FROM users WHERE username LIKE '%audit%' OR username LIKE 'test_%';`);
db.exec('COMMIT;');

console.log('🧹 Purged all old test/audit projects and transient records.');

// 2. Insert Master Real Project: BOV St. Venera (Job 2618)
const projectId = 'bov-st-venera-2618';
db.prepare(`
  INSERT INTO projects (
    id, name, client, status, start_date, end_date, budget, code,
    location, description, progress, project_code, currency, contract_value,
    contract_type, stage, client_name, main_contractor, consultant,
    site_address, city, country, baseline_start_date, baseline_end_date, forecast_end_date
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?
  )
`).run(
  projectId,
  'BOV St. Venera - Level 1 and Level 2 Refurbishment',
  'Bank of Valletta (BOV plc)',
  'Active',
  '2026-05-01',
  '2026-12-15',
  185000,
  'JOB-2618',
  'Triq il-Kanun, Santa Venera, Malta',
  'Level 1 and Level 2 Refurbishment - Electrical & ELV Installation (Job No. 2618). Technical specification by Enser Ltd Consulting Engineers.',
  35,
  'JOB-2618',
  'EUR',
  185000,
  'Minor Building Services Works (Enser Conditions)',
  'Construction',
  'Bank of Valletta plc',
  'Apex MEP Engineering Ltd',
  'Enser Ltd - Building Services Engineers',
  'Bank of Valletta Regional Operations Centre, Triq il-Kanun, Santa Venera, Malta',
  'Santa Venera',
  'Malta',
  '2026-05-01',
  '2026-12-15',
  '2026-12-15'
);
console.log('🏢 Created Project: BOV St. Venera (Job 2618)');

// 3. Create Construction Site
const siteId = 'site-bov-venera';
db.prepare(`
  INSERT INTO sites (
    id, project_id, name, address, city, country, latitude, longitude,
    geofence_radius_m, geofence_warning_radius_m, timezone, status, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  siteId,
  projectId,
  'BOV Operations Centre Site',
  'Triq il-Kanun, Santa Venera',
  'Santa Venera',
  'Malta',
  35.8906,
  14.4758,
  150,
  200,
  'Europe/Malta',
  'Active',
  now
);

// 4. Create Standard Role Personas
const rolesToCreate = [
  { username: 'admin', name: 'Executive Administrator', role: 'Admin', email: 'admin@fieldhub.internal', trade: 'Management', company: 'Apex MEP Engineering Ltd' },
  { username: 'pm', name: 'David Sterling', role: 'ProjectManager', email: 'pm@fieldhub.internal', trade: 'General MEP', company: 'Apex MEP Engineering Ltd' },
  { username: 'site_engineer', name: 'Mark Borg', role: 'SiteEngineer', email: 'engineer@fieldhub.internal', trade: 'Electrical (Wireman License B)', company: 'Apex MEP Engineering Ltd' },
  { username: 'commercial', name: 'Sarah Mifsud', role: 'CommercialManager', email: 'commercial@fieldhub.internal', trade: 'Quantity Surveying', company: 'Apex MEP Engineering Ltd' },
  { username: 'qaqc', name: 'Paul Camilleri', role: 'QAQC', email: 'qaqc@fieldhub.internal', trade: 'Quality Assurance', company: 'Apex MEP Engineering Ltd' },
  { username: 'safety', name: 'Elena Farrugia', role: 'SafetyOfficer', email: 'safety@fieldhub.internal', trade: 'Health & Safety', company: 'Apex MEP Engineering Ltd' },
  { username: 'consultant', name: 'Ing. Michael Gatt', role: 'Consultant', email: 'consultant@ensermalta.com', trade: 'Building Services', company: 'Enser Ltd' },
  { username: 'subcontractor', name: 'Apex Electrical Contracting', role: 'Subcontractor', email: 'subcontractor@apexelectrical.com', trade: 'Electrical & ELV', company: 'Apex Electrical Contracting Ltd' },
  { username: 'client', name: 'Joseph Vella', role: 'Client', email: 'client@bov.com', trade: 'Client Representation', company: 'Bank of Valletta plc' },
  { username: 'worker', name: 'Mario Grech', role: 'Worker', email: 'worker@fieldhub.internal', trade: 'Electrical', company: 'Apex MEP Engineering Ltd' }
];

for (const u of rolesToCreate) {
  const existing: any = db.prepare('SELECT id FROM users WHERE username=?').get(u.username);
  const userId = existing ? existing.id : crypto.randomUUID();
  if (existing) {
    db.prepare(`
      UPDATE users SET name=?, role=?, email=?, trade=?, company=?, password_hash=?, must_change_password=0, status='Active'
      WHERE id=?
    `).run(u.name, u.role, u.email, u.trade, u.company, defaultHash, userId);
  } else {
    db.prepare(`
      INSERT INTO users (id, username, name, role, email, trade, company, password_hash, must_change_password, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'Active', ?)
    `).run(userId, u.username, u.name, u.role, u.email, u.trade, u.company, defaultHash, now);
  }

  // Grant project membership
  db.prepare(`
    INSERT OR REPLACE INTO project_memberships (user_id, project_id, access_role, active)
    VALUES (?, ?, ?, 1)
  `).run(userId, projectId, u.role);
}
console.log('👥 Configured all 10 verified role accounts with project memberships.');

// 5. Create Work Packages matching Enser Tender Scopes
const workPackages = [
  { id: 'wp-01', code: 'WP-01', name: 'Preliminaries, RAMS & Scaffolding', discipline: 'Management', budget: 12500, lead: 'David Sterling', desc: 'RAMS submittals, wireman B license registration, scaffolding and legal waste disposal.' },
  { id: 'wp-02', code: 'WP-02', name: 'Electrical Distribution Boards & Panels', discipline: 'Electrical', budget: 34800, lead: 'Mark Borg', desc: 'Supply & installation of UP0, UP1, UP2, DB1, DB2, Schneider Isobar 4c RCBOs & 63A isolators.' },
  { id: 'wp-03', code: 'WP-03', name: 'Power Cabling & Containment', discipline: 'Electrical', budget: 28400, lead: 'Mario Grech', desc: 'CU/XLPE/LSZH cabling C01-C11, nylon/BW cable glands, PVC conduit chased in walls and slabs.' },
  { id: 'wp-04', code: 'WP-04', name: 'Secondary Wiring & Desk Servicing', discipline: 'Electrical', budget: 22600, lead: 'Mario Grech', desc: '10 Floor-to-ceiling power poles, GST 3-pin couplers, 82 combination units with USB-A/C.' },
  { id: 'wp-05', code: 'WP-05', name: 'Lighting Luminaires & Emergency Fittings', discipline: 'Electrical', budget: 31200, lead: 'Mark Borg', desc: 'Supply and installation of 187 LED luminaires (Types A to I) and 26 3-hr emergency fittings.' },
  { id: 'wp-06', code: 'WP-06', name: 'Data & Structured Cabling (Cat 6)', discipline: 'ELV', budget: 26500, lead: 'Mark Borg', desc: 'Cat 6 U/UTP (3070m), F/UTP (400m), GOP boxes, 24/48-port patch panels and Euromodules.' },
  { id: 'wp-07', code: 'WP-07', name: 'Audio-Visual & Background Music System', discipline: 'ELV', budget: 14000, lead: 'David Sterling', desc: 'Active optical HDMI cables, 2x 6-port HDMI distribution amplifiers, 100V line amplifier, 6 ceiling speakers.' },
  { id: 'wp-08', code: 'WP-08', name: 'UPS & Critical Power Infrastructure', discipline: 'Critical Power', budget: 15000, lead: 'Paul Camilleri', desc: '20kVA monolithic / modular UPS with 10-min VRLA batteries and 5-year maintenance agreement.' }
];

for (const wp of workPackages) {
  db.prepare(`
    INSERT INTO work_packages (id, project_id, name, code, discipline, description, lead_contact, budget_allocated, status, start_date, target_date, created_at, site_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'In Progress', '2026-05-01', '2026-11-30', ?, ?)
  `).run(wp.id, projectId, wp.name, wp.code, wp.discipline, wp.desc, wp.lead, wp.budget, now, siteId);
}
console.log(`📦 Created ${workPackages.length} Work Packages.`);

// 6. Populate Complete BOQ from PDF Schedules (pp. 38-46)
const boqData = [
  // Preliminary Items (p. 38)
  { num: '1.0', desc: 'Risk assessment, method statement, health and safety reports (RAMS) as required by law', unit: 'L/S', qty: 1, rate: 2500, disc: 'Management', sys: 'Preliminaries' },
  { num: '2.0', desc: 'Submittal of all working drawings coordinated with existing services prior to starting', unit: 'L/S', qty: 1, rate: 3500, disc: 'Management', sys: 'Working Drawings' },
  { num: '3.0', desc: 'Scaffolding, staging and platforms as required including certification', unit: 'L/S', qty: 1, rate: 2000, disc: 'Management', sys: 'Scaffolding' },
  { num: '4.0', desc: 'Dismantling and carting away redundant electrical/data items to legal dump site with receipt', unit: 'L/S', qty: 1, rate: 3000, disc: 'Electrical', sys: 'Dismantling' },
  { num: '5.0', desc: 'Marking up of all penetrations exceeding 100x100mm in size for consultant approval', unit: 'L/S', qty: 1, rate: 1500, disc: 'Civil/MEP', sys: 'Penetrations' },

  // Electrical Installation (pp. 39-42)
  { num: 'E-01', desc: 'Supply and install electrical panel UP0 as per DB schedules, drawings and specifications', unit: 'No', qty: 1, rate: 4200, disc: 'Electrical', sys: 'Panels' },
  { num: 'E-02.01', desc: 'Supply and install incoming MCB & outgoing single module RCBOs in panel DB1 (Schneider Isobar 4c)', unit: 'No', qty: 1, rate: 3800, disc: 'Electrical', sys: 'Panels' },
  { num: 'E-02.02', desc: 'Supply and install incoming MCB & outgoing single module RCBOs in panel DB2 (Schneider Isobar 4c)', unit: 'No', qty: 1, rate: 3800, disc: 'Electrical', sys: 'Panels' },
  { num: 'E-02.03', desc: 'Supply and install incoming MCB & outgoing single module RCBOs in panel UP1 (Schneider Isobar 4c)', unit: 'No', qty: 1, rate: 2600, disc: 'Electrical', sys: 'Panels' },
  { num: 'E-02.04', desc: 'Supply and install incoming MCB & outgoing single module RCBOs in panel UP2 (Schneider Isobar 4c)', unit: 'No', qty: 1, rate: 2600, disc: 'Electrical', sys: 'Panels' },
  { num: 'E-03', desc: 'Supply and install 63A 4P IP65 rotary isolators', unit: 'No', qty: 2, rate: 180, disc: 'Electrical', sys: 'Isolators' },
  { num: 'E-04', desc: 'Supply and install 16A 3-pin industrial socket c/w rotary isolator', unit: 'No', qty: 2, rate: 240, disc: 'Electrical', sys: 'Sockets' },
  { num: 'E-05.01', desc: 'Supply and install CU/XLPE/LSZH cable C04 - 5c/10sqmm', unit: 'm', qty: 1, rate: 45, disc: 'Electrical', sys: 'Cabling' },
  { num: 'E-05.02', desc: 'Supply and install CU/XLPE/LSZH cable C05 - 5c/10sqmm', unit: 'm', qty: 1, rate: 45, disc: 'Electrical', sys: 'Cabling' },
  { num: 'E-05.03', desc: 'Supply and install CU/XLPE/LSZH cable C06 - 5c/10sqmm', unit: 'm', qty: 1, rate: 45, disc: 'Electrical', sys: 'Cabling' },
  { num: 'E-05.04', desc: 'Supply and install CU/XLPE/LSZH cable C07 - 5c/10sqmm', unit: 'm', qty: 4, rate: 45, disc: 'Electrical', sys: 'Cabling' },
  { num: 'E-05.05', desc: 'Supply and install CU/XLPE/LSZH cable C08 - 5c/6sqmm', unit: 'm', qty: 14, rate: 32, disc: 'Electrical', sys: 'Cabling' },
  { num: 'E-05.06', desc: 'Supply and install CU/XLPE/LSZH cable C10 - 3c/2.5sqmm', unit: 'm', qty: 4, rate: 18, disc: 'Electrical', sys: 'Cabling' },
  { num: 'E-05.07', desc: 'Supply and install CU/XLPE/LSZH cable C11 - 3c/2.5sqmm', unit: 'm', qty: 4, rate: 18, disc: 'Electrical', sys: 'Cabling' },
  { num: 'E-06.01', desc: 'Termination of C04-C11 cables using nylon glands and crimping lugs', unit: 'No', qty: 14, rate: 35, disc: 'Electrical', sys: 'Terminations' },
  { num: 'E-07.01', desc: 'Retermination of existing cables C01, C02, C03, C09 into isolators/panels using BW glands', unit: 'No', qty: 8, rate: 65, disc: 'Electrical', sys: 'Terminations' },
  { num: 'E-08.01', desc: 'Lighting Point in single/multicore LSZH copper wire in PVC conduit', unit: 'No', qty: 130, rate: 65, disc: 'Electrical', sys: 'Lighting' },
  { num: 'E-08.02', desc: 'Dimmable Light points in 4x1.5sqmm cabling', unit: 'No', qty: 6, rate: 85, disc: 'Electrical', sys: 'Lighting' },
  { num: 'E-08.03', desc: 'Emergency Lighting Point (non-maintained, 3-hour battery autonomy)', unit: 'No', qty: 26, rate: 75, disc: 'Electrical', sys: 'Emergency' },
  { num: 'E-08.04', desc: 'Passive Infrared Sensor (PIR) movement detector 180°/360°', unit: 'No', qty: 27, rate: 110, disc: 'Electrical', sys: 'Controls' },
  { num: 'E-08.05', desc: '1 gang 1 way lighting switch (10A BS 3676-1)', unit: 'No', qty: 6, rate: 25, disc: 'Electrical', sys: 'Switches' },
  { num: 'E-08.06', desc: '2 gang 1 way / 2 way lighting switches', unit: 'No', qty: 3, rate: 32, disc: 'Electrical', sys: 'Switches' },
  { num: 'E-08.08', desc: 'Lighting Dimmer Switch (PushDim retractive controller)', unit: 'No', qty: 1, rate: 75, disc: 'Electrical', sys: 'Switches' },
  { num: 'E-08.09', desc: 'Twin Socket Outlet 13A double pole with safety shutters (BS 1363)', unit: 'No', qty: 67, rate: 45, disc: 'Electrical', sys: 'Power Outlets' },
  { num: 'E-08.13', desc: 'Switched Fused Connection Unit 13A with pilot lamp (BS 5733)', unit: 'No', qty: 43, rate: 48, disc: 'Electrical', sys: 'FCUs' },
  { num: 'E-08.14', desc: 'Unswitched Fused Connection Unit', unit: 'No', qty: 5, rate: 40, disc: 'Electrical', sys: 'FCUs' },
  { num: 'E-08.15', desc: 'Media Plate with 13A sockets (slim profile)', unit: 'No', qty: 1, rate: 120, disc: 'Electrical', sys: 'Media' },
  { num: 'E-08.16', desc: '20A 2P Rotary Maintenance Isolator switch (IP65)', unit: 'No', qty: 27, rate: 95, disc: 'Electrical', sys: 'Isolators' },
  { num: 'E-10.0', desc: 'Re-installation of existing floor-to-ceiling power poles', unit: 'No', qty: 10, rate: 220, disc: 'Electrical', sys: 'Power Poles' },
  { num: 'E-11.01', desc: 'Supply & install 3c/2.5sqmm H07ZZ-F with GST 3pin connector coupler 1in3out', unit: 'No', qty: 22, rate: 115, disc: 'Electrical', sys: 'Desk Servicing' },
  { num: 'E-11.02', desc: 'Supply & install 3c/2.5sqmm H07ZZ-F with GST 3pin connector coupler 1in2out', unit: 'No', qty: 5, rate: 95, disc: 'Electrical', sys: 'Desk Servicing' },
  { num: 'E-12.01', desc: 'GST 3pin M/F factory-fabricated interconnecting leads (1m & 2m)', unit: 'No', qty: 49, rate: 35, disc: 'Electrical', sys: 'Desk Servicing' },
  { num: 'E-14.0', desc: 'Desk Combination Unit with 4x 13A Sockets, USB-A & USB-C quick charge (BS 5733/BS 6396)', unit: 'No', qty: 82, rate: 135, disc: 'Electrical', sys: 'Desk Servicing' },
  { num: 'E-15.01', desc: 'Type A: 60x60cm Flat Panel LED Light Fitting (Recessed 4000K, 3200 lm)', unit: 'No', qty: 77, rate: 85, disc: 'Lighting', sys: 'Luminaires' },
  { num: 'E-15.02', desc: 'Type B: Round LED Downlight 150mm (Recessed 4000K, 2100 lm)', unit: 'No', qty: 31, rate: 65, disc: 'Lighting', sys: 'Luminaires' },
  { num: 'E-15.03', desc: 'Type C: Round LED Downlight 200mm Dimmable via PushDim (2600 lm)', unit: 'No', qty: 6, rate: 95, disc: 'Lighting', sys: 'Luminaires' },
  { num: 'E-15.04', desc: 'Type D: Round LED Downlight 100mm (1200 lm)', unit: 'No', qty: 5, rate: 55, disc: 'Lighting', sys: 'Luminaires' },
  { num: 'E-15.05', desc: 'Type E1: Emergency non-maintained LED light with 3-hr battery autonomy (IP65)', unit: 'No', qty: 20, rate: 90, disc: 'Lighting', sys: 'Emergency' },
  { num: 'E-15.06', desc: 'Type E2: Emergency LED light with exit pictogram and 3-hr battery autonomy', unit: 'No', qty: 6, rate: 105, disc: 'Lighting', sys: 'Emergency' },
  { num: 'E-15.07', desc: 'Type F: Linear LED Light Fitting (Wall mounted 4000K, 4000 lm)', unit: 'No', qty: 1, rate: 140, disc: 'Lighting', sys: 'Luminaires' },
  { num: 'E-15.08', desc: 'Type G: Round LED Downlight 100mm (600 lm)', unit: 'No', qty: 6, rate: 50, disc: 'Lighting', sys: 'Luminaires' },
  { num: 'E-15.09', desc: 'Type H: Square LED Bulkhead Fitting IP65 (Wall mounted 3000K, 1000 lm)', unit: 'No', qty: 2, rate: 80, disc: 'Lighting', sys: 'Luminaires' },
  { num: 'E-15.10', desc: 'Type I: Rectangular LED Step Light (Recessed 3000K, 600 lm)', unit: 'No', qty: 8, rate: 60, disc: 'Lighting', sys: 'Luminaires' },
  { num: 'E-18.0', desc: 'Testing and commissioning of the electrical installation to BS 7671 Appendix 6', unit: 'L/S', qty: 1, rate: 3200, disc: 'Commissioning', sys: 'Inspection' },
  { num: 'E-20.0', desc: 'Supply and install engraved traffolyte labelling on all panels and isolators', unit: 'L/S', qty: 1, rate: 1200, disc: 'Electrical', sys: 'Labelling' },
  { num: 'E-22.0', desc: 'As-fitted drawings in CAD and PDF format with 2 sets of hard copies', unit: 'L/S', qty: 1, rate: 2500, disc: 'Drawings', sys: 'As-Fitted' },

  // Data & ELV Installation (pp. 43-45)
  { num: 'D-01.01', desc: 'CAT6 Patch Panels 19" 1U 24-Port rack mountable with cable management', unit: 'No', qty: 2, rate: 280, disc: 'ELV', sys: 'Data' },
  { num: 'D-02.01', desc: 'Grid Outlet Position (GOP) boxes 4-way, 6-way, 8-way, 12-way, 16-way', unit: 'No', qty: 10, rate: 120, disc: 'ELV', sys: 'GOP' },
  { num: 'D-03.01', desc: 'CAT6 data outlets on faceplates (1, 2, 4 port)', unit: 'No', qty: 14, rate: 35, disc: 'ELV', sys: 'Data' },
  { num: 'D-04.0', desc: 'CAT6 F/UTP foiled shielded cabling for Wifi access points', unit: 'm', qty: 400, rate: 2.2, disc: 'ELV', sys: 'Data' },
  { num: 'D-05.0', desc: 'Termination of CAT6 F/UTP cabling', unit: 'No', qty: 36, rate: 14, disc: 'ELV', sys: 'Data' },
  { num: 'D-06.0', desc: 'CAT6 U/UTP cabling 23AWG LSZH for general points and GOP boxes', unit: 'm', qty: 3070, rate: 1.8, disc: 'ELV', sys: 'Data' },
  { num: 'D-07.0', desc: 'Termination of CAT6 U/UTP cabling', unit: 'No', qty: 288, rate: 12, disc: 'ELV', sys: 'Data' },
  { num: 'D-08.0', desc: 'Patch leads from GOP boxes to desks in power poles and cable baskets', unit: 'm', qty: 460, rate: 3.5, disc: 'ELV', sys: 'Data' },
  { num: 'D-09.0', desc: 'Termination of CAT6 patch cabling', unit: 'No', qty: 152, rate: 10, disc: 'ELV', sys: 'Data' },
  { num: 'D-12.0', desc: '2x 6-Port HDMI distribution amplifiers supporting 1080p 60Hz and HDCP', unit: 'L/S', qty: 1, rate: 1600, disc: 'ELV', sys: 'TV System' },
  { num: 'D-13.0', desc: 'Active Optical (AOC) HDMI cables factory fabricated (10m, 20m, 25m, 30m, 50m)', unit: 'No', qty: 10, rate: 180, disc: 'ELV', sys: 'TV System' },
  { num: 'D-14.0', desc: 'Installation only of 10 Ceiling Mounted TVs and 4 Wall Mounted Meeting Room TVs', unit: 'No', qty: 14, rate: 120, disc: 'ELV', sys: 'TV System' },
  { num: 'D-16.0', desc: 'Commercial Audio Amplifier 100V line output for background music distribution', unit: 'No', qty: 1, rate: 950, disc: 'ELV', sys: 'Sound System' },
  { num: 'D-17.0', desc: '6" Ceiling Loudspeakers 100V line multi-tap recessed in soffit', unit: 'No', qty: 6, rate: 95, disc: 'ELV', sys: 'Sound System' },
  { num: 'D-19.0', desc: 'Bluetooth receiver input wall panel for mobile device streaming to sound amplifier', unit: 'No', qty: 1, rate: 320, disc: 'ELV', sys: 'Sound System' },
  { num: 'D-23.0', desc: 'Testing & commissioning of all CAT6 cabling links with EN 11801 certification report', unit: 'L/S', qty: 1, rate: 1800, disc: 'ELV', sys: 'Testing' },

  // UPS Installation (p. 46)
  { num: 'UPS-01', desc: 'Supply and install Monolithic 20kVA UPS with internal VRLA batteries (10-min autonomy at 100% load)', unit: 'No', qty: 1, rate: 7800, disc: 'Critical Power', sys: 'UPS' },
  { num: 'UPS-02', desc: 'Testing, commissioning and network integration (SNMP/Modbus TCP/IP) of UPS system', unit: 'L/S', qty: 1, rate: 1200, disc: 'Critical Power', sys: 'UPS' },
  { num: 'UPS-03', desc: '5-Year comprehensive service and quarterly preventative maintenance contract (4 visits/year)', unit: 'years', qty: 5, rate: 950, disc: 'Critical Power', sys: 'Maintenance' },
  { num: 'UPS-04', desc: 'Operating and maintenance manuals in soft copy and 2 hard copies', unit: 'L/S', qty: 1, rate: 450, disc: 'Critical Power', sys: 'Manuals' }
];

let boqTotal = 0;
for (const b of boqData) {
  const lineTotal = b.qty * b.rate;
  boqTotal += lineTotal;
  const boqId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO boq_items (
      id, project_id, item_number, description, unit, tender_quantity, tender_rate,
      tender_amount, revised_quantity, installed_quantity, claimed_quantity,
      certified_quantity, discipline, system, building, floor, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, 'BOV ROC', 'Level 1 & 2', ?
    )
  `).run(
    boqId,
    projectId,
    b.num,
    b.desc,
    b.unit,
    b.qty,
    b.rate,
    lineTotal,
    b.qty,
    Math.round(b.qty * 0.35),
    Math.round(b.qty * 0.30),
    Math.round(b.qty * 0.25),
    b.disc,
    b.sys,
    now
  );
}
console.log(`📊 Loaded ${boqData.length} authoritative BOQ line items (Total Value: €${boqTotal.toLocaleString()}).`);

// Update project budget with exact tender total
db.prepare('UPDATE projects SET budget = ?, contract_value = ? WHERE id = ?').run(boqTotal, boqTotal, projectId);

// 7. Register 10 Real Engineering Drawings (pp. 58-67)
const drawings = [
  { num: '2618-S-ELE-01', name: 'Electrical Schematic - Rising Mains, Sub-Mains & Panels', cat: 'Schematic', disc: 'Electrical' },
  { num: '2618-L-LTG-01', name: 'Lighting Layout - First & Second Floor Luminaires & Emergency', cat: 'Plan', disc: 'Electrical' },
  { num: '2618-L-PWR-01', name: 'Power Layout - First & Second Floor Socket Outlets & Desk Servicing', cat: 'Plan', disc: 'Electrical' },
  { num: '2618-L-DTA-01', name: 'Data and Audio Visual Layout - GOP Boxes, TVs & Background Music', cat: 'Plan', disc: 'ELV' },
  { num: '2618-L-SEC-01', name: 'Security Layout - Proximity Card Readers, Controllers & Panels', cat: 'Plan', disc: 'Security' },
  { num: '2618-L-CTV-01', name: 'CCTV Layout - Dome & Bullet Cameras First & Second Floor', cat: 'Plan', disc: 'Security' },
  { num: '2618-L-FAS-01', name: 'Fire Alarm & Fire Fighting Layout - Detectors, Call Points & Sounders', cat: 'Plan', disc: 'Fire Protection' },
  { num: '2618-L-CON-01', name: 'Containment Layout - Cable Trays, Trunking & Floor Ducts', cat: 'Plan', disc: 'Containment' },
  { num: '2618-L-ACD-01', name: 'Air Conditioning Layout - VRF & Split Units Level 1 & 2', cat: 'Plan', disc: 'HVAC' },
  { num: '2618-L-VEN-01', name: 'Ventilation Layout - Supply & Extract Grilles, VCDs & Dampers', cat: 'Plan', disc: 'HVAC' }
];

for (const d of drawings) {
  const docId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO documents (
      id, project_id, name, category, revision, date_added,
      document_number, discipline, status, visibility, published_by, published_at
    ) VALUES (
      ?, ?, ?, ?, 'Rev A', '2026-05-05',
      ?, ?, 'Approved', 'public', 'Enser Ltd', ?
    )
  `).run(
    docId,
    projectId,
    `[${d.num}] ${d.name}`,
    d.cat,
    d.num,
    d.disc,
    now
  );
}
console.log(`📐 Registered ${drawings.length} Enser Engineering Drawings (2618 series).`);

// 8. Register BS 7671 / EN 11801 QA/QC Inspections & Commissioning Tests
const inspectionsData = [
  { title: 'Test A: Continuity of protective conductors & bonding', type: 'Electrical Testing', result: 'Pass', notes: 'Verified equipotential bonding to incoming water, structural steel, and lightning grid according to BS 7671 Reg 612.2.1.' },
  { title: 'Test B: Continuity of ring final circuit conductors', type: 'Electrical Testing', result: 'Pass', notes: 'End-to-end resistance test on live, neutral, and CPC for socket radial feeds according to BS 7671 Reg 612.2.2.' },
  { title: 'Test C: Insulation resistance testing (500V DC)', type: 'Electrical Testing', result: 'Pass', notes: 'All circuits tested at 500V DC between live conductors and earth; readings exceed 50 MΩ (min threshold 1.0 MΩ).' },
  { title: 'Test D: Basic protection by enclosure & IP rating verification', type: 'Witness Inspection', result: 'Pass', notes: 'Verified IP41 on distribution boards and IP65 on rotary isolators; blanking modules installed on spare ways.' },
  { title: 'Test E: Polarity check on all switches & socket outlets', type: 'Electrical Testing', result: 'Pass', notes: 'Verified single-pole switches connected in phase conductors only; socket phase/neutral polarity confirmed.' },
  { title: 'Test F: Earth electrode resistance measurement', type: 'Electrical Testing', result: 'Pass', notes: 'Earth electrode reading recorded at 1.8 Ω, well below the 10 Ω maximum engineering requirement.' },
  { title: 'Test G: RCD / RCBO Automatic Disconnection Time Verification', type: 'Witness Inspection', result: 'Pass', notes: 'All 30mA Type A RCBOs tripped under 28ms at 1x IΔn and under 14ms at 5x IΔn.' },
  { title: 'CAT6 Structured Cabling Permanent Link Certification', type: 'ELV Commissioning', result: 'Pass', notes: '100% of Cat 6 U/UTP and F/UTP links tested to EN 11801 Class E using Level III calibrated field tester.' },
  { title: 'UPS 20kVA Load Bank & 10-Min Battery Autonomy Test', type: 'Witness Testing', result: 'Pass', notes: 'Monolithic 20kVA UPS sustained full 100% load for 12.4 minutes on internal VRLA battery string.' }
];

for (const insp of inspectionsData) {
  const inspId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO inspections (
      id, project_id, date, trade, inspection_type, inspector,
      result, notes, title, status, verified_progress, location, discipline, type
    ) VALUES (
      ?, ?, '2026-06-15', 'Electrical', ?, 'Paul Camilleri (QA/QC)',
      ?, ?, ?, 'Approved', 100, 'Level 1 & 2', 'Electrical', ?
    )
  `).run(
    inspId,
    projectId,
    insp.type,
    insp.result,
    insp.notes,
    insp.title,
    insp.type
  );
}
console.log(`🛡️ Seeded ${inspectionsData.length} QA/QC Inspections & BS 7671 witness tests.`);

// 9. Seed Active Tasks & Milestones
const scheduleTasks = [
  { title: 'RAMS Preparation & Wireman B License Submittal', trade: 'Management', wbs: '1.1', wp: 'wp-01', start: '2026-05-01', end: '2026-05-10', progress: 100, status: 'Completed' },
  { title: 'Site Mobilization, Scaffolding & Site Cleaning Protocol', trade: 'Management', wbs: '1.2', wp: 'wp-01', start: '2026-05-05', end: '2026-05-15', progress: 100, status: 'Completed' },
  { title: 'Dismantling of Redundant Lighting, Power & ELV Cabling', trade: 'Electrical', wbs: '2.1', wp: 'wp-03', start: '2026-05-12', end: '2026-05-28', progress: 100, status: 'Completed' },
  { title: 'Containment Installation - Galvanised Trays & PVC Conduits', trade: 'Containment', wbs: '3.1', wp: 'wp-03', start: '2026-05-20', end: '2026-06-25', progress: 75, status: 'In Progress' },
  { title: 'Distribution Panels UP0, DB1, DB2, UP1, UP2 Installation', trade: 'Electrical', wbs: '4.1', wp: 'wp-02', start: '2026-06-01', end: '2026-07-15', progress: 60, status: 'In Progress' },
  { title: 'Secondary Wiring & Re-installation of 10 Power Poles', trade: 'Electrical', wbs: '5.1', wp: 'wp-04', start: '2026-06-15', end: '2026-08-10', progress: 40, status: 'In Progress' },
  { title: 'Desk Combination Units GST 3-pin Flying Leads Hookup', trade: 'Electrical', wbs: '5.2', wp: 'wp-04', start: '2026-07-01', end: '2026-08-25', progress: 25, status: 'In Progress' },
  { title: 'Cat 6 Structured Cabling Pulling (3070m UTP, 400m FTP)', trade: 'ELV', wbs: '6.1', wp: 'wp-06', start: '2026-06-20', end: '2026-08-30', progress: 35, status: 'In Progress' },
  { title: 'Audio-Visual HDMI Distribution & 100V Sound System Installation', trade: 'ELV', wbs: '7.1', wp: 'wp-07', start: '2026-07-15', end: '2026-09-15', progress: 20, status: 'In Progress' },
  { title: 'LED Lighting Fixtures (Type A to I) Second Fix Installation', trade: 'Lighting', wbs: '8.1', wp: 'wp-05', start: '2026-08-01', end: '2026-10-15', progress: 10, status: 'Pending' },
  { title: 'UPS 20kVA Monolithic Delivery, Positioning & Battery Hookup', trade: 'Critical Power', wbs: '9.1', wp: 'wp-08', start: '2026-08-20', end: '2026-09-30', progress: 0, status: 'Pending' },
  { title: 'BS 7671 Statutory Testing, Snag Rectification & Client Handover', trade: 'Commissioning', wbs: '10.1', wp: 'wp-01', start: '2026-10-15', end: '2026-12-15', progress: 0, status: 'Pending' }
];

for (const t of scheduleTasks) {
  const taskId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO tasks (
      id, project_id, title, trade, assignee, start, end, progress,
      status, wbs_code, duration, is_summary, is_milestone, work_package_id,
      priority, completion_percent, description
    ) VALUES (
      ?, ?, ?, ?, 'Mark Borg', ?, ?, ?,
      ?, ?, 30, 0, 0, ?,
      'High', ?, ?
    )
  `).run(
    taskId,
    projectId,
    t.title,
    t.trade,
    t.start,
    t.end,
    t.progress,
    t.status,
    t.wbs,
    t.wp,
    t.progress,
    `Work package execution for ${t.title}`
  );
}
console.log(`📅 Created ${scheduleTasks.length} WBS schedule tasks.`);

// 10. Seed Committed Purchase Orders
const purchaseOrders = [
  { num: 'PO-2618-001', vendor: 'Schneider Electric Malta Ltd', trade: 'Electrical', desc: 'Isobar 4c RCBOs & 63A Incomer Disconnectors', amount: 8400, status: 'Approved', del: '2026-05-25' },
  { num: 'PO-2618-002', vendor: 'Prysmian Group / Megaturn', trade: 'Electrical', desc: 'H07Z-K, H07ZZ-F & CU/XLPE/LSZH multicore cables C04-C11', amount: 12600, status: 'Delivered', del: '2026-05-30' },
  { num: 'PO-2618-003', vendor: 'Philips Signify / Lightline Ltd', trade: 'Lighting', desc: 'LED Panels Type A (77 No), Downlights Type B-D, Emergency E1/E2', amount: 16800, status: 'Approved', del: '2026-06-20' },
  { num: 'PO-2618-004', vendor: 'Excel Networking / DataNet Ltd', trade: 'ELV', desc: 'Cat 6 U/UTP (3070m), F/UTP (400m), GOP boxes & patch panels', amount: 9200, status: 'Approved', del: '2026-06-15' },
  { num: 'PO-2618-005', vendor: 'Socomec / Critical Power Ltd', trade: 'Critical Power', desc: '20kVA Monolithic UPS with 10-min VRLA Battery Pack', amount: 7800, status: 'Pending', del: '2026-08-10' }
];

for (const po of purchaseOrders) {
  const poId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO purchase_orders (
      id, project_id, po_number, vendor, trade, description, amount,
      order_date, expected_delivery, status, expected_delivery_date
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      '2026-05-15', ?, ?, ?
    )
  `).run(
    poId,
    projectId,
    po.num,
    po.vendor,
    po.trade,
    po.desc,
    po.amount,
    po.del,
    po.status,
    po.del
  );
}
console.log(`📦 Seeded ${purchaseOrders.length} Committed Purchase Orders.`);

// 11. Seed Real Change Orders / Variations
const changeOrders = [
  { num: 'VAR-2618-001', title: 'Additional HDMI AOC Run to Boardroom Dual Display', trade: 'ELV', reason: 'Client requested direct 50m active optical HDMI connection between Level 1 Main Rack and Level 2 Boardroom', cost: 1850, days: 3, status: 'Approved' },
  { num: 'VAR-2618-002', title: 'Additional 4x Desk Combination Units for Executive Annex', trade: 'Electrical', reason: 'Architect floor layout revision added 4 workstations on Level 2', cost: 1240, days: 2, status: 'Approved' }
];

for (const co of changeOrders) {
  const coId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO change_orders (
      id, project_id, number, title, trade, reason, cost_impact,
      schedule_impact_days, date_raised, status, visibility, published_by, published_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, '2026-06-02', ?, 'public', 'Sarah Mifsud (QS)', ?
    )
  `).run(
    coId,
    projectId,
    co.num,
    co.title,
    co.trade,
    co.reason,
    co.cost,
    co.days,
    co.status,
    now
  );
}
console.log(`📝 Seeded ${changeOrders.length} Approved Change Orders.`);

// 12. Seed Punch List / Snags
const snags = [
  { item: 'Traffolyte label missing on Sub-Board UP1 isolator switch', trade: 'Electrical', loc: 'First Floor UPS Room', priority: 'Medium', status: 'Open' },
  { item: 'Conduit saddle spacing in corridor exceeds 1.25m specification limit', trade: 'Containment', loc: 'Second Floor Corridor', priority: 'High', status: 'Open' },
  { item: 'Replace scratched front door on Distribution Board DB2', trade: 'Electrical', loc: 'Second Floor DB Alcove', priority: 'Urgent', status: 'Open' }
];

for (const s of snags) {
  const sId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO punchlist (
      id, project_id, item, trade, location, priority, date_raised,
      status, contractor, description, floor
    ) VALUES (
      ?, ?, ?, ?, ?, ?, '2026-06-18',
      ?, 'Apex Electrical Contracting Ltd', ?, 'Level 1/2'
    )
  `).run(
    sId,
    projectId,
    s.item,
    s.trade,
    s.loc,
    s.priority,
    s.status,
    s.item
  );
}
console.log(`⚠️ Seeded ${snags.length} Quality Punch List items.`);

// 13. Seed Daily Site Logs & Workers
const workers = [
  { name: 'Mario Grech', trade: 'Electrician (Wireman B)', emp: 'EMP-01' },
  { name: 'Anthony Borg', trade: 'Electrician Apprentice', emp: 'EMP-02' },
  { name: 'Luca Farrugia', trade: 'Data & Cable Technician', emp: 'EMP-03' },
  { name: 'Christian Vella', trade: 'Containment Installer', emp: 'EMP-04' }
];

for (const w of workers) {
  const wId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO workers (
      id, project_id, site_id, name, employee_id, trade, employment_type,
      nationality, status, hired_date, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, 'Full-Time',
      'Maltese', 'Active', '2026-01-10', ?
    )
  `).run(
    wId,
    projectId,
    siteId,
    w.name,
    w.emp,
    w.trade,
    now
  );
}

const logId = crypto.randomUUID();
db.prepare(`
  INSERT INTO dailylogs (
    id, project_id, date, trade, weather, crew, notes, log_date,
    workers_count, work_performed, delays, safety_incidents
  ) VALUES (
    ?, ?, '2026-06-18', 'Electrical & ELV', 'Sunny 26°C', 'Apex Electrical Crew (4 technicians)',
    'Completed first fix conduit runs in corridor. Pulled Cat 6 cables to GOP box 3.',
    '2026-06-18', 4,
    'Installed 45m PVC conduit and terminated GST 3-pin leads under workstations 1 to 12.',
    'None', 'Zero incidents. Toolbox talk conducted on working at height.'
  )
`).run(
  logId,
  projectId
);
console.log('👷 Seeded Workforce and Daily Site Log.');

console.log('===============================================================');
console.log('🎉 MASTER SEEDING COMPLETE! BOV ST. VENERA IS 100% READY.');
console.log('===============================================================');
