/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared MEP (Mechanical, Electrical & Plumbing) domain knowledge.
 *
 * This is the single source of truth for the app's engineering context -
 * used to ground three things in real standards rather than pure model
 * recall:
 *   1. The general AI advisor (/api/ai/chat)
 *   2. Document-to-Planner structuring (/api/documents/:id/analyze)
 *   3. Punch list / NCR fix suggestions (/api/ai/suggest-fix)
 *
 * It intentionally avoids tying any of this to a specific project, client,
 * or tender - see README "Known Limitations" history for why.
 */

export const MEP_REFERENCE_KNOWLEDGE = `
General MEP Engineering Reference Standards (background knowledge - apply where relevant to the question; do not treat this as details of any specific contract unless the question or provided context says otherwise):

1. Electrical Installation
   - Standards: BS 7671 (IET Wiring Regulations, 18th Edition), IEC 60364. Typical LV distribution: 400V +10%/-6% 50Hz, 4-wire TN-S system.
   - Cable spacing & ties: up to 9mm dia bundle: 600mm horizontal / 800mm vertical tie spacing, 3mm tie. 10-15mm dia: 350mm/450mm, 5mm tie. 16-20mm dia: 450mm/550mm, 6mm tie. Above 20mm dia: 450mm/600mm, 9mm tie. UV-stable ties rated for the installation environment.
   - Containment: UPVC conduit to BS4607-1/BS6099-1, saddles max 1.25m apart. Minimum 150mm separation from water pipes where run in the same chase. Minimum 35mm cover in concrete, 5mm in plaster.
   - BS 7671 sequence of tests (Part 6, Reg 643): continuity of protective conductors, continuity of ring final circuit conductors, insulation resistance, protection by barriers/enclosures, polarity, earth electrode resistance, verification of disconnection times, RCD operation, prospective fault current, phase sequence, functional testing, voltage drop.

2. Extra Low Voltage & Data
   - Cat 6 U/UTP for general data; Cat 6 F/UTP (shielded) near WiFi APs or EMI sources. 23AWG conductors, LSZH sheath, 110-style IDC termination.
   - AV distribution over HDMI benefits from Active Optical Cable (AOC) runs beyond ~15m to avoid signal degradation.

3. Mechanical / HVAC
   - Maintain minimum 150mm vertical separation between cable trays/ladders and insulated ductwork.
   - Chilled water and condensate lines should generally run below electrical containment to avoid condensation risk onto live equipment.
   - Ceiling void access: minimum 200mm service envelope below VAV boxes, fire dampers and FCU filter access panels; minimum 450x450mm inspection hatch below motorised dampers.
   - Ductwork leakage testing to SMACNA / DW/144 as applicable; balancing to CIBSE Commissioning Code A.

4. Plumbing & Public Health
   - Hot/cold water pipe separation: minimum 150mm, hot above cold where run in parallel, to reduce heat gain into cold services.
   - Pressure testing: hydrostatic test at 1.5x working pressure, held for a minimum of 1 hour with no visible drop, before backfilling or closing up chases.
   - Falls on gravity drainage: minimum 1:40 for 100mm soil pipe, 1:80 acceptable only where flow volume supports self-cleansing velocity.
   - Backflow prevention required at any cross-connection risk point (irrigation, plant rooms, chemical dosing).

5. Fire Protection
   - Fire-stopping required at every service penetration through a fire-rated wall/floor, matched to the wall's rating (typically 60-120 min in commercial fit-outs); use a certified system, not generic sealant.
   - Sprinkler head spacing and clearance per NFPA 13 / BS EN 12845 as applicable to the governing code; minimum clearance below head to any obstruction typically 300mm+ unless the obstruction is specifically assessed.
   - Fire dampers require accessible inspection/access panels and must be tested/reset per manufacturer instructions after any ductwork alteration nearby.

6. UPS & Standby Power
   - Standalone UPS units are typically sized for the connected critical load plus headroom for future expansion; modular/scalable topologies allow capacity growth without full replacement.
   - VRLA battery strings are commonly specified for a 10-year design life; confirm autonomy time and N+1 redundancy against the site's actual critical-load profile.
`.trim();

export interface MepDefectPattern {
  id: string;
  discipline: "Electrical" | "HVAC" | "Plumbing" | "Fire Protection" | "ELV/Data" | "General";
  keywords: string[];
  issue: string;
  likelyCause: string;
  recommendedFix: string;
  reference: string;
}

