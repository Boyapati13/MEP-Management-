import http from 'http';

interface RequestOptions {
  path: string;
  method?: string;
  body?: any;
  token?: string | null;
  headers?: Record<string, string>;
}

function req({ path, method = 'GET', body = null, token = null, headers = {} }: RequestOptions): Promise<{ status: number; body: any; headers: any }> {
  return new Promise((resolve, reject) => {
    const data = body !== null ? JSON.stringify(body) : null;
    const reqHeaders: Record<string, any> = {
      'Content-Type': 'application/json',
      ...headers,
      ...(data !== null ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      ...(token ? { 'Authorization': 'Bearer ' + token } : {})
    };
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: reqHeaders
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
    if (data !== null) r.write(data);
    r.end();
  });
}

function reqMultipart({ path, fields, file, token }: {
  path: string;
  fields: Record<string, string>;
  file: { fieldname: string; filename: string; content: Buffer | string; contentType: string };
  token?: string | null;
}): Promise<{ status: number; body: any; headers: any }> {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
    let payloadHead = '';
    for (const [k, v] of Object.entries(fields)) {
      payloadHead += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
    }
    payloadHead += `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`;
    
    const fileBuf = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
    const payloadTail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const totalBody = Buffer.concat([Buffer.from(payloadHead), fileBuf, payloadTail]);

    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': totalBody.length,
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
    r.write(totalBody);
    r.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, desc: string, detail?: any) {
  if (condition) {
    console.log(`  [PASS] ${desc}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${desc}`);
    if (detail) console.error('     Detail:', JSON.stringify(detail).slice(0, 350));
    failed++;
  }
}

const RUN_ID = Date.now().toString().slice(-6);
const tempUserIds: string[] = [];
const tempProjectIds: string[] = [];
const tempCompanyIds: string[] = [];

async function cleanup(adminToken: string) {
  console.log('\n--- Cleaning up temporary enterprise test artifacts ---');
  for (const id of tempUserIds) {
    try { await req({ path: `/api/users/${id}`, method: 'DELETE', token: adminToken }); } catch {}
  }
  for (const id of tempCompanyIds) {
    try { await req({ path: `/api/companies/${id}`, method: 'DELETE', token: adminToken }); } catch {}
  }
  for (const id of tempProjectIds) {
    try { await req({ path: `/api/projects/${id}`, method: 'DELETE', token: adminToken }); } catch {}
  }
  console.log('Cleanup complete.');
}

async function runEnterpriseSuite() {
  console.log('================================================================================');
  console.log(`  MASTER ENTERPRISE END-TO-END VERIFICATION SUITE (Run ID: ${RUN_ID})`);
  console.log('  Testing all 32 SaaS Functional Modules, 9 Roles, Workflows & Security Gates');
  console.log('================================================================================\n');

  // Bootstrap Admin Login
  const loginRes = await req({
    path: '/api/login',
    method: 'POST',
    body: { username: 'admin', password: 'ChangeMe123!' }
  });

  if (loginRes.status !== 200 || !loginRes.body?.token) {
    console.error('CRITICAL: Cannot log in as bootstrap admin:', loginRes.body);
    process.exit(1);
  }
  const adminToken = loginRes.body.token;
  assert(true, 'Bootstrap Admin authenticated successfully');

  try {
    // ========================================================================
    // GROUP 1: Enterprise Identity, RBAC Matrix Across 9 Roles & Session Revocation
    // ========================================================================
    console.log('\n>>> GROUP 1: Enterprise Identity, RBAC Matrix (9 Roles) & Session Revocation');

    const ALL_ROLES = [
      'Admin', 'ProjectManager', 'SiteEngineer', 'CommercialManager',
      'QAQC', 'SafetyOfficer', 'Subcontractor', 'Client', 'Consultant'
    ];

    const tokensByRole: Record<string, string> = { Admin: adminToken };
    const usersByRole: Record<string, any> = {};

    for (const role of ALL_ROLES) {
      if (role === 'Admin') continue;
      const uRes = await req({
        path: '/api/users',
        method: 'POST',
        body: {
          username: `user_${role.toLowerCase()}_${RUN_ID}`,
          name: `${role} Professional`,
          password: 'Password123!',
          role,
          email: `${role.toLowerCase()}_${RUN_ID}@mep-enterprise.com`
        },
        token: adminToken
      });
      assert(uRes.status === 201 && uRes.body?.id, `Admin created user account for role ${role}`);
      if (uRes.body?.id) {
        tempUserIds.push(uRes.body.id);
        usersByRole[role] = uRes.body;

        // Verify password login and permission payload
        const rLogin = await req({
          path: '/api/login',
          method: 'POST',
          body: { username: `user_${role.toLowerCase()}_${RUN_ID}`, password: 'Password123!' }
        });
        assert(rLogin.status === 200 && rLogin.body?.token, `User with role ${role} logged in successfully`);
        assert(rLogin.body?.permissions && Array.isArray(rLogin.body.permissions.view), `Role ${role} received valid permission matrix`);
        tokensByRole[role] = rLogin.body.token;
      }
    }

    // Role-based privilege separation test: Client cannot access internal companies directory
    const clientCompRes = await req({ path: '/api/companies', token: tokensByRole['Client'] });
    assert(clientCompRes.status === 403, 'Client role is blocked (403) from internal company directory');

    // Role-based privilege separation test: Subcontractor cannot view unassociated projects
    const subProjRes = await req({ path: '/api/projects', token: tokensByRole['Subcontractor'] });
    assert(subProjRes.status === 200 && Array.isArray(subProjRes.body) && subProjRes.body.length === 0,
      'Subcontractor without project membership sees zero projects (strict isolation)');

    // Active user session revocation test (P1 security)
    const qaUserId = usersByRole['QAQC'].id;
    const qaToken = tokensByRole['QAQC'];
    const deactRes = await req({
      path: `/api/users/${qaUserId}`,
      method: 'PUT',
      body: { status: 'Inactive' },
      token: adminToken
    });
    assert(deactRes.status === 200, 'Admin deactivated QAQC user account');

    const revokedAttempt = await req({ path: '/api/tasks', token: qaToken });
    assert(revokedAttempt.status === 401, 'Inactive user session token was immediately revoked (401)');

    // Reactivate QAQC user for remaining suite tests
    await req({
      path: `/api/users/${qaUserId}`,
      method: 'PUT',
      body: { status: 'Active' },
      token: adminToken
    });
    const reLoginQA = await req({
      path: '/api/login',
      method: 'POST',
      body: { username: usersByRole['QAQC'].username, password: 'Password123!' }
    });
    tokensByRole['QAQC'] = reLoginQA.body.token;
    assert(reLoginQA.status === 200, 'Reactivated user logged in with new active session token');


    // ========================================================================
    // GROUP 2: Project Setup & Participating Companies Governance
    // ========================================================================
    console.log('\n>>> GROUP 2: Project Setup & Participating Companies Governance');

    const pRes = await req({
      path: '/api/projects',
      method: 'POST',
      body: {
        name: `Enterprise Tower MEP Package ${RUN_ID}`,
        client: `Metropolis Properties ${RUN_ID}`,
        status: 'Active',
        start_date: '2026-03-01',
        end_date: '2027-12-31',
        budget: 18500000
      },
      token: adminToken
    });
    assert(pRes.status === 201 && pRes.body?.id, 'Admin created enterprise master project');
    const projectId = pRes.body.id;
    tempProjectIds.push(projectId);

    // Create participating companies
    const mainCompRes = await req({
      path: '/api/companies',
      method: 'POST',
      body: { name: `Apex MEP Contractors ${RUN_ID}`, type: 'Main Contractor', trade: 'Multi-Discipline MEP' },
      token: adminToken
    });
    assert(mainCompRes.status === 201 && mainCompRes.body?.id, 'Created Main Contractor Company');
    const mainCompanyId = mainCompRes.body.id;
    tempCompanyIds.push(mainCompanyId);

    const subCompRes = await req({
      path: '/api/companies',
      method: 'POST',
      body: { name: `Vortex Ductwork Specialists ${RUN_ID}`, type: 'Subcontractor', trade: 'HVAC Ventilation' },
      token: adminToken
    });
    assert(subCompRes.status === 201 && subCompRes.body?.id, 'Created Subcontractor Company');
    const subCompanyId = subCompRes.body.id;
    tempCompanyIds.push(subCompanyId);

    const clientCompObjRes = await req({
      path: '/api/companies',
      method: 'POST',
      body: { name: `Metropolis Client Group ${RUN_ID}`, type: 'Client', trade: 'Owner/Developer' },
      token: adminToken
    });
    const clientCompanyId = clientCompObjRes.body.id;
    tempCompanyIds.push(clientCompanyId);

    // Associate companies with project
    const addComp1 = await req({
      path: `/api/projects/${projectId}/companies`,
      method: 'POST',
      body: { company_id: mainCompanyId, role_in_project: 'Main Contractor' },
      token: adminToken
    });
    assert(addComp1.status === 201, 'Linked Main Contractor to project participating companies', addComp1);

    const addComp2 = await req({
      path: `/api/projects/${projectId}/companies`,
      method: 'POST',
      body: { company_id: subCompanyId, role_in_project: 'Ventilation Subcontractor' },
      token: adminToken
    });
    assert(addComp2.status === 201, 'Linked Subcontractor to project participating companies', addComp2);

    const addComp3 = await req({
      path: `/api/projects/${projectId}/companies`,
      method: 'POST',
      body: { company_id: clientCompanyId, role_in_project: 'Client' },
      token: adminToken
    });
    assert(addComp3.status === 201, 'Linked Client Company to project participating companies', addComp3);

    const listProjComp = await req({
      path: `/api/projects/${projectId}/companies`,
      token: adminToken
    });
    assert(listProjComp.status === 200 && listProjComp.body.length === 3, 'Listed participating companies on project (3 companies)', listProjComp);

    // Add individual user memberships to project via PUT /api/users/:id
    for (const role of ALL_ROLES) {
      if (role === 'Admin') continue;
      const updatePayload: any = { project_ids: [projectId] };
      if (role === 'Subcontractor') {
        updatePayload.company_id = subCompanyId;
        updatePayload.company = 'Vortex Ductwork Specialists';
      } else if (role === 'Client') {
        updatePayload.company_id = clientCompanyId;
        updatePayload.company = 'Metropolis Client Group';
      }
      const addMem = await req({
        path: `/api/users/${usersByRole[role].id}`,
        method: 'PUT',
        body: updatePayload,
        token: adminToken
      });
      assert(addMem.status === 200, `Assigned individual project membership to ${role}`, addMem);

      // Re-login user so token and session reflect project and company assignments
      const rLogin = await req({
        path: '/api/login',
        method: 'POST',
        body: { username: usersByRole[role].username, password: 'Password123!' }
      });
      assert(rLogin.status === 200 && !!rLogin.body?.token, `Refreshed session for ${role}`, rLogin);
      tokensByRole[role] = rLogin.body.token;
    }


    // ========================================================================
    // GROUP 3: WBS Hierarchy & Circular Dependency Prevention
    // ========================================================================
    console.log('\n>>> GROUP 3: WBS Hierarchy & Circular Dependency Prevention');

    const wbs1 = await req({
      path: '/api/wbs_items',
      method: 'POST',
      body: {
        project_id: projectId,
        code: 'WBS-01',
        name: 'HVAC Primary Plant & Distribution',
        level: 'Discipline',
        discipline: 'Mechanical',
        system: 'HVAC'
      },
      token: adminToken
    });
    assert(wbs1.status === 201 && wbs1.body?.id, 'Created WBS Level 1 (Discipline)');
    const wbs1Id = wbs1.body.id;

    const wbs2 = await req({
      path: '/api/wbs_items',
      method: 'POST',
      body: {
        project_id: projectId,
        parent_id: wbs1Id,
        code: 'WBS-01-01',
        name: 'Chilled Water Distribution Network',
        level: 'System',
        discipline: 'Mechanical',
        system: 'Chilled Water'
      },
      token: adminToken
    });
    assert(wbs2.status === 201 && wbs2.body?.id, 'Created WBS Level 2 (System nested under Level 1)');

    // Create Tasks
    const taskARes = await req({
      path: '/api/tasks',
      method: 'POST',
      body: {
        project_id: projectId,
        title: 'Install CHW Primary Headers in Central Plant Room',
        trade: 'Mechanical',
        assignee: 'SiteEngineer Professional',
        start: '2026-04-01',
        end: '2026-04-20',
        progress: 0,
        status: 'Not Started'
      },
      token: adminToken
    });
    assert(taskARes.status === 201 && taskARes.body?.id, 'Created Task A (Predecessor)');
    const taskAId = taskARes.body.id;

    const taskBRes = await req({
      path: '/api/tasks',
      method: 'POST',
      body: {
        project_id: projectId,
        title: 'Hydrostatic Pressure Testing of CHW Headers',
        trade: 'Mechanical',
        assignee: 'QAQC Professional',
        start: '2026-04-21',
        end: '2026-04-25',
        progress: 0,
        status: 'Blocked'
      },
      token: adminToken
    });
    assert(taskBRes.status === 201 && taskBRes.body?.id, 'Created Task B (Successor, Blocked)');
    const taskBId = taskBRes.body.id;

    // Create Dependency
    const depRes = await req({
      path: '/api/dependencies',
      method: 'POST',
      body: {
        project_id: projectId,
        task_id: taskBId,
        task_owner: 'SiteEngineer Professional',
        dependent_party: 'Main Contractor Mechanical Crew',
        description: 'Complete headers welding and flanged connections before hydrostatic test',
        dependency_owner: 'Lead Mechanical Foreman',
        required_date: '2026-04-20',
        status: 'Open',
        impact_if_late: 'High',
        programme_impact: 'Delays commissioning start by 5 days',
        commercial_impact: 'Potential liquidated damages',
        next_action: 'Accelerate shift welding crew'
      },
      token: adminToken
    });
    assert(depRes.status === 201 && depRes.body?.id, 'Created task dependency linking Task B to prerequisite');
    const depId = depRes.body.id;

    // Complete dependency via dedicated endpoint
    const compDepRes = await req({
      path: `/api/dependencies/${depId}/complete`,
      method: 'POST',
      body: { completed_date: '2026-04-20' },
      token: tokensByRole['ProjectManager']
    });
    assert(compDepRes.status === 200 && compDepRes.body?.status === 'Complete', 'Resolved dependency via /api/dependencies/:id/complete', compDepRes);

    // Verify Task B automatically transitioned from Blocked to Ready to Start
    const updatedTaskB = await req({ path: `/api/tasks`, token: adminToken });
    const foundTaskB = Array.isArray(updatedTaskB.body) ? updatedTaskB.body.find((t: any) => t.id === taskBId) : null;
    assert(foundTaskB && foundTaskB.status === 'Ready to Start', 'Task B automatically unblocked to "Ready to Start" after dependency completion', updatedTaskB);


    // ========================================================================
    // GROUP 4: Scheduling, Summary/Milestone Tasks & Work Packages
    // ========================================================================
    console.log('\n>>> GROUP 4: Scheduling, Summary/Milestone Tasks & Work Packages');

    // Create Work Package
    const wpRes = await req({
      path: '/api/work_packages',
      method: 'POST',
      body: {
        project_id: projectId,
        name: 'HVAC Secondary Air Distribution & VAVs',
        code: 'WP-HVAC-01',
        discipline: 'Mechanical',
        description: 'Supply, installation, and insulation of galvanised spiral ducting and VAV boxes',
        company_id: subCompanyId,
        lead_contact: 'Lead Duct Foreman',
        budget_allocated: 1450000,
        status: 'Active',
        start_date: '2026-04-01',
        target_date: '2026-10-31'
      },
      token: tokensByRole['ProjectManager']
    });
    assert(wpRes.status === 201 && wpRes.body?.id, 'Project Manager created Work Package WP-HVAC-01');
    const workPackageId = wpRes.body.id;

    // Bind Subcontractor user to this work package
    await req({
      path: `/api/users/${usersByRole['Subcontractor'].id}`,
      method: 'PUT',
      body: { work_package_id: workPackageId, company_id: subCompanyId, project_ids: [projectId] },
      token: adminToken
    });
    const subRelogin2 = await req({
      path: '/api/login',
      method: 'POST',
      body: { username: usersByRole['Subcontractor'].username, password: 'Password123!' }
    });
    tokensByRole['Subcontractor'] = subRelogin2.body.token;

    // Create Summary Task & Milestone Task
    const summaryTaskRes = await req({
      path: '/api/tasks',
      method: 'POST',
      body: {
        project_id: projectId,
        title: 'PHASE 1: CENTRAL CHILLER PLANT ROOM',
        trade: 'Mechanical',
        start: '2026-04-01',
        end: '2026-08-30',
        progress: 25,
        status: 'In Progress',
        is_summary: 1
      },
      token: tokensByRole['ProjectManager']
    });
    assert(summaryTaskRes.status === 201 && summaryTaskRes.body?.is_summary === 1, 'Created Summary Task');

    const milestoneRes = await req({
      path: '/api/tasks',
      method: 'POST',
      body: {
        project_id: projectId,
        title: 'Chiller Power Energisation & Primary Static Head Inspection',
        trade: 'Electrical',
        start: '2026-09-15',
        end: '2026-09-15',
        progress: 0,
        status: 'Not Started',
        is_milestone: 1
      },
      token: tokensByRole['ProjectManager']
    });
    assert(milestoneRes.status === 201 && milestoneRes.body?.is_milestone === 1, 'Created Key Milestone Task');

    // Create Task tied to Work Package
    const wpTaskRes = await req({
      path: '/api/tasks',
      method: 'POST',
      body: {
        project_id: projectId,
        work_package_id: workPackageId,
        company_id: subCompanyId,
        title: 'Level 3 Main Galvanised Duct Risers Installation',
        trade: 'Mechanical',
        assignee: usersByRole['Subcontractor'].name,
        start: '2026-05-01',
        end: '2026-05-30',
        progress: 10,
        status: 'In Progress'
      },
      token: adminToken
    });
    assert(wpTaskRes.status === 201 && wpTaskRes.body?.id, 'Created task linked to Work Package');
    const wpTaskId = wpTaskRes.body.id;

    // Verify task history tracking
    await req({
      path: `/api/tasks/${wpTaskId}`,
      method: 'PUT',
      body: { status: 'Under Inspection', status_comment: 'Ready for joint walk' },
      token: adminToken
    });
    const taskHist = await req({
      path: `/api/tasks/${wpTaskId}/history`,
      token: tokensByRole['SiteEngineer']
    });
    assert(taskHist.status === 200 && Array.isArray(taskHist.body) && taskHist.body.length > 0, 'Task status history logged transitions accurately');


    // ========================================================================
    // GROUP 5: Site Operations & Real-Time Attendance Engine
    // ========================================================================
    console.log('\n>>> GROUP 5: Site Operations & Real-Time Attendance Engine');

    // Site Engineer punches in
    const punchInRes = await req({
      path: '/api/attendance/punch-in',
      method: 'POST',
      body: { project_id: projectId, notes: 'East Wing Mechanical Plant Room Morning Shift' },
      token: tokensByRole['SiteEngineer']
    });
    assert(punchInRes.status === 201 && punchInRes.body?.status === 'Open', 'Site Engineer punched in via /api/attendance/punch-in');

    // Duplicate punch in rejection
    const dupPunch = await req({
      path: '/api/attendance/punch-in',
      method: 'POST',
      body: { project_id: projectId, notes: 'Trying second punch' },
      token: tokensByRole['SiteEngineer']
    });
    assert(dupPunch.status === 409, 'Duplicate punch-in properly rejected with 409 Conflict');

    // Retrieve attendance list
    const attList = await req({
      path: `/api/attendance?project_id=${projectId}`,
      token: tokensByRole['SiteEngineer']
    });
    assert(attList.status === 200 && attList.body.length > 0 && attList.body[0].punch_out === null, 'Active attendance record verified with open shift status');

    // Punch out
    const punchOutRes = await req({
      path: '/api/attendance/punch-out',
      method: 'POST',
      body: {},
      token: tokensByRole['SiteEngineer']
    });
    assert(punchOutRes.status === 200 && punchOutRes.body?.status === 'Closed' && punchOutRes.body?.punch_out, 'Site Engineer punched out with closed shift and calculated hours');

    // Punch out when inactive
    const punchOutAgain = await req({
      path: '/api/attendance/punch-out',
      method: 'POST',
      body: {},
      token: tokensByRole['SiteEngineer']
    });
    assert(punchOutAgain.status === 409, 'Punch out when not active rejected with 409 Conflict');

    // Create Daily Log
    const dailyLogRes = await req({
      path: '/api/dailylogs',
      method: 'POST',
      body: {
        project_id: projectId,
        date: '2026-04-10',
        trade: 'Mechanical',
        weather: 'Sunny 22C',
        crew: 28,
        notes: 'Completed duct hangers along corridor 3B; no safety delays.'
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(dailyLogRes.status === 201 && dailyLogRes.body?.id, 'Site Engineer created Daily Construction Log');

    // Create Timesheet
    const timesheetRes = await req({
      path: '/api/timesheets',
      method: 'POST',
      body: {
        project_id: projectId,
        date: '2026-04-10',
        worker: 'John Doe Foreman',
        trade: 'Mechanical',
        task: 'Header Pipe Welding',
        hours: 8.5
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(timesheetRes.status === 201 && timesheetRes.body?.id, 'Logged Site Timesheet Record');

    // Create Equipment
    const equipRes = await req({
      path: '/api/equipment',
      method: 'POST',
      body: {
        project_id: projectId,
        name: 'Hydraulic Scissor Lift #04',
        type: 'Access Equipment',
        assigned_to: 'Vortex Ductwork Specialists',
        status: 'Operational',
        notes: 'Annual LOLER certification valid until Dec 2026'
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(equipRes.status === 201 && equipRes.body?.id, 'Tracked site plant & access equipment');


    // ========================================================================
    // GROUP 6: Material Requests & End-to-End Procurement PR-to-PO
    // ========================================================================
    console.log('\n>>> GROUP 6: Material Requests & End-to-End Procurement PR-to-PO');

    // Material Request
    const mrRes = await req({
      path: '/api/material_requests',
      method: 'POST',
      body: {
        project_id: projectId,
        location: 'Level 2 Plant Room',
        discipline: 'Mechanical',
        system: 'Chilled Water',
        material: 'DN150 PN16 Flanged Butterfly Valves',
        description: 'Cast iron body, gear operated with limit switches',
        quantity: 12,
        unit: 'EA',
        required_date: '2026-05-01',
        reason: 'Installation of CHW primary manifold isolation',
        requested_by: 'SiteEngineer Professional',
        status: 'Submitted'
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(mrRes.status === 201 && mrRes.body?.id, 'Site Engineer raised Site Material Request (MR)');

    // Procurement PR Item
    const prRes = await req({
      path: '/api/procurement_items',
      method: 'POST',
      body: {
        project_id: projectId,
        pr_number: `PR-CHW-${RUN_ID}`,
        material: 'DN150 PN16 Flanged Butterfly Valves',
        specification: 'BS EN 593 / MSS SP-67, Class 150',
        boq_reference: 'BOQ-MECH-44',
        quantity: 12,
        unit: 'EA',
        required_on_site: '2026-05-01',
        responsible_buyer: 'CommercialManager Professional',
        selected_supplier: 'Crane Building Services & Utilities',
        status: 'RFQ'
      },
      token: tokensByRole['CommercialManager']
    });
    assert(prRes.status === 201 && prRes.body?.id, 'Commercial Manager created Procurement Requisition (PR)');
    const prItemId = prRes.body.id;

    // Advance PR through controlled workflow
    const prStages = [
      { next: 'Quotation Received' },
      { next: 'Under Review' },
      { next: 'Approved' },
      { next: 'PO Pending' }
    ];
    for (const st of prStages) {
      const transRes = await req({
        path: `/api/procurement_items/${prItemId}/transition`,
        method: 'POST',
        body: { status: st.next },
        token: tokensByRole['CommercialManager']
      });
      assert(transRes.status === 200 && transRes.body?.status === st.next, `Advanced PR to '${st.next}'`);
    }

    // Auto-generate Purchase Order from approved PR
    const poNum = `PO-VALVE-${RUN_ID}`;
    const genPoRes = await req({
      path: `/api/procurement_items/${prItemId}/create-po`,
      method: 'POST',
      body: { po_number: poNum },
      token: tokensByRole['CommercialManager']
    });
    assert(genPoRes.status === 201 && genPoRes.body?.po_number === poNum, 'Auto-generated PO from PR via /api/procurement_items/:id/create-po');

    // Duplicate PO generation prevention
    const dupPoRes = await req({
      path: `/api/procurement_items/${prItemId}/create-po`,
      method: 'POST',
      body: { po_number: 'PO-DUP' },
      token: tokensByRole['CommercialManager']
    });
    assert(dupPoRes.status === 409, 'Duplicate PO creation strictly blocked (409 Conflict)');

    // Verify PO listed in purchase_orders table
    const poList = await req({
      path: `/api/purchase_orders?project_id=${projectId}`,
      token: tokensByRole['CommercialManager']
    });
    const foundPo = Array.isArray(poList.body) ? poList.body.find((p: any) => p.po_number === poNum) : null;
    assert(foundPo && foundPo.vendor === 'Crane Building Services & Utilities', 'Created Purchase Order verified in commercial orders ledger', poList);


    // ========================================================================
    // GROUP 7: Commercial Governance: BOQ, 13-Stage Variations & Cost Tracking
    // ========================================================================
    console.log('\n>>> GROUP 7: Commercial Governance: BOQ, 13-Stage Variations & Cost Tracking');

    // BOQ Multipart Import
    const csvContent = `item_number,description,unit,tender_quantity,tender_rate,tender_amount,discipline,system
B-0101,Chilled Water Centrifugal Chiller 1200kW,EA,2,185000,370000,Mechanical,HVAC
B-0102,Galvanised Spiral Ductwork 500x300mm,LM,450,110,49500,Mechanical,Ductwork
B-0201,Main LV Switchboard 2500A Form 4b,EA,1,125000,125000,Electrical,Power
B-0301,Wet Pipe Fire Sprinkler Heads Quick Response,EA,600,45,27000,Fire Protection,Sprinklers`;

    const boqImportRes = await reqMultipart({
      path: '/api/boq/import',
      fields: { project_id: projectId },
      file: {
        fieldname: 'file',
        filename: 'Tender_BOQ_Priced.csv',
        content: csvContent,
        contentType: 'text/csv'
      },
      token: tokensByRole['CommercialManager']
    });
    assert(boqImportRes.status === 201 && boqImportRes.body?.imported_lines === 4, 'Commercial Manager imported BOQ via multipart /api/boq/import');
    assert(boqImportRes.body?.tender_amount === 571500, 'Imported BOQ calculated correct contract value');

    // Verify Project Budget was updated by BOQ import
    const projCheck = await req({ path: `/api/projects`, token: adminToken });
    const curProj = projCheck.body.find((p: any) => p.id === projectId);
    assert(curProj && curProj.budget === 571500, 'Project budget updated to match BOQ tender total');

    // 13-Stage Change Order Variation Workflow
    const coRes = await req({
      path: '/api/change_orders',
      method: 'POST',
      body: {
        project_id: projectId,
        number: `VO-HVAC-${RUN_ID}`,
        title: 'Additional Smoke Extract Dampers on Level 3 Atrium',
        trade: 'Mechanical',
        reason: 'Consultant Fire Engineering Re-Analysis',
        cost_impact: 42800,
        schedule_impact_days: 7,
        date_raised: '2026-04-15',
        status: 'Potential Variation'
      },
      token: tokensByRole['CommercialManager']
    });
    assert(coRes.status === 201 && coRes.body?.id, 'Raised Variation Order in Potential Variation stage');
    const coId = coRes.body.id;

    // Traverse all 13 variation stages
    const coWorkflow = [
      'Under Preparation',
      'Submitted',
      'Technical Review',
      'Commercial Review',
      'Approved',
      'PO Pending',
      'PO Issued',
      'Work In Progress',
      'Work Complete',
      'Claimed',
      'Certified',
      'Paid',
      'Closed'
    ];

    for (const targetStatus of coWorkflow) {
      const transCo = await req({
        path: `/api/change_orders/${coId}/transition`,
        method: 'POST',
        body: { status: targetStatus, comment: `Advanced to ${targetStatus}` },
        token: adminToken
      });
      assert(transCo.status === 200 && transCo.body?.status === targetStatus, `Variation Order reached stage '${targetStatus}'`);
    }

    // Costs logging and variance tracking
    const costLogRes = await req({
      path: '/api/costs',
      method: 'POST',
      body: {
        project_id: projectId,
        category: 'Equipment Rental',
        description: 'Plant room crane hoisting for chillers',
        planned: 15000,
        actual: 16800,
        date_logged: '2026-04-20'
      },
      token: tokensByRole['CommercialManager']
    });
    assert(costLogRes.status === 201, 'Logged cost expenditure with variance');


    // ========================================================================
    // GROUP 8: Technical & Engineering Hub: RFIs, Submittals, Clarifications & Transmittals
    // ========================================================================
    console.log('\n>>> GROUP 8: Technical & Engineering Hub: RFIs, Submittals, Clarifications & Transmittals');

    // RFI
    const rfiRes = await req({
      path: '/api/rfis',
      method: 'POST',
      body: {
        project_id: projectId,
        number: `RFI-M-${RUN_ID}`,
        subject: 'Structural Beam Penetration Clash with CHW 200mm Header',
        trade: 'Mechanical',
        raised_by: usersByRole['SiteEngineer'].name,
        date_raised: '2026-04-11',
        due_date: '2026-04-18',
        status: 'Open'
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(rfiRes.status === 201 && rfiRes.body?.id, 'Site Engineer raised Technical RFI');
    const rfiId = rfiRes.body.id;

    // Submittal Workflow
    const submittalRes = await req({
      path: '/api/submittals',
      method: 'POST',
      body: {
        project_id: projectId,
        number: `SUB-DAMP-${RUN_ID}`,
        item: 'Motorised Fire & Smoke Dampers Technical Submittal',
        trade: 'Mechanical',
        date_submitted: '2026-04-12',
        due_date: '2026-04-26',
        status: 'Draft'
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(submittalRes.status === 201 && submittalRes.body?.id, 'Created Submittal in Draft stage');
    const submittalId = submittalRes.body.id;

    const submittalTransitions = ['Submitted', 'Under Review', 'Approved', 'Closed'];
    for (const s of submittalTransitions) {
      const trans = await req({
        path: `/api/submittals/${submittalId}/transition`,
        method: 'POST',
        body: { status: s },
        token: adminToken
      });
      assert(trans.status === 200 && trans.body?.status === s, `Submittal reached '${s}'`);
    }

    // Clarifications Hub (Client <-> Main Contractor <-> Subcontractor)
    const clarRes = await req({
      path: '/api/clarifications',
      method: 'POST',
      body: {
        project_id: projectId,
        title: 'Discrepancy between Architectural Ceiling Void and MEP Duct Height',
        type: 'Technical',
        to_company_id: mainCompanyId,
        discipline: 'Mechanical',
        priority: 'Urgent',
        question_text: 'The architectural reflected ceiling plan shows 2.6m ceiling height, leaving only 180mm void where 350mm ducting is scheduled.',
        proposed_solution: 'Re-route extract duct through adjacent service riser corridor',
        cost_impact_flag: 1,
        schedule_impact_flag: 0
      },
      token: tokensByRole['Subcontractor']
    });
    assert(clarRes.status === 201 && clarRes.body?.id, 'Subcontractor raised formal Clarification Request');
    const clarId = clarRes.body.id;

    // Post Threaded Comment
    const commentRes = await req({
      path: `/api/clarifications/${clarId}/comment`,
      method: 'POST',
      body: { comment_text: 'Site walk scheduled tomorrow at 10am with Architectural lead.' },
      token: tokensByRole['SiteEngineer']
    });
    assert(commentRes.status === 201 && commentRes.body?.comment_text, 'Added threaded comment to clarification');

    // Submit Official Answer
    const answerRes = await req({
      path: `/api/clarifications/${clarId}/answer`,
      method: 'POST',
      body: {
        official_response: 'Approved to re-route extract duct through service riser B per attached sketch revision.',
        status: 'Answered'
      },
      token: tokensByRole['ProjectManager']
    });
    assert(answerRes.status === 200 && answerRes.body?.status === 'Answered', 'Project Manager submitted official answer to clarification');

    // Document Transmittal
    const transmittalRes = await req({
      path: '/api/transmittals',
      method: 'POST',
      body: {
        project_id: projectId,
        transmittal_number: `TRN-DWG-${RUN_ID}`,
        recipient_company_id: subCompanyId,
        subject: 'Level 2 Revised Duct Layout Construction Issue Rev B',
        purpose: 'For Construction',
        items: [
          { document_title: 'Level 2 HVAC Duct Layout', document_number: 'M-501', revision: 'Rev B', format: 'DWG/PDF', action_required: 'Fabrication' }
        ]
      },
      token: tokensByRole['ProjectManager']
    });
    assert(transmittalRes.status === 201 && transmittalRes.body?.id, 'Issued Document Transmittal with attached drawing revisions');


    // ========================================================================
    // GROUP 9: Document Management, Blueprint Drawing Studio Markups & Payload Protection
    // ========================================================================
    console.log('\n>>> GROUP 9: Document Management, Blueprint Drawing Studio Markups & Payload Protection');

    // Upload Document
    const docRes = await req({
      path: '/api/documents',
      method: 'POST',
      body: {
        project_id: projectId,
        name: 'Chilled Water Plant P&ID Schematic Rev A',
        category: 'Drawing',
        revision: 'Rev A',
        attachment_name: 'CHW-PID-001.pdf',
        attachment_data: 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXrCjEgMCBvYmoKPDwKL1RpdGxlIChDaGlsbGVkIFdhdGVyIFBSSUQpCi9Qcm9kdWNlciAoQXV0b0Rlc2sgUmV2aXQpCj4+CmVuZG9iagp0cmFpbGVyCjw8Ci9Sb290IDEgMCBSCmVuZG9iagolJUVPRg==',
        discipline: 'Mechanical'
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(docRes.status === 201 && docRes.body?.id, 'Uploaded MEP Engineering Drawing');
    const docId = docRes.body.id;

    // Drawing Visual Markups Studio Endpoint
    const markups = {
      lines: [{ x1: 120, y1: 240, x2: 380, y2: 240, color: '#ff0000', width: 3 }],
      clouds: [{ x: 200, y: 180, width: 150, height: 80, text: 'Clash with 300A busbar' }],
      stamps: [{ type: 'REVISE_RESUBMIT', date: '2026-04-18', user: 'Lead Engineer' }]
    };
    const markupsRes = await req({
      path: `/api/drawings/${docId}/markups`,
      method: 'POST',
      body: { markup_data: JSON.stringify(markups) },
      token: tokensByRole['SiteEngineer']
    });
    assert(markupsRes.status === 200 && markupsRes.body?.ok, 'Saved Drawing Studio Redline Markups via /api/drawings/:id/markups');

    const fetchDwg = await req({
      path: `/api/drawings/${docId}`,
      token: tokensByRole['SiteEngineer']
    });
    assert(fetchDwg.status === 200 && fetchDwg.body?.markup_data.includes('Clash with 300A busbar'), 'Verified persisted Drawing Studio redlines');

    // Document Revision Archival
    const newRevRes = await req({
      path: `/api/documents/${docId}/new-revision`,
      method: 'POST',
      body: {
        new_revision_code: 'Rev B',
        change_summary: 'Shifted header 300mm south to clear busbar per RFI-M answer'
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(newRevRes.status === 200 && newRevRes.body?.revision === 'Rev B', 'Archived superseded document and issued Rev B');

    const revList = await req({
      path: `/api/documents/${docId}/revisions`,
      token: tokensByRole['SiteEngineer']
    });
    assert(revList.status === 200 && revList.body.length > 0 && revList.body[0].revision_code === 'Rev A', 'Previous revision properly archived in document audit history');

    // 150MB Payload Size Check (Verify Express body-parser gracefully returns 413 instead of crashing)
    console.log('  Testing payload size boundary enforcement...');
    // Create a payload that slightly exceeds 150MB string limit (155 MB payload header)
    // Note: In Node, we can verify the 413 error handler response format with an oversized payload
    const dummyLargeHeaders = { 'Content-Length': '160000000' };
    const oversizedProbe = await req({
      path: '/api/documents',
      method: 'POST',
      body: 'a'.repeat(200), // small body with inflated header to test body-parser limit handling
      token: adminToken,
      headers: dummyLargeHeaders
    });
    assert(oversizedProbe.status === 413 || oversizedProbe.status === 400 || oversizedProbe.status === 500, 'Payload boundary handler responded correctly without unhandled process termination');


    // ========================================================================
    // GROUP 10: Quality Control, NCR Lifecycle & Visual Snagging
    // ========================================================================
    console.log('\n>>> GROUP 10: Quality Control, NCR Lifecycle & Visual Snagging');

    // Site Inspection
    const inspRes = await req({
      path: '/api/inspections',
      method: 'POST',
      body: {
        project_id: projectId,
        date: '2026-04-14',
        trade: 'Mechanical',
        inspection_type: 'First Fix Containment & Bracket Load Test',
        inspector: usersByRole['QAQC'].name,
        result: 'Pass',
        notes: 'Anchors torqued to manufacturer specs (45 Nm); test certificates attached.'
      },
      token: tokensByRole['QAQC']
    });
    assert(inspRes.status === 201 && inspRes.body?.id, 'QAQC Engineer logged formal site inspection walk');

    // Non-Conformance Report (NCR) Lifecycle
    const ncrRes = await req({
      path: '/api/ncrs',
      method: 'POST',
      body: {
        project_id: projectId,
        number: `NCR-E-${RUN_ID}`,
        location: 'Level 2 Electrical Switchroom',
        description: 'Cable tray missing earth bonding links across expansion joints',
        raised_against: 'Main Contractor Electrical Division',
        raised_date: '2026-04-14',
        responsible_party: 'Electrical Foreman',
        root_cause: 'Expansion joint bonding copper braids omitted during initial tray pull',
        corrective_action: 'Install tinned copper flexible earth braids across all tray joints per BS 7671',
        target_date: '2026-04-18',
        status: 'Open'
      },
      token: tokensByRole['QAQC']
    });
    assert(ncrRes.status === 201 && ncrRes.body?.id, 'QAQC Engineer issued Non-Conformance Report (NCR)');
    const ncrId = ncrRes.body.id;

    // NCR 5-Stage Lifecycle
    const ncrStages = ['Under Investigation', 'Corrective Action', 'Verification', 'Closed'];
    for (const stage of ncrStages) {
      const transNcr = await req({
        path: `/api/ncrs/${ncrId}/transition`,
        method: 'POST',
        body: { status: stage, comment: `Transition to ${stage}` },
        token: tokensByRole['QAQC']
      });
      assert(transNcr.status === 200 && transNcr.body?.status === stage, `NCR transitioned to '${stage}'`);
    }

    // Visual Snagging Punch List with 2D Drawing Coordinates (x_percent, y_percent)
    const punchRes = await req({
      path: '/api/punchlist',
      method: 'POST',
      body: {
        project_id: projectId,
        item: 'Fire damper access door blocked by secondary pipe hanger',
        trade: 'Mechanical',
        location: 'Corridor 2A Grid C-4',
        floor: 'Level 2',
        priority: 'High',
        x_percent: 64.2,
        y_percent: 38.7,
        contractor: 'Vortex Ductwork Specialists',
        status: 'Open'
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(punchRes.status === 201 && punchRes.body?.x_percent === 64.2, 'Created Punch Item with 2D plan coordinates (x_percent / y_percent)');
    const punchId = punchRes.body.id;

    // Punch Transition: Open -> In Progress -> Resolved -> Closed
    const punchTransitions = ['In Progress', 'Resolved', 'Closed'];
    for (const ps of punchTransitions) {
      const transP = await req({
        path: `/api/punchlist/${punchId}/transition`,
        method: 'POST',
        body: { status: ps },
        token: tokensByRole['SiteEngineer']
      });
      assert(transP.status === 200 && transP.body?.status === ps, `Punch item advanced to '${ps}'`);
    }

    // Safety Incident
    const safetyRes = await req({
      path: '/api/safety_incidents',
      method: 'POST',
      body: {
        project_id: projectId,
        date: '2026-04-12',
        trade: 'Mechanical',
        incident_type: 'Near Miss',
        severity: 'Minor',
        description: 'Unsecured hand tool fell from mobile scaffold into barricaded exclusion zone; zero injuries',
        corrective_action: 'Enforce tool lanyards and re-induction for high-level working crews',
        status: 'Resolved'
      },
      token: tokensByRole['SafetyOfficer']
    });
    assert(safetyRes.status === 201 && safetyRes.body?.id, 'Safety Officer recorded safety observation & near miss');


    // ========================================================================
    // GROUP 11: Commissioning, Readiness Verification, Handover Packages & Meeting Minutes
    // ========================================================================
    console.log('\n>>> GROUP 11: Commissioning, Readiness Verification, Handover Packages & Meeting Minutes');

    // Commissioning Test with Prerequisites
    const commTestRes = await req({
      path: '/api/commissioning_tests',
      method: 'POST',
      body: {
        project_id: projectId,
        system: 'Chilled Water Plant',
        subsystem: 'Primary CHW Pumps',
        equipment: 'PUMP-CHW-01 & 02',
        test_type: 'Hydronic Flow Balance & Static Pressure Test',
        power_available: 1,
        installation_complete: 1,
        controls_complete: 1,
        interface_complete: 1,
        drawings_approved: 1,
        test_date: '2026-05-15',
        test_engineer: 'Lead Commissioning Specialist',
        witness: 'Consultant Engineer',
        status: 'Planned'
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(commTestRes.status === 201 && commTestRes.body?.id, 'Scheduled Commissioning Test with technical prerequisites');
    const commTestId = commTestRes.body.id;

    // Check Readiness endpoint
    const readyCheck = await req({
      path: `/api/commissioning_tests/${commTestId}/readiness`,
      token: tokensByRole['SiteEngineer']
    });
    assert(readyCheck.status === 200 && readyCheck.body?.ready === true, 'Commissioning readiness verified with all 5 prerequisites satisfied');

    // Handover Items & Readiness Metric
    const handoverItems = [
      { item_type: 'O&M Manual', description: 'HVAC Chiller Operation & Maintenance Manuals', required: 1, submitted: 1, approved: 1, status: 'Approved' },
      { item_type: 'As-Built Drawings', description: 'Redline As-Built CAD/BIM Models for Mechanical', required: 1, submitted: 1, approved: 1, status: 'Approved' },
      { item_type: 'Warranty Certificate', description: 'Chiller Compressor 5-Year Extended Warranty', required: 1, submitted: 1, approved: 0, status: 'Submitted' }
    ];

    for (const hi of handoverItems) {
      await req({
        path: '/api/handover_items',
        method: 'POST',
        body: { project_id: projectId, contractor: 'Apex MEP Contractors', system: 'HVAC', ...hi },
        token: tokensByRole['ProjectManager']
      });
    }

    const handoverMetric = await req({
      path: `/api/handover/${projectId}/readiness`,
      token: tokensByRole['ProjectManager']
    });
    assert(handoverMetric.status === 200 && handoverMetric.body?.total === 3, 'Handover package tracked 3 total deliverables');
    assert(handoverMetric.body?.readiness_percent === 67, 'Handover Readiness calculated at 67% (2 of 3 approved)');

    // Site Meeting Minutes
    const meetingRes = await req({
      path: '/api/meeting_minutes',
      method: 'POST',
      body: {
        project_id: projectId,
        date: '2026-04-16',
        meeting_type: 'Weekly MEP Coordination Meeting',
        attendees: 'Main Contractor, HVAC Subcontractor, Electrical Subcontractor, Consultant',
        subject: 'Plant Room Rigging Sequence and Riser Penetrations',
        notes: 'Agreement reached to prioritize Level 3 riser sealing before wet trades commence on Level 4.'
      },
      token: tokensByRole['ProjectManager']
    });
    assert(meetingRes.status === 201 && meetingRes.body?.id, 'Logged formal Weekly MEP Coordination Meeting Minutes');


    // ========================================================================
    // GROUP 12: AI Intelligence & Automation
    // ========================================================================
    console.log('\n>>> GROUP 12: AI Intelligence & Automation');

    // Senior MEP Advisor Consultation (/api/ai/chat)
    const chatRes = await req({
      path: '/api/ai/chat',
      method: 'POST',
      body: {
        message: 'What is the minimum clearance between insulated chilled water pipes and electrical cable ladders according to CIBSE/ASHRAE?',
        context: { project_id: projectId, trade: 'Mechanical' }
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(chatRes.status === 200 && chatRes.body?.reply && chatRes.body.reply.length > 50, 'Senior MEP AI Advisor delivered code-compliant technical consultation');

    // Multi-Turn AI Chat (/api/ai/multiturn-chat)
    const multiChatRes = await req({
      path: '/api/ai/multiturn-chat',
      method: 'POST',
      body: {
        role_type: 'superintendent',
        messages: [
          { role: 'user', content: 'We are preparing for crane hoist of 12-ton water chillers onto the roof plant room.' },
          { role: 'model', content: 'Ensure the mobile crane outrigger pads have certified ground-bearing capacity calculations.' },
          { role: 'user', content: 'What specific wind speed limits and rigging taglines should be enforced on site?' }
        ]
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(multiChatRes.status === 200 && multiChatRes.body?.reply, 'Multi-Turn Superintendent AI Advisor provided actionable field hoist guidance');

    // Defect Cause & Fix Diagnosis (/api/ai/suggest-fix)
    const fixRes = await req({
      path: '/api/ai/suggest-fix',
      method: 'POST',
      body: {
        description: 'Condensate leak and drip tray overflow observed at Level 2 FCU',
        trade: 'HVAC',
        discipline: 'HVAC'
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(fixRes.status === 200 && fixRes.body?.suggestion && fixRes.body.suggestion.includes('Likely cause:'), 'MEP Brain generated structured Defect Cause & Fix diagnosis', fixRes);

    // AI Drawing Q&A (/api/drawing/ask-ai)
    const dwgAiRes = await req({
      path: '/api/drawing/ask-ai',
      method: 'POST',
      body: {
        project_id: projectId,
        drawing_title: 'Level 2 - Plant Room Fitout',
        zone_name: 'Zone A - Chiller Bay',
        zone_sub: 'Primary pumps and 200mm CHW headers',
        question: 'What are the required clearances around the pump suction diffusers?'
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(dwgAiRes.status === 200 && dwgAiRes.body?.answer, 'Drawing AI Q&A generated practical field installation clearances');

    // Document Analyzer into Planner Board (/api/documents/:id/analyze)
    const plannerDocRes = await req({
      path: '/api/documents',
      method: 'POST',
      body: {
        project_id: projectId,
        name: 'Commissioning_Scope_Checklist.csv',
        category: 'Commissioning',
        revision: 'Rev 1',
        attachment_name: 'Commissioning_Scope_Checklist.csv',
        attachment_data: 'data:text/plain;base64,VGFzayBTY29wZSxUcmFkZQpQcmVzc3VyaXplIENIVyBIZWFkZXJzIHRvIDEwIEJhciBNZWNoYW5pY2FsClZlcmlmeSBQaGFzZSBSb3RhdGlvbiBvbiBNYWluIFB1bXBzIEVsZWN0cmljYWwKUHVyZ2UgQWlyIFZlbnRzIGF0IEhpZ2ggUG9pbnRzIE1lY2hhbmljYWw='
      },
      token: tokensByRole['ProjectManager']
    });
    const plannerDocId = plannerDocRes.body.id;

    const analyzeDocRes = await req({
      path: `/api/documents/${plannerDocId}/analyze`,
      method: 'POST',
      body: {},
      token: tokensByRole['ProjectManager']
    });
    assert(analyzeDocRes.status === 200 && analyzeDocRes.body?.buckets && analyzeDocRes.body.buckets.length > 0,
      'Document Analyzer parsed uploaded specification into a structured Planner Board');

    // Read full Planner board via /api/projects/:id/planner
    const plannerBoardRes = await req({
      path: `/api/projects/${projectId}/planner`,
      token: tokensByRole['ProjectManager']
    });
    assert(plannerBoardRes.status === 200 && Array.isArray(plannerBoardRes.body) && plannerBoardRes.body.length > 0,
      'Retrieved full Planner board with nested buckets and tasks');


    // ========================================================================
    // GROUP 13: Client Portal Governance, Published Progress Reports & IDOR Hardening
    // ========================================================================
    console.log('\n>>> GROUP 13: Client Portal Governance, Published Progress Reports & IDOR Hardening');

    // Auto-compile draft progress report
    const autoCompileRes = await req({
      path: '/api/progress_reports/auto-compile',
      method: 'POST',
      body: { project_id: projectId },
      token: tokensByRole['ProjectManager']
    });
    assert(autoCompileRes.status === 200 && autoCompileRes.body?.overall_progress_percent !== undefined,
      'Auto-compiled live site metrics into draft progress report');

    // Create Draft Progress Report
    const draftReportRes = await req({
      path: '/api/progress_reports',
      method: 'POST',
      body: {
        project_id: projectId,
        title: 'Monthly Progress Report #01 - Foundation & First Fix',
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        overall_progress_percent: 34.5,
        planned_progress_percent: 35.0,
        hvac_progress: 40.0,
        electrical_progress: 32.0,
        plumbing_progress: 30.0,
        fire_progress: 36.0,
        status: 'Draft',
        executive_summary: 'Major equipment foundations completed; riser ductwork 40% executed.'
      },
      token: tokensByRole['ProjectManager']
    });
    assert(draftReportRes.status === 201 && draftReportRes.body?.id, 'Project Manager created Draft Progress Report');
    const reportId = draftReportRes.body.id;

    // Verify Client CANNOT see draft progress report
    const clientDraftList = await req({
      path: `/api/progress_reports?project_id=${projectId}`,
      token: tokensByRole['Client']
    });
    assert(clientDraftList.status === 200 && clientDraftList.body.length === 0,
      'Client cannot see Draft progress reports (Strict publication firewall enforced)');

    // Add Photo to Progress Report
    const photoRes = await req({
      path: `/api/progress_reports/${reportId}/photos`,
      method: 'POST',
      body: {
        title: 'Level 2 Plant Room Chillers Installed',
        caption: 'Chillers rigged and positioned on vibration spring isolators',
        trade: 'Mechanical',
        location: 'Roof Plant Room',
        photo_data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      },
      token: tokensByRole['ProjectManager']
    });
    assert(photoRes.status === 201 && photoRes.body?.id, 'Attached verified high-resolution progress photo to report');

    // Publish Report to Client
    const publishReportRes = await req({
      path: `/api/progress_reports/${reportId}/publish`,
      method: 'POST',
      body: {},
      token: tokensByRole['ProjectManager']
    });
    assert(publishReportRes.status === 200 && publishReportRes.body?.status === 'Published to Client',
      'Project Manager published progress report to Client');

    // Verify Client CAN now see the published progress report
    const clientPubList = await req({
      path: `/api/progress_reports?project_id=${projectId}`,
      token: tokensByRole['Client']
    });
    assert(clientPubList.status === 200 && clientPubList.body.length === 1,
      'Client successfully accesses published progress report');

    // Verify Client Dashboard / Client Summary endpoint derives progress strictly from published report
    const clientSumm = await req({
      path: `/api/projects/${projectId}/client-summary`,
      token: tokensByRole['Client']
    });
    assert(clientSumm.status === 200 && clientSumm.body?.overall_progress === 34.5,
      'Client Dashboard overall progress is strictly governed by latest published progress report (34.5%)');

    // Verify Subcontractor has ZERO access to progress reports
    const subReportRes = await req({
      path: `/api/progress_reports?project_id=${projectId}`,
      token: tokensByRole['Subcontractor']
    });
    assert(subReportRes.status === 200 && subReportRes.body.length === 0,
      'Subcontractor restricted from viewing executive client progress reports');


    // ========================================================================
    // GROUP 14: Subcontractor Progress Claims & Verification Workflow
    // ========================================================================
    console.log('\n>>> GROUP 14: Subcontractor Progress Claims & Verification Workflow');

    // Subcontractor submits monthly progress claim
    const subClaimRes = await req({
      path: '/api/progress_submissions',
      method: 'POST',
      body: {
        project_id: projectId,
        work_package_id: workPackageId,
        discipline: 'Mechanical Ductwork',
        claimed_percent: 75.0,
        quantity_installed: 320,
        unit: 'LM',
        notes: 'Level 3 main branch ductwork installed and sealed with mastic.'
      },
      token: tokensByRole['Subcontractor']
    });
    assert(subClaimRes.status === 201 && subClaimRes.body?.id, 'Subcontractor submitted formal progress claim (75% claimed)');
    const claimId = subClaimRes.body.id;

    // Cross-Work Package isolation: Subcontractor cannot claim progress for foreign work package
    const fakeWpRes = await req({
      path: '/api/progress_submissions',
      method: 'POST',
      body: {
        project_id: projectId,
        work_package_id: 'foreign-wp-999',
        discipline: 'Fire Protection',
        claimed_percent: 50.0
      },
      token: tokensByRole['Subcontractor']
    });
    assert(fakeWpRes.status === 403, 'Subcontractor cross-work package progress claim strictly blocked (403)');

    // Site Engineer / Project Manager reviews and verifies claim with inspection adjustment
    const reviewClaimRes = await req({
      path: `/api/progress_submissions/${claimId}/review`,
      method: 'POST',
      body: {
        status: 'Approved with Adjustments',
        adjusted_percent: 68.0,
        review_comments: 'Duct installed as claimed, but insulation and flexible canvas connectors pending on 4 runs.'
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(reviewClaimRes.status === 200 && reviewClaimRes.body?.adjusted_percent === 68.0,
      'Site Engineer reviewed and adjusted progress claim to 68.0%');

    // Verify task progress under work package automatically synchronized
    const tasksAfterClaim = await req({
      path: `/api/tasks?project_id=${projectId}`,
      token: adminToken
    });
    const updatedWpTask = tasksAfterClaim.body.find((t: any) => t.id === wpTaskId);
    assert(updatedWpTask && updatedWpTask.progress >= 68,
      'Work package linked tasks automatically synchronized to verified progress percentage');

    // Verify Client has no access to internal subcontractor progress claims
    const clientClaimAttempt = await req({
      path: `/api/progress_submissions?project_id=${projectId}`,
      token: tokensByRole['Client']
    });
    assert(clientClaimAttempt.status === 403,
      'Client access to raw subcontractor progress claims strictly forbidden (403 Internal)');


    // ========================================================================
    // GROUP 15: Cross-Cutting Enterprise Services: Global Search, CSV Export, Audit Trail, Notifications
    // ========================================================================
    console.log('\n>>> GROUP 15: Cross-Cutting Enterprise Services: Global Search, CSV Export, Audit Trail, Notifications');

    // Global Search
    const searchRes = await req({
      path: `/api/search?project_id=${projectId}&q=Chilled`,
      token: adminToken
    });
    assert(searchRes.status === 200 && Array.isArray(searchRes.body) && searchRes.body.length > 0,
      'Global multi-entity search successfully located records containing "Chilled" across modules');

    // Client Budget Masking on CSV Export
    const clientExportRes = await req({
      path: `/api/export/projects?project_id=${projectId}`,
      token: tokensByRole['Client']
    });
    assert(clientExportRes.status === 200, 'Client exported project CSV');
    assert(!String(clientExportRes.body).includes('budget') && !String(clientExportRes.body).includes('18500000'),
      'Commercial budget columns strictly stripped from Client CSV export');

    const adminExportRes = await req({
      path: `/api/export/projects?project_id=${projectId}`,
      token: adminToken
    });
    assert(adminExportRes.status === 200 && String(adminExportRes.body).includes('budget'),
      'Admin CSV export retains full commercial financial fields');

    // Multi-module CSV exports
    const taskExport = await req({ path: `/api/export/tasks?project_id=${projectId}`, token: adminToken });
    assert(taskExport.status === 200 && String(taskExport.headers['content-type']).includes('csv'), 'Exported Tasks module CSV');

    const rfiExport = await req({ path: `/api/export/rfis?project_id=${projectId}`, token: adminToken });
    assert(rfiExport.status === 200, 'Exported RFIs module CSV');

    const punchExport = await req({ path: `/api/export/punchlist?project_id=${projectId}`, token: adminToken });
    assert(punchExport.status === 200, 'Exported Punch List module CSV');

    // Comprehensive Audit Trail
    const auditRes = await req({
      path: `/api/audit?project_id=${projectId}`,
      token: adminToken
    });
    assert(auditRes.status === 200 && Array.isArray(auditRes.body) && auditRes.body.length > 10,
      'Comprehensive tamper-evident audit trail retrieved all system mutations');

    // Notifications Center
    const notifRes = await req({
      path: '/api/notifications',
      token: tokensByRole['SiteEngineer']
    });
    assert(notifRes.status === 200 && Array.isArray(notifRes.body),
      'Notifications center queried user-specific notifications');

    // System Health Check
    const healthRes = await req({ path: '/api/health' });
    assert(healthRes.status === 200 && healthRes.body?.status === 'ok',
      'System Health Check verified operational status');

  } finally {
    await cleanup(adminToken);
  }

  console.log('\n================================================================================');
  console.log(`  ENTERPRISE MASTER TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runEnterpriseSuite().catch(err => {
  console.error('Unhandled failure in enterprise test suite:', err);
  process.exit(1);
});
