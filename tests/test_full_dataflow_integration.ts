/**
 * MEP FieldHub v1.5.0 — Full 10-Connection Data-Flow & End-to-End Integration Audit Suite
 *
 * Tests:
 * 1. Excel (.xlsx) & PDF (.pdf) BOQ & Contract Upload + Extraction
 * 2. BOQ Material & Technical Specification flow into Material Requests -> Purchase Orders -> Cost Tracking
 * 3. Priority End-to-End Workflow:
 *    Import BOQ -> Review Project Budget -> Generate Work Packages -> Assign Subcontractor ->
 *    Update Progress -> Verify Dashboard -> Verify Client Portal
 * 4. All 10 Domain Connections (Create, Update, Approve, Delete across DB, APIs, Dashboard, Subcontractor & Client Portals)
 */
import zlib from "zlib";

const BASE = process.env.BASE_URL || "http://localhost:3000";

let passed = 0;
let failed = 0;

function assert(cond: any, msg: string) {
  if (cond) {
    console.log(`  ✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

async function login(username: string, password = "ChangeMe123!") {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = (await res.json()) as any;
  return { status: res.status, token: data.token, user: data.user || data };
}

async function apiJson(method: string, path: string, token: string, body?: any) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, data: json };
}

/**
 * Builds a minimal valid OpenXML .xlsx ZIP buffer in memory (store-method ZIP with
 * xl/sharedStrings.xml and xl/worksheets/sheet1.xml) so we test real .xlsx binary parsing!
 */
function buildTestXlsxBuffer(rows: string[][]): Buffer {
  const sharedStrings: string[] = [];
  const strIndex = (s: string) => {
    let idx = sharedStrings.indexOf(s);
    if (idx === -1) {
      idx = sharedStrings.length;
      sharedStrings.push(s);
    }
    return idx;
  };

  const escapeXml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  let sheetRowsXml = "";
  rows.forEach((r, rIdx) => {
    let cellsXml = "";
    r.forEach((cellVal, cIdx) => {
      const colLetter = String.fromCharCode(65 + cIdx);
      const ref = `${colLetter}${rIdx + 1}`;
      const numVal = Number(cellVal);
      if (rIdx > 0 && cellVal !== "" && !isNaN(numVal) && cIdx >= 5) {
        cellsXml += `<c r="${ref}"><v>${numVal}</v></c>`;
      } else {
        const sIdx = strIndex(String(cellVal));
        cellsXml += `<c r="${ref}" t="s"><v>${sIdx}</v></c>`;
      }
    });
    sheetRowsXml += `<row r="${rIdx + 1}">${cellsXml}</row>`;
  });

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
${sharedStrings.map(s => `<si><t>${escapeXml(s)}</t></si>`).join("")}
</sst>`;

  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${sheetRowsXml}</sheetData>
</worksheet>`;

  const files: Array<{ name: string; data: Buffer }> = [
    { name: "xl/sharedStrings.xml", data: Buffer.from(sharedStringsXml, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet1Xml, "utf8") },
  ];

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const deflated = zlib.deflateRawSync(f.data);
    const localHdr = Buffer.alloc(30);
    localHdr.writeUInt32LE(0x04034b50, 0);
    localHdr.writeUInt16LE(20, 4);
    localHdr.writeUInt16LE(0, 6);
    localHdr.writeUInt16LE(8, 8); // Deflate
    localHdr.writeUInt32LE(0, 10);
    localHdr.writeUInt32LE(0, 14);
    localHdr.writeUInt32LE(deflated.length, 18);
    localHdr.writeUInt32LE(f.data.length, 22);
    localHdr.writeUInt16LE(nameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28);

    const localEntry = Buffer.concat([localHdr, nameBuf, deflated]);
    localParts.push(localEntry);

    const centralHdr = Buffer.alloc(46);
    centralHdr.writeUInt32LE(0x02014b50, 0);
    centralHdr.writeUInt16LE(20, 4);
    centralHdr.writeUInt16LE(20, 6);
    centralHdr.writeUInt16LE(0, 8);
    centralHdr.writeUInt16LE(8, 10);
    centralHdr.writeUInt32LE(0, 12);
    centralHdr.writeUInt32LE(0, 16);
    centralHdr.writeUInt32LE(deflated.length, 20);
    centralHdr.writeUInt32LE(f.data.length, 24);
    centralHdr.writeUInt16LE(nameBuf.length, 28);
    centralHdr.writeUInt16LE(0, 30);
    centralHdr.writeUInt16LE(0, 32);
    centralHdr.writeUInt16LE(0, 34);
    centralHdr.writeUInt16LE(0, 36);
    centralHdr.writeUInt32LE(0, 38);
    centralHdr.writeUInt32LE(offset, 42);

    centralParts.push(Buffer.concat([centralHdr, nameBuf]));
    offset += localEntry.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

/**
 * Builds a valid PDF buffer with embedded text lines so both PDFParse and PDF stream fallback extract text cleanly.
 */
function buildTestPdfBuffer(lines: string[]): Buffer {
  const streamLines = [
    "BT",
    "/F1 11 Tf",
    "50 750 Td",
    ...lines.map((l, i) => `${i > 0 ? "0 -16 Td " : ""}(${l.replace(/[()\\]/g, "")}) Tj`),
    "ET",
  ].join("\n");

  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${streamLines.length} >>
stream
${streamLines}
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
trailer << /Size 6 /Root 1 0 R >>
startxref
0
%%EOF`;
  return Buffer.from(pdf, "utf8");
}

async function runFullDataflowAudit() {
  console.log("\n======================================================================");
  console.log("🚀 MEP FIELDHUB v1.5.0 — FULL 10-CONNECTION DATA-FLOW & E2E AUDIT");
  console.log("======================================================================\n");

  const runId = Date.now().toString().slice(-6);
  const adminAuth = await login("admin", "ChangeMe123!");
  assert(adminAuth.status === 200 && Boolean(adminAuth.token), "Admin login succeeded");
  const token = adminAuth.token;

  // ---------------------------------------------------------------------------
  // STEP 1: CREATE CLEAN AUDIT PROJECT & ROLE USERS (PM, SUBCONTRACTOR, CLIENT)
  // ---------------------------------------------------------------------------
  console.log("\n--- [1] Project -> WBS -> Work Packages -> Tasks & Excel/PDF BOQ Import ---");
  const createProj = await apiJson("POST", "/api/projects", token, {
    name: "Marina Bay MEP Tower Audit",
    client: "Emaar Development PJSC",
    budget: 100000,
    start_date: "2026-04-01",
    end_date: "2026-12-31",
    location: "Dubai Marina, UAE",
  });
  assert(createProj.status === 201 && createProj.data.id, "Created test project 'Marina Bay MEP Tower Audit'");
  const projectId = createProj.data.id;

  // Create Subcontractor Company
  const subCompRes = await apiJson("POST", "/api/companies", token, {
    name: `Gulf Mechanical Subcontractors ${runId}`,
    type: "Subcontractor",
    trade: "HVAC",
    status: "Active",
  });
  const subCompanyId = subCompRes.data.id;

  // Create temporary PM, Subcontractor, and Client accounts
  const pmUserRes = await apiJson("POST", "/api/users", token, {
    username: `pm_audit_${runId}`,
    name: "Audit Project Manager",
    password: "ChangeMe123!",
    role: "ProjectManager",
    project_ids: [projectId],
  });
  const subUserRes = await apiJson("POST", "/api/users", token, {
    username: `sub_audit_${runId}`,
    name: "Audit HVAC Subcontractor",
    password: "ChangeMe123!",
    role: "Subcontractor",
    company_id: subCompanyId,
    project_ids: [projectId],
  });
  const clientUserRes = await apiJson("POST", "/api/users", token, {
    username: `client_audit_${runId}`,
    name: "Audit Client Representative",
    password: "ChangeMe123!",
    role: "Client",
    project_ids: [projectId],
  });

  const pmAuth = await login(`pm_audit_${runId}`, "ChangeMe123!");
  const subAuth = await login(`sub_audit_${runId}`, "ChangeMe123!");
  const clientAuth = await login(`client_audit_${runId}`, "ChangeMe123!");

  assert(pmAuth.status === 200 && Boolean(pmAuth.token), "Project Manager login succeeded");
  assert(subAuth.status === 200 && Boolean(subAuth.token), "Subcontractor login succeeded");
  assert(clientAuth.status === 200 && Boolean(clientAuth.token), "Client login succeeded");

  // ---------------------------------------------------------------------------
  // STEP 2: UPLOAD EXCEL (.xlsx) BOQ FILE & VERIFY BOQ + MATERIAL REQUEST SPECS
  // ---------------------------------------------------------------------------
  console.log("\n--- [2] Excel (.xlsx) & PDF (.pdf) BOQ Upload & Material Request Specification Flow ---");
  const xlsxBuffer = buildTestXlsxBuffer([
    ["Item Number", "Description", "Specification", "Discipline", "System", "Unit", "Tender Quantity", "Tender Rate", "Tender Amount"],
    [
      "M-HVAC-101",
      "Water-Cooled Centrifugal Chiller 500 TR",
      "ASHRAE 90.1 / AHRI 550/590 certified centrifugal chiller, R-134a, marine waterboxes, VFD starter",
      "HVAC",
      "Chilled Water Plant",
      "Set",
      "2",
      "85000",
      "170000",
    ],
    [
      "E-LV-201",
      "Main LV Switchboard MDB-01 (2500A Form 4b)",
      "IEC 61439-2 type-tested Form 4b Type 6 enclosure, tinned copper busbar, ACB incoming with microprocessor protection",
      "Electrical",
      "LV Power Distribution",
      "Set",
      "1",
      "95000",
      "95000",
    ],
    [
      "P-PLB-301",
      "Triplex Domestic Water Booster Pump Set",
      "WRAS approved AISI 316L stainless steel multistage vertical pumps with hydro-pneumatic vessel & VFD",
      "Plumbing",
      "Domestic Water System",
      "Set",
      "1",
      "35000",
      "35000",
    ],
  ]);

  const xlsxForm = new FormData();
  xlsxForm.append("project_id", projectId);
  xlsxForm.append(
    "file",
    new Blob([xlsxBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "Marina_Bay_MEP_BOQ.xlsx"
  );

  const importXlsxRes = await fetch(`${BASE}/api/boq/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: xlsxForm,
  });
  const importXlsxData = (await importXlsxRes.json()) as any;
  assert(
    importXlsxRes.status === 200 && importXlsxData.imported >= 3,
    `Excel (.xlsx) BOQ imported ${importXlsxData.imported} lines totaling $${importXlsxData.tender_amount}`
  );
  assert(
    importXlsxData.tender_amount === 300000,
    `Excel (.xlsx) BOQ tender total accurately calculated as $300,000 (got $${importXlsxData.tender_amount})`
  );

  // Also test PDF BOQ upload via /api/boq/import
  const pdfBuffer = buildTestPdfBuffer([
    "Project Name: Marina Bay MEP Tower Audit",
    "Client: Emaar Development PJSC",
    "4.01 Addressable Fire Alarm Control Panel (4-Loop EN54) 2 Set 25,000",
  ]);
  const pdfForm = new FormData();
  pdfForm.append("project_id", projectId);
  pdfForm.append("file", new Blob([pdfBuffer], { type: "application/pdf" }), "Fire_Alarm_Addendum_BOQ.pdf");
  const importPdfRes = await fetch(`${BASE}/api/boq/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: pdfForm,
  });
  const importPdfData = (await importPdfRes.json()) as any;
  assert(
    importPdfRes.status === 200 && importPdfData.imported >= 1,
    `PDF (.pdf) BOQ imported ${importPdfData.imported} line(s) from PDF stream`
  );

  // Verify BOQ items in database via /api/boq and /api/boq_items
  const boqListRes = await apiJson("GET", `/api/boq?project_id=${projectId}`, token);
  assert(
    boqListRes.status === 200 && Array.isArray(boqListRes.data) && boqListRes.data.length >= 4,
    `GET /api/boq returned ${boqListRes.data?.length} BOQ items with specifications`
  );
  const chillerBoq = boqListRes.data.find((b: any) => String(b.description).includes("Centrifugal Chiller"));
  assert(
    Boolean(chillerBoq && String(chillerBoq.specification).includes("ASHRAE 90.1")),
    `BOQ item preserves full Technical Specification: "${chillerBoq?.specification}"`
  );

  // Verify Material Requests automatically contain the BOQ Material Name & Technical Specification!
  const mrListRes = await apiJson("GET", `/api/material_requests?project_id=${projectId}`, token);
  assert(
    mrListRes.status === 200 && Array.isArray(mrListRes.data) && mrListRes.data.length >= 4,
    `GET /api/material_requests returned ${mrListRes.data?.length} auto-generated Material Requests from BOQ`
  );
  const chillerMr = mrListRes.data.find(
    (m: any) => String(m.material || m.item).includes("Centrifugal Chiller")
  );
  assert(
    Boolean(
      chillerMr &&
        chillerMr.material === "Water-Cooled Centrifugal Chiller 500 TR" &&
        String(chillerMr.specification || chillerMr.spec).includes("ASHRAE 90.1") &&
        chillerMr.boq_reference === "M-HVAC-101" &&
        Number(chillerMr.quantity) === 2
    ),
    `Material Request shows BOQ Material ("${chillerMr?.material}"), BOQ Ref ("${chillerMr?.boq_reference}"), Qty (${chillerMr?.quantity} ${chillerMr?.unit}), and Technical Specification ("${chillerMr?.specification}")`
  );

  // Convert Material Request to Purchase Order & verify Cost Tracking!
  const convertPoRes = await apiJson("POST", `/api/material_requests/${chillerMr.id}/create-po`, token, {
    vendor: "Daikin Applied Middle East",
  });
  assert(
    convertPoRes.status === 201 && convertPoRes.data.ok && convertPoRes.data.purchase_order?.id,
    `Converted Material Request (with BOQ Specification) into Purchase Order ${convertPoRes.data.purchase_order?.po_number}`
  );
  assert(
    String(convertPoRes.data.purchase_order?.description).includes("ASHRAE 90.1"),
    "Purchase Order description carries the BOQ Material & Technical Specification"
  );

  // ---------------------------------------------------------------------------
  // STEP 3: CONNECTION 4 — DOCUMENTS -> PROJECT & BUDGET (NO SILENT OVERWRITE)
  // ---------------------------------------------------------------------------
  console.log("\n--- [3] Connection 4: Documents -> Project & Budget Governance ---");
  const projBeforeDoc = await apiJson("GET", `/api/projects/${projectId}`, token);
  const budgetBeforeDoc = projBeforeDoc.data.budget;

  // Uploading a normal document via POST /api/documents must NOT silently overwrite project name or budget
  const docUploadRes = await apiJson("POST", "/api/documents", token, {
    project_id: projectId,
    name: "M-HVAC-GA-001 Ground Floor Ductwork Layout",
    category: "Drawing",
    revision: "Rev 0",
    attachment_name: "contract_override_test.txt",
    attachment_data:
      "data:text/plain;base64," +
      Buffer.from("Project Name: SILENT OVERWRITE HACK\nContract Value: USD 99,999,999\n").toString("base64"),
  });
  assert(docUploadRes.status === 201 && docUploadRes.data.id, "Uploaded drawing document via POST /api/documents");
  const drawingId = docUploadRes.data.id;

  const projAfterDoc = await apiJson("GET", `/api/projects/${projectId}`, token);
  assert(
    projAfterDoc.data.name === "Marina Bay MEP Tower Audit" && projAfterDoc.data.budget === budgetBeforeDoc,
    "POST /api/documents did NOT silently overwrite existing project name or budget"
  );

  // ---------------------------------------------------------------------------
  // STEP 4: CONNECTION 3 — WORK PACKAGES -> ASSIGN SUBCONTRACTOR -> SUB PORTAL
  // ---------------------------------------------------------------------------
  console.log("\n--- [4] Connection 3: Work Packages -> Assign Subcontractor -> Subcontractor Portal ---");
  const wpsRes = await apiJson("GET", `/api/work_packages?project_id=${projectId}`, token);
  assert(
    wpsRes.status === 200 && wpsRes.data.length >= 3,
    `Generated ${wpsRes.data.length} Work Packages from BOQ disciplines`
  );
  const hvacWp = wpsRes.data.find((w: any) => w.discipline === "HVAC") || wpsRes.data[0];

  // Assign Subcontractor's company to the HVAC Work Package
  const assignWpRes = await apiJson("PUT", `/api/work_packages/${hvacWp.id}`, token, {
    company_id: subCompanyId,
    lead_contact: subAuth.user.name || "Audit HVAC Subcontractor",
    status: "Active",
  });
  assert(assignWpRes.status === 200 && assignWpRes.data.ok, `Assigned Subcontractor company (${subCompanyId}) to Work Package ${hvacWp.code}`);

  // Verify Subcontractor can see the assigned Work Package and its Tasks in Subcontractor Portal
  const subWpsRes = await apiJson("GET", `/api/work_packages?project_id=${projectId}`, subAuth.token);
  assert(
    subWpsRes.status === 200 && subWpsRes.data.some((w: any) => w.id === hvacWp.id),
    "Subcontractor Portal sees assigned Work Package"
  );

  const subTasksRes = await apiJson("GET", `/api/tasks?project_id=${projectId}`, subAuth.token);
  assert(
    subTasksRes.status === 200 && subTasksRes.data.length >= 1,
    `Subcontractor Portal sees ${subTasksRes.data.length} assigned task(s)`
  );
  const targetTask = subTasksRes.data[0];

  // ---------------------------------------------------------------------------
  // STEP 5: CONNECTION 7 — RFIs -> DRAWINGS -> TASKS (BLOCKER SYNC)
  // ---------------------------------------------------------------------------
  console.log("\n--- [5] Connection 7: RFIs -> Drawings -> Tasks & Readiness Blocker Sync ---");
  const createRfiRes = await apiJson("POST", "/api/rfis", token, {
    project_id: projectId,
    number: "RFI-HVAC-001",
    subject: "Chiller Plantroom Plinth Reinforcement & Acoustic Pad Detail",
    question: "Please confirm plinth height and inertia base spring isolator deflection for 500 TR chillers.",
    trade: "HVAC",
    drawing_id: drawingId,
    task_id: targetTask.id,
    work_package_id: hvacWp.id,
    status: "Open",
    due_date: "2026-05-15",
  });
  assert(createRfiRes.status === 201 && createRfiRes.data.id, "Created RFI linked to Drawing and Task");
  assert(
    createRfiRes.data.drawing_ref === "M-HVAC-GA-001 Ground Floor Ductwork Layout",
    `RFI auto-linked drawing reference: "${createRfiRes.data.drawing_ref}"`
  );

  // Verify Task Readiness shows open RFI blocker
  const readinessBlocked = await apiJson("GET", `/api/tasks/${targetTask.id}/readiness`, token);
  assert(
    readinessBlocked.status === 200 && readinessBlocked.data.open_blockers_count >= 1,
    `Task readiness reflects open RFI blocker (status: ${readinessBlocked.data.readiness_status}, blockers: ${readinessBlocked.data.open_blockers_count})`
  );

  // Answer & close RFI -> verify blocker is resolved!
  const answerRfiRes = await apiJson("PUT", `/api/rfis/${createRfiRes.data.id}`, token, {
    answer: "Confirmed: 300mm concrete plinth with 50mm Mason spring isolators per detail D-04.",
    status: "Answered",
  });
  assert(answerRfiRes.status === 200 && answerRfiRes.data.status === "Answered", "Answered RFI");

  const readinessCleared = await apiJson("GET", `/api/tasks/${targetTask.id}/readiness`, token);
  assert(
    readinessCleared.status === 200 && readinessCleared.data.open_blockers_count === 0,
    "Answering RFI automatically resolved the linked Task blocker"
  );

  // ---------------------------------------------------------------------------
  // STEP 6: CONNECTION 5 & 8 — TASKS -> PROGRESS -> INSPECTIONS -> VERIFIED PROGRESS -> DASHBOARD
  // ---------------------------------------------------------------------------
  console.log("\n--- [6] Connections 5 & 8: Subcontractor Progress -> QA/QC Inspection -> Verified Progress -> Dashboard ---");
  // Subcontractor submits a progress claim on their Work Package
  const subClaimRes = await apiJson("POST", "/api/progress_submissions", subAuth.token, {
    project_id: projectId,
    work_package_id: hvacWp.id,
    period_ending: "2026-05-31",
    claimed_percent: 60,
    work_executed_notes: "Chillers rigged onto plinths; primary CHW header piping 60% welded.",
    status: "Submitted",
  });
  assert(
    (subClaimRes.status === 201 || subClaimRes.status === 200) && subClaimRes.data.id,
    "Subcontractor submitted progress claim (60%)"
  );

  // PM verifies Subcontractor progress claim
  const verifyClaimRes = await apiJson("POST", `/api/progress_submissions/${subClaimRes.data.id}/verify`, pmAuth.token, {
    verified_percent: 60,
    status: "Approved",
    verification_notes: "Site walkdown completed; 60% progress verified.",
  });
  assert(
    verifyClaimRes.status === 200 && Number(verifyClaimRes.data.verified_percent) === 60,
    "Project Manager verified Subcontractor progress claim (60%)"
  );

  // Record a Passed QA/QC Inspection linked to targetTask and chillerBoq -> verifies task to 100% & certifies BOQ!
  const createInspRes = await apiJson("POST", "/api/inspections", token, {
    project_id: projectId,
    type: "Hydrostatic Pressure Test & Chiller Alignment Inspection",
    title: "MIR/WIR-HVAC-001 Chiller Plant & Header Hydrotest",
    task_id: targetTask.id,
    work_package_id: hvacWp.id,
    boq_item_id: chillerBoq.id,
    verified_progress: 100,
    result: "Pass",
    status: "Approved",
    location: "Basement Plantroom B2",
    discipline: "HVAC",
    notes: "Tested at 15 bar for 4 hours with zero pressure drop. Witnessed by Consultant.",
  });
  assert(createInspRes.status === 201 && createInspRes.data.id, "Created Passed QA/QC Inspection linked to Task & BOQ Item");

  // Update BOQ installed quantity and verify task completion + project progress + dashboard metrics
  await apiJson("PUT", `/api/boq/${chillerBoq.id}`, token, {
    installed_quantity: 2,
    certified_quantity: 2,
  });

  const updatedTaskRes = await apiJson("GET", `/api/tasks/${targetTask.id}`, token);
  assert(
    updatedTaskRes.status === 200 && Number(updatedTaskRes.data.progress) === 100 && updatedTaskRes.data.status === "Completed",
    `Inspection Pass automatically verified Task "${updatedTaskRes.data.title}" to 100% Completed (verified_by: ${updatedTaskRes.data.verified_by})`
  );

  const dashRes = await apiJson("GET", `/api/dashboard?project_id=${projectId}`, token);
  assert(
    dashRes.status === 200 &&
      Number(dashRes.data.avg_progress) > 0 &&
      Number(dashRes.data.boq_tender_value) >= 300000 &&
      Number(dashRes.data.po_committed_value) >= 170000 &&
      Number(dashRes.data.verified_inspections_count) >= 1,
    `Dashboard reflects live metrics: avg_progress=${dashRes.data.avg_progress}%, boq_tender=$${dashRes.data.boq_tender_value}, po_committed=$${dashRes.data.po_committed_value}, verified_inspections=${dashRes.data.verified_inspections_count}`
  );

  // ---------------------------------------------------------------------------
  // STEP 7: CONNECTION 9 — CLIENT PORTAL -> PUBLISHED RECORDS GOVERNANCE
  // ---------------------------------------------------------------------------
  console.log("\n--- [7] Connection 9: Client Portal -> Published Records Governance ---");
  // Before publishing, Client must NOT see the internal drawing document
  const clientDocsBefore = await apiJson("GET", `/api/documents?project_id=${projectId}`, clientAuth.token);
  assert(
    clientDocsBefore.status === 200 && !clientDocsBefore.data.some((d: any) => d.id === drawingId),
    "Unpublished internal drawing is hidden from Client Portal"
  );

  // PM publishes the drawing to Client
  const publishDocRes = await apiJson("PUT", `/api/documents/${drawingId}`, pmAuth.token, {
    visibility: "Client",
  });
  assert(
    publishDocRes.status === 200 && publishDocRes.data.visibility === "Client" && Boolean(publishDocRes.data.published_at),
    "PM published drawing to Client Portal (stamped published_by & published_at)"
  );

  const clientDocsAfter = await apiJson("GET", `/api/documents?project_id=${projectId}`, clientAuth.token);
  assert(
    clientDocsAfter.status === 200 && clientDocsAfter.data.some((d: any) => d.id === drawingId),
    "Published drawing is visible in Client Portal"
  );

  // Publish an official Progress Report to the Client Portal
  const pubReportRes = await apiJson("POST", "/api/progress_reports/publish", pmAuth.token, {
    project_id: projectId,
    title: "Monthly Executive Progress Report — May 2026",
    executive_summary: "HVAC Chiller Plant 100% installed and hydrotested; LV Switchgear on order.",
  });
  assert(
    pubReportRes.status === 200 && pubReportRes.data.status === "Published",
    `Published Progress Report (${pubReportRes.data.report_no}) to Client Portal with frozen progress=${pubReportRes.data.overall_progress}%`
  );

  const clientReportsRes = await apiJson("GET", `/api/progress_reports?project_id=${projectId}`, clientAuth.token);
  assert(
    clientReportsRes.status === 200 && clientReportsRes.data.some((r: any) => r.id === pubReportRes.data.id),
    "Client Portal sees Published Progress Report"
  );

  // ---------------------------------------------------------------------------
  // STEP 8: CONNECTION 10 — WHATSAPP -> OCTO -> PROJECT RECORDS
  // ---------------------------------------------------------------------------
  console.log("\n--- [8] Connection 10: WhatsApp -> Octo -> Project Records & Audit Trail ---");
  const octoIdentityRes = await apiJson("POST", "/api/octo/identities", token, {
    user_id: adminAuth.user.user_id || adminAuth.user.id,
    whatsapp_number: `+97150${runId}`,
    default_project_id: projectId,
    verified: 1,
  });
  assert(
    octoIdentityRes.status === 201 || octoIdentityRes.status === 200,
    `Bound WhatsApp identity (+97150${runId}) to test project`
  );

  const octoLogWebhook = await apiJson("POST", "/api/octo/webhook", token, {
    from: `+97150${runId}`,
    message_id: `wamid.audit.${Date.now()}`,
    text: `daily log: Installed 2 centrifugal chillers and completed 15 bar hydrotest in Basement B2 | crew: 18 | trade: HVAC`,
    project_id: projectId,
  });
  assert(
    octoLogWebhook.status === 200 && octoLogWebhook.data.status === "EXECUTED",
    `WhatsApp -> Octo webhook executed daily log creation (record_id: ${octoLogWebhook.data.record_id})`
  );

  // ---------------------------------------------------------------------------
  // STEP 9: DELETE & CLEANUP VERIFICATION ACROSS RECORDS
  // ---------------------------------------------------------------------------
  console.log("\n--- [9] Delete & Cleanup Verification ---");
  const tempBoq = await apiJson("POST", "/api/boq", token, {
    project_id: projectId,
    item_code: "TEMP-999",
    description: "Temporary BOQ Item for Delete Audit",
    specification: "Temporary Spec",
    discipline: "ELV",
    unit: "Nr",
    quantity: 5,
    unit_rate: 100,
  });
  assert(tempBoq.status === 201 && tempBoq.data.id, "Created temporary BOQ item");

  const delBoq = await apiJson("DELETE", `/api/boq/${tempBoq.data.id}`, token);
  assert(delBoq.status === 200 && delBoq.data.ok, "Deleted temporary BOQ item via DELETE /api/boq/:id");

  const getDeletedBoq = await apiJson("GET", `/api/boq/${tempBoq.data.id}`, token);
  assert(getDeletedBoq.status === 404, "Deleted BOQ item returns 404 Not Found");

  // Clean up test users, company, and project
  if (pmUserRes.data?.id) await apiJson("DELETE", `/api/users/${pmUserRes.data.id}`, token);
  if (subUserRes.data?.id) await apiJson("DELETE", `/api/users/${subUserRes.data.id}`, token);
  if (clientUserRes.data?.id) await apiJson("DELETE", `/api/users/${clientUserRes.data.id}`, token);
  if (subCompanyId) await apiJson("DELETE", `/api/companies/${subCompanyId}`, token);
  await apiJson("DELETE", `/api/projects/${projectId}`, token);

  console.log("\n======================================================================");
  console.log(`📊 FULL DATA-FLOW AUDIT SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("======================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runFullDataflowAudit().catch(err => {
  console.error("Fatal error in test_full_dataflow_integration:", err);
  process.exit(1);
});
