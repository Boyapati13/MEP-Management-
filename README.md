# MEP Project Manager

A full-stack **Mechanical, Electrical & Plumbing (MEP) project management system** for construction and fit-out contractors. It covers the full delivery lifecycle of an MEP contract — schedule, RFIs, submittals, snagging, daily logs, BOQ/commercial control, procurement, safety, quality (NCRs), commissioning and handover — behind an 8-role permission system, with an embedded AI technical advisor for standards-based engineering guidance.

The application was originally scaffolded in Google AI Studio (see `metadata.json`) and is now a self-contained Node/Express + SQLite app that can be run and deployed independently.

## Contents

- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Architecture Notes](#architecture-notes)
- [Getting Started](#getting-started)
- [Demo / Seed Accounts](#demo--seed-accounts)
- [Roles & Permissions](#roles--permissions)
- [Data Model](#data-model)
- [API Overview](#api-overview)
- [AI Technical Advisor](#ai-technical-advisor)
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
| AI | Google Gemini via `@google/genai` |
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

This runs `tsx server.ts` directly (no build step needed) on **http://localhost:3000**. The SQLite database file `mep_pm.db` is created automatically on first run and seeded with demo projects and users (see below). It is git-ignored, so each environment gets its own local database.

### Build & run in production

```bash
npm run build   # vite build (client) + esbuild bundle of server.ts -> dist/server.cjs
NODE_ENV=production npm start
```

### Type-check

```bash
npm run lint   # tsc --noEmit
```

## Demo / Seed Accounts

On first startup, `seedUsers()` creates one demo account per role (password hashing uses `scrypt`; these are local development seed credentials, not production secrets — change or remove them before deploying anywhere reachable by real users):

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Admin |
| `pm_mep` | `pm123` | ProjectManager |
| `engineer` | `engineer123` | SiteEngineer |
| `qs_paul` | `qs123` | CommercialManager |
| `qa_maria` | `qa123` | QAQC |
| `safety_kurt` | `safety123` | SafetyOfficer |
| `sub` | `sub123` | Subcontractor (HVAC) |
| `sub_elec` | `elec123` | Subcontractor (Electrical) |
| `sub_plumb` | `plumb123` | Subcontractor (Plumbing) |
| `consultant_eng` | `consult123` | Consultant |

A demo project ("St. Julian's Tower – MEP Fitout") is seeded with sample tasks, RFIs, submittals and punch list items so the app is populated immediately after first run.

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

`projects`, `users`, `sessions`, `project_memberships`, `record_owners`, `audit_logs`, `tasks`, `task_status_history`, `dependencies`, `wbs_items`, `rfis`, `submittals`, `punchlist`, `dailylogs`, `documents`, `costs`, `boq_items`, `change_orders`, `purchase_orders`, `procurement_items`, `material_requests`, `safety_incidents`, `inspections`, `meeting_minutes`, `timesheets`, `equipment`, `risks`, `ncrs`, `commissioning_tests`, `handover_items`, `attendance`

Status-driven modules (`submittals`, `change_orders`, and others) enforce a formal workflow state machine defined in `WORKFLOW_STATUSES`, applied via `POST /api/:table/:id/transition`.

## API Overview

All endpoints below (except `/api/login` and `/api/health`) require `Authorization: Bearer <token>`.

**Auth & Users**
`POST /api/login` · `POST /api/logout` · `GET /api/me` · `GET /api/users` · `POST /api/users` · `PUT /api/users/:id` · `DELETE /api/users/:id` · `POST /api/users/:id/reset-password` · `POST /api/users/:id/toggle-status` · `GET /api/roles`

**Projects**
`GET /api/projects` · `POST /api/projects` · `PUT /api/projects/:id` · `DELETE /api/projects/:id` · `GET/PUT /api/projects/:id/members` · `GET /api/projects/:id/subcontractors` · `GET /api/users/:id/projects` · `PUT /api/users/:id/projects`

**Dashboards & Search**
`GET /api/dashboard` · `GET /api/portfolio` · `GET /api/operations/today` · `GET /api/search` · `GET /api/export/:table`

**Generic module CRUD** (one set of routes per table in `TABLE_CONFIG`)
`GET /api/:table` · `POST /api/:table` · `PUT /api/:table/:id` · `DELETE /api/:table/:id` · `POST /api/:table/:id/transition` (for modules with a defined workflow)

**Specialized workflows**
`POST /api/attendance/punch-in` / `punch-out` · `GET /api/tasks/:id/history` · `POST /api/dependencies/:id/complete` · `POST /api/boq/import` (file upload) · `POST /api/procurement_items/:id/create-po` · `GET /api/commissioning_tests/:id/readiness` · `GET /api/handover/:projectId/readiness` · `GET /api/drawings/:id` · `POST /api/drawings/:id/markups`

**AI**
`POST /api/ai/chat` · `POST /api/drawing/ask-ai`

**Ops**
`GET /api/health` · `GET /api/audit`

## AI Technical Advisor

`POST /api/ai/chat` and `POST /api/drawing/ask-ai` call Google Gemini (`@google/genai`) with the user's question plus an embedded block of MEP engineering reference knowledge (a real electrical/ELV tender specification — clauses, cable spacing tables, lighting schedules, testing sequences, etc.) so answers are grounded in that spec rather than generic advice. `drawing/ask-ai` additionally accepts a base64 drawing/photo (`image_data`) for multimodal questions about a specific sheet. If `GEMINI_API_KEY` is not configured, or the API call fails, both endpoints fall back to a structured generic engineering response so the UI never breaks.

## Testing

There is no integrated test runner (`npm test` is not defined). Instead, two standalone scripts exercise a **running server** end-to-end over HTTP:

```bash
# In one terminal
npm run dev

# In another terminal
npx tsx test_e2e_suite.ts     # ~38 assertions across auth, RBAC, and every core module
npx tsx test_bov_spec.ts      # ~22 assertions specifically verifying the BOV St. Venera (Job 2618)
                               # spec data, BOQ import and AI advisor responses
```

Both scripts print `✅ PASS` / `❌ FAIL` per assertion and exit non-zero on any failure, so they're suitable to wire into CI against a server started in a previous step.

## Project Structure

```
.
├── server.ts              # Express app: routes, RBAC, SQLite schema & seed data (~2.8k lines)
├── bov_schedule.ts         # Hardcoded MS Project-derived schedule for the BOV St. Venera tender
├── index.html              # The actual frontend application (vanilla JS SPA)
├── api-config.js            # Runtime API base URL override (window.MEP_API_URL)
├── src/                    # Unused Vite + React scaffold (App.tsx renders an empty div)
├── public/                 # Static assets
├── test_e2e_suite.ts       # Full-suite HTTP integration tests
├── test_bov_spec.ts        # BOV Job 2618 spec/BOQ/AI verification tests
├── vite.config.ts
├── tsconfig.json
└── .env.example
```

## Known Limitations & Hardening Notes

These are worth addressing before any production/internet-facing deployment:

- **Password hashing** uses `scrypt` with a single hardcoded salt (`mep_salt_secure`) shared by every user, rather than a unique per-user salt — this weakens the hashing scheme against precomputation attacks.
- **Seed credentials** (see [Demo / Seed Accounts](#demo--seed-accounts)) are created automatically on first run; disable `seedUsers()` or rotate/remove these accounts before real deployment.
- **Sessions** are stored indefinitely with no visible expiry/TTL sweep in the schema shown — consider adding session expiration.
- **File uploads** (`multer`, BOQ import, drawing attachments) should be checked for size/type limits and virus scanning if exposed beyond a trusted network.
- No CI configuration is currently checked in; the two test scripts above are good candidates to run on every push.
- No `LICENSE` file is currently present in the repo.

## License

No license file is currently included in this repository. Add a `LICENSE` file (e.g. MIT, Apache-2.0, or a proprietary notice) to clarify usage terms for anyone outside the project.
