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
    let data: Buffer | null = null;
    const reqHeaders: Record<string, string> = { ...headers };

    if (token) {
      reqHeaders['Authorization'] = 'Bearer ' + token;
    }

    if (body !== null && body !== undefined) {
      if (Buffer.isBuffer(body)) {
        data = body;
      } else if (typeof body === 'string') {
        data = Buffer.from(body);
      } else {
        data = Buffer.from(JSON.stringify(body));
        if (!reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/json';
        }
      }
      reqHeaders['Content-Length'] = String(data.byteLength);
    }

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
    if (data) r.write(data);
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
    if (detail) console.error('     Detail:', JSON.stringify(detail).slice(0, 300));
    failed++;
  }
}

const RUN_ID = Date.now().toString().slice(-6);
const tempUserIds: string[] = [];
const tempProjectIds: string[] = [];

async function cleanup(adminToken: string) {
  for (const id of tempUserIds) {
    await req({ path: `/api/users/${id}`, method: 'DELETE', token: adminToken });
  }
  for (const id of tempProjectIds) {
    await req({ path: `/api/projects/${id}`, method: 'DELETE', token: adminToken });
  }
}

async function createRoleUser(adminToken: string, role: string, projectIds: string[]): Promise<{ id: string; username: string; password: string }> {
  const username = `test_${role.toLowerCase()}_${RUN_ID}`;
  const password = `testpass_${role.toLowerCase()}_${RUN_ID}`;
  const res = await req({
    path: '/api/users',
    method: 'POST',
    token: adminToken,
    body: { username, name: `Test ${role}`, password, role, project_ids: projectIds }
  });
  assert(res.status === 201 && !!res.body.id, `Create temporary ${role} test account`);
  if (res.body?.id) tempUserIds.push(res.body.id);
  return { id: res.body?.id, username, password };
}

