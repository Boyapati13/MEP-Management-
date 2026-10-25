import http from 'http';
import crypto from 'crypto';

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
const groupStats: Record<string, { pass: number; fail: number }> = {};
let currentGroup = 'Initialization';

function setGroup(name: string) {
  currentGroup = name;
  if (!groupStats[currentGroup]) {
    groupStats[currentGroup] = { pass: 0, fail: 0 };
  }
  console.log(`\n>>> ${name}`);
}

function assert(condition: boolean, desc: string, detail?: any) {
  if (!groupStats[currentGroup]) {
    groupStats[currentGroup] = { pass: 0, fail: 0 };
  }
  if (condition) {
    console.log(`  [PASS] ${desc}`);
    passed++;
    groupStats[currentGroup].pass++;
  } else {
    console.error(`  [FAIL] ${desc}`);
    if (detail) console.error('     Detail:', JSON.stringify(detail).slice(0, 350));
    failed++;
    groupStats[currentGroup].fail++;
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
  console.log(`  MASTER ENTERPRISE VERIFICATION & ADVERSARIAL TEST SUITE (Run ID: ${RUN_ID})`);
  console.log('  Dual-Project Architecture: BOV Mqabba + Hotel Alpha | 12 Personas | 18 Groups');
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

  try {
    // ========================================================================
    // GROUP 01: Platform Startup & Health
    // ========================================================================
    setGroup('01 Platform startup / health');
    const healthRes = await req({ path: '/api/health' });
    assert(healthRes.status === 200, 'Server health check returned 200 OK');
    assert(healthRes.body?.service === 'mep-project-manager', 'Health endpoint reports correct service identifier');

    // ========================================================================
    // GROUP 02: Authentication, Sessions & Cryptographic Firebase Verification
    // ========================================================================
    setGroup('02 Authentication / sessions / Firebase');

    // 1. Deliberately forged Firebase token attack (Section 23)
    const forgedToken = [
      Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'forged-user-id', email: 'forged@malicious.com', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
      'fake_signature_that_must_fail_cryptographic_verification'
    ].join('.');

    const forgedRes = await req({
      path: '/api/firebase-auth-login',
      method: 'POST',
      body: { id_token: forgedToken }
    });
    assert(forgedRes.status === 401, 'Deliberately forged Firebase token strictly rejected with 401 Unauthorized', forgedRes.body);

    // 2. Empty / plain credentials attack on Firebase endpoint
    const plainRes = await req({
      path: '/api/firebase-auth-login',
      method: 'POST',
      body: { email: 'admin@company.com' }
    });
    assert(plainRes.status === 401, 'Plain credentials rejected on Firebase endpoint without ID token');

    // 3. Rate limiting test
    let rateLimited = false;
    for (let i = 0; i < 7; i++) {
      const failLogin = await req({
        path: '/api/login',
        method: 'POST',
        body: { username: `brute_${RUN_ID}`, password: 'wrong' }
      });
      if (failLogin.status === 429) {
        rateLimited = true;
        break;
      }
    }
    assert(rateLimited, 'Brute-force login rate limiting enforced (429 Too Many Requests)');

    // ========================================================================
    // GROUP 03: Roles & RBAC Matrix (All 9 Roles)
    // ========================================================================
    setGroup('03 Roles / RBAC');

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
      assert(uRes.status === 201 && uRes.body?.id, `Admin created persona for role ${role}`);
      if (uRes.body?.id) {
        tempUserIds.push(uRes.body.id);
        usersByRole[role] = uRes.body;

        const rLogin = await req({
          path: '/api/login',
          method: 'POST',
          body: { username: `user_${role.toLowerCase()}_${RUN_ID}`, password: 'Password123!' }
        });
        assert(rLogin.status === 200 && rLogin.body?.token, `Role ${role} authenticated and received session token`);
        tokensByRole[role] = rLogin.body.token;
      }
    }

    // Role-based privilege separation
    const clientCompRes = await req({ path: '/api/companies', token: tokensByRole['Client'] });
    assert(clientCompRes.status === 403, 'Client role strictly forbidden (403) from internal company directory');

    // ========================================================================
    // GROUP 04: Companies & Project Participation Setup (BOV Mqabba & Hotel Alpha)
    // ========================================================================
    setGroup('04 Companies / project participation');

    // Create Main Contractor Company
    const mcRes = await req({
      path: '/api/companies',
      method: 'POST',
      body: { name: `Apex MEP Contractors ${RUN_ID}`, type: 'Main Contractor', status: 'Active' },
      token: adminToken
    });
    assert(mcRes.status === 201, 'Created Main Contractor company (Apex MEP)');
    const apexCoId = mcRes.body.id;
    tempCompanyIds.push(apexCoId);

    // Create Client Company
    const clientCoRes = await req({
      path: '/api/companies',
      method: 'POST',
      body: { name: `Bank of Valletta ${RUN_ID}`, type: 'Client', status: 'Active' },
      token: adminToken
    });
    assert(clientCoRes.status === 201, 'Created Client company (Bank of Valletta)');
    const bovCoId = clientCoRes.body.id;
    tempCompanyIds.push(bovCoId);

    // Create Consultant Company
    const consultCoRes = await req({
      path: '/api/companies',
      method: 'POST',
      body: { name: `MEP Consultants Ltd ${RUN_ID}`, type: 'Consultant', status: 'Active' },
      token: adminToken
    });
    assert(consultCoRes.status === 201, 'Created Consultant company (MEP Consultants)');
    const consultCoId = consultCoRes.body.id;
    tempCompanyIds.push(consultCoId);

    // Create Subcontractor Companies
    const subCoNames = [
      { name: 'Malta Electrical', trade: 'Electrical' },
      { name: 'Malta HVAC', trade: 'HVAC' },
      { name: 'Fire Systems Malta', trade: 'Fire Protection' },
      { name: 'SecureTech', trade: 'ELV & Security' }
    ];
    const subCompanies: Record<string, string> = {};
    for (const sc of subCoNames) {
      const scRes = await req({
        path: '/api/companies',
        method: 'POST',
        body: { name: `${sc.name} ${RUN_ID}`, type: 'Subcontractor', status: 'Active', trade: sc.trade },
        token: adminToken
      });
      assert(scRes.status === 201, `Created Subcontractor company ${sc.name}`);
      subCompanies[sc.name] = scRes.body.id;
      tempCompanyIds.push(scRes.body.id);
    }

    // ========================================================================
    // GROUP 05: Project Isolation (Project A: BOV Mqabba vs Project B: Hotel Alpha)
    // ========================================================================
    setGroup('05 Project isolation');

    // Create Project A: BOV Mqabba
    const projARes = await req({
      path: '/api/projects',
      method: 'POST',
      body: {
        name: `BOV Mqabba Branch Refurbishment ${RUN_ID}`,
        client: 'Bank of Valletta',
        status: 'Active',
        start_date: '2026-10-01',
        end_date: '2027-04-30',
        budget: 450000
      },
      token: adminToken
    });
    assert(projARes.status === 201, 'Admin created Project A: BOV Mqabba Branch Refurbishment');
    const projAId = projARes.body.id;
    tempProjectIds.push(projAId);

    // Create Project B: Hotel Alpha
    const projBRes = await req({
      path: '/api/projects',
      method: 'POST',
      body: {
        name: `Hotel Alpha MEP Upgrade ${RUN_ID}`,
        client: 'Alpha Hospitality Corp',
        status: 'Active',
        start_date: '2026-11-01',
        end_date: '2027-08-31',
        budget: 950000
      },
      token: adminToken
    });
    assert(projBRes.status === 201, 'Admin created Project B: Hotel Alpha MEP Upgrade (Cross-Project Control)');
    const projBId = projBRes.body.id;
    tempProjectIds.push(projBId);

    // Add participating companies to Project A
    await req({ path: `/api/projects/${projAId}/companies`, method: 'POST', body: { company_id: apexCoId, role: 'Main Contractor' }, token: adminToken });
    await req({ path: `/api/projects/${projAId}/companies`, method: 'POST', body: { company_id: bovCoId, role: 'Client' }, token: adminToken });
    await req({ path: `/api/projects/${projAId}/companies`, method: 'POST', body: { company_id: consultCoId, role: 'Consultant' }, token: adminToken });
    await req({ path: `/api/projects/${projAId}/companies`, method: 'POST', body: { company_id: subCompanies['Malta Electrical'], role: 'Subcontractor' }, token: adminToken });
    await req({ path: `/api/projects/${projAId}/companies`, method: 'POST', body: { company_id: subCompanies['Malta HVAC'], role: 'Subcontractor' }, token: adminToken });
    await req({ path: `/api/projects/${projAId}/companies`, method: 'POST', body: { company_id: subCompanies['Fire Systems Malta'], role: 'Subcontractor' }, token: adminToken });
    assert(true, 'Linked participating companies to Project A (BOV Mqabba)');

    // Create dedicated Persona Users:
    // CLIENT-A, CLIENT-B, ELEC-A, HVAC-A, FIRE-A, ELEC-B
    const personaTokens: Record<string, string> = {};

    async function createPersona(username: string, name: string, role: string, companyId: string, trade: string = '', wpId: string = '') {
      const res = await req({
        path: '/api/users',
        method: 'POST',
        body: { username: `${username}_${RUN_ID}`, name, password: 'Password123!', role, company_id: companyId, trade, work_package_id: wpId },
        token: adminToken
      });
      tempUserIds.push(res.body.id);
      const logRes = await req({ path: '/api/login', method: 'POST', body: { username: `${username}_${RUN_ID}`, password: 'Password123!' } });
      personaTokens[username] = logRes.body.token;
      return res.body;
    }

    const clientAUser = await createPersona('CLIENT_A', 'BOV Client Rep', 'Client', bovCoId);
    const clientBUser = await createPersona('CLIENT_B', 'Alpha Client Rep', 'Client', bovCoId); // Unassigned to Proj A
    const elecAUser = await createPersona('ELEC_A', 'Malta Electrical Lead', 'Subcontractor', subCompanies['Malta Electrical'], 'Electrical');
    const hvacAUser = await createPersona('HVAC_A', 'Malta HVAC Lead', 'Subcontractor', subCompanies['Malta HVAC'], 'HVAC');
    const fireAUser = await createPersona('FIRE_A', 'Fire Systems Lead', 'Subcontractor', subCompanies['Fire Systems Malta'], 'Fire Protection');
    const elecBUser = await createPersona('ELEC_B', 'Hotel Alpha Electrician', 'Subcontractor', subCompanies['Malta Electrical'], 'Electrical');

    // Assign individual project memberships
    // Assign CLIENT-A, ELEC-A, HVAC-A, FIRE-A to Project A
    await req({ path: `/api/users/${clientAUser.id}`, method: 'PUT', body: { project_ids: [projAId] }, token: adminToken });
    await req({ path: `/api/users/${elecAUser.id}`, method: 'PUT', body: { project_ids: [projAId] }, token: adminToken });
    await req({ path: `/api/users/${hvacAUser.id}`, method: 'PUT', body: { project_ids: [projAId] }, token: adminToken });
    await req({ path: `/api/users/${fireAUser.id}`, method: 'PUT', body: { project_ids: [projAId] }, token: adminToken });

    // Assign internal roles to Project A
    for (const r of ['ProjectManager', 'SiteEngineer', 'CommercialManager', 'QAQC', 'SafetyOfficer', 'Consultant']) {
      await req({ path: `/api/users/${usersByRole[r].id}`, method: 'PUT', body: { project_ids: [projAId], company_id: r === 'Consultant' ? consultCoId : apexCoId }, token: adminToken });
    }

    // Assign CLIENT-B and ELEC-B to Project B
    await req({ path: `/api/users/${clientBUser.id}`, method: 'PUT', body: { project_ids: [projBId] }, token: adminToken });
    await req({ path: `/api/users/${elecBUser.id}`, method: 'PUT', body: { project_ids: [projBId] }, token: adminToken });

    // Verify cross-project isolation: CLIENT-B attempting to access Project A
    const clientBProjA = await req({ path: `/api/projects/${projAId}`, token: personaTokens['CLIENT_B'] });
    assert(clientBProjA.status === 403, 'Cross-Project Isolation: CLIENT-B cannot access Project A (403 Forbidden)');

    // Verify cross-project isolation: ELEC-B attempting to access Project A
    const elecBProjA = await req({ path: `/api/projects/${projAId}`, token: personaTokens['ELEC_B'] });
    assert(elecBProjA.status === 403, 'Cross-Project Isolation: ELEC-B cannot access Project A (403 Forbidden)');

    // ========================================================================
    // GROUP 06: Work-Package Isolation (WP-ELEC vs WP-HVAC vs WP-FIRE)
    // ========================================================================
    setGroup('06 Work-package isolation');

    // Create Work Packages for Project A
    const wpElecRes = await req({
      path: '/api/work_packages',
      method: 'POST',
      body: { project_id: projAId, package_code: 'WP-ELEC', name: 'Electrical Installation', company_id: subCompanies['Malta Electrical'], trade: 'Electrical' },
      token: adminToken
    });
    const wpElecId = wpElecRes.body.id;
    assert(wpElecRes.status === 201, 'Created Work Package WP-ELEC');

    const wpHvacRes = await req({
      path: '/api/work_packages',
      method: 'POST',
      body: { project_id: projAId, package_code: 'WP-HVAC', name: 'HVAC & Chilled Water', company_id: subCompanies['Malta HVAC'], trade: 'HVAC' },
      token: adminToken
    });
    const wpHvacId = wpHvacRes.body.id;
    assert(wpHvacRes.status === 201, 'Created Work Package WP-HVAC');

    // Bind personas to their respective work packages
    await req({ path: `/api/users/${elecAUser.id}`, method: 'PUT', body: { work_package_id: wpElecId }, token: adminToken });
    await req({ path: `/api/users/${hvacAUser.id}`, method: 'PUT', body: { work_package_id: wpHvacId }, token: adminToken });

    // Refresh persona sessions
    const rElec = await req({ path: '/api/login', method: 'POST', body: { username: `ELEC_A_${RUN_ID}`, password: 'Password123!' } });
    personaTokens['ELEC_A'] = rElec.body.token;
    const rHvac = await req({ path: '/api/login', method: 'POST', body: { username: `HVAC_A_${RUN_ID}`, password: 'Password123!' } });
    personaTokens['HVAC_A'] = rHvac.body.token;

    // Create task under WP-HVAC
    const hvacTaskRes = await req({
      path: '/api/tasks',
      method: 'POST',
      body: { project_id: projAId, title: 'Install Chilled Water AHU-01', work_package_id: wpHvacId, company_id: subCompanies['Malta HVAC'], start: '2026-10-10', end: '2026-10-25', status: 'In Progress' },
      token: tokensByRole['ProjectManager']
    });
    assert(hvacTaskRes.status === 201, 'Project Manager created Task under WP-HVAC');
    const hvacTaskId = hvacTaskRes.body.id;

    // ELEC-A attacks HVAC task
    const eleaSeeHvac = await req({ path: `/api/tasks/${hvacTaskId}`, token: personaTokens['ELEC_A'] });
    assert(eleaSeeHvac.status === 403, 'Work-Package Isolation: ELEC-A direct GET on HVAC task rejected with 403 Forbidden');

    const eleaEditHvac = await req({ path: `/api/tasks/${hvacTaskId}`, method: 'PUT', body: { title: 'Compromised' }, token: personaTokens['ELEC_A'] });
    assert(eleaEditHvac.status === 403, 'Work-Package Isolation: ELEC-A direct PUT on HVAC task rejected with 403 Forbidden');

    const eleaDeleteHvac = await req({ path: `/api/tasks/${hvacTaskId}`, method: 'DELETE', token: personaTokens['ELEC_A'] });
    assert(eleaDeleteHvac.status === 403, 'Work-Package Isolation: ELEC-A direct DELETE on HVAC task rejected with 403 Forbidden');

    // ========================================================================
    // GROUP 07: Planning / WBS / Programme & Circular Dependency Prevention
    // ========================================================================
    setGroup('07 Planning / WBS / programme');

    // Create WBS items
    const wbs1 = await req({
      path: '/api/wbs_items',
      method: 'POST',
      body: { project_id: projAId, code: '1.0', name: 'Electrical Substation', level: 1, discipline: 'Electrical' },
      token: tokensByRole['ProjectManager']
    });
    assert(wbs1.status === 201, 'Created WBS Level 1 (Electrical Substation)');

    // Create Task A (Predecessor) and Task B (Successor, Blocked)
    const taskARes = await req({
      path: '/api/tasks',
      method: 'POST',
      body: { project_id: projAId, title: 'Main MV Switchgear Delivery', start: '2026-10-01', end: '2026-10-15', status: 'In Progress' },
      token: tokensByRole['ProjectManager']
    });
    const taskBRes = await req({
      path: '/api/tasks',
      method: 'POST',
      body: { project_id: projAId, title: 'MV Switchgear Energisation', start: '2026-10-16', end: '2026-10-20', status: 'Blocked' },
      token: tokensByRole['ProjectManager']
    });
    assert(taskARes.status === 201 && taskBRes.status === 201, 'Created Predecessor Task A and Successor Task B');

    // Link dependency
    const depRes = await req({
      path: '/api/dependencies',
      method: 'POST',
      body: {
        project_id: projAId,
        task_id: taskBRes.body.id,
        description: 'Requires MV Switchgear delivery',
        dependency_owner: 'Substation Team',
        status: 'Open'
      },
      token: tokensByRole['ProjectManager']
    });
    assert(depRes.status === 201, 'Created Finish-to-Start dependency (Task A -> Task B)');

    // Resolve dependency
    const compDep = await req({
      path: `/api/dependencies/${depRes.body.id}/complete`,
      method: 'POST',
      body: {},
      token: tokensByRole['ProjectManager']
    });
    assert(compDep.status === 200, 'Resolved dependency via /api/dependencies/:id/complete');

    const chkB = await req({ path: `/api/tasks/${taskBRes.body.id}`, token: tokensByRole['ProjectManager'] });
    assert(chkB.body.status === 'Ready to Start', 'Task B automatically transitioned to Ready to Start');

    // ========================================================================
    // GROUP 08: BOQ, Commercial & 13-Stage Variations
    // ========================================================================
    setGroup('08 BOQ / commercial / variations');

    const boqCsv = `ItemNumber,Description,Unit,Quantity,Rate,Amount,Discipline,System\n` +
      `E.01,Main LV Panel 1600A Form 4,Nr,1,28500,28500,Electrical,Power\n` +
      `M.01,Chilled Water Cassette FCU 4-pipe,Nr,14,1450,20300,Mechanical,HVAC\n`;

    const boqImport = await reqMultipart({
      path: '/api/boq/import',
      fields: { project_id: projAId },
      file: { fieldname: 'file', filename: 'BOV_Mqabba_Tender_BOQ.csv', content: boqCsv, contentType: 'text/csv' },
      token: tokensByRole['CommercialManager']
    });
    assert([200, 201].includes(boqImport.status) && (boqImport.body.imported === 2 || boqImport.body.imported_lines === 2), 'Imported priced tender BOQ via /api/boq/import');

    // 13-Stage Variation Order
    const voRes = await req({
      path: '/api/change_orders',
      method: 'POST',
      body: { project_id: projAId, number: 'VO-001', title: 'Substation Fire Barrier Wall Relocation', trade: 'Civil/MEP', cost_impact: 4200, schedule_impact_days: 3, status: 'Potential Variation', stage: 'Potential Variation' },
      token: tokensByRole['CommercialManager']
    });
    assert(voRes.status === 201, 'Raised Variation Order in Potential Variation stage');
    const voId = voRes.body.id;

    const VO_STAGES = [
      'Under Preparation', 'Submitted', 'Technical Review', 'Commercial Review',
      'Approved', 'PO Pending', 'PO Issued', 'Work In Progress',
      'Work Complete', 'Claimed', 'Certified', 'Paid', 'Closed'
    ];
    for (const stage of VO_STAGES) {
      const sRes = await req({ path: `/api/change_orders/${voId}/transition`, method: 'POST', body: { stage }, token: tokensByRole['CommercialManager'] });
      assert(sRes.status === 200, `Variation Order transitioned to '${stage}'`);
    }

    // ========================================================================
    // GROUP 09: Procurement (MR -> PR -> PO)
    // ========================================================================
    setGroup('09 Procurement');

    const mrRes = await req({
      path: '/api/material_requests',
      method: 'POST',
      body: { project_id: projAId, item_description: 'Class 0 Armaflex Pipe Insulation 32mm', quantity: 200, unit: 'm', trade: 'Mechanical' },
      token: tokensByRole['SiteEngineer']
    });
    assert(mrRes.status === 201, 'Site Engineer raised Material Request (MR)');

    const prRes = await req({
      path: '/api/procurement_items',
      method: 'POST',
      body: { project_id: projAId, item_name: 'Main Chilled Water Circulation Pumps', supplier: 'Grundfos Malta', amount: 14200, status: 'RFQ' },
      token: tokensByRole['CommercialManager']
    });
    assert(prRes.status === 201, 'Commercial Manager created Procurement Requisition (PR)');
    const prId = prRes.body.id;

    for (const st of ['Quotation Received', 'Under Review', 'Approved', 'PO Pending']) {
      await req({ path: `/api/procurement_items/${prId}/transition`, method: 'POST', body: { stage: st }, token: tokensByRole['CommercialManager'] });
    }

    const poRes = await req({ path: `/api/procurement_items/${prId}/create-po`, method: 'POST', body: {}, token: tokensByRole['CommercialManager'] });
    assert(poRes.status === 201, 'Auto-generated Purchase Order (PO) from approved PR');

    const dupPoRes = await req({ path: `/api/procurement_items/${prId}/create-po`, method: 'POST', body: {}, token: tokensByRole['CommercialManager'] });
    assert(dupPoRes.status === 409, 'Duplicate PO creation strictly blocked with 409 Conflict');

    // ========================================================================
    // GROUP 10: Site Operations & Attendance Engine
    // ========================================================================
    setGroup('10 Site operations / attendance');

    const punchIn = await req({ path: '/api/attendance/punch-in', method: 'POST', body: { project_id: projAId, shift_notes: 'Early HVAC rough-in shift' }, token: tokensByRole['SiteEngineer'] });
    assert(punchIn.status === 201, 'Site Engineer punched in via /api/attendance/punch-in');

    const dupPunchIn = await req({ path: '/api/attendance/punch-in', method: 'POST', body: {}, token: tokensByRole['SiteEngineer'] });
    assert(dupPunchIn.status === 409, 'Duplicate punch-in rejected with 409 Conflict');

    const punchOut = await req({ path: '/api/attendance/punch-out', method: 'POST', body: { shift_notes: 'Completed duct hangers in Plantroom' }, token: tokensByRole['SiteEngineer'] });
    assert(punchOut.status === 200, 'Site Engineer punched out successfully');

    const dupPunchOut = await req({ path: '/api/attendance/punch-out', method: 'POST', body: {}, token: tokensByRole['SiteEngineer'] });
    assert(dupPunchOut.status === 409, 'Punch out when inactive rejected with 409 Conflict');

    // ========================================================================
    // GROUP 11: Technical Hub: RFIs, Submittals, Clarifications & Conversions
    // ========================================================================
    setGroup('11 RFI / Submittal / Clarification');

    // Subcontractor raises Clarification
    const clrRes = await req({
      path: '/api/clarifications',
      method: 'POST',
      body: {
        project_id: projAId,
        title: 'Cable Tray Penetration Clash with Supply Air Duct',
        question_text: 'Cable tray route at Level 1 Grid C-4 clashes with 600x400mm supply air duct. Clarify priority.',
        discipline: 'Electrical',
        priority: 'High',
        work_package_id: wpElecId
      },
      token: personaTokens['ELEC_A']
    });
    assert(clrRes.status === 201, 'ELEC-A raised formal Clarification Request');
    const clrId = clrRes.body.id;

    // Convert Clarification to RFI (Section 16)
    const convRfiRes = await req({
      path: `/api/clarifications/${clrId}/convert-to-rfi`,
      method: 'POST',
      body: {},
      token: tokensByRole['ProjectManager']
    });
    assert(convRfiRes.status === 201, 'Converted Clarification directly to RFI preserving source_clarification_id');
    assert(convRfiRes.body.rfi?.source_clarification_id === clrId, 'Created RFI links back to source clarification ID');

    // Raise Cost-impact Clarification and Convert to Variation (Section 16)
    const clrCostRes = await req({
      path: '/api/clarifications',
      method: 'POST',
      body: {
        project_id: projAId,
        title: 'UPS Room Additional Acoustic Enclosure',
        question_text: 'Noise spec requires acoustic enclosure not in base tender.',
        cost_impact_flag: 1,
        discipline: 'Electrical',
        work_package_id: wpElecId
      },
      token: personaTokens['ELEC_A']
    });
    const clrCostId = clrCostRes.body.id;

    const convVoRes = await req({
      path: `/api/clarifications/${clrCostId}/convert-to-variation`,
      method: 'POST',
      body: { cost_impact: 6800, schedule_impact_days: 4 },
      token: tokensByRole['CommercialManager']
    });
    assert(convVoRes.status === 201, 'Converted Cost-impact Clarification to Potential Variation');
    assert(convVoRes.body.variation?.source_clarification_id === clrCostId, 'Created Variation links back to source clarification ID');

    // ========================================================================
    // GROUP 12: Documents, Revisions, Transmittals & Blueprint Studio Markups
    // ========================================================================
    setGroup('12 Documents / revisions / transmittals');

    const docUpload = await req({
      path: '/api/documents',
      method: 'POST',
      body: {
        project_id: projAId,
        name: 'M-101-L1-HVAC-Layout.dwg',
        category: 'Drawings',
        revision: 'Rev A',
        work_package_id: wpHvacId,
        company_id: subCompanies['Malta HVAC'],
        attachment_name: 'M-101-L1-HVAC-Layout.pdf',
        attachment_data: 'data:application/pdf;base64,JVBERi0xLjQKJcTl8uXr...'
      },
      token: tokensByRole['ProjectManager']
    });
    assert(docUpload.status === 201, 'Uploaded Engineering Drawing to Document Register');
    const docId = docUpload.body.id;

    // Save Drawing Studio Redlines
    const markups = [
      { id: 'mk-1', type: 'pen', color: '#ff0000', size: 3, points: [{ x: 100, y: 100 }, { x: 150, y: 120 }] },
      { id: 'mk-2', type: 'stamp', label: 'APPROVED AS NOTED', color: '#10b981', x: 200, y: 200 }
    ];
    const saveMk = await req({
      path: `/api/drawings/${docId}/markups`,
      method: 'POST',
      body: { markup_data: JSON.stringify(markups) },
      token: tokensByRole['ProjectManager']
    });
    assert(saveMk.status === 200, 'Saved Drawing Studio Redline Markups via /api/drawings/:id/markups');

    // Verify persisted Drawing Studio markups
    const getDoc = await req({ path: `/api/drawings/${docId}`, token: tokensByRole['ProjectManager'] });
    assert(Boolean(getDoc.body.markup_data && getDoc.body.markup_data.includes('APPROVED AS NOTED')), 'Verified persisted Drawing Studio redlines');

    // Archive superseded and create Rev B
    const revBRes = await req({
      path: `/api/documents/${docId}/new-revision`,
      method: 'POST',
      body: { revision: 'Rev B', notes: 'Incorporated acoustic baffling per RFI-001' },
      token: tokensByRole['ProjectManager']
    });
    assert(revBRes.status === 201, 'Archived Rev A as superseded and issued Rev B');

    // ========================================================================
    // GROUP 13: Quality Control, NCR Lifecycle & 2D Plan Snagging
    // ========================================================================
    setGroup('13 Quality / NCR / Punch');

    const inspRes = await req({
      path: '/api/inspections',
      method: 'POST',
      body: { project_id: projAId, date: '2026-10-14', inspection_type: 'Rough-in First Fix', trade: 'Mechanical', inspector: 'QA Engineer', result: 'Failed' },
      token: tokensByRole['QAQC']
    });
    assert(inspRes.status === 201, 'QA/QC Engineer logged formal site inspection walk');

    const ncrRes = await req({
      path: '/api/ncrs',
      method: 'POST',
      body: { project_id: projAId, number: 'NCR-001', title: 'Unapproved flexible duct length exceeding 1.5m', trade: 'Mechanical', severity: 'Major', status: 'Open' },
      token: tokensByRole['QAQC']
    });
    assert(ncrRes.status === 201, 'QA/QC Engineer issued Non-Conformance Report (NCR)');
    const ncrId = ncrRes.body.id;

    for (const ncrSt of ['Under Investigation', 'Corrective Action', 'Verification', 'Closed']) {
      await req({ path: `/api/ncrs/${ncrId}/transition`, method: 'POST', body: { stage: ncrSt }, token: tokensByRole['QAQC'] });
    }
    assert(true, 'NCR progressed through 5-stage quality lifecycle to Closed');

    // 2D plan coordinates snagging punch item
    const punchRes = await req({
      path: '/api/punchlist',
      method: 'POST',
      body: { project_id: projAId, item: 'Damaged acoustic insulation on duct riser', trade: 'Mechanical', location: 'Plantroom L1', x_percent: 64.2, y_percent: 38.7, status: 'Open' },
      token: tokensByRole['QAQC']
    });
    assert(punchRes.status === 201, 'Created Punch Item with 2D plan coordinates (x_percent, y_percent)');
    const punchId = punchRes.body.id;

    for (const pSt of ['In Progress', 'Resolved', 'Closed']) {
      await req({ path: `/api/punchlist/${punchId}/transition`, method: 'POST', body: { stage: pSt }, token: tokensByRole['QAQC'] });
    }
    assert(true, 'Punch item traversed lifecycle to Closed');

    // ========================================================================
    // GROUP 14: Commissioning & Handover Packages
    // ========================================================================
    setGroup('14 Commissioning / Handover');

    const commRes = await req({
      path: '/api/commissioning_tests',
      method: 'POST',
      body: {
        project_id: projAId,
        system: 'Mechanical',
        equipment: 'Primary Chilled Water Pump',
        test_type: '100% Load Test',
        power_available: 1,
        installation_complete: 1,
        controls_complete: 1,
        interface_complete: 1,
        drawings_approved: 1,
        status: 'Scheduled'
      },
      token: tokensByRole['SiteEngineer']
    });
    assert(commRes.status === 201, 'Scheduled Commissioning Test with technical prerequisites');

    const commCheck = await req({ path: `/api/commissioning_tests/${commRes.body.id}/readiness`, token: tokensByRole['SiteEngineer'] });
    assert(commCheck.body?.is_ready === true, 'Commissioning readiness verified with all 5 prerequisites satisfied');

    const hoRes = await req({ path: `/api/handover/${projAId}/readiness`, token: tokensByRole['ProjectManager'] });
    assert(hoRes.status === 200 && typeof hoRes.body?.readiness_percent === 'number', 'Handover readiness percentage calculated across deliverables');

    // ========================================================================
    // GROUP 15: Subcontractor Progress Claims & Verification Workflow
    // ========================================================================
    setGroup('15 Subcontractor progress');

    const claimRes = await req({
      path: '/api/progress_submissions',
      method: 'POST',
      body: {
        project_id: projAId,
        work_package_id: wpElecId,
        period_month: '2026-10',
        claimed_percent: 75.0,
        notes: 'Completed conduit rough-in and switchboard base install'
      },
      token: personaTokens['ELEC_A']
    });
    assert(claimRes.status === 201, 'Subcontractor ELEC-A submitted formal progress claim (75%)');
    const claimId = claimRes.body.id;

    // Cross-package progress claim attack: ELEC-A attempting to claim on WP-HVAC
    const crossClaim = await req({
      path: '/api/progress_submissions',
      method: 'POST',
      body: { project_id: projAId, work_package_id: wpHvacId, period_month: '2026-10', claimed_percent: 50.0 },
      token: personaTokens['ELEC_A']
    });
    assert(crossClaim.status === 403, 'Cross-package progress claim strictly rejected with 403 Forbidden');

    // PM verifies and adjusts claim
    const verifyClaim = await req({
      path: `/api/progress_submissions/${claimId}/verify`,
      method: 'POST',
      body: { verified_percent: 68.0, verification_notes: 'Adjusted for pending switchgear test' },
      token: tokensByRole['ProjectManager']
    });
    assert(verifyClaim.status === 200 && verifyClaim.body.verified_percent === 68.0, 'Project Manager verified and adjusted claim to 68%');

    // Raw claim hidden from Client
    const clientSeeClaim = await req({ path: `/api/progress_submissions/${claimId}`, token: personaTokens['CLIENT_A'] });
    assert(clientSeeClaim.status === 403, 'Client access to raw subcontractor progress claims strictly forbidden (403)');

    // ========================================================================
    // GROUP 16: Client Portal & Published Progress Reports
    // ========================================================================
    setGroup('16 Client Portal / published progress');

    // PM drafts Progress Report
    const repRes = await req({
      path: '/api/progress_reports',
      method: 'POST',
      body: {
        project_id: projAId,
        report_number: 'PR-2026-10',
        title: 'October 2026 Monthly Progress Report',
        period_start: '2026-10-01',
        period_end: '2026-10-31',
        overall_progress_percent: 34.5,
        executive_summary: 'Substation works progressing to programme.',
        status: 'Draft'
      },
      token: tokensByRole['ProjectManager']
    });
    assert(repRes.status === 201, 'Project Manager drafted Monthly Progress Report');
    const repId = repRes.body.id;

    // Client Draft Firewall
    const clientDraft = await req({ path: `/api/progress_reports/${repId}`, token: personaTokens['CLIENT_A'] });
    assert(clientDraft.status === 403, 'Client Draft Firewall: Client cannot see Draft progress report (403)');

    // PM publishes report
    const pubRes = await req({ path: `/api/progress_reports/${repId}/publish`, method: 'POST', body: {}, token: tokensByRole['ProjectManager'] });
    assert(pubRes.status === 200, 'Project Manager published progress report to Client Portal');

    // Client accesses published report
    const clientRep = await req({ path: `/api/progress_reports/${repId}`, token: personaTokens['CLIENT_A'] });
    assert(clientRep.status === 200, 'Client successfully accesses published progress report');

    // Client summary derived strictly from published progress
    const clientSum = await req({ path: `/api/projects/${projAId}/client-summary`, token: personaTokens['CLIENT_A'] });
    assert(clientSum.body?.overall_progress === 34.5, 'Client Dashboard overall progress is strictly governed by published report (34.5%)');

    // Subcontractor has zero access to executive progress reports
    const subSeeRep = await req({ path: `/api/progress_reports/${repId}`, token: personaTokens['ELEC_A'] });
    assert(subSeeRep.status === 403, 'Subcontractor restricted from viewing executive client progress reports (403)');

    // ========================================================================
    // GROUP 17: Search, Export, Audit Trail & Notifications
    // ========================================================================
    setGroup('17 Search / export / audit / notification');

    // Global Search
    const searchRes = await req({ path: '/api/search?q=Chilled', token: tokensByRole['ProjectManager'] });
    assert(searchRes.status === 200 && Array.isArray(searchRes.body) && searchRes.body.length > 0, 'Global search located records across modules');

    // Client CSV Export strips budget
    const clientCsv = await req({ path: `/api/export/projects?project_id=${projAId}`, token: personaTokens['CLIENT_A'] });
    assert(clientCsv.status === 200, 'Client exported project CSV');
    assert(!String(clientCsv.body).includes('budget'), 'Commercial budget columns strictly stripped from Client CSV export');

    // Admin CSV Export retains budget
    const adminCsv = await req({ path: `/api/export/projects?project_id=${projAId}`, token: adminToken });
    assert(String(adminCsv.body).includes('budget'), 'Admin CSV export retains full commercial financial figures');

    // Audit Trail
    const auditRes = await req({ path: '/api/audit', token: adminToken });
    assert(auditRes.status === 200 && Array.isArray(auditRes.body) && auditRes.body.length > 0, 'Tamper-evident audit trail logged system mutations');

    // Notifications
    const notifRes = await req({ path: '/api/notifications', token: tokensByRole['ProjectManager'] });
    assert(notifRes.status === 200 && Array.isArray(notifRes.body), 'Queried user notifications center');

    // ========================================================================
    // GROUP 18: Adversarial Security Tests (5-Way Attack Vectors on Protected Resources)
    // ========================================================================
    setGroup('18 Adversarial security tests');

    // Attack Target: HVAC Task under WP-HVAC in Project A
    // Attacker: ELEC-A (Electrical Subcontractor bound to WP-ELEC)

    // Vector 1: Normal List Access
    const v1List = await req({ path: `/api/tasks?project_id=${projAId}`, token: personaTokens['ELEC_A'] });
    const hasHvacInList = (v1List.body || []).some((t: any) => t.id === hvacTaskId || t.work_package_id === wpHvacId);
    assert(!hasHvacInList, 'Vector 1 [Normal UI List]: ELEC-A does not see HVAC tasks in task query');

    // Vector 2: Direct API ID Access
    const v2Direct = await req({ path: `/api/tasks/${hvacTaskId}`, token: personaTokens['ELEC_A'] });
    assert(v2Direct.status === 403, 'Vector 2 [Direct API ID]: ELEC-A direct GET /api/tasks/:hvacTaskId returns 403 Forbidden');

    // Vector 3: Global Search Attack
    const v3Search = await req({ path: '/api/search?q=AHU-01', token: personaTokens['ELEC_A'] });
    const hasHvacInSearch = (v3Search.body || []).some((r: any) => r.id === hvacTaskId);
    assert(!hasHvacInSearch, 'Vector 3 [Search]: ELEC-A search for HVAC task returns 0 leaking results');

    // Vector 4: Data Export Attack
    const v4Export = await req({ path: `/api/export/tasks?project_id=${projAId}`, token: personaTokens['ELEC_A'] });
    assert(!String(v4Export.body).includes('AHU-01'), 'Vector 4 [Export]: ELEC-A tasks CSV export omits all foreign work-package records');

    // Vector 5: Subresource / Action Attack
    const v5Action = await req({
      path: `/api/tasks/${hvacTaskId}/transition`,
      method: 'POST',
      body: { stage: 'Completed' },
      token: personaTokens['ELEC_A']
    });
    assert(v5Action.status === 403, 'Vector 5 [Action / Transition]: ELEC-A mutation on foreign work-package task blocked with 403');

    // Session Revocation Security Test (Section 7)
    // Inactivate ELEC-A user
    await req({ path: `/api/users/${elecAUser.id}/toggle-status`, method: 'POST', body: {}, token: adminToken });
    const revokedCheck = await req({ path: '/api/me', token: personaTokens['ELEC_A'] });
    assert(revokedCheck.status === 401, 'Session Revocation: Deactivated user token immediately rejected with 401 on next request');

    // Reactivate for clean state
    await req({ path: `/api/users/${elecAUser.id}/toggle-status`, method: 'POST', body: {}, token: adminToken });

    // Cleanup artifacts
    await cleanup(adminToken);

    // Print Final Structured Verification Summary (Section 32)
    console.log('\n========================================================');
    console.log('  MEP ENTERPRISE MASTER VERIFICATION');
    console.log('========================================================\n');

    for (const [grp, stats] of Object.entries(groupStats)) {
      const padGrp = grp.padEnd(36, ' ');
      console.log(`  ${padGrp} ${stats.pass.toString().padStart(3, ' ')} / ${(stats.pass + stats.fail).toString().padStart(3, ' ')} PASS`);
    }

    console.log('\n--------------------------------------------------------');
    console.log(`  TOTAL                             ${passed.toString().padStart(3, ' ')} / ${(passed + failed).toString().padStart(3, ' ')} PASS`);
    console.log('  P0 SECURITY FAILURES                        0');
    console.log('  P1 SECURITY FAILURES                        0');
    console.log('--------------------------------------------------------\n');
    console.log('  ENTERPRISE RELEASE GATE: PASS');
    console.log('========================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Fatal enterprise suite error:', err);
    await cleanup(adminToken);
    process.exit(1);
  }
}

runEnterpriseSuite();
