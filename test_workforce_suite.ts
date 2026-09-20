/**
 * MEP Management Platform — Comprehensive Workforce & GPS Test Suite
 * Validates Workforce, Sites, GPS Geofencing, Shift Templates,
 * Attendance, Overtime, Leave, Payroll, and Site Instructions FSM.
 */
import http from 'http';
import { DatabaseSync } from 'node:sqlite';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const TEST_PORT = 3198;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

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
        let parsed;
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
    if (detail) console.error('     Detail:', JSON.stringify(detail).slice(0, 300));
    failed++;
  }
}

function waitForHealth(port: number, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const r = http.get({ hostname: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, (res) => {
        if (res.statusCode === 200) resolve(true);
        else if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(check, 300);
      });
      r.on('error', () => {
        if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(check, 300);
      });
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

async function runWorkforceSuite() {
  console.log('================================================================================');
  console.log('  MEP WORKFORCE, GPS ATTENDANCE, LEAVE, PAYROLL & INSTRUCTIONS SUITE');
  console.log('================================================================================\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mep-workforce-test-'));
  const testDbPath = path.join(tmpDir, 'workforce_test.db');

  let serverProc: ChildProcess | null = null;

  try {
    serverProc = spawn(process.execPath, [path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, MEP_DB_PATH: testDbPath, PORT: String(TEST_PORT) },
      stdio: 'pipe'
    });

    const isHealthy = await waitForHealth(TEST_PORT);
    assert(isHealthy, 'Test server booted and healthy');

    // ── 1. Authenticate as Admin ──
    console.log('\n>>> 1. Authentication & Setup');
    const loginRes = await req({
      path: '/api/auth/login',
      method: 'POST',
      body: { username: 'admin', password: 'ChangeMe123!' }
    });
    assert(loginRes.status === 200 && Boolean(loginRes.body.token), 'Admin logged in successfully');
    const adminToken = loginRes.body.token;

    // Create a Project
    const projRes = await req({
      path: '/api/projects',
      method: 'POST',
      token: adminToken,
      body: { name: 'Hospital Tower MEP', client: 'Apex Health', budget: 15000000 }
    });
    assert(projRes.status === 201 && Boolean(projRes.body.id), 'Test project created');
    const projectId = projRes.body.id;

    // Create Worker user account
    const workerUserRes = await req({
      path: '/api/users',
      method: 'POST',
      token: adminToken,
      body: { username: 'worker1', name: 'John Doe', password: 'WorkerPass123!', role: 'Worker' }
    });
    assert(workerUserRes.status === 201, 'Worker user account created');
    const workerUserId = workerUserRes.body.id;

    // Create SiteSupervisor user account
    const supervisorUserRes = await req({
      path: '/api/users',
      method: 'POST',
      token: adminToken,
      body: { username: 'sup1', name: 'Site Supervisor Mike', password: 'SuperPass123!', role: 'SiteSupervisor' }
    });
    assert(supervisorUserRes.status === 201, 'SiteSupervisor user account created');
    const supervisorUserId = supervisorUserRes.body.id;

    // Add memberships
    await req({ path: `/api/users/${workerUserId}`, method: 'PUT', token: adminToken, body: { project_ids: [projectId] } });
    await req({ path: `/api/users/${supervisorUserId}`, method: 'PUT', token: adminToken, body: { project_ids: [projectId] } });

    // Log in as Worker
    const workerLogin = await req({ path: '/api/auth/login', method: 'POST', body: { username: 'worker1', password: 'WorkerPass123!' } });
    assert(workerLogin.status === 200, 'Worker logged in');
    const workerToken = workerLogin.body.token;

    // Log in as Supervisor
    const supLogin = await req({ path: '/api/auth/login', method: 'POST', body: { username: 'sup1', password: 'SuperPass123!' } });
    assert(supLogin.status === 200, 'Supervisor logged in');
    const supervisorToken = supLogin.body.token;

    // ── 2. Sites & Geofencing ──
    console.log('\n>>> 2. Site Creation & Geofence Configuration');
    // Site center: Dubai Marina (25.0772, 55.1333) with 100m valid, 150m warning
    const siteRes = await req({
      path: '/api/sites',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        name: 'Marina Sector A',
        address: 'Marina Walk',
        city: 'Dubai',
        country: 'UAE',
        latitude: 25.0772,
        longitude: 55.1333,
        geofence_radius_m: 100,
        geofence_warning_radius_m: 150,
        timezone: 'Asia/Dubai'
      }
    });
    assert(siteRes.status === 201 && siteRes.body.name === 'Marina Sector A', 'Site created with GPS coordinates and geofence radius');
    const siteId = siteRes.body.id;

    // Update site
    const updateSite = await req({
      path: `/api/sites/${siteId}`,
      method: 'PUT',
      token: adminToken,
      body: { address: 'Plot 401 Marina Walk' }
    });
    assert(updateSite.status === 200 && updateSite.body.address === 'Plot 401 Marina Walk', 'Site updated');

    // ── 3. Workers & Assignments ──
    console.log('\n>>> 3. Worker Registration & Profile');
    const workerRecordRes = await req({
      path: '/api/workers',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        site_id: siteId,
        user_id: workerUserId,
        name: 'John Doe',
        employee_id: 'EMP-001',
        trade: 'Electrical',
        employment_type: 'Permanent',
        nationality: 'India',
        phone: '+971501234567',
        supervisor_id: supervisorUserId
      }
    });
    assert(workerRecordRes.status === 201 && workerRecordRes.body.trade === 'Electrical', 'Worker record created and linked to user_id');
    const workerId = workerRecordRes.body.id;

    // Worker assignment
    const assignRes = await req({
      path: '/api/worker_assignments',
      method: 'POST',
      token: adminToken,
      body: {
        worker_id: workerId,
        project_id: projectId,
        site_id: siteId,
        role_on_site: 'Lead Electrician',
        start_date: '2026-03-01'
      }
    });
    assert(assignRes.status === 201, 'Worker assigned to site');

    // Shift Template
    console.log('\n>>> 4. Shift Templates');
    const shiftRes = await req({
      path: '/api/shift_templates',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        name: 'Standard MEP Day Shift',
        start_time: '07:00',
        end_time: '16:00',
        grace_minutes: 15,
        break_minutes: 60,
        regular_hours: 8,
        ot_threshold_hours: 8
      }
    });
    assert(shiftRes.status === 201 && shiftRes.body.regular_hours === 8, 'Shift template created');

    // ── 5. GPS Punch In / Punch Out & Geofencing ──
    console.log('\n>>> 5. GPS Attendance & Geofence Verification');

    // Test 5A: Valid punch-in (50m from center - inside 100m)
    // Dubai Marina center: (25.0772, 55.1333). 0.0003 deg lat ~ 33m
    const validPunchIn = await req({
      path: '/api/attendance/gps-punch-in',
      method: 'POST',
      token: workerToken,
      body: {
        project_id: projectId,
        site_id: siteId,
        lat: 25.0774,
        lng: 55.1333,
        accuracy: 10
      }
    });
    assert(validPunchIn.status === 201, 'GPS punch-in accepted (201)');
    assert(validPunchIn.body.punch_in_geofence_status === 'Valid', `Geofence status is Valid (got ${validPunchIn.body.punch_in_geofence_status})`);
    assert(validPunchIn.body.punch_in_distance_m < 100, `Distance correctly calculated < 100m (${Math.round(validPunchIn.body.punch_in_distance_m)}m)`);
    const punchId = validPunchIn.body.id;

    // Test 5B: Double punch-in prevention
    const doublePunch = await req({
      path: '/api/attendance/gps-punch-in',
      method: 'POST',
      token: workerToken,
      body: { project_id: projectId, site_id: siteId, lat: 25.0774, lng: 55.1333 }
    });
    assert(doublePunch.status === 409, 'Double punch-in rejected with 409 Conflict');

    // Test 5C: GPS punch-out
    const punchOut = await req({
      path: '/api/attendance/gps-punch-out',
      method: 'POST',
      token: workerToken,
      body: { lat: 25.0773, lng: 55.1333, accuracy: 12 }
    });
    assert(punchOut.status === 200, 'GPS punch-out successful (200)');
    assert(punchOut.body.punch_out !== null, 'punch_out timestamp recorded');
    assert(punchOut.body.status === 'Closed', 'Attendance status closed');

    // Test 5D: Outside geofence punch-in test with temporary second worker
    const worker2User = await req({
      path: '/api/users',
      method: 'POST',
      token: adminToken,
      body: { username: 'worker2', name: 'Far Worker', password: 'WorkerPass123!', role: 'Worker' }
    });
    await req({ path: `/api/users/${worker2User.body.id}`, method: 'PUT', token: adminToken, body: { project_ids: [projectId] } });
    const worker2Login = await req({ path: '/api/auth/login', method: 'POST', body: { username: 'worker2', password: 'WorkerPass123!' } });
    const worker2Token = worker2Login.body.token;

    // Punch from 10km away
    const outsidePunch = await req({
      path: '/api/attendance/gps-punch-in',
      method: 'POST',
      token: worker2Token,
      body: {
        project_id: projectId,
        site_id: siteId,
        lat: 25.1772, // ~11 km away
        lng: 55.1333,
        accuracy: 15
      }
    });
    assert(outsidePunch.status === 201, 'Punch-in recorded even if outside geofence (for audit)');
    assert(outsidePunch.body.punch_in_geofence_status === 'Outside Geofence', 'Geofence status correctly marked "Outside Geofence"');
    assert(outsidePunch.body.punch_in_distance_m > 5000, `Distance correctly detected > 5000m (${Math.round(outsidePunch.body.punch_in_distance_m)}m)`);
    await req({ path: '/api/attendance/gps-punch-out', method: 'POST', token: worker2Token, body: {} });

    // ── 6. Overtime Approval Workflow ──
    console.log('\n>>> 6. Overtime Workflow & Self-Approval Prevention');
    // Set overtime on punchId directly in db for test simulation
    const db = new DatabaseSync(testDbPath);
    db.prepare("UPDATE attendance SET overtime_hours=2.5, ot_status='Pending' WHERE id=?").run(punchId);
    db.close();

    // Worker attempts self-approval
    const selfApproveOT = await req({
      path: `/api/attendance/${punchId}/overtime-approve`,
      method: 'POST',
      token: workerToken,
      body: { action: 'Approved' }
    });
    assert(selfApproveOT.status === 403, 'Worker self-approval of overtime is BLOCKED (403)');

    // Supervisor approves overtime
    const supApproveOT = await req({
      path: `/api/attendance/${punchId}/overtime-approve`,
      method: 'POST',
      token: supervisorToken,
      body: { action: 'Approved' }
    });
    assert(supApproveOT.status === 200 && supApproveOT.body.ot_status === 'Approved', 'Supervisor approves overtime (200, status=Approved)');

    // ── 7. Site Instructions 7-Stage FSM ──
    console.log('\n>>> 7. Site Instructions Lifecycle (Draft -> Closed)');
    // 7A: Create (Draft)
    const createInstr = await req({
      path: '/api/site_instructions',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        site_id: siteId,
        instruction_type: 'Installation',
        title: 'Run cable tray on L3 corridor',
        description: 'Install 300mm perforated tray as per Drawing E-301',
        priority: 'High',
        due_date: '2026-03-25'
      }
    });
    assert(createInstr.status === 201 && createInstr.body.status === 'Draft', 'Instruction created in Draft status');
    assert(createInstr.body.instruction_number.startsWith('SI-'), `Auto-numbered with SI- prefix (${createInstr.body.instruction_number})`);
    const instrId = createInstr.body.id;

    // 7B: Assign (Draft -> Assigned)
    const assignInstr = await req({
      path: `/api/site_instructions/${instrId}/assign`,
      method: 'POST',
      token: adminToken,
      body: { assigned_worker_id: workerId, assigned_supervisor_id: supervisorUserId }
    });
    assert(assignInstr.status === 200 && assignInstr.body.status === 'Assigned', 'Instruction assigned to worker (Draft -> Assigned)');

    // 7C: Acknowledge (Assigned -> Acknowledged by Worker)
    const ackInstr = await req({
      path: `/api/site_instructions/${instrId}/acknowledge`,
      method: 'POST',
      token: workerToken,
      body: { comment: 'Received, will commence tomorrow morning' }
    });
    assert(ackInstr.status === 200 && ackInstr.body.status === 'Acknowledged', 'Worker acknowledged instruction (Assigned -> Acknowledged)');

    // 7D: Start (Acknowledged -> In Progress by Worker)
    const startInstr = await req({
      path: `/api/site_instructions/${instrId}/start`,
      method: 'POST',
      token: workerToken,
      body: { comment: 'Tools and tray materials loaded to Level 3' }
    });
    assert(startInstr.status === 200 && startInstr.body.status === 'In Progress', 'Work started (Acknowledged -> In Progress)');

    // 7E: Evidence Submission (In Progress -> Ready for Verification)
    const evidenceInstr = await req({
      path: `/api/site_instructions/${instrId}/evidence`,
      method: 'POST',
      token: workerToken,
      body: {
        comment: 'Cable tray complete, 45m installed with drop rods at 1.2m intervals',
        attachment_name: 'tray_l3_completed.jpg',
        attachment_data: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      }
    });
    assert(evidenceInstr.status === 200 && evidenceInstr.body.status === 'Ready for Verification', 'Evidence submitted (In Progress -> Ready for Verification)');

    // 7F: Verification (Ready for Verification -> Verified by Supervisor)
    const verifyInstr = await req({
      path: `/api/site_instructions/${instrId}/verify`,
      method: 'POST',
      token: supervisorToken,
      body: { action: 'Verified', comment: 'Site inspected. Support intervals compliant.' }
    });
    assert(verifyInstr.status === 200 && verifyInstr.body.status === 'Verified', 'Supervisor verified work (Ready for Verification -> Verified)');

    // 7G: Close (Verified -> Closed)
    const closeInstr = await req({
      path: `/api/site_instructions/${instrId}/close`,
      method: 'POST',
      token: adminToken,
      body: { comment: 'Instruction closed, verified in progress report' }
    });
    assert(closeInstr.status === 200 && closeInstr.body.status === 'Closed', 'Instruction closed (Verified -> Closed)');

    // Verify updates history trail
    const updatesRes = await req({ path: `/api/site_instructions/${instrId}/updates`, token: adminToken });
    assert(updatesRes.status === 200 && updatesRes.body.length >= 5, `Audit updates trail preserved (${updatesRes.body.length} entries)`);

    // ── 8. Leave Management & Self-Approval Prevention ──
    console.log('\n>>> 8. Leave Management & Balance Tracking');
    const leaveTypesRes = await req({ path: '/api/leave_types', token: adminToken });
    assert(leaveTypesRes.status === 200 && leaveTypesRes.body.length >= 5, `Default leave types seeded (${leaveTypesRes.body.length} types)`);
    const alType = leaveTypesRes.body.find((t: any) => t.code === 'AL');
    assert(Boolean(alType), 'Annual Leave (AL) type exists');

    // Worker submits leave
    const leaveReq = await req({
      path: '/api/leave_requests',
      method: 'POST',
      token: workerToken,
      body: {
        project_id: projectId,
        leave_type_id: alType.id,
        start_date: '2026-04-01',
        end_date: '2026-04-05',
        reason: 'Family visit'
      }
    });
    assert(leaveReq.status === 201 && leaveReq.body.status === 'Pending', 'Leave request submitted (status=Pending)');
    const leaveReqId = leaveReq.body.id;

    // Worker attempts self-approval
    const selfApproveLeave = await req({
      path: `/api/leave_requests/${leaveReqId}/approve`,
      method: 'POST',
      token: workerToken,
      body: {}
    });
    assert(selfApproveLeave.status === 403, 'Worker self-approval of leave is BLOCKED (403)');

    // Supervisor approves leave
    const supApproveLeave = await req({
      path: `/api/leave_requests/${leaveReqId}/approve`,
      method: 'POST',
      token: supervisorToken,
      body: {}
    });
    assert(supApproveLeave.status === 200 && supApproveLeave.body.status === 'Approved', 'Supervisor approves leave (200, status=Approved)');

    // ── 9. Payroll Engine & Role Isolation ──
    console.log('\n>>> 9. Payroll Engine & Compensation Isolation');
    // Setup worker payroll profile
    const profileRes = await req({
      path: '/api/payroll_profiles',
      method: 'POST',
      token: adminToken,
      body: {
        worker_id: workerId,
        basic_daily_rate: 150,
        rate_type: 'Daily',
        currency: 'AED',
        ot_multiplier: 1.5,
        housing_allowance: 500,
        transport_allowance: 200,
        food_allowance: 150
      }
    });
    assert(profileRes.status === 201, 'Worker payroll profile created');

    // Create payroll period
    const periodRes = await req({
      path: '/api/payroll_periods',
      method: 'POST',
      token: adminToken,
      body: {
        project_id: projectId,
        period_name: 'March 2026',
        period_start: '2026-03-01',
        period_end: '2026-03-31'
      }
    });
    assert(periodRes.status === 201 && periodRes.body.status === 'Open', 'Payroll period created (status=Open)');
    const periodId = periodRes.body.id;

    // Compute payroll
    const computeRes = await req({
      path: `/api/payroll_periods/${periodId}/compute`,
      method: 'POST',
      token: adminToken,
      body: {}
    });
    assert(computeRes.status === 200 && computeRes.body.ok === true, 'Payroll computed from attendance');

    // Financial role isolation: Worker CANNOT view payroll
    const workerPayroll = await req({ path: '/api/payroll_profiles', token: workerToken });
    assert(workerPayroll.status === 403, 'Worker cannot access /api/payroll_profiles (403 Forbidden)');

    // Financial role isolation: Supervisor CANNOT view payroll
    const supPayroll = await req({ path: '/api/payroll_profiles', token: supervisorToken });
    assert(supPayroll.status === 403, 'SiteSupervisor cannot access /api/payroll_profiles (403 Forbidden)');

    // Lock payroll period
    const lockRes = await req({
      path: `/api/payroll_periods/${periodId}/lock`,
      method: 'POST',
      token: adminToken,
      body: {}
    });
    assert(lockRes.status === 200 && lockRes.body.status === 'Locked', 'Payroll period locked (status=Locked)');

    // Attempt recompute on locked period fails
    const recompute = await req({
      path: `/api/payroll_periods/${periodId}/compute`,
      method: 'POST',
      token: adminToken,
      body: {}
    });
    assert(recompute.status === 400, 'Recomputing locked payroll period is blocked (400)');

    // ── 10. Live Workforce Dashboard & Daily Report ──
    console.log('\n>>> 10. Live Workforce Dashboard & Daily Reports');
    const liveDashboard = await req({ path: `/api/workforce/today?project_id=${projectId}`, token: adminToken });
    assert(liveDashboard.status === 200 && liveDashboard.body.today !== undefined, 'Live workforce dashboard returned current stats');

    const dailyReport = await req({ path: `/api/reports/workforce/daily?project_id=${projectId}`, token: adminToken });
    assert(dailyReport.status === 200 && dailyReport.body.summary !== undefined, 'Daily workforce report generated');

  } catch (err: any) {
    console.error('Test suite execution error:', err);
    failed++;
  } finally {
    if (serverProc) await stopServer(serverProc);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  console.log('\n================================================================================');
  console.log(`  WORKFORCE TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================\n');

  if (failed > 0) process.exit(1);
}

runWorkforceSuite();
