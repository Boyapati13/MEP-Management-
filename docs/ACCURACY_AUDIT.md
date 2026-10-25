# MEP FieldHub — Accuracy audit and release gates

Status: Initial source-code audit; runtime and end-to-end testing pending.

## Non-negotiable rules
- Unknown quantities, costs, dates, engineering values and progress stay unknown; never substitute fabricated defaults.
- Retain source document, revision, sheet/page/row, extraction confidence and approval state.
- BOQ, drawings, work packages, tasks, procurement, inspections and commercial certification use stable record IDs.
- AI-generated data is a draft proposal, never an approved engineering or commercial fact.
- Every KPI has one documented source and calculation.
- Role/project/package/publication access is enforced by the API.

## Source-code findings
| Priority | Finding | Source |
|---|---|---|
| P0 | Preview substitutes synthetic 500000 budget when extraction is empty; fixed in this branch | server/controllers/aiDrawingController.ts |
| P0 | BOQ import coerces invalid quantity to 1; separate draft PR #29 | server/controllers/aiDrawingController.ts |
| P0 | Project intelligence uses synthetic budgets, dates, and estimated trade BOQ lines | server/services/contractorDocIntelligence.ts |
| P0 | BOQ-generated tasks are system-level, use arbitrary dates and title-only duplicate checks | server/controllers/aiDrawingController.ts |
| P1 | React and legacy schedule screens have different BOQ-task features | src/components/TasksBoardPage.tsx; frontend/views/schedule.js |
| P1 | Progress average and silent catch can hide invalid metrics | server/controllers/crudController.ts |
| P1 | Portal and internal navigation hide overflow; separate draft PR #28 | src/layouts/ |

## Required tests before release
1. Known-good BOQ fixtures: CSV, multi-sheet XLSX, text PDF, scanned PDF; assert exact item codes, units, quantities, rates and totals.
2. Document and drawing revision tests; reject unsupported/scanned extraction without explicit processing.
3. BOQ approval → WBS → tasks → procurement → site → inspection → certification integration, with source IDs.
4. Duplicate import and repeated generation tests (idempotency); project and location separation.
5. Project budget, task dates, workforce, progress, risk and KPI reconciliation.
6. Cross-project, cross-package and unpublished-client-document negative access tests.
7. Run npm run lint, npm run build, npm run test:all, npm run test:dataflow and browser role/responsive tests.

## Implementation order
- Remove fabricated values from extraction and project creation.
- Add extraction staging, row-level diagnostics and human approval before downstream writes.
- Consolidate task generation into one reviewed BOQ/drawing source-linked workflow.
- Audit all features, components, routes, API endpoints and table ownership for duplicates/unreachable paths.
- Reconcile all metrics and complete security/CI tests.

No production-readiness claim is made by this document. Draft PR #28 and #29 remain separate and unmerged.
