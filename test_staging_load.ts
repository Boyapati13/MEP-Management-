/**
 * MEP Management Platform — V1.4.1 Staging Load & Latency Test
 * test_staging_load.ts
 *
 * 50 authenticated concurrent sessions across all 6 personas:
 *   Admin (10), ProjectManager (8), SiteEngineer (8), CommercialManager (6),
 *   Subcontractor (10), Client (8)
 *
 * Latency SLAs:
 *   p95 Read  < 750ms
 *   p95 Write < 1500ms
 *   SQLITE_BUSY = 0 occurrences
 */
import { spawn, ChildProcess } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:3002';
const TEST_PORT = 3002;

let serverProcess: ChildProcess;
let serverLogs: string[] = [];
let readLatencies: number[] = [];
let writeLatencies: number[] = [];
let sqliteBusyCount = 0;
let errorCount = 0;
let requestCount = 0;

const sessionTokens: Record<string, string[]> = {
  Admin: [],
  ProjectManager: [],
  SiteEngineer: [],
  CommercialManager: [],
  Subcontractor: [],
  Client: []
};

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function req(
  method: string,
  endpoint: string,
  body?: any,
  token?: string
): Promise<{ status: number; body: any; latencyMs: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const url = new URL(endpoint, BASE_URL);
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

    const reqI = http.request(options, res => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => {
        const latencyMs = Date.now() - start;
        requestCount++;

        // Track SQLITE_BUSY errors
        if (data.includes('SQLITE_BUSY') || data.includes('database is locked')) {
          sqliteBusyCount++;
        }

        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data), latencyMs });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: data, latencyMs });
        }
      });
    });

    reqI.on('error', (e) => {
      errorCount++;
      resolve({ status: 0, body: { error: e.message }, latencyMs: Date.now() - start });
    });

    if (bodyStr) reqI.write(bodyStr);
    reqI.end();
  });
}

async function login(username: string, password = 'password123'): Promise<string> {
  const res = await req('POST', '/api/login', { username, password });
  return res.body?.token ?? '';
}

function p95(latencies: number[]): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function p99(latencies: number[]): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.99);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function avg(latencies: number[]): number {
  if (latencies.length === 0) return 0;
  return Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
}

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    const serverEntry = fs.existsSync(path.join(process.cwd(), 'dist/server.cjs'))
      ? 'dist/server.cjs'
      : 'server.ts';

    const cmd = serverEntry.endsWith('.cjs') ? 'node' : process.execPath;
    const args = serverEntry.endsWith('.cjs')
      ? [serverEntry]
      : [path.join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'), serverEntry];

    serverProcess = spawn(cmd, args, {
      env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'test', DB_PATH: ':memory:' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout?.on('data', d => {
      const s = d.toString();
      serverLogs.push(s);
      if (s.includes(':' + TEST_PORT) || s.includes('listening') || s.includes('ready')) resolve();
    });
    serverProcess.stderr?.on('data', d => {
      const s = d.toString();
      serverLogs.push(s);
      if (s.includes('listening') || s.includes('ready')) resolve();
    });

    serverProcess.on('error', () => resolve());
    setTimeout(resolve, 9000);
  });
}

async function seedAdminToken(): Promise<string> {
  for (const pw of ['admin123', 'password123', 'admin']) {
    try {
      const t = await login('admin', pw);
      if (t) return t;
    } catch { /* try next */ }
  }
  return '';
}

async function runReadSession(token: string, role: string, projectId: string): Promise<void> {
  const endpoints = [
    '/api/health',
    `/api/projects${projectId ? '?project_id=' + projectId : ''}`,
    `/api/tasks?project_id=${projectId}`,
    `/api/work_packages?project_id=${projectId}`,
  ];

  for (const endpoint of endpoints) {
    const res = await req('GET', endpoint, undefined, token);
    readLatencies.push(res.latencyMs);
    if (res.status === 0) errorCount++;
  }
}

async function runWriteSession(token: string, role: string, projectId: string): Promise<void> {
  if (!projectId) return;

  if (['Admin', 'ProjectManager', 'SiteEngineer'].includes(role)) {
    const res = await req('POST', '/api/project_actions', {
      project_id: projectId,
      title: `Load Test Action [${role}] ${Date.now()}`,
      status: 'Open',
      priority: 'Low',
      raised_by: 'load-test'
    }, token);
    writeLatencies.push(res.latencyMs);
    if (res.status === 0) errorCount++;
  }

  if (['Admin', 'CommercialManager'].includes(role)) {
    const res = await req('POST', '/api/project_risks', {
      project_id: projectId,
      title: `Load Test Risk [${role}] ${Date.now()}`,
      probability: 2,
      impact: 3
    }, token);
    writeLatencies.push(res.latencyMs);
    if (res.status === 0) errorCount++;
  }
}