// Deterministic defect -> likely cause -> fix patterns. Used (a) as grounding
// context in the AI prompt for /api/ai/suggest-fix, and (b) as a keyword-matched
// fallback when no GEMINI_API_KEY is configured, so the feature still works -
// just without the AI's ability to handle novel phrasing.
export const MEP_DEFECT_PATTERNS: MepDefectPattern[] = [
  {
    id: "elec-tray-sag",
    discipline: "Electrical",
    keywords: ["cable tray sag", "tray sagging", "tray deflection", "cable tray bending"],
    issue: "Cable tray/ladder sagging between supports",
    likelyCause: "Support spacing exceeds the tray manufacturer's maximum span for the installed cable loading.",
    recommendedFix: "Add intermediate supports to bring spacing within the manufacturer's rated span for the actual loaded weight; re-level and re-secure the tray before re-inspection.",
    reference: "Manufacturer's load/span tables; BS EN 61537",
  },
  {
    id: "elec-db-labelling",
    discipline: "Electrical",
    keywords: ["missing label", "unlabelled db", "panel schedule missing", "db not labelled", "circuit not identified"],
    issue: "Distribution board or circuit missing labelling",
    likelyCause: "Panel schedule/circuit directory not completed or not updated after final circuit allocation.",
    recommendedFix: "Produce/update the panel schedule from as-built circuit records and fit a permanent, typed directory card inside the DB door; label each way to match.",
    reference: "BS 7671 Reg 514.1",
  },
  {
    id: "elec-ir-fail",
    discipline: "Electrical",
    keywords: ["insulation resistance fail", "ir test fail", "low insulation resistance", "megger fail"],
    issue: "Insulation resistance test result below acceptable value",
    likelyCause: "Moisture ingress, cable damage during pulling, or a connected load (e.g. surge protection device) skewing the reading.",
    recommendedFix: "Isolate and test the circuit conductor-by-conductor with all loads/SPDs disconnected; inspect for physical cable damage or wet containment; retest before re-energising.",
    reference: "BS 7671 Reg 643.3 (min 1MΩ at 500V DC for standard LV circuits)",
  },
  {
    id: "elec-earth-continuity",
    discipline: "Electrical",
    keywords: ["earth continuity fail", "cpc continuity", "earth fault loop high"],
    issue: "Earth continuity / loop impedance test failure",
    likelyCause: "Loose or corroded CPC termination, undersized CPC for the run length, or a missing bonding connection.",
    recommendedFix: "Inspect and re-terminate all CPC connections along the run; verify CPC size against Table 54.7; confirm main and supplementary bonding is intact.",
    reference: "BS 7671 Reg 643.7, Reg 411.3.2",
  },
  {
    id: "hvac-condensate-leak",
    discipline: "HVAC",
    keywords: ["condensate leak", "condensate overflow", "fcu leaking", "ahu drip tray overflow"],
    issue: "Condensate leak or drip tray overflow at FCU/AHU",
    likelyCause: "Blocked or incorrectly-falling condensate drain, undersized drain pipe, or a missing/failed condensate pump.",
    recommendedFix: "Clear the drain run and confirm continuous fall (min 1:100); verify trap depth against unit static pressure; test the condensate pump float switch under simulated full-load condition.",
    reference: "Manufacturer IOM; CIBSE Guide B",
  },
  {
    id: "hvac-duct-leakage",
    discipline: "HVAC",
    keywords: ["duct leakage", "ductwork air leak", "air leakage test fail"],
    issue: "Ductwork air leakage test failure",
    likelyCause: "Unsealed transverse/longitudinal joints, damaged flexible connections, or a damper not fully closing.",
    recommendedFix: "Re-seal all joints in the tested section with an approved mastic/tape system rated for the duct pressure class; retest the section before proceeding to the next.",
    reference: "SMACNA / DW/144 leakage class limits",
  },
  {
    id: "hvac-noise-vibration",
    discipline: "HVAC",
    keywords: ["fan noise", "unit vibration", "ductwork vibration", "excessive noise from unit"],
    issue: "Excessive noise or vibration from a fan/AHU/FCU",
    likelyCause: "Missing or degraded anti-vibration mounts, rigid connection between unit and ductwork/structure, or fan out of balance.",
    recommendedFix: "Fit/replace anti-vibration mounts sized for the unit's operating weight; introduce a flexible duct connector at the unit spigot; check fan balance if noise persists.",
    reference: "CIBSE Guide B; ASHRAE Fundamentals - vibration isolation",
  },
  {
    id: "plumb-pressure-test-fail",
    discipline: "Plumbing",
    keywords: ["pressure test fail", "hydro test fail", "pipe test failed", "pressure drop during test"],
    issue: "Pipework pressure test failed (pressure drop during hold period)",
    likelyCause: "Leaking joint, unreleased trapped air giving a false initial reading, or a fitting not yet fully cured (solvent weld/press-fit).",
    recommendedFix: "Purge trapped air before re-pressurising; visually inspect all joints under pressure with leak-detection fluid; allow correct cure time for the jointing method before retesting.",
    reference: "Pressure test at 1.5x working pressure, min 1 hour hold, no visible drop",
  },
  {
    id: "plumb-backfall",
    discipline: "Plumbing",
    keywords: ["backfall", "drainage not draining", "ponding in pipe", "reverse fall"],
    issue: "Drainage pipe found with backfall / insufficient fall",
    likelyCause: "Incorrect support spacing/levels during installation, or settlement of an unsupported section.",
    recommendedFix: "Re-support and re-level the affected section to achieve minimum fall (1:40 for 100mm soil, confirm against pipe size); re-survey with a level before closing up.",
    reference: "Building Regulations Part H (or local equivalent); min fall 1:40",
  },
  {
    id: "fire-stopping-missing",
    discipline: "Fire Protection",
    keywords: ["fire stopping missing", "penetration not sealed", "fire seal missing", "unsealed penetration"],
    issue: "Service penetration through a fire-rated wall/floor not fire-stopped",
    likelyCause: "Fire-stopping omitted after final cable/pipe installation, or a certified system not available at the time of first-fix.",
    recommendedFix: "Seal the penetration with a certified fire-stopping system matched to the wall/floor's fire rating; record the system used and issue a fire-stopping certificate/schedule entry.",
    reference: "Match wall/floor fire rating (typ. 60-120 min); use third-party certified system",
  },
  {
    id: "fire-damper-access",
    discipline: "Fire Protection",
    keywords: ["fire damper access", "no access panel", "damper not accessible"],
    issue: "Fire damper installed without an accessible inspection/access panel",
    likelyCause: "Access panel omitted from the ceiling/wall finish at first-fix coordination, or repositioned during containment changes without follow-up.",
    recommendedFix: "Install a correctly-sized access panel directly below/adjacent to the damper per manufacturer requirements; confirm the damper can be reset and tested through it.",
    reference: "Manufacturer IOM; local fire code access requirements",
  },
  {
    id: "elv-cat6-cert-fail",
    discipline: "ELV/Data",
    keywords: ["cat6 certification fail", "data cable test fail", "cable certification fail"],
    issue: "Structured cabling (Cat 6) certification test failure",
    likelyCause: "Excessive untwist at termination, exceeded maximum permanent-link length, or a damaged/kinked cable run.",
    recommendedFix: "Re-terminate with untwist kept to the connector manufacturer's minimum; confirm run length against the 90m permanent-link limit; replace any visibly damaged cable section.",
    reference: "TIA/EIA-568; ISO/IEC 11801",
  },
];

