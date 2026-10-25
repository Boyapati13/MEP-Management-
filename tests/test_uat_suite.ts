/**
 * MEP Management Platform — Release V1.4.0 Enterprise UAT Test Suite
 * Validates 10 Real-World MEP Enterprise Acceptance Scenarios:
 * 1. Project Master Kickoff & Contract Baseline
 * 2. Multi-tier WBS, Site & Work Package Hierarchy
 * 3. Work Package Full Command Center (Rollup, Tasks, Claims, Blockers, Procurement)
 * 4. Professional Task Engine with Drawing, BOQ & Evidence Requirements
 * 5. Supply Chain Procurement -> Programme Integration & Delivery Delay Risks
 * 6. Operational Project Actions Register & Automated Overdue Calculation
 * 7. Governance Project Decisions Register with Cost & Schedule Impacts
 * 8. Advanced 5x5 Risk Heat Map Matrix Calculation & Severity Stratification
 * 9. Subcontractor Progress Claim Submission & PM Verification Workflow
 * 10. Executive Client Report Publishing & Zero-Leakage Client Dashboard Firewall
 */
import http from 'http';
import { DatabaseSync } from 'node:sqlite';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const TEST_PORT = 3205;

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

function assert(condition: boolean, message: string, extra?: any) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    if (extra !== undefined) console.error('         Details:', extra);
    failed++;
  }
}

