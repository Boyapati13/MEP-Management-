import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import { MEP_REFERENCE_KNOWLEDGE, MEP_DEFECT_PATTERNS, suggestFixFallback } from "./mep_brain";
import { PDFParse } from "pdf-parse";
import * as mammoth from "mammoth";

interface AuthenticatedUser {
  user_id: string;
  name: string;
  role: "Admin" | "ProjectManager" | "SiteEngineer" | "CommercialManager" | "SafetyOfficer" | "QAQC" | "Subcontractor" | "Consultant" | string;
  email?: string;
  company?: string;
  trade?: string;
  specialization?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const PORT = 3000;
const DB_PATH = path.join(process.cwd(), "mep_pm.db");
const db = new DatabaseSync(DB_PATH);

// Helper for row mapping
function rowToDict(row: any): Record<string, any> | null {
  if (!row) return null;
  return { ...row };
}

function normaliseHeader(val: any): string {
  return String(val || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Extracts plain text (or, for images, a data-URL suitable for a multimodal
// Gemini call) from a document's stored attachment_data (a data: URL, as
// produced by the frontend's FileReader.readAsDataURL). Used by the
// document -> Planner ingestion pipeline.
async function extractDocumentText(attachmentData: string, attachmentName: string): Promise<
  | { kind: "text"; text: string }
  | { kind: "image"; mimeType: string; base64: string }
  | { kind: "unsupported"; reason: string }
> {
  const match = String(attachmentData || "").match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    return { kind: "unsupported", reason: "No readable file content on this document." };
  }
  const mimeType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");
  const nameLower = String(attachmentName || "").toLowerCase();

  try {
    if (mimeType.startsWith("image/")) {
      return { kind: "image", mimeType, base64 };
    }
    if (mimeType === "application/pdf" || nameLower.endsWith(".pdf")) {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return { kind: "text", text: result.text || "" };
    }
    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      nameLower.endsWith(".docx")
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return { kind: "text", text: result.value || "" };
    }
    if (mimeType.startsWith("text/") || nameLower.endsWith(".csv") || nameLower.endsWith(".txt") || nameLower.endsWith(".tsv")) {
      return { kind: "text", text: buffer.toString("utf8") };
    }
    // Best-effort: try utf8 text; reject if it looks binary (many replacement/control chars).
    const asText = buffer.toString("utf8");
    const controlCharRatio = (asText.match(/[\x00-\x08\x0E-\x1F\uFFFD]/g) || []).length / Math.max(asText.length, 1);
    if (controlCharRatio < 0.01 && asText.trim().length > 0) {
      return { kind: "text", text: asText };
    }
    return { kind: "unsupported", reason: `Unsupported file type for analysis: ${mimeType || "unknown"}. Supported: PDF, DOCX, CSV, TXT, and images.` };
  } catch (e: any) {
    return { kind: "unsupported", reason: `Could not read file content: ${e?.message || "unknown error"}` };
  }
}

function parseImportNumber(val: any): number {
  if (val === null || val === undefined || val === "") return 0.0;
  const num = parseFloat(String(val).replace(/[,€$£]/g, "").trim());
  return isNaN(num) ? 0.0 : num;
}

function hashPassword(password: string): string {
  // Per-user random salt, stored alongside the hash as "salt:hash". Verifying
  // against the legacy fixed-salt format (below) is preserved for any
  // accounts created before this fix, so existing users aren't locked out.
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash === password) return true;
  try {
    if (storedHash.includes(":")) {
      const [salt, hash] = storedHash.split(":");
      const check = crypto.scryptSync(password, salt, 32).toString("hex");
      return check === hash;
    }
    // Legacy fixed-salt format, from before per-user salts were added.
    const legacyHash = crypto.scryptSync(password, "mep_salt_secure", 32).toString("hex");
    return legacyHash === storedHash;
  } catch {
    return false;
  }
}

// In-memory login rate limiting: after 5 failed attempts for a username,
// require a 60-second cooldown before further attempts are accepted. Resets
// on server restart - acceptable for this app's scale; a production
// multi-instance deployment would move this to a shared store.
const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 60 * 1000;
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 hours

function checkLoginRateLimit(username: string): { allowed: boolean; retryAfterSeconds?: number } {
  const entry = loginAttempts.get(username);
  if (!entry) return { allowed: true };
  if (entry.lockedUntil > Date.now()) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
  }
  return { allowed: true };
}

function recordLoginFailure(username: string) {
  const entry = loginAttempts.get(username) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
    entry.count = 0;
  }
  loginAttempts.set(username, entry);
}

function clearLoginFailures(username: string) {
  loginAttempts.delete(username);
}


const ROLE_DEFINITIONS = [
  {
    role: "Admin",
    title: "Executive System Administrator",
    category: "Executive & Governance",
    badgeColor: "#9333ea",
    description: "Highest level administration authority: enterprise user & role management, security audit oversight, multi-project governance, and full database access.",
    scope: "Enterprise-wide (All Projects)",
  },
  {
    role: "ProjectManager",
    title: "MEP Project Manager",
    category: "Project Leadership",
    badgeColor: "#2563eb",
    description: "Overall MEP project delivery leadership: programme schedule, variation claims, submittals, budgets, change orders, procurement, and commercial closeout.",
    scope: "Assigned Projects or Enterprise",
  },
  {
    role: "SiteEngineer",
    title: "MEP Site Engineer",
    category: "Site Operations",
    badgeColor: "#0284c7",
    description: "Field installation coordination: site inspections, snagging punch lists, drawing markups, RFI raising, daily logs, attendance, and equipment tracking.",
    scope: "Assigned Projects",
  },
  {
    role: "CommercialManager",
    title: "Quantity Surveyor / Commercial Lead",
    category: "Commercial & Finance",
    badgeColor: "#d97706",
    description: "Financial & contract engineering: BOQ management, progress valuations, change orders, vendor purchase orders, and cost variance control.",
    scope: "Assigned Projects",
  },
  {
    role: "QAQC",
    title: "QA/QC & Commissioning Lead",
    category: "Quality & Assurance",
    badgeColor: "#059669",
    description: "Quality assurance & system commissioning: site inspections, NCR non-conformance tracking, witness testing, and statutory handover packages.",
    scope: "Assigned Projects",
  },
  {
    role: "SafetyOfficer",
    title: "Site HSE & Safety Manager",
    category: "Health & Safety",
    badgeColor: "#dc2626",
    description: "Health & Safety governance: incident investigations, risk hazard mitigation, safety audits, inductions, PPE compliance, and attendance monitoring.",
    scope: "Assigned Projects",
  },
  {
    role: "Subcontractor",
    title: "Specialist Trade Subcontractor",
    category: "Trade Contractors",
    badgeColor: "#ea580c",
    description: "Specialized trade delivery (HVAC, Electrical, Plumbing, Fire): trade punch snags, daily logs, material requests, and timesheet logging.",
    scope: "Assigned Project & Trade Isolations",
  },
  {
    role: "Consultant",
    title: "Supervising Consultant / Client Rep",
    category: "Consultants & Clients",
    badgeColor: "#7c3aed",
    description: "Consultant review & technical approval: technical reviews of RFIs, submittals, inspection witness sign-offs, and compliance auditing.",
    scope: "Assigned Projects",
  },
];

const ROLE_PERMS: Record<string, { view: string[]; edit: string[]; delete: boolean }> = {
  Admin: {
    view: [
      "dashboard", "tasks", "planner", "rfis", "submittals", "punchlist",
      "costs", "budget", "dailylogs", "documents", "report", "projects", "gantt",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "procurement", "material_requests", "risks", "ncrs",
      "commissioning", "handover", "wbs", "audit", "users", "site_today", "calendar", "attendance"
    ],
    edit: [
      "tasks", "planner", "rfis", "submittals", "punchlist", "costs", "budget",
      "dailylogs", "documents", "projects",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "procurement", "material_requests", "risks", "ncrs",
      "commissioning", "handover", "wbs", "attendance"
    ],
    delete: true,
  },
  ProjectManager: {
    view: [
      "dashboard", "tasks", "planner", "rfis", "submittals", "punchlist",
      "costs", "budget", "dailylogs", "documents", "report", "projects", "gantt",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "procurement", "material_requests", "risks", "ncrs",
      "commissioning", "handover", "wbs", "audit", "site_today", "calendar", "attendance"
    ],
    edit: [
      "tasks", "planner", "rfis", "submittals", "punchlist", "costs", "budget",
      "dailylogs", "documents", "projects",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "procurement", "material_requests", "risks", "ncrs",
      "commissioning", "handover", "wbs", "attendance"
    ],
    delete: true,
  },
  SiteEngineer: {
    view: [
      "dashboard", "tasks", "planner", "rfis", "submittals", "punchlist",
      "costs", "budget", "dailylogs", "documents", "report", "gantt",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "material_requests", "ncrs", "commissioning",
      "wbs", "site_today", "calendar", "attendance"
    ],
    edit: [
      "tasks", "planner", "rfis", "submittals", "punchlist", "dailylogs", "documents",
      "change_orders", "safety_incidents", "inspections",
      "meeting_minutes", "timesheets", "equipment", "material_requests",
      "commissioning", "attendance"
    ],
    delete: false,
  },
  CommercialManager: {
    view: [
      "dashboard", "costs", "budget", "change_orders", "purchase_orders",
      "procurement", "material_requests", "dependencies", "risks",
      "handover", "documents", "projects", "gantt", "wbs", "tasks", "planner", "submittals"
    ],
    edit: [
      "costs", "budget", "change_orders", "purchase_orders",
      "procurement", "material_requests", "risks", "handover", "documents"
    ],
    delete: false,
  },
  QAQC: {
    view: [
      "dashboard", "punchlist", "inspections", "ncrs", "commissioning",
      "handover", "submittals", "rfis", "dailylogs", "documents",
      "site_today", "equipment", "tasks", "planner"
    ],
    edit: [
      "punchlist", "inspections", "ncrs", "commissioning",
      "handover", "documents"
    ],
    delete: false,
  },
  SafetyOfficer: {
    view: [
      "dashboard", "safety_incidents", "risks", "inspections",
      "dailylogs", "timesheets", "attendance", "site_today",
      "documents", "equipment", "tasks", "planner"
    ],
    edit: [
      "safety_incidents", "risks", "inspections", "dailylogs",
      "attendance", "documents"
    ],
    delete: false,
  },
  Subcontractor: {
    view: [
      "dashboard", "tasks", "planner", "submittals", "punchlist", "dailylogs", "documents",
      "safety_incidents", "timesheets", "equipment", "dependencies",
      "material_requests", "site_today", "calendar", "attendance"
    ],
    edit: [
      "tasks", "planner", "submittals", "punchlist", "dailylogs", "documents", "safety_incidents",
      "timesheets", "dependencies", "material_requests", "attendance"
    ],
    delete: false,
  },
  Consultant: {
    view: [
      "dashboard", "tasks", "planner", "gantt", "rfis", "submittals", "punchlist",
      "costs", "change_orders", "inspections", "meeting_minutes", "ncrs",
      "commissioning", "handover", "documents", "site_today", "calendar"
    ],
    edit: [
      "rfis", "submittals", "inspections", "commissioning", "handover"
    ],
    delete: false,
  },
};

