import http from 'http';
import assert from 'assert';

const BASE_URL = 'http://127.0.0.1:3000';

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {}
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: text,
          json: parsed,
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function run() {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  BOQ Task Planning & Evidence Photo Workflow Test Suite');
  console.log('══════════════════════════════════════════════════════════════\n');

  // 1. Authenticate as admin
  console.log('[1] Authenticating Admin...');
  let token = null;
  for (const pw of ['ChangeMe123!', 'Password123!', 'admin123', 'password123']) {
    const authPayload = JSON.stringify({ username: 'admin', password: pw });
    const authRes = await httpRequest(
      {
        hostname: '127.0.0.1',
        port: 3000,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(authPayload),
        },
      },
      authPayload
    );
    if (authRes.json?.token) {
      token = authRes.json.token;
      break;
    }
  }

  assert.ok(token, 'Admin login must succeed');
  console.log('  ✓ Admin authenticated successfully\n');

  const projectId = '62f2d843-f7b9-4de9-b845-0d91d8f05809';

  // 2. Fetch project tasks
  console.log('[2] Fetching BOQ Tasks for BOV St. Venera...');
  const tasksRes = await httpRequest({
    hostname: '127.0.0.1',
    port: 3000,
    path: `/api/tasks?project_id=${projectId}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.strictEqual(tasksRes.statusCode, 200, `Tasks list should return 200, got ${tasksRes.statusCode}`);
  const tasks = tasksRes.json;
  assert.ok(Array.isArray(tasks), 'Tasks response must be an array');
  console.log(`  ✓ Retrieved ${tasks.length} tasks from BOV St. Venera schedule`);
  assert.strictEqual(tasks.length, 137, `Must have exactly 137 BOQ tasks, got ${tasks.length}`);

  // 3. Verify trade decompositions and BOQ references
  console.log('\n[3] Verifying BOQ Work Breakdown & Trade Mapping...');
  const elecs = tasks.filter(t => t.trade === 'Electrical');
  const elvs = tasks.filter(t => t.trade === 'ELV');
  const hvacs = tasks.filter(t => t.trade === 'HVAC');
  console.log(`  ✓ Electrical Tasks: ${elecs.length}`);
  console.log(`  ✓ ELV / Data / Telecoms Tasks: ${elvs.length}`);
  console.log(`  ✓ HVAC Tasks: ${hvacs.length}`);
  assert.ok(elecs.length >= 80, 'Must have at least 80 Electrical tasks');
  assert.ok(elvs.length >= 15, 'Must have at least 15 ELV tasks');

  // Verify first task is 1.0 Design and last is 28.0 Programme Qualification
  const task1 = tasks.find(t => t.wbs_code === 'BOV-BOQ-001');
  const task137 = tasks.find(t => t.wbs_code === 'BOV-BOQ-137');
  assert.ok(task1, 'Task BOV-BOQ-001 must exist');
  assert.ok(task137, 'Task BOV-BOQ-137 must exist');
  console.log(`  ✓ First Task: [${task1.wbs_code}] ${task1.title} (${task1.duration})`);
  console.log(`  ✓ Last Task: [${task137.wbs_code}] ${task137.title} (${task137.duration})`);

  // 4. Test Task Completion with Photo Evidence via POST /api/tasks/:id/complete-with-evidence
  console.log('\n[4] Testing "Complete Task & Attach Evidence Photo" Endpoint...');
  // Find an uncompleted task to transition to Done
  const targetTask = tasks.find(t => t.status !== 'Completed' && !t.is_summary);
  assert.ok(targetTask, 'An uncompleted work task must exist');
  console.log(`  Target Task to complete: [${targetTask.wbs_code}] ${targetTask.title}`);
  console.log(`  Initial Status: ${targetTask.status}, Initial Progress: ${targetTask.progress}%`);

  const samplePhotoDataUrl = 'data:image/svg+xml;base64,' + Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">
      <rect width="600" height="400" fill="#0f172a"/>
      <text x="30" y="50" fill="#38bdf8" font-size="20" font-weight="bold">FIELD EVIDENCE PHOTO - 100% DONE</text>
      <text x="30" y="80" fill="#94a3b8" font-size="14">Task: ${targetTask.title}</text>
      <circle cx="300" cy="220" r="80" fill="#10b981"/>
      <path d="M260 220 L290 250 L340 190" stroke="#ffffff" stroke-width="12" fill="none" stroke-linecap="round"/>
    </svg>
  `).toString('base64');

  const completePayload = JSON.stringify({
    evidence_url: samplePhotoDataUrl,
    evidence_notes: 'All Level 1 conduit and supports physically verified on site by Lead QC Inspector. Conforms to specification.',
    actual_end_date: '2026-10-10'
  });

  const completeRes = await httpRequest(
    {
      hostname: '127.0.0.1',
      port: 3000,
      path: `/api/tasks/${targetTask.id}/complete-with-evidence`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(completePayload)
      }
    },
    completePayload
  );

  assert.strictEqual(completeRes.statusCode, 200, `Complete endpoint must return 200, got ${completeRes.statusCode}: ${completeRes.body}`);
  const updatedTask = completeRes.json;
  assert.strictEqual(updatedTask.status, 'Completed', 'Task status must be Completed');
  assert.strictEqual(updatedTask.progress, 100, 'Task progress must be 100%');
  assert.strictEqual(updatedTask.actual_end_date, '2026-10-10', 'Actual end date must be recorded');
  assert.ok(updatedTask.evidence_url, 'Evidence URL must be stored on task');
  console.log(`  ✓ Task successfully transitioned to: status='${updatedTask.status}', progress=${updatedTask.progress}%`);
  console.log(`  ✓ Actual End Date: ${updatedTask.actual_end_date}`);
  console.log(`  ✓ Evidence Photo URL length: ${updatedTask.evidence_url.length} chars`);

  // 5. Verify auto-archiving of evidence photo into technical documents repository
  console.log('\n[5] Verifying Auto-Archiving of Photo into Documents Repository...');
  const docsRes = await httpRequest({
    hostname: '127.0.0.1',
    port: 3000,
    path: `/api/documents?project_id=${projectId}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.strictEqual(docsRes.statusCode, 200, 'Documents list must return 200');
  const docs = docsRes.json;
  const sitePhotos = docs.filter(d => d.category === 'Site Photo');
  console.log(`  ✓ Total Site Photos in Technical Documents: ${sitePhotos.length}`);
  assert.ok(sitePhotos.length >= 7, 'Must have at least 7 archived site photo documents');

  const archivedDoc = sitePhotos.find(d => d.name.includes(targetTask.title));
  assert.ok(archivedDoc, `Archived document for '${targetTask.title}' must exist in repository`);
  console.log(`  ✓ Found Archived Document: "${archivedDoc.name}"`);
  console.log(`  ✓ Category: ${archivedDoc.category}`);
  console.log(`  ✓ Status: ${archivedDoc.status}`);
  console.log(`  ✓ Date Added: ${archivedDoc.date_added}`);

  // 6. Verify task status history entry
  console.log('\n[6] Verifying Task Status Audit History...');
  const historyRes = await httpRequest({
    hostname: '127.0.0.1',
    port: 3000,
    path: `/api/tasks/${targetTask.id}/history`,
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.strictEqual(historyRes.statusCode, 200, 'History endpoint must return 200');
  const history = historyRes.json;
  assert.ok(Array.isArray(history) && history.length > 0, 'Status history must have entries');
  console.log(`  ✓ Found ${history.length} status change history entries for task`);
  const latestEntry = history[0];
  console.log(`  ✓ Latest Change: ${latestEntry.old_status || 'initial'} ➔ ${latestEntry.new_status} by ${latestEntry.changed_by}`);
  assert.strictEqual(latestEntry.new_status, 'Completed', 'Latest history entry must be Completed');

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ALL BOQ TASK PLANNING & EVIDENCE PHOTO TESTS PASSED (100%)');
  console.log('══════════════════════════════════════════════════════════════');
}

run().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
