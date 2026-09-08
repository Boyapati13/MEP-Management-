import http from 'http';

interface RequestOptions {
  path: string;
  method?: string;
  body?: any;
  token?: string | null;
}

function req({ path, method = 'GET', body = null, token = null }: RequestOptions): Promise<{ status: number; body: any; headers: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(token ? { 'Authorization': 'Bearer ' + token } : {})
      }
    };
    const r = http.request(options, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(resBody);
        } catch {
          parsed = resBody;
        }
        resolve({ status: res.statusCode || 500, body: parsed, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, desc: string, detail?: any) {
  if (condition) {
    console.log(`  ✅ [PASS] ${desc}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${desc}`);
    if (detail) console.error('     Detail:', JSON.stringify(detail).slice(0, 300));
    failed++;
  }
}

async function runTests() {
  console.log('===============================================================');
  console.log('🏗️ MEP PROJECT MANAGEMENT SYSTEM - END-TO-END VERIFICATION SUITE');
  console.log('===============================================================\n');

  // --------------------------------------------------------------------------
  // TEST SECTION 1: AUTHENTICATION & MULTI-ROLE SECURITY
  // --------------------------------------------------------------------------
  console.log('👉 Section 1: Multi-Role Authentication & Access Control');
  
  const rolesToTest = [
    { username: 'admin', pass: 'admin123', expectedRole: 'Admin' },
    { username: 'pm_mep', pass: 'pm123', expectedRole: 'ProjectManager' },
    { username: 'engineer', pass: 'engineer123', expectedRole: 'SiteEngineer' },
    { username: 'qs_paul', pass: 'qs123', expectedRole: 'CommercialManager' },
    { username: 'qa_maria', pass: 'qa123', expectedRole: 'QAQC' },
    { username: 'safety_kurt', pass: 'safety123', expectedRole: 'SafetyOfficer' },
    { username: 'sub', pass: 'sub123', expectedRole: 'Subcontractor' },
    { username: 'consultant_eng', pass: 'consult123', expectedRole: 'Consultant' }
  ];

  const tokens: Record<string, string> = {};

  for (const r of rolesToTest) {
    const res = await req({ path: '/api/login', method: 'POST', body: { username: r.username, password: r.pass } });
    assert(res.status === 200 && res.body.role === r.expectedRole && !!res.body.token, `Login as ${r.username} (${r.expectedRole})`);
    if (res.body?.token) tokens[r.expectedRole] = res.body.token;
  }

  // Verify Invalid Credentials rejected
  const badLogin = await req({ path: '/api/login', method: 'POST', body: { username: 'admin', password: 'wrongpassword' } });
  assert(badLogin.status === 401, 'Reject unauthorized login attempt (401)');

  // Verify Non-Admin Forbidden from Users Administration
  const subUsersReq = await req({ path: '/api/users', token: tokens['Subcontractor'] });
  assert(subUsersReq.status === 403, 'Subcontractor forbidden from /api/users (403)');

  const engUsersReq = await req({ path: '/api/users', token: tokens['SiteEngineer'] });
  assert(engUsersReq.status === 403, 'Site Engineer forbidden from /api/users (403)');

  const adminUsersReq = await req({ path: '/api/users', token: tokens['Admin'] });
  assert(adminUsersReq.status === 200 && Array.isArray(adminUsersReq.body) && adminUsersReq.body.length >= 8, 'Admin allowed to list /api/users');

  // Verify Inactive Account Blocks Login
  // Create temporary test user
  const tempUsername = `temp_test_${Date.now()}`;
  const createTemp = await req({
    path: '/api/users',
    method: 'POST',
    token: tokens['Admin'],
    body: {
      username: tempUsername,
      name: 'Temp Inactive User',
      password: 'tempPassword123',
      role: 'SiteEngineer',
      status: 'Inactive'
    }
  });
  assert(createTemp.status === 201, 'Admin can create user with status Inactive');

  const inactiveLogin = await req({ path: '/api/login', method: 'POST', body: { username: tempUsername, password: 'tempPassword123' } });
  assert(inactiveLogin.status === 403, 'Inactive user login blocked with 403');

  // Reactivate user & test login
  const toggleRes = await req({ path: `/api/users/${createTemp.body.id}/toggle-status`, method: 'POST', token: tokens['Admin'] });
  assert(toggleRes.status === 200 && toggleRes.body.status === 'Active', 'Toggle user status back to Active');

  const activeLogin = await req({ path: '/api/login', method: 'POST', body: { username: tempUsername, password: 'tempPassword123' } });
  assert(activeLogin.status === 200, 'Reactivated user can now log in successfully');

  // Clean up temp user
  const delTemp = await req({ path: `/api/users/${createTemp.body.id}`, method: 'DELETE', token: tokens['Admin'] });
  assert(delTemp.status === 200, 'Admin can delete test user');

  // --------------------------------------------------------------------------
  // TEST SECTION 2: PROJECTS & RBAC SCOPING
  // --------------------------------------------------------------------------
  console.log('\n👉 Section 2: Projects & Scoped Data Visibility');
  const projRes = await req({ path: '/api/projects', token: tokens['Admin'] });
  assert(projRes.status === 200 && Array.isArray(projRes.body) && projRes.body.length >= 2, 'Admin retrieves all active projects');
  
  const projectId = projRes.body[0]?.id;
  const project2Id = projRes.body[1]?.id;

  // Subcontractor should only see their assigned project
  const subProjects = await req({ path: '/api/projects', token: tokens['Subcontractor'] });
  assert(subProjects.status === 200 && Array.isArray(subProjects.body) && subProjects.body.length === 1, 'Subcontractor strictly scoped to assigned project only');
  const subProjectId = subProjects.body[0]?.id;

  // Verify Subcontractor cannot create records on an unassigned project (Cross-Project Isolation)
  const unassignedSubmittal = await req({
    path: '/api/submittals',
    method: 'POST',
    token: tokens['Subcontractor'],
    body: {
      project_id: projectId, // Project they are NOT a member of
      number: 'MAT-ERR-01',
      title: 'Unauthorized Cross-Project Material',
      status: 'Submitted'
    }
  });
  assert(unassignedSubmittal.status === 403, 'Subcontractor forbidden from unassigned project (403 Isolation)');

  // --------------------------------------------------------------------------
  // TEST SECTION 3: WBS, CPM GANTT PROGRAMME & MILESTONES
  // --------------------------------------------------------------------------
  console.log('\n👉 Section 3: WBS, Schedule & CPM Gantt Engine');
  const tasksRes = await req({ path: `/api/tasks?project_id=${projectId}`, token: tokens['ProjectManager'] });
  assert(tasksRes.status === 200 && Array.isArray(tasksRes.body), 'Retrieve project tasks');

  // Create new MEP Installation task
  const newTaskRes = await req({
    path: '/api/tasks',
    method: 'POST',
    token: tokens['ProjectManager'],
    body: {
      project_id: projectId,
      title: 'L4 AHU Chilled Water Pipe Hydro-Test & Insulation',
      trade: 'HVAC',
      start_date: '2026-09-10',
      end_date: '2026-09-24',
      progress: 25,
      status: 'In Progress',
      assigned_to: 'CoolAir HVAC'
    }
  });
  assert(newTaskRes.status === 201 && newTaskRes.body.id, 'Project Manager creates critical MEP task');
  const testTaskId = newTaskRes.body?.id;

  // Update task progress
  const updateTaskRes = await req({
    path: `/api/tasks/${testTaskId}`,
    method: 'PUT',
    token: tokens['SiteEngineer'],
    body: { progress: 60, status: 'In Progress' }
  });
  assert(updateTaskRes.status === 200, 'Site Engineer updates task field progress to 60%');

  // --------------------------------------------------------------------------
  // TEST SECTION 4: DRAWINGS & PDF MARKUP ENGINE
  // --------------------------------------------------------------------------
  console.log('\n👉 Section 4: Engineering Drawings & Hand Markup Studio');
  const drawingsRes = await req({ path: `/api/drawings?project_id=${projectId}`, token: tokens['SiteEngineer'] });
  assert(drawingsRes.status === 200 && Array.isArray(drawingsRes.body), 'Fetch project drawings');

  const testDrawing = drawingsRes.body[0];
  if (testDrawing) {
    // Save hand markups layer
    const markupPayload = {
      markup_data: JSON.stringify({
        strokes: [
          { type: 'pen', color: '#ef4444', size: 3, points: [{ x: 120, y: 150 }, { x: 280, y: 190 }] },
          { type: 'cloud', color: '#3b82f6', size: 2, rect: { x: 300, y: 400, w: 180, h: 90 } }
        ],
        snags: [{ id: 'snag_1', x: 220, y: 310, text: 'Clash between 200mm dia duct and sprinkler pipe' }]
      })
    };
    const saveMarkup = await req({
      path: `/api/drawings/${testDrawing.id}/markups`,
      method: 'POST',
      token: tokens['SiteEngineer'],
      body: markupPayload
    });
    assert(saveMarkup.status === 200 && saveMarkup.body.ok, 'Save vector hand markup annotations to drawing');

    const getDrawingWithMarkup = await req({
      path: `/api/drawings/${testDrawing.id}`,
      token: tokens['QAQC']
    });
    assert(getDrawingWithMarkup.status === 200 && !!getDrawingWithMarkup.body.markup_data, 'QA/QC Lead retrieves saved drawing markups');
  }

  // --------------------------------------------------------------------------
  // TEST SECTION 5: RFIs & SUBMITTALS (ENGINEERING COORDINATION)
  // --------------------------------------------------------------------------
  console.log('\n👉 Section 5: Technical RFIs & Material Submittals');
  // Create RFI
  const newRfi = await req({
    path: '/api/rfis',
    method: 'POST',
    token: tokens['SiteEngineer'],
    body: {
      project_id: projectId,
      number: `RFI-MEP-${Date.now().toString().slice(-4)}`,
      subject: 'Cable Tray vs Stormwater Drainage Invert Elevation Conflict',
      trade: 'Electrical',
      discipline: 'Electrical',
      assigned_to: 'Consultant Lead',
      question: 'Drawing E-301 indicates 600mm cable tray invert at +3.20m, clashing with 150mm rainwater pipe at +3.18m. Request offset detail.',
      status: 'Open',
      priority: 'High'
    }
  });
  assert(newRfi.status === 201 && newRfi.body.id, 'Site Engineer creates technical coordination RFI');
  const rfiId = newRfi.body?.id;

  // Consultant answers RFI
  const ansRfi = await req({
    path: `/api/rfis/${rfiId}`,
    method: 'PUT',
    token: tokens['Consultant'],
    body: {
      answer: 'Route cable tray below pipe with 100mm clearance at +2.95m. Structural clearance verified.',
      status: 'Answered'
    }
  });
  assert(ansRfi.status === 200, 'Supervising Consultant provides formal engineering response');

  // Submittal Workflow on Subcontractor's assigned project
  const submittalRes = await req({
    path: '/api/submittals',
    method: 'POST',
    token: tokens['Subcontractor'],
    body: {
      project_id: subProjectId,
      number: `MAT-HVAC-${Date.now().toString().slice(-4)}`,
      title: 'Daikin Variable Refrigerant Volume (VRV) Outdoor Condensers',
      trade: 'HVAC',
      subcontractor: 'CoolAir HVAC',
      spec_section: '15700 - Heat Pumps',
      status: 'Submitted'
    }
  });
  assert(submittalRes.status === 201 && submittalRes.body.id, 'Trade Subcontractor submits material technical compliance submittal');
  const submittalId = submittalRes.body?.id;

  // Consultant approves submittal
  const approveSubmittal = await req({
    path: `/api/submittals/${submittalId}`,
    method: 'PUT',
    token: tokens['Consultant'],
    body: { status: 'Approved' }
  });
  assert(approveSubmittal.status === 200, 'Consultant review approves material submittal');

  // --------------------------------------------------------------------------
  // TEST SECTION 6: FLOOR PLAN SNAGGING & PUNCH LIST
  // --------------------------------------------------------------------------
  console.log('\n👉 Section 6: Floor Plan Snagging & Punch Lists');
  const punchRes = await req({
    path: '/api/punchlist',
    method: 'POST',
    token: tokens['QAQC'],
    body: {
      project_id: subProjectId,
      floor: 'Level 2 - Plant Room',
      x_percent: 42.5,
      y_percent: 68.2,
      trade: 'HVAC',
      contractor: 'CoolAir HVAC Ltd',
      description: 'Missing flexible connector & seismic spring isolator on chilled water pump discharge',
      priority: 'High',
      status: 'Open'
    }
  });
  assert(punchRes.status === 201 && punchRes.body.id, 'QA/QC Lead pins visual snag to floor plan');
  const punchId = punchRes.body?.id;

  // Subcontractor marks snag Rectified
  const fixPunch = await req({
    path: `/api/punchlist/${punchId}`,
    method: 'PUT',
    token: tokens['Subcontractor'],
    body: { status: 'Rectified' }
  });
  assert(fixPunch.status === 200, 'Subcontractor updates snag status to Rectified');

  // --------------------------------------------------------------------------
  // TEST SECTION 7: COMMERCIAL, BOQ, VALUATIONS & CHANGE ORDERS
  // --------------------------------------------------------------------------
  console.log('\n👉 Section 7: Commercial, BOQ, Valuations & Variation Claims');
  
  // Verify Site Engineer cannot manipulate BOQ (RBAC enforcement)
  const boqAsEngineer = await req({
    path: '/api/boq_items',
    method: 'POST',
    token: tokens['SiteEngineer'],
    body: { project_id: projectId, item_number: 'MEP-TEST-01', description: 'Unauthorized rate', total_price: 999999 }
  });
  assert(boqAsEngineer.status === 403, 'Site Engineer restricted from modifying BOQ items (403)');

  // Commercial Manager (QS) adds BOQ item
  const boqAsQs = await req({
    path: '/api/boq_items',
    method: 'POST',
    token: tokens['CommercialManager'],
    body: {
      project_id: projectId,
      item_number: `BOQ-EL-${Date.now().toString().slice(-4)}`,
      description: 'Supply & installation of 250A 4P Main Distribution Board (MDB-01)',
      trade: 'Electrical',
      unit: 'No.',
      quantity: 4,
      unit_rate: 6800.00,
      total_price: 27200.00,
      claimed_amount: 13600.00,
      status: 'In Progress'
    }
  });
  assert(boqAsQs.status === 201 && boqAsQs.body.id, 'Commercial Lead creates contract BOQ item');

  // Create Change Order (Variation)
  const coRes = await req({
    path: '/api/change_orders',
    method: 'POST',
    token: tokens['CommercialManager'],
    body: {
      project_id: projectId,
      number: `VO-MEP-${Date.now().toString().slice(-4)}`,
      title: 'Additional Kitchen Exhaust Scrubbers & Dedicated Fire Dampers',
      contractor: 'CoolAir HVAC',
      amount: 45200.00,
      days_impact: 8,
      status: 'Submitted'
    }
  });
  assert(coRes.status === 201 && coRes.body.id, 'Commercial Lead submits variation claim with time & cost impact');
  const coId = coRes.body?.id;

  // Project Manager approves Change Order
  const approveCo = await req({
    path: `/api/change_orders/${coId}`,
    method: 'PUT',
    token: tokens['ProjectManager'],
    body: { status: 'Approved' }
  });
  assert(approveCo.status === 200, 'Project Manager approves Variation Claim');

  // Purchase Order
  const poRes = await req({
    path: '/api/purchase_orders',
    method: 'POST',
    token: tokens['CommercialManager'],
    body: {
      project_id: projectId,
      po_number: `PO-MEP-${Date.now().toString().slice(-4)}`,
      supplier: 'Malta Electrical Supplies Ltd',
      amount: 18450.00,
      status: 'Issued'
    }
  });
  assert(poRes.status === 201 && poRes.body.id, 'Commercial Lead issues supplier Purchase Order');

  // --------------------------------------------------------------------------
  // TEST SECTION 8: SITE OPERATIONS, DAILY LOGS & SAFETY (HSE)
  // --------------------------------------------------------------------------
  console.log('\n👉 Section 8: Site Operations, Daily Logs & HSE Compliance');
  
  // Site Daily Log
  const logRes = await req({
    path: '/api/daily_logs',
    method: 'POST',
    token: tokens['SiteEngineer'],
    body: {
      project_id: projectId,
      log_date: new Date().toISOString().slice(0, 10),
      weather: 'Sunny 28°C',
      workers_count: 36,
      work_performed: 'Completed cable pulling for L3 distribution boards; pressure tested chilled water risers.',
      delays: 'None',
      safety_incidents: 'Zero incidents'
    }
  });
  assert(logRes.status === 201 && logRes.body.id, 'Site Engineer submits comprehensive Daily Site Report');

  // Safety Incident
  const safetyRes = await req({
    path: '/api/safety_incidents',
    method: 'POST',
    token: tokens['SafetyOfficer'],
    body: {
      project_id: projectId,
      incident_date: new Date().toISOString().slice(0, 10),
      severity: 'Medium',
      trade: 'Electrical',
      location: 'Level 2 Riser Shaft',
      description: 'Worker noticed frayed extension lead near water puddle. Work paused immediately.',
      root_cause: 'Damaged cable insulation from sharp duct edge',
      corrective_action: 'Lead tagged and removed from site; tool-box talk conducted on cable protection.'
    }
  });
  assert(safetyRes.status === 201 && safetyRes.body.id, 'Safety Officer logs near-miss & corrective safety action');

  // --------------------------------------------------------------------------
  // TEST SECTION 9: QUALITY ASSURANCE, NCRS & COMMISSIONING
  // --------------------------------------------------------------------------
  console.log('\n👉 Section 9: Quality NCRs & Commissioning Test Packs');
  
  // Non-Conformance Report (NCR)
  const ncrRes = await req({
    path: '/api/ncrs',
    method: 'POST',
    token: tokens['QAQC'],
    body: {
      project_id: projectId,
      number: `NCR-MEP-${Date.now().toString().slice(-4)}`,
      location: 'Basement 1 Pump Room',
      trade: 'Plumbing',
      responsible_party: 'AquaFlow Plumbing',
      description: 'Uncertified pressure relief valves installed on domestic hot water calorifiers.',
      target_date: '2026-09-18',
      status: 'Open'
    }
  });
  assert(ncrRes.status === 201 && ncrRes.body.id, 'QA/QC Lead issues formal Non-Conformance Notice (NCR)');
  const ncrId = ncrRes.body?.id;

  // Commissioning Test
  const commRes = await req({
    path: '/api/commissioning_tests',
    method: 'POST',
    token: tokens['QAQC'],
    body: {
      project_id: projectId,
      system: 'HVAC',
      subsystem: 'Smoke Extraction & Pressurization',
      equipment: 'Staircase Pressurization Fan SPF-01',
      test_type: 'Differential Pressure & Airflow Test',
      test_engineer: 'Maria Borg (QA/QC)',
      result: 'Passed - 52 Pa maintained against 50 Pa criteria',
      status: 'Completed'
    }
  });
  assert(commRes.status === 201 && commRes.body.id, 'Record witnessed MEP Commissioning & Balancing Test');

  // Handover & O&M
  const handoverRes = await req({
    path: '/api/handover_items',
    method: 'POST',
    token: tokens['QAQC'],
    body: {
      project_id: projectId,
      contractor: 'CoolAir HVAC',
      system: 'HVAC',
      item_type: 'O&M Manual',
      description: 'Operations & Maintenance Manual for Chilled Water Plant with As-Built schematics',
      due_date: '2026-10-01',
      status: 'Under Review'
    }
  });
  assert(handoverRes.status === 201 && handoverRes.body.id, 'Submit System Handover & O&M Manual documentation');

  // --------------------------------------------------------------------------
  // TEST SECTION 10: AI MEP ASSISTANT & AUDIT GOVERNANCE
  // --------------------------------------------------------------------------
  console.log('\n👉 Section 10: Server-Side AI MEP Assistant & Immutable Audit Log');
  
  // AI Assistant endpoint test
  const aiRes = await req({
    path: '/api/ai/chat',
    method: 'POST',
    token: tokens['Admin'],
    body: {
      message: 'What are the top 3 testing requirements before hydro-testing a chilled water pipe network?',
      context: { project_name: 'St. Julians Tower', trade: 'HVAC' }
    }
  });
  assert(aiRes.status === 200 && aiRes.body.reply && aiRes.body.reply.length > 20, 'Server-side Gemini AI MEP Engineering Advisor responds with technical insights');

  // Audit Log test
  const auditRes = await req({
    path: `/api/audit?project_id=${projectId}`,
    token: tokens['Admin']
  });
  assert(auditRes.status === 200 && Array.isArray(auditRes.body) && auditRes.body.length > 5, 'Audit trail immutably records all project actions');

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`📊 TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 ALL ENTERPRISE MEP MANAGEMENT TEST SCENARIOS PASSED WITH ZERO DEFECTS!');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
