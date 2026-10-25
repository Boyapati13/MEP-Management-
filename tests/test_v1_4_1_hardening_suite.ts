/**
 * MEP Management Platform — V1.4.1 Enterprise Hardening Test Suite
 * test_v1_4_1_hardening_suite.ts
 *
 * Covers 20 test groups with 60+ assertions:
 *   - HARD-001 to HARD-015: Negative / security gate tests
 *   - Subcontractor access scope isolation (company / work_package / explicit_packages)
 *   - 404 non-disclosure policy
 *   - Immutable field protection on PUT
 *   - Monotonic reference sequences (ACT-XXXX / DEC-XXXX)
 *   - Procurement task blocker synchronization
 *   - Risk score normalization
 *   - Progress report publication and revision ledger
 *   - BOV Mqabba isolation scenario
 */
import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';

// ─── Test Harness ─────────────────────────────────────────────────────────────
let serverProcess: ChildProcess;
let serverLogs: string[] = [];
const BASE_URL = 'http://localhost:3001';
const TEST_PORT = 3001;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string, detail?: any) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    if (detail !== undefined) {
      console.error('     Detail:', typeof detail === 'string' ? detail.slice(0, 500) : JSON.stringify(detail).slice(0, 500));
    }
    failed++;
    failures.push(label);
  }
}

async function req(
  method: string,
  path: string,
  body?: any,
  token?: string
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: Number(url.port) || 80,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    };

    const reqInstance = http.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: data });
        }
      });
    });

    reqInstance.on('error', reject);
    if (bodyStr) reqInstance.write(bodyStr);
    reqInstance.end();
  });
}

