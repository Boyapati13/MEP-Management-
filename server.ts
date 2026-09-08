import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import { BOV_MS_PROJECT_SCHEDULE } from "./bov_schedule";

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

function parseImportNumber(val: any): number {
  if (val === null || val === undefined || val === "") return 0.0;
  const num = parseFloat(String(val).replace(/[,€$£]/g, "").trim());
  return isNaN(num) ? 0.0 : num;
}

function hashPassword(password: string): string {
  return crypto.scryptSync(password, "mep_salt_secure", 32).toString("hex");
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash === password) return true;
  try {
    const hashed = hashPassword(password);
    return hashed === storedHash;
  } catch {
    return false;
  }
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
      "dashboard", "tasks", "rfis", "submittals", "punchlist",
      "costs", "budget", "dailylogs", "documents", "report", "projects", "gantt",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "procurement", "material_requests", "risks", "ncrs",
      "commissioning", "handover", "wbs", "audit", "users", "site_today", "calendar", "attendance"
    ],
    edit: [
      "tasks", "rfis", "submittals", "punchlist", "costs", "budget",
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
      "dashboard", "tasks", "rfis", "submittals", "punchlist",
      "costs", "budget", "dailylogs", "documents", "report", "projects", "gantt",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "procurement", "material_requests", "risks", "ncrs",
      "commissioning", "handover", "wbs", "audit", "site_today", "calendar", "attendance"
    ],
    edit: [
      "tasks", "rfis", "submittals", "punchlist", "costs", "budget",
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
      "dashboard", "tasks", "rfis", "submittals", "punchlist",
      "costs", "budget", "dailylogs", "documents", "report", "gantt",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "material_requests", "ncrs", "commissioning",
      "wbs", "site_today", "calendar", "attendance"
    ],
    edit: [
      "tasks", "rfis", "submittals", "punchlist", "dailylogs", "documents",
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
      "handover", "documents", "projects", "gantt", "wbs", "tasks", "submittals"
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
      "site_today", "equipment", "tasks"
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
      "documents", "equipment", "tasks"
    ],
    edit: [
      "safety_incidents", "risks", "inspections", "dailylogs",
      "attendance", "documents"
    ],
    delete: false,
  },
  Subcontractor: {
    view: [
      "dashboard", "tasks", "submittals", "punchlist", "dailylogs", "documents",
      "safety_incidents", "timesheets", "equipment", "dependencies",
      "material_requests", "site_today", "calendar", "attendance"
    ],
    edit: [
      "tasks", "submittals", "punchlist", "dailylogs", "documents", "safety_incidents",
      "timesheets", "dependencies", "material_requests", "attendance"
    ],
    delete: false,
  },
  Consultant: {
    view: [
      "dashboard", "tasks", "gantt", "rfis", "submittals", "punchlist",
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
      token TEXT PRIMARY KEY, user_id TEXT, name TEXT, role TEXT, created_at TEXT
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

  seedUsers();
  seedData();
  ensureMemberships();
}

function seedUsers() {
  const defaults: [string, string, string, string, string, string, string, string, string][] = [
    ["admin", "Siva Boyapati", "admin123", "Admin", "siva.boyapati@skyline-mep.com", "+356 7912 3456", "Skyline Developments", "General MEP", "Active"],
    ["pm_mep", "David Attard", "pm123", "ProjectManager", "david.attard@skyline-mep.com", "+356 7922 4567", "Skyline MEP Contractors", "General MEP", "Active"],
    ["engineer", "Site Engineer", "engineer123", "SiteEngineer", "engineer@skyline-mep.com", "+356 7933 5678", "Skyline MEP Contractors", "HVAC", "Active"],
    ["qs_paul", "Paul Borg", "qs123", "CommercialManager", "paul.borg@skyline-mep.com", "+356 7944 6789", "Skyline Cost Consultants", "Commercial", "Active"],
    ["qa_maria", "Maria Vella", "qa123", "QAQC", "maria.vella@skyline-mep.com", "+356 7955 7890", "Skyline Quality Assurance", "QA/QC", "Active"],
    ["safety_kurt", "Kurt Zammit", "safety123", "SafetyOfficer", "kurt.zammit@skyline-mep.com", "+356 7966 8901", "HSE Site Solutions", "Safety", "Active"],
    ["sub", "CoolAir HVAC Subcontractor", "sub123", "Subcontractor", "operations@coolair-mep.com", "+356 7977 9012", "CoolAir HVAC Ltd", "HVAC", "Active"],
    ["sub_elec", "SparkTech Electrical", "elec123", "Subcontractor", "info@sparktech.com", "+356 7988 0123", "SparkTech Electrical Ltd", "Electrical", "Active"],
    ["sub_plumb", "AquaFlow Plumbing", "plumb123", "Subcontractor", "service@aquaflow.com", "+356 7999 1234", "AquaFlow Mechanical Ltd", "Plumbing", "Active"],
    ["consultant_eng", "Eng. Joseph Grech", "consult123", "Consultant", "jgrech@mep-consultants.eu", "+356 7900 2345", "Grech & Associates MEP", "Consulting", "Active"],
  ];
  const find = db.prepare("SELECT id FROM users WHERE username=?");
  const insert = db.prepare(`
    INSERT INTO users (id, username, name, password_hash, role, email, phone, company, trade, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE users SET name=?, role=?, email=?, phone=?, company=?, trade=?, status=? WHERE username=?
  `);
  const now = new Date().toISOString();
  for (const [username, name, pw, role, email, phone, company, trade, status] of defaults) {
    const existing = find.get(username) as any;
    if (!existing) {
      insert.run(crypto.randomUUID(), username, name, hashPassword(pw), role, email, phone, company, trade, status, now);
    } else {
      update.run(name, role, email, phone, company, trade, status, username);
    }
  }
}

function seedData() {
  // Project 1: St. Julian's Tower - MEP Fitout
  let p1 = db.prepare("SELECT id FROM projects WHERE name LIKE '%St. Julian%'").get() as any;
  let pid1: string;
  if (!p1) {
    pid1 = crypto.randomUUID();
    db.prepare("INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      pid1, "St. Julian's Tower - MEP Fitout", "Skyline Developments", "Active",
      "2026-06-01", "2027-03-31", 850000
    );

    const tasks = [
      ["HVAC ductwork - Level 3-5", "HVAC", "M. Camilleri", "2026-09-01", "2026-09-25", 40, "In Progress"],
      ["Main switchboard installation", "Electrical", "J. Borg", "2026-09-15", "2026-10-05", 0, "Not Started"],
      ["Riser pipework - Level 1-2", "Plumbing", "A. Vella", "2026-08-01", "2026-08-20", 100, "Completed"],
      ["Fire sprinkler rough-in", "Fire Protection", "K. Zammit", "2026-08-25", "2026-09-15", 55, "Delayed"],
      ["BMS controller commissioning", "BMS/Controls", "R. Farrugia", "2026-10-10", "2026-10-30", 0, "Not Started"],
    ];
    const insertTask = db.prepare("INSERT INTO tasks (id, project_id, title, trade, assignee, start, end, progress, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const t of tasks) {
      insertTask.run(crypto.randomUUID(), pid1, ...t);
    }

    db.prepare("INSERT INTO rfis VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), pid1, "RFI-001", "Clarify AHU-3 duct routing clash with structural beam",
      "HVAC", "Site Engineer", "2026-09-02", "2026-09-10", "Open"
    );

    db.prepare("INSERT INTO submittals VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), pid1, "SUB-001", "Chiller unit technical datasheet",
      "HVAC", "2026-08-28", "2026-09-11", "Under Review"
    );

    const punchItems = [
      ["Missing label on DB-4 panel", "Electrical", "Level 2 - Central Corridor", "Medium", "2026-09-03", "Open"],
      ["Vibration isolator misaligned on AHU-02 supply fan", "HVAC", "Level 2 - AHU Plant Room", "High", "2026-09-04", "Open"],
      ["Cable tray bonding jumper missing at Riser A", "Electrical", "Level 2 - Electrical Riser", "Critical", "2026-09-05", "Open"],
      ["CRAC condensate drain pipe uninsulated near rack 3", "HVAC", "Level 2 - Server Room", "High", "2026-09-06", "In Progress"],
      ["Flexible duct kinked at VAV terminal 2-E04", "HVAC", "Level 2 - East Wing", "Medium", "2026-09-07", "Open"],
      ["Sprinkler head escutcheon plate loose above office 214", "Fire Protection", "Level 2 - West Wing", "Low", "2026-09-06", "Resolved"],
      ["Pressure gauge defective on domestic water branch valve", "Plumbing", "Level 2 - Plumbing Riser", "Medium", "2026-09-07", "Open"],
      ["Phase tagging incomplete on Main Incomer busbar", "Electrical", "Level 1 - Main Switchboard Room", "Critical", "2026-09-04", "Open"],
      ["Chilled water pump CHWP-1 gland packing weeping", "Plumbing", "Level 1 - Chilled Water Pumps", "Medium", "2026-09-05", "Open"],
      ["Emergency trip push button cover missing", "Electrical", "Basement - Switchgear & Generators", "High", "2026-09-03", "Open"],
      ["Chiller-1 acoustic shroud bracket loose", "HVAC", "Roof - Chillers & Exhaust", "Low", "2026-09-02", "Closed"]
    ];
    for (const p of punchItems) {
      db.prepare("INSERT INTO punchlist (id, project_id, item, trade, location, priority, date_raised, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        crypto.randomUUID(), pid1, p[0], p[1], p[2], p[3], p[4], p[5]
      );
    }

    db.prepare("INSERT INTO dailylogs VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), pid1, "2026-09-05", "HVAC", "Sunny", 12,
      "Continued ductwork installation Level 4. No delays."
    );

    const costs = [
      ["HVAC", "Chiller units + ductwork", 220000, 198000, "2026-08-30"],
      ["Electrical", "Switchgear + cabling", 180000, 192000, "2026-08-30"],
      ["Plumbing", "Riser + fixtures", 95000, 88000, "2026-08-30"],
      ["Fire Protection", "Sprinkler system", 110000, 115000, "2026-08-30"],
    ];
    const insertCost = db.prepare("INSERT INTO costs VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const c of costs) {
      insertCost.run(crypto.randomUUID(), pid1, ...c);
    }

    db.prepare("INSERT INTO change_orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), pid1, "CO-001", "Add BMS points for Level 5 fan coils", "BMS/Controls",
      "Client requested extra monitoring points", 8500, 5, "2026-09-01", "Pending"
    );

    db.prepare("INSERT INTO purchase_orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), pid1, "PO-1001", "CoolAir Supplies Ltd", "HVAC",
      "AHU-3 replacement filters + belts", 4200, "2026-08-20", "2026-09-10", "Ordered"
    );

    db.prepare("INSERT INTO safety_incidents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), pid1, "2026-09-04", "Electrical", "Near Miss", "Medium",
      "Unlabeled live cable found during ceiling works", "Cable isolated and labeled same day", "Closed"
    );

    db.prepare("INSERT INTO inspections VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), pid1, "2026-09-06", "Fire Protection", "Pressure Test",
      "K. Zammit", "Pass", "Sprinkler rough-in held 200psi for 2 hours, no drop."
    );

    db.prepare("INSERT INTO meeting_minutes VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), pid1, "2026-09-05", "Weekly Coordination", "PM, Site Engineer, MEP Subs",
      "Level 3-5 HVAC progress + AHU-3 clash", "Agreed RFI-001 to be resolved by structural by Sep 10."
    );

    db.prepare("INSERT INTO timesheets VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), pid1, "2026-09-05", "M. Camilleri", "HVAC", "Ductwork Level 4", 8
    );

    db.prepare("INSERT INTO equipment VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(), pid1, "Scissor Lift #2", "Access Equipment", "M. Camilleri", "In Use",
      "On Level 4 for ductwork installation"
    );
  } else {
    pid1 = p1.id;
  }

  // Project 2: Marina Bay Commercial Centre
  let p2 = db.prepare("SELECT id FROM projects WHERE name LIKE '%Marina Bay%'").get() as any;
  let pid2: string;
  if (!p2) {
    pid2 = crypto.randomUUID();
    db.prepare("INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      pid2, "Marina Bay Commercial Centre", "Apex Properties", "Active",
      "2026-07-01", "2027-06-30", 620000
    );

    const p2Tasks = [
      ["Basement drainage pump sump install", "Plumbing", "A. Vella", "2026-09-05", "2026-09-28", 25, "In Progress"],
      ["Primary water supply main tie-in", "Plumbing", "A. Vella", "2026-09-15", "2026-10-10", 0, "Not Started"],
    ];
    const insertTask = db.prepare("INSERT INTO tasks (id, project_id, title, trade, assignee, start, end, progress, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const t of p2Tasks) {
      insertTask.run(crypto.randomUUID(), pid2, ...t);
    }
  } else {
    pid2 = p2.id;
  }

  // Project 3: BOV St. Venera - Level 1 and Level 2 Refurbishment (Job 2618)
  let p3 = db.prepare("SELECT id FROM projects WHERE name LIKE '%BOV St. Venera%'").get() as any;
  let pid3: string;
  if (!p3) {
    pid3 = crypto.randomUUID();
    db.prepare("INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      pid3, "BOV St. Venera - Level 1 & 2 Refurbishment", "Bank of Valletta plc (Enser Ltd)", "Active",
      "2026-05-05", "2026-11-30", 185000
    );
  } else {
    pid3 = p3.id;
    // Clear existing tasks to force re-seed with detailed schedule
    db.prepare("DELETE FROM tasks WHERE project_id = ?").run(pid3);
  }

  // Seed tasks
  const insertTask = db.prepare("INSERT INTO tasks (id, project_id, title, trade, assignee, start, end, progress, status, wbs_code, duration, is_summary, is_milestone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const t of BOV_MS_PROJECT_SCHEDULE) {
    insertTask.run(
      crypto.randomUUID(),
      pid3,
      t.title,
      t.trade,
      t.assignee,
      t.start,
      t.end,
      t.progress,
      t.status,
      t.wbs_code,
      t.duration,
      t.is_summary,
      t.is_milestone
    );
  }

  // Load user records
  const adminUser = db.prepare("SELECT id, name FROM users WHERE username='admin'").get() as any;
  const engUser = db.prepare("SELECT id, name FROM users WHERE username='engineer'").get() as any;
  const subHvac = db.prepare("SELECT id, name FROM users WHERE username='sub'").get() as any;
  const subElec = db.prepare("SELECT id, name FROM users WHERE username='sub_elec'").get() as any;
  const subPlumb = db.prepare("SELECT id, name FROM users WHERE username='sub_plumb'").get() as any;

  // Strict Project Access: Assign different subcontractors to each project
  const setMem = db.prepare(`
    INSERT INTO project_memberships (user_id, project_id, access_role, active)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, project_id) DO UPDATE SET access_role=excluded.access_role, active=excluded.active
  `);

  if (adminUser) {
    setMem.run(adminUser.id, pid1, "Project Manager", 1);
    setMem.run(adminUser.id, pid2, "Project Manager", 1);
  }
  if (engUser) {
    setMem.run(engUser.id, pid1, "Site Engineer", 1);
    setMem.run(engUser.id, pid2, "Site Engineer", 1);
  }
  // Subcontractor isolation across projects:
  // CoolAir HVAC -> St. Julian's Tower ONLY
  if (subHvac) {
    setMem.run(subHvac.id, pid1, "Subcontractor", 1);
    setMem.run(subHvac.id, pid2, "Subcontractor", 0);
  }
  // SparkTech Electrical -> St. Julian's Tower ONLY
  if (subElec) {
    setMem.run(subElec.id, pid1, "Subcontractor", 1);
    setMem.run(subElec.id, pid2, "Subcontractor", 0);
  }
  // AquaFlow Plumbing -> Marina Bay ONLY
  if (subPlumb) {
    setMem.run(subPlumb.id, pid1, "Subcontractor", 0);
    setMem.run(subPlumb.id, pid2, "Subcontractor", 1);
  }

  // Seed documents with explicit subcontractor scoping
  const sampleDocs = [
    // Project 1 - General (no subcontractor)
    {
      pid: pid1,
      name: "MEP Coordination Drawing Rev C",
      category: "Drawing",
      rev: "C",
      date: "2026-08-15",
      subId: null,
      uploader: engUser?.name || "Site Engineer",
      uploaderId: engUser?.id || adminUser?.id,
    },
    // Project 1 - CoolAir HVAC Subcontractor Documents
    {
      pid: pid1,
      name: "HVAC Ductwork Shop Drawings - Level 3-5",
      category: "Drawing",
      rev: "B",
      date: "2026-08-22",
      subId: subHvac?.id,
      uploader: subHvac?.name || "CoolAir HVAC Subcontractor",
      uploaderId: subHvac?.id,
    },
    {
      pid: pid1,
      name: "Chiller Plant Commissioning & Pressure Certificate",
      category: "Report",
      rev: "1.0",
      date: "2026-08-29",
      subId: subHvac?.id,
      uploader: subHvac?.name || "CoolAir HVAC Subcontractor",
      uploaderId: subHvac?.id,
    },
    // Project 1 - SparkTech Electrical Subcontractor Documents
    {
      pid: pid1,
      name: "Main Switchboard Single Line Diagram",
      category: "Drawing",
      rev: "C",
      date: "2026-08-20",
      subId: subElec?.id,
      uploader: subElec?.name || "SparkTech Electrical",
      uploaderId: subElec?.id,
    },
    {
      pid: pid1,
      name: "Cable Insulation Resistance Test Report",
      category: "Report",
      rev: "1.2",
      date: "2026-09-02",
      subId: subElec?.id,
      uploader: subElec?.name || "SparkTech Electrical",
      uploaderId: subElec?.id,
    },
    // Project 2 - AquaFlow Plumbing Subcontractor Documents
    {
      pid: pid2,
      name: "Potable Water & Drainage Riser Schematics",
      category: "Drawing",
      rev: "A",
      date: "2026-08-18",
      subId: subPlumb?.id,
      uploader: subPlumb?.name || "AquaFlow Plumbing",
      uploaderId: subPlumb?.id,
    },
    {
      pid: pid2,
      name: "Hydrostatic Pipe Pressure Test Log",
      category: "Report",
      rev: "1.0",
      date: "2026-09-01",
      subId: subPlumb?.id,
      uploader: subPlumb?.name || "AquaFlow Plumbing",
      uploaderId: subPlumb?.id,
    },
    // Project 2 - General Specification
    {
      pid: pid2,
      name: "Commercial Centre Base Building Specification",
      category: "Specification",
      rev: "2.0",
      date: "2026-08-10",
      subId: null,
      uploader: engUser?.name || "Site Engineer",
      uploaderId: engUser?.id || adminUser?.id,
    },
    // Project 3: BOV St. Venera Tender & Technical Specifications (Job 2618)
    {
      pid: pid3,
      name: "BOV St. Venera - Full Tender & Technical Specifications (Job 2618)",
      category: "Specification",
      rev: "0",
      date: "2026-05-05",
      subId: null,
      uploader: "Enser Ltd / Building Services Engineers",
      uploaderId: adminUser?.id,
    },
    {
      pid: pid3,
      name: "2618-S-ELE-01: Electrical Schematic (UPS, UP0, DB1, DB2, UP1, UP2)",
      category: "Drawing",
      rev: "Tender",
      date: "2026-05-05",
      subId: null,
      uploader: "Enser Ltd / Consulting Engineers",
      uploaderId: adminUser?.id,
    },
    {
      pid: pid3,
      name: "2618-L-LTG-01: Level 1 & 2 Lighting Layout & Schedule (Types A to I)",
      category: "Drawing",
      rev: "Tender",
      date: "2026-05-05",
      subId: null,
      uploader: "Enser Ltd / Consulting Engineers",
      uploaderId: adminUser?.id,
    },
    {
      pid: pid3,
      name: "2618-L-PWR-01: Level 1 & 2 Small Power & Desk Servicing Layout",
      category: "Drawing",
      rev: "Tender",
      date: "2026-05-05",
      subId: null,
      uploader: "Enser Ltd / Consulting Engineers",
      uploaderId: adminUser?.id,
    },
    {
      pid: pid3,
      name: "2618-L-DTA-01: Data & Audio Visual Layout (GOP Boxes, HDMI AOC)",
      category: "Drawing",
      rev: "Tender",
      date: "2026-05-05",
      subId: null,
      uploader: "Enser Ltd / Consulting Engineers",
      uploaderId: adminUser?.id,
    },
    {
      pid: pid3,
      name: "2618-L-SEC-01: Security Layout (Card Readers & Intruder Alarms)",
      category: "Drawing",
      rev: "Tender",
      date: "2026-05-05",
      subId: null,
      uploader: "Enser Ltd / Consulting Engineers",
      uploaderId: adminUser?.id,
    },
    {
      pid: pid3,
      name: "2618-L-CTV-01: CCTV Layout (Surveillance & Monitored Points)",
      category: "Drawing",
      rev: "Tender",
      date: "2026-05-05",
      subId: null,
      uploader: "Enser Ltd / Consulting Engineers",
      uploaderId: adminUser?.id,
    },
    {
      pid: pid3,
      name: "2618-L-FAS-01: Fire Alarm & Fire Fighting Layout",
      category: "Drawing",
      rev: "Tender",
      date: "2026-05-05",
      subId: null,
      uploader: "Enser Ltd / Consulting Engineers",
      uploaderId: adminUser?.id,
    },
    {
      pid: pid3,
      name: "2618-L-CON-01: Containment, Cable Trays & Trunking Layout",
      category: "Drawing",
      rev: "Tender",
      date: "2026-05-05",
      subId: null,
      uploader: "Enser Ltd / Consulting Engineers",
      uploaderId: adminUser?.id,
    },
    {
      pid: pid3,
      name: "2618-L-ACO-01: Air Conditioning Layout (VRF Cassettes & Splits)",
      category: "Drawing",
      rev: "Tender",
      date: "2026-05-05",
      subId: null,
      uploader: "Enser Ltd / Consulting Engineers",
      uploaderId: adminUser?.id,
    },
    {
      pid: pid3,
      name: "2618-L-VEN-01: Ventilation & Motorised Volume Dampers Layout",
      category: "Drawing",
      rev: "Tender",
      date: "2026-05-05",
      subId: null,
      uploader: "Enser Ltd / Consulting Engineers",
      uploaderId: adminUser?.id,
    },
  ];

  const checkDoc = db.prepare("SELECT id FROM documents WHERE project_id=? AND name=?");
  const insertDoc = db.prepare(`
    INSERT INTO documents (id, project_id, name, category, revision, date_added, attachment_name, attachment_data, subcontractor_id, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateDoc = db.prepare(`
    UPDATE documents SET subcontractor_id=?, uploaded_by=? WHERE id=?
  `);
  const insertOwner = db.prepare("INSERT OR IGNORE INTO record_owners VALUES ('documents', ?, ?)");

  for (const doc of sampleDocs) {
    if (!doc.pid) continue;
    const existing = checkDoc.get(doc.pid, doc.name) as any;
    if (!existing) {
      const docId = crypto.randomUUID();
      insertDoc.run(
        docId, doc.pid, doc.name, doc.category, doc.rev, doc.date,
        `${doc.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`, null, doc.subId || null, doc.uploader
      );
      if (doc.uploaderId) {
        insertOwner.run(docId, doc.uploaderId);
      }
    } else {
      updateDoc.run(doc.subId || null, doc.uploader, existing.id);
      if (doc.uploaderId) {
        insertOwner.run(existing.id, doc.uploaderId);
      }
    }
  }

  // Seed authentic BOV St. Venera BOQ items if not already present
  const bovBoqCount = db.prepare("SELECT count(*) as c FROM boq_items WHERE project_id=?").get(pid3) as any;
  if (bovBoqCount.c === 0) {
    const insertBoq = db.prepare("INSERT INTO boq_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const nowStr = new Date().toISOString();
    const bovItems = [
      ["1.0", "Risk assessment, method statement, health & safety (RAMS) provisions", "L/S", 1, 2500, 2500, "Preliminaries", "RAMS", "All Levels", "Building"],
      ["2.0", "Submittal of coordinated working drawings prior to site works", "L/S", 1, 3200, 3200, "Preliminaries", "Shop Drawings", "All Levels", "Offices"],
      ["3.0", "Scaffolding, staging and certified access platforms", "L/S", 1, 1800, 1800, "Preliminaries", "Safety", "All Levels", "Building"],
      ["4.0", "Dismantling and carting away redundant electrical & data items to legal dump", "L/S", 1, 4500, 4500, "Preliminaries", "Demolition", "Level 1 & 2", "Refurbishment"],
      ["1.01", "Supply & install electrical distribution panel UP0 per DB schedule", "No", 1, 6200, 6200, "Electrical", "Panels", "Level 1", "Server Room"],
      ["2.01", "Schneider Isobar 4c RCBO & MCB retrofits in DB1, DB2, UP1, UP2", "No", 4, 1200, 4800, "Electrical", "Panels", "Level 1 & 2", "Risers"],
      ["3.01", "Supply & install 63A 4P IP65 rotary isolators", "No", 2, 180, 360, "Electrical", "Containment", "Level 1 & 2", "Plant"],
      ["5.01", "CU/XLPE/LSZH Cables (C04-C11 10sqmm, 6sqmm, 2.5sqmm)", "m", 29, 50, 1450, "Electrical", "Cables", "Level 1 & 2", "Risers"],
      ["8.01", "Lighting points in PVC conduit with LSZH wiring (130 No)", "No", 130, 50, 6500, "Electrical", "Lighting", "Level 1 & 2", "Offices"],
      ["8.03", "Emergency lighting points with 3-hr battery autonomy (26 No)", "No", 26, 65, 1690, "Electrical", "Emergency Lighting", "Level 1 & 2", "Escape Routes"],
      ["8.09", "Twin socket outlets 13A white plastic finish (67 No)", "No", 67, 70, 4690, "Electrical", "Small Power", "Level 1 & 2", "Desks"],
      ["8.13", "Switched fused connection units (FCUs) with pilot lamp (43 No)", "No", 43, 60, 2580, "Electrical", "Small Power", "Level 1 & 2", "Offices"],
      ["10.0", "Floor-to-ceiling power poles for desk clusters (10 No)", "No", 10, 520, 5200, "Electrical", "Desk Servicing", "Level 1 & 2", "Open Plan"],
      ["11.0", "GST 3pin connector couplers (1in3out & 1in2out) (27 No)", "No", 27, 75, 2025, "Electrical", "Desk Servicing", "Level 1 & 2", "Desks"],
      ["14.0", "Desk combination units (4 sockets, USB-A/C quick charge) (82 No)", "No", 82, 120, 9840, "Electrical", "Desk Servicing", "Level 1 & 2", "Desks"],
      ["15.01", "Type A 60x60cm Flat Panel LED Light Fittings (4000K, 3200lm) (77 No)", "No", 77, 150, 11550, "Electrical", "Light Fittings", "Level 1 & 2", "Offices"],
      ["15.02", "Type B Round Recessed LED Downlights (150mm, 2100lm) (31 No)", "No", 31, 120, 3720, "Electrical", "Light Fittings", "Level 1 & 2", "Meeting Rooms"],
      ["15.03", "Type C PushDim Dimmable Round LED Fittings (200mm, 2600lm) (6 No)", "No", 6, 180, 1080, "Electrical", "Light Fittings", "Level 1 & 2", "Boardrooms"],
      ["15.05", "Type E1 Emergency Non-Maintained LED 3-hr IP65 (20 No)", "No", 20, 140, 2800, "Electrical", "Emergency Lighting", "Level 1 & 2", "Corridors"],
      ["15.06", "Type E2 Emergency Exit Sign with Pictogram 3-hr IP65 (6 No)", "No", 6, 175, 1050, "Electrical", "Emergency Lighting", "Level 1 & 2", "Exits"],
      ["4.01", "Cat 6 F/UTP foil-shielded structured cabling for WiFi APs", "m", 400, 2.5, 1000, "Data & ELV", "Structured Cabling", "Level 1 & 2", "Soffit"],
      ["6.01", "Cat 6 U/UTP structured cabling for general desk & GOP points", "m", 3070, 2.2, 6754, "Data & ELV", "Structured Cabling", "Level 1 & 2", "Cable Trays"],
      ["2.01", "Grid Outlet Position (GOP) boxes (4, 6, 8, 12, 16 way) (10 No)", "No", 10, 280, 2800, "Data & ELV", "GOP", "Level 1 & 2", "Underfloor"],
      ["12.0", "TV Distribution System: 2x 6-Port HDMI DAs & Active Optical (AOC) HDMI for 11 TVs", "L/S", 1, 5400, 5400, "Data & ELV", "AV & TV", "Level 1 & 2", "Meeting & Wallboards"],
      ["16.0", "Commercial 100V Sound System: amplifier, Bluetooth wall receiver & 6 ceiling speakers", "L/S", 1, 3100, 3100, "Data & ELV", "Sound", "Level 1 & 2", "Offices"],
      ["1.01", "Monolithic 20kVA UPS system with internal 10-year VRLA batteries (10 min autonomy)", "No", 1, 16500, 16500, "UPS", "Central UPS", "Level 1", "Server Room"],
      ["3.01", "5-Year UPS Maintenance Contract (4 quarterly visits/year per schedule)", "years", 5, 1200, 6000, "UPS", "Maintenance", "Level 1", "Server Room"],
      ["18.0", "BS 7671 Testing & Commissioning and As-Fitted CAD/PDF drawings and O&M manuals", "L/S", 1, 4200, 4200, "Quality & Handover", "Commissioning", "All Levels", "Building"]
    ];

    for (const item of bovItems) {
      insertBoq.run(
        crypto.randomUUID(), pid3, item[0], item[1], item[2], item[3], item[4], item[5],
        item[3], 0, 0, 0, item[6], item[7], "Main Building", item[8], item[9], null, nowStr
      );
    }
  }
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

  // Subcontractor memberships
  const subHvac = db.prepare("SELECT id FROM users WHERE username='sub'").get() as any;
  const subElec = db.prepare("SELECT id FROM users WHERE username='sub_elec'").get() as any;
  const subPlumb = db.prepare("SELECT id FROM users WHERE username='sub_plumb'").get() as any;
  const p1 = db.prepare("SELECT id FROM projects WHERE name LIKE '%St. Julian%'").get() as any;
  const p2 = db.prepare("SELECT id FROM projects WHERE name LIKE '%Marina Bay%'").get() as any;
  if (subHvac && p1) insert.run(subHvac.id, p1.id);
  if (subElec && p1) insert.run(subElec.id, p1.id);
  if (subPlumb && p2) insert.run(subPlumb.id, p2.id);
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
    const user = db.prepare("SELECT * FROM users WHERE username=?").get(username) as any;
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }
    if (user.status === "Inactive") {
      res.status(403).json({ error: "Your account is marked Inactive by the administrator. Contact high-level administration." });
      return;
    }
    const token = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      db.prepare("UPDATE users SET last_login=? WHERE id=?").run(now, user.id);
    } catch {}
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)").run(
      token, user.id, user.name, user.role, now
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
    const uRow = db.prepare("SELECT email, company, trade, status FROM users WHERE id=?").get(user.user_id) as any;
    res.json({
      user_id: user.user_id,
      name: user.name,
      role: user.role,
      email: uRow?.email || "",
      company: uRow?.company || "",
      trade: uRow?.trade || "",
      status: uRow?.status || "Active",
      permissions: ROLE_PERMS[user.role] || ROLE_PERMS.SiteEngineer,
    });
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
    db.prepare("DELETE FROM users WHERE id=?").run(req.params.id);
    db.prepare("DELETE FROM project_memberships WHERE user_id=?").run(req.params.id);
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.params.id);
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
    db.prepare("DELETE FROM projects WHERE id=?").run(id);
    db.prepare("DELETE FROM project_memberships WHERE project_id=?").run(id);
    for (const table of Object.keys(TABLE_CONFIG)) {
      db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(id);
    }
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
    db.prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      docId, projectId, filename, "BOQ / Tender", "Imported", today, filename, attData
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
          const specKnowledge = `
Project Context & Engineering Specifications:
Tender: BOV St. Venera Level 1 and Level 2 Refurbishment - Electrical & ELV Installation (Job No. 2618, Enser Ltd Building Services Engineers).
Key Clauses & Specifications:
1. General Conditions:
   - Clause 7: Contractor's All Risks Policy up to €500,000.
   - Clause 9: Delay in Completion: Liquidated damages of 1% from Contract Price per day of delay up to a maximum of 15% of contract.
   - Clause 11: Defects after Taking Over: 12 months warranty from full completion certificate.
   - Clause 14.1: Interim Certificate of Payment: minimum €10,000 (excluding VAT) or postponed > 2 months. Engineer measurement certificate fee 1%.
   - Clause 17: Practical Completion: Final acceptance requires all snags covered, all as-fitted drawings corrected and supplied with test certificates.
2. Section 2.1 Electrical Installation:
   - Standards: BS 7671 (IET Wiring Regs 18th Edition), IEC 60364, Enemalta LN225/2010. 400V +10%/-6% 50Hz, 4-wire TN-S system.
   - Panels: UP0 (new), DB1, DB2, UP1, UP2 (retrofits using Schneider Isobar 4c compatible single module RCBOs / MCBs).
   - Cables: CU/XLPE/LSZH (C04 to C11, 10sqmm, 6sqmm, 2.5sqmm) and single core H07Z-K / multicore H07ZZ-F.
   - Cable Spacing & Ties (Clause 9.1.2): Up to 9mm dia: 600mm horizontal, 800mm vertical, 3mm tie. 10-15mm dia: 350mm horiz, 450mm vert, 5mm tie. 16-20mm dia: 450mm horiz, 550mm vert, 6mm tie. Above 20mm dia: 450mm horiz, 600mm vert, 9mm tie. Black nylon ties (-15°C to 60°C, >20kg breaking load).
   - Conduit: UPVC BS4607-1/BS6099-1, saddles max 1.25m apart. Minimum 150mm separation from water pipes in chases. Min 35mm cover in concrete, 5mm in plaster.
   - Desk Servicing: 10 floor-to-ceiling power poles, 20A GST 3-pin couplers (1in3out & 1in2out), combination units (4 switched sockets, 1 USB-A, 1 USB-C quick charge), 2-channel vertebrae cable management spine.
   - Light Fitting Schedule: Type A (60x60cm LED panel 4000K 3200lm), Type B (150mm round 2100lm), Type C (200mm round 2600lm PushDim dimmable), Type D (100mm round 1200lm), Type E1 (emergency non-maintained 6W 3hr IP65 IK08), Type E2 (emergency exit sign with pictogram 3hr IP65), Type F (linear 4000lm), Type G (100mm round 600lm), Type H (bulkhead 3000K 1000lm IP65), Type I (step light 600lm).
   - BS 7671 Sequence of Tests (Clause 15.1): Reg 612.2.1 continuity of protective bonding, 612.2.2 ring final circuits, 612.3 insulation resistance, 612.4.4 barrier/enclosure, 612.6 polarity, 612.7 earth electrode resistance, 612.8 disconnection, 612.9 earth fault loop impedance, 612.10 RCD tripping, 612.11 prospective fault current, 612.12 phase sequence, 612.13 functional, 612.14 voltage drop.
3. Section 2.2 Extra Low Voltage & Data:
   - Cat 6 U/UTP and Cat 6 F/UTP (shielded for WiFi APs), 23AWG LSZH, 110-style IDC blocks, GOP boxes (4, 6, 8, 12, 16 way).
   - TV Distribution: 2 No. 6-Port HDMI distribution amplifiers with Active Optical HDMI (AOC) cables for 11 TVs (10 ceiling mounted, 4 wall mounted).
   - Sound System: 100V line commercial amplifier (+20% speaker expansion), Bluetooth wall receiver with Push-to-Pair, 6 ceiling speakers (80Hz-18kHz, 120° dispersion, 100V line multi-taps).
4. Section 2.3 UPS Installation:
   - 20kVA standalone or 15kVA modular scalable to 25kVA, 10-year design life VRLA maintenance-free batteries for 10 min autonomy at 100% load, N+1 redundancy, 5-year maintenance contract with quarterly visits.
`;
          const prompt = `You are a Senior Technical Director and Lead MEP Project Manager.
Provide clear, expert, standards-compliant advice (ASHRAE, CIBSE, BS EN, NFPA, IEC, SMACNA).
${specKnowledge}
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
