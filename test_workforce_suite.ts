/**
 * MEP Management Platform — V1.2.1 Workforce Security & Payroll Correctness Suite
 * Covers assignment-scoped GPS attendance, IDOR isolation, minute-based time math,
 * approved-overtime-only payroll, leave/rest-day/public-holiday behavior, and SI scope.
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

function isoDateInTz(timeZone: string, date = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).map(p => [p.type, p.value])) as Record<string,string>;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function hourInTz(timeZone: string, date = new Date()): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).find(p => p.type === 'hour');
  return Number(part?.value || 0);
}

function addDays(dateString: string, days: number): string {
  const d = new Date(dateString + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function pickEarlyMorningTimezone(): string {
  const zones = [
    'Pacific/Pago_Pago','Pacific/Honolulu','America/Anchorage','America/Los_Angeles',
    'America/Denver','America/Chicago','America/New_York','America/Sao_Paulo','UTC',
    'Europe/London','Europe/Athens','Europe/Istanbul','Asia/Dubai','Asia/Karachi',
    'Asia/Dhaka','Asia/Bangkok','Asia/Singapore','Asia/Tokyo','Australia/Sydney',
    'Pacific/Noumea','Pacific/Auckland','Pacific/Kiritimati'
  ];
  return zones.find(z => {
    const h = hourInTz(z);
    return h >= 0 && h < 4;
  }) || 'UTC';
}

async function login(username: string, password: string) {
  return req({ path: '/api/auth/login', method: 'POST', body: { username, password } });
}

async function createUser(adminToken: string, body: any) {
  return req({ path: '/api/users', method: 'POST', token: adminToken, body });
}

async function runWorkforceSuite() {
  console.log('================================================================================');
  console.log('  MEP V1.2.1 WORKFORCE SECURITY & PAYROLL CORRECTNESS SUITE');
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

    const healthy = await waitForHealth(TEST_PORT);
    assert(healthy, 'Test server booted and /api/health is healthy');
    if (!healthy) throw new Error('Server did not become healthy');

    console.log('\n>>> 1. Authentication and project/site fixtures');
    const adminLogin = await login('admin', 'ChangeMe123!');
    assert(adminLogin.status === 200 && Boolean(adminLogin.body.token), 'Admin login succeeds');
    const adminToken = adminLogin.body.token;

    const projectARes = await req({
      path: '/api/projects', method: 'POST', token: adminToken,
      body: { name: 'BOV Mqabba Workforce Test', client: 'Bank Client', budget: 1000000 }
    });
    const projectBRes = await req({
      path: '/api/projects', method: 'POST', token: adminToken,
      body: { name: 'Hotel Alpha Workforce Test', client: 'Hotel Client', budget: 2000000 }
    });
    assert(projectARes.status === 201 && projectBRes.status === 201, 'Two isolated projects created');
    const projectA = projectARes.body.id;
    const projectB = projectBRes.body.id;

    const siteARes = await req({
      path: '/api/sites', method: 'POST', token: adminToken,
      body: {
        project_id: projectA, name: 'BOV Mqabba Site', latitude: 35.8470, longitude: 14.4660,
        geofence_radius_m: 150, geofence_warning_radius_m: 220, timezone: 'Europe/Malta'
      }
    });
    const siteA2Res = await req({
      path: '/api/sites', method: 'POST', token: adminToken,
      body: {
        project_id: projectA, name: 'BOV Secondary Site', latitude: 35.9000, longitude: 14.5000,
        geofence_radius_m: 150, geofence_warning_radius_m: 220, timezone: 'Europe/Malta'
      }
    });
    const siteBRes = await req({
      path: '/api/sites', method: 'POST', token: adminToken,
      body: {
        project_id: projectB, name: 'Hotel Alpha Site', latitude: 35.9200, longitude: 14.4900,
        geofence_radius_m: 150, geofence_warning_radius_m: 220, timezone: 'Europe/Malta'
      }
    });
    assert(siteARes.status === 201 && siteA2Res.status === 201 && siteBRes.status === 201, 'Project sites created');
    const siteA = siteARes.body.id;
    const siteA2 = siteA2Res.body.id;
    const siteB = siteBRes.body.id;

    const pmRes = await createUser(adminToken, {
      username: 'pm-a', name: 'PM Project A', password: 'ProjectPass123!', role: 'ProjectManager', project_ids: [projectA]
    });
    const supRes = await createUser(adminToken, {
      username: 'sup-a', name: 'Supervisor A', password: 'SupervisorPass123!', role: 'SiteSupervisor', project_ids: [projectA]
    });
    const workerUserRes = await createUser(adminToken, {
      username: 'worker-a1', name: 'Worker A1', password: 'WorkerPass123!', role: 'Worker', project_ids: [projectA]
    });
    assert(pmRes.status === 201 && supRes.status === 201 && workerUserRes.status === 201, 'PM, supervisor and worker users created');
    const pmToken = (await login('pm-a','ProjectPass123!')).body.token;
    const supToken = (await login('sup-a','SupervisorPass123!')).body.token;
    const workerToken = (await login('worker-a1','WorkerPass123!')).body.token;

    const workerRes = await req({
      path: '/api/workers', method: 'POST', token: adminToken,
      body: {
        project_id: projectA, site_id: siteA, user_id: workerUserRes.body.id, name: 'Worker A1',
        employee_id: 'A-001', trade: 'Electrical', supervisor_id: supRes.body.id
      }
    });
    assert(workerRes.status === 201, 'Worker profile created');
    const workerId = workerRes.body.id;

    const assignRes = await req({
      path: '/api/worker_assignments', method: 'POST', token: adminToken,
      body: {
        worker_id: workerId, project_id: projectA, site_id: siteA,
        supervisor_id: supRes.body.id, role_on_site: 'Electrician', start_date: '2020-01-01'
      }
    });
    assert(assignRes.status === 201, 'Worker receives explicit active project/site assignment');

    const shiftRes = await req({
      path: '/api/shift_templates', method: 'POST', token: adminToken,
      body: {
        project_id: projectA, name: 'All-Day Test Shift', start_time: '00:00', end_time: '23:59',
        grace_minutes: 1440, break_minutes: 60, regular_hours: 8, ot_threshold_hours: 8,
        working_days_json: '[0,1,2,3,4,5,6]'
      }
    });
    assert(shiftRes.status === 201, 'Shift template created with explicit working days');

    const scheduleRes = await req({
      path: '/api/worker_schedules', method: 'POST', token: adminToken,
      body: { worker_id: workerId, shift_template_id: shiftRes.body.id, effective_from: '2020-01-01' }
    });
    assert(scheduleRes.status === 201, 'Worker schedule linked to worker');

    console.log('\n>>> 2. Strict worker assignment and site/project isolation');
    const unassignedUser = await createUser(adminToken, {
      username: 'worker-unassigned', name: 'Unassigned Worker', password: 'WorkerPass123!', role: 'Worker', project_ids: [projectA]
    });
    const unassignedToken = (await login('worker-unassigned','WorkerPass123!')).body.token;

    const noProfilePunch = await req({
      path: '/api/attendance/gps-punch-in', method: 'POST', token: unassignedToken,
      body: { project_id: projectA, site_id: siteA, lat: 35.8470, lng: 14.4660, accuracy: 10 }
    });
    assert(noProfilePunch.status === 403, 'Worker with project membership but no worker profile cannot punch (403)', noProfilePunch.body);

    const unassignedProfile = await req({
      path: '/api/workers', method: 'POST', token: adminToken,
      body: { project_id: projectA, site_id: siteA, user_id: unassignedUser.body.id, name: 'Unassigned Worker', employee_id: 'A-002', trade: 'Electrical' }
    });
    const noAssignmentPunch = await req({
      path: '/api/attendance/gps-punch-in', method: 'POST', token: unassignedToken,
      body: { project_id: projectA, site_id: siteA, lat: 35.8470, lng: 14.4660, accuracy: 10 }
    });
    assert(noAssignmentPunch.status === 403, 'Worker profile without active worker_assignment cannot punch (403)', noAssignmentPunch.body);

    const unassignedAssign = await req({
      path: '/api/worker_assignments', method: 'POST', token: adminToken,
      body: { worker_id: unassignedProfile.body.id, project_id: projectA, site_id: siteA, supervisor_id: supRes.body.id, start_date: '2020-01-01' }
    });
    assert(unassignedAssign.status === 201, 'Explicit assignment can be added after access is denied');

    const legacyPunchBypass = await req({
      path: '/api/attendance/punch-in', method: 'POST', token: unassignedToken,
      body: { project_id: projectA }
    });
    assert(legacyPunchBypass.status === 410, 'Worker cannot bypass GPS/assignment policy through legacy punch-in endpoint');

    const missingGpsPunch = await req({
      path: '/api/attendance/gps-punch-in', method: 'POST', token: unassignedToken,
      body: { project_id: projectA, site_id: siteA }
    });
    assert(missingGpsPunch.status === 400, 'GPS punch-in requires valid coordinates and accuracy');

    const wrongSitePunch = await req({
      path: '/api/attendance/gps-punch-in', method: 'POST', token: unassignedToken,
      body: { project_id: projectA, site_id: siteA2, lat: 35.9000, lng: 14.5000, accuracy: 10 }
    });
    assert(wrongSitePunch.status === 403, 'Worker assigned to Site A cannot punch at Site A2 (403)', wrongSitePunch.body);

    const crossProjectSite = await req({
      path: '/api/attendance/gps-punch-in', method: 'POST', token: unassignedToken,
      body: { project_id: projectA, site_id: siteB, lat: 35.9200, lng: 14.4900, accuracy: 10 }
    });
    assert(crossProjectSite.status === 403, 'Project A punch cannot use Project B site ID (403)', crossProjectSite.body);

    const outsidePunch = await req({
      path: '/api/attendance/gps-punch-in', method: 'POST', token: unassignedToken,
      body: { project_id: projectA, site_id: siteA, lat: 36.0470, lng: 14.4660, accuracy: 15 }
    });
    assert(outsidePunch.status === 201, 'Authorized worker punch outside geofence is retained for audit');
    assert(outsidePunch.body.punch_in_geofence_status === 'Outside Geofence', 'Outside punch is explicitly classified');
    assert(Number(outsidePunch.body.punch_in_distance_m) > 5000, 'Outside punch stores server-calculated distance');
    await req({ path: '/api/attendance/gps-punch-out', method: 'POST', token: unassignedToken, body: { lat: 36.0470, lng: 14.4660, accuracy: 15 } });

    console.log('\n>>> 3. Worker directory IDOR and company isolation');
    const workerBUser = await createUser(adminToken, {
      username: 'worker-b1', name: 'Worker B1', password: 'WorkerPass123!', role: 'Worker', project_ids: [projectB]
    });
    const workerBRes = await req({
      path: '/api/workers', method: 'POST', token: adminToken,
      body: { project_id: projectB, site_id: siteB, user_id: workerBUser.body.id, name: 'Worker B1', employee_id: 'B-001', trade: 'HVAC' }
    });
    assert(workerBRes.status === 201, 'Project B worker fixture created');

    const pmForeignGet = await req({ path: `/api/workers/${workerBRes.body.id}`, token: pmToken });
    const pmForeignPut = await req({
      path: `/api/workers/${workerBRes.body.id}`, method: 'PUT', token: pmToken, body: { trade: 'Electrical' }
    });
    assert(pmForeignGet.status === 403, 'Project A PM cannot GET Project B worker by UUID (403)', pmForeignGet.body);
    assert(pmForeignPut.status === 403, 'Project A PM cannot PUT Project B worker by UUID (403)', pmForeignPut.body);

    const companyARes = await req({ path: '/api/companies', method: 'POST', token: adminToken, body: { name: 'Electrical Sub A', type: 'Subcontractor', trade: 'Electrical' } });
    const companyBRes = await req({ path: '/api/companies', method: 'POST', token: adminToken, body: { name: 'HVAC Sub B', type: 'Subcontractor', trade: 'HVAC' } });
    await req({ path: `/api/projects/${projectA}/companies`, method: 'POST', token: adminToken, body: { company_id: companyARes.body.id, role_in_project: 'Subcontractor' } });
    await req({ path: `/api/projects/${projectA}/companies`, method: 'POST', token: adminToken, body: { company_id: companyBRes.body.id, role_in_project: 'Subcontractor' } });

    const subUserRes = await createUser(adminToken, {
      username: 'sub-a', name: 'Subcontractor A User', password: 'SubPass123!', role: 'Subcontractor',
      company_id: companyARes.body.id, company: 'Electrical Sub A', project_ids: [projectA]
    });
    const subToken = (await login('sub-a','SubPass123!')).body.token;
    const companyBWorker = await req({
      path: '/api/workers', method: 'POST', token: adminToken,
      body: { project_id: projectA, site_id: siteA, company_id: companyBRes.body.id, name: 'HVAC Company B Worker', employee_id: 'A-B-01', trade: 'HVAC' }
    });
    assert(companyBWorker.status === 201, 'Company B worker created in Project A');
    const subForeignWorker = await req({ path: `/api/workers/${companyBWorker.body.id}`, token: subToken });
    assert(subForeignWorker.status === 403, 'Subcontractor A cannot read Company B worker by UUID (403)', subForeignWorker.body);

    console.log('\n>>> 4. Minute-based attendance calculation and overtime approval');
    const validPunch = await req({
      path: '/api/attendance/gps-punch-in', method: 'POST', token: workerToken,
      body: { project_id: projectA, site_id: siteA, lat: 35.8471, lng: 14.4660, accuracy: 8 }
    });
    assert(validPunch.status === 201, 'Assigned worker GPS punch-in succeeds');
    assert(validPunch.body.worker_id === workerId, 'Punch derives worker_id server-side');
    assert(validPunch.body.site_id === siteA, 'Punch stores assigned site');

    const db1 = new DatabaseSync(testDbPath);
    const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    db1.prepare("UPDATE attendance SET punch_in=? WHERE id=?").run(tenHoursAgo, validPunch.body.id);
    db1.close();

    const punchedOut = await req({
      path: '/api/attendance/gps-punch-out', method: 'POST', token: workerToken,
      body: { lat: 35.8471, lng: 14.4660, accuracy: 8 }
    });
    assert(punchedOut.status === 200, 'GPS punch-out succeeds');
    assert(Math.abs(Number(punchedOut.body.elapsed_minutes) - 600) <= 1, 'Elapsed duration stored as integer minutes (~600)', punchedOut.body);
    assert(Number(punchedOut.body.break_minutes) === 60, 'Configured 60-minute break deducted exactly', punchedOut.body);
    assert(Number(punchedOut.body.regular_minutes) === 480, 'Regular time capped at 480 integer minutes', punchedOut.body);
    assert(Math.abs(Number(punchedOut.body.raw_overtime_minutes) - 60) <= 1, 'Raw overtime is ~60 integer minutes after break', punchedOut.body);
    assert(Number(punchedOut.body.approved_overtime_minutes) === 0 && punchedOut.body.ot_status === 'Pending', 'Pending overtime is not approved/payable');

    const selfOt = await req({
      path: `/api/attendance/${validPunch.body.id}/overtime-approve`, method: 'POST', token: workerToken, body: { action: 'Approved' }
    });
    assert(selfOt.status === 403, 'Worker cannot self-approve overtime');

    console.log('\n>>> 5. Payroll uses approved overtime only and hides finance from PM');
    const profile = await req({
      path: '/api/payroll_profiles', method: 'POST', token: adminToken,
      body: { worker_id: workerId, basic_daily_rate: 160, rate_type: 'Daily', currency: 'EUR', ot_multiplier: 1.5, bank_account: 'SECRET-IBAN' }
    });
    assert(profile.status === 201, 'Payroll profile created by authorized role');

    const pmProfiles = await req({ path: '/api/payroll_profiles', token: pmToken });
    const pmPeriodsBefore = await req({ path: `/api/payroll_periods?project_id=${projectA}`, token: pmToken });
    assert(pmProfiles.status === 403, 'ProjectManager cannot access payroll profile rates/bank data');
    assert(pmPeriodsBefore.status === 403, 'ProjectManager cannot access financial payroll periods');

    const workDate = punchedOut.body.work_date;
    const period = await req({
      path: '/api/payroll_periods', method: 'POST', token: adminToken,
      body: { project_id: projectA, period_name: 'Current Test Day', period_start: workDate, period_end: workDate }
    });
    assert(period.status === 201, 'Payroll period created');

    const computePending = await req({ path: `/api/payroll_periods/${period.body.id}/compute`, method: 'POST', token: adminToken, body: {} });
    assert(computePending.status === 200 && computePending.body.ok, 'Payroll computes with pending OT excluded');

    const pendingPeriod = await req({ path: `/api/payroll_periods/${period.body.id}`, token: adminToken });
    const pendingEntry = pendingPeriod.body.entries.find((e: any) => e.worker_id === workerId);
    assert(Boolean(pendingEntry), 'Payroll entry generated for worker');
    assert(Number(pendingEntry?.approved_overtime_minutes || 0) === 0, 'Pending OT contributes zero approved overtime minutes to payroll', pendingEntry);
    assert(Number(pendingEntry?.overtime_pay || 0) === 0, 'Pending OT contributes zero overtime pay', pendingEntry);

    const supervisorOt = await req({
      path: `/api/attendance/${validPunch.body.id}/overtime-approve`, method: 'POST', token: supToken, body: { action: 'Approved' }
    });
    assert(supervisorOt.status === 200 && supervisorOt.body.ot_status === 'Approved', 'Authorized supervisor approves OT');
    assert(Math.abs(Number(supervisorOt.body.approved_overtime_minutes) - 60) <= 1, 'Approved overtime minutes copied from raw overtime');

    const computeApproved = await req({ path: `/api/payroll_periods/${period.body.id}/compute`, method: 'POST', token: adminToken, body: {} });
    const approvedPeriod = await req({ path: `/api/payroll_periods/${period.body.id}`, token: adminToken });
    const approvedEntry = approvedPeriod.body.entries.find((e: any) => e.worker_id === workerId);
    assert(computeApproved.status === 200, 'Payroll recomputes after OT approval');
    assert(Math.abs(Number(approvedEntry?.approved_overtime_minutes || 0) - 60) <= 1, 'Approved OT included in payroll minute snapshot', approvedEntry);
    assert(Number(approvedEntry?.overtime_pay || 0) > 0, 'Approved OT produces overtime pay');

    console.log('\n>>> 6. Attendance correction recalculates minute totals');
    const adjustment = await req({
      path: `/api/attendance/${validPunch.body.id}/adjust`, method: 'POST', token: workerToken,
      body: {
        adjusted_punch_in: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(),
        adjusted_punch_out: new Date().toISOString(),
        adjustment_reason: 'Verified corrected start time'
      }
    });
    assert(adjustment.status === 201, 'Worker can request correction to own attendance');
    const approveAdjustment = await req({
      path: `/api/attendance_adjustments/${adjustment.body.id}/approve`, method: 'POST', token: supToken,
      body: { action: 'Approved' }
    });
    assert(approveAdjustment.status === 200 && approveAdjustment.body.status === 'Approved', 'Supervisor approves attendance correction');
    const db2 = new DatabaseSync(testDbPath);
    const corrected = db2.prepare('SELECT * FROM attendance WHERE id=?').get(validPunch.body.id) as any;
    db2.close();
    assert(Number(corrected.elapsed_minutes) >= 539 && Number(corrected.elapsed_minutes) <= 541, 'Attendance correction recalculates elapsed minutes', corrected);
    assert(Number(corrected.break_minutes) === 60, 'Attendance correction recalculates break minutes', corrected);
    assert(Number(corrected.regular_minutes) === 480, 'Attendance correction recalculates regular minutes', corrected);

    console.log('\n>>> 7. Site Instruction record-level and subresource isolation');
    const instruction = await req({
      path: '/api/site_instructions', method: 'POST', token: adminToken,
      body: {
        project_id: projectA, site_id: siteA, instruction_type: 'Installation',
        title: 'Install containment before ceiling closure', priority: 'High'
      }
    });
    assert(instruction.status === 201, 'Admin creates official Site Instruction');

    const assignInstruction = await req({
      path: `/api/site_instructions/${instruction.body.id}/assign`, method: 'POST', token: adminToken,
      body: { assigned_worker_id: workerId, assigned_supervisor_id: supRes.body.id }
    });
    assert(assignInstruction.status === 200, 'Instruction assigned to authorized worker');

    const foreignGet = await req({ path: `/api/site_instructions/${instruction.body.id}`, token: unassignedToken });
    const foreignUpdatesGet = await req({ path: `/api/site_instructions/${instruction.body.id}/updates`, token: unassignedToken });
    const foreignUpdatesPost = await req({
      path: `/api/site_instructions/${instruction.body.id}/updates`, method: 'POST', token: unassignedToken,
      body: { content: 'Forged update' }
    });
    const foreignEvidence = await req({
      path: `/api/site_instructions/${instruction.body.id}/evidence`, method: 'POST', token: unassignedToken,
      body: { comment: 'Forged evidence' }
    });
    const foreignVerify = await req({
      path: `/api/site_instructions/${instruction.body.id}/verify`, method: 'POST', token: unassignedToken,
      body: { action: 'Verified' }
    });
    const foreignClose = await req({
      path: `/api/site_instructions/${instruction.body.id}/close`, method: 'POST', token: unassignedToken,
      body: {}
    });
    assert(foreignGet.status === 403, 'Foreign worker cannot GET instruction by UUID');
    assert(foreignUpdatesGet.status === 403, 'Foreign worker cannot GET instruction updates');
    assert(foreignUpdatesPost.status === 403, 'Foreign worker cannot POST instruction updates');
    assert(foreignEvidence.status === 403, 'Foreign worker cannot submit evidence to unrelated instruction');
    assert(foreignVerify.status === 403, 'Worker cannot verify unrelated instruction');
    assert(foreignClose.status === 403, 'Worker cannot close unrelated instruction');

    const ack = await req({
      path: `/api/site_instructions/${instruction.body.id}/acknowledge`, method: 'POST', token: workerToken,
      body: { comment: 'Acknowledged' }
    });
    const start = await req({
      path: `/api/site_instructions/${instruction.body.id}/start`, method: 'POST', token: workerToken,
      body: { comment: 'Started' }
    });
    const evidence = await req({
      path: `/api/site_instructions/${instruction.body.id}/evidence`, method: 'POST', token: workerToken,
      body: { comment: 'Complete', attachment_name: 'evidence.jpg', attachment_data: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }
    });
    const verify = await req({
      path: `/api/site_instructions/${instruction.body.id}/verify`, method: 'POST', token: supToken,
      body: { action: 'Verified', comment: 'Verified on site' }
    });
    const close = await req({
      path: `/api/site_instructions/${instruction.body.id}/close`, method: 'POST', token: adminToken,
      body: { comment: 'Closed' }
    });
    assert(ack.status === 200 && start.status === 200 && evidence.status === 200, 'Assigned worker can acknowledge, start and submit evidence');
    assert(verify.status === 200 && verify.body.status === 'Verified', 'Scoped supervisor can verify instruction');
    assert(close.status === 200 && close.body.status === 'Closed', 'Admin can close verified instruction');

    console.log('\n>>> 8. Leave chargeable days, rest days, public holidays, self-approval');
    const fixedHoliday = await req({
      path: '/api/public_holidays', method: 'POST', token: adminToken,
      body: { project_id: projectA, site_id: siteA, country_code: 'MT', holiday_date: '2026-04-02', name: 'Test Holiday', paid: true }
    });
    assert(fixedHoliday.status === 201, 'Public holiday can be configured for project/site');

    const weekdayShift = await req({
      path: '/api/shift_templates', method: 'POST', token: adminToken,
      body: {
        project_id: projectA, name: 'Weekday Leave Shift', start_time: '07:00', end_time: '16:00',
        grace_minutes: 15, break_minutes: 60, regular_hours: 8, ot_threshold_hours: 8,
        working_days_json: '[1,2,3,4,5]'
      }
    });
    await req({
      path: '/api/worker_schedules', method: 'POST', token: adminToken,
      body: { worker_id: workerId, shift_template_id: weekdayShift.body.id, effective_from: '2026-04-01', effective_to: '2026-04-30' }
    });

    const leaveTypes = await req({ path: '/api/leave_types', token: workerToken });
    const annual = leaveTypes.body.find((x: any) => x.code === 'AL');
    const leave = await req({
      path: '/api/leave_requests', method: 'POST', token: workerToken,
      body: { project_id: projectA, leave_type_id: annual.id, start_date: '2026-04-01', end_date: '2026-04-05', reason: 'Family leave' }
    });
    assert(leave.status === 201, 'Leave request accepted');
    assert(Number(leave.body.days_requested) === 2, 'Leave charge excludes weekend rest days and configured public holiday', leave.body);

    const selfLeave = await req({ path: `/api/leave_requests/${leave.body.id}/approve`, method: 'POST', token: workerToken, body: {} });
    assert(selfLeave.status === 403, 'Worker cannot self-approve leave');
    const supLeave = await req({ path: `/api/leave_requests/${leave.body.id}/approve`, method: 'POST', token: supToken, body: {} });
    assert(supLeave.status === 200 && supLeave.body.status === 'Approved', 'Supervisor approves leave');

    console.log('\n>>> 9. Rest day and public-holiday daily status engine');
    const statusUser = await createUser(adminToken, {
      username: 'worker-status', name: 'Status Worker', password: 'WorkerPass123!', role: 'Worker', project_ids: [projectA]
    });
    const statusWorker = await req({
      path: '/api/workers', method: 'POST', token: adminToken,
      body: { project_id: projectA, site_id: siteA, user_id: statusUser.body.id, name: 'Status Worker', employee_id: 'A-STATUS', trade: 'Fire' }
    });
    await req({
      path: '/api/worker_assignments', method: 'POST', token: adminToken,
      body: { worker_id: statusWorker.body.id, project_id: projectA, site_id: siteA, supervisor_id: supRes.body.id, start_date: '2020-01-01' }
    });

    const localToday = isoDateInTz('Europe/Malta');
    const todayWeekday = new Date(localToday + 'T12:00:00Z').getUTCDay();
    const otherDay = (todayWeekday + 1) % 7;
    const restShift = await req({
      path: '/api/shift_templates', method: 'POST', token: adminToken,
      body: {
        project_id: projectA, name: 'Rest-Day Test Shift', start_time: '07:00', end_time: '16:00',
        working_days_json: JSON.stringify([otherDay]), break_minutes: 60, regular_hours: 8, ot_threshold_hours: 8
      }
    });
    await req({
      path: '/api/worker_schedules', method: 'POST', token: adminToken,
      body: { worker_id: statusWorker.body.id, shift_template_id: restShift.body.id, effective_from: '2020-01-01' }
    });
    const restDashboard = await req({ path: `/api/workforce/today?project_id=${projectA}&site_id=${siteA}`, token: adminToken });
    const restRow = restDashboard.body.workers.find((w: any) => w.worker_id === statusWorker.body.id);
    assert(restRow?.status === 'Rest Day', 'Status engine classifies unscheduled weekday as Rest Day', restRow);

    const todayHoliday = await req({
      path: '/api/public_holidays', method: 'POST', token: adminToken,
      body: { project_id: projectA, site_id: siteA, country_code: 'MT', holiday_date: localToday, name: 'Today Test Holiday', paid: true }
    });
    assert(todayHoliday.status === 201, 'Current local date public holiday created');
    const holidayDashboard = await req({ path: `/api/workforce/today?project_id=${projectA}&site_id=${siteA}`, token: adminToken });
    const holidayRow = holidayDashboard.body.workers.find((w: any) => w.worker_id === statusWorker.body.id);
    assert(holidayRow?.status === 'Public Holiday', 'Public Holiday takes precedence over Rest Day in daily status engine', holidayRow);

    console.log('\n>>> 10. Cross-midnight shift maps punch to shift start date');
    const nightZone = pickEarlyMorningTimezone();
    const nightSiteRes = await req({
      path: '/api/sites', method: 'POST', token: adminToken,
      body: {
        project_id: projectA, name: 'Night Shift Site', latitude: 35.8500, longitude: 14.4700,
        geofence_radius_m: 150, geofence_warning_radius_m: 220, timezone: nightZone
      }
    });
    const nightUser = await createUser(adminToken, {
      username: 'worker-night', name: 'Night Worker', password: 'WorkerPass123!', role: 'Worker', project_ids: [projectA]
    });
    const nightWorker = await req({
      path: '/api/workers', method: 'POST', token: adminToken,
      body: { project_id: projectA, site_id: nightSiteRes.body.id, user_id: nightUser.body.id, name: 'Night Worker', employee_id: 'N-001', trade: 'BMS' }
    });
    await req({
      path: '/api/worker_assignments', method: 'POST', token: adminToken,
      body: { worker_id: nightWorker.body.id, project_id: projectA, site_id: nightSiteRes.body.id, supervisor_id: supRes.body.id, start_date: '2020-01-01' }
    });
    const nightShift = await req({
      path: '/api/shift_templates', method: 'POST', token: adminToken,
      body: {
        project_id: projectA, name: 'Night Shift', start_time: '19:00', end_time: '04:00',
        working_days_json: '[0,1,2,3,4,5,6]', break_minutes: 0, regular_hours: 8, ot_threshold_hours: 8
      }
    });
    await req({
      path: '/api/worker_schedules', method: 'POST', token: adminToken,
      body: { worker_id: nightWorker.body.id, shift_template_id: nightShift.body.id, effective_from: '2020-01-01' }
    });
    const nightToken = (await login('worker-night','WorkerPass123!')).body.token;
    const localNightDate = isoDateInTz(nightZone);
    const nightPunch = await req({
      path: '/api/attendance/gps-punch-in', method: 'POST', token: nightToken,
      body: { project_id: projectA, site_id: nightSiteRes.body.id, lat: 35.8500, lng: 14.4700, accuracy: 10 }
    });
    assert(nightPunch.status === 201, 'Night worker punch-in succeeds');
    const expectedNightDate = hourInTz(nightZone) < 4 ? addDays(localNightDate, -1) : localNightDate;
    assert(nightPunch.body.work_date === expectedNightDate, `Cross-midnight work date maps to shift start date in ${nightZone}`, nightPunch.body);
    await req({ path: '/api/attendance/gps-punch-out', method: 'POST', token: nightToken, body: { lat: 35.8500, lng: 14.4700, accuracy: 10 } });

    console.log('\n>>> 11. Locked payroll remains immutable to recomputation');
    const lock = await req({ path: `/api/payroll_periods/${period.body.id}/lock`, method: 'POST', token: adminToken, body: {} });
    assert(lock.status === 200 && lock.body.status === 'Locked', 'Admin locks payroll period');
    const lockedCompute = await req({ path: `/api/payroll_periods/${period.body.id}/compute`, method: 'POST', token: adminToken, body: {} });
    assert(lockedCompute.status === 400, 'Locked payroll cannot be recomputed');

    console.log('\n>>> 12. Live workforce and daily report endpoints');
    const live = await req({ path: `/api/workforce/today?project_id=${projectA}`, token: adminToken });
    assert(live.status === 200 && Array.isArray(live.body.workers), 'Live workforce returns assignment-driven worker states');
    assert(typeof live.body.expected_count === 'number' && typeof live.body.absent_count === 'number', 'Live workforce exposes expected/absent counts');

    const daily = await req({ path: `/api/reports/workforce/daily?project_id=${projectA}`, token: adminToken });
    assert(daily.status === 200 && daily.body.summary !== undefined, 'Daily workforce report still works after minute migration');

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