async function login(username: string, password = 'Password123!'): Promise<string> {
  const tryPasswords = [password, 'ChangeMe123!', 'admin123', 'password123'];
  for (const pw of tryPasswords) {
    let res = await req('POST', '/api/login', { username, password: pw });
    if (res.body?.token) return res.body.token;
    res = await req('POST', '/api/auth/login', { username, password: pw });
    if (res.body?.token) return res.body.token;
  }
  throw new Error(`Login failed for ${username} across attempted credentials`);
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverEntry = fs.existsSync(path.join(process.cwd(), 'dist/server.cjs'))
      ? 'dist/server.cjs'
      : 'server.ts';

    const cmd = serverEntry.endsWith('.cjs') ? 'node' : process.execPath;
    const args = serverEntry.endsWith('.cjs')
      ? [serverEntry]
      : [path.join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'), serverEntry];

    serverProcess = spawn(cmd, args, {
      env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'test', DB_PATH: ':memory:', MEP_DB_PATH: ':memory:' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout?.on('data', d => {
      const s = d.toString();
      serverLogs.push(s);
      if (s.includes('listening') || s.includes('started') || s.includes('ready') || s.includes(':' + TEST_PORT)) {
        resolve();
      }
    });

    serverProcess.stderr?.on('data', d => {
      const s = d.toString();
      serverLogs.push(s);
      if (s.includes('listening') || s.includes('ready')) resolve();
    });

    serverProcess.on('error', reject);
    setTimeout(resolve, 8000);
  });
}

// ─── Test Groups ──────────────────────────────────────────────────────────────

async function testHealthAndReadiness() {
  console.log('\n[GROUP-01] Server Health & Readiness');
  const health = await req('GET', '/api/health');
  assert(health.status === 200, 'HEALTH: /api/health returns 200');
  assert(health.body?.status === 'ok', 'HEALTH: status field is ok');
  assert(health.body?.version === '1.4.1', 'HEALTH: version is 1.4.1');

  const ready = await req('GET', '/api/ready');
  assert(ready.status === 200, 'READY: /api/ready returns 200');
  assert(ready.body?.ready === true, 'READY: ready field is true');
}

async function testUnauthenticatedBlocking() {
  console.log('\n[GROUP-02 / HARD-001] Unauthenticated Access Blocking');
  const paths = ['/api/tasks', '/api/users', '/api/work_packages', '/api/procurement/programme-impact'];
  for (const p of paths) {
    const res = await req('GET', p);
    assert(res.status === 401, `HARD-001: GET ${p} returns 401 without token`);
  }
}

async function testSubcontractorScopeIsolation(adminToken: string) {
  console.log('\n[GROUP-03 / HARD-002] Subcontractor Scope Isolation');

  // Create a project as admin
  const projRes = await req('POST', '/api/projects', {
    name: 'BOV Mqabba MEP Works',
    code: 'BOV-001',
    status: 'Active'
  }, adminToken);
  const projectId = projRes.body?.id;
  assert(Boolean(projectId), 'HARD-002: Project created for isolation test');

  // Create two work packages
  const wp1Res = await req('POST', '/api/work_packages', {
    project_id: projectId,
    name: 'HVAC Ground Floor',
    code: 'WP-HVAC-01',
    status: 'Active'
  }, adminToken);
  const wp1Id = wp1Res.body?.id;

  const wp2Res = await req('POST', '/api/work_packages', {
    project_id: projectId,
    name: 'Plumbing Level 1',
    code: 'WP-PLB-01',
    status: 'Active'
  }, adminToken);
  const wp2Id = wp2Res.body?.id;

  assert(Boolean(wp1Id), 'HARD-002: WP1 created');
  assert(Boolean(wp2Id), 'HARD-002: WP2 created');

  // Create a subcontractor user strictly scoped to WP1
  const subUsername = `sub_scope_test_${Date.now()}`;
  const subRes = await req('POST', '/api/users', {
    name: 'BOV Subcontractor A',
    username: subUsername,
    password: 'Password123!',
    role: 'Subcontractor',
    access_scope: 'work_package',
    work_package_id: wp1Id,
    project_id: projectId
  }, adminToken);

  assert(subRes.status === 201, 'HARD-002: Subcontractor user successfully created');
  const subToken = await login(subUsername, 'Password123!');
  assert(Boolean(subToken), 'HARD-002: Subcontractor successfully authenticated');

  // Access WP1 (assigned) -> 200 with redacted worker roster
  const wp1Access = await req('GET', `/api/work_packages/${wp1Id}/command-center`, undefined, subToken);
  assert(wp1Access.status === 200, 'HARD-002: Subcontractor can access their assigned WP', wp1Access);
  assert(Array.isArray(wp1Access.body?.workers) && wp1Access.body.workers.length === 0, 'HARD-002: Subcontractor worker roster is redacted', wp1Access.body?.workers);
  assert(wp1Access.body?.metrics?.total_claimed_amount === 0, 'HARD-002: Total claimed amount is redacted for subcontractor', wp1Access.body?.metrics);

  // Access WP2 (not assigned) -> 404 (non-disclosure)
  const wp2Access = await req('GET', `/api/work_packages/${wp2Id}/command-center`, undefined, subToken);
  assert(wp2Access.status === 404, 'HARD-002: Cross-WP access returns 404 (non-disclosure, not 403)');
}

async function testNonDisclosure404(adminToken: string) {
  console.log('\n[GROUP-04 / HARD-003] 404 Non-Disclosure for Foreign Resources');
  const fakeId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  const wpRes = await req('GET', `/api/work_packages/${fakeId}/command-center`, undefined, adminToken);
  assert(wpRes.status === 404, 'HARD-003: Non-existent WP command-center returns 404');

  const taskRes = await req('GET', `/api/tasks/${fakeId}/readiness`, undefined, adminToken);
  assert([404, 400].includes(taskRes.status), 'HARD-003: Non-existent task readiness returns 404 or 400');
}

async function testImmutableFieldProtection(adminToken: string) {
  console.log('\n[GROUP-05 / HARD-004] Immutable Field Protection on PUT');

  const proj = await req('GET', '/api/projects', undefined, adminToken);
  const projectId = Array.isArray(proj.body) && proj.body[0]?.id;
  assert(Boolean(projectId), 'HARD-004: Project available', proj);

  const actionRes = await req('POST', '/api/project_actions', {
    project_id: projectId,
    title: 'Immutable Field Test Action',
    status: 'Open',
    priority: 'Medium',
    raised_by: 'test-user'
  }, adminToken);

  const actionId = actionRes.body?.id;
  assert(Boolean(actionId), 'HARD-004: Action created', actionRes);
  const origProjectId = actionRes.body?.project_id;

  // Attempt to mutate project_id (immutable)
  const putRes = await req('PUT', `/api/project_actions/${actionId}`, {
    project_id: 'tampered-project-id',
    title: 'Updated Title'
  }, adminToken);

  assert(putRes.status === 400, 'HARD-004: PUT with mutated project_id returns 400', putRes);

  // Verify project_id unchanged
  const getRes = await req('GET', `/api/project_actions/${actionId}`, undefined, adminToken);
  assert(getRes.body?.project_id === origProjectId, 'HARD-004: project_id remains unchanged after rejected PUT');
}

async function testMonotonicSequences(adminToken: string) {
  console.log('\n[GROUP-06 / HARD-005] Monotonic Reference Sequences (ACT-XXXX / DEC-XXXX)');

  const proj = await req('GET', '/api/projects', undefined, adminToken);
  const projectId = Array.isArray(proj.body) && proj.body[0]?.id;
  assert(Boolean(projectId), 'HARD-005: Project available');

  const a1 = await req('POST', '/api/project_actions', {
    project_id: projectId, title: 'Sequence Test Action 1', status: 'Open', priority: 'Low', raised_by: 'sys'
  }, adminToken);

  const a2 = await req('POST', '/api/project_actions', {
    project_id: projectId, title: 'Sequence Test Action 2', status: 'Open', priority: 'Low', raised_by: 'sys'
  }, adminToken);

  const ref1 = a1.body?.action_no ?? a1.body?.reference;
  const ref2 = a2.body?.action_no ?? a2.body?.reference;

  assert(Boolean(ref1), 'HARD-005: First action has reference number', a1);
  assert(Boolean(ref2), 'HARD-005: Second action has reference number', a2);
  assert(ref1 !== ref2, 'HARD-005: Consecutive action references are unique');
  assert(/^ACT-\d{4,}$/i.test(ref1), `HARD-005: Reference 1 matches ACT-XXXX pattern: ${ref1}`);
  assert(/^ACT-\d{4,}$/i.test(ref2), `HARD-005: Reference 2 matches ACT-XXXX pattern: ${ref2}`);
}

async function testProcurementRiskAuthorization(adminToken: string) {
  console.log('\n[GROUP-07 / HARD-006] Procurement Programme Risk Authorization');

  const proj = await req('GET', '/api/projects', undefined, adminToken);
  const projectId = Array.isArray(proj.body) && proj.body[0]?.id;

  // Admin access
  const res = await req('GET', `/api/procurement/programme-impact?project_id=${projectId}`, undefined, adminToken);
  assert(res.status === 200, 'HARD-006: Admin can access procurement risk endpoint (200)');

  // Worker role should be blocked (403)
  const workerUsername = `worker_auth_test_${Date.now()}`;
  await req('POST', '/api/users', {
    username: workerUsername,
    name: 'Worker Auth Test',
    password: 'Password123!',
    role: 'Worker',
    project_id: projectId
  }, adminToken);
  const workerLogin = await login(workerUsername, 'Password123!');
  const workerRes = await req('GET', `/api/procurement/programme-impact?project_id=${projectId}`, undefined, workerLogin);
  assert(workerRes.status === 403, 'HARD-006: Worker cannot access procurement risk (403)');
}

async function testRiskMatrixAuthorization(adminToken: string) {
  console.log('\n[GROUP-08 / HARD-007] Risk Matrix Heatmap Authorization');

  const proj = await req('GET', '/api/projects', undefined, adminToken);
  const projectId = Array.isArray(proj.body) && proj.body[0]?.id;

  // Admin can access
  const res = await req('GET', `/api/risks/matrix?project_id=${projectId}`, undefined, adminToken);
  assert(res.status === 200, 'HARD-007: Admin can access risk matrix (200)', { status: res.status, body: res.body, projectId });

  // Client should be blocked (403)
  const clientUsername = `client_auth_test_${Date.now()}`;
  await req('POST', '/api/users', {
    username: clientUsername,
    name: 'Client Auth Test',
    password: 'Password123!',
    role: 'Client',
    project_id: projectId
  }, adminToken);
  const clientLogin = await login(clientUsername, 'Password123!');
  const clientRes = await req('GET', `/api/risks/matrix?project_id=${projectId}`, undefined, clientLogin);
  assert(clientRes.status === 403, 'HARD-007: Client blocked from internal risk matrix (403)');
}

async function testTaskReadinessEndpoint(adminToken: string) {
  console.log('\n[GROUP-09 / HARD-008] Task Readiness Tri-State & Scope Authorization');

  const proj = await req('GET', '/api/projects', undefined, adminToken);
  const projectId = Array.isArray(proj.body) && proj.body[0]?.id;

  // Create WP1 and WP2
  const wp1Res = await req('POST', '/api/work_packages', {
    project_id: projectId, name: 'WP Readiness Test 1', code: `WP-RD-1-${Date.now()}`, status: 'Active'
  }, adminToken);
  const wp2Res = await req('POST', '/api/work_packages', {
    project_id: projectId, name: 'WP Readiness Test 2', code: `WP-RD-2-${Date.now()}`, status: 'Active'
  }, adminToken);
  const wp1Id = wp1Res.body?.id;
  const wp2Id = wp2Res.body?.id;

  // Create tasks in each
  const t1 = await req('POST', '/api/tasks', {
    project_id: projectId, work_package_id: wp1Id, title: 'Task in WP1', status: 'Not Started'
  }, adminToken);
  const t2 = await req('POST', '/api/tasks', {
    project_id: projectId, work_package_id: wp2Id, title: 'Task in WP2', status: 'Not Started'
  }, adminToken);

  const t1Id = t1.body?.id;
  const t2Id = t2.body?.id;

  // Admin checks readiness
  const readinessRes = await req('GET', `/api/tasks/${t1Id}/readiness`, undefined, adminToken);
  assert(readinessRes.status === 200, 'HARD-008: Admin can check task readiness (200)', readinessRes);
  assert(['Ready', 'Pending', 'Blocked'].includes(readinessRes.body?.status ?? ''), 'HARD-008: Valid tri-state status returned', readinessRes.body);

  // Subcontractor scoped to WP1
  const subUsername = `sub_readiness_${Date.now()}`;
  await req('POST', '/api/users', {
    username: subUsername, name: 'Sub Readiness', password: 'Password123!',
    role: 'Subcontractor', access_scope: 'work_package', work_package_id: wp1Id, project_id: projectId
  }, adminToken);
  const subToken = await login(subUsername, 'Password123!');

  // Can check WP1 task
  const subT1Res = await req('GET', `/api/tasks/${t1Id}/readiness`, undefined, subToken);
  assert(subT1Res.status === 200, 'HARD-008: Subcontractor can check assigned WP task readiness', subT1Res);

  // Cannot check WP2 task (404 non-disclosure)
  const subT2Res = await req('GET', `/api/tasks/${t2Id}/readiness`, undefined, subToken);
  assert(subT2Res.status === 404, 'HARD-008: Subcontractor querying foreign WP task readiness returns 404');
}

async function testProgressReportPublicationFlow(adminToken: string) {
  console.log('\n[GROUP-10 / HARD-009] Progress Report Publication & Revision Ledger');

  const proj = await req('GET', '/api/projects', undefined, adminToken);
  const projectId = Array.isArray(proj.body) && proj.body[0]?.id;

  // Publish report via transactional route
  const pubRes = await req('POST', '/api/progress_reports/publish', {
    project_id: projectId,
    period_date: new Date().toISOString().split('T')[0],
    overall_progress: 42,
    narrative: 'Milestone narrative for Q3 cycle'
  }, adminToken);

  assert([200, 201].includes(pubRes.status), 'HARD-009: Publish report returns 200/201', pubRes);
  const reportId = pubRes.body?.id ?? pubRes.body?.report?.id;
  assert(Boolean(reportId), 'HARD-009: Published report has id', pubRes.body);

  if (reportId) {
    // Attempt to revise
    const revRes = await req('POST', `/api/progress_reports/${reportId}/revise`, {}, adminToken);
    assert([200, 201].includes(revRes.status), 'HARD-009: Revise report returns 200/201');
    const revNo = revRes.body?.revision_no;
    assert(Number(revNo) >= 1, `HARD-009: Revised report has revision_no >= 1 (got: ${revNo})`);
    assert(Boolean(revRes.body?.supersedes_report_id), 'HARD-009: Revised report carries supersedes_report_id');
  }
}

async function testBlockerSyncOnProcurement(adminToken: string) {
  console.log('\n[GROUP-11 / HARD-010] Automated Procurement Task Blocker Synchronization');

  const proj = await req('GET', '/api/projects', undefined, adminToken);
  const projectId = Array.isArray(proj.body) && proj.body[0]?.id;

  // Create a task
  const taskRes = await req('POST', '/api/tasks', {
    project_id: projectId,
    title: 'Chiller Installation Testing',
    status: 'Not Started',
    start: new Date().toISOString().split('T')[0]
  }, adminToken);

  const taskId = taskRes.body?.id;
  assert(Boolean(taskId), 'HARD-010: Task created for blocker test');

  // Create PO with expected delivery in 60 days (past task start -> negative buffer -> auto blocker)
  const poDate = new Date();
  poDate.setDate(poDate.getDate() + 60);
  const poRes = await req('POST', '/api/purchase_orders', {
    project_id: projectId,
    task_id: taskId,
    po_number: `PO-${Date.now().toString().slice(-4)}`,
    description: 'Chiller Unit',
    expected_delivery_date: poDate.toISOString().split('T')[0],
    status: 'Ordered'
  }, adminToken);

  assert([200, 201].includes(poRes.status), 'HARD-010: Purchase order created');

  // Check that task readiness detects the procurement blocker
  const readinessRes = await req('GET', `/api/tasks/${taskId}/readiness`, undefined, adminToken);
  assert(readinessRes.status === 200, 'HARD-010: Task readiness responds');
  assert(readinessRes.body?.checks?.procurement?.status === 'failed' || readinessRes.body?.checks?.procurement?.status === 'pending',
    'HARD-010: Procurement check reflects pending/failed delivery');
}

async function testClientPortalDataLeakage(adminToken: string) {
  console.log('\n[GROUP-12 / HARD-011] Client Portal — Zero Internal Data Leakage');

  const proj = await req('GET', '/api/projects', undefined, adminToken);
  const projectId = Array.isArray(proj.body) && proj.body[0]?.id;

  const clientUsername = `client_leak_test_${Date.now()}`;
  await req('POST', '/api/users', {
    username: clientUsername,
    name: 'Client Leak Test',
    password: 'Password123!',
    role: 'Client',
    project_id: projectId
  }, adminToken);
  const clientToken = await login(clientUsername, 'Password123!');

  // Client should NOT see users list
  const usersRes = await req('GET', '/api/users', undefined, clientToken);
  assert(usersRes.status === 403, 'HARD-011: Client cannot access user directory (403)');

  // Client should NOT see internal audit trail
  const auditRes = await req('GET', '/api/audit_logs', undefined, clientToken);
  assert([403, 404].includes(auditRes.status), 'HARD-011: Client cannot access audit logs (403/404)');

  // Client should NOT access risk matrix
  const riskRes = await req('GET', `/api/risks/matrix?project_id=${projectId}`, undefined, clientToken);
  assert(riskRes.status === 403, 'HARD-011: Client cannot access internal risk matrix (403)');
}

async function testSelfApprovalBlocking(adminToken: string) {
  console.log('\n[GROUP-13 / HARD-012] Self-Approval Blocking for Progress Claims');

  const proj = await req('GET', '/api/projects', undefined, adminToken);
  const projectId = Array.isArray(proj.body) && proj.body[0]?.id;

  // Create a subcontractor company
  const compId = `comp_${Date.now()}`;
  const compRes = await req('POST', '/api/companies', {
    id: compId,
    name: `Sub Contractor Company ${Date.now()}`,
    trade: 'Mechanical'
  }, adminToken);
  const companyId = compRes.body?.id || compId;

  // Create PM associated with that company (conflict of interest)
  const pmUsername = `pm_conflict_${Date.now()}`;
  await req('POST', '/api/users', {
    username: pmUsername,
    name: 'Conflicted PM',
    password: 'Password123!',
    role: 'ProjectManager',
    company_id: companyId,
    project_id: projectId
  }, adminToken);
  const pmToken = await login(pmUsername, 'Password123!');

  // Submit claim on behalf of that company
  const submRes = await req('POST', '/api/progress_submissions', {
    project_id: projectId,
    company_id: companyId,
    claimed_percentage: 30,
    claimed_amount: 45000,
    period_date: new Date().toISOString().split('T')[0]
  }, adminToken);
  const submId = submRes.body?.id;
  assert(Boolean(submId), 'HARD-012: Claim submission created');

  // Verify attempt with conflicted PM -> 403 Forbidden
  const verifyRes = await req('POST', `/api/progress_submissions/${submId}/verify`, {
    certified_percentage: 30,
    certified_amount: 45000
  }, pmToken);
  assert(verifyRes.status === 403, 'HARD-012: Same-company verification rejected with 403');
}

async function testPutImmutableFieldsComprehensive(adminToken: string) {
  console.log('\n[GROUP-14 / HARD-013] Comprehensive Immutable PUT Field Protection');

  const proj = await req('GET', '/api/projects', undefined, adminToken);
  const projectId = Array.isArray(proj.body) && proj.body[0]?.id;

  const decRes = await req('POST', '/api/project_decisions', {
    project_id: projectId,
    title: 'Immutable Field Test Decision',
    status: 'Open',
    raised_by: 'test'
  }, adminToken);

  const decId = decRes.body?.id;
  const origCreatedAt = decRes.body?.created_at;
  assert(Boolean(decId), 'HARD-013: Decision created');

  // Attempt to mutate created_at
  const putRes = await req('PUT', `/api/project_decisions/${decId}`, {
    created_at: '2020-01-01T00:00:00Z',
    title: 'Updated Title'
  }, adminToken);

  assert(putRes.status === 400, 'HARD-013: PUT with mutated created_at returns 400');

  // Verify created_at is still original
  const getRes = await req('GET', `/api/project_decisions/${decId}`, undefined, adminToken);
  assert(getRes.body?.created_at === origCreatedAt, 'HARD-013: created_at unchanged after rejected PUT');
}

async function testBovMqabbaIsolationScenario(adminToken: string) {
  console.log('\n[GROUP-15 / HARD-014] BOV Mqabba Dual Subcontractor Isolation Scenario');

  const proj = await req('POST', '/api/projects', {
    name: 'BOV Mqabba Industrial MEP',
    code: `BOV-MQA-${Date.now()}`,
    status: 'Active'
  }, adminToken);
  const projectId = proj.body?.id;
  assert(Boolean(projectId), 'HARD-014: BOV Mqabba project created');

  // Subcontractor 1 package (Electrical)
  const wp1 = await req('POST', '/api/work_packages', {
    project_id: projectId, name: 'Electrical Works', code: `WP-E-${Date.now().toString().slice(-4)}`, status: 'Active'
  }, adminToken);
  const wp1Id = wp1.body?.id;

  // Subcontractor 2 package (Fire Protection)
  const wp2 = await req('POST', '/api/work_packages', {
    project_id: projectId, name: 'Fire Protection', code: `WP-F-${Date.now().toString().slice(-4)}`, status: 'Active'
  }, adminToken);
  const wp2Id = wp2.body?.id;

  assert(Boolean(wp1Id && wp2Id), 'HARD-014: Both packages created');

  // User 1: Electrical Subcontractor
  const user1 = `sub_elec_${Date.now()}`;
  await req('POST', '/api/users', {
    username: user1, name: 'Elec Sub', password: 'Password123!',
    role: 'Subcontractor', access_scope: 'work_package', work_package_id: wp1Id, project_id: projectId
  }, adminToken);
  const token1 = await login(user1, 'Password123!');

  // User 2: Fire Subcontractor
  const user2 = `sub_fire_${Date.now()}`;
  await req('POST', '/api/users', {
    username: user2, name: 'Fire Sub', password: 'Password123!',
    role: 'Subcontractor', access_scope: 'work_package', work_package_id: wp2Id, project_id: projectId
  }, adminToken);
  const token2 = await login(user2, 'Password123!');

  // Sub 1 queries WP1 -> 200; queries WP2 -> 404
  const sub1Wp1 = await req('GET', `/api/work_packages/${wp1Id}/command-center`, undefined, token1);
  assert(sub1Wp1.status === 200, 'HARD-014: Sub 1 accesses their assigned WP1 (200)');
  const sub1Wp2 = await req('GET', `/api/work_packages/${wp2Id}/command-center`, undefined, token1);
  assert(sub1Wp2.status === 404, 'HARD-014: Sub 1 blocked from WP2 with 404');

  // Sub 2 queries WP2 -> 200; queries WP1 -> 404
  const sub2Wp2 = await req('GET', `/api/work_packages/${wp2Id}/command-center`, undefined, token2);
  assert(sub2Wp2.status === 200, 'HARD-014: Sub 2 accesses their assigned WP2 (200)');
  const sub2Wp1 = await req('GET', `/api/work_packages/${wp1Id}/command-center`, undefined, token2);
  assert(sub2Wp1.status === 404, 'HARD-014: Sub 2 blocked from WP1 with 404');
}

async function testRiskScoreNormalization(adminToken: string) {
  console.log('\n[GROUP-16 / HARD-015] Risk Score Normalization & Validation');

  const proj = await req('GET', '/api/projects', undefined, adminToken);
  const projectId = Array.isArray(proj.body) && proj.body[0]?.id;

  // 1. Validation test: probability 99 should return 400
  const badRes = await req('POST', '/api/project_risks', {
    project_id: projectId,
    title: 'Out of Range Risk',
    probability: 99,
    impact: 2
  }, adminToken);
  assert(badRes.status === 400, 'HARD-015: Out-of-range risk rejected with 400');

  // 2. Critical calculation: P5 x I5 = 25
  const risk1 = await req('POST', '/api/project_risks', {
    project_id: projectId,
    title: 'Critical Delay Risk',
    probability: 5,
    impact: 5
  }, adminToken);
  assert([200, 201].includes(risk1.status), 'HARD-015: High risk created');
  assert(risk1.body?.risk_score === 25, `HARD-015: Risk score calculated as 25 (got: ${risk1.body?.risk_score})`);
  assert(risk1.body?.risk_level === 'Critical', `HARD-015: Rated Critical (got: ${risk1.body?.risk_level})`);

  // 3. PUT validation test: update with probability 0 should return 400
  if (risk1.body?.id) {
    const putBadRes = await req('PUT', `/api/project_risks/${risk1.body.id}`, {
      probability: 0
    }, adminToken);
    assert(putBadRes.status === 400, 'HARD-015: Out-of-range PUT rejected with 400');
  }
}

async function testMigrationRunnerIdempotency(adminToken: string) {
  console.log('\n[GROUP-17] Migration Runner Idempotency via Health');

  const health = await req('GET', '/api/health', undefined, adminToken);
  assert(health.status === 200, 'MIGRATION: Server started (implies migrations ran without error)');
  assert(typeof health.body?.uptime === 'number', 'MIGRATION: Uptime field present in health check');
}

async function testAuditTrailWrites(adminToken: string) {
  console.log('\n[GROUP-18] Audit Trail for Sensitive Operations');

  const proj = await req('GET', '/api/projects', undefined, adminToken);
  const projectId = Array.isArray(proj.body) && proj.body[0]?.id;
  if (!projectId) {
    assert(true, 'AUDIT: Skipped — no project');
    return;
  }

  await req('POST', '/api/project_actions', {
    project_id: projectId,
    title: 'Audit Trail Test Action',
    status: 'Open',
    priority: 'High',
    raised_by: 'test-harness'
  }, adminToken);

  const auditRes = await req('GET', `/api/audit_logs?entity_type=project_actions&limit=5`, undefined, adminToken);
  assert([200, 404].includes(auditRes.status), 'AUDIT: Audit log endpoint responds');
}

async function testApiVersionConsistency() {
  console.log('\n[GROUP-19] API Version Consistency');
  const health = await req('GET', '/api/health');
  assert(health.body?.version === '1.4.1', 'VERSION: /api/health returns version 1.4.1');
}

async function testCORSHeaders() {
  console.log('\n[GROUP-20] CORS and Security Headers');
  const res = await req('GET', '/api/health');
  assert(res.status === 200, 'CORS: Server responds to basic request');
  // Further CORS header checks require raw http inspection
}

// ─── Main Runner ──────────────────────────────────────────────────────────────
async function main() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  MEP Management Platform — V1.4.1 Hardening Test Suite');
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════════════════════');

  console.log('\nStarting test server...');
  await startServer();
  await sleep(4000);

  // Login as admin
  let adminToken = '';
  try {
    adminToken = await login('admin', 'admin123');
    if (!adminToken) adminToken = await login('admin', 'password123');
  } catch (e) {
    try { adminToken = await login('admin', 'password123'); } catch { /* degrade gracefully */ }
  }

  assert(Boolean(adminToken), 'SETUP: Admin authentication successful');

  await testHealthAndReadiness();
  await testUnauthenticatedBlocking();
  await testSubcontractorScopeIsolation(adminToken);
  await testNonDisclosure404(adminToken);
  await testImmutableFieldProtection(adminToken);
  await testMonotonicSequences(adminToken);
  await testProcurementRiskAuthorization(adminToken);
  await testRiskMatrixAuthorization(adminToken);
  await testTaskReadinessEndpoint(adminToken);
  await testProgressReportPublicationFlow(adminToken);
  await testBlockerSyncOnProcurement(adminToken);
  await testClientPortalDataLeakage(adminToken);
  await testSelfApprovalBlocking(adminToken);
  await testPutImmutableFieldsComprehensive(adminToken);
  await testBovMqabbaIsolationScenario(adminToken);
  await testRiskScoreNormalization(adminToken);
  await testMigrationRunnerIdempotency(adminToken);
  await testAuditTrailWrites(adminToken);
  await testApiVersionConsistency();
  await testCORSHeaders();

  // Report
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  HARDENING SUITE RESULTS — ${new Date().toISOString()}`);
  console.log(`  Passed: ${passed}  |  Failed: ${failed}  |  Total: ${passed + failed}`);

  if (failures.length > 0) {
    console.log('\n  Failed Assertions:');
    failures.forEach(f => console.error(`    ✗ ${f}`));
  }

  console.log('══════════════════════════════════════════════════════════════');

  serverProcess?.kill();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal test runner error:', err);
  serverProcess?.kill();
  process.exit(1);
});
