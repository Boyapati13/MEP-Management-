/**
 * MEP Management Platform — Release V1.4.0 High-Concurrency Performance & Load Testing Suite
 * Benchmarks:
 * - 50 concurrent simulated client sessions
 * - 500 total requests across core platform endpoints
 * - Measures throughput (req/sec), min, avg, p50, p95, p99 latency
 * - Validates SLA compliance (<150ms p95 latency under high concurrency)
 */
import http from 'http';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const TEST_PORT = 3210;
const agent = new http.Agent({ keepAlive: true, maxSockets: 100 });

function req(options: { path: string; method?: string; body?: any; token?: string | null }): Promise<{ status: number; durationMs: number; body: any }> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const data = options.body ? JSON.stringify(options.body) : null;
    const r = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: options.path,
      method: options.method || 'GET',
      agent,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(options.token ? { 'Authorization': `Bearer ${options.token}` } : {})
      }
    }, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        const durationMs = performance.now() - start;
        let parsed: any;
        try { parsed = JSON.parse(resBody); } catch { parsed = resBody; }
        resolve({ status: res.statusCode || 500, durationMs, body: parsed });
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

async function runLoadPerformanceBenchmark() {
  console.log('================================================================================');
  console.log('  MEP V1.4.0 HIGH-CONCURRENCY PERFORMANCE & LOAD BENCHMARK');
  console.log('  Testing 50 Concurrent Sessions | 500 HTTP Requests | SLA < 150ms p95');
  console.log('================================================================================\n');

  const tmpDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mep-load-test-'));
  const dbPath = path.join(tmpDbDir, 'load.db');

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
          JWT_SECRET: 'load-secret-benchmark-140'
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
    assert(healthy, 'Load benchmark server booted cleanly');

    // 1. Authenticate admin
    const loginRes = await req({
      path: '/api/login',
      method: 'POST',
      body: { username: 'admin', password: 'ChangeMe123!' }
    });
    const token = loginRes.body.token;

    // 2. Seed Realistic Dataset
    console.log('>>> Seeding load testing dataset...');
    const projRes = await req({
      path: '/api/projects',
      method: 'POST',
      token,
      body: {
        name: 'Load Benchmark Mega Hospital',
        project_code: 'PRJ-HOSP-LOAD',
        contract_value: 120000000,
        currency: 'USD',
        stage: 'Construction',
        baseline_start_date: '2026-01-01',
        baseline_end_date: '2027-12-31',
        forecast_end_date: '2028-01-15'
      }
    });
    const projectId = projRes.body.id;

    // Seed sites, wbs, work package
    const siteRes = await req({ path: '/api/sites', method: 'POST', token, body: { project_id: projectId, name: 'Main Ward Tower' } });
    const siteId = siteRes.body.id;

    const wbsRes = await req({ path: '/api/wbs_items', method: 'POST', token, body: { project_id: projectId, code: '1.0', name: 'Electrical Works' } });
    const wbsId = wbsRes.body.id;

    const wpRes = await req({
      path: '/api/work_packages',
      method: 'POST',
      token,
      body: { project_id: projectId, code: 'WP-ELEC-LOAD', name: 'Power Distribution', site_id: siteId, wbs_item_id: wbsId, budget_allocated: 25000000 }
    });
    const wpId = wpRes.body.id;

    // Seed 25 tasks
    for (let i = 1; i <= 25; i++) {
      await req({
        path: '/api/tasks',
        method: 'POST',
        token,
        body: {
          project_id: projectId,
          work_package_id: wpId,
          site_id: siteId,
          wbs_item_id: wbsId,
          title: `Substation Cable Tray Section ${i}`,
          trade: 'Electrical',
          start: '2026-03-01',
          end: '2026-03-20',
          progress: i * 3,
          status: i % 5 === 0 ? 'Blocked' : i % 2 === 0 ? 'In Progress' : 'Completed'
        }
      });
    }

    // Seed actions, decisions, risks, POs
    for (let i = 1; i <= 10; i++) {
      await req({
        path: '/api/project_actions',
        method: 'POST',
        token,
        body: { project_id: projectId, title: `Commissioning Action ${i}`, priority: 'High', status: 'Open', due_date: '2026-04-01' }
      });
      await req({
        path: '/api/project_decisions',
        method: 'POST',
        token,
        body: { project_id: projectId, title: `Engineering Decision ${i}`, cost_impact: i * 5000, schedule_impact_days: i }
      });
      await req({
        path: '/api/risks',
        method: 'POST',
        token,
        body: { project_id: projectId, title: `Supply Chain Risk ${i}`, probability: String((i % 5) + 1), impact: String(((i + 1) % 5) + 1) }
      });
      await req({
        path: '/api/purchase_orders',
        method: 'POST',
        token,
        body: { project_id: projectId, po_number: `PO-LOAD-${i}`, description: `Transformers ${i}`, amount: 50000 }
      });
    }

    console.log('>>> Seeding complete. Executing 50 concurrent client workers...\n');

    const testEndpoints = [
      `/api/projects/${projectId}/master`,
      `/api/control-tower?project_id=${projectId}`,
      `/api/tasks/lookahead?project_id=${projectId}&days=14`,
      `/api/work_packages/${wpId}/command-center`,
      `/api/procurement/programme-impact?project_id=${projectId}`,
      `/api/project_risks/matrix?project_id=${projectId}`,
      `/api/project_actions?project_id=${projectId}`,
      `/api/project_decisions?project_id=${projectId}`
    ];

    const TOTAL_REQUESTS = 500;
    const CONCURRENCY = 50;
    const latencies: number[] = [];
    let successes = 0;
    let errors = 0;

    const startTime = performance.now();

    // Work pool execution
    let requestIndex = 0;
    const executeWorker = async () => {
      while (requestIndex < TOTAL_REQUESTS) {
        const currentIdx = requestIndex++;
        const endpoint = testEndpoints[currentIdx % testEndpoints.length];
        try {
          const res = await req({ path: endpoint, token });
          if (res.status === 200) {
            successes++;
            latencies.push(res.durationMs);
          } else {
            if (errors < 5) console.error(`[LOAD ERROR] ${endpoint} returned ${res.status}:`, JSON.stringify(res.body));
            errors++;
          }
        } catch (err: any) {
          if (errors < 5) console.error(`[LOAD CATCH ERROR] ${endpoint}:`, err?.message);
          errors++;
        }
      }
    };

    const workers = Array.from({ length: CONCURRENCY }, () => executeWorker());
    await Promise.all(workers);

    const totalDurationMs = performance.now() - startTime;
    const totalDurationSec = totalDurationMs / 1000;
    const throughput = Math.round(TOTAL_REQUESTS / totalDurationSec);

    latencies.sort((a, b) => a - b);
    const minLatency = Math.round(latencies[0] || 0);
    const maxLatency = Math.round(latencies[latencies.length - 1] || 0);
    const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1));
    const p50 = Math.round(latencies[Math.floor(latencies.length * 0.50)] || 0);
    const p95 = Math.round(latencies[Math.floor(latencies.length * 0.95)] || 0);
    const p99 = Math.round(latencies[Math.floor(latencies.length * 0.99)] || 0);

    console.log('================================================================================');
    console.log('  LOAD BENCHMARK SCORECARD');
    console.log('================================================================================');
    console.log(`  Total Requests:          ${TOTAL_REQUESTS}`);
    console.log(`  Successful (200 OK):     ${successes}`);
    console.log(`  Failed:                  ${errors}`);
    console.log(`  Total Duration:          ${totalDurationSec.toFixed(2)}s`);
    console.log(`  Throughput:              ${throughput} req/sec`);
    console.log('--------------------------------------------------------------------------------');
    console.log(`  Min Latency:             ${minLatency} ms`);
    console.log(`  Avg Latency:             ${avgLatency} ms`);
    console.log(`  p50 Latency (Median):    ${p50} ms`);
    console.log(`  p95 Latency (SLA):       ${p95} ms`);
    console.log(`  p99 Latency:             ${p99} ms`);
    console.log(`  Max Latency:             ${maxLatency} ms`);
    console.log('================================================================================\n');

    const isCI = !!process.env.CI;
    const targetP95 = isCI ? 600 : 150;
    const targetAvg = isCI ? 350 : 100;
    const targetThroughput = isCI ? 25 : 100;

    assert(errors === 0, 'Zero request failures under 50 concurrent client load (100% success)');
    assert(p95 <= targetP95, `p95 latency (${p95}ms) meets SLA threshold of <= ${targetP95}ms (CI: ${isCI})`);
    assert(avgLatency <= targetAvg, `Average latency (${avgLatency}ms) meets performance standard of <= ${targetAvg}ms (CI: ${isCI})`);
    assert(throughput >= targetThroughput, `Throughput (${throughput} req/sec) meets high-concurrency capability (CI: ${isCI})`);

  } finally {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
    try {
      fs.rmSync(tmpDbDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n================================================================================');
  console.log(`  BENCHMARK RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================================');
  if (failed > 0) process.exit(1);
}

runLoadPerformanceBenchmark().catch(err => {
  console.error('Fatal load benchmark error:', err);
  process.exit(1);
});
