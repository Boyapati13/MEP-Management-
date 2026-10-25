/**
 * MEP Management Platform — Release V1.3.1 Project Master & Task Engine Suite
 * Validates:
 * 1. Project Master lifecycle: creation, contract parameters, currency, stage, auto-code generation, and budget sync.
 * 2. Schedule variance calculation (baseline_end_date vs forecast_end_date).
 * 3. GET /api/projects/:id/master (contract parameters, variance days, site & work package counters, trade breakdown).
 * 4. Enterprise Hierarchy: WBS items, Work Packages, Sites, and GET /api/projects/:id/wbs-tree.
 * 5. Professional Task Engine: Tasks with site_id, work_package_id, wbs_item_id, company_id, supervisor_id,
 *    assigned_worker_id, drawing_ref, boq_ref, evidence_required, evidence_type, baselines and forecasts.
 * 6. Joined task metadata in GET /api/tasks and GET /api/tasks/:id (site_name, work_package_code, company_name, supervisor_name, worker_name).
 * 7. Multi-tenant and role-based access to Project Master and WBS trees.
 */
import http from 'http';
import { DatabaseSync } from 'node:sqlite';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const TEST_PORT = 3196;

function req(options: { path: string; method?: string; body?: any; token?: string | null }): Promise<{ status: number; body: any; headers: any }> {
  return new Promise((resolve, reject) => {
    const data = options.body ? JSON.stringify(options.body) : null;
    const r = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {})
      }
    }, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        let parsed: any;
        try { parsed = JSON.parse(resBody); } catch { parsed = resBody; }
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
    if (detail !== undefined) console.error('     Detail:', JSON.stringify(detail).slice(0, 600));
    failed++;
  }
}

function waitForHealth(port: number, timeoutMs = 20000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const r = http.request({ hostname: '127.0.0.1', port, path: '/api/health', method: 'GET' }, (res) => {
        if (res.statusCode === 200) resolve(true);
        else if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(check, 300);
      });
      r.on('error', () => {
        if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(check, 300);
      });
      r.end();
    };
    check();
  });
}

function stopServer(proc: ChildProcess): Promise<void> {
  if (!proc || proc.killed) return Promise.resolve();
  return new Promise((resolve) => {
    proc.on('exit', () => resolve());
    proc.kill('SIGTERM');
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolve();
    }, 2000);
  });
}

