# MEP Project Manager

A full-stack **Mechanical, Electrical & Plumbing (MEP) project management system** for construction and fit-out contractors. It covers the full delivery lifecycle of an MEP contract — schedule, RFIs, submittals, snagging, daily logs, BOQ/commercial control, procurement, safety, quality (NCRs), commissioning and handover — behind an 8-role permission system, with an embedded AI technical advisor for standards-based engineering guidance.

The application was originally scaffolded in Google AI Studio (see `metadata.json`) and is now a self-contained Node/Express + SQLite app that can be run and deployed independently.

## Contents

- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Architecture Notes](#architecture-notes)
- [Getting Started](#getting-started)
- [First Login](#first-login)
- [Roles & Permissions](#roles--permissions)
- [Data Model](#data-model)
- [API Overview](#api-overview)
- [AI Technical Advisor](#ai-technical-advisor)
- [Document Intelligence & Planner](#document-intelligence--planner)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Known Limitations & Hardening Notes](#known-limitations--hardening-notes)
- [License](#license)

## Key Features

**Project & Portfolio**
- Multi-project portfolio dashboard with live status, budget and progress roll-ups
- Work Breakdown Structure (WBS), task scheduling with progress, milestones and summary tasks, and task dependency tracking with impact analysis
- Project membership and subcontractor assignment per project

**Field Execution**
- Daily site logs (weather, crew, workers on site, delays, safety notes)
- Punch list / snagging with photo attachments and drawing-coordinate pinning (x/y % markers)
- Time & attendance with punch-in/punch-out (camera permission requested for site verification)
- Timesheets and equipment tracking

**Documents & Drawings**
- Drawing/document register with revision tracking
- On-drawing markup tooling (`pdf.js` for rendering PDFs, `jsPDF` for exporting marked-up sheets)
- AI-assisted Q&A directly against an uploaded drawing image

**Commercial**
- Bill of Quantities (BOQ) with tender vs. revised vs. installed vs. claimed vs. certified quantities
- Bulk BOQ import from spreadsheet/CSV uploads
- Change orders with a full commercial workflow (potential variation → technical/commercial review → approval → PO → execution → claim → certification → payment)
- Purchase orders, generated directly from procurement items
- Cost tracking (planned vs. actual by category)

**Quality & Safety**
- Non-Conformance Reports (NCRs) with root cause, corrective action and verification
- Inspections and witness testing
- Safety incident logging with severity and corrective actions
- Risk register with probability/impact scoring

**Procurement & Materials**
- Procurement item tracking from requisition through supplier selection, PO, delivery and inspection
- Material requests tied to BOQ and drawing references

**Commissioning & Handover**
- Commissioning test records with pre-requisite readiness checks (power, installation, controls, interface, drawings approved)
- Handover item tracking (O&M manuals, certificates, spares, training) with per-system/contractor readiness scoring

**Cross-cutting**
- Full audit log of every create/update/delete across modules
- Global search across projects and records
- CSV/table export for any data table
- Role-based dashboards ("Today's Operations" view)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Server-rendered `index.html` single-page app (vanilla JS + CSS), `pdf.js` and `jsPDF` for drawing tooling |
| Frontend scaffold (unused) | Vite 6 + React 19 + TypeScript + Tailwind 4 (`src/`) |
| Backend | Node.js + Express 4, single TypeScript file (`server.ts`), run directly via `tsx` in dev |
| Database | SQLite via Node's built-in `node:sqlite` module (`DatabaseSync`) — no native driver dependency |
| AI | Google Gemini via `@google/genai`, grounded by the shared `mep_brain.ts` reference-knowledge module |
| Document parsing | `pdf-parse` (PDF text extraction), `mammoth` (DOCX text extraction) |
| File uploads | `multer` |
| Build | Vite (client) + `esbuild` (server bundle to CJS) |

## Architecture Notes

This repo currently ships **two frontends**, and only one of them is live:

- **`index.html`** is the real application — a large, self-contained single-page app (login screen, all modules, drawing markup, AI chat) served directly by Express and talking to the `/api/*` endpoints below.
- **`src/App.tsx`** is the default Vite + React scaffold from the original AI Studio template. It currently renders an empty `<div>` and is not wired into the running app. Keep this in mind before assuming UI changes belong in `src/` — today they belong in `index.html`.

In development, Express mounts Vite's dev middleware (`vite.middlewares`) in SPA mode. In production (`NODE_ENV=production`), it serves the built `dist/` folder and falls back to `dist/index.html` for any unmatched route (client-side routing friendly).

Authentication is a simple **bearer-token session** model: `POST /api/login` issues a token stored in a `sessions` table; subsequent requests send `Authorization: Bearer <token>`, verified by `authRequired` middleware. Authorization is then enforced per-module via a role → `{view, edit, delete}` permission map (`ROLE_PERMS`), plus per-project membership checks (`hasProjectAccess`) and, for a few modules, per-record ownership checks (`record_owners`).

## Getting Started

### Prerequisites

- Node.js **22+** (the app uses the built-in `node:sqlite` module — no separate SQLite package to install)
- npm (or `bun`, since a `bun.lock` is present — either works)

### Installation

```bash
git clone https://github.com/Boyapati13/MEP-Management-.git
cd MEP-Management-
npm install
```

### Environment variables

Copy the example file and fill in your own values:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Optional | Enables the AI Technical Advisor and drawing Q&A (`/api/ai/chat`, `/api/drawing/ask-ai`). Without it, those endpoints fall back to a generic canned engineering response instead of failing. |
| `APP_URL` | Optional | Self-referential URL for the deployed app; used for links/callbacks. Not required for local development. |

### Run in development

```bash
npm run dev
```

This runs `tsx server.ts` directly (no build step needed) on **http://localhost:3000**. The SQLite database file `mep_pm.db` is created automatically on first run. It is git-ignored, so each environment gets its own local database. A fresh database starts **completely empty** — no demo projects, no sample tasks — except for a single bootstrap administrator account (see below).

### Build & run in production

```bash
npm run build   # vite build (client) + esbuild bundle of server.ts -> dist/server.cjs
NODE_ENV=production npm start
```

### Type-check

```bash
npm run lint   # tsc --noEmit
```

## First Login

On first startup, `seedUsers()` creates exactly **one** account — there is no demo company, no sample project, and no other pre-created users:

| Username | Password | Role |
|---|---|---|
| `admin` | `ChangeMe123!` | Admin |

**You'll be prompted to set a new password immediately after first login** - the account is flagged to force this, and the UI blocks access to the rest of the app until you do. From this one account you create real projects and invite real users through the UI (Admin → Personnel Directory → Add Enterprise User) or via `POST /api/users`.

## Roles & Permissions

| Role | Focus |
|---|---|
| **Admin** | Enterprise-wide administration: users, roles, security audit, full database access |
| **ProjectManager** | Overall delivery leadership: schedule, submittals, budgets, change orders, procurement, commercial closeout |
| **SiteEngineer** | Field coordination: inspections, punch lists, drawing markups, RFIs, daily logs, attendance, equipment |
| **CommercialManager** | BOQ, valuations, change orders, purchase orders, cost variance |
| **QAQC** | Inspections, NCRs, witness testing, handover packages |
| **SafetyOfficer** | Incident investigation, risk mitigation, safety audits, attendance monitoring |
| **Subcontractor** | Trade-scoped punch snags, daily logs, material requests, timesheets |
| **Consultant** | Technical review of RFIs/submittals, inspection sign-off, compliance auditing |

Exact per-module view/edit/delete permissions per role live in `ROLE_PERMS` in `server.ts`.

## Data Model

All modules are backed by SQLite tables, most exposed through a generic CRUD layer keyed off a central `TABLE_CONFIG` map:

`projects`, `users`, `sessions`, `project_memberships`, `record_owners`, `audit_logs`, `tasks`, `task_status_history`, `dependencies`, `wbs_items`, `rfis`, `submittals`, `punchlist`, `dailylogs`, `documents`, `costs`, `boq_items`, `change_orders`, `purchase_orders`, `procurement_items`, `material_requests`, `safety_incidents`, `inspections`, `meeting_minutes`, `timesheets`, `equipment`, `risks`, `ncrs`, `commissioning_tests`, `handover_items`, `attendance`, `plan_buckets`, `plan_tasks`, `plan_task_checklist`

Status-driven modules (`submittals`, `change_orders`, and others) enforce a formal workflow state machine defined in `WORKFLOW_STATUSES`, applied via `POST /api/:table/:id/transition`.

Two `TABLE_CONFIG` keys (`drawings`, `daily_logs`) are intentional URL aliases for a different real table (`documents`, `dailylogs`) rather than tables of their own — every generic route resolves the alias internally, and any code that iterates `TABLE_CONFIG` keys directly (e.g. the project-delete cascade) must resolve and de-duplicate them first, or it will try to query a table that doesn't exist.

## API Overview

All endpoints below (except `/api/login` and `/api/health`) require `Authorization: Bearer <token>`.

**Auth & Users**
`POST /api/login` · `POST /api/logout` · `GET /api/me` · `PUT /api/me/password` · `GET /api/users` · `POST /api/users` · `PUT /api/users/:id` · `DELETE /api/users/:id` · `POST /api/users/:id/reset-password` · `POST /api/users/:id/toggle-status` · `GET /api/roles`

**Projects**
`GET /api/projects` · `POST /api/projects` · `PUT /api/projects/:id` · `DELETE /api/projects/:id` · `GET/PUT /api/projects/:id/members` · `GET /api/projects/:id/subcontractors` · `GET /api/users/:id/projects` · `PUT /api/users/:id/projects`

**Dashboards & Search**
`GET /api/dashboard` · `GET /api/portfolio` · `GET /api/operations/today` · `GET /api/search` · `GET /api/export/:table`

**Generic module CRUD** (one set of routes per table in `TABLE_CONFIG`, including `plan_buckets` / `plan_tasks` / `plan_task_checklist` - see [Document Intelligence & Planner](#document-intelligence--planner) below)
`GET /api/:table` · `POST /api/:table` · `PUT /api/:table/:id` · `DELETE /api/:table/:id` · `POST /api/:table/:id/transition` (for modules with a defined workflow)

**Specialized workflows**
`POST /api/attendance/punch-in` / `punch-out` · `GET /api/tasks/:id/history` · `POST /api/dependencies/:id/complete` · `POST /api/boq/import` (file upload) · `POST /api/procurement_items/:id/create-po` · `GET /api/commissioning_tests/:id/readiness` · `GET /api/handover/:projectId/readiness` · `GET /api/drawings/:id` · `POST /api/drawings/:id/markups` · `POST /api/documents/:id/analyze` · `GET /api/projects/:id/planner`

**AI**
`POST /api/ai/chat` · `POST /api/drawing/ask-ai` · `POST /api/ai/suggest-fix`

**Ops**
`GET /api/health` · `GET /api/audit`

## AI Technical Advisor

`POST /api/ai/chat` and `POST /api/drawing/ask-ai` call Google Gemini (`@google/genai`) with the user's question plus `mep_brain.ts`'s general MEP/electrical engineering reference knowledge (BS 7671 test sequences, cable containment spacing tables, HVAC/electrical separation rules, plumbing/fire-protection/UPS guidance) so answers are grounded in real standards rather than pure model recall — without being tied to any specific project, tender, or client. `drawing/ask-ai` additionally accepts a base64 drawing/photo (`image_data`) for multimodal questions about a specific sheet. If `GEMINI_API_KEY` is not configured, or the API call fails, both endpoints fall back to a structured generic engineering response so the UI never breaks.

## Document Intelligence & Planner

`mep_brain.ts` is the single shared module grounding three AI-assisted features in the same reference knowledge, rather than each duplicating its own copy:

1. **`POST /api/ai/suggest-fix`** — describe a defect (from a punch list item, an NCR, or free text) and get back a likely cause, a recommended fix, and a reference standard. Wired into the Punch List "🧠 Suggest Fix" button in the UI. Grounded in `MEP_DEFECT_PATTERNS`, a table of ~12 concrete defect→cause→fix patterns across Electrical, HVAC, Plumbing, Fire Protection and ELV/Data. Without `GEMINI_API_KEY`, falls back to deterministic keyword matching against that same table (`suggestFixFallback`) - less flexible with novel phrasing, but still functional.

2. **`POST /api/documents/:id/analyze`** — reads an uploaded document and turns it into a Microsoft-Planner-style board: **Buckets** (grouped by trade/discipline or document section) → **Tasks** (one per discrete scope item, with title, description, trade, priority, and a due date *only* if one is explicitly stated in the source - never invented) → **Checklist** (sub-steps, where the text implies them). Every generated task keeps a `source_excerpt` pointing back to the exact text it came from, so nothing is a black box. Reachable from the Documents view via the "🧠 Analyze" button on any uploaded file.

   - **Text extraction** by file type: PDF via `pdf-parse` (note: v2's class-based `PDFParse` API, not the older v1 function export), DOCX via `mammoth`, CSV/TXT read directly, images passed straight to Gemini multimodal.
   - **AI structuring**: the extracted text (or image) is sent to Gemini with a strict JSON-only prompt built from `MEP_REFERENCE_KNOWLEDGE`.
   - **Fallback without AI** (no `GEMINI_API_KEY`, the call fails, or the response isn't valid JSON): one bucket ("Imported Items"), one task per CSV row or per line/paragraph of extracted text. This is deliberately simple - it does not attempt sentence-boundary detection, so a PDF whose text wraps mid-sentence can split a single requirement across two tasks. The AI path does not have this limitation.

3. **`GET /api/projects/:id/planner`** — one call returns the whole board (buckets, with nested tasks, with nested checklist) in display order, for the Planner view's Kanban-style UI. Moving a task between buckets, changing its status, and toggling checklist items all go through the generic CRUD `PUT /api/plan_tasks/:id` and `PUT /api/plan_task_checklist/:id` routes rather than bespoke endpoints.

## Testing

There is no integrated test runner (`npm test` is not defined). Instead, a standalone script exercises a **running server** end-to-end over HTTP:

```bash
# In one terminal
npm run dev

# In another terminal
npx tsx test_e2e_suite.ts
```

The suite is **fully self-seeding**: it logs in as the bootstrap `admin` account, creates its own temporary test project(s) and one temporary user per role via the real API, runs 64 assertions covering auth, RBAC, project-scoping/isolation, schedule, drawings/markups, RFIs, submittals, punch list, BOQ, change orders, purchase orders, daily logs, safety, NCRs, commissioning, handover, the AI advisor, the audit trail, MEP-brain fix suggestions, the document-to-Planner pipeline, and notifications — then deletes everything it created. It does not depend on any server-side demo data, so it works against a genuinely fresh install.

It prints `[PASS]` / `[FAIL]` per assertion and exits non-zero on any failure, so it's suitable to wire into CI against a server started in a previous step.

**Verified (fresh clone, this environment, Node 22.22.2):** `npm install` → `tsc --noEmit` → `npm run build` → boot against a brand-new database → all 64 assertions passing with a completely clean server log (no errors, no unhandled exceptions) → repeated to confirm idempotency. `npm audit` reports 0 vulnerabilities. The document-analyze and suggest-fix tests, and the AI advisor test, only exercise the built-in fallback responses, since no `GEMINI_API_KEY` was configured in this environment — the live Gemini paths (including document structuring quality) are untested here. The PDF and DOCX extraction paths were separately verified against real generated files outside the test suite (see commit history).

⚠️ Prior to this update, the app **crashed on every fresh-database boot** and had no way to log in without hardcoded demo credentials embedded directly in the login page. Both are now fixed — see [Known Limitations](#known-limitations--hardening-notes) for the full list of what changed.

## Project Structure

```
.
├── server.ts              # Express app: routes, RBAC, SQLite schema & bootstrap admin account (~2.6k lines)
├── mep_brain.ts            # Shared MEP reference knowledge + defect/fix patterns (AI advisor, suggest-fix, document analyze)
├── index.html              # The actual frontend application (vanilla JS SPA)
├── api-config.js            # Runtime API base URL override (window.MEP_API_URL)
├── src/                    # Unused Vite + React scaffold (App.tsx renders an empty div)
├── public/                 # Static assets
├── test_e2e_suite.ts       # Self-seeding full-suite HTTP integration tests (64 assertions)
├── vite.config.ts
├── tsconfig.json
└── .env.example
```

## Known Limitations & Hardening Notes

These are worth addressing before any production/internet-facing deployment. Earlier rounds of fixes (the fresh-install crash, cascading-delete bugs, demo-data removal, the `qs` vulnerability, and more) are summarized in commit history rather than repeated here as this section was getting long — see `git log`.

**Still open:**
- **No MFA/SSO.** Authentication is username + password only.
- **`plan_tasks.assigned_to`** exists in the schema and generic CRUD, and now triggers an in-app notification when set - but the Planner UI still doesn't expose a way to pick an assignee from the task detail modal; it can only be set via a direct API call.
- **File uploads** (`multer`, BOQ import, drawing attachments) should be checked for size/type limits and virus scanning if exposed beyond a trusted network.
- **Notifications are in-app only** - no email/push/SMS layer. The `createNotification()` helper is a natural place to add an email send (e.g. via `nodemailer`) behind an `SMTP_*` env var check, following the same "works without it, better with it" pattern as `GEMINI_API_KEY` - not built yet.
- **Notification bell dropdown uses fixed positioning** near the top-left rather than anchoring precisely under the bell icon - functional, not pixel-perfect.
- **Single SQLite file** for the whole database, and file attachments are stored as base64 inside it rather than in separate object storage. Fine for one team's internal use; won't hold up as a scaled, multi-tenant product.
- `vite` is listed in both `dependencies` and `devDependencies` in `package.json` — harmless (it resolves to one copy either way) but redundant; worth picking one.
- No CI configuration is currently checked in; `test_e2e_suite.ts` is a good candidate to run on every push.
- No `LICENSE` file is currently present in the repo.

**Fixed this round (security hardening):**
- Password hashing now uses a unique random salt per user (`scrypt`), instead of one salt shared by every account - verified backward-compatible with any hash created before this change.
- Sessions now expire 12 hours after login and are rejected (and deleted) by `authRequired` once expired, instead of lasting forever.
- Login now rate-limits: 5 failed attempts for a username triggers a 60-second lockout (`429`), as basic brute-force protection.
- The bootstrap `admin` account is flagged `must_change_password`; the login response and `GET /api/me` surface it, and the frontend now blocks access behind a mandatory password-change screen until `PUT /api/me/password` succeeds. There's also a new self-service password change endpoint for any user (`PUT /api/me/password`, requires the current password) - previously password changes could only be done by an Admin resetting someone else's password.
- The UI's ~75 decorative pictograph emoji (used as ad-hoc icons throughout nav, buttons, and role badges) were removed in favor of plain text labels and a small set of neutral typographic symbols (✕ ✓ ✎ → ☰), for a more professional look. A proper SVG icon set would be the next step beyond this pass.

**Added this round (feature parity with generic PM tools):**
- **Real drag-and-drop** on the Planner board - dragging a task card to a different bucket column calls `PUT /api/plan_tasks/:id` to move it, instead of only being possible through a dropdown in the detail modal.
- **In-app notifications.** New `notifications` table plus a generic hook in the shared `PUT /api/:table/:id` handler: whenever a record's status changes to something "decision-worthy" (Approved, Rejected, Answered, Completed, Closed, Rectified, Certified), the record's creator (looked up via the existing `record_owners` table - no new per-table columns needed) gets a notification, unless they made the change themselves. Also fires when a record's `assigned_to` changes. Surfaced via a bell icon with an unread-count badge, polling every 45 seconds, plus `GET /api/notifications`, `PUT /api/notifications/:id/read`, and `PUT /api/notifications/read-all`.

## License

No license file is currently included in this repository. Add a `LICENSE` file (e.g. MIT, Apache-2.0, or a proprietary notice) to clarify usage terms for anyone outside the project.