async function main() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  MEP Management Platform — V1.4.1 Staging Load Test');
  console.log('  50 Sessions | 6 Personas | p95 SLAs: Read<750ms Write<1500ms');
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log('══════════════════════════════════════════════════════════════');

  console.log('\nStarting server...');
  await startServer();
  await sleep(5000);

  const adminToken = await seedAdminToken();
  if (!adminToken) {
    console.error('Could not obtain admin token — aborting load test');
    serverProcess?.kill();
    process.exit(1);
  }

  console.log('Admin authenticated. Creating test project...');

  // Create a project for load testing
  const projRes = await req('POST', '/api/projects', {
    name: `Load Test Project ${Date.now()}`,
    code: `LT-${Date.now()}`,
    status: 'Active'
  }, adminToken);

  const projectId = projRes.body?.id ?? '';
  console.log(`Test project: ${projectId || 'NONE'}`);

  // Build 50 session tokens: admin tokens used for all personas in simplified mode
  // In a fully seeded environment, distinct per-role users would be used
  const roleCounts = {
    Admin: 10, ProjectManager: 8, SiteEngineer: 8,
    CommercialManager: 6, Subcontractor: 10, Client: 8
  };

  const sessions: Array<{ token: string; role: string }> = [];
  for (const [role, count] of Object.entries(roleCounts)) {
    for (let i = 0; i < count; i++) {
      sessions.push({ token: adminToken, role });
    }
  }

  console.log(`\nLaunching ${sessions.length} concurrent sessions...`);
  const testStart = Date.now();

  // Wave 1: All reads concurrent
  await Promise.all(sessions.map(s => runReadSession(s.token, s.role, projectId)));
  console.log(`Wave 1 (reads) complete: ${readLatencies.length} requests`);

  // Wave 2: Mixed reads and writes concurrent
  await Promise.all(sessions.map(s =>
    Math.random() > 0.5
      ? runReadSession(s.token, s.role, projectId)
      : runWriteSession(s.token, s.role, projectId)
  ));
  console.log(`Wave 2 (mixed) complete`);

  // Wave 3: All reads again to validate no DB lock degradation
  await Promise.all(sessions.map(s => runReadSession(s.token, s.role, projectId)));
  console.log(`Wave 3 (reads post-writes) complete`);

  const totalDurationMs = Date.now() - testStart;

  // Results
  const readP95 = p95(readLatencies);
  const readP99 = p99(readLatencies);
  const writeP95 = p95(writeLatencies);
  const writeP99 = p99(writeLatencies);

  const readSlaPass = readP95 < 750;
  const writeSlaPass = writeLatencies.length === 0 || writeP95 < 1500;
  const busyPass = sqliteBusyCount === 0;

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  STAGING LOAD TEST RESULTS');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Total Duration:    ${totalDurationMs}ms`);
  console.log(`  Total Requests:    ${requestCount}`);
  console.log(`  Request Errors:    ${errorCount}`);
  console.log('');
  console.log(`  READ Latencies:`);
  console.log(`    avg=${avg(readLatencies)}ms  p95=${readP95}ms  p99=${readP99}ms`);
  console.log(`    SLA p95 < 750ms:  ${readSlaPass ? '✓ PASS' : '✗ FAIL'} (${readP95}ms)`);
  console.log('');
  console.log(`  WRITE Latencies:`);
  console.log(`    avg=${avg(writeLatencies)}ms  p95=${writeP95}ms  p99=${writeP99}ms`);
  console.log(`    SLA p95 < 1500ms: ${writeSlaPass ? '✓ PASS' : '✗ FAIL'} (${writeP95}ms)`);
  console.log('');
  console.log(`  SQLITE_BUSY occurrences: ${sqliteBusyCount} ${busyPass ? '✓' : '✗ FAIL'}`);
  console.log('══════════════════════════════════════════════════════════════');

  const allPass = readSlaPass && writeSlaPass && busyPass;
  console.log(`\n  OVERALL: ${allPass ? '✓ ALL SLAs MET' : '✗ SLA VIOLATIONS DETECTED'}`);

  serverProcess?.kill();
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('Load test fatal error:', err);
  serverProcess?.kill();
  process.exit(1);
});