// Deterministic fallback used when no GEMINI_API_KEY is configured (or the
// API call fails). Matches the free-text description against the keyword
// list above. Not as flexible as the AI path, but keeps the feature
// functional without an API key, consistent with the rest of the app.
export function suggestFixFallback(description: string, tradeHint?: string): {
  matched: boolean;
  pattern?: MepDefectPattern;
  message: string;
} {
  const text = (description || "").toLowerCase();
  const trade = (tradeHint || "").toLowerCase();

  let candidates = MEP_DEFECT_PATTERNS;
  if (trade) {
    const tradeFiltered = candidates.filter(p => p.discipline.toLowerCase().includes(trade) || trade.includes(p.discipline.toLowerCase()));
    if (tradeFiltered.length > 0) candidates = tradeFiltered;
  }

  for (const pattern of candidates) {
    if (pattern.keywords.some(kw => text.includes(kw))) {
      return {
        matched: true,
        pattern,
        message: `**Likely cause:** ${pattern.likelyCause}\n\n**Recommended fix:** ${pattern.recommendedFix}\n\n**Reference:** ${pattern.reference}`,
      };
    }
  }

  return {
    matched: false,
    message: "No specific match found in the built-in defect reference. Log the item with a clear description, photo, and location; a Site Engineer or QA/QC reviewer should assess root cause on site. Configure GEMINI_API_KEY for AI-assisted analysis of issues outside this reference set.",
  };
}