async function run() {
  console.log('================================================================================');
  console.log('  MEP V1.3.1 PROJECT MASTER & PROFESSIONAL TASK ENGINE TEST SUITE');
  console.log('================================================================================\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mep-pm-test-'));
  const testDbFile = path.join(tmpDir, 'project_master_test.db');
  let serverLogs = '';
  const serverProc: ChildProcess = spawn(
    process.execPath,
    [path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        MEP_DB_PATH: testDbFile,
        JWT_SECRET: 'test-secret-project-master-v1.3.1',
        NODE_ENV: 'test',
      },
      stdio: 'pipe'
    }
  );

  serverProc.stdout?.on('data', (d) => { serverLogs += d.toString(); });
  serverProc.stderr?.on('data', (d) => { serverLogs += d.toString(); });

  try {
    const healthy = await waitForHealth(TEST_PORT);
    if (!healthy) {
      console.error('Server logs on failure:\n', serverLogs);
    }
    assert(healthy, 'Project Master test server booted and /api/health is healthy');
    if (!healthy) throw new Error('Test server failed to start');

    // --- 1. ADMIN AUTHENTICATION ---
    console.log('\n>>> 1. Authentication');
    const loginRes = await req({
      path: '/api/auth/login',
      method: 'POST',
      body: { username: 'admin', password: 'ChangeMe123!' }
    });
    assert(loginRes.status === 200 && !!loginRes.body.token, 'Admin authentication successful');
    const adminToken = loginRes.body.token;

    // --- 2. PROJECT MASTER CREATION WITH COMPLETE CONTRACT DATA ---
    console.log('\n>>> 2. Project Master Creation & Synchronization');
    const projMasterRes = await req({
      path: '/api/projects',
      method: 'POST',
      token: adminToken,
      body: {
        name: 'The Opus Tower MEP Package',
        project_code: 'PRJ-OPUS-001',
        contract_value: 45000000,
        contract_type: 'Lump Sum Fixed Price',
        currency: 'AED',
        stage: 'Execution',
        client_name: 'Omniyat Properties',
        main_contractor: 'Multiplex Middle East',
        consultant: 'Zaha Hadid Architects / Buro Happold',
        site_address: 'Al A’amal St, Business Bay',
        city: 'Dubai',
        country: 'United Arab Emirates',
        baseline_start_date: '2026-01-15',
        baseline_end_date: '2026-11-30',
        forecast_end_date: '2026-12-15'
      }
    });

    assert(projMasterRes.status === 201, 'Project Master created (HTTP 201)', projMasterRes.body);
    const p1 = projMasterRes.body;
    assert(p1.project_code === 'PRJ-OPUS-001', 'project_code stored correctly');
    assert(p1.code === 'PRJ-OPUS-001', 'Legacy code field cross-synchronized with project_code');
    assert(Number(p1.contract_value) === 45000000, 'contract_value stored as 45,000,000');
    assert(Number(p1.budget) === 45000000, 'Legacy budget field cross-synchronized with contract_value');
    assert(p1.currency === 'AED', 'Currency stored as AED');
    assert(p1.stage === 'Execution', 'Stage stored as Execution');
    assert(p1.client_name === 'Omniyat Properties', 'client_name stored');
    assert(p1.client === 'Omniyat Properties', 'Legacy client field cross-synchronized with client_name');
    assert(p1.main_contractor === 'Multiplex Middle East', 'main_contractor stored');
    assert(p1.consultant === 'Zaha Hadid Architects / Buro Happold', 'consultant stored');

    // --- 3. AUTO-GENERATION OF PROJECT CODE WHEN OMITTED ---
    console.log('\n>>> 3. Auto-Generation of Project Code');
    const autoCodeRes = await req({
      path: '/api/projects',
      method: 'POST',
      token: adminToken,
      body: {
        name: 'Marina Sky Villa MEP',
        budget: 5000000,
        client: 'Select Group'
      }
    });
    assert(autoCodeRes.status === 201, 'Project created without explicit project_code');
    assert(!!autoCodeRes.body.project_code && autoCodeRes.body.project_code.startsWith('PRJ-'), 'project_code auto-generated with PRJ- prefix', autoCodeRes.body.project_code);
    assert(autoCodeRes.body.code === autoCodeRes.body.project_code, 'Legacy code matches auto-generated project_code');
    assert(Number(autoCodeRes.body.contract_value) === 5000000, 'contract_value synced from legacy budget');

    // --- 4. PROJECT MASTER GET ENDPOINT & SCHEDULE VARIANCE ---
    console.log('\n>>> 4. GET /api/projects/:id/master & Schedule Variance');
    const masterRes = await req({
      path: `/api/projects/${p1.id}/master`,
      method: 'GET',
      token: adminToken
    });

    assert(masterRes.status === 200, 'GET /api/projects/:id/master returned 200', masterRes.body);
    const masterData = masterRes.body;
    assert(masterData.id === p1.id, 'masterData ID matches project ID');
    assert(masterData.project_code === 'PRJ-OPUS-001', 'masterData contains project_code');
    assert(masterData.currency === 'AED', 'masterData contains currency');
    assert(masterData.variance_days === 15, 'Schedule variance accurately calculated as +15 days delay (2026-12-15 vs 2026-11-30)', masterData.variance_days);
    assert(Array.isArray(masterData.sites), 'masterData contains sites array');
    assert(Array.isArray(masterData.work_packages), 'masterData contains work_packages array');

    // --- 5. ENTERPRISE HIERARCHY: SITES, WBS, WORK PACKAGES ---
    console.log('\n>>> 5. Enterprise Hierarchy (Site -> WBS -> Work Package)');
    // 5a. Create Site
    const siteRes = await req({
      path: '/api/sites',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: p1.id,
        name: 'Opus Podium & Basement Plantrooms',
        address: 'Business Bay, Plot BB-A01',
        city: 'Dubai',
        country: 'United Arab Emirates',
        latitude: 25.1872,
        longitude: 55.2744,
        geofence_radius_m: 120
      }
    });
    assert(siteRes.status === 201, 'Site created under project', siteRes.body);
    const site1 = siteRes.body;

    // 5b. Create WBS Item (Level 1 and Level 2)
    const wbs1Res = await req({
      path: '/api/wbs',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: p1.id,
        code: 'WBS-01',
        name: 'HVAC Primary Infrastructure',
        level: '1',
        discipline: 'HVAC',
        active: 1
      }
    });
    assert(wbs1Res.status === 201, 'WBS item Level 1 created', wbs1Res.body);
    const wbs1 = wbs1Res.body;

    // 5c. Create Work Package linked to Project and WBS
    const wp1Res = await req({
      path: '/api/work_packages',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: p1.id,
        wbs_item_id: wbs1.id,
        site_id: site1.id,
        code: 'WP-HVAC-CHW-01',
        name: 'Chilled Water Piping & Valves Installation',
        discipline: 'HVAC',
        status: 'Active',
        budget_allocated: 4200000
      }
    });
    assert(wp1Res.status === 201, 'Work Package created and linked to WBS & Site', wp1Res.body);
    const wp1 = wp1Res.body;

    // --- 6. SUBCONTRACTOR COMPANY, SUPERVISOR, AND WORKER SETUP ---
    console.log('\n>>> 6. Workforce & Stakeholder Setup for Task Assignment');
    const compRes = await req({
      path: '/api/companies',
      method: 'POST',
      token: adminToken,
      body: {
        name: 'Thermal Dynamics MEP Subcontracting LLC',
        type: 'Subcontractor',
        trade: 'HVAC',
        status: 'Active'
      }
    });
    assert(compRes.status === 201, 'Subcontractor Company created', compRes.body);
    const comp1 = compRes.body;

    const linkCompRes = await req({
      path: `/api/projects/${p1.id}/companies`,
      method: 'POST',
      token: adminToken,
      body: {
        company_id: comp1.id,
        role_in_project: 'Subcontractor'
      }
    });
    assert(linkCompRes.status === 201, 'Subcontractor linked to project', linkCompRes.body);

    const userRes = await req({
      path: '/api/users',
      method: 'POST',
      token: adminToken,
      body: {
        username: 'supervisor_tareq',
        password: 'Password123!',
        name: 'Tareq Mansoor (HVAC Lead)',
        role: 'SiteSupervisor',
        company_id: comp1.id,
        email: 'tareq@mepdynamics.ae',
        project_ids: [p1.id]
      }
    });
    assert(userRes.status === 201, 'Supervisor user created', userRes.body);
    const supUser = userRes.body;

    const workerRes = await req({
      path: '/api/workers',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: p1.id,
        site_id: site1.id,
        company_id: comp1.id,
        supervisor_id: supUser.id,
        name: 'Sunil Sharma (Senior Pipe Fitter)',
        trade: 'HVAC',
        employment_type: 'Subcontractor',
        employee_id: 'TD-9042'
      }
    });
    assert(workerRes.status === 201, 'Worker profile created with supervisor and company link', workerRes.body);
    const worker1 = workerRes.body;

    // --- 7. PROFESSIONAL TASK ENGINE CREATION & JOINED METADATA ---
    console.log('\n>>> 7. Professional Task Engine: Full Enterprise Hierarchy & Metadata');
    const taskRes = await req({
      path: '/api/tasks',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: p1.id,
        site_id: site1.id,
        work_package_id: wp1.id,
        wbs_item_id: wbs1.id,
        company_id: comp1.id,
        supervisor_id: supUser.id,
        assigned_worker_id: worker1.id,
        title: 'B2 Chiller Plant Header Welding & Flange Fit-up',
        description: 'Rig, level, fit and TIG weld 350mm carbon steel CHW headers per approved shop drawings.',
        trade: 'HVAC',
        priority: 'Critical',
        status: 'In Progress',
        progress: 45,
        start: '2026-03-01',
        end: '2026-03-20',
        baseline_start_date: '2026-03-01',
        baseline_end_date: '2026-03-15',
        forecast_start_date: '2026-03-01',
        forecast_end_date: '2026-03-20',
        drawing_ref: 'DWG-OPUS-HV-B2-014',
        boq_ref: 'BOQ-B2-CHW-004',
        evidence_required: 1,
        evidence_type: 'Inspection Report & Photo',
        evidence_notes: 'Must include 100% dye penetrant test certificate and QA signed inspection signoff.'
      }
    });

    assert(taskRes.status === 201, 'Enterprise task created (HTTP 201)', taskRes.body);
    const t1 = taskRes.body;
    assert(t1.site_id === site1.id, 'Task site_id persisted');
    assert(t1.work_package_id === wp1.id, 'Task work_package_id persisted');
    assert(t1.wbs_item_id === wbs1.id, 'Task wbs_item_id persisted');
    assert(t1.company_id === comp1.id, 'Task company_id persisted');
    assert(t1.supervisor_id === supUser.id, 'Task supervisor_id persisted');
    assert(t1.assigned_worker_id === worker1.id, 'Task assigned_worker_id persisted');
    assert(t1.drawing_ref === 'DWG-OPUS-HV-B2-014', 'drawing_ref persisted');
    assert(t1.boq_ref === 'BOQ-B2-CHW-004', 'boq_ref persisted');
    assert(t1.evidence_required === 1, 'evidence_required flag persisted as 1');
    assert(t1.evidence_type === 'Inspection Report & Photo', 'evidence_type persisted');

    // --- 8. VERIFY JOINED METADATA IN GET /api/tasks ---
    console.log('\n>>> 8. Joined Metadata in GET /api/tasks & GET /api/tasks/:id');
    const tasksListRes = await req({
      path: `/api/tasks?project_id=${p1.id}`,
      method: 'GET',
      token: adminToken
    });

    assert(tasksListRes.status === 200, 'GET /api/tasks returned 200');
    const matchedTask = tasksListRes.body.find((item: any) => item.id === t1.id);
    assert(!!matchedTask, 'Created task found in project task list');
    assert(matchedTask.site_name === 'Opus Podium & Basement Plantrooms', 'Joined site_name verified', matchedTask.site_name);
    assert(matchedTask.work_package_code === 'WP-HVAC-CHW-01', 'Joined work_package_code verified', matchedTask.work_package_code);
    assert(matchedTask.work_package_name === 'Chilled Water Piping & Valves Installation', 'Joined work_package_name verified');
    assert(matchedTask.company_name === 'Thermal Dynamics MEP Subcontracting LLC', 'Joined company_name verified');
    assert(matchedTask.supervisor_name === 'Tareq Mansoor (HVAC Lead)', 'Joined supervisor_name verified', matchedTask.supervisor_name);
    assert(matchedTask.worker_name === 'Sunil Sharma (Senior Pipe Fitter)', 'Joined worker_name verified', matchedTask.worker_name);

    // Single item GET /api/tasks/:id
    const singleTaskRes = await req({
      path: `/api/tasks/${t1.id}`,
      method: 'GET',
      token: adminToken
    });
    assert(singleTaskRes.status === 200, 'GET /api/tasks/:id returned 200');
    assert(singleTaskRes.body.site_name === 'Opus Podium & Basement Plantrooms', 'Single task GET includes joined site_name');
    assert(singleTaskRes.body.work_package_code === 'WP-HVAC-CHW-01', 'Single task GET includes joined work_package_code');

    // --- 9. WBS TREE HIERARCHY ENDPOINT ---
    console.log('\n>>> 9. Complete Hierarchical WBS Tree (GET /api/projects/:id/wbs-tree)');
    const treeRes = await req({
      path: `/api/projects/${p1.id}/wbs-tree`,
      method: 'GET',
      token: adminToken
    });

    assert(treeRes.status === 200, 'GET /api/projects/:id/wbs-tree returned 200');
    assert(treeRes.body.project_id === p1.id, 'Tree project_id matches');
    assert(Array.isArray(treeRes.body.tree), 'Tree array returned');
    const treeNode = treeRes.body.tree.find((node: any) => node.id === wbs1.id);
    assert(!!treeNode, 'WBS Level 1 node present in tree hierarchy');
    assert(Array.isArray(treeNode.work_packages), 'WBS node has work_packages array');
    const treeWp = treeNode.work_packages.find((pkg: any) => pkg.id === wp1.id);
    assert(!!treeWp, 'Work Package node present under WBS node');
    assert(Array.isArray(treeWp.tasks), 'Work Package node has tasks array');
    const treeTask = treeWp.tasks.find((task: any) => task.id === t1.id);
    assert(!!treeTask, 'Task node present under Work Package in nested tree');
    assert(treeTask.title === 'B2 Chiller Plant Header Welding & Flange Fit-up', 'Task title verified in tree');

    // --- 10. PROJECT MASTER AGGREGATES & METRICS ---
    console.log('\n>>> 10. Project Master Aggregated Counters & Trade Breakdown');
    const updatedMasterRes = await req({
      path: `/api/projects/${p1.id}/master`,
      method: 'GET',
      token: adminToken
    });

    assert(updatedMasterRes.body.sites_count === 1, 'sites_count is 1');
    assert(updatedMasterRes.body.work_packages_count === 1, 'work_packages_count is 1');
    assert(updatedMasterRes.body.tasks_count === 1, 'tasks_count is 1');
    const hvacTrade = updatedMasterRes.body.trades_breakdown.find((tr: any) => tr.trade === 'HVAC');
    assert(!!hvacTrade && hvacTrade.total_tasks === 1, 'trades_breakdown correctly attributes task to HVAC trade');

    // --- 11. ROLE ACCESS / MULTI-TENANT VERIFICATION ---
    console.log('\n>>> 11. Role Scoping & Multi-Tenant Access Verification');
    const loginSup = await req({
      path: '/api/auth/login',
      method: 'POST',
      body: { username: 'supervisor_tareq', password: 'Password123!' }
    });
    assert(loginSup.status === 200 && !!loginSup.body.token, 'Supervisor authenticated');
    const supToken = loginSup.body.token;

    const supMasterRes = await req({
      path: `/api/projects/${p1.id}/master`,
      method: 'GET',
      token: supToken
    });
    assert(supMasterRes.status === 200, 'Supervisor can view Project Master for assigned project');

  } finally {
    console.log('\nStopping test server...');
    await stopServer(serverProc);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  console.log('\n================================================================================');
  console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error running Project Master suite:', err);
  process.exit(1);
});