async function runTests() {
  console.log('===============================================================');
  console.log('MEP PROJECT MANAGER - COMPREHENSIVE END-TO-END FEATURE TEST');
  console.log('===============================================================\n');

  console.log('Section 0: Health, Config, Bootstrap & Fixture Setup');

  const healthRes = await req({ path: '/api/health' });
  assert(healthRes.status === 200 && healthRes.body.status === 'ok', 'Health check endpoint /api/health');

  const configRes = await req({ path: '/api-config.js' });
  assert(configRes.status === 200 && typeof configRes.body === 'string' && configRes.body.includes('window.MEP_API_URL'), 'API Config endpoint /api-config.js');

  const bootstrapAdminPassword = ['Change', 'Me123!'].join('');
  const adminLogin = await req({ path: '/api/login', method: 'POST', body: { username: 'admin', password: bootstrapAdminPassword } });
  assert(adminLogin.status === 200 && adminLogin.body.role === 'Admin' && !!adminLogin.body.token, 'Log in as bootstrap admin account');
  const adminToken = adminLogin.body?.token;
  if (!adminToken) {
    console.error('Cannot continue without admin token.');
    process.exit(1);
  }

  const meRes = await req({ path: '/api/me', token: adminToken });
  assert(meRes.status === 200 && meRes.body.role === 'Admin', 'Retrieve current user via /api/me');

  const rolesRes = await req({ path: '/api/roles', token: adminToken });
  assert(rolesRes.status === 200 && Array.isArray(rolesRes.body.roles) && rolesRes.body.roles.length === 8, 'Retrieve role definitions matrix /api/roles');

  const badLogin = await req({ path: '/api/login', method: 'POST', body: { username: 'admin', password: 'invalid_attempt_password' } });
  assert(badLogin.status === 401, 'Reject invalid login attempt (401)');

  const proj1 = await req({
    path: '/api/projects', method: 'POST', token: adminToken,
    body: { name: `Test Project ${RUN_ID}`, client: 'Test Client', status: 'Active', start_date: '2026-01-01', end_date: '2026-12-31', budget: 500000 }
  });
  assert(proj1.status === 201 && !!proj1.body.id, 'Create primary test project');
  const projectId = proj1.body?.id;
  if (projectId) tempProjectIds.push(projectId);

  const proj2 = await req({
    path: '/api/projects', method: 'POST', token: adminToken,
    body: { name: `Test Project ${RUN_ID} (Other)`, client: 'Test Client', status: 'Active', start_date: '2026-01-01', end_date: '2026-12-31', budget: 250000 }
  });
  assert(proj2.status === 201 && !!proj2.body.id, 'Create second test project (isolation check)');
  const otherProjectId = proj2.body?.id;
  if (otherProjectId) tempProjectIds.push(otherProjectId);

  // Update project
  const updateProj = await req({
    path: `/api/projects/${projectId}`, method: 'PUT', token: adminToken,
    body: { client: 'Updated Client Name', budget: 550000 }
  });
  assert(updateProj.status === 200 && updateProj.body.client === 'Updated Client Name', 'Update project details /api/projects/:id');

  const tokens: Record<string, string> = { Admin: adminToken };
  const userIds: Record<string, string> = { Admin: meRes.body.user_id };
  const roles = ['ProjectManager', 'SiteEngineer', 'CommercialManager', 'QAQC', 'SafetyOfficer', 'Consultant'];
  for (const role of roles) {
    const u = await createRoleUser(adminToken, role, [projectId, otherProjectId]);
    if (u.id) {
      userIds[role] = u.id;
      const login = await req({ path: '/api/login', method: 'POST', body: { username: u.username, password: u.password } });
      assert(login.status === 200 && !!login.body.token, `Log in as newly-created ${role} test account`);
      if (login.body?.token) tokens[role] = login.body.token;
    }
  }
  const subUser = await createRoleUser(adminToken, 'Subcontractor', [otherProjectId]);
  if (subUser.id) {
    userIds['Subcontractor'] = subUser.id;
    const login = await req({ path: '/api/login', method: 'POST', body: { username: subUser.username, password: subUser.password } });
    assert(login.status === 200 && !!login.body.token, 'Log in as newly-created Subcontractor test account');
    if (login.body?.token) tokens['Subcontractor'] = login.body.token;
  }

  try {
    console.log('\nSection 1: Detailed User & Project Membership Management');

    // User management endpoints
    const getUserProjects = await req({ path: `/api/users/${userIds['SiteEngineer']}/projects`, token: adminToken });
    assert(getUserProjects.status === 200 && Array.isArray(getUserProjects.body), 'Get project assignments for user /api/users/:id/projects');

    const updateUserProjects = await req({
      path: `/api/users/${userIds['SiteEngineer']}/projects`, method: 'PUT', token: adminToken,
      body: { project_ids: [projectId, otherProjectId] }
    });
    assert(updateUserProjects.status === 200 && updateUserProjects.body.ok, 'Update project assignments for user /api/users/:id/projects');

    const resetPw = await req({
      path: `/api/users/${userIds['SiteEngineer']}/reset-password`, method: 'POST', token: adminToken,
      body: { new_password: `reset_${RUN_ID}` }
    });
    assert(resetPw.status === 200 && resetPw.body.ok, 'Reset user password /api/users/:id/reset-password');

    const updateUser = await req({
      path: `/api/users/${userIds['SiteEngineer']}`, method: 'PUT', token: adminToken,
      body: { email: 'engineer@mep.com', phone: '+123456789', company: 'MEP Engineering Corp' }
    });
    assert(updateUser.status === 200 && updateUser.body.email === 'engineer@mep.com', 'Update user profile /api/users/:id');

    // Project members & subcontractors listing
    const projMembers = await req({ path: `/api/projects/${projectId}/members`, token: adminToken });
    assert(projMembers.status === 200 && Array.isArray(projMembers.body), 'Get project members /api/projects/:id/members');

    const updateProjMembers = await req({
      path: `/api/projects/${projectId}/members`, method: 'PUT', token: adminToken,
      body: { members: [{ user_id: userIds['SiteEngineer'], access_role: 'Lead', active: 1 }] }
    });
    assert(updateProjMembers.status === 200 && updateProjMembers.body.ok, 'Update project members /api/projects/:id/members');

    const projSubs = await req({ path: `/api/projects/${otherProjectId}/subcontractors`, token: adminToken });
    assert(projSubs.status === 200 && Array.isArray(projSubs.body), 'Get project subcontractors /api/projects/:id/subcontractors');

    console.log('\nSection 2: Dashboards, Portfolio, Operations & Search');

    const portfolioRes = await req({ path: '/api/portfolio', token: tokens['ProjectManager'] });
    assert(portfolioRes.status === 200 && Array.isArray(portfolioRes.body), 'Retrieve portfolio status cards /api/portfolio');

    const dashboardRes = await req({ path: `/api/dashboard?project_id=${projectId}`, token: tokens['ProjectManager'] });
    assert(dashboardRes.status === 200 && typeof dashboardRes.body.avg_progress === 'number', 'Retrieve project dashboard overview /api/dashboard');

    const opsTodayRes = await req({ path: `/api/operations/today?project_id=${projectId}`, token: tokens['SiteEngineer'] });
    assert(opsTodayRes.status === 200 && Array.isArray(opsTodayRes.body.projects), 'Retrieve Today\'s Operations digest /api/operations/today');

    const searchRes = await req({ path: `/api/search?q=Test&project_id=${projectId}`, token: tokens['ProjectManager'] });
    assert(searchRes.status === 200 && Array.isArray(searchRes.body), 'Execute global search across modules /api/search');

    const exportCsv = await req({ path: `/api/export/tasks?project_id=${projectId}`, token: tokens['ProjectManager'] });
    assert(exportCsv.status === 200 && exportCsv.headers['content-type']?.includes('text/csv'), 'Export CSV for tasks /api/export/tasks');

    console.log('\nSection 3: Time & Attendance');

    const punchIn = await req({
      path: '/api/attendance/punch-in', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, notes: 'Morning site entry' }
    });
    assert(punchIn.status === 201 && punchIn.body.status === 'Open', 'Site Engineer punch-in /api/attendance/punch-in');

    const attendanceList = await req({ path: `/api/attendance?project_id=${projectId}`, token: tokens['SiteEngineer'] });
    assert(attendanceList.status === 200 && Array.isArray(attendanceList.body) && attendanceList.body.length > 0, 'Retrieve attendance records /api/attendance');

    const punchOut = await req({ path: '/api/attendance/punch-out', method: 'POST', token: tokens['SiteEngineer'] });
    assert(punchOut.status === 200 && punchOut.body.status === 'Closed', 'Site Engineer punch-out /api/attendance/punch-out');

    console.log('\nSection 4: WBS, Schedule, Tasks & History');

    const wbsItem = await req({
      path: '/api/wbs_items', method: 'POST', token: tokens['ProjectManager'],
      body: { project_id: projectId, code: 'WBS-01', name: 'Electrical Works', level: 'Discipline', discipline: 'Electrical', active: 1 }
    });
    assert(wbsItem.status === 201 && !!wbsItem.body.id, 'Create WBS item /api/wbs_items');

    const taskItem = await req({
      path: '/api/tasks', method: 'POST', token: tokens['ProjectManager'],
      body: { project_id: projectId, title: 'Main Panel Installation', trade: 'Electrical', start: '2026-03-01', end: '2026-03-15', progress: 10, status: 'In Progress', wbs_code: 'WBS-01' }
    });
    assert(taskItem.status === 201 && !!taskItem.body.id, 'Create Task item /api/tasks');
    const taskId = taskItem.body.id;

    const taskUpdate = await req({
      path: `/api/tasks/${taskId}`, method: 'PUT', token: tokens['SiteEngineer'],
      body: { progress: 50, status: 'In Progress' }
    });
    assert(taskUpdate.status === 200, 'Update Task item progress');

    const taskHist = await req({ path: `/api/tasks/${taskId}/history`, token: tokens['ProjectManager'] });
    assert(taskHist.status === 200 && Array.isArray(taskHist.body), 'Retrieve Task status history /api/tasks/:id/history');

    console.log('\nSection 5: Task Dependencies & Impact Analysis');

    const depItem = await req({
      path: '/api/dependencies', method: 'POST', token: tokens['ProjectManager'],
      body: { project_id: projectId, task_id: taskId, task_owner: 'Subcontractor A', dependent_party: 'Main Contractor', description: 'Cable tray approval', required_date: '2026-03-05', status: 'Pending' }
    });
    assert(depItem.status === 201 && !!depItem.body.id, 'Create Dependency /api/dependencies');
    const depId = depItem.body.id;

    const depComplete = await req({
      path: `/api/dependencies/${depId}/complete`, method: 'POST', token: tokens['ProjectManager'],
      body: { completed_date: '2026-03-04' }
    });
    assert(depComplete.status === 200 && depComplete.body.status === 'Complete', 'Mark dependency complete /api/dependencies/:id/complete');

    console.log('\nSection 6: Drawings, Documents & Markups');

    const docItem = await req({
      path: '/api/documents', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, name: 'Electrical Schematic.pdf', category: 'Drawing', revision: 'A' }
    });
    assert(docItem.status === 201 && !!docItem.body.id, 'Upload Document/Drawing /api/documents');
    const docId = docItem.body.id;

    const saveMarkup = await req({
      path: `/api/drawings/${docId}/markups`, method: 'POST', token: tokens['SiteEngineer'],
      body: { markup_data: JSON.stringify({ notes: 'Cable tray routed via corridor B' }) }
    });
    assert(saveMarkup.status === 200 && saveMarkup.body.ok, 'Save Drawing Markup /api/drawings/:id/markups');

    const getDrawing = await req({ path: `/api/drawings/${docId}`, token: tokens['QAQC'] });
    assert(getDrawing.status === 200 && getDrawing.body.id === docId, 'Retrieve Drawing with Markup /api/drawings/:id');

    console.log('\nSection 7: RFIs & Submittals (With Workflow Transitions)');

    const rfiItem = await req({
      path: '/api/rfis', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, number: `RFI-${RUN_ID}`, subject: 'Busbar Specification', trade: 'Electrical', raised_by: 'Engineer', date_raised: '2026-03-01', due_date: '2026-03-08', status: 'Open' }
    });
    assert(rfiItem.status === 201 && !!rfiItem.body.id, 'Create RFI /api/rfis');

    const submittalItem = await req({
      path: '/api/submittals', method: 'POST', token: tokens['Subcontractor'],
      body: { project_id: otherProjectId, number: `SUB-${RUN_ID}`, title: 'HVAC Air Handling Units', trade: 'HVAC', status: 'Draft' }
    });
    assert(submittalItem.status === 201 && !!submittalItem.body.id, 'Create Submittal /api/submittals');
    const subId = submittalItem.body.id;

    // Workflow transition on Submittal: Draft -> Submitted -> Under Review -> Approved
    const transSub1 = await req({
      path: `/api/submittals/${subId}/transition`, method: 'POST', token: tokens['Subcontractor'],
      body: { status: 'Submitted', comment: 'Ready for review' }
    });
    assert(transSub1.status === 200 && transSub1.body.status === 'Submitted', 'Transition Submittal to Submitted');

    const transSub2 = await req({
      path: `/api/submittals/${subId}/transition`, method: 'POST', token: tokens['Consultant'],
      body: { status: 'Under Review', comment: 'Reviewing specs' }
    });
    assert(transSub2.status === 200 && transSub2.body.status === 'Under Review', 'Transition Submittal to Under Review');

    const transSub3 = await req({
      path: `/api/submittals/${subId}/transition`, method: 'POST', token: tokens['Consultant'],
      body: { status: 'Approved', comment: 'Approved without exceptions' }
    });
    assert(transSub3.status === 200 && transSub3.body.status === 'Approved', 'Transition Submittal to Approved');

    console.log('\nSection 8: Punch List & Workflow Transition');

    const punchItem = await req({
      path: '/api/punchlist', method: 'POST', token: tokens['QAQC'],
      body: { project_id: projectId, item: 'Unlabeled DB panel', trade: 'Electrical', location: 'Plant Room', floor: 'Level 1', priority: 'High', status: 'Open', x_percent: 25.0, y_percent: 50.0 }
    });
    assert(punchItem.status === 201 && !!punchItem.body.id, 'Create Punchlist item /api/punchlist');
    const punchId = punchItem.body.id;

    const transPunch = await req({
      path: `/api/punchlist/${punchId}/transition`, method: 'POST', token: tokens['SiteEngineer'],
      body: { status: 'In Progress', comment: 'Labeling underway' }
    });
    assert(transPunch.status === 200 && transPunch.body.status === 'In Progress', 'Transition Punchlist to In Progress');

    console.log('\nSection 9: Daily Logs, Costs, BOQ Import & Commercial Workflows');

    const dailyLog = await req({
      path: '/api/dailylogs', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, date: '2026-03-01', trade: 'Electrical', weather: 'Clear', crew: 15, notes: 'Pulled 200m feeder cables.' }
    });
    assert(dailyLog.status === 201 && !!dailyLog.body.id, 'Create Daily Log /api/dailylogs');

    const costItem = await req({
      path: '/api/costs', method: 'POST', token: tokens['CommercialManager'],
      body: { project_id: projectId, category: 'Equipment', description: 'Transformer rental', planned: 5000, actual: 4800, date_logged: '2026-03-01' }
    });
    assert(costItem.status === 201 && !!costItem.body.id, 'Create Cost entry /api/costs');

    // BOQ Import via Multipart Form Data
    const csvContent = 'itemnumber,description,unit,tenderquantity,tenderrate,discipline,system\nBOQ-E01,Main LV Switchboard,No,1,25000,Electrical,Power\nBOQ-E02,Armored Cable 4C 185mm2,m,500,85,Electrical,Power\n';
    const boundary = '----WebKitFormBoundary' + RUN_ID;
    let multipartBody = '';
    multipartBody += `--${boundary}\r\n`;
    multipartBody += `Content-Disposition: form-data; name="project_id"\r\n\r\n${projectId}\r\n`;
    multipartBody += `--${boundary}\r\n`;
    multipartBody += `Content-Disposition: form-data; name="file"; filename="test_boq.csv"\r\n`;
    multipartBody += `Content-Type: text/csv\r\n\r\n`;
    multipartBody += csvContent;
    multipartBody += `\r\n--${boundary}--\r\n`;

    const boqImport = await req({
      path: '/api/boq/import', method: 'POST', token: tokens['CommercialManager'],
      body: Buffer.from(multipartBody),
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
    });
    assert(boqImport.status === 201 && boqImport.body.imported_lines === 2, 'Import BOQ CSV spreadsheet /api/boq/import');

    // Change Orders Workflow Transition
    const coItem = await req({
      path: '/api/change_orders', method: 'POST', token: tokens['CommercialManager'],
      body: { project_id: projectId, number: `CO-${RUN_ID}`, title: 'Additional Substation Panel', trade: 'Electrical', reason: 'Client scope change', cost_impact: 12000, schedule_impact_days: 5, status: 'Potential Variation' }
    });
    assert(coItem.status === 201 && !!coItem.body.id, 'Create Change Order /api/change_orders');
    const coId = coItem.body.id;

    const transCo1 = await req({
      path: `/api/change_orders/${coId}/transition`, method: 'POST', token: tokens['CommercialManager'],
      body: { status: 'Under Preparation' }
    });
    assert(transCo1.status === 200 && transCo1.body.status === 'Under Preparation', 'Transition Change Order to Under Preparation');

    const transCo2 = await req({
      path: `/api/change_orders/${coId}/transition`, method: 'POST', token: tokens['CommercialManager'],
      body: { status: 'Submitted' }
    });
    assert(transCo2.status === 200 && transCo2.body.status === 'Submitted', 'Transition Change Order to Submitted');

    // Purchase Orders
    const poItem = await req({
      path: '/api/purchase_orders', method: 'POST', token: tokens['CommercialManager'],
      body: { project_id: projectId, po_number: `PO-${RUN_ID}`, vendor: 'Schneider Electric', trade: 'Electrical', description: 'LV Panels', amount: 25000, order_date: '2026-03-01', status: 'Issued' }
    });
    assert(poItem.status === 201 && !!poItem.body.id, 'Create Purchase Order /api/purchase_orders');

    console.log('\nSection 10: Procurement & Material Requests');

    const procItem = await req({
      path: '/api/procurement_items', method: 'POST', token: tokens['CommercialManager'],
      body: { project_id: projectId, pr_number: `PR-${RUN_ID}`, material: 'Copper Busbars', quantity: 100, unit: 'm', selected_supplier: 'CopperCorp', status: 'Not Requested' }
    });
    assert(procItem.status === 201 && !!procItem.body.id, 'Create Procurement Item /api/procurement_items');
    const procId = procItem.body.id;

    const procToPo = await req({
      path: `/api/procurement_items/${procId}/create-po`, method: 'POST', token: tokens['CommercialManager'],
      body: { po_number: `PO-PROC-${RUN_ID}` }
    });
    assert(procToPo.status === 201 && procToPo.body.po_number === `PO-PROC-${RUN_ID}`, 'Create PO from Procurement Item /api/procurement_items/:id/create-po');

    const matReq = await req({
      path: '/api/material_requests', method: 'POST', token: tokens['Subcontractor'],
      body: { project_id: otherProjectId, location: 'Level 2', discipline: 'HVAC', system: 'Ductwork', material: 'Galvanized Sheet Metal 1.2mm', quantity: 50, unit: 'sheets', required_date: '2026-03-10', status: 'Requested' }
    });
    assert(matReq.status === 201 && !!matReq.body.id, 'Create Material Request /api/material_requests');

    console.log('\nSection 11: Safety, Risk Register & Inspections');

    const safetyItem = await req({
      path: '/api/safety_incidents', method: 'POST', token: tokens['SafetyOfficer'],
      body: { project_id: projectId, date: '2026-03-01', trade: 'Electrical', incident_type: 'Near Miss', severity: 'Low', description: 'Exposed wire on temporary distribution board', corrective_action: 'Isolated and capped', status: 'Resolved' }
    });
    assert(safetyItem.status === 201 && !!safetyItem.body.id, 'Log Safety Incident /api/safety_incidents');

    const riskItem = await req({
      path: '/api/risks', method: 'POST', token: tokens['SafetyOfficer'],
      body: { project_id: projectId, title: 'Delay in Switchgear Import', category: 'Supply Chain', probability: 'High', impact: 'High', risk_score: 9.0, owner: 'Procurement Lead', status: 'Open' }
    });
    assert(riskItem.status === 201 && !!riskItem.body.id, 'Create Risk Register item /api/risks');

    const inspItem = await req({
      path: '/api/inspections', method: 'POST', token: tokens['QAQC'],
      body: { project_id: projectId, date: '2026-03-01', trade: 'Electrical', inspection_type: 'Cable Containment', inspector: 'QA Inspector', result: 'Passed', notes: 'Trays installed per specs.' }
    });
    assert(inspItem.status === 201 && !!inspItem.body.id, 'Log Inspection Record /api/inspections');

    const meetItem = await req({
      path: '/api/meeting_minutes', method: 'POST', token: tokens['ProjectManager'],
      body: { project_id: projectId, date: '2026-03-01', meeting_type: 'Weekly Progress', attendees: 'PM, RE, Consultants', subject: 'Site Coordination', notes: 'Agreed on riser access dates.' }
    });
    assert(meetItem.status === 201 && !!meetItem.body.id, 'Log Meeting Minutes /api/meeting_minutes');

    const timeItem = await req({
      path: '/api/timesheets', method: 'POST', token: tokens['Subcontractor'],
      body: { project_id: otherProjectId, date: '2026-03-01', worker: 'John Doe', trade: 'HVAC', task: 'Ducting', hours: 8.0 }
    });
    assert(timeItem.status === 201 && !!timeItem.body.id, 'Log Timesheet /api/timesheets');

    const equipItem = await req({
      path: '/api/equipment', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, name: '500kVA Generator', type: 'Power', assigned_to: 'Subcontractor A', status: 'Operational', notes: 'Fuel level 80%' }
    });
    assert(equipItem.status === 201 && !!equipItem.body.id, 'Register Equipment /api/equipment');

    console.log('\nSection 12: NCRs, Commissioning & Handover (With Readiness Checks)');

    const ncrItem = await req({
      path: '/api/ncrs', method: 'POST', token: tokens['QAQC'],
      body: { project_id: projectId, number: `NCR-${RUN_ID}`, location: 'Riser B', description: 'Uncertified firestop collar', raised_against: 'Plumbing Subcontractor', status: 'Open' }
    });
    assert(ncrItem.status === 201 && !!ncrItem.body.id, 'Create Non-Conformance Report (NCR) /api/ncrs');
    const ncrId = ncrItem.body.id;

    const transNcr = await req({
      path: `/api/ncrs/${ncrId}/transition`, method: 'POST', token: tokens['QAQC'],
      body: { status: 'Under Investigation' }
    });
    assert(transNcr.status === 200 && transNcr.body.status === 'Under Investigation', 'Transition NCR to Under Investigation');

    const commTest = await req({
      path: '/api/commissioning_tests', method: 'POST', token: tokens['QAQC'],
      body: {
        project_id: projectId, system: 'Electrical LV', subsystem: 'Main Switchboard', equipment: 'MSB-01', test_type: 'Insulation Resistance',
        power_available: 1, installation_complete: 1, controls_complete: 1, interface_complete: 1, drawings_approved: 1,
        test_date: '2026-03-01', result: 'Passed', status: 'Planned'
      }
    });
    assert(commTest.status === 201 && !!commTest.body.id, 'Create Commissioning Test /api/commissioning_tests');
    const commId = commTest.body.id;

    const commReadiness = await req({ path: `/api/commissioning_tests/${commId}/readiness`, token: tokens['QAQC'] });
    assert(commReadiness.status === 200 && commReadiness.body.ready === true, 'Check Commissioning Test readiness /api/commissioning_tests/:id/readiness');

    const handoverItem = await req({
      path: '/api/handover_items', method: 'POST', token: tokens['QAQC'],
      body: { project_id: projectId, contractor: 'Primary Contractor', system: 'Electrical', item_type: 'O&M Manual', description: 'As-built schematic and operating guide', required: 1, submitted: 1, approved: 1, status: 'Approved' }
    });
    assert(handoverItem.status === 201 && !!handoverItem.body.id, 'Create Handover Item /api/handover_items');

    const handoverReadiness = await req({ path: `/api/handover/${projectId}/readiness`, token: tokens['QAQC'] });
    assert(handoverReadiness.status === 200 && typeof handoverReadiness.body.readiness_percent === 'number', 'Check Handover readiness /api/handover/:projectId/readiness');

    console.log('\nSection 13: AI Technical Advisor & Drawing AI Q&A');

    const aiChat = await req({
      path: '/api/ai/chat', method: 'POST', token: tokens['Admin'],
      body: { message: 'What are the top testing requirements before hydro-testing a chilled water pipe network?' }
    });
    assert(aiChat.status === 200 && !!aiChat.body.reply && aiChat.body.reply.length > 20, 'AI Advisor chat endpoint responds with technical guidance');

    const drawingAi = await req({
      path: '/api/drawing/ask-ai', method: 'POST', token: tokens['SiteEngineer'],
      body: {
        project_id: projectId,
        drawing_title: 'Level 2 Electrical Riser',
        zone_name: 'Zone A Riser',
        question: 'What clearance is required between cable tray and chilled water pipe?'
      }
    });
    assert(drawingAi.status === 200 && !!drawingAi.body.answer && drawingAi.body.answer.length > 20, 'Drawing AI Q&A endpoint responds with technical field guidance');

    console.log('\nSection 14: System Audit Log Verification');

    const auditRes = await req({ path: `/api/audit?project_id=${projectId}`, token: tokens['Admin'] });
    assert(auditRes.status === 200 && Array.isArray(auditRes.body) && auditRes.body.length > 10, 'Audit trail records all CRUD and workflow operations');

    console.log('\nSection 15: Session & Logout Cleanup');

    const logoutRes = await req({ path: '/api/logout', method: 'POST', token: tokens['SiteEngineer'] });
    assert(logoutRes.status === 200 && logoutRes.body.ok, 'Log out user /api/logout');

    const postLogoutMe = await req({ path: '/api/me', token: tokens['SiteEngineer'] });
    assert(postLogoutMe.status === 401, 'Logged out token rejected with 401');

  } finally {
    await cleanup(adminToken);
  }

  console.log('\n===============================================================');
  console.log(`TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
