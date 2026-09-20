/**
 * MEP Management Platform — Release V1.3.0 Control Tower & Lookahead Test Suite
 * Validates:
 * 1. Live Manpower Radar (present punches vs expected staffing by trade).
 * 2. Deterministic Attention Engine ranking (CRITICAL/HIGH/MEDIUM).
 * 3. 2-Week Lookahead schedule with cascading predecessor delay risk.
 * 4. Task Blocker lifecycle (raise blocker, auto-transition to Blocked, resolve, and unblock).
 */
import http from 'http';
import { DatabaseSync } from 'node:sqlite';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const TEST_PORT = 3197;

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
  console.log('  MEP V1.3.0 CONTROL TOWER, LOOKAHEAD & BLOCKER ENGINE TEST SUITE');
  console.log('================================================================================\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mep-control-tower-test-'));
  const testDbFile = path.join(tmpDir, 'control_tower_test.db');
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
        JWT_SECRET: 'test-secret-control-tower-v1.3',
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
    assert(healthy, 'Control tower test server booted and /api/health is healthy');
    if (!healthy) throw new Error('Test server failed to start');

    // --- 1. ADMIN AUTHENTICATION ---
    console.log('\n>>> 1. Authentication and Project Setup');
    const loginRes = await req({
      path: '/api/auth/login',
      method: 'POST',
      body: { username: 'admin', password: 'ChangeMe123!' }
    });
    assert(loginRes.status === 200 && !!loginRes.body.token, 'Admin authentication successful');
    const adminToken = loginRes.body.token;

    // Create Project
    const projRes = await req({
      path: '/api/projects',
      method: 'POST',
      body: { name: 'Burj Control Tower Test', client: 'Emaar Properties', status: 'Active', budget: 12000000 },
      token: adminToken
    });
    assert(projRes.status === 201 && !!projRes.body.id, 'Project created successfully');
    const projectId = projRes.body.id;

    // Create Site
    const siteRes = await req({
      path: '/api/sites',
      method: 'POST',
      body: { project_id: projectId, name: 'Burj MEP Plant Level 42', latitude: 25.1972, longitude: 55.2744, geofence_radius_m: 100 },
      token: adminToken
    });
    assert(siteRes.status === 201 && !!siteRes.body.id, 'Site created with GPS geofence');
    const siteId = siteRes.body.id;

    // Create Shift Template
    const shiftRes = await req({
      path: '/api/shift_templates',
      method: 'POST',
      body: {
        project_id: projectId,
        name: 'Day Shift 8hr',
        start_time: '00:00',
        end_time: '23:59',
        grace_minutes: 1440,
        break_duration_minutes: 60,
        working_days_json: '[0,1,2,3,4,5,6]'
      },
      token: adminToken
    });
    assert(shiftRes.status === 201, 'Shift template created');
    const shiftId = shiftRes.body.id;

    // Create Worker User
    const workerUserRes = await req({
      path: '/api/users',
      method: 'POST',
      body: { username: 'hvac_worker_1', password: 'password123', name: 'John Ductman', role: 'Worker', email: 'john@mep.com', project_ids: [projectId] },
      token: adminToken
    });
    assert(workerUserRes.status === 201, 'Worker user account created');
    const workerUserId = workerUserRes.body.id;

    // Create Worker Profile
    const workerProfileRes = await req({
      path: '/api/workers',
      method: 'POST',
      body: { project_id: projectId, site_id: siteId, user_id: workerUserId, name: 'John Ductman', trade: 'HVAC', employment_type: 'Permanent' },
      token: adminToken
    });
    assert(workerProfileRes.status === 201, 'Worker profile created');
    const workerId = workerProfileRes.body.id;

    // Assign Worker
    const assignRes = await req({
      path: '/api/worker_assignments',
      method: 'POST',
      body: {
        worker_id: workerId,
        project_id: projectId,
        site_id: siteId,
        start_date: new Date().toISOString().split('T')[0],
        status: 'Active',
      },
      token: adminToken
    });
    assert(assignRes.status === 201, 'Worker assignment created');

    // Link Schedule
    const schedRes = await req({
      path: '/api/worker_schedules',
      method: 'POST',
      body: { worker_id: workerId, shift_template_id: shiftId, effective_from: '2020-01-01' },
      token: adminToken
    });
    assert(schedRes.status === 201, 'Worker schedule linked');

    // Worker Login
    const workerLoginRes = await req({
      path: '/api/auth/login',
      method: 'POST',
      body: { username: 'hvac_worker_1', password: 'password123' }
    });
    assert(workerLoginRes.status === 200, 'Worker authenticated');
    const workerToken = workerLoginRes.body.token;

    // --- 2. MANPOWER RADAR TEST ---
    console.log('\n>>> 2. Live Manpower Radar (Present Headcount vs Expected)');
    const initialTowerRes = await req({
      path: `/api/control-tower?project_id=${projectId}`,
      token: adminToken
    });
    assert(initialTowerRes.status === 200, 'GET /api/control-tower succeeds');
    assert(initialTowerRes.body.radar.present_count === 0, 'Initially 0 workers present');
    assert(initialTowerRes.body.radar.expected_count === 1, 'Expected count reflects active assignment (1)');
    assert(initialTowerRes.body.radar.expected_by_trade.HVAC === 1, 'Expected trade breakdown has HVAC: 1');

    // Worker punches in via GPS
    const punchInRes = await req({
      path: '/api/attendance/gps-punch-in',
      method: 'POST',
      body: { project_id: projectId, site_id: siteId, lat: 25.1972, lng: 55.2744, accuracy: 8 },
      token: workerToken
    });
    assert(punchInRes.status === 201 || punchInRes.status === 200, 'Worker GPS punch-in succeeds within geofence', punchInRes.body);

    // Check Control Tower Radar again
    const punchedTowerRes = await req({
      path: `/api/control-tower?project_id=${projectId}`,
      token: adminToken
    });
    assert(punchedTowerRes.body.radar.present_count === 1, 'Live Manpower Radar now shows 1 present on site');
    assert(punchedTowerRes.body.radar.present_by_trade.HVAC === 1, 'Live Manpower Radar attributes 1 present to HVAC trade');
    assert(punchedTowerRes.body.radar.variance_percent === 0, 'Staffing variance is 0% (exact scheduled coverage)');

    // --- 3. 2-WEEK LOOKAHEAD & PREDECESSOR RISK ENGINE ---
    console.log('\n>>> 3. 2-Week Lookahead Schedule & Predecessor Delay Detection');
    const today = new Date().toISOString().split('T')[0];
    const todayPlus2 = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0];
    const todayPlus5 = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];
    const todayPlus10 = new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0];

    // Create Predecessor Task
    const predTaskRes = await req({
      path: '/api/tasks',
      method: 'POST',
      body: {
        project_id: projectId,
        title: 'Primary Chilled Water Pipe Routing',
        trade: 'HVAC',
        start: today,
        end: todayPlus5,
        progress: 20,
        status: 'Blocked',
        priority: 'Critical',
      },
      token: adminToken
    });
    assert(predTaskRes.status === 201, 'Predecessor task created with status Blocked');
    const predTaskId = predTaskRes.body.id;

    // Create Successor Task
    const succTaskRes = await req({
      path: '/api/tasks',
      method: 'POST',
      body: {
        project_id: projectId,
        title: 'Chilled Water Hydrostatic Pressure Testing',
        trade: 'HVAC',
        start: todayPlus5,
        end: todayPlus10,
        progress: 0,
        status: 'Not Started',
        priority: 'High',
      },
      token: adminToken
    });
    assert(succTaskRes.status === 201, 'Successor task created');
    const succTaskId = succTaskRes.body.id;

    // Link dependency (predTaskId -> succTaskId)
    const depRes = await req({
      path: '/api/dependencies',
      method: 'POST',
      body: {
        project_id: projectId,
        task_id: succTaskId,
        predecessor_task_id: predTaskId,
        dependency_type: 'Finish-to-Start',
        status: 'Pending'
      },
      token: adminToken
    });
    assert(depRes.status === 201, 'Dependency linked from Predecessor to Successor');

    // Query 2-Week Lookahead
    const lookaheadRes = await req({
      path: `/api/tasks/lookahead?project_id=${projectId}&days=14`,
      token: adminToken
    });
    assert(lookaheadRes.status === 200, 'GET /api/tasks/lookahead returns 200');
    assert(lookaheadRes.body.metrics.total_lookahead_tasks >= 2, 'Both tasks detected in 14-day rolling window');
    assert(lookaheadRes.body.metrics.blocked_tasks >= 1, 'Blocked task identified in lookahead metrics');
    assert(lookaheadRes.body.metrics.predecessor_risk_tasks >= 1, 'Predecessor risk detected in lookahead metrics');

    // Verify cascading risk on successor task
    const succInLookahead = lookaheadRes.body.tasks.find((t: any) => t.id === succTaskId);
    assert(succInLookahead && succInLookahead.predecessor_risk === true, 'Successor task flagged with predecessor_risk=true');
    assert(succInLookahead.risky_predecessors?.length > 0, 'Successor task contains details of blocking predecessor');
    assert(succInLookahead.risky_predecessors[0].title === 'Primary Chilled Water Pipe Routing', 'Risky predecessor title matches');

    // --- 4. TASK BLOCKER LIFECYCLE ENGINE ---
    console.log('\n>>> 4. Task Blocker Lifecycle (Raise, Auto-Block, List, Resolve, Unblock)');
    // Create new Task
    const cableTaskRes = await req({
      path: '/api/tasks',
      method: 'POST',
      body: {
        project_id: projectId,
        title: 'Substation LV Main Feeder Pulling',
        trade: 'Electrical',
        start: today,
        end: todayPlus2,
        progress: 40,
        status: 'In Progress',
        priority: 'High',
      },
      token: adminToken
    });
    assert(cableTaskRes.status === 201, 'Electrical cable pulling task created');
    const cableTaskId = cableTaskRes.body.id;

    // Raise Blocker
    const raiseBlockerRes = await req({
      path: `/api/tasks/${cableTaskId}/blockers`,
      method: 'POST',
      body: {
        blocker_type: 'Material Delay',
        description: 'Awaiting 240mm 4-core XLPE cable drum delivery from warehouse',
        blocking_trade: 'Procurement',
        impact_days: 3,
      },
      token: adminToken
    });
    assert(raiseBlockerRes.status === 201 && !!raiseBlockerRes.body.id, 'Task blocker raised via POST /api/tasks/:id/blockers');
    const blockerId = raiseBlockerRes.body.id;

    // Check Task status automatically transitioned to 'Blocked'
    const updatedTaskRes = await req({
      path: `/api/tasks/${cableTaskId}`,
      token: adminToken
    });
    assert(updatedTaskRes.body.status === 'Blocked', 'Task status was automatically updated to Blocked upon raising blocker');

    // Query blockers register
    const blockersListRes = await req({
      path: `/api/blockers?project_id=${projectId}`,
      token: adminToken
    });
    assert(blockersListRes.status === 200, 'GET /api/blockers returns 200', blockersListRes.body);
    assert(Array.isArray(blockersListRes.body) && blockersListRes.body.some((b: any) => b.id === blockerId && b.status === 'Active'), 'Raised blocker appears in active blockers list', blockersListRes.body);

    // Check Control Tower Attention Stream includes the blocked task
    const attentionTowerRes = await req({
      path: `/api/control-tower?project_id=${projectId}`,
      token: adminToken
    });
    const attentionItems = attentionTowerRes.body.attention_items || [];
    const cableBlockedItem = attentionItems.find((item: any) => item.target_id === cableTaskId);
    assert(!!cableBlockedItem, 'Blocked task appears in Control Tower Attention Engine queue');
    assert(cableBlockedItem?.severity === 'CRITICAL' || cableBlockedItem?.severity === 'HIGH', 'Blocked task has high priority severity in Attention Engine');

    // Resolve Blocker
    const resolveRes = await req({
      path: `/api/tasks/${cableTaskId}/blockers/${blockerId}/resolve`,
      method: 'POST',
      body: { resolution_notes: 'Cable drum arrived on site via Transporter 04. QA receipt signed.' },
      token: adminToken
    });
    assert(resolveRes.status === 200 && resolveRes.body.ok === true, 'POST resolve blocker returns 200 with ok=true');
    assert(resolveRes.body.blocker.status === 'Resolved', 'Blocker status marked Resolved');
    assert(resolveRes.body.remaining_active_blockers === 0, 'Remaining active blockers count is 0');
    assert(resolveRes.body.task_status === 'In Progress', 'Task status automatically reverted to In Progress because progress was > 0');

    // Check task directly
    const finalTaskRes = await req({
      path: `/api/tasks/${cableTaskId}`,
      token: adminToken
    });
    assert(finalTaskRes.body.status === 'In Progress', 'Verified task persisted in database as In Progress');

    console.log('\n================================================================================');
    console.log(`  CONTROL TOWER SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================================\n');

  } finally {
    await stopServer(serverProc);
    try {
      if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);
      const wal = testDbFile + '-wal';
      const shm = testDbFile + '-shm';
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {}
  }

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