const TABLE_CONFIG: Record<string, { cols: string[]; module: string }> = {
  tasks: {
    cols: ["id", "project_id", "title", "trade", "assignee", "start", "end", "progress", "status", "wbs_code", "duration", "is_summary", "is_milestone"],
    module: "tasks",
  },
  rfis: {
    cols: ["id", "project_id", "number", "subject", "trade", "raised_by", "date_raised", "due_date", "status"],
    module: "rfis",
  },
  submittals: {
    cols: ["id", "project_id", "number", "item", "title", "trade", "subcontractor", "spec_section", "date_submitted", "due_date", "status"],
    module: "submittals",
  },
  punchlist: {
    cols: ["id", "project_id", "item", "description", "trade", "contractor", "location", "floor", "priority", "date_raised", "status", "attachment_data", "x_percent", "y_percent"],
    module: "punchlist",
  },
  dailylogs: {
    cols: ["id", "project_id", "date", "log_date", "trade", "weather", "crew", "workers_count", "notes", "work_performed", "delays", "safety_incidents"],
    module: "dailylogs",
  },
  daily_logs: {
    cols: ["id", "project_id", "date", "log_date", "trade", "weather", "crew", "workers_count", "notes", "work_performed", "delays", "safety_incidents"],
    module: "dailylogs",
  },
  documents: {
    cols: ["id", "project_id", "name", "category", "revision", "date_added", "attachment_name", "attachment_data", "subcontractor_id", "uploaded_by", "markup_data"],
    module: "documents",
  },
  drawings: {
    cols: ["id", "project_id", "name", "category", "revision", "date_added", "attachment_name", "attachment_data", "subcontractor_id", "uploaded_by", "markup_data"],
    module: "documents",
  },
  costs: {
    cols: ["id", "project_id", "category", "description", "planned", "actual", "date_logged"],
    module: "costs",
  },
  boq_items: {
    cols: [
      "id", "project_id", "item_number", "description", "unit", "tender_quantity", "tender_rate",
      "tender_amount", "revised_quantity", "installed_quantity", "claimed_quantity", "certified_quantity",
      "discipline", "system", "building", "floor", "area", "source_document_id", "imported_at"
    ],
    module: "budget",
  },
  change_orders: {
    cols: ["id", "project_id", "number", "title", "trade", "reason", "cost_impact", "schedule_impact_days", "date_raised", "status"],
    module: "change_orders",
  },
  purchase_orders: {
    cols: ["id", "project_id", "po_number", "vendor", "trade", "description", "amount", "order_date", "expected_delivery", "status"],
    module: "purchase_orders",
  },
  safety_incidents: {
    cols: ["id", "project_id", "date", "trade", "incident_type", "severity", "description", "corrective_action", "status"],
    module: "safety_incidents",
  },
  inspections: {
    cols: ["id", "project_id", "date", "trade", "inspection_type", "inspector", "result", "notes"],
    module: "inspections",
  },
  meeting_minutes: {
    cols: ["id", "project_id", "date", "meeting_type", "attendees", "subject", "notes"],
    module: "meeting_minutes",
  },
  timesheets: {
    cols: ["id", "project_id", "date", "worker", "trade", "task", "hours"],
    module: "timesheets",
  },
  equipment: {
    cols: ["id", "project_id", "name", "type", "assigned_to", "status", "notes"],
    module: "equipment",
  },
  wbs_items: {
    cols: ["id", "project_id", "parent_id", "code", "name", "level", "discipline", "system", "active"],
    module: "wbs",
  },
  dependencies: {
    cols: [
      "id", "project_id", "task_id", "task_owner", "dependent_party", "description",
      "dependency_owner", "required_date", "completed_date", "status", "impact_if_late",
      "programme_impact", "commercial_impact", "next_action"
    ],
    module: "dependencies",
  },
  procurement_items: {
    cols: [
      "id", "project_id", "pr_number", "material", "specification", "boq_reference",
      "drawing_reference", "quantity", "unit", "required_on_site", "responsible_buyer",
      "selected_supplier", "po_number", "po_date", "expected_delivery", "actual_delivery",
      "delivered_quantity", "outstanding_quantity", "inspection_status", "storage_location", "status"
    ],
    module: "procurement",
  },
  material_requests: {
    cols: [
      "id", "project_id", "location", "discipline", "system", "material", "description",
      "quantity", "unit", "required_date", "reason", "drawing", "boq_reference", "requested_by", "status"
    ],
    module: "material_requests",
  },
  risks: {
    cols: ["id", "project_id", "title", "category", "probability", "impact", "risk_score", "owner", "mitigation", "target_date", "status"],
    module: "risks",
  },
  ncrs: {
    cols: [
      "id", "project_id", "number", "location", "description", "raised_against", "raised_date",
      "responsible_party", "root_cause", "corrective_action", "target_date", "verification",
      "closure_date", "status"
    ],
    module: "ncrs",
  },
  commissioning_tests: {
    cols: [
      "id", "project_id", "system", "subsystem", "equipment", "test_type", "power_available",
      "installation_complete", "controls_complete", "interface_complete", "drawings_approved",
      "test_date", "test_engineer", "witness", "result", "failure_reason", "retest_date",
      "certificate", "status", "comments"
    ],
    module: "commissioning",
  },
  handover_items: {
    cols: [
      "id", "project_id", "contractor", "system", "item_type", "description", "required",
      "submitted", "approved", "due_date", "status", "notes"
    ],
    module: "handover",
  },
  plan_buckets: {
    cols: ["id", "project_id", "source_document_id", "name", "order_index", "created_at"],
    module: "planner",
  },
  plan_tasks: {
    cols: [
      "id", "project_id", "bucket_id", "title", "description", "trade", "priority", "status",
      "due_date", "assigned_to", "source_document_id", "source_excerpt", "order_index", "created_at"
    ],
    module: "planner",
  },
  plan_task_checklist: {
    cols: ["id", "project_id", "task_id", "label", "is_checked", "order_index"],
    module: "planner",
  },
};

const WORKFLOW_STATUSES: Record<string, Record<string, string[]>> = {
  submittals: {
    Draft: ["Submitted"],
    Submitted: ["Under Review"],
    "Under Review": ["Approved", "Approved With Comments", "Revise and Resubmit", "Rejected"],
    Approved: ["Closed"],
    "Approved With Comments": ["Closed"],
    "Revise and Resubmit": ["Submitted"],
    Rejected: ["Draft"],
  },
  change_orders: {
    "Potential Variation": ["Under Preparation", "Rejected"],
    "Under Preparation": ["Submitted"],
    Submitted: ["Technical Review", "Rejected"],
    "Technical Review": ["Commercial Review", "Rejected"],
    "Commercial Review": ["Approved", "Partially Approved", "Rejected"],
    Approved: ["PO Pending", "Work In Progress"],
    "Partially Approved": ["PO Pending"],
    "PO Pending": ["PO Issued"],
    "PO Issued": ["Work In Progress"],
    "Work In Progress": ["Work Complete"],
    "Work Complete": ["Claimed"],
    Claimed: ["Certified"],
    Certified: ["Paid"],
    Paid: ["Closed"],
  },
  procurement_items: {
    "Not Requested": ["RFQ"],
    RFQ: ["Quotation Received"],
    "Quotation Received": ["Under Review"],
    "Under Review": ["Approved", "Rejected"],
    Approved: ["PO Pending"],
    "PO Pending": ["Ordered"],
    Ordered: ["Manufacturing", "In Transit"],
    Manufacturing: ["Ready for Dispatch"],
    "Ready for Dispatch": ["In Transit"],
    "In Transit": ["Partially Delivered", "Delivered"],
    "Partially Delivered": ["Delivered"],
    Delivered: ["Installed"],
  },
  ncrs: {
    Open: ["Under Investigation"],
    "Under Investigation": ["Corrective Action"],
    "Corrective Action": ["Verification"],
    Verification: ["Closed", "Rejected"],
    Rejected: ["Corrective Action"],
  },
  commissioning_tests: {
    Planned: ["Ready for Commissioning"],
    "Ready for Commissioning": ["Testing"],
    Testing: ["Passed", "Failed"],
    Failed: ["Testing"],
    Passed: ["Accepted"],
    Accepted: ["Closed"],
  },
  handover_items: {
    Required: ["Submitted"],
    Submitted: ["Under Review"],
    "Under Review": ["Approved", "Rejected"],
    Rejected: ["Submitted"],
    Approved: ["Closed"],
  },
  punchlist: {
    Open: ["In Progress", "Closed"],
    "In Progress": ["Resolved", "Open"],
    Resolved: ["Closed", "In Progress"],
    Closed: ["Open"],
  },
};

