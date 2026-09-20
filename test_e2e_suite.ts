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
    console.log(`  [PASS] ${desc}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${desc}`);
    if (detail) console.error('     Detail:', JSON.stringify(detail).slice(0, 300));
    failed++;
  }
}

// This suite is fully self-seeding: it creates its own admin-bootstrapped
// test project and one temporary user per role, runs the workflow
// assertions against that fixture data, then deletes everything it
// created. It does not depend on any server-side demo/seed data - a
// fresh install with just the bootstrap "admin" account is enough to
// run this end to end.
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
  const password = `Test${RUN_ID}!pw`;
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
  console.log('MEP PROJECT MANAGER - END-TO-END VERIFICATION SUITE');
  console.log('===============================================================\n');

  console.log('Section 0: Bootstrap & Fixture Setup');

  const adminLogin = await req({ path: '/api/login', method: 'POST', body: { username: 'admin', password: 'ChangeMe123!' } });
  assert(adminLogin.status === 200 && adminLogin.body.role === 'Admin' && !!adminLogin.body.token, 'Log in as bootstrap admin account');
  const adminToken = adminLogin.body?.token;
  if (!adminToken) {
    console.error('Cannot continue without an admin token (has the bootstrap password been changed? update this script if so).');
    process.exit(1);
  }

  const badLogin = await req({ path: '/api/login', method: 'POST', body: { username: 'admin', password: 'wrongpassword' } });
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

  const tokens: Record<string, string> = { Admin: adminToken };
  const roles = ['ProjectManager', 'SiteEngineer', 'CommercialManager', 'QAQC', 'SafetyOfficer', 'Consultant'];
  for (const role of roles) {
    // These roles need access to BOTH test projects: some assertions below
    // have them act on records the Subcontractor (scoped to otherProjectId
    // only) created there.
    const u = await createRoleUser(adminToken, role, [projectId, otherProjectId]);
    if (u.id) {
      const login = await req({ path: '/api/login', method: 'POST', body: { username: u.username, password: u.password } });
      assert(login.status === 200 && !!login.body.token, `Log in as newly-created ${role} test account`);
      if (login.body?.token) tokens[role] = login.body.token;
    }
  }
  const subUser = await createRoleUser(adminToken, 'Subcontractor', [otherProjectId]);
  if (subUser.id) {
    const login = await req({ path: '/api/login', method: 'POST', body: { username: subUser.username, password: subUser.password } });
    assert(login.status === 200 && !!login.body.token, 'Log in as newly-created Subcontractor test account');
    if (login.body?.token) tokens['Subcontractor'] = login.body.token;
  }

  try {
    console.log('\nSection 1: Role-Based Access Control');

    const subUsersReq = await req({ path: '/api/users', token: tokens['Subcontractor'] });
    assert(subUsersReq.status === 403, 'Subcontractor forbidden from /api/users (403)');

    const engUsersReq = await req({ path: '/api/users', token: tokens['SiteEngineer'] });
    assert(engUsersReq.status === 403, 'Site Engineer forbidden from /api/users (403)');

    const adminUsersReq = await req({ path: '/api/users', token: tokens['Admin'] });
    assert(adminUsersReq.status === 200 && Array.isArray(adminUsersReq.body), 'Admin can list /api/users');

    const tempUsername = `temp_inactive_${RUN_ID}`;
    const createTemp = await req({
      path: '/api/users', method: 'POST', token: tokens['Admin'],
      body: { username: tempUsername, name: 'Temp Inactive User', password: 'tempPassword123', role: 'SiteEngineer', status: 'Inactive' }
    });
    assert(createTemp.status === 201, 'Admin can create a user with status Inactive');
    if (createTemp.body?.id) tempUserIds.push(createTemp.body.id);

    const inactiveLogin = await req({ path: '/api/login', method: 'POST', body: { username: tempUsername, password: 'tempPassword123' } });
    assert(inactiveLogin.status === 403, 'Inactive user login blocked with 403');

    const toggleRes = await req({ path: `/api/users/${createTemp.body.id}/toggle-status`, method: 'POST', token: tokens['Admin'] });
    assert(toggleRes.status === 200 && toggleRes.body.status === 'Active', 'Toggle user status back to Active');

    const activeLogin = await req({ path: '/api/login', method: 'POST', body: { username: tempUsername, password: 'tempPassword123' } });
    assert(activeLogin.status === 200, 'Reactivated user can log in successfully');

    console.log('\nSection 2: Project Scoping & Cross-Project Isolation');

    const subProjects = await req({ path: '/api/projects', token: tokens['Subcontractor'] });
    assert(subProjects.status === 200 && Array.isArray(subProjects.body) && subProjects.body.length === 1 && subProjects.body[0].id === otherProjectId,
      'Subcontractor sees only their assigned project');

    const unassignedSubmittal = await req({
      path: '/api/submittals', method: 'POST', token: tokens['Subcontractor'],
      body: { project_id: projectId, number: `MAT-ERR-${RUN_ID}`, title: 'Cross-project submittal attempt', status: 'Submitted' }
    });
    assert(unassignedSubmittal.status === 403, 'Subcontractor forbidden from creating records on an unassigned project (403)');

    console.log('\nSection 3: Schedule & Tasks');
    const tasksRes = await req({ path: `/api/tasks?project_id=${projectId}`, token: tokens['ProjectManager'] });
    assert(tasksRes.status === 200 && Array.isArray(tasksRes.body), 'Retrieve project tasks');

    const newTaskRes = await req({
      path: '/api/tasks', method: 'POST', token: tokens['ProjectManager'],
      body: { project_id: projectId, title: 'Test task', trade: 'HVAC', start_date: '2026-09-10', end_date: '2026-09-24', progress: 25, status: 'In Progress' }
    });
    assert(newTaskRes.status === 201 && !!newTaskRes.body.id, 'Project Manager creates a task');
    const testTaskId = newTaskRes.body?.id;

    const updateTaskRes = await req({
      path: `/api/tasks/${testTaskId}`, method: 'PUT', token: tokens['SiteEngineer'],
      body: { progress: 60, status: 'In Progress' }
    });
    assert(updateTaskRes.status === 200, 'Site Engineer updates task progress');

    console.log('\nSection 4: Drawings & Markups');
    const uploadDoc = await req({
      path: '/api/documents', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, name: 'Test Drawing.pdf', category: 'Drawing', revision: 'A' }
    });
    assert(uploadDoc.status === 201 && !!uploadDoc.body.id, 'Create a test drawing record');
    const testDrawingId = uploadDoc.body?.id;

    if (testDrawingId) {
      const markupPayload = {
        markup_data: JSON.stringify({
          strokes: [{ type: 'pen', color: '#ef4444', size: 3, points: [{ x: 120, y: 150 }, { x: 280, y: 190 }] }],
          snags: [{ id: 'snag_1', x: 220, y: 310, text: 'Test clash annotation' }]
        })
      };
      const saveMarkup = await req({ path: `/api/drawings/${testDrawingId}/markups`, method: 'POST', token: tokens['SiteEngineer'], body: markupPayload });
      assert(saveMarkup.status === 200 && saveMarkup.body.ok, 'Save markup annotations to drawing');

      const getDrawingWithMarkup = await req({ path: `/api/drawings/${testDrawingId}`, token: tokens['QAQC'] });
      assert(getDrawingWithMarkup.status === 200 && !!getDrawingWithMarkup.body.markup_data, 'Retrieve saved drawing markups');
    }

    console.log('\nSection 5: RFIs & Submittals');
    const newRfi = await req({
      path: '/api/rfis', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, number: `RFI-${RUN_ID}`, subject: 'Test RFI', trade: 'Electrical', question: 'Test question requiring engineering response.', status: 'Open', priority: 'High' }
    });
    assert(newRfi.status === 201 && !!newRfi.body.id, 'Site Engineer creates an RFI');
    const rfiId = newRfi.body?.id;

    const ansRfi = await req({
      path: `/api/rfis/${rfiId}`, method: 'PUT', token: tokens['Consultant'],
      body: { answer: 'Test engineering response.', status: 'Answered' }
    });
    assert(ansRfi.status === 200, 'Consultant answers the RFI');

    const submittalRes = await req({
      path: '/api/submittals', method: 'POST', token: tokens['Subcontractor'],
      body: { project_id: otherProjectId, number: `SUB-${RUN_ID}`, title: 'Test material submittal', trade: 'HVAC', status: 'Submitted' }
    });
    assert(submittalRes.status === 201 && !!submittalRes.body.id, 'Subcontractor submits a material submittal');
    const submittalId = submittalRes.body?.id;

    const approveSubmittal = await req({ path: `/api/submittals/${submittalId}`, method: 'PUT', token: tokens['Consultant'], body: { status: 'Approved' } });
    assert(approveSubmittal.status === 200, 'Consultant approves the submittal');

    console.log('\nSection 6: Punch List / Snagging');
    const punchRes = await req({
      path: '/api/punchlist', method: 'POST', token: tokens['QAQC'],
      body: { project_id: otherProjectId, floor: 'Level 2', x_percent: 42.5, y_percent: 68.2, trade: 'HVAC', description: 'Test punch item', priority: 'High', status: 'Open' }
    });
    assert(punchRes.status === 201 && !!punchRes.body.id, 'QA/QC creates a punch list item');
    const punchId = punchRes.body?.id;

    const fixPunch = await req({ path: `/api/punchlist/${punchId}`, method: 'PUT', token: tokens['Subcontractor'], body: { status: 'Rectified' } });
    assert(fixPunch.status === 200, 'Subcontractor marks the punch item Rectified');

    console.log('\nSection 7: Commercial - BOQ, Change Orders, Purchase Orders');
    const boqAsEngineer = await req({
      path: '/api/boq_items', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, item_number: 'TEST-01', description: 'Unauthorized rate', total_price: 999999 }
    });
    assert(boqAsEngineer.status === 403, 'Site Engineer forbidden from modifying BOQ items (403)');

    const boqAsQs = await req({
      path: '/api/boq_items', method: 'POST', token: tokens['CommercialManager'],
      body: { project_id: projectId, item_number: `BOQ-${RUN_ID}`, description: 'Test BOQ item', trade: 'Electrical', unit: 'No.', quantity: 4, unit_rate: 100, total_price: 400, status: 'In Progress' }
    });
    assert(boqAsQs.status === 201 && !!boqAsQs.body.id, 'Commercial Manager creates a BOQ item');

    const coRes = await req({
      path: '/api/change_orders', method: 'POST', token: tokens['CommercialManager'],
      body: { project_id: projectId, number: `CO-${RUN_ID}`, title: 'Test variation', amount: 5000, days_impact: 3, status: 'Submitted' }
    });
    assert(coRes.status === 201 && !!coRes.body.id, 'Commercial Manager submits a change order');
    const coId = coRes.body?.id;

    const approveCo = await req({ path: `/api/change_orders/${coId}`, method: 'PUT', token: tokens['ProjectManager'], body: { status: 'Approved' } });
    assert(approveCo.status === 200, 'Project Manager approves the change order');

    const poRes = await req({
      path: '/api/purchase_orders', method: 'POST', token: tokens['CommercialManager'],
      body: { project_id: projectId, po_number: `PO-${RUN_ID}`, supplier: 'Test Supplier Ltd', amount: 1000, status: 'Issued' }
    });
    assert(poRes.status === 201 && !!poRes.body.id, 'Commercial Manager issues a purchase order');

    console.log('\nSection 8: Site Operations & Safety');
    const logRes = await req({
      path: '/api/dailylogs', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, date: new Date().toISOString().slice(0, 10), trade: 'HVAC', weather: 'Clear', crew: 10, notes: 'Test daily log entry.' }
    });
    assert(logRes.status === 201 && !!logRes.body.id, 'Site Engineer submits a daily log');

    const safetyRes = await req({
      path: '/api/safety_incidents', method: 'POST', token: tokens['SafetyOfficer'],
      body: { project_id: projectId, date: new Date().toISOString().slice(0, 10), severity: 'Medium', trade: 'Electrical', description: 'Test near-miss report.' }
    });
    assert(safetyRes.status === 201 && !!safetyRes.body.id, 'Safety Officer logs a safety incident');

    console.log('\nSection 9: Quality, NCRs & Commissioning');
    const ncrRes = await req({
      path: '/api/ncrs', method: 'POST', token: tokens['QAQC'],
      body: { project_id: projectId, number: `NCR-${RUN_ID}`, location: 'Test Location', trade: 'Plumbing', description: 'Test non-conformance.', target_date: '2026-09-18', status: 'Open' }
    });
    assert(ncrRes.status === 201 && !!ncrRes.body.id, 'QA/QC issues a non-conformance report');

    const commRes = await req({
      path: '/api/commissioning_tests', method: 'POST', token: tokens['QAQC'],
      body: { project_id: projectId, system: 'HVAC', equipment: 'Test Equipment', test_type: 'Functional Test', result: 'Passed', status: 'Completed' }
    });
    assert(commRes.status === 201 && !!commRes.body.id, 'QA/QC records a commissioning test');

    const handoverRes = await req({
      path: '/api/handover_items', method: 'POST', token: tokens['QAQC'],
      body: { project_id: projectId, system: 'HVAC', item_type: 'O&M Manual', description: 'Test handover item.', due_date: '2026-10-01', status: 'Under Review' }
    });
    assert(handoverRes.status === 201 && !!handoverRes.body.id, 'QA/QC submits a handover item');

    console.log('\nSection 10: AI Advisor & Audit Log');
    const aiRes = await req({
      path: '/api/ai/chat', method: 'POST', token: tokens['Admin'],
      body: { message: 'What are the top testing requirements before hydro-testing a chilled water pipe network?', context: { project_id: projectId } }
    });
    assert(aiRes.status === 200 && !!aiRes.body.reply && aiRes.body.reply.length > 20, 'AI advisor endpoint responds with a substantive reply');

    const auditRes = await req({ path: `/api/audit?project_id=${projectId}`, token: tokens['Admin'] });
    assert(auditRes.status === 200 && Array.isArray(auditRes.body) && auditRes.body.length > 0, 'Audit trail records project actions');

    console.log('\nSection 11: MEP Brain - Fix Suggestions & Document-to-Planner');
    const fixRes = await req({
      path: '/api/ai/suggest-fix', method: 'POST', token: tokens['QAQC'],
      body: { description: 'Cable tray is sagging badly between supports', trade: 'Electrical' }
    });
    assert(fixRes.status === 200 && !!fixRes.body.suggestion && fixRes.body.suggestion.length > 10, 'Suggest-fix returns a substantive suggestion for a known defect pattern');

    const fixBadReq = await req({ path: '/api/ai/suggest-fix', method: 'POST', token: tokens['QAQC'], body: {} });
    assert(fixBadReq.status === 400, 'Suggest-fix rejects a request with no description (400)');

    // A minimal plain-text "document" - exercises the fallback (non-AI) extraction
    // and structuring path deterministically, without depending on GEMINI_API_KEY.
    const csvContent = 'Item,Description\n1,Install fire dampers to all riser penetrations\n2,Test smoke detectors in plant rooms\n';
    const csvDataUrl = 'data:text/csv;base64,' + Buffer.from(csvContent).toString('base64');
    const testDoc = await req({
      path: '/api/documents', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, name: `test_items_${RUN_ID}.csv`, category: 'Checklist', attachment_name: `test_items_${RUN_ID}.csv`, attachment_data: csvDataUrl }
    });
    assert(testDoc.status === 201 && !!testDoc.body.id, 'Create a document with real CSV file content');
    const testDocId = testDoc.body?.id;

    const analyzeRes = await req({ path: `/api/documents/${testDocId}/analyze`, method: 'POST', token: tokens['SiteEngineer'] });
    assert(analyzeRes.status === 200 && Array.isArray(analyzeRes.body.buckets) && analyzeRes.body.buckets.length > 0, 'Analyze endpoint reads the document and returns at least one bucket');
    const totalTasks = (analyzeRes.body.buckets || []).reduce((n: number, b: any) => n + (b.tasks || []).length, 0);
    assert(totalTasks >= 2, 'Analyze endpoint produced a task per CSV row');

    const plannerRes = await req({ path: `/api/projects/${projectId}/planner`, token: tokens['ProjectManager'] });
    assert(plannerRes.status === 200 && Array.isArray(plannerRes.body) && plannerRes.body.some((b: any) => b.tasks && b.tasks.length > 0),
      'Planner board read returns the bucket/task structure just created');

    const analyzeForbidden = await req({ path: `/api/documents/${testDocId}/analyze`, method: 'POST', token: tokens['Subcontractor'] });
    assert(analyzeForbidden.status === 403, 'Subcontractor (no access to this project) forbidden from analyzing its documents (403)');

    console.log('\nSection 12: Notifications');
    const rfiForNotif = await req({
      path: '/api/rfis', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, number: `RFI-NOTIF-${RUN_ID}`, subject: 'Notification test RFI', status: 'Open' }
    });
    assert(rfiForNotif.status === 201, 'Create an RFI to test notification-on-answer');
    const notifRfiId = rfiForNotif.body?.id;

    await req({ path: `/api/rfis/${notifRfiId}`, method: 'PUT', token: tokens['Consultant'], body: { status: 'Answered' } });

    const engineerNotifs = await req({ path: '/api/notifications', token: tokens['SiteEngineer'] });
    assert(engineerNotifs.status === 200 && Array.isArray(engineerNotifs.body), 'Fetch notifications for the RFI creator');
    const matchingNotif = (engineerNotifs.body || []).find((n: any) => n.record_id === notifRfiId);
    assert(!!matchingNotif && matchingNotif.is_read === 0, 'RFI creator received an unread notification when their RFI was answered');

    const markRead = await req({ path: `/api/notifications/${matchingNotif.id}/read`, method: 'PUT', token: tokens['SiteEngineer'] });
    assert(markRead.status === 200, 'Mark a notification as read');
    const afterRead = await req({ path: '/api/notifications', token: tokens['SiteEngineer'] });
    const reReadNotif = (afterRead.body || []).find((n: any) => n.id === matchingNotif.id);
    assert(!!reReadNotif && reReadNotif.is_read === 1, 'Notification is now marked read');

    const consultantNotifs = await req({ path: '/api/notifications', token: tokens['Consultant'] });
    assert(consultantNotifs.status === 200 && !(consultantNotifs.body || []).some((n: any) => n.record_id === notifRfiId),
      'The person who made the change does not get notified of their own action');

    console.log('\nSection 13: Client role - visibility, publishing, and API-level enforcement');
    const clientUser = await createRoleUser(adminToken, 'Client', [projectId]);
    let clientToken = '';
    if(clientUser.id){
      const login = await req({ path: '/api/login', method: 'POST', body: { username: clientUser.username, password: clientUser.password } });
      assert(login.status === 200 && !!login.body.token, 'Log in as newly-created Client test account');
      clientToken = login.body?.token;
    }

    const clientDoc = await req({
      path: '/api/documents', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, name: `client_test_${RUN_ID}.pdf`, category: 'Certificate' }
    });
    const clientDocId = clientDoc.body?.id;

    const sneakyCreate = await req({
      path: '/api/documents', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, name: `sneaky_${RUN_ID}.pdf`, visibility: 'Client', published_by: 'spoofed-id' }
    });
    assert(sneakyCreate.status === 201 && sneakyCreate.body.visibility !== 'Client' && !sneakyCreate.body.published_by,
      'visibility/published_by cannot be set at document creation time, even if supplied in the request body');

    const clientBeforePublish = await req({ path: `/api/documents?project_id=${projectId}`, token: clientToken });
    assert(clientBeforePublish.status === 200 && clientBeforePublish.body.length === 0,
      'Client sees zero documents before anything is published (API-enforced, not just UI-hidden)');

    const clientDirectFetchBefore = await req({ path: `/api/drawings/${clientDocId}`, token: clientToken });
    assert(clientDirectFetchBefore.status === 403, 'Client forbidden from fetching an unpublished document directly by ID (403)');

    const clientNoRfiAccess = await req({ path: `/api/rfis?project_id=${projectId}`, token: clientToken });
    assert(clientNoRfiAccess.status === 403, 'Client has no view access to modules outside their curated set (403 on RFIs)');

    const clientCannotPublish = await req({ path: `/api/documents/${clientDocId}`, method: 'PUT', token: clientToken, body: { visibility: 'Client' } });
    assert(clientCannotPublish.status === 403, 'Client cannot publish documents themselves - only someone with edit access can (403)');

    const publishSpoof = await req({
      path: `/api/documents/${clientDocId}`, method: 'PUT', token: tokens['ProjectManager'],
      body: { visibility: 'Client', published_by: 'spoofed-id', published_at: '2000-01-01T00:00:00.000Z' }
    });
    assert(publishSpoof.status === 200 && publishSpoof.body.published_by !== 'spoofed-id' && !publishSpoof.body.published_at.startsWith('2000'),
      'Publishing stamps the real user/timestamp server-side and ignores any client-supplied published_by/published_at');

    const clientAfterPublish = await req({ path: `/api/documents?project_id=${projectId}`, token: clientToken });
    assert(clientAfterPublish.status === 200 && clientAfterPublish.body.length === 1 && clientAfterPublish.body[0].id === clientDocId,
      'Client sees exactly the one published document after it is published');

    const clientDirectFetchAfter = await req({ path: `/api/drawings/${clientDocId}`, token: clientToken });
    assert(clientDirectFetchAfter.status === 200, 'Client can now fetch the published document directly by ID');

    const clientSummary = await req({ path: `/api/projects/${projectId}/client-summary`, token: clientToken });
    assert(clientSummary.status === 200 && Array.isArray(clientSummary.body.published_documents) && clientSummary.body.published_documents.length === 1,
      'Client summary endpoint reflects the published document');

    await req({ path: `/api/documents/${clientDocId}`, method: 'PUT', token: tokens['ProjectManager'], body: { visibility: 'Internal' } });
    const clientAfterUnpublish = await req({ path: `/api/documents?project_id=${projectId}`, token: clientToken });
    assert(clientAfterUnpublish.status === 200 && clientAfterUnpublish.body.length === 0,
      'Un-publishing immediately revokes the client\'s access to the document');

    console.log('\nSection 14: Security review follow-up - Search/Export RBAC, markup write IDOR, publish privilege, auto-unpublish');

    const secretRfi = await req({
      path: '/api/rfis', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, number: `RFI-SEARCHTEST-${RUN_ID}`, subject: `SEARCHTEST${RUN_ID} confidential clash`, status: 'Open' }
    });
    assert(secretRfi.status === 201, 'Create an RFI containing a unique search term');

    const clientSearch = await req({ path: `/api/search?q=SEARCHTEST${RUN_ID}&project_id=${projectId}`, token: clientToken });
    assert(clientSearch.status === 200 && clientSearch.body.length === 0,
      'Global search never returns results from a module the Client has no view access to (RFIs)');

    const engineerSearch = await req({ path: `/api/search?q=SEARCHTEST${RUN_ID}&project_id=${projectId}`, token: tokens['SiteEngineer'] });
    assert(engineerSearch.status === 200 && engineerSearch.body.length > 0,
      'Global search still returns results for a role that does have view access to that module');

    const secretDoc2 = await req({
      path: '/api/documents', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, name: `unpublished_${RUN_ID}.pdf`, category: 'Report' }
    });
    const secretDoc2Id = secretDoc2.body?.id;

    const clientSearchDocs = await req({ path: `/api/search?q=unpublished_${RUN_ID}&project_id=${projectId}`, token: clientToken });
    assert(clientSearchDocs.status === 200 && clientSearchDocs.body.length === 0,
      'Global search respects Client visibility filtering even for a module the Client can otherwise view (documents)');

    const clientExportDocs = await req({ path: `/api/export/documents?project_id=${projectId}`, token: clientToken });
    assert(clientExportDocs.status === 200 && !String(clientExportDocs.body).includes(`unpublished_${RUN_ID}`),
      'CSV export of documents excludes unpublished records for a Client');

    const clientMarkupWrite = await req({ path: `/api/drawings/${secretDoc2Id}/markups`, method: 'POST', token: clientToken, body: { markup_data: '{}' } });
    assert(clientMarkupWrite.status === 403, 'Client (no documents edit access) forbidden from writing drawing markups (403)');

    const outsiderMarkupWrite = await req({ path: `/api/drawings/${secretDoc2Id}/markups`, method: 'POST', token: tokens['Subcontractor'], body: { markup_data: '{}' } });
    assert(outsiderMarkupWrite.status === 403, 'A project outsider (Subcontractor not on this project) forbidden from writing drawing markups (403)');

    const engineerMarkupWrite = await req({ path: `/api/drawings/${secretDoc2Id}/markups`, method: 'POST', token: tokens['SiteEngineer'], body: { markup_data: '{"strokes":[]}' } });
    assert(engineerMarkupWrite.status === 200, 'A real project member with documents edit access can still write markups');

    const engineerTriesPublish = await req({ path: `/api/documents/${secretDoc2Id}`, method: 'PUT', token: tokens['SiteEngineer'], body: { visibility: 'Client' } });
    assert(engineerTriesPublish.status === 403, 'A Site Engineer (has documents edit access) still cannot publish to the client - that needs Admin/PM specifically (403)');

    const pmPublishes = await req({ path: `/api/documents/${secretDoc2Id}`, method: 'PUT', token: tokens['ProjectManager'], body: { visibility: 'Client' } });
    assert(pmPublishes.status === 200 && pmPublishes.body.visibility === 'Client', 'A Project Manager can publish to the client');

    const contentEditAfterPublish = await req({ path: `/api/documents/${secretDoc2Id}`, method: 'PUT', token: tokens['SiteEngineer'], body: { category: 'Revised Report' } });
    assert(contentEditAfterPublish.status === 200 && contentEditAfterPublish.body.visibility === 'Internal' && !contentEditAfterPublish.body.published_by,
      'Editing a published document\'s content automatically un-publishes it, rather than leaving stale content visible to the client');

    const membersLockedDown = await req({ path: `/api/projects/${projectId}/members`, token: tokens['SiteEngineer'] });
    assert(membersLockedDown.status === 403, 'GET project members is Admin-only, not any project member (403 for Site Engineer)');

    const membersAdminOk = await req({ path: `/api/projects/${projectId}/members`, token: tokens['Admin'] });
    assert(membersAdminOk.status === 200 && Array.isArray(membersAdminOk.body), 'Admin can still list real project members');

    const clientSummaryLockedDown = await req({ path: `/api/projects/${projectId}/client-summary`, token: tokens['SiteEngineer'] });
    assert(clientSummaryLockedDown.status === 403, 'Client-summary endpoint is Client-role-only, not any project member (403 for Site Engineer)');

    const clientProjectsNoBudget = await req({ path: '/api/projects', token: clientToken });
    assert(clientProjectsNoBudget.status === 200 && clientProjectsNoBudget.body.every((p: any) => !('budget' in p)),
      'The Client never receives the internal budget figure from /api/projects');

    const adminProjectsHasBudget = await req({ path: '/api/projects', token: tokens['Admin'] });
    assert(adminProjectsHasBudget.status === 200 && adminProjectsHasBudget.body.some((p: any) => 'budget' in p),
      'Other roles still receive budget from /api/projects as before');

    console.log('\nSection 15: Upload size limit (was 50mb/~36MB real files, now 150mb/~110MB)');
    const sixtyMbBase64 = Buffer.alloc(60 * 1024 * 1024, 'a').toString('base64');
    const bigUpload = await req({
      path: '/api/documents', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, name: `big_upload_${RUN_ID}.pdf`, attachment_name: `big_${RUN_ID}.pdf`, attachment_data: `data:application/pdf;base64,${sixtyMbBase64}` }
    });
    assert(bigUpload.status === 201, 'A ~60MB attachment (over the old 50mb JSON limit, under the new 150mb one) uploads successfully');

    const twoHundredMbBase64 = Buffer.alloc(200 * 1024 * 1024, 'a').toString('base64');
    const tooBigUpload = await req({
      path: '/api/documents', method: 'POST', token: tokens['SiteEngineer'],
      body: { project_id: projectId, name: `too_big_${RUN_ID}.pdf`, attachment_name: `toobig_${RUN_ID}.pdf`, attachment_data: `data:application/pdf;base64,${twoHundredMbBase64}` }
    });
    assert(tooBigUpload.status === 413 && typeof tooBigUpload.body.error === 'string' && tooBigUpload.body.error.toLowerCase().includes('too large'),
      'An attachment over the new limit gets a clean, readable JSON error (not a bare text/html "Payload Too Large")');

    console.log('\nSection 16: Project document intelligence');
    const setupText = [
      'Project Name: Harbour MEP Upgrade',
      'Client: Example Developments Ltd',
      'Start Date: 01/10/2026',
      'Completion Date: 30/06/2027',
      'Contract Value: €4,850,000'
    ].join('\n');
    const setupDataUrl = 'data:text/plain;base64,' + Buffer.from(setupText).toString('base64');
    const setupDoc = await req({
      path: '/api/documents', method: 'POST', token: tokens['ProjectManager'],
      body: {
        project_id: projectId,
        name: 'Project Setup Contract',
        category: 'Contract',
        revision: 'Rev 0',
        date_added: '2026-09-20',
        attachment_name: 'project_setup.txt',
        attachment_data: setupDataUrl
      }
    });
    assert(setupDoc.status === 201 && !!setupDoc.body.id, 'Project Manager can upload a project setup document');

    const setupExtraction = await req({
      path: `/api/projects/${projectId}/extract-setup-data`, method: 'POST', token: tokens['ProjectManager'],
      body: { document_ids: [setupDoc.body.id] }
    });
    assert(setupExtraction.status === 200 && Array.isArray(setupExtraction.body.suggestions),
      'Project setup documents can be analyzed without writing project fields automatically');
    const extracted = Object.fromEntries((setupExtraction.body.suggestions || []).map((s: any) => [s.field, s.value]));
    assert(extracted.name === 'Harbour MEP Upgrade' && extracted.client === 'Example Developments Ltd',
      'Project setup extraction finds explicitly stated project name and client');
    assert(extracted.start_date === '2026-10-01' && extracted.end_date === '2027-06-30',
      'Project setup extraction normalizes explicitly stated project dates');
    assert(Number(extracted.budget) === 4850000,
      'Project setup extraction finds explicitly stated contract value');

    const beforeApply = await req({ path: '/api/projects', token: tokens['ProjectManager'] });
    const beforeProject = beforeApply.body.find((p: any) => p.id === projectId);
    assert(beforeProject && beforeProject.name !== 'Harbour MEP Upgrade',
      'Extraction is review-only: it does not silently overwrite the project');

    const applySetup = await req({
      path: `/api/projects/${projectId}`, method: 'PUT', token: tokens['ProjectManager'],
      body: {
        name: extracted.name,
        client: extracted.client,
        start_date: extracted.start_date,
        end_date: extracted.end_date,
        budget: extracted.budget
      }
    });
    assert(applySetup.status === 200 && applySetup.body.name === 'Harbour MEP Upgrade' && Number(applySetup.body.budget) === 4850000,
      'Project Manager can apply reviewed extracted project data');

    const setupDenied = await req({
      path: `/api/projects/${projectId}/extract-setup-data`, method: 'POST', token: tokens['SiteEngineer'],
      body: { document_ids: [setupDoc.body.id] }
    });
    assert(setupDenied.status === 403, 'Site Engineer cannot run project setup document extraction');

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