async function runUatSuite() {
  console.log('================================================================================');
  console.log('  MEP V1.4.0 ENTERPRISE ACCEPTANCE & UAT TEST SUITE (10 SCENARIOS)');
  console.log('================================================================================\n');

  const tmpDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mep-uat-test-'));
  const dbPath = path.join(tmpDbDir, 'uat.db');

  let serverProcess: ChildProcess | null = null;

  try {
    let serverLogs = '';
    const serverScript = fs.existsSync(path.join(process.cwd(), 'dist', 'server.cjs'))
      ? [path.join(process.cwd(), 'dist', 'server.cjs')]
      : [path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server.ts'];

    serverProcess = spawn(
      process.execPath,
      serverScript,
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PORT: String(TEST_PORT),
          MEP_DB_PATH: dbPath,
          NODE_ENV: 'test',
          JWT_SECRET: 'uat-secret-test-key-140'
        },
        stdio: 'pipe'
      }
    );

    serverProcess.stdout?.on('data', (d) => { serverLogs += d.toString(); });
    serverProcess.stderr?.on('data', (d) => { serverLogs += d.toString(); });

    // Wait for server health
    let healthy = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await req({ path: '/api/health' });
        if (res.status === 200) {
          healthy = true;
          break;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 250));
    }

    if (!healthy) {
      console.error('Server logs on boot failure:\n', serverLogs);
    }
    assert(healthy, 'UAT test server booted and responded healthy to /api/health');

    // ------------------------------------------------------------------------
    // SCENARIO 1: Authentication & Project Master Setup
    // ------------------------------------------------------------------------
    console.log('\n>>> SCENARIO 1: Authentication & Project Master Setup');
    const loginRes = await req({
      path: '/api/login',
      method: 'POST',
      body: { username: 'admin', password: 'ChangeMe123!' }
    });
    assert(loginRes.status === 200 && Boolean(loginRes.body.token), 'Bootstrap Admin logged in successfully');
    const adminToken = loginRes.body.token;

    const projRes = await req({
      path: '/api/projects',
      method: 'POST',
      token: adminToken,
      body: {
        name: 'The Dubai Tower MEP Delivery',
        project_code: 'PRJ-DXB-001',
        currency: 'AED',
        contract_value: 85000000,
        contract_type: 'FIDIC Lump Sum',
        stage: 'Execution',
        client_name: 'Emaar Properties PJSC',
        main_contractor: 'Arabtec MEP Joint Venture',
        consultant: 'WSP Middle East',
        baseline_start_date: '2026-01-01',
        baseline_end_date: '2026-12-31',
        forecast_end_date: '2027-01-20'
      }
    });
    assert(projRes.status === 201, 'Project Master created with contract parameters');
    const projectId = projRes.body.id;

    const masterRes = await req({ path: `/api/projects/${projectId}/master`, token: adminToken });
    assert(masterRes.status === 200, 'GET /api/projects/:id/master returns 200');
    assert(masterRes.body.contract_value === 85000000, 'Master contract value verified at 85M AED');
    assert(masterRes.body.schedule_variance_days === 20, 'Schedule variance correctly calculated as +20 days delay');

    // ------------------------------------------------------------------------
    // SCENARIO 2: Multi-Tier Hierarchy Setup (Site -> WBS -> Work Package)
    // ------------------------------------------------------------------------
    console.log('\n>>> SCENARIO 2: Multi-Tier Hierarchy Setup');
    const siteRes = await req({
      path: '/api/sites',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        name: 'Tower Pod A - Central Plant',
        geofence_radius_m: 150
      }
    });
    assert(siteRes.status === 201, 'Site created');
    const siteId = siteRes.body.id;

    const wbsRes = await req({
      path: '/api/wbs_items',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        code: '1.0',
        name: 'Central Chiller Plant & Chilled Water Risers',
        level: 1,
        discipline: 'Mechanical'
      }
    });
    assert(wbsRes.status === 201, 'Level 1 WBS created');
    const wbsId = wbsRes.body.id;

    // Create Subcontractor Company
    const compRes = await req({
      path: '/api/companies',
      method: 'POST',
      token: adminToken,
      body: {
        name: 'Apex HVAC Chillers LLC',
        type: 'Subcontractor',
        trade: 'HVAC'
      }
    });
    const subCompanyId = compRes.body.id;
    await req({
      path: '/api/project_companies',
      method: 'POST',
      token: adminToken,
      body: { project_id: projectId, company_id: subCompanyId, role: 'Subcontractor' }
    });

    const wpRes = await req({
      path: '/api/work_packages',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        code: 'WP-CHW-01',
        name: 'Chilled Water Plant Installation',
        discipline: 'Mechanical',
        site_id: siteId,
        wbs_item_id: wbsId,
        company_id: subCompanyId,
        budget_allocated: 12500000,
        start_date: '2026-03-01',
        target_date: '2026-08-30'
      }
    });
    assert(wpRes.status === 201, 'Work package linked to Site, WBS & Company');
    const wpId = wpRes.body.id;

    // ------------------------------------------------------------------------
    // SCENARIO 3: Professional Task Engine Lifecycle
    // ------------------------------------------------------------------------
    console.log('\n>>> SCENARIO 3: Professional Task Engine');
    const taskRes = await req({
      path: '/api/tasks',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        work_package_id: wpId,
        site_id: siteId,
        wbs_item_id: wbsId,
        company_id: subCompanyId,
        title: 'Rig & Align Chiller Unit CH-01',
        trade: 'HVAC',
        start: '2026-04-10',
        end: '2026-04-25',
        progress: 25,
        status: 'In Progress',
        drawing_ref: 'DWG-M-CHW-501',
        boq_ref: 'BOQ-MECH-02.1',
        evidence_required: 1,
        evidence_type: 'Photo + Signoff'
      }
    });
    assert(taskRes.status === 201, 'Task created with complete engineering & evidence metadata');
    const taskId = taskRes.body.id;

    // Raise a blocker
    const blockerRes = await req({
      path: `/api/tasks/${taskId}/blockers`,
      method: 'POST',
      token: adminToken,
      body: {
        blocker_type: 'Material',
        severity: 'Critical',
        description: 'Chiller vibration isolator springs delayed by supplier'
      }
    });
    assert(blockerRes.status === 201, 'Active blocker raised on task');

    // Verify task automatically transitioned to Blocked
    const taskCheck = await req({ path: `/api/tasks/${taskId}`, token: adminToken });
    assert(taskCheck.body.status === 'Blocked', 'Task status automatically updated to Blocked');

    // ------------------------------------------------------------------------
    // SCENARIO 4: Work Package Command Center Rollup
    // ------------------------------------------------------------------------
    console.log('\n>>> SCENARIO 4: Work Package Full Command Center');
    const wpCenterRes = await req({
      path: `/api/work_packages/${wpId}/command-center`,
      token: adminToken
    });
    assert(wpCenterRes.status === 200, 'GET /api/work_packages/:id/command-center returns 200');
    assert(wpCenterRes.body.metrics.total_tasks === 1, 'Metrics reflect 1 total task');
    assert(wpCenterRes.body.metrics.blocked_tasks === 1, 'Metrics reflect 1 blocked task');
    assert(wpCenterRes.body.metrics.active_blockers_count === 1, 'Metrics reflect 1 active blocker');
    assert(wpCenterRes.body.work_package.company_name === 'Apex HVAC Chillers LLC', 'Joined company name verified');

    // ------------------------------------------------------------------------
    // SCENARIO 5: Supply Chain Procurement -> Programme Integration
    // ------------------------------------------------------------------------
    console.log('\n>>> SCENARIO 5: Supply Chain Procurement -> Programme Integration');
    // PO 1: Critical Delay (Delivery 2026-04-20 > Task Start 2026-04-10)
    const poRes = await req({
      path: '/api/purchase_orders',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        po_number: 'PO-CHILLER-01',
        vendor: 'Carrier Middle East',
        trade: 'HVAC',
        description: 'Centrifugal Water-Cooled Chiller 1000TR',
        amount: 3200000,
        order_date: '2026-01-15',
        expected_delivery_date: '2026-04-20',
        task_id: taskId,
        status: 'Ordered'
      }
    });
    assert(poRes.status === 201, 'Purchase order linked to Task');

    const impactRes = await req({
      path: `/api/procurement/programme-impact?project_id=${projectId}`,
      token: adminToken
    });
    assert(impactRes.status === 200, 'GET /api/procurement/programme-impact returns 200');
    assert(impactRes.body.summary.total_linked === 1, 'Summary reflects 1 linked PO');
    assert(impactRes.body.summary.critical_lead_time_risks === 1, 'Accurately detected critical lead-time delivery risk');
    assert(impactRes.body.items[0].buffer_days < 0, 'Buffer days negative indicating delivery past task start');

    // ------------------------------------------------------------------------
    // SCENARIO 6: Operational Project Actions Register
    // ------------------------------------------------------------------------
    console.log('\n>>> SCENARIO 6: Operational Project Actions Register');
    const pastDate = '2025-01-01';
    const actRes1 = await req({
      path: '/api/project_actions',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        action_no: 'ACT-001',
        title: 'Review acoustic vibration report for Plant Room',
        assigned_to_name: 'Acoustic Specialist',
        priority: 'High',
        due_date: pastDate,
        status: 'Open',
        source_type: 'Site Walk'
      }
    });
    assert(actRes1.status === 201, 'Project action created');
    const actionId = actRes1.body.id;

    // Listing actions should auto-detect past due date and stamp status Overdue
    const actionsList = await req({
      path: `/api/project_actions?project_id=${projectId}`,
      token: adminToken
    });
    assert(actionsList.status === 200, 'GET /api/project_actions returns 200');
    const overdueAct = actionsList.body.find((a: any) => a.id === actionId);
    assert(overdueAct && overdueAct.status === 'Overdue', 'Automated engine accurately updated past due action to Overdue');

    // Complete the action
    await req({
      path: `/api/project_actions/${actionId}`,
      method: 'PUT',
      token: adminToken,
      body: { status: 'Completed', completed_at: new Date().toISOString() }
    });
    const completedCheck = await req({ path: `/api/project_actions/${actionId}`, token: adminToken });
    assert(completedCheck.body.status === 'Completed', 'Action marked Completed');

    // ------------------------------------------------------------------------
    // SCENARIO 7: Governance Project Decisions Register
    // ------------------------------------------------------------------------
    console.log('\n>>> SCENARIO 7: Governance Project Decisions Register');
    const decRes = await req({
      path: '/api/project_decisions',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        decision_no: 'DEC-001',
        title: 'Upgrade Plant Room secondary chilled water pumps to VFD integrated drives',
        context: 'Required to meet LEED Platinum energy reduction targets',
        decision_taken: 'Approved VFD integration with +$45,000 commercial variation',
        decided_by: 'Consultant Lead & Client PM',
        cost_impact: 45000,
        schedule_impact_days: 0,
        status: 'Approved'
      }
    });
    assert(decRes.status === 201, 'Governance decision recorded');
    const decId = decRes.body.id;

    const decList = await req({ path: `/api/project_decisions?project_id=${projectId}`, token: adminToken });
    assert(decList.status === 200 && decList.body.length === 1, 'Decisions register queried successfully');
    assert(decList.body[0].cost_impact === 45000, 'Decision cost impact tracked');

    // ------------------------------------------------------------------------
    // SCENARIO 8: Advanced 5x5 Risk Heat Map Matrix
    // ------------------------------------------------------------------------
    console.log('\n>>> SCENARIO 8: Advanced 5x5 Risk Heat Map Matrix');
    await req({
      path: '/api/risks',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        title: 'Chiller Plant Room structural slab deflection under operating load',
        category: 'Technical',
        probability: '4',
        impact: '5',
        mitigation: 'Install secondary steel spreader beams under chiller inertia bases',
        linked_task_id: taskId
      }
    });

    const matrixRes = await req({
      path: `/api/project_risks/matrix?project_id=${projectId}`,
      token: adminToken
    });
    assert(matrixRes.status === 200, 'GET /api/project_risks/matrix returns 200');
    assert(matrixRes.body.total_risks === 1, 'Matrix contains 1 risk');
    assert(matrixRes.body.summary.critical === 1, 'Risk scored as Critical (P4 x I5 = Score 20)');
    assert(matrixRes.body.matrix_grid['4_5'].length === 1, 'Risk situated in cell P4 x I5');

    // ------------------------------------------------------------------------
    // SCENARIO 9: Subcontractor Progress Claim & PM Verification
    // ------------------------------------------------------------------------
    console.log('\n>>> SCENARIO 9: Subcontractor Progress Claim & Verification');
    const claimRes = await req({
      path: '/api/progress_submissions',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        work_package_id: wpId,
        company_id: subCompanyId,
        period_date: '2026-04-30',
        discipline: 'Mechanical',
        claimed_percentage: 40,
        claimed_amount: 5000000,
        notes: 'Chiller installation milestone claim'
      }
    });
    assert(claimRes.status === 201, 'Subcontractor progress claim submitted');
    const claimId = claimRes.body.id;

    // PM verifies and adjusts claim
    const verifyRes = await req({
      path: `/api/progress_submissions/${claimId}/verify`,
      method: 'POST',
      token: adminToken,
      body: {
        verified_percent: 32,
        verification_notes: 'Adjusted down to 32% pending final alignment laser signoff'
      }
    });
    assert(verifyRes.status === 200, 'PM verified and adjusted claim to 32%');

    // ------------------------------------------------------------------------
    // SCENARIO 10: Executive Client Report Publishing & Firewall
    // ------------------------------------------------------------------------
    console.log('\n>>> SCENARIO 10: Executive Client Publishing & Firewall');
    // Create Client user
    const clientUserRes = await req({
      path: '/api/users',
      method: 'POST',
      token: adminToken,
      body: {
        username: 'client_rep',
        password: 'ClientUser123!',
        name: 'Emaar Client Representative',
        role: 'Client',
        status: 'Active'
      }
    });
    const clientUserId = clientUserRes.body.id;
    await req({
      path: `/api/users/${clientUserId}`,
      method: 'PUT',
      token: adminToken,
      body: { project_ids: [projectId] }
    });

    const clientLogin = await req({
      path: '/api/login',
      method: 'POST',
      body: { username: 'client_rep', password: 'ClientUser123!' }
    });
    assert(clientLogin.status === 200, 'Client representative authenticated');
    const clientToken = clientLogin.body.token;

    // Before publishing, client summary progress must be "Progress not yet published"
    const clientPreSum = await req({
      path: `/api/projects/${projectId}/client-summary`,
      token: clientToken
    });
    assert(clientPreSum.status === 200, 'Client summary accessed');
    assert(clientPreSum.body.overall_progress === null, 'Pre-publish: Client overall progress is strictly null (zero leakage of internal tasks)');

    // PM compiles draft report
    const draftRep = await req({
      path: '/api/progress_reports',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        report_number: 'MR-001',
        title: 'Monthly Progress Report - April 2026',
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        overall_progress_percent: 28.5,
        status: 'Draft'
      }
    });
    const reportId = draftRep.body.id;

    // PM publishes to client
    const pubRes = await req({
      path: `/api/progress_reports/${reportId}/publish`,
      method: 'POST',
      token: adminToken
    });
    assert(pubRes.status === 200, 'Monthly progress report published to Client');

    // Verify Client summary now strictly reflects published figure (28.5%)
    const clientPostSum = await req({
      path: `/api/projects/${projectId}/client-summary`,
      token: clientToken
    });
    assert(clientPostSum.body.overall_progress === 28.5, 'Post-publish: Client portal displays verified published figure of 28.5%');

  } finally {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
    try {
      fs.rmSync(tmpDbDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n================================================================================');
  console.log(`  UAT RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================');
  if (failed > 0) process.exit(1);
}

runUatSuite().catch(err => {
  console.error('Fatal UAT suite error:', err);
  process.exit(1);
});
