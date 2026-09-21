/**
 * MEP Management Platform — Contractor Document Intelligence & Auto-Update Verification Test
 * Tests uploading contractor documents, multi-entity auto-population, and verification checks.
 */
import http from "http";
import assert from "assert";

const BASE_URL = "http://127.0.0.1:3000";

function httpRequest(
  options: http.RequestOptions,
  body?: Buffer | string
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string; json: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed: any = null;
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
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// Build multipart/form-data payload
function buildMultipart(
  fields: Record<string, string>,
  fileField: string,
  filename: string,
  fileData: Buffer,
  mimeType: string
): { buffer: Buffer; boundary: string } {
  const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
  const crlf = "\r\n";
  const parts: Buffer[] = [];

  for (const [key, val] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="${key}"${crlf}${crlf}${val}${crlf}`));
  }

  parts.push(
    Buffer.from(
      `--${boundary}${crlf}Content-Disposition: form-data; name="${fileField}"; filename="${filename}"${crlf}Content-Type: ${mimeType}${crlf}${crlf}`
    )
  );
  parts.push(fileData);
  parts.push(Buffer.from(`${crlf}--${boundary}--${crlf}`));

  return { buffer: Buffer.concat(parts), boundary };
}

async function run() {
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  Contractor Document Intelligence & Auto-Update Test Suite");
  console.log("══════════════════════════════════════════════════════════════\n");

  // 1. Authenticate as admin
  console.log("[1] Authenticating Admin...");
  let token: string | null = null;
  for (const pw of ["ChangeMe123!", "Password123!", "admin123", "password123"]) {
    const authPayload = JSON.stringify({ username: "admin", password: pw });
    const authRes = await httpRequest(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path: "/api/auth/login",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(authPayload),
        },
      },
      authPayload
    );
    if (authRes.json?.token) {
      token = authRes.json.token;
      break;
    }
  }

  assert.ok(token, "Admin login must succeed");
  console.log("  ✓ Admin logged in successfully\n");

  // 2. Prepare sample contractor document text
  const contractorContractDoc = `
CONTRACT AGREEMENT FOR MEP SUBCONTRACT WORKS
Project: Burj Crown Commercial Tower MEP Package
Project Code: PRJ-BC-892
Client / Employer: Emaar Development PJSC
Main Contractor: Arabtec Construction LLC
Subcontractor: BK Gulf MEP Engineering LLC
Lead Consultant: WSP Middle East
Contract Value: USD 4,850,000
Contract Type: Lump Sum EPC
Site Location: Plot 42, Downtown Boulevard, Dubai, UAE
Commencement Date: 2026-10-01
Completion Date: 2027-06-30

SCOPE OF WORKS:
The Subcontractor shall furnish all labor, materials, equipment, and services for complete execution of
HVAC cooling systems, Electrical power distribution, Plumbing and sanitary drainage, Fire Fighting sprinklers,
and ELV building management systems in accordance with the specifications.

SCHEDULE OF KEY EXECUTION MILESTONES:
1. Mobilization and Technical Submittals Approval
2. First Fix Containment and Chilled Water Piping
3. Primary Chiller and AHU Equipment Rigging
4. Secondary Cable Pulling and Air Duct Installation
5. Hydrostatic Pressure Testing and Flushing
6. Electrical Switchgear Energization and System Balancing
7. Civil Defense Final Inspection and Handover
`;

  // 3. Test uploading document to create a brand new project
  console.log("[2] Uploading Contractor Document to create new Project...");
  const multipart1 = buildMultipart(
    {},
    "file",
    "Burj_Crown_MEP_Subcontract_Agreement.txt",
    Buffer.from(contractorContractDoc, "utf8"),
    "text/plain"
  );

  const uploadRes1 = await httpRequest(
    {
      hostname: "127.0.0.1",
      port: 3000,
      path: "/api/projects/upload-contractor-doc",
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/form-data; boundary=${multipart1.boundary}`,
        "Content-Length": multipart1.buffer.length,
      },
    },
    multipart1.buffer
  );

  assert.strictEqual(uploadRes1.statusCode, 201, `Upload must return 201, got ${uploadRes1.statusCode}: ${uploadRes1.body}`);
  const data1 = uploadRes1.json;
  assert.strictEqual(data1.success, true, "Response must indicate success");
  assert.ok(data1.project_id, "Response must include project_id");
  const projectId = data1.project_id;

  console.log(`  ✓ Project created with ID: ${projectId}`);
  console.log(`  ✓ Project Name: ${data1.project.name}`);
  console.log(`  ✓ Client: ${data1.project.client}`);
  console.log(`  ✓ Main Contractor: ${data1.project.main_contractor}`);
  console.log(`  ✓ Budget: $${data1.project.budget}`);
  console.log(`  ✓ Start / End: ${data1.project.start_date} to ${data1.project.end_date}`);

  assert.strictEqual(data1.project.name, "Burj Crown Commercial Tower MEP Package");
  assert.strictEqual(data1.project.client, "Emaar Development PJSC");
  assert.strictEqual(data1.project.budget, 4850000);
  assert.strictEqual(data1.project.start_date, "2026-10-01");
  assert.strictEqual(data1.project.end_date, "2027-06-30");

  // 4. Verify the automated verification checks
  console.log("\n[3] Validating Multi-Portal Automated Verification Report...");
  const report1 = data1.report;
  assert.strictEqual(report1.project_master.status, "VERIFIED", "Project master must be VERIFIED");
  assert.strictEqual(report1.work_packages.status, "VERIFIED", "Work packages must be VERIFIED");
  assert.ok(report1.work_packages.count >= 4, `Must have decomposed at least 4 work packages, got ${report1.work_packages.count}`);
  assert.strictEqual(report1.programme_tasks.status, "VERIFIED", "Programme tasks must be VERIFIED");
  assert.ok(report1.programme_tasks.count >= 5, `Must have scheduled at least 5 milestones, got ${report1.programme_tasks.count}`);
  assert.strictEqual(report1.contractor_directory.status, "VERIFIED", "Contractor directory must be VERIFIED");
  assert.strictEqual(report1.document_repository.status, "VERIFIED", "Document repository must be VERIFIED");
  assert.strictEqual(report1.overall_readiness.percentage, 100, "Overall readiness must be 100%");

  console.log(`  ✓ Project Master: ${report1.project_master.status}`);
  console.log(`  ✓ Contractor Directory: ${report1.contractor_directory.company_name} [${report1.contractor_directory.status}]`);
  console.log(`  ✓ Work Packages: ${report1.work_packages.count} trades created [${report1.work_packages.status}]`);
  console.log(`  ✓ Programme Tasks: ${report1.programme_tasks.count} milestones scheduled [${report1.programme_tasks.status}]`);
  console.log(`  ✓ Document Repository: Archived as '${report1.document_repository.category}' [${report1.document_repository.status}]`);
  console.log(`  ✓ Overall Readiness: ${report1.overall_readiness.percentage}% [${report1.overall_readiness.status}]`);

  // 5. Test updating the existing project via contractor document addendum
  console.log("\n[4] Testing Existing Project Update via Contractor Document Addendum...");
  const addendumDoc = `
PROJECT ADDENDUM & SCOPE VARIATION
Project: Burj Crown Commercial Tower MEP Package
Client / Employer: Emaar Development PJSC
Main Contractor: BK Gulf MEP Engineering LLC
Contract Value: USD 5,200,000
Completion Date: 2027-08-31
Scope: Extended testing and seasonal commissioning for critical cooling systems.
`;

  const multipart2 = buildMultipart(
    { project_id: projectId },
    "file",
    "Burj_Crown_Addendum_01.txt",
    Buffer.from(addendumDoc, "utf8"),
    "text/plain"
  );

  const uploadRes2 = await httpRequest(
    {
      hostname: "127.0.0.1",
      port: 3000,
      path: `/api/projects/${projectId}/upload-contractor-doc`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/form-data; boundary=${multipart2.boundary}`,
        "Content-Length": multipart2.buffer.length,
      },
    },
    multipart2.buffer
  );

  assert.strictEqual(uploadRes2.statusCode, 201, "Addendum upload must return 201");
  const data2 = uploadRes2.json;
  assert.strictEqual(data2.project.budget, 5200000, "Budget must be updated to 5,200,000");
  assert.strictEqual(data2.project.end_date, "2027-08-31", "End date must be updated to 2027-08-31");
  assert.strictEqual(data2.report.project_master.status, "VERIFIED");
  console.log("  ✓ Updated Budget successfully to: $" + data2.project.budget);
  console.log("  ✓ Updated Completion Date to: " + data2.project.end_date);

  // 6. Cleanup test data
  console.log("\n[5] Cleaning up test project and associated records...");
  const delRes = await httpRequest(
    {
      hostname: "127.0.0.1",
      port: 3000,
      path: `/api/projects/${projectId}`,
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  assert.strictEqual(delRes.statusCode, 200, "Cleanup delete should return 200");
  console.log("  ✓ Test project cleaned up cleanly\n");

  console.log("══════════════════════════════════════════════════════════════");
  console.log("  ALL CONTRACTOR DOC INTELLIGENCE TESTS PASSED (100%)");
  console.log("══════════════════════════════════════════════════════════════");
}

run().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
