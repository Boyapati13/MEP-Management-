import { answerCopilotQuestion } from "../server/services/copilotService";

async function run() {
  console.log("=========================================");
  console.log("COPILOT SERVICE REAL PROJECT VERIFICATION");
  console.log("=========================================");

  const queries = [
    {
      name: "BOV St. Venera Budget & Commercial Ledger",
      prompt: "What is the budget and commercial breakdown for BOV St. Venera?",
      projectId: "all",
      checks: ["BOV St. Venera", "Budget", "EUR", "1,30,893"]
    },
    {
      name: "BOV St. Venera Work Packages",
      prompt: "Show me the work packages for BOV St. Venera",
      projectId: "all",
      checks: ["Work Packages", "Preliminaries", "Electrical Distribution", "Cat 6"]
    },
    {
      name: "BOV St. Venera Variations & Change Orders",
      prompt: "Are there any change orders or variations on BOV St. Venera?",
      projectId: "all",
      checks: ["Variations", "Change Orders", "VAR-2618-001", "HDMI"]
    },
    {
      name: "BOV St. Venera Purchase Orders & Committed Costs",
      prompt: "List the purchase orders and committed costs for BOV St. Venera",
      projectId: "all",
      checks: ["Purchase Orders", "PO-2618-001", "Schneider Electric", "Prysmian"]
    },
    {
      name: "BOV St. Venera QA/QC Inspections & Snags",
      prompt: "What are the latest QA/QC inspections and snags?",
      projectId: "all",
      checks: ["QA/QC", "Inspections", "Continuity", "Snags", "Traffolyte"]
    },
    {
      name: "Portfolio Overview Query",
      prompt: "Give me an executive summary of all projects and portfolio budget",
      projectId: "all",
      checks: ["Portfolio", "BOV St. Venera", "EUR"]
    },
    {
      name: "Technical MEP Engineering Standard",
      prompt: "What is the hydrostatic testing pressure for chilled water piping?",
      projectId: "all",
      checks: ["Hydrostatic", "design pressure", "bar"]
    }
  ];

  let passed = 0;
  const dummyUser = { id: "e13aa2c0-3c49-45d1-b204-ce2a11c77cf2", username: "admin", role: "Admin", company: "Apex MEP Engineering Ltd" };

  for (const q of queries) {
    try {
      const res = await answerCopilotQuestion(dummyUser as any, {
        question: q.prompt,
        project_id: q.projectId
      });
      let allMatch = true;
      for (const c of q.checks) {
        if (!res.answer.toLowerCase().includes(c.toLowerCase())) {
          allMatch = false;
          console.error(`  ❌ [${q.name}] Missing keyword: "${c}"`);
        }
      }
      if (allMatch) {
        console.log(`  ✅ [${q.name}] Passed. Preview:\n     ${res.answer.slice(0, 120).replace(/\n/g, ' ')}...`);
        passed++;
      } else {
        console.error(`  ❌ [${q.name}] Failed checks.\n     Full response: ${res.answer.slice(0, 200)}...`);
      }
    } catch (e: any) {
      console.error(`  💥 [${q.name}] Exception:`, e.message);
    }
  }

  console.log(`\nResults: ${passed} / ${queries.length} passed.`);
  if (passed === queries.length) {
    console.log("🎉 ALL REAL PROJECT COPILOT TESTS PASSED 100%!");
    process.exit(0);
  } else {
    process.exit(1);
  }
}

run();