// Database Initialization & Seeding
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE, name TEXT,
      password_hash TEXT, role TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT, name TEXT, role TEXT, created_at TEXT, expires_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_memberships (
      user_id TEXT NOT NULL, project_id TEXT NOT NULL,
      access_role TEXT NOT NULL DEFAULT 'Member', active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, project_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT, client TEXT, status TEXT,
      start_date TEXT, end_date TEXT, budget REAL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, project_id TEXT, title TEXT, trade TEXT,
      assignee TEXT, start TEXT, end TEXT, progress INTEGER, status TEXT,
      wbs_code TEXT, duration TEXT, is_summary INTEGER DEFAULT 0, is_milestone INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS rfis (
      id TEXT PRIMARY KEY, project_id TEXT, number TEXT, subject TEXT,
      trade TEXT, raised_by TEXT, date_raised TEXT, due_date TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS submittals (
      id TEXT PRIMARY KEY, project_id TEXT, number TEXT, item TEXT,
      trade TEXT, date_submitted TEXT, due_date TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS punchlist (
      id TEXT PRIMARY KEY, project_id TEXT, item TEXT, trade TEXT,
      location TEXT, priority TEXT, date_raised TEXT, status TEXT, attachment_data TEXT
    );
    CREATE TABLE IF NOT EXISTS dailylogs (
      id TEXT PRIMARY KEY, project_id TEXT, date TEXT, trade TEXT,
      weather TEXT, crew INTEGER, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, project_id TEXT, name TEXT, category TEXT,
      revision TEXT, date_added TEXT, attachment_name TEXT, attachment_data TEXT,
      subcontractor_id TEXT, uploaded_by TEXT
    );
    CREATE TABLE IF NOT EXISTS costs (
      id TEXT PRIMARY KEY, project_id TEXT, category TEXT, description TEXT,
      planned REAL, actual REAL, date_logged TEXT
    );
    CREATE TABLE IF NOT EXISTS boq_items (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, item_number TEXT,
      description TEXT NOT NULL, unit TEXT, tender_quantity REAL DEFAULT 0,
      tender_rate REAL DEFAULT 0, tender_amount REAL DEFAULT 0,
      revised_quantity REAL DEFAULT 0, installed_quantity REAL DEFAULT 0,
      claimed_quantity REAL DEFAULT 0, certified_quantity REAL DEFAULT 0,
      discipline TEXT, system TEXT, building TEXT, floor TEXT, area TEXT,
      source_document_id TEXT, imported_at TEXT
    );
    CREATE TABLE IF NOT EXISTS change_orders (
      id TEXT PRIMARY KEY, project_id TEXT, number TEXT, title TEXT, trade TEXT,
      reason TEXT, cost_impact REAL, schedule_impact_days INTEGER,
      date_raised TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY, project_id TEXT, po_number TEXT, vendor TEXT, trade TEXT,
      description TEXT, amount REAL, order_date TEXT, expected_delivery TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS safety_incidents (
      id TEXT PRIMARY KEY, project_id TEXT, date TEXT, trade TEXT, incident_type TEXT,
      severity TEXT, description TEXT, corrective_action TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS inspections (
      id TEXT PRIMARY KEY, project_id TEXT, date TEXT, trade TEXT, inspection_type TEXT,
      inspector TEXT, result TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS meeting_minutes (
      id TEXT PRIMARY KEY, project_id TEXT, date TEXT, meeting_type TEXT,
      attendees TEXT, subject TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS timesheets (
      id TEXT PRIMARY KEY, project_id TEXT, date TEXT, worker TEXT, trade TEXT,
      task TEXT, hours REAL
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL,
      worker TEXT NOT NULL, work_date TEXT NOT NULL, punch_in TEXT NOT NULL,
      punch_out TEXT, status TEXT NOT NULL DEFAULT 'Open', notes TEXT
    );
    CREATE TABLE IF NOT EXISTS equipment (
      id TEXT PRIMARY KEY, project_id TEXT, name TEXT, type TEXT,
      assigned_to TEXT, status TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS wbs_items (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT,
      code TEXT, name TEXT NOT NULL, level TEXT, discipline TEXT, system TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS dependencies (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT,
      task_owner TEXT, dependent_party TEXT, description TEXT, dependency_owner TEXT,
      required_date TEXT, completed_date TEXT, status TEXT, impact_if_late TEXT,
      programme_impact TEXT, commercial_impact TEXT, next_action TEXT
    );
    CREATE TABLE IF NOT EXISTS procurement_items (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, pr_number TEXT, material TEXT,
      specification TEXT, boq_reference TEXT, drawing_reference TEXT, quantity REAL,
      unit TEXT, required_on_site TEXT, responsible_buyer TEXT, selected_supplier TEXT,
      po_number TEXT, po_date TEXT, expected_delivery TEXT, actual_delivery TEXT,
      delivered_quantity REAL, outstanding_quantity REAL, inspection_status TEXT,
      storage_location TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS material_requests (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, location TEXT, discipline TEXT,
      system TEXT, material TEXT, description TEXT, quantity REAL, unit TEXT,
      required_date TEXT, reason TEXT, drawing TEXT, boq_reference TEXT,
      requested_by TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS risks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT, category TEXT,
      probability TEXT, impact TEXT, risk_score REAL, owner TEXT, mitigation TEXT,
      target_date TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS ncrs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, number TEXT, location TEXT,
      description TEXT, raised_against TEXT, raised_date TEXT, responsible_party TEXT,
      root_cause TEXT, corrective_action TEXT, target_date TEXT, verification TEXT,
      closure_date TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS commissioning_tests (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, system TEXT, subsystem TEXT,
      equipment TEXT, test_type TEXT, power_available INTEGER, installation_complete INTEGER,
      controls_complete INTEGER, interface_complete INTEGER, drawings_approved INTEGER,
      test_date TEXT, test_engineer TEXT, witness TEXT, result TEXT, failure_reason TEXT,
      retest_date TEXT, certificate TEXT, status TEXT, comments TEXT
    );
    CREATE TABLE IF NOT EXISTS handover_items (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, contractor TEXT, system TEXT,
      item_type TEXT, description TEXT, required INTEGER, submitted INTEGER,
      approved INTEGER, due_date TEXT, status TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS task_status_history (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL,
      changed_by TEXT, old_status TEXT, new_status TEXT, changed_at TEXT, comment TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY, user_id TEXT, project_id TEXT, module TEXT,
      record_id TEXT, action TEXT, old_value TEXT, new_value TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS record_owners (
      module TEXT NOT NULL, record_id TEXT NOT NULL, user_id TEXT NOT NULL,
      PRIMARY KEY (module, record_id)
    );
    CREATE TABLE IF NOT EXISTS plan_buckets (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_document_id TEXT,
      name TEXT, order_index INTEGER, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS plan_tasks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, bucket_id TEXT NOT NULL,
      title TEXT, description TEXT, trade TEXT, priority TEXT, status TEXT,
      due_date TEXT, assigned_to TEXT, source_document_id TEXT, source_excerpt TEXT,
      order_index INTEGER, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS plan_task_checklist (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, label TEXT,
      is_checked INTEGER DEFAULT 0, order_index INTEGER
    );
  `);

  try { db.exec("ALTER TABLE documents ADD COLUMN subcontractor_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN uploaded_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN markup_data TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN attachment_data TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN contractor TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN description TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN floor TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN x_percent REAL;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN y_percent REAL;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN title TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN subcontractor TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN spec_section TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN log_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN workers_count INTEGER;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN work_performed TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN delays TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN safety_incidents TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN email TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN phone TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN company TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN trade TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'Active';"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN created_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN last_login TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;"); } catch {}

  seedUsers();
  seedData();
  ensureMemberships();
}

function seedUsers() {
  // Single bootstrap administrator account only. No demo company, no
  // placeholder staff/subcontractor accounts. must_change_password forces
  // a password change on first login (enforced client-side and by
  // PUT /api/me/password requiring the old password).
  const find = db.prepare("SELECT id FROM users WHERE username=?");
  const existing = find.get("admin") as any;
  if (!existing) {
    const insert = db.prepare(`
      INSERT INTO users (id, username, name, password_hash, role, status, created_at, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    insert.run(crypto.randomUUID(), "admin", "Administrator", hashPassword("ChangeMe123!"), "Admin", "Active", new Date().toISOString());
  }
}

function seedData() {
  // Intentionally a no-op: no demo/sample projects, tasks, RFIs, etc.
  // are created on startup. New installs start with zero projects;
  // the bootstrap admin account creates real projects from the UI.
}

function ensureMemberships() {
  const admins = db.prepare("SELECT id FROM users WHERE role IN ('Admin', 'ProjectManager')").all() as { id: string }[];
  const projects = db.prepare("SELECT id FROM projects").all() as { id: string }[];
  const insert = db.prepare(`
    INSERT INTO project_memberships (user_id, project_id, access_role, active)
    VALUES (?, ?, 'Lead', 1)
    ON CONFLICT(user_id, project_id) DO UPDATE SET active=1
  `);
  for (const a of admins) {
    for (const p of projects) {
      insert.run(a.id, p.id);
    }
  }

  // Also assign Site Engineer, Commercial Manager, QA/QC, Safety Officer, Consultant to all projects by default
  const staff = db.prepare("SELECT id, role FROM users WHERE role IN ('SiteEngineer', 'CommercialManager', 'QAQC', 'SafetyOfficer', 'Consultant')").all() as { id: string, role: string }[];
  for (const s of staff) {
    for (const p of projects) {
      insert.run(s.id, p.id);
    }
  }
}

// Permissions & Scope Helpers
function hasProjectAccess(user: AuthenticatedUser, projectId?: string): boolean {
  if (!projectId) return false;
  if (user.role === "Admin") return true;
  const row = db.prepare(
    "SELECT 1 FROM project_memberships WHERE user_id=? AND project_id=? AND active=1"
  ).get(user.user_id, projectId);
  return Boolean(row);
}

function projectScopeSql(user: AuthenticatedUser, projectId?: string | null, column: string = "project_id"): { where: string | null; params: any[] } {
  if (projectId && projectId !== "ALL") {
    if (!hasProjectAccess(user, projectId)) {
      return { where: null, params: [] };
    }
    return { where: `${column}=?`, params: [projectId] };
  }
  if (user.role === "Admin") {
    return { where: "1=1", params: [] };
  }
  return {
    where: `${column} IN (SELECT project_id FROM project_memberships WHERE user_id=? AND active=1)`,
    params: [user.user_id],
  };
}

function canView(user: AuthenticatedUser, module: string): boolean {
  const perms = ROLE_PERMS[user.role];
  return perms ? perms.view.includes(module) : false;
}

function canEdit(user: AuthenticatedUser, module: string): boolean {
  const perms = ROLE_PERMS[user.role];
  return perms ? perms.edit.includes(module) : false;
}

function canDelete(user: AuthenticatedUser): boolean {
  const perms = ROLE_PERMS[user.role];
  return perms ? perms.delete : false;
}

function writeAudit(userId: string, module: string, recordId: string, projectId: string, action: string, oldValue: any = null, newValue: any = null) {
  try {
    db.prepare(`
      INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      userId,
      projectId,
      module,
      recordId,
      action,
      oldValue !== null ? JSON.stringify(oldValue) : null,
      newValue !== null ? JSON.stringify(newValue) : null,
      new Date().toISOString()
    );
  } catch (err) {
    console.error("Audit write error:", err);
  }
}

// Authentication Middleware
function authRequired(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const session = db.prepare("SELECT * FROM sessions WHERE token=?").get(token) as any;
  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token=?").run(token);
    res.status(401).json({ error: "Session expired. Please log in again." });
    return;
  }
  req.user = {
    user_id: session.user_id,
    name: session.name,
    role: session.role,
  };
  next();
}

async function startServer() {
  initDb();
  const app = express();

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // API Config Script
  app.get("/api-config.js", (_req, res) => {
    const apiUrl = process.env.API_BASE_URL || "";
    res.type("application/javascript").send(`window.MEP_API_URL = ${JSON.stringify(apiUrl)};`);
  });

  // Health Check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "mep-project-manager" });
  });

  // Auth Endpoints
  app.post("/api/login", (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }
    const rateLimit = checkLoginRateLimit(username);
    if (!rateLimit.allowed) {
      res.status(429).json({ error: `Too many failed attempts. Try again in ${rateLimit.retryAfterSeconds}s.`, retry_after_seconds: rateLimit.retryAfterSeconds });
      return;
    }
    const user = db.prepare("SELECT * FROM users WHERE username=?").get(username) as any;
    if (!user || !verifyPassword(password, user.password_hash)) {
      recordLoginFailure(username);
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }
    if (user.status === "Inactive") {
      res.status(403).json({ error: "Your account is marked Inactive by the administrator. Contact high-level administration." });
      return;
    }
    clearLoginFailures(username);
    const token = crypto.randomUUID();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
    try {
      db.prepare("UPDATE users SET last_login=? WHERE id=?").run(now, user.id);
    } catch {}
    db.prepare("INSERT INTO sessions (token, user_id, name, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      token, user.id, user.name, user.role, now, expiresAt
    );
    res.json({
      token,
      user_id: user.id,
      name: user.name,
      role: user.role,
      email: user.email || "",
      company: user.company || "",
      trade: user.trade || "",
      status: user.status || "Active",
      must_change_password: !!user.must_change_password,
      permissions: ROLE_PERMS[user.role] || ROLE_PERMS.SiteEngineer,
    });
  });

  app.post("/api/logout", authRequired, (req, res) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token) {
      db.prepare("DELETE FROM sessions WHERE token=?").run(token);
    }
    res.json({ ok: true });
  });

  app.get("/api/me", authRequired, (req, res) => {
    const user = req.user!;
    const uRow = db.prepare("SELECT email, company, trade, status, must_change_password FROM users WHERE id=?").get(user.user_id) as any;
    res.json({
      user_id: user.user_id,
      name: user.name,
      role: user.role,
      email: uRow?.email || "",
      company: uRow?.company || "",
      trade: uRow?.trade || "",
      status: uRow?.status || "Active",
      must_change_password: !!uRow?.must_change_password,
      permissions: ROLE_PERMS[user.role] || ROLE_PERMS.SiteEngineer,
    });
  });

  // Self-service password change - requires the current password, unlike
  // the admin-only /api/users/:id/reset-password below. Also clears
  // must_change_password so the forced-change prompt doesn't reappear.
  app.put("/api/me/password", authRequired, (req, res) => {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      res.status(400).json({ error: "current_password and new_password are required" });
      return;
    }
    if (String(new_password).length < 8) {
      res.status(400).json({ error: "New password must be at least 8 characters." });
      return;
    }
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user!.user_id) as any;
    if (!user || !verifyPassword(current_password, user.password_hash)) {
      res.status(401).json({ error: "Current password is incorrect." });
      return;
    }
    db.prepare("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?").run(hashPassword(new_password), user.id);
    writeAudit(req.user!.user_id, "users", user.id, "SYSTEM", "CHANGE_OWN_PASSWORD");
    res.json({ ok: true });
  });

  // Roles Definition & Matrix Endpoint
  app.get("/api/roles", authRequired, (_req, res) => {
    res.json({
      roles: ROLE_DEFINITIONS,
      permissions: ROLE_PERMS,
    });
  });

  // High-Level User Administration
  app.get("/api/users", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const rows = db.prepare(`
      SELECT u.id, u.username, u.name, u.role, u.email, u.phone, u.company, u.trade,
        COALESCE(u.status, 'Active') as status, u.created_at, u.last_login,
        (SELECT COUNT(*) FROM project_memberships pm WHERE pm.user_id = u.id AND pm.active = 1) as project_count,
        (SELECT GROUP_CONCAT(p.name, ', ') FROM project_memberships pm JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = u.id AND pm.active = 1) as project_names
      FROM users u
      ORDER BY CASE WHEN u.role = 'Admin' THEN 1 WHEN u.role = 'ProjectManager' THEN 2 ELSE 3 END, u.name
    `).all();
    res.json(rows.map(rowToDict));
  });

  app.post("/api/users", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const { username, name, password, role, email, phone, company, trade, status, project_ids } = req.body || {};
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }
    const existing = db.prepare("SELECT id FROM users WHERE username=?").get(username.trim());
    if (existing) {
      res.status(400).json({ error: "A user with this username already exists" });
      return;
    }
    const id = crypto.randomUUID();
    const assignedRole = role || "SiteEngineer";
    const userStatus = status || "Active";
    const now = new Date().toISOString();

    try {
      db.prepare(`
        INSERT INTO users (id, username, name, password_hash, role, email, phone, company, trade, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, username.trim(), (name || username).trim(), hashPassword(password), assignedRole,
        email ? String(email).trim() : null,
        phone ? String(phone).trim() : null,
        company ? String(company).trim() : null,
        trade ? String(trade).trim() : "General MEP",
        userStatus,
        now
      );

      // Project assignments
      if (assignedRole === "Admin" || (Array.isArray(project_ids) && project_ids.includes("ALL"))) {
        const projects = db.prepare("SELECT id FROM projects").all() as { id: string }[];
        const insertMem = db.prepare("INSERT OR IGNORE INTO project_memberships VALUES (?, ?, ?, 1)");
        for (const p of projects) {
          insertMem.run(id, p.id, assignedRole === "Admin" ? "Executive" : assignedRole);
        }
      } else if (Array.isArray(project_ids) && project_ids.length > 0) {
        const insertMem = db.prepare("INSERT OR IGNORE INTO project_memberships VALUES (?, ?, ?, 1)");
        for (const pid of project_ids) {
          if (pid) {
            insertMem.run(id, pid, assignedRole);
          }
        }
      }

      writeAudit(req.user!.user_id, "users", id, "SYSTEM", "CREATE_USER", null, {
        username, name, role: assignedRole, email, company, trade, status: userStatus, project_ids
      });

      res.status(201).json({ id, username, name, role: assignedRole, status: userStatus });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to create user" });
    }
  });

  app.put("/api/users/:id", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id) as any;
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const data = req.body || {};
    const name = data.name !== undefined ? String(data.name).trim() : user.name;
    const role = data.role !== undefined ? String(data.role).trim() : user.role;
    const email = data.email !== undefined ? String(data.email).trim() : user.email;
    const phone = data.phone !== undefined ? String(data.phone).trim() : user.phone;
    const company = data.company !== undefined ? String(data.company).trim() : user.company;
    const trade = data.trade !== undefined ? String(data.trade).trim() : user.trade;
    const status = data.status !== undefined ? String(data.status).trim() : (user.status || "Active");

    let pwHash = user.password_hash;
    if (data.password && String(data.password).trim().length > 0) {
      pwHash = hashPassword(String(data.password).trim());
    }

    db.prepare(`
      UPDATE users SET name=?, role=?, email=?, phone=?, company=?, trade=?, status=?, password_hash=?
      WHERE id=?
    `).run(name, role, email, phone, company, trade, status, pwHash, req.params.id);

    // Update project memberships if provided
    if (Array.isArray(data.project_ids)) {
      db.prepare("UPDATE project_memberships SET active=0 WHERE user_id=?").run(req.params.id);
      if (role === "Admin" || data.project_ids.includes("ALL")) {
        const projects = db.prepare("SELECT id FROM projects").all() as { id: string }[];
        const ins = db.prepare(`
          INSERT INTO project_memberships (user_id, project_id, access_role, active)
          VALUES (?, ?, ?, 1)
          ON CONFLICT(user_id, project_id) DO UPDATE SET active=1, access_role=excluded.access_role
        `);
        for (const p of projects) {
          ins.run(req.params.id, p.id, role === "Admin" ? "Executive" : role);
        }
      } else {
        const ins = db.prepare(`
          INSERT INTO project_memberships (user_id, project_id, access_role, active)
          VALUES (?, ?, ?, 1)
          ON CONFLICT(user_id, project_id) DO UPDATE SET active=1, access_role=excluded.access_role
        `);
        for (const pid of data.project_ids) {
          if (pid) ins.run(req.params.id, pid, role);
        }
      }
    }

    writeAudit(req.user!.user_id, "users", req.params.id, "SYSTEM", "UPDATE_USER", {
      name: user.name, role: user.role, status: user.status
    }, { name, role, email, phone, company, trade, status });

    res.json({ id: req.params.id, username: user.username, name, role, email, phone, company, trade, status });
  });

  app.post("/api/users/:id/toggle-status", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    if (req.params.id === req.user!.user_id) {
      res.status(400).json({ error: "Cannot deactivate your own administrator account" });
      return;
    }
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id) as any;
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const newStatus = (user.status === "Inactive") ? "Active" : "Inactive";
    db.prepare("UPDATE users SET status=? WHERE id=?").run(newStatus, req.params.id);
    writeAudit(req.user!.user_id, "users", req.params.id, "SYSTEM", "TOGGLE_USER_STATUS", { status: user.status }, { status: newStatus });
    res.json({ ok: true, status: newStatus });
  });

  app.post("/api/users/:id/reset-password", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const { new_password } = req.body || {};
    if (!new_password) {
      res.status(400).json({ error: "New password required" });
      return;
    }
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id) as any;
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(new_password), req.params.id);
    writeAudit(req.user!.user_id, "users", req.params.id, "SYSTEM", "RESET_USER_PASSWORD", null, { username: user.username });
    res.json({ ok: true });
  });

  app.delete("/api/users/:id", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    if (req.params.id === req.user!.user_id) {
      res.status(400).json({ error: "Cannot delete your own administrator account" });
      return;
    }
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id) as any;
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    db.prepare("DELETE FROM project_memberships WHERE user_id=?").run(req.params.id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.params.id);
    db.prepare("DELETE FROM users WHERE id=?").run(req.params.id);
    writeAudit(req.user!.user_id, "users", req.params.id, "SYSTEM", "DELETE_USER", { username: user.username, name: user.name, role: user.role }, null);
    res.json({ ok: true });
  });

  app.get("/api/users/:id/projects", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const rows = db.prepare(`
      SELECT p.id, p.name, pm.access_role, COALESCE(pm.active, 0) as active
      FROM projects p
      LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = ?
    `).all(req.params.id);
    res.json(rows.map(rowToDict));
  });

  app.put("/api/users/:id/projects", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id) as any;
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (Array.isArray(req.body?.project_ids)) {
      const projectIds: string[] = req.body.project_ids;
      db.prepare("UPDATE project_memberships SET active=0 WHERE user_id=?").run(req.params.id);
      const roleName = user.role === "Admin" ? "Project Manager" : user.role === "Subcontractor" ? "Subcontractor" : "Site Engineer";
      for (const pid of projectIds) {
        db.prepare(`
          INSERT INTO project_memberships (user_id, project_id, access_role, active)
          VALUES (?, ?, ?, 1)
          ON CONFLICT(user_id, project_id) DO UPDATE SET active=1, access_role=excluded.access_role
        `).run(req.params.id, pid, roleName);
      }
      res.json({ ok: true });
      return;
    }

    const memberships = req.body?.memberships || [];
    for (const m of memberships) {
      db.prepare(`
        INSERT INTO project_memberships (user_id, project_id, access_role, active)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, project_id) DO UPDATE SET access_role=excluded.access_role, active=excluded.active
      `).run(req.params.id, m.project_id, m.access_role || "Member", m.active ? 1 : 0);
    }
    res.json({ ok: true });
  });

  // Project Subcontractors & Team Members
  app.get("/api/projects/:id/subcontractors", authRequired, (req, res) => {
    if (!hasProjectAccess(req.user!, req.params.id)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    const rows = db.prepare(`
      SELECT u.id, u.name, u.username, pm.access_role
      FROM users u
      JOIN project_memberships pm ON pm.user_id = u.id
      WHERE pm.project_id = ? AND pm.active = 1 AND u.role = 'Subcontractor'
      ORDER BY u.name
    `).all(req.params.id);
    res.json(rows.map(rowToDict));
  });

  app.get("/api/projects/:id/members", authRequired, (req, res) => {
    if (!hasProjectAccess(req.user!, req.params.id)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    const rows = db.prepare(`
      SELECT u.id, u.name, u.username, u.role,
        COALESCE(pm.active, 0) as active,
        COALESCE(pm.access_role, u.role) as access_role
      FROM users u
      LEFT JOIN project_memberships pm ON pm.user_id = u.id AND pm.project_id = ?
      ORDER BY u.role, u.name
    `).all(req.params.id);
    res.json(rows.map(rowToDict));
  });

  app.put("/api/projects/:id/members", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const members = req.body?.members || [];
    for (const m of members) {
      db.prepare(`
        INSERT INTO project_memberships (user_id, project_id, access_role, active)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, project_id) DO UPDATE SET access_role=excluded.access_role, active=excluded.active
      `).run(m.user_id, req.params.id, m.access_role || "Member", m.active ? 1 : 0);
    }
    res.json({ ok: true });
  });

  // Projects Endpoints
  app.get("/api/projects", authRequired, (req, res) => {
    const { where, params } = projectScopeSql(req.user!, "ALL", "id");
    if (!where) {
      res.status(403).json({ error: "No access to projects" });
      return;
    }
    const rows = db.prepare(`SELECT * FROM projects WHERE ${where} ORDER BY name`).all(...params);
    res.json(rows.map(rowToDict));
  });

  app.post("/api/projects", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required to create project" });
      return;
    }
    const data = req.body || {};
    const id = crypto.randomUUID();
    const cols = ["id", "name", "client", "status", "start_date", "end_date", "budget"];
    const values = [
      id,
      data.name || "Untitled Project",
      data.client || "",
      data.status || "Active",
      data.start_date || "",
      data.end_date || "",
      parseImportNumber(data.budget),
    ];
    db.prepare(`INSERT INTO projects (${cols.join(",")}) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(...values);
    db.prepare(`
      INSERT OR IGNORE INTO project_memberships (user_id, project_id, access_role)
      VALUES (?, ?, 'Project Manager')
    `).run(req.user!.user_id, id);
    writeAudit(req.user!.user_id, "projects", id, id, "create", null, data);
    res.status(201).json({ id, ...data });
  });

  app.put("/api/projects/:id", authRequired, (req, res) => {
    if (!hasProjectAccess(req.user!, req.params.id) || req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const existing = db.prepare("SELECT * FROM projects WHERE id=?").get(req.params.id) as any;
    if (!existing) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const data = req.body || {};
    const cols = ["name", "client", "status", "start_date", "end_date", "budget"];
    const updates: string[] = [];
    const vals: any[] = [];
    for (const c of cols) {
      if (c in data) {
        updates.push(`${c}=?`);
        vals.push(c === "budget" ? parseImportNumber(data[c]) : data[c]);
      }
    }
    if (updates.length > 0) {
      vals.push(req.params.id);
      db.prepare(`UPDATE projects SET ${updates.join(",")} WHERE id=?`).run(...vals);
    }
    const updated = db.prepare("SELECT * FROM projects WHERE id=?").get(req.params.id);
    writeAudit(req.user!.user_id, "projects", req.params.id, req.params.id, "update", existing, updated);
    res.json(rowToDict(updated));
  });

  app.delete("/api/projects/:id", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const id = req.params.id;
    db.prepare("DELETE FROM project_memberships WHERE project_id=?").run(id);
    // A few TABLE_CONFIG keys (e.g. "drawings", "daily_logs") are URL
    // aliases for a real table under a different name ("documents",
    // "dailylogs") rather than real tables of their own - resolve those
    // before deleting, and de-duplicate so each real table is only hit once.
    const realTables = new Set<string>();
    for (const table of Object.keys(TABLE_CONFIG)) {
      realTables.add(table === "drawings" ? "documents" : table === "daily_logs" ? "dailylogs" : table);
    }
    for (const table of realTables) {
      db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(id);
    }
    db.prepare("DELETE FROM projects WHERE id=?").run(id);
    writeAudit(req.user!.user_id, "projects", id, id, "delete");
    res.json({ ok: true });
  });

  // Portfolio Dashboard
  app.get("/api/portfolio", authRequired, (req, res) => {
    if (!canView(req.user!, "dashboard")) {
      res.status(403).json({ error: "No view access" });
      return;
    }
    const { where, params } = projectScopeSql(req.user!, "ALL", "id");
    const projects = db.prepare(`SELECT * FROM projects WHERE ${where}`).all(...params) as any[];
    const today = new Date().toISOString().split("T")[0];
    const cards = [];

    for (const project of projects) {
      const pid = project.id;
      const tasks = db.prepare("SELECT * FROM tasks WHERE project_id=?").all(pid) as any[];
      const rfis = db.prepare("SELECT * FROM rfis WHERE project_id=?").all(pid) as any[];
      const punch = db.prepare("SELECT * FROM punchlist WHERE project_id=?").all(pid) as any[];
      const deps = db.prepare("SELECT * FROM dependencies WHERE project_id=?").all(pid) as any[];
      const costs = db.prepare("SELECT planned, actual FROM costs WHERE project_id=?").all(pid) as any[];
      const variations = db.prepare("SELECT cost_impact, status FROM change_orders WHERE project_id=?").all(pid) as any[];
      const procurement = db.prepare("SELECT status, expected_delivery FROM procurement_items WHERE project_id=?").all(pid) as any[];

      const progress = tasks.length ? Math.round(tasks.reduce((sum, t) => sum + (t.progress || 0), 0) / tasks.length) : 0;
      const approvedVariations = variations
        .filter(v => ["approved", "closed", "paid"].includes((v.status || "").toLowerCase()))
        .reduce((sum, v) => sum + (v.cost_impact || 0), 0);
      const pendingVariations = variations
        .filter(v => !["approved", "closed", "paid", "rejected"].includes((v.status || "").toLowerCase()))
        .reduce((sum, v) => sum + (v.cost_impact || 0), 0);
      const planned = costs.reduce((sum, c) => sum + (c.planned || 0), 0);
      const actual = costs.reduce((sum, c) => sum + (c.actual || 0), 0);
      const openSnags = punch.filter(p => !["closed", "closed verified", "complete verified"].includes((p.status || "").toLowerCase())).length;
      const overdue = rfis.filter(r => r.due_date && r.due_date < today && !["closed", "answered"].includes((r.status || "").toLowerCase())).length;
      const blocked = deps.filter(d => ["blocked", "overdue"].includes((d.status || "").toLowerCase())).length;
      const lateMaterials = procurement.filter(p => p.expected_delivery && p.expected_delivery < today && !["delivered", "installed"].includes((p.status || "").toLowerCase())).length;

      let health = (blocked || lateMaterials || overdue >= 3) ? "RED" : (openSnags || pendingVariations || overdue) ? "AMBER" : "GREEN";
      if (["closed", "completed"].includes((project.status || "").toLowerCase()) && (openSnags || pendingVariations)) {
        health = "BLUE";
      }

      cards.push({
        ...project,
        contract_value: project.budget || 0,
        approved_variations: approvedVariations,
        revised_contract_value: (project.budget || 0) + approvedVariations,
        project_completion: progress,
        programme_completion: progress,
        commercial_completion: planned ? Math.round((actual / planned) * 100) : 0,
        procurement_completion: procurement.length
          ? Math.round((procurement.filter(p => ["delivered", "installed"].includes((p.status || "").toLowerCase())).length / procurement.length) * 100)
          : 0,
        open_snags: openSnags,
        overdue_actions: overdue,
        major_blockers: blocked,
        pending_variations: pendingVariations,
        cost_variance: actual - planned,
        late_materials: lateMaterials,
        health,
      });
    }
    res.json(cards);
  });

  // Operations Today
  app.get("/api/operations/today", authRequired, (req, res) => {
    if (!canView(req.user!, "dashboard")) {
      res.status(403).json({ error: "No view access" });
      return;
    }
    const selectedDate = (req.query.date as string) || new Date().toISOString().split("T")[0];
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId, "id");
    if (!where) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    const projects = db.prepare(`SELECT * FROM projects WHERE ${where}`).all(...params) as any[];
    const digest = [];

    for (const project of projects) {
      const pid = project.id;
      const tasks = db.prepare("SELECT * FROM tasks WHERE project_id=? AND start<=? AND end>=? ORDER BY start, title").all(pid, selectedDate, selectedDate) as any[];
      const logs = db.prepare("SELECT * FROM dailylogs WHERE project_id=? AND date=? ORDER BY rowid DESC").all(pid, selectedDate) as any[];
      const photos = db.prepare("SELECT id, name, attachment_name, date_added FROM documents WHERE project_id=? AND category='Site Photo' AND date_added=? AND attachment_data IS NOT NULL ORDER BY rowid DESC").all(pid, selectedDate) as any[];
      const boq = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(installed_quantity),0) AS installed, COALESCE(SUM(tender_quantity),0) AS tender FROM boq_items WHERE project_id=?").get(pid) as any;

      digest.push({
        project: rowToDict(project),
        tasks: tasks.map(rowToDict),
        logs: logs.map(rowToDict),
        photo_count: photos.length,
        latest_photo: photos[0] ? rowToDict(photos[0]) : null,
        boq: rowToDict(boq),
        crew: logs.reduce((sum, l) => sum + (parseInt(l.crew || 0) || 0), 0),
        progress: tasks.length ? Math.round(tasks.reduce((sum, t) => sum + (parseInt(t.progress || 0) || 0), 0) / tasks.length) : 0,
      });
    }
    res.json({ date: selectedDate, projects: digest });
  });

  // Attendance
  app.get("/api/attendance", authRequired, (req, res) => {
    if (!canView(req.user!, "attendance")) {
      res.status(403).json({ error: "No view access" });
      return;
    }
    const projectId = req.query.project_id as string;
    let { where, params } = projectScopeSql(req.user!, projectId);
    if (!where) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    if (req.user!.role !== "Admin") {
      where += " AND user_id=?";
      params.push(req.user!.user_id);
    }
    const rows = db.prepare(`SELECT * FROM attendance WHERE ${where} ORDER BY punch_in DESC`).all(...params) as any[];
    const now = new Date();
    const result = rows.map(row => {
      const record = { ...row };
      const start = new Date(row.punch_in);
      const end = row.punch_out ? new Date(row.punch_out) : now;
      record.hours = Math.round((Math.max(0, end.getTime() - start.getTime()) / 3600000) * 100) / 100;
      return record;
    });
    res.json(result);
  });

  app.post("/api/attendance/punch-in", authRequired, (req, res) => {
    const projectId = req.body?.project_id;
    if (!hasProjectAccess(req.user!, projectId)) {
      res.status(403).json({ error: "No project access" });
      return;
    }
    if (!canEdit(req.user!, "attendance")) {
      res.status(403).json({ error: "No edit access" });
      return;
    }
    const active = db.prepare("SELECT id FROM attendance WHERE user_id=? AND punch_out IS NULL").get(req.user!.user_id);
    if (active) {
      res.status(409).json({ error: "You are already punched in to a project" });
      return;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const today = now.split("T")[0];
    const notes = req.body?.notes || "";
    db.prepare("INSERT INTO attendance VALUES (?, ?, ?, ?, ?, ?, ?, 'Open', ?)").run(
      id, projectId, req.user!.user_id, req.user!.name, today, now, null, notes
    );
    writeAudit(req.user!.user_id, "attendance", id, projectId, "punch_in", null, { worker: req.user!.name, punch_in: now });
    res.status(201).json({
      id,
      project_id: projectId,
      user_id: req.user!.user_id,
      worker: req.user!.name,
      work_date: today,
      punch_in: now,
      punch_out: null,
      status: "Open",
      notes,
    });
  });

  app.post("/api/attendance/punch-out", authRequired, (req, res) => {
    const active = db.prepare("SELECT * FROM attendance WHERE user_id=? AND punch_out IS NULL").get(req.user!.user_id) as any;
    if (!active) {
      res.status(409).json({ error: "You are not currently punched in" });
      return;
    }
    const now = new Date().toISOString();
    db.prepare("UPDATE attendance SET punch_out=?, status='Closed' WHERE id=?").run(now, active.id);
    writeAudit(req.user!.user_id, "attendance", active.id, active.project_id, "punch_out", active, { punch_out: now });
    const updated = db.prepare("SELECT * FROM attendance WHERE id=?").get(active.id) as any;
    const start = new Date(updated.punch_in);
    const end = new Date(updated.punch_out);
    updated.hours = Math.round((Math.max(0, end.getTime() - start.getTime()) / 3600000) * 100) / 100;
    res.json(rowToDict(updated));
  });

  // Dashboard Overview
  app.get("/api/dashboard", authRequired, (req, res) => {
    if (!canView(req.user!, "dashboard")) {
      res.status(403).json({ error: "No view access" });
      return;
    }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId);
    if (!where) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }

    const tasks = db.prepare(`SELECT * FROM tasks WHERE ${where}`).all(...params) as any[];
    const rfis = db.prepare(`SELECT * FROM rfis WHERE ${where}`).all(...params) as any[];
    const submittals = db.prepare(`SELECT * FROM submittals WHERE ${where}`).all(...params) as any[];
    const punch = db.prepare(`SELECT * FROM punchlist WHERE ${where}`).all(...params) as any[];
    const costs = db.prepare(`SELECT * FROM costs WHERE ${where}`).all(...params) as any[];
    const boqItems = db.prepare(`SELECT * FROM boq_items WHERE ${where}`).all(...params) as any[];
    const changeOrders = db.prepare(`SELECT * FROM change_orders WHERE ${where}`).all(...params) as any[];
    const safetyIncidents = db.prepare(`SELECT * FROM safety_incidents WHERE ${where}`).all(...params) as any[];

    const today = new Date().toISOString().split("T")[0];
    const isOverdue = (r: any) => {
      if (!r.due_date) return false;
      const closedLike = ["closed", "completed", "approved"].some(s => (r.status || "").toLowerCase().includes(s));
      return !closedLike && r.due_date < today;
    };

    const openRfi = rfis.filter(r => r.status !== "Closed").length;
    const openPunch = punch.filter(p => p.status !== "Closed").length;
    const overdue = [...rfis, ...submittals].filter(isOverdue).length;
    const avgProgress = tasks.length ? Math.round(tasks.reduce((sum, t) => sum + (t.progress || 0), 0) / tasks.length) : 0;
    const totalPlanned = costs.reduce((sum, c) => sum + (c.planned || 0), 0);
    const totalActual = costs.reduce((sum, c) => sum + (c.actual || 0), 0);
    const pendingChangeOrders = changeOrders.filter(c => c.status === "Pending").length;
    const openSafety = safetyIncidents.filter(s => s.status !== "Closed").length;

    const tasksByTrade: Record<string, number> = {};
    for (const t of tasks) {
      if (t.trade) {
        tasksByTrade[t.trade] = (tasksByTrade[t.trade] || 0) + 1;
      }
    }

    res.json({
      total_tasks: tasks.length,
      avg_progress: avgProgress,
      open_rfi: openRfi,
      open_punch: openPunch,
      overdue_count: overdue,
      cost_variance: totalActual - totalPlanned,
      tasks_by_trade: tasksByTrade,
      pending_change_orders: pendingChangeOrders,
      open_safety_incidents: openSafety,
      boq_line_count: boqItems.length,
      boq_tender_value: boqItems.reduce((sum, b) => sum + (b.tender_amount || 0), 0),
    });
  });

  // Global Search
  app.get("/api/search", authRequired, (req, res) => {
    const q = ((req.query.q as string) || "").trim();
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId);
    const { where: projWhere, params: projParams } = projectScopeSql(req.user!, projectId, "id");
    if (!where || !projWhere) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }

    const like = `%${q}%`;
    const results: any[] = [];
    const searchable: Record<string, string[]> = {
      projects: ["name", "client", "status"],
      tasks: ["title", "trade", "assignee", "status"],
      rfis: ["number", "subject", "trade", "status"],
      documents: ["name", "category", "revision"],
      boq_items: ["item_number", "description", "discipline", "system", "unit"],
      purchase_orders: ["po_number", "vendor", "description", "status"],
      change_orders: ["number", "title", "trade", "status"],
      equipment: ["name", "type", "assigned_to", "status"],
      dependencies: ["description", "dependency_owner", "status", "next_action"],
      procurement_items: ["pr_number", "material", "selected_supplier", "status"],
      risks: ["title", "category", "owner", "status"],
      ncrs: ["number", "description", "responsible_party", "status"],
      commissioning_tests: ["system", "equipment", "test_type", "status"],
      handover_items: ["contractor", "system", "item_type", "status"],
    };

    for (const [table, columns] of Object.entries(searchable)) {
      let scope = table === "projects" ? projWhere : where;
      const baseParams = table === "projects" ? [...projParams] : [...params];
      if (table === "documents" && req.user!.role === "Subcontractor") {
        scope += " AND (subcontractor_id = ? OR id IN (SELECT record_id FROM record_owners WHERE module='documents' AND user_id=?))";
        baseParams.push(req.user!.user_id, req.user!.user_id);
      }
      const clauses = columns.map(c => `${c} LIKE ?`).join(" OR ");
      const queryParams = [...baseParams, ...columns.map(() => like)];
      const rows = db.prepare(`SELECT * FROM ${table} WHERE ${scope} AND (${clauses}) LIMIT 25`).all(...queryParams) as any[];
      for (const row of rows) {
        results.push({
          module: table,
          id: row.id,
          project_id: row.project_id || row.id,
          title: row.title || row.name || row.description || row.subject || row.material || row.number,
          record: rowToDict(row),
        });
      }
    }
    res.json(results.slice(0, 100));
  });

  // Audit Logs
  app.get("/api/audit", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId, "id");
    if (!where) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    const rows = db.prepare(`
      SELECT audit_logs.*, users.name AS user_name
      FROM audit_logs
      LEFT JOIN users ON users.id = audit_logs.user_id
      WHERE audit_logs.project_id IN (SELECT id FROM projects WHERE ${where})
      ORDER BY audit_logs.created_at DESC LIMIT 500
    `).all(...params);
    res.json(rows.map(rowToDict));
  });

  // Export CSV
  app.get("/api/export/:table", authRequired, (req, res) => {
    const table = req.params.table;
    const exportConfig = {
      ...TABLE_CONFIG,
      projects: {
        cols: ["id", "name", "client", "status", "start_date", "end_date", "budget"],
        module: "projects",
      },
    };
    const cfg = (exportConfig as any)[table];
    if (!cfg) {
      res.status(404).json({ error: "Unknown export target" });
      return;
    }
    if (!canView(req.user!, cfg.module)) {
      res.status(403).json({ error: `No view access to ${cfg.module}` });
      return;
    }
    const projectId = req.query.project_id as string;
    let { where, params } = table === "projects" ? projectScopeSql(req.user!, projectId, "id") : projectScopeSql(req.user!, projectId);
    if (!where) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    if (table === "documents" && req.user!.role === "Subcontractor") {
      where += " AND (subcontractor_id = ? OR id IN (SELECT record_id FROM record_owners WHERE module='documents' AND user_id=?))";
      params.push(req.user!.user_id, req.user!.user_id);
    }
    const rows = db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...params) as any[];
    const cols = cfg.cols.filter((c: string) => c !== "attachment_data");
    const csvHeader = cols.join(",");
    const csvRows = rows.map((r: any) =>
      cols.map((c: string) => {
        const v = r[c] ?? "";
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(",")
    );
    const content = [csvHeader, ...csvRows].join("\r\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${table}.csv`);
    res.send(content);
  });

  // Specialized Workflow Actions
  app.post("/api/procurement_items/:id/create-po", authRequired, (req, res) => {
    const item = db.prepare("SELECT * FROM procurement_items WHERE id=?").get(req.params.id) as any;
    if (!item) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!hasProjectAccess(req.user!, item.project_id)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    if (!canEdit(req.user!, "procurement")) {
      res.status(403).json({ error: "No edit access" });
      return;
    }
    if (item.po_number) {
      res.status(409).json({ error: "Purchase order already exists", po_number: item.po_number });
      return;
    }
    const poNumber = req.body?.po_number || `PO-${Date.now()}`;
    const today = new Date().toISOString().split("T")[0];
    db.prepare("INSERT INTO purchase_orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), item.project_id, poNumber, item.selected_supplier || "", "",
      item.material || "", 0, item.po_date || today, item.expected_delivery, "Ordered"
    );
    db.prepare("UPDATE procurement_items SET po_number=?, status=? WHERE id=?").run(poNumber, "Ordered", req.params.id);
    writeAudit(req.user!.user_id, "procurement", req.params.id, item.project_id, "create_po", null, { po_number: poNumber });
    res.status(201).json({ ok: true, po_number: poNumber });
  });

  app.post("/api/dependencies/:id/complete", authRequired, (req, res) => {
    const dep = db.prepare("SELECT * FROM dependencies WHERE id=?").get(req.params.id) as any;
    if (!dep) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!hasProjectAccess(req.user!, dep.project_id)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    if (!canEdit(req.user!, "dependencies")) {
      res.status(403).json({ error: "No edit access" });
      return;
    }
    const completedDate = req.body?.completed_date || new Date().toISOString().split("T")[0];
    db.prepare("UPDATE dependencies SET status=?, completed_date=? WHERE id=?").run("Complete", completedDate, req.params.id);
    if (dep.task_id) {
      const openRow = db.prepare(
        "SELECT COUNT(*) as count FROM dependencies WHERE task_id=? AND status NOT IN ('Complete','Completed') AND id<>?"
      ).get(dep.task_id, req.params.id) as { count: number };
      if (openRow.count === 0) {
        db.prepare(
          "UPDATE tasks SET status=? WHERE id=? AND status IN ('Blocked','Awaiting Material','Awaiting Contractor')"
        ).run("Ready to Start", dep.task_id);
      }
    }
    writeAudit(req.user!.user_id, "dependencies", req.params.id, dep.project_id, "complete", { status: dep.status }, { status: "Complete", completed_date: completedDate });
    res.json({ ok: true, status: "Complete", completed_date: completedDate });
  });

  app.get("/api/commissioning_tests/:id/readiness", authRequired, (req, res) => {
    const row = db.prepare("SELECT * FROM commissioning_tests WHERE id=?").get(req.params.id) as any;
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!hasProjectAccess(req.user!, row.project_id)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    const prerequisites: Record<string, any> = {
      power_available: row.power_available,
      installation_complete: row.installation_complete,
      controls_complete: row.controls_complete,
      interface_complete: row.interface_complete,
      drawings_approved: row.drawings_approved,
    };
    const missing = Object.keys(prerequisites).filter(k => !prerequisites[k]);
    res.json({ ready: missing.length === 0, missing, prerequisites });
  });

  app.get("/api/handover/:projectId/readiness", authRequired, (req, res) => {
    const pid = req.params.projectId;
    if (!hasProjectAccess(req.user!, pid)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    const rows = db.prepare("SELECT * FROM handover_items WHERE project_id=?").all(pid) as any[];
    const total = rows.length;
    const approved = rows.filter(r => r.approved || ["approved", "closed"].includes((r.status || "").toLowerCase())).length;
    const submitted = rows.filter(r => r.submitted || r.approved || ["submitted", "under review", "approved", "closed"].includes((r.status || "").toLowerCase())).length;
    const missing = rows.filter(r => !r.approved && !["approved", "closed"].includes((r.status || "").toLowerCase())).map(rowToDict);
    res.json({
      total,
      submitted,
      approved,
      readiness_percent: total ? Math.round((approved / total) * 100) : 0,
      missing,
    });
  });

  app.get("/api/tasks/:id/history", authRequired, (req, res) => {
    const task = db.prepare("SELECT project_id FROM tasks WHERE id=?").get(req.params.id) as any;
    if (!task) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!hasProjectAccess(req.user!, task.project_id)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    const rows = db.prepare("SELECT * FROM task_status_history WHERE task_id=? ORDER BY changed_at DESC").all(req.params.id);
    res.json(rows.map(rowToDict));
  });

  app.post("/api/:table/:id/transition", authRequired, (req, res) => {
    const table = req.params.table;
    const recordId = req.params.id;
    const newStatus = req.body?.status;
    const comment = req.body?.comment || null;

    const cfg = TABLE_CONFIG[table];
    if (!cfg || !cfg.cols.includes("status") || !WORKFLOW_STATUSES[table]) {
      res.status(400).json({ error: "No controlled workflow for this module" });
      return;
    }
    const existing = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(recordId) as any;
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!hasProjectAccess(req.user!, existing.project_id)) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    if (!canEdit(req.user!, cfg.module)) {
      res.status(403).json({ error: `No edit access to ${cfg.module}` });
      return;
    }
    const oldStatus = existing.status || "";
    const allowed = WORKFLOW_STATUSES[table][oldStatus] || [];
    if (!allowed.includes(newStatus)) {
      res.status(422).json({ error: `Cannot transition ${oldStatus || "blank"} to ${newStatus}`, allowed });
      return;
    }
    db.prepare(`UPDATE ${table} SET status=? WHERE id=?`).run(newStatus, recordId);
    db.prepare("INSERT INTO task_status_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), existing.project_id, recordId, req.user!.name, oldStatus, newStatus, new Date().toISOString(), comment
    );
    writeAudit(req.user!.user_id, cfg.module, recordId, existing.project_id, "transition", { status: oldStatus }, { status: newStatus, comment });
    const updated = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(recordId);
    res.json(rowToDict(updated));
  });

  // BOQ File Import
  const upload = multer({ storage: multer.memoryStorage() });
  app.post("/api/boq/import", authRequired, upload.single("file"), (req, res) => {
    const projectId = req.body?.project_id;
    if (!hasProjectAccess(req.user!, projectId)) {
      res.status(403).json({ error: "No project access" });
      return;
    }
    if (!canEdit(req.user!, "budget")) {
      res.status(403).json({ error: "No edit access to budget" });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "A CSV, XLSX, or text-based BOQ file is required" });
      return;
    }

    const filename = file.originalname;
    const textContent = file.buffer.toString("utf-8");
    const lines = textContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      res.status(400).json({ error: "The BOQ file contains no data rows" });
      return;
    }

    const separator = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
    const headerCols = lines[0].split(separator).map(normaliseHeader);
    const parsedRows = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(separator);
      const rowObj: Record<string, string> = {};
      for (let j = 0; j < headerCols.length; j++) {
        rowObj[headerCols[j]] = (parts[j] || "").trim().replace(/^["']|["']$/g, "");
      }
      parsedRows.push(rowObj);
    }

    const docId = crypto.randomUUID();
    const attData = "data:application/octet-stream;base64," + file.buffer.toString("base64");
    const today = new Date().toISOString().split("T")[0];
    db.prepare("INSERT INTO documents (id, project_id, name, category, revision, date_added, attachment_name, attachment_data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      docId, projectId, filename, "BOQ / Tender", "Imported", today, filename, attData, req.user!.user_id
    );

    let imported = 0;
    let totalAmount = 0.0;
    const disciplines = new Set<string>();
    const systems = new Set<string>();
    const now = new Date().toISOString();

    const insertBoq = db.prepare("INSERT INTO boq_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const r of parsedRows) {
      const description = r.description || r.itemdescription || r.scope || r.name;
      if (!description) continue;

      const qty = parseImportNumber(r.tenderquantity || r.quantity || r.qty);
      const rate = parseImportNumber(r.tenderrate || r.rate || r.unitrate || r.price);
      const amount = parseImportNumber(r.tenderamount || r.amount || r.total || r.value) || (qty * rate);
      const discipline = (r.discipline || r.trade || r.category || "").trim();
      const system = (r.system || r.subsystem || "").trim();
      const itemId = crypto.randomUUID();

      insertBoq.run(
        itemId, projectId, r.itemnumber || r.itemno || r.code || r.number || "", description,
        r.unit || r.uom || "", qty, rate, amount,
        parseImportNumber(r.revisedquantity), parseImportNumber(r.installedquantity),
        parseImportNumber(r.claimedquantity), parseImportNumber(r.certifiedquantity),
        discipline, system, r.building || "", r.floor || r.level || "", r.area || r.room || "",
        docId, now
      );

      imported++;
      totalAmount += amount;
      if (discipline) disciplines.add(discipline);
      if (system) systems.add(`${discipline}:${system}`);
    }

    if (imported === 0) {
      res.status(400).json({ error: "No rows contained a usable description column" });
      return;
    }

    db.prepare("UPDATE projects SET budget=? WHERE id=?").run(totalAmount, projectId);
    db.prepare("DELETE FROM costs WHERE project_id=? AND category='BOQ / Tender Import'").run(projectId);
    db.prepare("INSERT INTO costs VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), projectId, "BOQ / Tender Import", `Imported ${imported} BOQ lines from ${filename}`, totalAmount, 0, today
    );

    const insertWbs = db.prepare("INSERT INTO wbs_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const d of disciplines) {
      insertWbs.run(crypto.randomUUID(), projectId, null, d.slice(0, 12).toUpperCase(), d, "Discipline", d, "", 1);
    }
    for (const s of systems) {
      const [d, sys] = s.split(":");
      insertWbs.run(crypto.randomUUID(), projectId, null, `${d.slice(0, 6).toUpperCase()}-${sys.slice(0, 6).toUpperCase()}`, sys, "System", d, sys, 1);
    }

    writeAudit(req.user!.user_id, "budget", docId, projectId, "import_boq", null, { file: filename, lines: imported, amount: totalAmount });
    res.status(201).json({
      document_id: docId,
      filename,
      imported_lines: imported,
      tender_amount: totalAmount,
      disciplines: Array.from(disciplines).sort(),
      systems: systems.size,
      project_budget_updated: totalAmount > 0,
    });
  });

  function generateFallbackEngineeringAdvice(drawing: string, zone: string, sub: string, question: string, items: any[]): string {
    const qLower = (question || "").toLowerCase();
    const zoneLower = (zone || "").toLowerCase();
    const subLower = (sub || "").toLowerCase();

    let guidance = `### MEP Site Guidance for ${zone || 'Current Drawing Zone'}\n\n`;

    if (qLower.includes("clearance") || qLower.includes("height") || qLower.includes("tray") || qLower.includes("duct")) {
      guidance += `**Standard MEP Clearance & Coordination Rules:**\n` +
        `- **Ductwork vs. Cable Trays:** Maintain a minimum 150mm (6 in) vertical separation between medium/low voltage cable ladders and insulated HVAC supply/return ducts.\n` +
        `- **Chilled Water / Condensate Lines:** Always run below electrical trunking to prevent condensation drip onto live busways or cable trays.\n` +
        `- **Ceiling Void Clearances:** Minimum 200mm access envelope required below all VAV terminal boxes, fire dampers, and FCU filter access panels.\n` +
        `- **Access Door Dimensions:** Minimum 450x450mm ceiling inspection hatch directly below all motorised dampers.\n\n`;
    } else if (qLower.includes("safety") || qLower.includes("ppe") || qLower.includes("loto") || qLower.includes("hazard") || qLower.includes("switchboard")) {
      guidance += `**Mandatory Site Safety & LOTO (Lockout/Tagout) Protocol:**\n` +
        `- **Live Isolation Verification:** Test with calibrated multimeter & non-contact voltage tester before any physical contact with busways or panelboards.\n` +
        `- **PPE Tier:** Class 2 arc-rated face shield, safety goggles, dielectric boots, and cut-resistant gloves required when working in switchrooms.\n` +
        `- **Work Permit:** Ensure Hot Work or Confined Space permit is signed off by the Site Safety Officer before brazing or entering risers.\n` +
        `- **Fire Suppression Interlock:** Disarm FM-200 / Inergen pneumatic release to manual mode before servicing within server/hub rooms.\n\n`;
    } else if (qLower.includes("valve") || qLower.includes("pipe") || qLower.includes("plumb") || qLower.includes("chilled")) {
      guidance += `**Hydronic & Plumbing Services Routing:**\n` +
        `- **Isolation Valves:** Quarter-turn ball valves with position indicators are installed at each zone take-off branch.\n` +
        `- **Air Vents & Drain Points:** High-point automatic air vents (AAV) and low-point brass drain cocks must remain accessible for hydrostatic pressure testing (tested at 1.5x working pressure).\n` +
        `- **Thermal Insulation:** Ensure continuous vapor barrier on CHW lines; no uninsulated valve necks or hangers causing condensation sweating.\n\n`;
    } else if (qLower.includes("punch") || qLower.includes("snag") || qLower.includes("defect") || qLower.includes("fix")) {
      guidance += `**Zone Defect Resolution Procedure:**\n` +
        `- Review marked-up coordinates against the shop drawing revision.\n` +
        `- Once remedial work is complete, verify compliance with MEP specifications and take a verification photo.\n` +
        `- Update the punch list item status from 'Open' to 'In Progress' or 'Closed' with subcontractor sign-off.\n\n`;
    } else {
      guidance += `**Engineering Overview:**\n` +
        `- **Location:** ${zone || 'General Level'} (${drawing || 'MEP Drawing'})\n` +
        `- **Primary Services:** ${sub || 'HVAC, Electrical Distribution, Fire Protection, and Wet Services'}\n` +
        `- **Trade Coordination:** Ensure structural penetration sleeves are fire-stopped to 2-hour rating (BS 476 / ASTM E814) upon completion of conduit/pipe pulling.\n\n`;
    }

    if (Array.isArray(items) && items.length > 0) {
      guidance += `**Active Snags in this Zone (${items.length}):**\n`;
      items.slice(0, 5).forEach((it: any) => {
        guidance += `- **[${it.priority || 'Medium'}] ${it.item}** (${it.trade} trade) — Status: *${it.status}*\n`;
      });
      guidance += `\n*Ensure all remediation work is verified with photo proof before submitting for consultant sign-off.*`;
    }

    return guidance;
  }

  // AI Drawing Q&A endpoint for site workers
  app.post("/api/drawing/ask-ai", authRequired, async (req: Request, res: Response) => {
    try {
      const {
        project_id,
        drawing_title,
        zone_name,
        zone_sub,
        question,
        image_data,
        open_items
      } = req.body || {};

      if (!question || typeof question !== "string" || !question.trim()) {
        res.status(400).json({ error: "Question is required" });
        return;
      }

      let projectName = "MEP Construction Site";
      if (project_id && project_id !== "ALL") {
        const proj = db.prepare("SELECT name FROM projects WHERE id=?").get(project_id) as any;
        if (proj) projectName = proj.name;
      }

      const contextLines = [
        `Project: ${projectName}`,
        `Drawing / Blueprint: ${drawing_title || "Level 2 - Fitout & Services"}`,
        `Selected Zone / Location: ${zone_name || "General Building Floor"}`,
        zone_sub ? `Services & Equipment in Zone: ${zone_sub}` : "",
      ].filter(Boolean);

      if (Array.isArray(open_items) && open_items.length > 0) {
        contextLines.push(`Current Open Punch Items in this area (${open_items.length}):`);
        open_items.slice(0, 8).forEach((it: any, idx: number) => {
          contextLines.push(`  ${idx + 1}. [${it.priority || 'Medium'}] ${it.item} (Trade: ${it.trade || 'MEP'}, Status: ${it.status || 'Open'})`);
        });
      }

      const prompt = `You are a Lead MEP (Mechanical, Electrical, Plumbing) Construction Superintendent and Senior Site Engineer.
You are answering a question for field workers, trade foremen, plumbers, electricians, or subcontractors working with this architectural / MEP engineering drawing.

Give an authoritative, clear, practical answer tailored for on-site field execution.
- Use clear markdown with bold headers and bullet points.
- Mention specific safety precautions (PPE, lockout/tagout, live line testing, fire safety) when relevant.
- Address clearances, pipe/duct elevations, valve/switch access, and trade coordination.
- If defect or punch items are mentioned, provide practical remediation advice.
- Keep the tone helpful, professional, and safety-first.

Drawing Context:
${contextLines.join("\n")}

Worker Question:
${question}`;

      let aiResponseText = "";
      const apiKey = process.env.GEMINI_API_KEY;

      if (apiKey) {
        try {
          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: {
              headers: {
                "User-Agent": "aistudio-build",
              },
            },
          });

          let contentsPayload: any = prompt;
          if (image_data && typeof image_data === "string" && image_data.startsWith("data:image/")) {
            const matches = image_data.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
            if (matches) {
              contentsPayload = {
                parts: [
                  {
                    inlineData: {
                      mimeType: matches[1],
                      data: matches[2],
                    },
                  },
                  {
                    text: prompt,
                  },
                ],
              };
            }
          }

          try {
            const result = await ai.models.generateContent({
              model: "gemini-3.8-flash",
              contents: contentsPayload,
            });
            aiResponseText = result.text || "";
          } catch (mErr: any) {
            console.warn("Primary model attempt failed, trying gemini-3.6-flash:", mErr?.message);
            const result = await ai.models.generateContent({
              model: "gemini-3.6-flash",
              contents: contentsPayload,
            });
            aiResponseText = result.text || "";
          }
        } catch (apiErr: any) {
          console.warn("Gemini API call warning:", apiErr?.message);
        }
      }

      if (!aiResponseText || !aiResponseText.trim()) {
        aiResponseText = generateFallbackEngineeringAdvice(drawing_title, zone_name, zone_sub, question, open_items);
      }

      res.json({
        answer: aiResponseText,
        zone: zone_name,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      console.error("Drawing AI error:", err);
      res.status(500).json({ error: err.message || "Failed to process question" });
    }
  });

  // Dedicated Drawing Markups endpoints
  app.post("/api/drawings/:id/markups", authRequired, (req: Request, res: Response) => {
    try {
      const { markup_data } = req.body || {};
      const doc = db.prepare("SELECT * FROM documents WHERE id=?").get(req.params.id) as any;
      if (!doc) {
        res.status(404).json({ error: "Drawing not found" });
        return;
      }
      db.prepare("UPDATE documents SET markup_data=? WHERE id=?").run(
        typeof markup_data === "string" ? markup_data : JSON.stringify(markup_data),
        req.params.id
      );
      res.json({ ok: true, id: req.params.id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/drawings/:id", authRequired, (req: Request, res: Response) => {
    try {
      const doc = db.prepare("SELECT * FROM documents WHERE id=?").get(req.params.id) as any;
      if (!doc) {
        res.status(404).json({ error: "Drawing not found" });
        return;
      }
      res.json(doc);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // General AI Chat Endpoint for Senior MEP Engineering Consultation
  app.post("/api/ai/chat", authRequired, async (req: Request, res: Response) => {
    try {
      const { message, question, context } = req.body || {};
      const query = message || question || "How to optimize MEP site execution?";
      const apiKey = process.env.GEMINI_API_KEY;
      let reply = "";

      if (apiKey) {
        try {
          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: { headers: { "User-Agent": "aistudio-build" } }
          });
          const prompt = `You are a Senior Technical Director and Lead MEP Project Manager.
Provide clear, expert, standards-compliant advice (ASHRAE, CIBSE, BS EN, NFPA, IEC, SMACNA).
${MEP_REFERENCE_KNOWLEDGE}
Context: ${JSON.stringify(context || {})}
Question: ${query}`;

          try {
            const result = await ai.models.generateContent({
              model: "gemini-3.8-flash",
              contents: prompt
            });
            reply = result.text || "";
          } catch {
            const result = await ai.models.generateContent({
              model: "gemini-3.6-flash",
              contents: prompt
            });
            reply = result.text || "";
          }
        } catch (e: any) {
          console.warn("AI Chat API call failed:", e?.message);
        }
      }

      if (!reply || !reply.trim()) {
        reply = `### Senior MEP Technical Assessment\nRegarding: **${query}**\n\n1. **Pre-Commissioning & Isolation Check**: Ensure all test manifolds, calibrated gauges (0-16 bar), and isolation blanks are certified with valid test certificates prior to pressurization.\n2. **Sequential Witnessing**: Coordinate joint inspection walk with supervising consultant. Ensure all air release vents are purged and static head is factored into pressure holding tests (1.5x working pressure).\n3. **Safety & Protective Mitigation**: Establish barrier cordons around testing manifolds and verify pressure relief valve calibration tags.`;
      }

      res.json({ reply, answer: reply, timestamp: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Suggest a likely cause + fix for a punch list item, NCR, or any free-text
  // defect description, grounded in the shared MEP defect-pattern reference.
  // Falls back to deterministic keyword matching if no GEMINI_API_KEY is set.
  app.post("/api/ai/suggest-fix", authRequired, async (req: Request, res: Response) => {
    try {
      const { description, trade, discipline } = req.body || {};
      if (!description || !String(description).trim()) {
        res.status(400).json({ error: "description is required" });
        return;
      }
      const tradeHint = trade || discipline || "";
      const apiKey = process.env.GEMINI_API_KEY;
      let suggestion = "";
      let source: "ai" | "reference" = "reference";

      if (apiKey) {
        try {
          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: { headers: { "User-Agent": "aistudio-build" } }
          });
          const patternList = MEP_DEFECT_PATTERNS.map(p => `- [${p.discipline}] ${p.issue}: cause = ${p.likelyCause} | fix = ${p.recommendedFix} | ref = ${p.reference}`).join("\n");
          const prompt = `You are a Senior MEP QA/QC Engineer diagnosing a defect reported on a construction site.
${MEP_REFERENCE_KNOWLEDGE}

Known defect reference patterns (use these as a guide when the description matches; otherwise reason from first principles using the standards above):
${patternList}

Defect description: "${description}"
${tradeHint ? `Trade/discipline hint: ${tradeHint}` : ""}

Respond in this exact format, concise, no preamble:
**Likely cause:** <one or two sentences>
**Recommended fix:** <clear, actionable steps>
**Reference:** <standard or clause, if applicable>`;

          try {
            const result = await ai.models.generateContent({
              model: "gemini-3.8-flash",
              contents: prompt,
            });
            suggestion = result.text || "";
            source = "ai";
          } catch {
            const result = await ai.models.generateContent({
              model: "gemini-3.6-flash",
              contents: prompt,
            });
            suggestion = result.text || "";
            source = "ai";
          }
        } catch (e: any) {
          console.warn("Suggest-fix AI call failed, using reference fallback:", e?.message);
        }
      }

      if (!suggestion || !suggestion.trim()) {
        const fallback = suggestFixFallback(description, tradeHint);
        suggestion = fallback.message;
        source = "reference";
      }

      res.json({ suggestion, source, timestamp: new Date().toISOString() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Analyze an uploaded document (PDF, DOCX, CSV/TXT, or image) and generate
  // a Planner-style board (Buckets -> Tasks -> Checklist) from its content,
  // grounded in the shared MEP reference knowledge. Falls back to a
  // deterministic paragraph/row split when no GEMINI_API_KEY is configured
  // or the AI call fails/returns unusable output. Every generated task keeps
  // a source_excerpt pointing back to the text it came from.
  app.post("/api/documents/:id/analyze", authRequired, async (req: Request, res: Response) => {
    try {
      const docId = req.params.id;
      const doc = db.prepare("SELECT * FROM documents WHERE id=?").get(docId) as any;
      if (!doc) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, doc.project_id)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      if (!canEdit(req.user!, "planner")) {
        res.status(403).json({ error: "No edit access to planner" });
        return;
      }
      if (!doc.attachment_data) {
        res.status(400).json({ error: "This document has no file content to analyze." });
        return;
      }

      const extracted = await extractDocumentText(doc.attachment_data, doc.attachment_name || doc.name);
      if (extracted.kind === "unsupported") {
        res.status(400).json({ error: extracted.reason });
        return;
      }

      type PlannerTask = { title: string; description?: string; trade?: string; priority?: string; due_date?: string | null; source_excerpt?: string; checklist?: string[] };
      type PlannerStructure = { buckets: { name: string; tasks: PlannerTask[] }[] };
      let structure: PlannerStructure | null = null;
      let usedAi = false;

      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        try {
          const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { "User-Agent": "aistudio-build" } } });
          const instruction = `You are analyzing a construction/MEP document to build a Microsoft-Planner-style task board.
${MEP_REFERENCE_KNOWLEDGE}

Break the document content into:
- Buckets: group by discipline/trade or logical document section (e.g. "Electrical", "HVAC", "General Conditions"). Keep bucket names short.
- Tasks: one per discrete, actionable scope item, deliverable, or requirement. Do not invent items the text does not support.
  Each task: title (short), description (1-2 sentences), trade, priority (one of: Urgent, Important, Low), due_date (ONLY if a specific date or duration is explicitly stated in the text - otherwise null, never invent one), source_excerpt (the exact phrase/sentence this task was derived from), checklist (0-4 short sub-step strings, only if the text implies discrete steps or compliance checks - otherwise an empty array).

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{"buckets":[{"name":"string","tasks":[{"title":"string","description":"string","trade":"string","priority":"Urgent|Important|Low","due_date":null,"source_excerpt":"string","checklist":["string"]}]}]}`;

          let contentsPayload: any;
          if (extracted.kind === "image") {
            contentsPayload = {
              parts: [
                { inlineData: { mimeType: extracted.mimeType, data: extracted.base64 } },
                { text: instruction },
              ],
            };
          } else {
            const truncated = extracted.text.slice(0, 15000);
            contentsPayload = `${instruction}\n\nDocument content:\n"""\n${truncated}\n"""`;
          }

          let raw = "";
          try {
            const result = await ai.models.generateContent({ model: "gemini-3.8-flash", contents: contentsPayload });
            raw = result.text || "";
          } catch {
            const result = await ai.models.generateContent({ model: "gemini-3.6-flash", contents: contentsPayload });
            raw = result.text || "";
          }

          const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```\s*$/i, "").trim();
          const parsed = JSON.parse(cleaned);
          if (parsed && Array.isArray(parsed.buckets) && parsed.buckets.length > 0) {
            structure = parsed;
            usedAi = true;
          }
        } catch (e: any) {
          console.warn("Document analyze AI structuring failed, using fallback:", e?.message);
        }
      }

      if (!structure) {
        let items: string[] = [];
        const nameLower = String(doc.attachment_name || doc.name || "").toLowerCase();
        if (extracted.kind === "text") {
          if (nameLower.endsWith(".csv") || nameLower.endsWith(".tsv")) {
            items = extracted.text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0).slice(1, 41);
          } else {
            // pdf-parse inserts "-- N of M --" page-separator artifacts; strip those before splitting.
            const cleanedText = extracted.text.replace(/^--\s*\d+\s*of\s*\d+\s*--$/gm, "");
            let paragraphs = cleanedText.split(/\r?\n\s*\r?\n/).map(p => p.replace(/\s+/g, " ").trim()).filter(p => p.length > 10);
            // Some PDFs extract with a single newline per line rather than blank-line-separated
            // paragraphs, which would otherwise produce one giant blob. If paragraph splitting
            // gives too few usable items, fall back to a per-line split instead.
            if (paragraphs.length <= 1) {
              paragraphs = cleanedText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 10);
            }
            items = paragraphs.slice(0, 40);
          }
        }
        if (items.length === 0) {
          items = ["Review this document manually - no distinct items could be automatically extracted."];
        }
        structure = {
          buckets: [{
            name: "Imported Items",
            tasks: items.map(t => ({ title: t.slice(0, 120), description: t, trade: "", priority: "Important", due_date: null, source_excerpt: t.slice(0, 300), checklist: [] })),
          }],
        };
      }

      const now = new Date().toISOString();
      const createdBuckets: any[] = [];
      let bucketOrder = 0;
      for (const bucket of structure.buckets.slice(0, 20)) {
        const bucketId = crypto.randomUUID();
        db.prepare("INSERT INTO plan_buckets (id, project_id, source_document_id, name, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(bucketId, doc.project_id, docId, String(bucket.name || "Imported Items").slice(0, 100), bucketOrder++, now);

        const createdTasks: any[] = [];
        let taskOrder = 0;
        for (const task of (bucket.tasks || []).slice(0, 60)) {
          const taskId = crypto.randomUUID();
          db.prepare(`INSERT INTO plan_tasks (id, project_id, bucket_id, title, description, trade, priority, status, due_date, assigned_to, source_document_id, source_excerpt, order_index, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(taskId, doc.project_id, bucketId, String(task.title || "Untitled task").slice(0, 200), task.description || "", task.trade || "", task.priority || "Important", "Not Started", task.due_date || null, null, docId, task.source_excerpt || "", taskOrder++, now);

          const createdChecklist: any[] = [];
          let clOrder = 0;
          for (const label of (task.checklist || []).slice(0, 10)) {
            const clId = crypto.randomUUID();
            db.prepare("INSERT INTO plan_task_checklist (id, project_id, task_id, label, is_checked, order_index) VALUES (?, ?, ?, ?, 0, ?)")
              .run(clId, doc.project_id, taskId, String(label).slice(0, 200), clOrder++);
            createdChecklist.push({ id: clId, label, is_checked: 0 });
          }
          createdTasks.push({ id: taskId, title: task.title, description: task.description, trade: task.trade, priority: task.priority, status: "Not Started", due_date: task.due_date || null, source_excerpt: task.source_excerpt, checklist: createdChecklist });
        }
        createdBuckets.push({ id: bucketId, name: bucket.name, tasks: createdTasks });
      }

      writeAudit(req.user!.user_id, "planner", docId, doc.project_id, "analyze_document", null, { bucket_count: createdBuckets.length });

      res.json({ document_id: docId, source: usedAi ? "ai" : "reference", buckets: createdBuckets });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Read the full Planner board for a project in one call: buckets with
  // nested tasks with nested checklist, in display order.
  app.get("/api/projects/:id/planner", authRequired, (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      if (!hasProjectAccess(req.user!, projectId)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      if (!canView(req.user!, "planner")) {
        res.status(403).json({ error: "No view access to planner" });
        return;
      }
      const buckets = db.prepare("SELECT * FROM plan_buckets WHERE project_id=? ORDER BY order_index ASC").all(projectId) as any[];
      const tasks = db.prepare("SELECT * FROM plan_tasks WHERE project_id=? ORDER BY order_index ASC").all(projectId) as any[];
      const checklistRows = db.prepare("SELECT * FROM plan_task_checklist WHERE project_id=? ORDER BY order_index ASC").all(projectId) as any[];

      const checklistByTask: Record<string, any[]> = {};
      for (const c of checklistRows) {
        (checklistByTask[c.task_id] ||= []).push(c);
      }
      const tasksByBucket: Record<string, any[]> = {};
      for (const t of tasks) {
        (tasksByBucket[t.bucket_id] ||= []).push({ ...t, checklist: checklistByTask[t.id] || [] });
      }
      const result = buckets.map(b => ({ ...b, tasks: tasksByBucket[b.id] || [] }));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Generic CRUD for all configured tables
  for (const [table, cfg] of Object.entries(TABLE_CONFIG)) {
    const { cols, module } = cfg;

    // List
    app.get(`/api/${table}`, authRequired, (req, res) => {
      if (!canView(req.user!, module)) {
        res.status(403).json({ error: `No view access to ${module}` });
        return;
      }
      const projectId = req.query.project_id as string;
      let { where, params } = projectScopeSql(req.user!, projectId);
      if (!where) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      if (req.user!.role === "Subcontractor") {
        if (table === "documents" || table === "drawings") {
          where += " AND (documents.subcontractor_id = ? OR documents.id IN (SELECT record_id FROM record_owners WHERE module='documents' AND user_id=?))";
          params.push(req.user!.user_id, req.user!.user_id);
        } else {
          where += " AND (id IN (SELECT record_id FROM record_owners WHERE module=? AND user_id=?) OR id NOT IN (SELECT record_id FROM record_owners WHERE module=?))";
          params.push(module, req.user!.user_id, module);
        }
      }

      const actualTable = table === "drawings" ? "documents" : table === "daily_logs" ? "dailylogs" : table;
      let rows: any[];
      if (actualTable === "documents") {
        rows = db.prepare(`
          SELECT documents.*, users.name as subcontractor_name, users.username as subcontractor_username
          FROM documents
          LEFT JOIN users ON users.id = documents.subcontractor_id
          WHERE ${where}
          ORDER BY documents.date_added DESC
        `).all(...params);
      } else {
        rows = db.prepare(`SELECT * FROM ${actualTable} WHERE ${where}`).all(...params);
      }
      res.json(rows.map(rowToDict));
    });

    // Create
    app.post(`/api/${table}`, authRequired, (req, res) => {
      const data = req.body || {};
      const isDoc = (table === "documents" || table === "drawings") && req.user!.role === "Subcontractor";
      if (!isDoc && !canEdit(req.user!, module)) {
        res.status(403).json({ error: `No edit access to ${module}` });
        return;
      }
      if (!hasProjectAccess(req.user!, data.project_id)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }

      // Normalization helpers for rich MEP fields
      if (table === "punchlist") {
        if (!data.item && data.description) data.item = data.description;
        if (!data.location && data.floor) data.location = data.floor;
        if (!data.date_raised) data.date_raised = new Date().toISOString().slice(0, 10);
      } else if (table === "dailylogs" || table === "daily_logs") {
        if (!data.date && data.log_date) data.date = data.log_date;
        if (!data.notes && data.work_performed) data.notes = data.work_performed;
        if (!data.trade) data.trade = req.user!.specialization || "General MEP";
        if (!data.weather) data.weather = "Clear / Normal";
        if (!data.crew) data.crew = String(data.workers_count || 12);
      } else if (table === "submittals") {
        if (!data.item && data.title) data.item = data.title;
        if (!data.date_submitted) data.date_submitted = new Date().toISOString().slice(0, 10);
        if (!data.due_date) data.due_date = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      } else if (table === "drawings") {
        if (!data.category) data.category = "Drawing";
      }

      const id = crypto.randomUUID();
      data.id = id;
      if (table === "documents" || table === "drawings") {
        if (req.user!.role === "Subcontractor") {
          data.subcontractor_id = req.user!.user_id;
          data.uploaded_by = req.user!.name;
        } else {
          data.uploaded_by = data.uploaded_by || req.user!.name;
          if (!data.subcontractor_id) {
            data.subcontractor_id = null;
          }
        }
      }
      const actualTable = table === "drawings" ? "documents" : table === "daily_logs" ? "dailylogs" : table;
      const values = cols.map(c => (c === "id" ? id : data[c] !== undefined ? data[c] : null));
      const placeholders = cols.map(() => "?").join(",");
      db.prepare(`INSERT INTO ${actualTable} (${cols.join(",")}) VALUES (${placeholders})`).run(...values);
      db.prepare("INSERT OR IGNORE INTO record_owners VALUES (?, ?, ?)").run(module, id, req.user!.user_id);
      writeAudit(req.user!.user_id, module, id, data.project_id, "create", null, data);
      res.status(201).json(data);
    });

    // Update
    app.put(`/api/${table}/:id`, authRequired, (req, res) => {
      const isDoc = (table === "documents" || table === "drawings") && req.user!.role === "Subcontractor";
      if (!isDoc && !canEdit(req.user!, module)) {
        res.status(403).json({ error: `No edit access to ${module}` });
        return;
      }
      const actualTable = table === "drawings" ? "documents" : table === "daily_logs" ? "dailylogs" : table;
      const existing = db.prepare(`SELECT * FROM ${actualTable} WHERE id=?`).get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      if (req.user!.role === "Subcontractor") {
        if (table === "documents" || table === "drawings") {
          const isOwner = Boolean(db.prepare("SELECT 1 FROM record_owners WHERE module='documents' AND record_id=? AND user_id=?").get(req.params.id, req.user!.user_id));
          const isAssigned = existing.subcontractor_id === req.user!.user_id;
          if (!isOwner && !isAssigned) {
            res.status(403).json({ error: "Subcontractors may only change their own documents" });
            return;
          }
        } else if (table === "punchlist" || table === "submittals" || table === "tasks") {
          const isProjectMember = hasProjectAccess(req.user!, existing.project_id);
          if (!isProjectMember) {
            res.status(403).json({ error: "No access to project" });
            return;
          }
        } else {
          const owner = db.prepare("SELECT user_id FROM record_owners WHERE module=? AND record_id=?").get(module, req.params.id) as any;
          if (owner && owner.user_id !== req.user!.user_id) {
            res.status(403).json({ error: "Subcontractors may only change their own records" });
            return;
          }
        }
      }

      const data = req.body || {};
      const editableCols = cols.filter(c => c !== "id" && c !== "project_id");
      const updates: string[] = [];
      const values: any[] = [];
      for (const c of editableCols) {
        if (c in data) {
          updates.push(`${c}=?`);
          values.push(data[c]);
        }
      }
      if (updates.length > 0) {
        values.push(req.params.id);
        db.prepare(`UPDATE ${actualTable} SET ${updates.join(",")} WHERE id=?`).run(...values);
      }
      const updated = db.prepare(`SELECT * FROM ${actualTable} WHERE id=?`).get(req.params.id) as any;

      if ("status" in data && "status" in existing && data.status !== existing.status) {
        db.prepare("INSERT INTO task_status_history VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), existing.project_id, req.params.id, req.user!.name,
          existing.status, data.status, new Date().toISOString(), data.status_comment || null
        );
      }
      writeAudit(req.user!.user_id, module, req.params.id, existing.project_id, "update", existing, updated);
      res.json(rowToDict(updated));
    });

    // Delete
    app.delete(`/api/${table}/:id`, authRequired, (req, res) => {
      const existing = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      const isOwnDoc = table === "documents" && req.user!.role === "Subcontractor" &&
        (existing.subcontractor_id === req.user!.user_id ||
         Boolean(db.prepare("SELECT 1 FROM record_owners WHERE module='documents' AND record_id=? AND user_id=?").get(req.params.id, req.user!.user_id)));

      if (!canDelete(req.user!) && !isOwnDoc) {
        res.status(403).json({ error: "No delete access" });
        return;
      }
      if (!isOwnDoc && !canEdit(req.user!, module)) {
        res.status(403).json({ error: `No edit access to ${module}` });
        return;
      }
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
      db.prepare("DELETE FROM record_owners WHERE module=? AND record_id=?").run(module, req.params.id);
      writeAudit(req.user!.user_id, module, req.params.id, existing.project_id, "delete", existing, null);
      res.json({ ok: true });
    });
  }

  // Vite development middleware or static file serving
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
