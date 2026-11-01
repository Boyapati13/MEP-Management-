import { answerCopilotQuestion } from "../server/services/copilotService";

async function run() {
  console.log("=========================================");
  console.log("COPILOT SERVICE INTEGRATION VERIFICATION");
  console.log("=========================================");

  const queries = [
    {
      name: "Burj Crown Budget Query",
      prompt: "What is the budget for Burj Crown?",
      projectId: "all",
      checks: ["Burj Crown", "Budget", "USD"]
    },
    {
      name: "Burj Crown Work Packages Query",
      prompt: "Show me the work packages for Burj Crown",
      projectId: "all",
      checks: ["Work Packages", "HVAC", "Plumbing"]
    },
    {
      name: "BOV St. Venera Specific Context",
      prompt: "What is the total cost and packages for BOV St. Venera?",
      projectId: "all",
      checks: ["BOV", "Venera"]
    },
    {
      name: "Portfolio Overview Query",
      prompt: "Give me an executive summary of all projects and portfolio budget",
      projectId: "all",
      checks: ["Portfolio", "projects", "USD"]
    },
    {
      name: "Change Orders & Variations",
      prompt: "Are there any change orders or variations on Burj Crown?",
      projectId: "all",
      checks: ["Variations", "Change Orders", "Burj Crown"]
    },
    {
      name: "Purchase Orders & Committed Costs",
      prompt: "List the purchase orders and committed costs for Burj Crown",
      projectId: "all",
      checks: ["Purchase Orders", "Burj Crown"]
    },
    {
      name: "QA/QC Inspections & Snags",
      prompt: "What are the latest QA/QC inspections?",
      projectId: "all",
      checks: ["QA/QC", "Inspections"]
    },
    {
      name: "Technical MEP Engineering Standard",
      prompt: "What is the hydrostatic testing pressure for chilled water piping?",
      projectId: "all",
      checks: ["Hydrostatic", "design pressure", "bar"]
    }
  ];

  let passed = 0;
  const dummyUser = { id: "user-1", username: "admin", role: "Admin", company_id: "comp-1" };

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
    console.log("🎉 ALL COPILOT TESTS PASSED 100%!");
    process.exit(0);
  } else {
    process.exit(1);
  }
}

run();
