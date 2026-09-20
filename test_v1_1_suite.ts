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

const RUN_ID = Date.now().toString().slice(-6);
const tempUserIds: string[] = [];
const tempProjectIds: string[] = [];
const tempCompanyIds: string[] = [];

async function cleanup(adminToken: string) {
  for (const id of tempUserIds) {
    await req({ path: `/api/users/${id}`, method: 'DELETE', token: adminToken });
  }
  for (const id of tempCompanyIds) {
    await req({ path: `/api/companies/${id}`, method: 'DELETE', token: adminToken });
  }
  for (const id of tempProjectIds) {
    await req({ path: `/api/projects/${id}`, method: 'DELETE', token: adminToken });
  }
}

async function runV11Tests() {
  console.log('===============================================================');
  console.log('MEP V1.1 MULTI-COMPANY & CONSTRUCTION HIERARCHY TEST SUITE');
  console.log('===============================================================\n');

  const adminLogin = await req({ path: '/api/login', method: 'POST', body: { username: 'admin', password: 'ChangeMe123!' } });
  assert(adminLogin.status === 200 && !!adminLogin.body.token, 'Admin authentication');
  const adminToken = adminLogin.body?.token;
  if (!adminToken) {
    console.error('Failed to authenticate as Admin.');
    process.exit(1);
  }

  try {
    console.log('\n--- Test Group 1: Companies Master & Types ---');
    // 1. Create Main Contractor company
    const mcComp = await req({
      path: '/api/companies', method: 'POST', token: adminToken,
      body: { name: `Apex Prime Contracting ${RUN_ID}`, type: 'Main Contractor', contact_name: 'John Apex', contact_email: 'john@apex.com', phone: '+353 1 234 5678' }
    });
    assert(mcComp.status === 201 && !!mcComp.body.id, 'Create Main Contractor company record');
    const mcCompanyId = mcComp.body?.id;
    if (mcCompanyId) tempCompanyIds.push(mcCompanyId);

    // 2. Create Subcontractor company
    const subComp = await req({
      path: '/api/companies', method: 'POST', token: adminToken,
      body: { name: `ThermoVent Solutions ${RUN_ID}`, type: 'Subcontractor', contact_name: 'Tom HVAC', contact_email: 'tom@thermovent.com', phone: '+353 1 888 9999' }
    });
    assert(subComp.status === 201 && !!subComp.body.id, 'Create Subcontractor company record');
    const subCompanyId = subComp.body?.id;
    if (subCompanyId) tempCompanyIds.push(subCompanyId);

    // 3. Create Client company
    const clientComp = await req({
      path: '/api/companies', method: 'POST', token: adminToken,
      body: { name: `National Bank Properties ${RUN_ID}`, type: 'Client', contact_name: 'Sarah Client', contact_email: 'sarah@natbank.com' }
    });
    assert(clientComp.status === 201 && !!clientComp.body.id, 'Create Client company record');
    const clientCompanyId = clientComp.body?.id;
    if (clientCompanyId) tempCompanyIds.push(clientCompanyId);

    // 4. Create Consultant company
    const consultComp = await req({
      path: '/api/companies', method: 'POST', token: adminToken,
      body: { name: `Arup MEP Consultants ${RUN_ID}`, type: 'Consultant', contact_name: 'David Engineer', contact_email: 'david@arup.com' }
    });
    assert(consultComp.status === 201 && !!consultComp.body.id, 'Create Consultant company record');
    const consultCompanyId = consultComp.body?.id;
    if (consultCompanyId) tempCompanyIds.push(consultCompanyId);

    // List companies
    const listComp = await req({ path: '/api/companies', token: adminToken });
    assert(listComp.status === 200 && listComp.body.length >= 4, 'List all companies');

    console.log('\n--- Test Group 2: Projects & Participating Companies ---');
    // Create Bank Branch Refurbishment Project
    const proj = await req({
      path: '/api/projects', method: 'POST', token: adminToken,
      body: { name: `Bank Branch Refurbishment ${RUN_ID}`, client: 'National Bank Properties', status: 'Active', start_date: '2026-10-01', end_date: '2027-04-30', budget: 1250000 }
    });
    assert(proj.status === 201 && !!proj.body.id, 'Create Bank Branch Refurbishment project');
    const projectId = proj.body?.id;
    if (projectId) tempProjectIds.push(projectId);

    // Add Participating Companies
    const addMcToProj = await req({
      path: `/api/projects/${projectId}/companies`, method: 'POST', token: adminToken,
      body: { company_id: mcCompanyId, role_in_project: 'Main Contractor' }
    });
    assert(addMcToProj.status === 201, 'Associate Main Contractor company to project');

    const addSubToProj = await req({
      path: `/api/projects/${projectId}/companies`, method: 'POST', token: adminToken,
      body: { company_id: subCompanyId, role_in_project: 'Subcontractor' }
    });
    assert(addSubToProj.status === 201, 'Associate Subcontractor company to project');

    const projCompanies = await req({ path: `/api/projects/${projectId}/companies`, token: adminToken });
    assert(projCompanies.status === 200 && projCompanies.body.length === 2, 'Verify project participating companies list');

    console.log('\n--- Test Group 3: Work Packages ---');
    const hvacPackage = await req({
      path: '/api/work_packages', method: 'POST', token: adminToken,
      body: {
        project_id: projectId,
        code: 'WP-HVAC-01',
        name: 'HVAC Air Handling & Ductwork Installation',
        discipline: 'HVAC',
        scope_description: 'Complete supply and installation of AHU, supply/extract ducts, fire dampers, and diffusers.',
        company_id: subCompanyId,
        planned_start: '2026-10-15',
        planned_end: '2027-01-30',
        contract_value: 320000,
        status: 'Active'
      }
    });
    assert(hvacPackage.status === 201 && !!hvacPackage.body.id, 'Create HVAC Work Package assigned to Subcontractor company');
    const hvacPackageId = hvacPackage.body?.id;

    const listWp = await req({ path: `/api/work_packages?project_id=${projectId}`, token: adminToken });
    assert(listWp.status === 200 && listWp.body.length === 1 && listWp.body[0].code === 'WP-HVAC-01', 'Retrieve Work Packages for project');

    console.log('\n--- Test Group 4: Users with Company & Work Package Assignment ---');
    // Subcontractor User
    const subUsername = `hvac_lead_${RUN_ID}`;
    const subPassword = `Hvac${RUN_ID}!pw`;
    const createSubUser = await req({
      path: '/api/users', method: 'POST', token: adminToken,
      body: {
        username: subUsername,
        name: 'Tom HVAC Engineer',
        password: subPassword,
        role: 'Subcontractor',
        company_id: subCompanyId,
        work_package_id: hvacPackageId,
        project_ids: [projectId]
      }
    });
    assert(createSubUser.status === 201 && !!createSubUser.body.id, 'Create Subcontractor user linked to Company & Work Package');
    const subUserId = createSubUser.body?.id;
    if (subUserId) tempUserIds.push(subUserId);

    const subLogin = await req({ path: '/api/login', method: 'POST', body: { username: subUsername, password: subPassword } });
    assert(subLogin.status === 200 && !!subLogin.body.token, 'Log in as Subcontractor linked user');
    const subToken = subLogin.body?.token;

    // Client User
    const clientUsername = `client_rep_${RUN_ID}`;
    const clientPassword = `Client${RUN_ID}!pw`;
    const createClientUser = await req({
      path: '/api/users', method: 'POST', token: adminToken,
      body: {
        username: clientUsername,
        name: 'Sarah Bank Client Rep',
        password: clientPassword,
        role: 'Client',
        company_id: clientCompanyId,
        project_ids: [projectId]
      }
    });
    assert(createClientUser.status === 201 && !!createClientUser.body.id, 'Create Client user linked to Client Company');
    const clientUserId = createClientUser.body?.id;
    if (clientUserId) tempUserIds.push(clientUserId);

    const clientLogin = await req({ path: '/api/login', method: 'POST', body: { username: clientUsername, password: clientPassword } });
    assert(clientLogin.status === 200 && !!clientLogin.body.token, 'Log in as Client linked user');
    const clientToken = clientLogin.body?.token;

    // PM User
    const pmUsername = `pm_user_${RUN_ID}`;
    const pmPassword = `Pm${RUN_ID}!pw`;
    const createPmUser = await req({
      path: '/api/users', method: 'POST', token: adminToken,
      body: {
        username: pmUsername,
        name: 'Paul Project Manager',
        password: pmPassword,
        role: 'ProjectManager',
        company_id: mcCompanyId,
        project_ids: [projectId]
      }
    });
    assert(createPmUser.status === 201 && !!createPmUser.body.id, 'Create Project Manager user');
    const pmUserId = createPmUser.body?.id;
    if (pmUserId) tempUserIds.push(pmUserId);

    const pmLogin = await req({ path: '/api/login', method: 'POST', body: { username: pmUsername, password: pmPassword } });
    assert(pmLogin.status === 200 && !!pmLogin.body.token, 'Log in as PM user');
    const pmToken = pmLogin.body?.token;

    console.log('\n--- Test Group 5: Clarifications Hub ---');
    const clarRes = await req({
      path: '/api/clarifications', method: 'POST', token: subToken,
      body: {
        project_id: projectId,
        work_package_id: hvacPackageId,
        clarification_number: `CLR-HVAC-${RUN_ID}`,
        title: 'Duct routing clash with existing structural beam at Grid B4',
        question: 'Existing 300mm steel beam clashes with primary supply duct. Requesting approval to offset duct by 150mm down.',
        discipline: 'HVAC',
        priority: 'High',
        status: 'Submitted'
      }
    });
    assert(clarRes.status === 201 && !!clarRes.body.id, 'Subcontractor posts a Clarification');
    const clarificationId = clarRes.body?.id;

    // Add a message thread
    const msgRes = await req({
      path: `/api/clarifications/${clarificationId}/messages`, method: 'POST', token: pmToken,
      body: {
        message: 'Site inspection confirmed beam depth. Offset is acceptable provided acoustic ceiling clearance of min 2.4m is maintained.'
      }
    });
    assert(msgRes.status === 201 && !!msgRes.body.id, 'PM posts a response message to the Clarification');

    const getClar = await req({ path: `/api/clarifications/${clarificationId}`, token: subToken });
    assert(getClar.status === 200 && Array.isArray(getClar.body.messages) && getClar.body.messages.length === 1, 'Subcontractor retrieves clarification with threaded conversation');

    // Close clarification
    const closeClar = await req({
      path: `/api/clarifications/${clarificationId}`, method: 'PUT', token: pmToken,
      body: { status: 'Closed', official_response: 'Approved as per PM note.' }
    });
    assert(closeClar.status === 200 && closeClar.body.status === 'Closed', 'PM closes clarification with official response');

    console.log('\n--- Test Group 6: Subcontractor Progress Claims & Verification ---');
    const claimRes = await req({
      path: '/api/progress_submissions', method: 'POST', token: subToken,
      body: {
        project_id: projectId,
        work_package_id: hvacPackageId,
        period_date: '2026-11-30',
        claimed_percentage: 35,
        quantity_installed: 140,
        unit: 'm ductwork',
        notes: 'Ground floor main ductwork and branch connections completed'
      }
    });
    assert(claimRes.status === 201 && !!claimRes.body.id, 'Subcontractor submits a progress claim');
    const claimId = claimRes.body?.id;

    // PM verifies and approves with adjustment
    const verifyClaim = await req({
      path: `/api/progress_submissions/${claimId}`, method: 'PUT', token: pmToken,
      body: {
        status: 'Approved with Adjustments',
        verified_percentage: 30,
        review_comments: 'Site measurement confirmed 120m installed; 20m awaiting damper installation.'
      }
    });
    assert(verifyClaim.status === 200 && verifyClaim.body.verified_percentage === 30, 'PM verifies and adjusts progress claim');

    console.log('\n--- Test Group 7: Published Progress Reports & Client Isolation ---');
    const reportRes = await req({
      path: '/api/progress_reports', method: 'POST', token: pmToken,
      body: {
        project_id: projectId,
        report_number: `PR-2026-11-${RUN_ID}`,
        title: 'Monthly MEP Progress Report - November 2026',
        period_start: '2026-11-01',
        period_end: '2026-11-30',
        executive_summary: 'Overall MEP installations on track for milestone handover.',
        overall_progress_actual: 28.5,
        overall_progress_planned: 30.0,
        hvac_progress: 30.0,
        electrical_progress: 25.0,
        plumbing_progress: 32.0,
        fire_progress: 20.0,
        bms_progress: 15.0,
        lookahead_narrative: 'Commence branch piping and switchboard wiring in December.',
        status: 'Draft'
      }
    });
    assert(reportRes.status === 201 && !!reportRes.body.id, 'PM drafts a monthly progress report');
    const reportId = reportRes.body?.id;

    // Client should NOT see draft report
    const clientReportsDraft = await req({ path: `/api/progress_reports?project_id=${projectId}`, token: clientToken });
    assert(clientReportsDraft.status === 200 && clientReportsDraft.body.length === 0, 'Client cannot see Draft progress reports');

    // PM Publishes report
    const publishReport = await req({
      path: `/api/progress_reports/${reportId}`, method: 'PUT', token: pmToken,
      body: { status: 'Published' }
    });
    assert(publishReport.status === 200 && publishReport.body.status === 'Published', 'PM publishes progress report to Client');

    // Client now sees published report
    const clientReportsPub = await req({ path: `/api/progress_reports?project_id=${projectId}`, token: clientToken });
    assert(clientReportsPub.status === 200 && clientReportsPub.body.length === 1 && clientReportsPub.body[0].id === reportId, 'Client can see Published progress report');

    console.log('\n--- Test Group 8: Transmittals & Document Distribution ---');
    const transmittalRes = await req({
      path: '/api/transmittals', method: 'POST', token: pmToken,
      body: {
        project_id: projectId,
        transmittal_number: `TR-MEP-${RUN_ID}`,
        title: 'Approved HVAC Level 2 Shop Drawings Distribution',
        sender_company_id: mcCompanyId,
        recipient_company_id: subCompanyId,
        purpose: 'For Construction',
        sent_date: new Date().toISOString().slice(0, 10),
        status: 'Issued'
      }
    });
    assert(transmittalRes.status === 201 && !!transmittalRes.body.id, 'PM issues a Transmittal record');

  } finally {
    await cleanup(adminToken);
  }

  console.log('\n===============================================================');
  console.log(`V1.1 TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runV11Tests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
