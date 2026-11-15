/**
 * MEP FieldHub — Start-to-End Full Project Lifecycle & Every-Position E2E Verification
 * Exercises every role (Admin, ProjectManager, CommercialManager, SiteEngineer, QAQC,
 * SafetyOfficer, Consultant, Subcontractor, Client, Worker) from Organization & Project
 * creation through BOQ, Work Packages, RFIs, Submittals, Procurement, Site Receipt/Missing,
 * Auto-GRN Inventory Issue/Return, Workforce GPS/Allocations/Payroll Lock, Field Notes,
 * Batch Snag List Creator, QA/QC Inspections, NCRs, Commissioning, Client Portal & Handover.
 */

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const RUN = Date.now().toString().slice(-6);

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(cond: boolean, label: string, detail?: any) {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    const msg = detail ? `${label} -> ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : label;
    failures.push(msg);
    console.error(`  [FAIL] ${msg}`);
  }
}

async function apiReq(method: string, path: string, token?: string, body?: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

async function login(username: string, password: string): Promise<string> {
  const r = await apiReq('POST', '/api/login', undefined, { username, password });
  if (r.status !== 200 || !r.data?.token) {
    throw new Error(`Login failed for ${username}: ${r.status} ${JSON.stringify(r.data)}`);
  }
  return r.data.token;
}

async function main() {
  console.log('\n======================================================================');
  console.log('MEP FIELDHUB — START-TO-END PROJECT LIFECYCLE & ALL-POSITIONS AUDIT');
  console.log('======================================================================\n');

  // ── STAGE 0: Health, Bootstrap Admin, Project & Every Position Setup ──
  console.log('>>> Stage 0: Platform Health, Organization & All 10 Role Positions');
  const health = await apiReq('GET', '/api/health');
  check(health.status === 200 && health.data?.status === 'ok', 'GET /api/health returns 200 ok', health);

  const adminToken = await login('admin', 'ChangeMe123!');
  check(Boolean(adminToken), 'Admin authenticated');

  const orgRes = await apiReq('GET', '/api/organization', adminToken);
  check(orgRes.status === 200 && Boolean(orgRes.data?.organization?.name), 'Admin retrieves Organization profile', orgRes.data);

  const projRes = await apiReq('POST', '/api/projects', adminToken, {
    name: `Lifecycle Audit Tower ${RUN}`,
    client: 'Global Infrastructure Corp',
    location: 'London, UK',
    budget: 1500000,
    currency: 'EUR',
    tax_rate: 18,
    tax_label: 'VAT',
    retention_pct: 5,
    status: 'Active',
  });
  check(projRes.status === 200 || projRes.status === 201, 'Admin creates multi-currency/tax project', projRes.data);
  const projectId = projRes.data.id;

  const siteRes = await apiReq('POST', '/api/sites', adminToken, {
    project_id: projectId,
    name: `Tower North Site ${RUN}`,
    code: `TNS-${RUN}`,
    latitude: 51.5074,
    longitude: -0.1278,
    geofence_radius_m: 250,
    status: 'Active',
  });
  check(siteRes.status === 200 || siteRes.status === 201, 'Admin creates geofenced Project Site', siteRes.data);
  const siteId = siteRes.data.id;

  const compRes = await apiReq('POST', '/api/companies', adminToken, {
    name: `Apex HVAC Subcontractor ${RUN}`,
    type: 'Subcontractor',
    trade: 'HVAC',
  });
  check(compRes.status === 200 || compRes.status === 201, 'Admin creates Subcontractor company', compRes.data);
  const subCompanyId = compRes.data.id;

  const rolesToCreate = [
    { key: 'pm', role: 'ProjectManager', name: 'Lead PM' },
    { key: 'cm', role: 'CommercialManager', name: 'Lead Commercial' },
    { key: 'se', role: 'SiteEngineer', name: 'Lead Site Engineer' },
    { key: 'qa', role: 'QAQC', name: 'Lead QA/QC' },
    { key: 'so', role: 'SafetyOfficer', name: 'Lead Safety' },
    { key: 'con', role: 'Consultant', name: 'Lead Consultant' },
    { key: 'sub', role: 'Subcontractor', name: 'Apex Subcontractor', company_id: subCompanyId },
    { key: 'cli', role: 'Client', name: 'Client Rep' },
    { key: 'wrk', role: 'Worker', name: 'Field Technician' },
  ];

  const tokens: Record<string, string> = { admin: adminToken };
  const userIds: Record<string, string> = {};

  for (const r of rolesToCreate) {
    const uname = `e2e_${r.key}_${RUN}`;
    const pw = 'LifeCycle123!';
    const uRes = await apiReq('POST', '/api/users', adminToken, {
      username: uname,
      name: r.name,
      password: pw,
      role: r.role,
      company_id: r.company_id || null,
      project_ids: [projectId],
      status: 'Active',
    });
    check(uRes.status === 200 || uRes.status === 201, `Created ${r.role} user`, uRes.data);
    userIds[r.key] = uRes.data.id;
    tokens[r.key] = await login(uname, pw);
    check(Boolean(tokens[r.key]), `${r.role} logged in`);
  }

  // Worker profile + explicit site assignment + shift template
  const workerRes = await apiReq('POST', '/api/workers', adminToken, {
    user_id: userIds.wrk,
    project_id: projectId,
    site_id: siteId,
    name: 'Field Technician',
    trade: 'HVAC',
    employee_code: `EMP-${RUN}`,
    status: 'Active',
  });
  check(workerRes.status === 200 || workerRes.status === 201, 'Created Worker profile', workerRes.data);
  const workerId = workerRes.data.id;

  const assignRes = await apiReq('POST', '/api/worker_assignments', adminToken, {
    worker_id: workerId,
    project_id: projectId,
    site_id: siteId,
    status: 'Active',
  });
  check(assignRes.status === 200 || assignRes.status === 201, 'Assigned Worker to Project Site', assignRes.data);

  // ── STAGE 1: Commercial Baseline, BOQ, Work Packages & Schedule ──
  console.log('\n>>> Stage 1: BOQ, Work Packages, Tasks & Commercial RBAC');
  const seBoqForbidden = await apiReq('POST', '/api/boq', tokens.se, {
    project_id: projectId,
    item_number: 'M-01',
    description: 'Unauthorized BOQ',
    unit: 'Set',
    tender_quantity: 1,
    tender_rate: 1000,
  });
  check(seBoqForbidden.status === 403, 'SiteEngineer forbidden from creating BOQ items (403)', seBoqForbidden);

  const boqRes = await apiReq('POST', '/api/boq', tokens.cm, {
    project_id: projectId,
    item_number: 'M-HVAC-01',
    description: 'Rooftop AHU 25,000 CFM with VFD & BMS Controls',
    unit: 'Set',
    tender_quantity: 4,
    tender_rate: 25000,
    discipline: 'HVAC',
    system: 'Air Handling',
  });
  check(boqRes.status === 200 || boqRes.status === 201, 'CommercialManager creates BOQ line', boqRes.data);
  const boqId = boqRes.data.id;

  const wpCreate = await apiReq('POST', '/api/work_packages', tokens.pm, {
    project_id: projectId,
    code: `WP-HVAC-${RUN}`,
    name: 'HVAC Rooftop & Plantroom Package',
    discipline: 'HVAC',
    status: 'Active',
  });
  check(wpCreate.status === 200 || wpCreate.status === 201, 'ProjectManager creates HVAC Work Package', wpCreate.data);

  const wps = await apiReq('GET', `/api/work_packages?project_id=${projectId}`, tokens.pm);
  const hvacWp = Array.isArray(wps.data) ? (wps.data.find((w: any) => (w.discipline || w.name || '').toLowerCase().includes('hvac')) || wps.data[0]) : null;
  check(Boolean(hvacWp?.id), 'Work Package created and retrieved', hvacWp);

  if (hvacWp?.id) {
    const wpAssign = await apiReq('PUT', `/api/work_packages/${hvacWp.id}`, tokens.pm, {
      company_id: subCompanyId,
      status: 'Active',
    });
    check(wpAssign.status === 200, 'ProjectManager assigns Subcontractor company to Work Package', wpAssign.data);
  }

  const taskRes = await apiReq('POST', '/api/tasks', tokens.pm, {
    project_id: projectId,
    title: 'Install Rooftop AHU-01 to AHU-04',
    trade: 'HVAC',
    work_package_id: hvacWp?.id || null,
    boq_item_id: boqId,
    start_date: '2026-11-16',
    end_date: '2026-11-30',
    status: 'In Progress',
    progress: 10,
  });
  check(taskRes.status === 200 || taskRes.status === 201, 'ProjectManager creates scheduled Task', taskRes.data);
  const taskId = taskRes.data.id;

  // ── STAGE 2: Technical Engineering — Drawings, Submittals & RFIs ──
  console.log('\n>>> Stage 2: Drawings, Material Submittals & RFI Blocker Sync');
  const docRes = await apiReq('POST', '/api/documents', tokens.se, {
    project_id: projectId,
    name: 'M-HVAC-L2-001 Roof Plant Layout',
    document_number: `DOC-${RUN}`,
    category: 'Mechanical Drawing',
    revision: 'Rev A',
  });
  check(docRes.status === 200 || docRes.status === 201, 'SiteEngineer uploads engineering drawing', docRes.data);
  const docId = docRes.data.id;

  const subRes = await apiReq('POST', '/api/submittals', tokens.sub, {
    project_id: projectId,
    number: `SUB-${RUN}`,
    item: 'Eurovent Certified AHU Technical Data',
    trade: 'HVAC',
    status: 'Submitted',
  });
  check(subRes.status === 200 || subRes.status === 201, 'Subcontractor submits Material Submittal', subRes.data);

  const subApprove = await apiReq('PUT', `/api/submittals/${subRes.data.id}`, tokens.con, {
    status: 'Approved',
  });
  check(subApprove.status === 200 && subApprove.data?.status === 'Approved', 'Consultant approves Material Submittal', subApprove.data);

  const rfiRes = await apiReq('POST', '/api/rfis', tokens.se, {
    project_id: projectId,
    number: `RFI-${RUN}`,
    subject: 'Confirm AHU plinth structural curb height',
    trade: 'HVAC',
    drawing_id: docId,
    task_id: taskId,
    status: 'Open',
  });
  check(rfiRes.status === 200 || rfiRes.status === 201, 'SiteEngineer raises RFI linked to Drawing & Task', rfiRes.data);

  const rfiAns = await apiReq('PUT', `/api/rfis/${rfiRes.data.id}`, tokens.con, {
    status: 'Answered',
    answer: 'Maintain 300mm concrete plinth per structural detail S-104.',
  });
  check(rfiAns.status === 200 && rfiAns.data?.status === 'Answered', 'Consultant answers RFI', rfiAns.data);

  // ── STAGE 3: Procurement -> PO -> Site Receipt (Partial + Missing) -> Auto-GRN Inventory ──
  console.log('\n>>> Stage 3: Procurement, Site Material Receipt, Missing Shortage & Inventory');
  const mrRes = await apiReq('POST', '/api/material_requests', tokens.se, {
    project_id: projectId,
    boq_item_id: boqId,
    material: 'Rooftop AHU 25,000 CFM',
    specification: 'Eurovent certified, EC fans, VFD',
    discipline: 'HVAC',
    quantity: 4,
    unit: 'Set',
    status: 'Approved',
  });
  check(mrRes.status === 200 || mrRes.status === 201, 'SiteEngineer creates Material Request', mrRes.data);
  const mrId = mrRes.data.id;

  const poConv = await apiReq('POST', `/api/material_requests/${mrId}/create-po`, tokens.cm, {});
  check(poConv.status === 200 || poConv.status === 201, 'CommercialManager converts MR to Purchase Order', poConv.data);
  const poId = poConv.data?.purchase_order?.id || poConv.data?.po?.id || poConv.data?.id;
  check(Boolean(poId), 'Purchase Order ID returned', poConv.data);

  // Receive 3 out of 4, 1 missing!
  const recRes = await apiReq('POST', `/api/purchase_orders/${poId}/receive`, tokens.se, {
    ordered_quantity: 4,
    received_quantity: 3,
    missing_quantity: 1,
    storage_location: 'North Yard Store',
    delivery_note_ref: `DN-${RUN}`,
    discrepancy_reason: '1 AHU unit delayed at port customs',
    received_date: '2026-11-15',
  });
  check(recRes.status === 200 || recRes.status === 201, 'SiteEngineer logs partial Site Receipt & Missing unit', recRes.data);
  check(recRes.data?.status === 'Partial / Missing', 'PO status transitioned to Partial / Missing', recRes.data);

  const invRes = await apiReq('GET', `/api/inventory?project_id=${projectId}`, tokens.se);
  const invItem = (invRes.data || []).find((i: any) => String(i.material || '').includes('AHU'));
  check(invRes.status === 200 && Number(invItem?.current_stock) === 3, 'Auto-GRN created Inventory item with current_stock = 3', invItem);

  if (invItem?.id) {
    const issueRes = await apiReq('POST', `/api/inventory/${invItem.id}/issue`, tokens.se, {
      quantity: 2,
      work_package_id: hvacWp?.id || null,
      issued_to: 'HVAC Rigging Crew',
      notes: 'Lifted 2 AHUs to Roof Level',
    });
    check((issueRes.status === 200 || issueRes.status === 201) && Number(issueRes.data?.item?.current_stock ?? issueRes.data?.current_stock) === 1, 'Issued 2 units from Site Store -> current_stock = 1', issueRes.data);

    const retRes = await apiReq('POST', `/api/inventory/${invItem.id}/return`, tokens.se, {
      quantity: 1,
      notes: 'Returned 1 unit pending crane reschedule',
    });
    check((retRes.status === 200 || retRes.status === 201) && Number(retRes.data?.item?.current_stock ?? retRes.data?.current_stock) === 2, 'Returned 1 unit to Site Store -> current_stock = 2', retRes.data);
  }

  // ── STAGE 4: Workforce GPS Punch, Daily Log, Safety & Payroll Lock -> Costs ──
  console.log('\n>>> Stage 4: Workforce GPS Punch, Daily Log, Safety & Payroll Lock -> Cost Ledger');
  const punchIn = await apiReq('POST', '/api/attendance/gps-punch-in', tokens.wrk, {
    project_id: projectId,
    site_id: siteId,
    lat: 51.5074,
    lng: -0.1278,
    accuracy: 15,
  });
  check(punchIn.status === 200 || punchIn.status === 201, 'Worker punches in inside Site geofence', punchIn.data);

  const punchOut = await apiReq('POST', '/api/attendance/gps-punch-out', tokens.wrk, {
    project_id: projectId,
    site_id: siteId,
    lat: 51.5074,
    lng: -0.1278,
    accuracy: 15,
  });
  check(punchOut.status === 200, 'Worker punches out', punchOut.data);

  const dailyLog = await apiReq('POST', '/api/dailylogs', tokens.se, {
    project_id: projectId,
    date: '2026-11-15',
    trade: 'HVAC',
    weather: 'Clear',
    crew: 6,
    notes: 'Completed AHU-01 & AHU-02 rigging',
  });
  check(dailyLog.status === 200 || dailyLog.status === 201, 'SiteEngineer submits Daily Log', dailyLog.data);

  const safetyRes = await apiReq('POST', '/api/safety_incidents', tokens.so, {
    project_id: projectId,
    title: 'Missing guardrail near roof hatch',
    severity: 'Medium',
    date_reported: '2026-11-15',
    status: 'Open',
  });
  check(safetyRes.status === 200 || safetyRes.status === 201, 'SafetyOfficer logs Safety observation', safetyRes.data);

  const ppRes = await apiReq('POST', '/api/payroll_periods', adminToken, {
    project_id: projectId,
    name: `Nov 2026 Run ${RUN}`,
    start_date: '2026-11-01',
    end_date: '2026-11-30',
  });
  check(ppRes.status === 200 || ppRes.status === 201, 'Admin creates Payroll Period', ppRes.data);
  const ppId = ppRes.data.id;

  const lockRes = await apiReq('POST', `/api/payroll_periods/${ppId}/lock`, adminToken, {});
  check(lockRes.status === 200 && lockRes.data?.status === 'Locked', 'Admin locks Payroll Period (posts to Labor costs)', lockRes.data);

  // ── STAGE 5: Field Notes, Batch Snag List Creator, QA/QC Inspection & NCR ──
  console.log('\n>>> Stage 5: Field Note Taker, Batch Snag Creator, QA/QC Inspection & NCR');
  const noteRes = await apiReq('POST', '/api/field_notes', tokens.se, {
    project_id: projectId,
    title: 'AHU-01 condensate trap missing',
    body: 'Install 150mm deep seal U-trap on AHU-01 drain line.',
    category: 'Snag Draft',
    discipline: 'HVAC',
    zone_location: 'Roof Plant',
    priority: 'High',
  });
  check(noteRes.status === 201, 'SiteEngineer captures Field Note', noteRes.data);

  const convSnag = await apiReq('POST', `/api/field_notes/${noteRes.data.id}/convert-to-snag`, tokens.se, {});
  check(convSnag.status === 201 && convSnag.data?.note?.status === 'Converted to Snag', 'Field Note converted to official Snag item', convSnag.data);

  const batchSnag = await apiReq('POST', '/api/punchlist/batch', tokens.qa, {
    project_id: projectId,
    list_title: 'Roof Plant Walkdown',
    items: [
      { location: 'Roof Plant', trade: 'HVAC', item: 'Label chilled water isolation valves', priority: 'Medium' },
      { location: 'Roof Plant', trade: 'Electrical', item: 'Earth bond AHU-02 metallic frame', priority: 'High' },
    ],
  });
  check(batchSnag.status === 201 && batchSnag.data?.count === 2, 'QA/QC batch-creates 2 Snag List items', batchSnag.data);

  const snagId = convSnag.data?.punch_item?.id;
  if (snagId) {
    const qaRectify = await apiReq('PUT', `/api/punchlist/${snagId}`, tokens.qa, { status: 'Rectified' });
    check(qaRectify.status === 200 && qaRectify.data?.status === 'Rectified', 'QA/QC marks Snag item Rectified', qaRectify.data);
    const pmClose = await apiReq('PUT', `/api/punchlist/${snagId}`, tokens.pm, { status: 'Closed' });
    check(pmClose.status === 200 && pmClose.data?.status === 'Closed', 'ProjectManager closes Snag item', pmClose.data);
  }

  const inspRes = await apiReq('POST', '/api/inspections', tokens.qa, {
    project_id: projectId,
    number: `WIR-${RUN}`,
    type: 'WIR',
    element: 'AHU-01 & AHU-02 Installation',
    trade: 'HVAC',
    task_id: taskId,
    boq_item_id: boqId,
    inspector: 'Lead QA/QC',
    result: 'Passed',
    status: 'Passed',
  });
  check(inspRes.status === 200 || inspRes.status === 201, 'QA/QC passes Site Inspection (WIR)', inspRes.data);

  const ncrRes = await apiReq('POST', '/api/ncrs', tokens.qa, {
    project_id: projectId,
    number: `NCR-${RUN}`,
    title: 'Ductwork flange gasket missing on Supply Header',
    trade: 'HVAC',
    severity: 'Major',
    status: 'Open',
  });
  check(ncrRes.status === 200 || ncrRes.status === 201, 'QA/QC issues NCR', ncrRes.data);

  // ── STAGE 6: Commissioning, Handover & Client Portal Firewall ──
  console.log('\n>>> Stage 6: Testing & Commissioning, Handover & Client Portal Firewall');
  const commRes = await apiReq('POST', '/api/commissioning', tokens.qa, {
    project_id: projectId,
    system_name: 'AHU-01 Air Balancing & BMS Interlock',
    discipline: 'HVAC',
    test_type: 'Functional Performance Test',
    status: 'Passed',
    test_date: '2026-11-15',
  });
  check(commRes.status === 200 || commRes.status === 201, 'QA/QC records Passed Commissioning Test', commRes.data);

  const handRes = await apiReq('POST', '/api/handover', tokens.pm, {
    project_id: projectId,
    deliverable: 'HVAC O&M Manual & As-Built Dossier',
    discipline: 'HVAC',
    status: 'Submitted',
  });
  check(handRes.status === 200 || handRes.status === 201, 'ProjectManager logs Handover Deliverable', handRes.data);

  // Client firewall checks
  const cliUnpubDoc = await apiReq('GET', `/api/documents/${docId}`, tokens.cli);
  check(cliUnpubDoc.status === 403, 'Client blocked from unpublished internal Drawing (403)', cliUnpubDoc);

  const pubDoc = await apiReq('PUT', `/api/documents/${docId}`, tokens.pm, { visibility: 'Client' });
  check(pubDoc.status === 200 && pubDoc.data?.visibility === 'Client', 'ProjectManager publishes Drawing to Client Portal', pubDoc.data);

  const cliPubDocs = await apiReq('GET', `/api/documents?project_id=${projectId}`, tokens.cli);
  check(cliPubDocs.status === 200 && Array.isArray(cliPubDocs.data) && cliPubDocs.data.length === 1, 'Client sees ONLY published Drawing', cliPubDocs.data);

  const cliProj = await apiReq('GET', '/api/projects', tokens.cli);
  const myCliProj = (cliProj.data || []).find((p: any) => p.id === projectId);
  check(myCliProj && myCliProj.budget === undefined, 'Client /api/projects strips internal budget', myCliProj);

  console.log('\n======================================================================');
  console.log(`LIFECYCLE E2E AUDIT COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================================');
  if (failed > 0) {
    console.error('\nFailures:\n' + failures.map(f => ' - ' + f).join('\n'));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
