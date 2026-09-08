/**
 * Test Suite for BOV St. Venera (Job 2618) Specification & Tender Package
 * Verifies how real 67-page engineering specifications, drawings, BOQ, and AI work in the application.
 */

const BASE_URL = 'http://localhost:3000';

async function req({
  path,
  method = 'GET',
  token,
  body,
  isFormData = false
}: {
  path: string;
  method?: string;
  token?: string;
  body?: any;
  isFormData?: boolean;
}) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let reqBody: any = body;
  if (body && !isFormData) {
    headers['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: reqBody
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

function assert(condition: boolean, testName: string, detail?: any) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (detail) console.error('     Detail:', JSON.stringify(detail).slice(0, 300));
    throw new Error(`Test failed: ${testName}`);
  }
}

async function runBovSpecVerification() {
  console.log('===============================================================');
  console.log('🏛️ BOV ST. VENERA (JOB 2618) MEP TENDER SPECIFICATION VERIFICATION');
  console.log('===============================================================');

  // Step 1: Login as Admin / Project Manager
  console.log('\n👉 1. Authentication & Project Initialization');
  const loginRes = await req({
    path: '/api/login',
    method: 'POST',
    body: { username: 'pm_mep', password: 'pm123' }
  });
  assert(loginRes.status === 200 && loginRes.body.token, 'Project Manager logs in successfully');
  const pmToken = loginRes.body.token;

  const engLogin = await req({
    path: '/api/login',
    method: 'POST',
    body: { username: 'engineer', password: 'engineer123' }
  });
  assert(engLogin.status === 200 && engLogin.body.token, 'Site Engineer logs in successfully');
  const engToken = engLogin.body.token;

  // Step 2: Locate BOV St. Venera Project
  const projectsRes = await req({ path: '/api/projects', token: pmToken });
  assert(projectsRes.status === 200 && Array.isArray(projectsRes.body), 'Retrieve all active projects');
  const bovProj = projectsRes.body.find((p: any) => p.name.includes('BOV St. Venera'));
  assert(!!bovProj, 'Locate BOV St. Venera - Level 1 & 2 Refurbishment project in portfolio');
  const bovId = bovProj.id;
  console.log(`   Project ID: ${bovId} | Client: ${bovProj.client} | Budget: €${bovProj.budget}`);

  // Step 3: Verify Tender Drawings & Technical Specifications
  console.log('\n👉 2. Document & Drawing Repository (11 Sheets)');
  const docsRes = await req({ path: `/api/documents?project_id=${bovId}`, token: pmToken });
  assert(docsRes.status === 200 && Array.isArray(docsRes.body), 'Query documents and drawings for BOV project');
  const drawings = docsRes.body.filter((d: any) => d.category === 'Drawing');
  const specs = docsRes.body.filter((d: any) => d.category === 'Specification');
  assert(drawings.length >= 10, `Loaded all 10 tender drawings (Found ${drawings.length} sheets)`);
  assert(specs.length >= 1, `Loaded full Tender & Technical Specifications package (Found ${specs.length} specs)`);

  const schematic = drawings.find((d: any) => d.name.includes('2618-S-ELE-01'));
  assert(!!schematic, 'Locate Electrical Schematic Drawing (2618-S-ELE-01)');

  const lightingLayout = drawings.find((d: any) => d.name.includes('2618-L-LTG-01'));
  assert(!!lightingLayout, 'Locate Lighting Layout Drawing (2618-L-LTG-01)');

  const powerLayout = drawings.find((d: any) => d.name.includes('2618-L-PWR-01'));
  assert(!!powerLayout, 'Locate Small Power & Desk Servicing Drawing (2618-L-PWR-01)');

  // Step 4: Vector Hand Markup Annotation on Electrical Schematic
  console.log('\n👉 3. Vector Blueprint Markup Studio');
  const markupSave = await req({
    path: `/api/drawings/${schematic.id}/markups`,
    method: 'POST',
    token: engToken,
    body: {
      markup_data: JSON.stringify({
        strokes: [
          { type: 'cloud', color: '#ef4444', size: 3, rect: { x: 450, y: 320, w: 220, h: 110 } },
          { type: 'pen', color: '#3b82f6', size: 2, points: [{ x: 460, y: 430 }, { x: 500, y: 520 }] }
        ],
        snags: [
          {
            id: 'bov_snag_1',
            x: 480,
            y: 350,
            text: 'Clause 7.4: Verify breaking capacity of Schneider Isobar RCBOs is minimum 10kA per BS EN 60898'
          }
        ]
      })
    }
  });
  assert(markupSave.status === 200 && markupSave.body.ok, 'Save vector revision cloud and snag note on Electrical Schematic');

  const getSchematicWithMarkup = await req({
    path: `/api/drawings/${schematic.id}`,
    token: pmToken
  });
  assert(getSchematicWithMarkup.status === 200 && !!getSchematicWithMarkup.body.markup_data, 'Project Manager loads saved markup annotations from drawing');

  // Step 5: Bill of Quantities (BOQ) Validation
  console.log('\n👉 4. Commercial Bill of Quantities (BOQ) Items');
  const boqRes = await req({ path: `/api/boq_items?project_id=${bovId}`, token: pmToken });
  assert(boqRes.status === 200 && Array.isArray(boqRes.body), 'Fetch BOQ item registry');
  assert(boqRes.body.length >= 25, `Loaded all authentic BOQ items across all trades (Count: ${boqRes.body.length})`);

  const typeAFitting = boqRes.body.find((b: any) => b.description.includes('Type A 60x60cm'));
  assert(!!typeAFitting && typeAFitting.tender_quantity === 77, 'Verify BOQ Item: 77 No Type A 60x60cm LED Panels');

  const deskUnits = boqRes.body.find((b: any) => b.description.includes('Desk combination units'));
  assert(!!deskUnits && deskUnits.tender_quantity === 82, 'Verify BOQ Item: 82 No Desk combination units (4 Sockets + USB-A/C)');

  const upsItem = boqRes.body.find((b: any) => b.description.includes('20kVA UPS'));
  assert(!!upsItem, 'Verify BOQ Item: Monolithic 20kVA UPS System with 10-year VRLA batteries');

  // Step 6: Technical Coordination RFI
  console.log('\n👉 5. Engineering RFI Generation Against Specification');
  const rfiRes = await req({
    path: '/api/rfis',
    method: 'POST',
    token: engToken,
    body: {
      project_id: bovId,
      number: 'RFI-BOV-001',
      subject: 'Conduit Separation in Wall Chases (Clause 11.2.5 vs Plumbing Route)',
      trade: 'Electrical',
      discipline: 'Electrical',
      assigned_to: 'Enser Ltd',
      question: 'Spec Clause 11.2.5 requires minimum 150mm separation from water pipes. On Level 1 Kitchenette, plumbing chase conflicts with 25mm PVC conduit to UP0. Please confirm offset routing.',
      status: 'Open',
      priority: 'High'
    }
  });
  assert(rfiRes.status === 201 && rfiRes.body.id, 'Site Engineer creates RFI referencing Specification Clause 11.2.5');

  // Step 7: Technical Submittal Creation
  console.log('\n👉 6. Technical Compliance Submittal');
  const submittalRes = await req({
    path: '/api/submittals',
    method: 'POST',
    token: engToken,
    body: {
      project_id: bovId,
      number: 'SUB-BOV-UPS-01',
      title: '20kVA Monolithic UPS with 10-Year VRLA Maintenance-Free Batteries',
      trade: 'Electrical',
      subcontractor: 'SparkTech Electrical',
      spec_section: 'Section 2.3: UPS Installation',
      status: 'Submitted'
    }
  });
  assert(submittalRes.status === 201 && submittalRes.body.id, 'Engineer creates Technical Material Submittal referencing Section 2.3');

  // Step 8: AI Technical Advisor Specification Consultation
  console.log('\n👉 7. Senior AI MEP Technical Advisor (Tender Spec Queries)');
  const aiQuery1 = await req({
    path: '/api/ai/chat',
    method: 'POST',
    token: engToken,
    body: {
      question: 'In the BOV St. Venera Job 2618 specification, what are the exact cable tie spacing requirements under Clause 9.1.2?',
      context: { project: 'BOV St. Venera', job: '2618' }
    }
  });
  assert(aiQuery1.status === 200 && !!aiQuery1.body.reply, 'AI Technical Advisor responds to Cable Tie Spacing query');
  console.log('   AI Response Excerpt:', aiQuery1.body.reply.slice(0, 220).replace(/\n/g, ' '));

  const aiQuery2 = await req({
    path: '/api/ai/chat',
    method: 'POST',
    token: engToken,
    body: {
      question: 'What are the liquidated damages per day and the maximum deduction under General Conditions Clause 9 for BOV St. Venera?',
      context: { project: 'BOV St. Venera', job: '2618' }
    }
  });
  assert(aiQuery2.status === 200 && !!aiQuery2.body.reply, 'AI Technical Advisor responds to Liquidated Damages query');
  console.log('   AI Response Excerpt:', aiQuery2.body.reply.slice(0, 220).replace(/\n/g, ' '));

  console.log('\n===============================================================');
  console.log('🎉 BOV ST. VENERA (JOB 2618) END-TO-END SPECIFICATION TEST PASSED!');
  console.log('===============================================================');
}

runBovSpecVerification().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
