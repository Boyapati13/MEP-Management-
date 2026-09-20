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
    try { await req({ path: `/api/users/${id}`, method: 'DELETE', token: adminToken }); } catch {}
  }
  for (const id of tempCompanyIds) {
    try { await req({ path: `/api/companies/${id}`, method: 'DELETE', token: adminToken }); } catch {}
  }
  for (const id of tempProjectIds) {
    try { await req({ path: `/api/projects/${id}`, method: 'DELETE', token: adminToken }); } catch {}
  }
}

async function runV11Tests() {
  console.log('===============================================================');
  console.log('MEP V1.1 MULTI-COMPANY & HARDENED SECURITY TEST SUITE');
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

    // 2. Create HVAC Subcontractor company
    const subComp = await req({
      path: '/api/companies', method: 'POST', token: adminToken,
      body: { name: `ThermoVent Solutions ${RUN_ID}`, type: 'Subcontractor', trade: 'HVAC', contact_name: 'Tom HVAC', contact_email: 'tom@thermovent.com', phone: '+353 1 888 9999' }
    });
    assert(subComp.status === 201 && !!subComp.body.id, 'Create Subcontractor company record (HVAC)');
    const subCompanyId = subComp.body?.id;
    if (subCompanyId) tempCompanyIds.push(subCompanyId);

    // 3. Create Electrical Subcontractor company
    const elecComp = await req({
      path: '/api/companies', method: 'POST', token: adminToken,
      body: { name: `VoltTech Electrical ${RUN_ID}`, type: 'Subcontractor', trade: 'Electrical', contact_name: 'Ed Electric', contact_email: 'ed@volttech.com', phone: '+353 1 777 6666' }
    });
    assert(elecComp.status === 201 && !!elecComp.body.id, 'Create Subcontractor company record (Electrical)');
    const elecCompanyId = elecComp.body?.id;
    if (elecCompanyId) tempCompanyIds.push(elecCompanyId);

    // 4. Create Client company
    const clientComp = await req({
      path: '/api/companies', method: 'POST', token: adminToken,
      body: { name: `National Bank Properties ${RUN_ID}`, type: 'Client', contact_name: 'Sarah Client', contact_email: 'sarah@natbank.com' }
    });
    assert(clientComp.status === 201 && !!clientComp.body.id, 'Create Client company record');
    const clientCompanyId = clientComp.body?.id;
    if (clientCompanyId) tempCompanyIds.push(clientCompanyId);

    // 5. Create Second Client company (for Project B)
    const clientBComp = await req({
      path: '/api/companies', method: 'POST', token: adminToken,
      body: { name: `TechCorp Commercial ${RUN_ID}`, type: 'Client', contact_name: 'Bob Client', contact_email: 'bob@techcorp.com' }
    });
    assert(clientBComp.status === 201 && !!clientBComp.body.id, 'Create Client B company record');
    const clientBCompanyId = clientBComp.body?.id;
    if (clientBCompanyId) tempCompanyIds.push(clientBCompanyId);

    // 6. Create Consultant company
    const consultComp = await req({
      path: '/api/companies', method: 'POST', token: adminToken,
      body: { name: `Arup MEP Consultants ${RUN_ID}`, type: 'Consultant', contact_name: 'David Engineer', contact_email: 'david@arup.com' }
    });
    assert(consultComp.status === 201 && !!consultComp.body.id, 'Create Consultant company record');
    const consultCompanyId = consultComp.body?.id;
    if (consultCompanyId) tempCompanyIds.push(consultCompanyId);

    // List companies
    const listComp = await req({ path: '/api/companies', token: adminToken });
    assert(listComp.status === 200 && listComp.body.length >= 6, 'List all companies');

    console.log('\n--- Test Group 2: Projects & Participating Companies ---');
    // Create Project A: Bank Branch Refurbishment
    const projA = await req({
      path: '/api/projects', method: 'POST', token: adminToken,
      body: { name: `Bank Branch Refurbishment ${RUN_ID}`, client: 'National Bank Properties', status: 'Active', start_date: '2026-10-01', end_date: '2027-04-30', budget: 1250000 }
    });
    assert(projA.status === 201 && !!projA.body.id, 'Create Project A (Bank Branch)');
    const projectId = projA.body?.id;
    if (projectId) tempProjectIds.push(projectId);

    // Create Project B: TechCorp Data Center (for multi-tenant isolation testing)
    const projB = await req({
      path: '/api/projects', method: 'POST', token: adminToken,
      body: { name: `TechCorp Regional Data Center ${RUN_ID}`, client: 'TechCorp Commercial', status: 'Active', start_date: '2026-11-01', end_date: '2027-08-30', budget: 4500000 }
    });
    assert(projB.status === 201 && !!projB.body.id, 'Create Project B (Data Center)');
    const projectBId = projB.body?.id;
    if (projectBId) tempProjectIds.push(projectBId);

    // Add Participating Companies to Project A
    await req({
      path: `/api/projects/${projectId}/companies`, method: 'POST', token: adminToken,
      body: { company_id: mcCompanyId, role_in_project: 'Main Contractor' }
    });
    await req({
      path: `/api/projects/${projectId}/companies`, method: 'POST', token: adminToken,
      body: { company_id: subCompanyId, role_in_project: 'Subcontractor' }
    });
    await req({
      path: `/api/projects/${projectId}/companies`, method: 'POST', token: adminToken,
      body: { company_id: elecCompanyId, role_in_project: 'Subcontractor' }
    });
    await req({
      path: `/api/projects/${projectId}/companies`, method: 'POST', token: adminToken,
      body: { company_id: clientCompanyId, role_in_project: 'Client' }
    });

    // Add Participating Companies to Project B
    await req({
      path: `/api/projects/${projectBId}/companies`, method: 'POST', token: adminToken,
      body: { company_id: mcCompanyId, role_in_project: 'Main Contractor' }
    });
    await req({
      path: `/api/projects/${projectBId}/companies`, method: 'POST', token: adminToken,
      body: { company_id: clientBCompanyId, role_in_project: 'Client' }
    });

    const projACompanies = await req({ path: `/api/projects/${projectId}/companies`, token: adminToken });
    assert(projACompanies.status === 200 && projACompanies.body.length === 4, 'Verify Project A participating companies list (4 companies)');

    console.log('\n--- Test Group 3: Work Packages ---');
    // 1. HVAC Package on Project A
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
    assert(hvacPackage.status === 201 && !!hvacPackage.body.id, 'Create HVAC Work Package assigned to ThermoVent');
    const hvacPackageId = hvacPackage.body?.id;

    // 2. Electrical Package on Project A
    const elecPackage = await req({
      path: '/api/work_packages', method: 'POST', token: adminToken,
      body: {
        project_id: projectId,
        code: 'WP-ELEC-01',
        name: 'Electrical Distribution & Containment',
        discipline: 'Electrical',
        scope_description: 'Cable trays, distribution boards, primary feeds, and sub-circuits.',
        company_id: elecCompanyId,
        planned_start: '2026-10-20',
        planned_end: '2027-02-15',
        contract_value: 290000,
        status: 'Active'
      }
    });
    assert(elecPackage.status === 201 && !!elecPackage.body.id, 'Create Electrical Work Package assigned to VoltTech');
    const elecPackageId = elecPackage.body?.id;

    console.log('\n--- Test Group 4: Users with Company & Work Package Assignment ---');
    // 1. Subcontractor User - HVAC
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
        trade: 'HVAC',
        project_ids: [projectId]
      }
    });
    assert(createSubUser.status === 201 && !!createSubUser.body.id, 'Create HVAC Subcontractor user');
    const subUserId = createSubUser.body?.id;
    if (subUserId) tempUserIds.push(subUserId);

    const subLogin = await req({ path: '/api/login', method: 'POST', body: { username: subUsername, password: subPassword } });
    assert(subLogin.status === 200 && !!subLogin.body.token, 'Log in as HVAC Subcontractor');
    const subToken = subLogin.body?.token;

    // 2. Subcontractor User - Electrical
    const elecUsername = `elec_lead_${RUN_ID}`;
    const elecPassword = `Elec${RUN_ID}!pw`;
    const createElecUser = await req({
      path: '/api/users', method: 'POST', token: adminToken,
      body: {
        username: elecUsername,
        name: 'Ed Electrical Specialist',
        password: elecPassword,
        role: 'Subcontractor',
        company_id: elecCompanyId,
        work_package_id: elecPackageId,
        trade: 'Electrical',
        project_ids: [projectId]
      }
    });
    assert(createElecUser.status === 201 && !!createElecUser.body.id, 'Create Electrical Subcontractor user');
    const elecUserId = createElecUser.body?.id;
    if (elecUserId) tempUserIds.push(elecUserId);

    const elecLogin = await req({ path: '/api/login', method: 'POST', body: { username: elecUsername, password: elecPassword } });
    assert(elecLogin.status === 200 && !!elecLogin.body.token, 'Log in as Electrical Subcontractor');
    const elecToken = elecLogin.body?.token;

    // 3. Unassigned User - Same Electrical Company, but NO project membership on Project A
    const unassignedUsername = `unassigned_elec_${RUN_ID}`;
    const unassignedPassword = `Unassigned${RUN_ID}!pw`;
    const createUnassignedUser = await req({
      path: '/api/users', method: 'POST', token: adminToken,
      body: {
        username: unassignedUsername,
        name: 'Unassigned Electrical Tech',
        password: unassignedPassword,
        role: 'Subcontractor',
        company_id: elecCompanyId,
        trade: 'Electrical',
        project_ids: [] // Deliberately NOT assigned to Project A
      }
    });
    assert(createUnassignedUser.status === 201 && !!createUnassignedUser.body.id, 'Create Unassigned user in Electrical company without project membership');
    const unassignedUserId = createUnassignedUser.body?.id;
    if (unassignedUserId) tempUserIds.push(unassignedUserId);

    const unassignedLogin = await req({ path: '/api/login', method: 'POST', body: { username: unassignedUsername, password: unassignedPassword } });
    assert(unassignedLogin.status === 200 && !!unassignedLogin.body.token, 'Log in as Unassigned user');
    const unassignedToken = unassignedLogin.body?.token;

    // 4. Client A User (Assigned to Project A)
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
    assert(createClientUser.status === 201 && !!createClientUser.body.id, 'Create Client A user linked to Project A');
    const clientUserId = createClientUser.body?.id;
    if (clientUserId) tempUserIds.push(clientUserId);

    const clientLogin = await req({ path: '/api/login', method: 'POST', body: { username: clientUsername, password: clientPassword } });
    assert(clientLogin.status === 200 && !!clientLogin.body.token, 'Log in as Client A');
    const clientToken = clientLogin.body?.token;

    // 5. Client B User (Assigned exclusively to Project B)
    const clientBUsername = `client_b_${RUN_ID}`;
    const clientBPassword = `ClientB${RUN_ID}!pw`;
    const createClientBUser = await req({
      path: '/api/users', method: 'POST', token: adminToken,
      body: {
        username: clientBUsername,
        name: 'Bob TechCorp Client Rep',
        password: clientBPassword,
        role: 'Client',
        company_id: clientBCompanyId,
        project_ids: [projectBId] // Exclusively Project B
      }
    });
    assert(createClientBUser.status === 201 && !!createClientBUser.body.id, 'Create Client B user assigned exclusively to Project B');
    const clientBUserId = createClientBUser.body?.id;
    if (clientBUserId) tempUserIds.push(clientBUserId);

    const clientBLogin = await req({ path: '/api/login', method: 'POST', body: { username: clientBUsername, password: clientBPassword } });
    assert(clientBLogin.status === 200 && !!clientBLogin.body.token, 'Log in as Client B');
    const clientBToken = clientBLogin.body?.token;

    // 6. PM User (Assigned to Project A & Project B)
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
        project_ids: [projectId, projectBId]
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

    console.log('\n--- Test Group 9: Strict Cross-Trade & Work Package Isolation (P0) ---');
    // HVAC subcontractor creates an HVAC task
    const hvacTaskRes = await req({
      path: '/api/tasks', method: 'POST', token: subToken,
      body: {
        project_id: projectId,
        title: `Install AHU-01 Primary Ductwork ${RUN_ID}`,
        trade: 'HVAC',
        start: '2026-10-15',
        end: '2026-11-15',
        status: 'In Progress',
        progress: 40,
        work_package_id: hvacPackageId,
        company_id: subCompanyId
      }
    });
    assert(hvacTaskRes.status === 201 && !!hvacTaskRes.body.id, 'HVAC subcontractor creates HVAC task under WP-HVAC-01');
    const hvacTaskId = hvacTaskRes.body?.id;

    // 1. Cross-trade read isolation: Electrical user CANNOT see the HVAC task in task list
    const elecTasks = await req({ path: `/api/tasks?project_id=${projectId}`, token: elecToken });
    const hasHvacTask = Array.isArray(elecTasks.body) && elecTasks.body.some((t: any) => t.id === hvacTaskId);
    assert(!hasHvacTask, 'Electrical user CANNOT view HVAC tasks in /api/tasks query');

    // 2. Cross-trade update isolation: Electrical user receives 403 on PUT
    const putHvacTask = await req({
      path: `/api/tasks/${hvacTaskId}`, method: 'PUT', token: elecToken,
      body: { title: 'Tampered by Electrical Specialist' }
    });
    assert(putHvacTask.status === 403, 'Electrical user receives 403 Forbidden when attempting to update HVAC task');

    // 3. Cross-trade creation isolation: Electrical user receives 403 when trying to create a task bound to HVAC package
    const postForeignWpTask = await req({
      path: '/api/tasks', method: 'POST', token: elecToken,
      body: {
        project_id: projectId,
        title: 'Tampered task targeting HVAC package',
        work_package_id: hvacPackageId,
        trade: 'HVAC'
      }
    });
    assert(postForeignWpTask.status === 403, 'Electrical user receives 403 Forbidden when attempting to POST record under HVAC work package');

    // 4. Cross-trade workflow transition isolation: Electrical user receives 403 on transition
    const transForeignTask = await req({
      path: `/api/tasks/${hvacTaskId}/transition`, method: 'POST', token: elecToken,
      body: { status: 'Completed' }
    });
    assert(transForeignTask.status === 403, 'Electrical user receives 403 Forbidden when attempting to transition HVAC task');

    // Create an HVAC punchlist item with controlled workflow
    const hvacPunchRes = await req({
      path: '/api/punchlist', method: 'POST', token: subToken,
      body: {
        project_id: projectId,
        item: `Damper actuator wiring incomplete ${RUN_ID}`,
        work_package_id: hvacPackageId,
        company_id: subCompanyId,
        status: 'Open'
      }
    });
    assert(hvacPunchRes.status === 201 && !!hvacPunchRes.body.id, 'HVAC subcontractor creates punchlist item');
    const hvacPunchId = hvacPunchRes.body?.id;

    const transForeignPunch = await req({
      path: `/api/punchlist/${hvacPunchId}/transition`, method: 'POST', token: elecToken,
      body: { status: 'In Progress' }
    });
    assert(transForeignPunch.status === 403, 'Electrical user receives 403 Forbidden when attempting to transition HVAC punchlist item');

    // 5. Cross-trade delete isolation: Electrical user receives 403 on DELETE
    const deleteForeignTask = await req({
      path: `/api/tasks/${hvacTaskId}`, method: 'DELETE', token: elecToken
    });
    assert(deleteForeignTask.status === 403, 'Electrical user receives 403 Forbidden when attempting to delete HVAC task');

    console.log('\n--- Test Group 10: Subcontractor Progress Submission Isolation (P0) ---');
    // 1. Electrical user cannot see HVAC progress submissions
    const elecSubmissions = await req({ path: `/api/progress_submissions?project_id=${projectId}`, token: elecToken });
    const hasHvacClaim = Array.isArray(elecSubmissions.body) && elecSubmissions.body.some((ps: any) => ps.id === claimId);
    assert(!hasHvacClaim, 'Electrical user CANNOT view HVAC progress submissions in /api/progress_submissions');

    // 2. Electrical user receives 403 when submitting progress against HVAC work package
    const postForeignClaim = await req({
      path: '/api/progress_submissions', method: 'POST', token: elecToken,
      body: {
        project_id: projectId,
        work_package_id: hvacPackageId,
        period_date: '2026-11-30',
        claimed_percentage: 50
      }
    });
    assert(postForeignClaim.status === 403, 'Electrical user receives 403 Forbidden when submitting progress against HVAC work package');

    console.log('\n--- Test Group 11: Multi-Project & Client Isolation (P0/P1) ---');
    // Client A attempting to access Project B
    const clientAOnProjB = await req({ path: `/api/projects/${projectBId}/client-summary`, token: clientToken });
    assert(clientAOnProjB.status === 403, 'Client A receives 403 Forbidden when accessing Project B client summary');

    const clientADocsOnProjB = await req({ path: `/api/documents?project_id=${projectBId}`, token: clientToken });
    assert(clientADocsOnProjB.status === 403, 'Client A receives 403 Forbidden when accessing documents from Project B');

    console.log('\n--- Test Group 12: Explicit Individual Membership Enforcement (P0) ---');
    // Unassigned user in VoltTech (participating company in Project A) has NO individual project membership
    const unassignedTasks = await req({ path: `/api/tasks?project_id=${projectId}`, token: unassignedToken });
    assert(unassignedTasks.status === 403, 'Unassigned same-company user receives 403 without explicit individual membership');

    console.log('\n--- Test Group 13: Work Packages & Company Directory Boundaries (P1) ---');
    // 1. Client cannot query work packages
    const clientWp = await req({ path: `/api/work_packages?project_id=${projectId}`, token: clientToken });
    assert(clientWp.status === 403, 'Client receives 403 Forbidden when accessing internal work packages endpoint');

    // 2. Client cannot query project companies directory
    const clientCompanies = await req({ path: `/api/projects/${projectId}/companies`, token: clientToken });
    assert(clientCompanies.status === 403, 'Client receives 403 Forbidden when accessing project companies directory');

    // 3. Subcontractor cannot query project companies directory
    const subCompanies = await req({ path: `/api/projects/${projectId}/companies`, token: subToken });
    assert(subCompanies.status === 403, 'Subcontractor receives 403 Forbidden when accessing project companies directory');

    console.log('\n--- Test Group 14: Client Progress Leakage Prevention (P1) ---');
    // Create an internal task on Project B (85% progress)
    await req({
      path: '/api/tasks', method: 'POST', token: adminToken,
      body: {
        project_id: projectBId,
        title: 'Project B Internal Commissioning Task',
        progress: 85,
        status: 'In Progress',
        start: '2026-11-01',
        end: '2026-12-01'
      }
    });

    // Client B requests client summary on Project B where NO progress report has been published
    const clientBSummary = await req({ path: `/api/projects/${projectBId}/client-summary`, token: clientBToken });
    assert(
      clientBSummary.status === 200 &&
      clientBSummary.body?.overall_progress === null &&
      clientBSummary.body?.progress_status === 'Progress not yet published',
      'Client summary reports null progress ("Progress not yet published") without falling back to internal tasks'
    );

    console.log('\n--- Test Group 15: Firebase Auth Hardening (P0) ---');
    // 1. Plain unauthenticated firebase_uid payload is rejected with 401
    const fakeFirebaseReq = await req({
      path: '/api/firebase-auth-login', method: 'POST',
      body: { firebase_uid: 'attacker_fake_uid_999' }
    });
    assert(fakeFirebaseReq.status === 401, 'POST /api/firebase-auth-login strictly rejects raw unauthenticated firebase_uid with 401');

    // 2. Forged/invalid JWT token is rejected with 401
    const invalidTokenReq = await req({
      path: '/api/firebase-auth-login', method: 'POST',
      body: { id_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6IkFkbWluIn0.signature' }
    });
    assert(invalidTokenReq.status === 401, 'POST /api/firebase-auth-login rejects unregistered/invalid token identity with 401');

    console.log('\n--- Test Group 16: Instant Session Revocation on User Deactivation (P1) ---');
    // Deactivate electrical user
    const deactivateRes = await req({
      path: `/api/users/${elecUserId}`, method: 'PUT', token: adminToken,
      body: { status: 'Inactive' }
    });
    assert(deactivateRes.status === 200 && deactivateRes.body?.status === 'Inactive', 'Admin deactivates electrical user');

    // Electrical user's next request with existing session token MUST immediately be rejected with 401!
    const revokedReq = await req({ path: `/api/tasks?project_id=${projectId}`, token: elecToken });
    assert(revokedReq.status === 401, 'Deactivated user session token is immediately revoked with 401 on subsequent request');

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
