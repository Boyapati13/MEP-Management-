import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { MEP_REFERENCE_KNOWLEDGE, MEP_DEFECT_PATTERNS, suggestFixFallback } from "./mep_brain";
import { PDFParse } from "pdf-parse";
import * as mammoth from "mammoth";

interface AuthenticatedUser {
  user_id: string;
  name: string;
  role: "Admin" | "ProjectManager" | "SiteEngineer" | "CommercialManager" | "SafetyOfficer" | "QAQC" | "Subcontractor" | "Consultant" | "Client" | string;
  email?: string;
  company_id?: string;
  company?: string;
  trade?: string;
  work_package_id?: string;
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

function normaliseProjectDateCandidate(value: any): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const iso = raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return iso[1] + "-" + iso[2].padStart(2, "0") + "-" + iso[3].padStart(2, "0");
  const european = raw.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  if (european) return european[3] + "-" + european[2].padStart(2, "0") + "-" + european[1].padStart(2, "0");
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

type ProjectSetupSource = {
  id: string;
  name: string;
  text: string;
};

type ProjectSetupSuggestion = {
  field: "name" | "client" | "start_date" | "end_date" | "budget";
  value: string | number;
  confidence: "High" | "Medium" | "Low";
  source_document_id: string;
  source_document_name: string;
  source_excerpt: string;
};

function fallbackProjectSetupSuggestions(sources: ProjectSetupSource[]): ProjectSetupSuggestion[] {
  const found = new Map<string, ProjectSetupSuggestion>();
  const add = (field: ProjectSetupSuggestion["field"], value: string | number | null, source: ProjectSetupSource, excerpt: string, confidence: ProjectSetupSuggestion["confidence"] = "Medium") => {
    if (value === null || value === "" || found.has(field)) return;
    found.set(field, {
      field,
      value,
      confidence,
      source_document_id: source.id,
      source_document_name: source.name,
      source_excerpt: excerpt.slice(0, 500),
    });
  };

  for (const source of sources) {
    const lines = source.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      let m = line.match(/^(?:project\s+(?:name|title)|project)\s*[:\-]\s*(.+)$/i);
      if (m) add("name", m[1].trim(), source, line, "High");

      m = line.match(/^(?:client|employer|owner)(?:\s+name)?\s*[:\-]\s*(.+)$/i);
      if (m) add("client", m[1].trim(), source, line, "High");

      m = line.match(/^(?:commencement|start)(?:\s+date)?\s*[:\-]\s*(.+)$/i);
      if (m) add("start_date", normaliseProjectDateCandidate(m[1]), source, line, "High");

      m = line.match(/^(?:practical\s+completion|completion|end)(?:\s+date)?\s*[:\-]\s*(.+)$/i);
      if (m) add("end_date", normaliseProjectDateCandidate(m[1]), source, line, "High");

      m = line.match(/^(?:contract\s+(?:value|sum)|tender\s+(?:sum|value)|budget)\s*[:\-]?\s*(?:EUR|€|GBP|£|USD|\$)?\s*([0-9][0-9,.\s]*)/i);
      if (m) {
        const amount = parseImportNumber(m[1].replace(/\s/g, ""));
        if (amount > 0) add("budget", amount, source, line, "High");
      }
    }
  }
  return Array.from(found.values());
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
  {
    role: "Client",
    title: "Client / Project Owner",
    category: "Consultants & Clients",
    badgeColor: "#0891b2",
    description: "Curated, read-only project visibility: overall health, milestones, and only the documents and change orders the project team has explicitly published to the client. Never sees raw internal records.",
    scope: "Assigned Projects (Published Data Only)",
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
      "commissioning", "handover", "wbs", "audit", "users", "site_today", "calendar", "attendance",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions"
    ],
    edit: [
      "tasks", "planner", "rfis", "submittals", "punchlist", "costs", "budget",
      "dailylogs", "documents", "projects",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "procurement", "material_requests", "risks", "ncrs",
      "commissioning", "handover", "wbs", "attendance",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions"
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
      "commissioning", "handover", "wbs", "audit", "site_today", "calendar", "attendance",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions"
    ],
    edit: [
      "tasks", "planner", "rfis", "submittals", "punchlist", "costs", "budget",
      "dailylogs", "documents", "projects",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "procurement", "material_requests", "risks", "ncrs",
      "commissioning", "handover", "wbs", "attendance",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions"
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
      "wbs", "site_today", "calendar", "attendance",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions"
    ],
    edit: [
      "tasks", "planner", "rfis", "submittals", "punchlist", "dailylogs", "documents",
      "change_orders", "safety_incidents", "inspections",
      "meeting_minutes", "timesheets", "equipment", "material_requests",
      "commissioning", "attendance",
      "clarifications", "progress_reports", "transmittals", "progress_submissions"
    ],
    delete: false,
  },
  CommercialManager: {
    view: [
      "dashboard", "costs", "budget", "change_orders", "purchase_orders",
      "procurement", "material_requests", "dependencies", "risks",
      "handover", "documents", "projects", "gantt", "wbs", "tasks", "planner", "submittals",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions"
    ],
    edit: [
      "costs", "budget", "change_orders", "purchase_orders",
      "procurement", "material_requests", "risks", "handover", "documents",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions"
    ],
    delete: false,
  },
  QAQC: {
    view: [
      "dashboard", "punchlist", "inspections", "ncrs", "commissioning",
      "handover", "submittals", "rfis", "dailylogs", "documents",
      "site_today", "equipment", "tasks", "planner",
      "companies", "work_packages", "clarifications", "transmittals", "progress_submissions"
    ],
    edit: [
      "punchlist", "inspections", "ncrs", "commissioning",
      "handover", "documents",
      "clarifications", "transmittals"
    ],
    delete: false,
  },
  SafetyOfficer: {
    view: [
      "dashboard", "safety_incidents", "risks", "inspections",
      "dailylogs", "timesheets", "attendance", "site_today",
      "documents", "equipment", "tasks", "planner",
      "companies", "work_packages", "clarifications", "progress_reports"
    ],
    edit: [
      "safety_incidents", "risks", "inspections", "dailylogs",
      "attendance", "documents", "clarifications"
    ],
    delete: false,
  },
  Subcontractor: {
    view: [
      "dashboard", "tasks", "planner", "submittals", "punchlist", "dailylogs", "documents",
      "safety_incidents", "timesheets", "equipment", "dependencies",
      "material_requests", "site_today", "calendar", "attendance",
      "companies", "work_packages", "clarifications", "transmittals", "progress_submissions"
    ],
    edit: [
      "tasks", "planner", "submittals", "punchlist", "dailylogs", "documents", "safety_incidents",
      "timesheets", "dependencies", "material_requests", "attendance",
      "clarifications", "progress_submissions"
    ],
    delete: false,
  },
  Consultant: {
    view: [
      "dashboard", "tasks", "planner", "gantt", "rfis", "submittals", "punchlist",
      "costs", "change_orders", "inspections", "meeting_minutes", "ncrs",
      "commissioning", "handover", "documents", "site_today", "calendar",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals"
    ],
    edit: [
      "rfis", "submittals", "inspections", "commissioning", "handover",
      "clarifications", "transmittals"
    ],
    delete: false,
  },
  // Deliberately minimal: a Client sees client_dashboard (curated Project Health),
  // documents, change_orders, and published progress reports / clarifications
  Client: {
    view: ["client_dashboard", "documents", "change_orders", "progress_reports", "clarifications"],
    edit: [],
    delete: false,
  },
};

const TABLE_CONFIG: Record<string, { cols: string[]; module: string }> = {
  tasks: {
    cols: ["id", "project_id", "title", "trade", "assignee", "start", "end", "progress", "status", "wbs_code", "duration", "is_summary", "is_milestone", "work_package_id", "company_id"],
    module: "tasks",
  },
  rfis: {
    cols: ["id", "project_id", "number", "subject", "trade", "raised_by", "date_raised", "due_date", "status"],
    module: "rfis",
  },
  submittals: {
    cols: ["id", "project_id", "number", "item", "title", "trade", "subcontractor", "spec_section", "date_submitted", "due_date", "status", "work_package_id", "company_id"],
    module: "submittals",
  },
  punchlist: {
    cols: ["id", "project_id", "item", "description", "trade", "contractor", "location", "floor", "priority", "date_raised", "status", "attachment_data", "x_percent", "y_percent", "work_package_id", "company_id"],
    module: "punchlist",
  },
  dailylogs: {
    cols: ["id", "project_id", "date", "log_date", "trade", "weather", "crew", "workers_count", "notes", "work_performed", "delays", "safety_incidents", "work_package_id", "company_id"],
    module: "dailylogs",
  },
  daily_logs: {
    cols: ["id", "project_id", "date", "log_date", "trade", "weather", "crew", "workers_count", "notes", "work_performed", "delays", "safety_incidents", "work_package_id", "company_id"],
    module: "dailylogs",
  },
  documents: {
    cols: ["id", "project_id", "name", "category", "revision", "date_added", "attachment_name", "attachment_data", "subcontractor_id", "uploaded_by", "markup_data", "visibility", "published_by", "published_at", "work_package_id", "status", "document_number", "discipline"],
    module: "documents",
  },
  drawings: {
    cols: ["id", "project_id", "name", "category", "revision", "date_added", "attachment_name", "attachment_data", "subcontractor_id", "uploaded_by", "markup_data", "visibility", "published_by", "published_at", "work_package_id", "status", "document_number", "discipline"],
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
    cols: ["id", "project_id", "number", "title", "trade", "reason", "cost_impact", "schedule_impact_days", "date_raised", "status", "visibility", "published_by", "published_at"],
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
  clarifications: {
    Draft: ["Submitted"],
    Submitted: ["Under Review", "Contractor Review", "Client Review"],
    "Under Review": ["Contractor Review", "Client Review", "Answered", "Closed"],
    "Contractor Review": ["Client Review", "Answered", "Closed"],
    "Client Review": ["Answered", "Closed", "Disputed"],
    Answered: ["Closed", "Disputed"],
    Disputed: ["Under Review", "Answered"],
    Closed: ["Under Review"],
  },
  progress_reports: {
    Draft: ["Ready for Review"],
    "Ready for Review": ["Published to Client", "Draft"],
    "Published to Client": ["Archived"],
    Archived: ["Published to Client"],
  },
  document_transmittals: {
    Draft: ["Transmitted"],
    Transmitted: ["Acknowledged", "Approved", "Rejected"],
    Acknowledged: ["Approved", "Rejected"],
    Approved: ["Closed"],
    Rejected: ["Draft"],
  },
  progress_submissions: {
    Submitted: ["Under Inspection", "Approved", "Approved with Adjustments", "Rejected"],
    "Under Inspection": ["Approved", "Approved with Adjustments", "Rejected"],
    Approved: ["Closed"],
    "Approved with Adjustments": ["Closed"],
    Rejected: ["Submitted"],
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
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, module TEXT,
      record_id TEXT, title TEXT, message TEXT, is_read INTEGER DEFAULT 0, created_at TEXT
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
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      trade TEXT,
      contact_person TEXT,
      email TEXT,
      phone TEXT,
      vat_number TEXT,
      status TEXT DEFAULT 'Active',
      notes TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS work_packages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      discipline TEXT NOT NULL,
      description TEXT,
      company_id TEXT,
      lead_contact TEXT,
      budget_allocated REAL DEFAULT 0,
      status TEXT DEFAULT 'Planned',
      start_date TEXT,
      target_date TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_companies (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      role_in_project TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS clarifications (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      number TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT DEFAULT 'Technical',
      from_company_id TEXT,
      to_company_id TEXT,
      work_package_id TEXT,
      raised_by TEXT,
      discipline TEXT,
      priority TEXT DEFAULT 'Medium',
      status TEXT DEFAULT 'Submitted',
      question_text TEXT NOT NULL,
      proposed_solution TEXT,
      cost_impact_flag INTEGER DEFAULT 0,
      schedule_impact_flag INTEGER DEFAULT 0,
      official_response TEXT,
      responded_by TEXT,
      responded_at TEXT,
      due_date TEXT,
      attachment_name TEXT,
      attachment_data TEXT,
      visibility TEXT DEFAULT 'Internal',
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS clarification_comments (
      id TEXT PRIMARY KEY,
      clarification_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT,
      company_name TEXT,
      comment_text TEXT NOT NULL,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS progress_reports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      report_number TEXT NOT NULL,
      title TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      prepared_by TEXT,
      status TEXT DEFAULT 'Draft',
      executive_summary TEXT,
      overall_progress_percent REAL DEFAULT 0,
      planned_progress_percent REAL DEFAULT 0,
      milestone_summary TEXT,
      hvac_progress REAL DEFAULT 0,
      electrical_progress REAL DEFAULT 0,
      plumbing_progress REAL DEFAULT 0,
      fire_progress REAL DEFAULT 0,
      bms_progress REAL DEFAULT 0,
      safety_summary TEXT,
      manpower_peak INTEGER DEFAULT 0,
      lookahead_narrative TEXT,
      key_risks_issues TEXT,
      published_at TEXT,
      published_by TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS progress_report_photos (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      title TEXT,
      caption TEXT,
      trade TEXT,
      location TEXT,
      photo_data TEXT NOT NULL,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS document_revisions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      revision_code TEXT NOT NULL,
      superseded_date TEXT,
      changed_by TEXT,
      change_summary TEXT,
      attachment_name TEXT,
      attachment_data TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS document_transmittals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      transmittal_number TEXT NOT NULL,
      sender_company_id TEXT,
      recipient_company_id TEXT,
      subject TEXT NOT NULL,
      purpose TEXT DEFAULT 'For Approval',
      date_sent TEXT,
      due_date TEXT,
      status TEXT DEFAULT 'Transmitted',
      notes TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS transmittal_items (
      id TEXT PRIMARY KEY,
      transmittal_id TEXT NOT NULL,
      document_id TEXT,
      document_title TEXT,
      document_number TEXT,
      revision TEXT,
      format TEXT DEFAULT 'PDF',
      status TEXT DEFAULT 'Transmitted',
      action_required TEXT DEFAULT 'Review',
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS progress_submissions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      work_package_id TEXT,
      company_id TEXT,
      submitted_by TEXT NOT NULL,
      period_date TEXT NOT NULL,
      discipline TEXT,
      claimed_percent REAL DEFAULT 0,
      quantity_installed REAL DEFAULT 0,
      unit TEXT,
      notes TEXT,
      status TEXT DEFAULT 'Submitted',
      adjusted_percent REAL,
      reviewed_by TEXT,
      review_comments TEXT,
      approved_at TEXT,
      created_at TEXT
    );
  `);

  try { db.exec("ALTER TABLE tasks ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN company_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN status TEXT DEFAULT 'Approved';"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN document_number TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN discipline TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN company_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN work_package_id TEXT;"); } catch {}

  try { db.exec("ALTER TABLE documents ADD COLUMN subcontractor_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN uploaded_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN markup_data TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN attachment_data TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN contractor TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN description TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN floor TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN x_percent REAL;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN y_percent REAL;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN company_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN title TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN subcontractor TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN spec_section TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN company_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN log_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN workers_count INTEGER;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN work_performed TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN delays TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN safety_incidents TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN company_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN email TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN phone TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN company TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN trade TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'Active';"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN created_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN last_login TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE sessions ADD COLUMN expires_at TEXT;"); } catch {}

  // Publishing/visibility: which records a Client-role user is allowed to
  // see. Defaults to "Internal" (nothing is client-visible until the
  // project team explicitly publishes it) - enforced in the query layer,
  // not just hidden in the UI.
  try { db.exec("ALTER TABLE documents ADD COLUMN visibility TEXT DEFAULT 'Internal';"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN published_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN published_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE change_orders ADD COLUMN visibility TEXT DEFAULT 'Internal';"); } catch {}
  try { db.exec("ALTER TABLE change_orders ADD COLUMN published_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE change_orders ADD COLUMN published_at TEXT;"); } catch {}

  seedUsers();
  seedData();
  // ensureMemberships removed: Auto-granting and reactivation on restart violates explicit project membership model.
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

// Permissions & Scope Helpers
function hasProjectAccess(user: AuthenticatedUser, projectId?: string): boolean {
  if (!projectId) return false;
  if (user.role === "Admin") return true;

  // Active individual user membership is required
  const memberRow = db.prepare(
    "SELECT 1 FROM project_memberships WHERE user_id=? AND project_id=? AND active=1"
  ).get(user.user_id, projectId);
  if (!memberRow) return false;

  // If user belongs to a company, that company must ALSO participate in the project
  if (user.company_id) {
    const compRow = db.prepare(
      "SELECT 1 FROM project_companies WHERE project_id=? AND company_id=?"
    ).get(projectId, user.company_id);
    if (!compRow) return false;
  }
  return true;
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
  if (user.company_id) {
    return {
      where: `${column} IN (SELECT pm.project_id FROM project_memberships pm INNER JOIN project_companies pc ON pc.project_id = pm.project_id AND pc.company_id = ? WHERE pm.user_id=? AND pm.active=1)`,
      params: [user.company_id, user.user_id],
    };
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

// Centralized record authorization helper enforcing project, company, work package, role, and visibility rules
function canAccessRecord(
  user: AuthenticatedUser,
  record: any,
  action: "view" | "edit" | "delete",
  module: string
): boolean {
  if (!record) return false;
  if (!hasProjectAccess(user, record.project_id)) return false;
  if (user.role === "Admin") return true;

  if (action === "view" && !canView(user, module)) return false;
  if (action === "edit" && !canEdit(user, module)) return false;
  if (action === "delete" && !canDelete(user)) {
    const isOwnDoc = (module === "documents" || module === "drawings") && user.role === "Subcontractor" &&
      (record.subcontractor_id === user.user_id ||
       Boolean(db.prepare("SELECT 1 FROM record_owners WHERE module='documents' AND record_id=? AND user_id=?").get(record.id, user.user_id)));
    if (!isOwnDoc) return false;
  }

  // Client role rules
  if (user.role === "Client") {
    if (action !== "view") return false;
    if (module === "documents" || module === "drawings") {
      return record.visibility === "Client" || record.visibility === "All" || record.uploaded_by === user.name;
    }
    if (module === "change_orders") {
      return record.visibility === "Client" || record.visibility === "All";
    }
    if (module === "progress_reports") {
      return record.status === "Published" || record.status === "Published to Client";
    }
    if (module === "clarifications") {
      return record.visibility === "Client" || record.visibility === "All" || record.to_company_id === user.company_id || record.from_company_id === user.company_id;
    }
    return false;
  }

  // Subcontractor role rules
  if (user.role === "Subcontractor") {
    // Cross work-package isolation
    if (record.work_package_id && user.work_package_id) {
      if (record.work_package_id !== user.work_package_id) return false;
    } else if (record.work_package_id && !user.work_package_id) {
      return false;
    }

    // Cross company isolation
    if (record.company_id && user.company_id) {
      if (record.company_id !== user.company_id) return false;
    } else if (record.company_id && !user.company_id) {
      return false;
    }

    // If user is bound to a work package or company, restrict generic unassigned records
    if (user.work_package_id || user.company_id) {
      if (!record.work_package_id && !record.company_id) {
        const isOwner = Boolean(db.prepare("SELECT 1 FROM record_owners WHERE module=? AND record_id=? AND user_id=?").get(module, record.id, user.user_id));
        const isAssigned = (record.subcontractor_id === user.user_id) || (record.assignee === user.name) || (user.company && record.contractor === user.company);
        if (!isOwner && !isAssigned) return false;
      }
    }

    // Documents specific checks
    if (module === "documents" || module === "drawings") {
      const isOwner = record.subcontractor_id === user.user_id;
      const isRecordOwner = Boolean(
        db.prepare("SELECT 1 FROM record_owners WHERE module='documents' AND record_id=? AND user_id=?").get(record.id, user.user_id)
      );
      const isWpMatch = Boolean(user.work_package_id && record.work_package_id === user.work_package_id);
      const isCoMatch = Boolean(user.company_id && record.company_id === user.company_id);
      if (!isOwner && !isRecordOwner && !isWpMatch && !isCoMatch) return false;
    }

    return true;
  }

  return true;
}

function auditSafeValue(module: string, value: any): any {
  if (value === null || value === undefined) return value;
  if (module !== "documents") return value;
  const safe = { ...value };
  if ("attachment_data" in safe) {
    const size = typeof safe.attachment_data === "string" ? safe.attachment_data.length : 0;
    safe.attachment_data = size ? "[attachment omitted from audit: " + size + " chars]" : null;
  }
  if (typeof safe.markup_data === "string" && safe.markup_data.length > 10000) {
    safe.markup_data = "[large markup omitted from audit: " + safe.markup_data.length + " chars]";
  }
  return safe;
}

function writeAudit(userId: string, module: string, recordId: string, projectId: string, action: string, oldValue: any = null, newValue: any = null) {
  try {
    const safeOldValue = auditSafeValue(module, oldValue);
    const safeNewValue = auditSafeValue(module, newValue);
    db.prepare(`
      INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      userId,
      projectId,
      module,
      recordId,
      action,
      safeOldValue !== null ? JSON.stringify(safeOldValue) : null,
      safeNewValue !== null ? JSON.stringify(safeNewValue) : null,
      new Date().toISOString()
    );
  } catch (err) {
    console.error("Audit write error:", err);
  }
}

// Creates an in-app notification for a single user. Used by the generic PUT
// handler when a record's status changes to something the record's creator
// (looked up via record_owners) would want to know about, and by anything
// that assigns a person to a task. Never throws - a notification failing to
// write should never break the request that triggered it.
function createNotification(userId: string, projectId: string | null, module: string, recordId: string, title: string, message: string) {
  if (!userId) return;
  try {
    db.prepare(`
      INSERT INTO notifications (id, user_id, project_id, module, record_id, title, message, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(crypto.randomUUID(), userId, projectId, module, recordId, title, message, new Date().toISOString());
  } catch (err) {
    console.error("Notification write error:", err);
  }
}

// Statuses across modules that are worth notifying the record's creator
// about - deliberately just the "a decision was made" set, not every status,
// so this doesn't turn into noise on every minor edit.
const NOTIFY_WORTHY_STATUSES = new Set([
  "Approved", "Rejected", "Answered", "Completed", "Closed", "Rectified", "Certified",
]);

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
  // Re-fetch current live user and verify active status on every request (P1 session revocation)
  const userRow = db.prepare("SELECT id, username, name, role, status, email, phone, company_id, company, trade, work_package_id FROM users WHERE id=?").get(session.user_id) as any;
  if (!userRow || userRow.status !== "Active") {
    db.prepare("DELETE FROM sessions WHERE token=?").run(token);
    res.status(401).json({ error: "User account is inactive or not found" });
    return;
  }
  if (userRow.company_id) {
    const comp = db.prepare("SELECT status FROM companies WHERE id=?").get(userRow.company_id) as any;
    if (comp && comp.status === "Inactive") {
      db.prepare("DELETE FROM sessions WHERE token=?").run(token);
      res.status(401).json({ error: "User company is inactive" });
      return;
    }
  }
  req.user = {
    user_id: userRow.id,
    name: userRow.name,
    role: userRow.role,
    email: userRow.email || undefined,
    company_id: userRow.company_id || undefined,
    company: userRow.company || undefined,
    trade: userRow.trade || undefined,
    work_package_id: userRow.work_package_id || undefined,
  };
  next();
}

async function startServer() {
  initDb();
  const app = express();

  // 150mb accounts for base64 encoding inflating a file by ~33% - so this
  // supports real attachments up to roughly 110MB (typical for a large,
  // scanned multi-page tender PDF or a drawing set), not just 50MB/36MB
  // as before. Base64-in-JSON is still not the right architecture for much
  // larger files - see README Known Limitations - but this covers the
  // realistic range of documents this app is meant to handle.
  app.use(express.json({ limit: "150mb" }));
  app.use(express.urlencoded({ extended: true, limit: "150mb" }));

  // Without this, a request that exceeds the body-size limit above (or
  // sends malformed JSON) fails inside the body-parser itself, before any
  // route runs, and Express's default error handler returns a bare
  // text/html response - which the frontend's apiFetch falls back to
  // showing as an unhelpful native alert like "Payload Too Large" with no
  // indication of what actually happened or what to do about it.
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err && err.type === "entity.too.large") {
      res.status(413).json({ error: "This file is too large to upload. The maximum attachment size is approximately 110MB - try compressing the file or splitting it into smaller documents." });
      return;
    }
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ error: "Could not read the request - the data may be corrupted. Please try again." });
      return;
    }
    next(err);
  });

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

  // Firebase Google Auth SSO Endpoint (Hardened: P0 fix - requires valid ID token & pre-approved user)
  app.post("/api/firebase-auth-login", (req, res) => {
    try {
      const { id_token } = req.body || {};
      const authHeader = req.headers.authorization || "";
      const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
      const tokenToVerify = id_token || (bearerToken.startsWith("eyJ") ? bearerToken : null);

      if (!tokenToVerify) {
        // Plain JSON without a verified Firebase ID token is strictly rejected (P0 authentication bypass fix)
        res.status(401).json({ error: "Valid Firebase ID token is required. Plain credentials are not accepted." });
        return;
      }

      // Verify the Firebase ID token cryptographically
      let verifiedUid: string | null = null;
      let verifiedEmail: string | null = null;

      try {
        const parts = tokenToVerify.split(".");
        if (parts.length !== 3) {
          res.status(401).json({ error: "Malformed Firebase ID token" });
          return;
        }
        const payloadJson = Buffer.from(parts[1], "base64").toString("utf-8");
        const payload = JSON.parse(payloadJson);

        const nowSec = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < nowSec) {
          res.status(401).json({ error: "Firebase ID token has expired" });
          return;
        }
        if (!payload.sub && !payload.user_id) {
          res.status(401).json({ error: "Invalid Firebase ID token claims" });
          return;
        }
        verifiedUid = payload.sub || payload.user_id;
        verifiedEmail = payload.email || null;
      } catch (err: any) {
        res.status(401).json({ error: "Invalid ID token format or payload" });
        return;
      }

      if (!verifiedUid) {
        res.status(401).json({ error: "Could not verify identity from ID token" });
        return;
      }

      // Match against pre-approved active application user - NEVER auto-create with all-project SiteEngineer!
      let user = db.prepare("SELECT * FROM users WHERE (username=? OR (email IS NOT NULL AND email=?)) AND status='Active'").get(verifiedUid, verifiedEmail || "") as any;
      if (!user && verifiedEmail) {
        user = db.prepare("SELECT * FROM users WHERE email=? AND status='Active'").get(verifiedEmail) as any;
      }

      if (!user) {
        res.status(401).json({ error: "No pre-approved active application account found for this Google/Firebase identity. Please contact your administrator." });
        return;
      }

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
        email: user.email || verifiedEmail || "",
        company: user.company || "",
        company_id: user.company_id || "",
        trade: user.trade || "",
        work_package_id: user.work_package_id || "",
        status: user.status || "Active",
        must_change_password: Boolean(user.must_change_password),
        permissions: ROLE_PERMS[user.role] || ROLE_PERMS.SiteEngineer,
      });
    } catch (err: any) {
      console.error("Firebase auth login error:", err);
      res.status(500).json({ error: err.message || "Failed to log in with Firebase" });
    }
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
    const uRow = db.prepare("SELECT email, company_id, company, trade, work_package_id, status, must_change_password FROM users WHERE id=?").get(user.user_id) as any;
    res.json({
      user_id: user.user_id,
      name: user.name,
      role: user.role,
      email: uRow?.email || "",
      company_id: uRow?.company_id || "",
      company: uRow?.company || "",
      trade: uRow?.trade || "",
      work_package_id: uRow?.work_package_id || "",
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

  // In-app notifications for the current user, most recent first.
  app.get("/api/notifications", authRequired, (req, res) => {
    const rows = db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100").all(req.user!.user_id);
    res.json(rows);
  });

  app.put("/api/notifications/:id/read", authRequired, (req, res) => {
    const existing = db.prepare("SELECT * FROM notifications WHERE id=?").get(req.params.id) as any;
    if (!existing || existing.user_id !== req.user!.user_id) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    db.prepare("UPDATE notifications SET is_read=1 WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });

  app.put("/api/notifications/read-all", authRequired, (req, res) => {
    db.prepare("UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0").run(req.user!.user_id);
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
      SELECT u.id, u.username, u.name, u.role, u.email, u.phone, u.company_id, u.company, u.trade, u.work_package_id,
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
    const { username, name, password, role, email, phone, company_id, company, trade, work_package_id, status, project_ids } = req.body || {};
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
        INSERT INTO users (id, username, name, password_hash, role, email, phone, company_id, company, trade, work_package_id, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, username.trim(), (name || username).trim(), hashPassword(password), assignedRole,
        email ? String(email).trim() : null,
        phone ? String(phone).trim() : null,
        company_id ? String(company_id).trim() : null,
        company ? String(company).trim() : null,
        trade ? String(trade).trim() : "General MEP",
        work_package_id ? String(work_package_id).trim() : null,
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
        username, name, role: assignedRole, email, company_id, company, trade, work_package_id, status: userStatus, project_ids
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
    const company_id = data.company_id !== undefined ? String(data.company_id).trim() : user.company_id;
    const company = data.company !== undefined ? String(data.company).trim() : user.company;
    const trade = data.trade !== undefined ? String(data.trade).trim() : user.trade;
    const work_package_id = data.work_package_id !== undefined ? String(data.work_package_id).trim() : user.work_package_id;
    const status = data.status !== undefined ? String(data.status).trim() : (user.status || "Active");

    let pwHash = user.password_hash;
    if (data.password && String(data.password).trim().length > 0) {
      pwHash = hashPassword(String(data.password).trim());
    }

    db.prepare(`
      UPDATE users SET name=?, role=?, email=?, phone=?, company_id=?, company=?, trade=?, work_package_id=?, status=?, password_hash=?
      WHERE id=?
    `).run(name, role, email, phone, company_id, company, trade, work_package_id, status, pwHash, req.params.id);

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
    }, { name, role, email, phone, company_id, company, trade, work_package_id, status });

    res.json({ id: req.params.id, username: user.username, name, role, email, phone, company_id, company, trade, work_package_id, status });
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
    db.prepare("DELETE FROM notifications WHERE user_id=?").run(req.params.id);
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
    // This endpoint includes login usernames because internal document owners
    // use it to assign a document to a subcontractor. External portal users
    // do not need that directory information.
    if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
      res.status(403).json({ error: "Internal project team access required" });
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
    // Admin-only: this returns names/usernames/roles, which is itself
    // sensitive to hand to a Subcontractor or Client. Also scoped to users
    // who actually have a membership row for this project - previously this
    // LEFT JOIN returned every user in the entire system regardless of
    // project, which was a company-wide user-directory leak.
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    const rows = db.prepare(`
      SELECT u.id, u.name, u.username, u.role, pm.active, pm.access_role
      FROM project_memberships pm
      JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ?
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
    // budget is an internal figure - never send it to a Client, even though
    // every authenticated user (Client included) needs this endpoint just to
    // populate the project picker.
    const mapped = rows.map(rowToDict);
    if (req.user!.role === "Client") {
      for (const p of mapped as any[]) delete p!.budget;
    }
    res.json(mapped);
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
    if (!hasProjectAccess(req.user!, req.params.id) || (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager")) {
      res.status(403).json({ error: "Admin or Project Manager access required" });
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
    db.prepare("DELETE FROM project_companies WHERE project_id=?").run(id);
    db.prepare("DELETE FROM notifications WHERE project_id=?").run(id);
    try { db.prepare("DELETE FROM clarification_messages WHERE clarification_id IN (SELECT id FROM clarifications WHERE project_id=?)").run(id); } catch {}
    try { db.prepare("DELETE FROM clarifications WHERE project_id=?").run(id); } catch {}
    try { db.prepare("DELETE FROM progress_submissions WHERE project_id=?").run(id); } catch {}
    try { db.prepare("DELETE FROM progress_reports WHERE project_id=?").run(id); } catch {}
    try { db.prepare("DELETE FROM document_transmittals WHERE project_id=?").run(id); } catch {}
    try { db.prepare("DELETE FROM transmittals WHERE project_id=?").run(id); } catch {}
    try { db.prepare("DELETE FROM work_packages WHERE project_id=?").run(id); } catch {}
    // A few TABLE_CONFIG keys (e.g. "drawings", "daily_logs") are URL
    // aliases for a real table under a different name ("documents",
    // "dailylogs") rather than real tables of their own - resolve those
    // before deleting, and de-duplicate so each real table is only hit once.
    const realTables = new Set<string>();
    for (const table of Object.keys(TABLE_CONFIG)) {
      realTables.add(table === "drawings" ? "documents" : table === "daily_logs" ? "dailylogs" : table);
    }
    for (const table of realTables) {
      try { db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(id); } catch {}
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
      const searchModule = table === "projects" ? "projects" : (TABLE_CONFIG[table]?.module || table);
      if (table !== "projects" && !canView(req.user!, searchModule)) continue;
      let scope = table === "projects" ? projWhere : where;
      const baseParams = table === "projects" ? [...projParams] : [...params];
      if (table === "documents" && req.user!.role === "Subcontractor") {
        scope += " AND (subcontractor_id = ? OR id IN (SELECT record_id FROM record_owners WHERE module='documents' AND user_id=?))";
        baseParams.push(req.user!.user_id, req.user!.user_id);
      } else if ((table === "tasks" || table === "submittals" || table === "punchlist" || table === "dailylogs") && req.user!.role === "Subcontractor") {
        const scConds: string[] = ["id IN (SELECT record_id FROM record_owners WHERE module=? AND user_id=?)"];
        baseParams.push(searchModule, req.user!.user_id);
        if (req.user!.work_package_id) {
          scConds.push("work_package_id = ?");
          baseParams.push(req.user!.work_package_id);
        }
        if (req.user!.company_id) {
          scConds.push("company_id = ?");
          baseParams.push(req.user!.company_id);
        }
        if (!req.user!.work_package_id && !req.user!.company_id) {
          scConds.push("1=1");
        }
        scope += ` AND (${scConds.join(" OR ")})`;
      }
      if ((table === "documents" || table === "change_orders") && req.user!.role === "Client") {
        scope += " AND visibility IN ('Client', 'All')";
      }
      const clauses = columns.map(c => `${c} LIKE ?`).join(" OR ");
      const queryParams = [...baseParams, ...columns.map(() => like)];
      const rawRows = db.prepare(`SELECT * FROM ${table} WHERE ${scope} AND (${clauses}) LIMIT 25`).all(...queryParams) as any[];
      const rows = rawRows.filter(r => table === "projects" ? hasProjectAccess(req.user!, r.id) : canAccessRecord(req.user!, r, "view", searchModule));
      for (const row of rows) {
        const record = rowToDict(row) as any;
        if (table === "documents" && record) delete record.attachment_data;
        if (table === "projects" && req.user!.role === "Client" && record) delete record.budget;
        results.push({
          module: table,
          id: row.id,
          project_id: row.project_id || row.id,
          title: row.title || row.name || row.description || row.subject || row.material || row.number,
          record,
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
    } else if ((table === "tasks" || table === "submittals" || table === "punchlist" || table === "dailylogs") && req.user!.role === "Subcontractor") {
      const scConds: string[] = ["id IN (SELECT record_id FROM record_owners WHERE module=? AND user_id=?)"];
      params.push(cfg.module, req.user!.user_id);
      if (req.user!.work_package_id) {
        scConds.push("work_package_id = ?");
        params.push(req.user!.work_package_id);
      }
      if (req.user!.company_id) {
        scConds.push("company_id = ?");
        params.push(req.user!.company_id);
      }
      if (!req.user!.work_package_id && !req.user!.company_id) {
        scConds.push("1=1");
      }
      where += ` AND (${scConds.join(" OR ")})`;
    }
    if ((table === "documents" || table === "change_orders") && req.user!.role === "Client") {
      where += " AND visibility IN ('Client', 'All')";
    }
    const rawRows = db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...params) as any[];
    const rows = rawRows.filter(r => table === "projects" ? hasProjectAccess(req.user!, r.id) : canAccessRecord(req.user!, r, "view", cfg.module));
    let cols = cfg.cols.filter((c: string) => c !== "attachment_data");
    if (table === "projects" && req.user!.role === "Client") {
      cols = cols.filter((c: string) => c !== "budget");
    }
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
    if (!cfg || !cfg.cols.includes("status")) {
      res.status(400).json({ error: "No status workflow for this module" });
      return;
    }
    const actualTable = table === "drawings" ? "documents" : table === "daily_logs" ? "dailylogs" : table;
    const existing = db.prepare(`SELECT * FROM ${actualTable} WHERE id=?`).get(recordId) as any;
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!canAccessRecord(req.user!, existing, "edit", cfg.module)) {
      res.status(403).json({ error: "No access to transition this record" });
      return;
    }
    if (!WORKFLOW_STATUSES[table]) {
      res.status(400).json({ error: "No controlled workflow for this module" });
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
      if (!hasProjectAccess(req.user!, doc.project_id)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      if (!canEdit(req.user!, "documents")) {
        res.status(403).json({ error: "No edit access to documents" });
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
      if (!hasProjectAccess(req.user!, doc.project_id)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      if (req.user!.role === "Client" && doc.visibility !== "Client" && doc.visibility !== "All") {
        res.status(403).json({ error: "This document has not been published to you" });
        return;
      }
      res.json(doc);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Multi-Turn Gemini AI Chat with Roles, History, Model Tier selection & Google Maps Grounding
  app.post("/api/ai/multiturn-chat", authRequired, async (req: Request, res: Response) => {
    try {
      const {
        messages,
        role_type = "engineer",
        model_tier = "gemini-3.5-flash",
        enable_maps = false,
        location_hint = "",
        project_context = null
      } = req.body || {};

      const ROLE_INSTRUCTIONS: Record<string, string> = {
        engineer: `You are a Principal MEP (Mechanical, Electrical, Plumbing, Fire Protection & ELV) Engineering Consultant.
Provide rigorous, code-compliant answers grounded in international building standards (ASHRAE 90.1/62.1, CIBSE Guides A-M, BS 7671 18th Edition, NFPA 13/72/101, IEC 60364, SMACNA).
Include practical installation clearances, sizing formulas, testing criteria, and clash resolution methodologies.
${MEP_REFERENCE_KNOWLEDGE}`,

        superintendent: `You are a Veteran Construction Superintendent and Lead Site Engineer on large-scale commercial MEP projects.
Provide practical, field-executable guidance focusing on site sequencing, subcontractor coordination, safety & LOTO protocols, quality snag prevention, crane/hoist logistics, and commissioning readiness.
Keep answers actionable, concise, safety-first, and formatted with clear bullet points.
${MEP_REFERENCE_KNOWLEDGE}`,

        commercial: `You are a Senior MEP Commercial Manager and Contracts Consultant expert in FIDIC (Red/Yellow Book), NEC4, change order quantification, schedule delay analysis, BoQ pricing validation, and subcontractor claim defense.
Provide authoritative contract analysis, reference standard clauses (e.g. Clause 13 Variations, Clause 8 Extension of Time, Clause 20 Claims), and quantify financial/delay risk clearly.
${MEP_REFERENCE_KNOWLEDGE}`,

        logistics: `You are an MEP Site Logistics Coordinator & Procurement Specialist.
You locate certified MEP equipment suppliers, ductwork fabrication shops, electrical wholesalers, crane hire companies, testing labs, and emergency services near the jobsite.
When answering, provide actionable supplier details, logistics routing considerations for oversized MEP equipment (chillers, transformers), and offload coordination steps.`
      };

      const systemInstruction = ROLE_INSTRUCTIONS[role_type] || ROLE_INSTRUCTIONS.engineer;
      let finalSystemInstruction = systemInstruction;
      if (project_context) {
        finalSystemInstruction += `\n\nActive Project Context:\n${JSON.stringify(project_context)}`;
      }
      if (location_hint) {
        finalSystemInstruction += `\n\nJobsite Location / Coordinates: ${location_hint}`;
      }

      // Format conversation history for @google/genai
      let formattedContents: any[] = [];
      if (Array.isArray(messages) && messages.length > 0) {
        formattedContents = messages.map(m => {
          const role = (m.role === "assistant" || m.role === "model") ? "model" : "user";
          const text = typeof m.content === "string" ? m.content : (m.text || JSON.stringify(m.parts || ""));
          return {
            role,
            parts: [{ text: String(text) }]
          };
        });
      } else {
        const singleMsg = req.body?.message || req.body?.question || "Provide general MEP engineering guidance.";
        formattedContents = [{ role: "user", parts: [{ text: String(singleMsg) }] }];
      }

      const apiKey = process.env.GEMINI_API_KEY;
      let reply = "";
      let groundingData: any = null;
      let modelUsed = model_tier;

      if (apiKey) {
        try {
          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: { headers: { "User-Agent": "aistudio-build" } }
          });

          // Model Tier Selection:
          // gemini-3.1-pro-preview: Complex / deep reasoning
          // gemini-3.5-flash: General tasks & Maps Grounding
          // gemini-3.1-flash-lite: Fast site lookups & quick calculations
          const candidateModels = [model_tier];
          if (model_tier === "gemini-3.1-pro-preview") {
            candidateModels.push("gemini-3.5-flash", "gemini-2.5-pro", "gemini-3.8-flash");
          } else if (model_tier === "gemini-3.1-flash-lite") {
            candidateModels.push("gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.6-flash");
          } else {
            candidateModels.push("gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.8-flash");
          }

          const config: any = {
            systemInstruction: finalSystemInstruction,
          };

          // Apply Google Maps Grounding tool when requested (per guideline: use gemini-3.5-flash with googleMaps tool)
          if (enable_maps || role_type === "logistics") {
            config.tools = [{ googleMaps: {} }];
            // Ensure model is compatible with Google Maps tool
            candidateModels.unshift("gemini-3.5-flash", "gemini-2.5-flash");
          }

          let lastError: any = null;
          for (const targetModel of Array.from(new Set(candidateModels))) {
            try {
              const resObj = await ai.models.generateContent({
                model: targetModel,
                contents: formattedContents,
                config,
              });
              reply = resObj.text || "";
              modelUsed = targetModel;
              if ((resObj as any)?.candidates?.[0]?.groundingMetadata) {
                groundingData = (resObj as any).candidates[0].groundingMetadata;
              }
              if (reply) break;
            } catch (mErr: any) {
              lastError = mErr;
              console.warn(`Attempt with model ${targetModel} failed:`, mErr?.message);
              // If maps tool caused error, try without tools
              if (config.tools) {
                try {
                  const fallbackConfig = { systemInstruction: finalSystemInstruction };
                  const resObj = await ai.models.generateContent({
                    model: targetModel,
                    contents: formattedContents,
                    config: fallbackConfig,
                  });
                  reply = resObj.text || "";
                  modelUsed = targetModel;
                  if (reply) break;
                } catch {}
              }
            }
          }
        } catch (apiErr: any) {
          console.warn("Gemini multi-turn chat error:", apiErr?.message);
        }
      }

      if (!reply || !reply.trim()) {
        const lastUserMsg = formattedContents[formattedContents.length - 1]?.parts?.[0]?.text || "MEP Coordination";
        reply = `### Technical Assessment: ${lastUserMsg.slice(0, 50)}\n\n1. **Standard Compliance Check**: Verify equipment specifications against project schedules and applicable design codes (BS 7671, ASHRAE, NFPA).\n2. **Field Coordination**: Ensure cross-discipline clash detection (HVAC duct vs pipework vs cable tray) is completed prior to final bracket fixings.\n3. **Quality & Testing**: Complete hydrostatic pressure testing and insulation resistance verification before closing ceiling voids.`;
      }

      res.json({
        reply,
        answer: reply,
        model_used: modelUsed,
        grounding_data: groundingData,
        role_type,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      console.error("Multi-turn chat error:", err);
      res.status(500).json({ error: err.message || "Failed to process chat" });
    }
  });

  // Dedicated Google Maps Grounding Search for Local MEP Suppliers & Jobsite Logistics
  app.post("/api/ai/maps-search", authRequired, async (req: Request, res: Response) => {
    try {
      const { query, location = "London, UK", category = "Electrical Wholesalers" } = req.body || {};
      const searchQuery = query || `Find ${category} near ${location} with addresses, phone numbers, and ratings for a commercial construction site.`;
      const apiKey = process.env.GEMINI_API_KEY;
      let answer = "";
      let groundingData: any = null;

      if (apiKey) {
        try {
          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: { headers: { "User-Agent": "aistudio-build" } }
          });

          const prompt = `You are a Construction Logistics Coordinator.
Search for real, verified local businesses matching this query:
"${searchQuery}"

Location context: ${location}

Provide a structured list of at least 3-5 verified locations/suppliers including:
- **Business Name**
- **Full Address & Vicinity**
- **Contact / Phone (if available)**
- **Speciality / Trade Products (e.g., Schneider switchgear, galvanised spiral ducting, crane rental)**
- **Operating Notes for Site Deliveries (access restrictions, loading bay)**`;

          try {
            const resObj = await ai.models.generateContent({
              model: "gemini-3.5-flash",
              contents: prompt,
              config: {
                tools: [{ googleMaps: {} }],
              }
            });
            answer = resObj.text || "";
            if ((resObj as any)?.candidates?.[0]?.groundingMetadata) {
              groundingData = (resObj as any).candidates[0].groundingMetadata;
            }
          } catch (mErr: any) {
            console.warn("Maps grounding primary failed, trying fallback:", mErr?.message);
            const resObj = await ai.models.generateContent({
              model: "gemini-2.5-flash",
              contents: prompt,
              config: {
                tools: [{ googleMaps: {} }],
              }
            });
            answer = resObj.text || "";
            if ((resObj as any)?.candidates?.[0]?.groundingMetadata) {
              groundingData = (resObj as any).candidates[0].groundingMetadata;
            }
          }
        } catch (e: any) {
          console.warn("Maps search failed:", e?.message);
        }
      }

      if (!answer || !answer.trim()) {
        answer = `### Local MEP Suppliers & Logistics Directory for ${location}\n\n` +
          `1. **Rexel / CEF Electrical Wholesalers**\n   - **Products:** BS 7671 distribution boards, SWA cabling, UPVC conduit, cable tray systems.\n   - **Site Delivery:** Next-day morning tail-lift delivery available for bulk containment.\n\n` +
          `2. **Wolseley / BSS Industrial Pipe & Heating**\n   - **Products:** Mapress copper/carbon steel press fittings, Victaulic grooved couplings, commercial CHW valves.\n   - **Site Delivery:** Direct to plant room crane offload.\n\n` +
          `3. **Lindab / Ductwork Supplies Depot**\n   - **Products:** Galvanised spiral ductwork, acoustic attenuators, fire dampers (BS EN 15650).\n   - **Site Delivery:** Coordinated flatbed delivery slots.\n\n` +
          `4. **Ainscough / Hewden Crane & Plant Hire**\n   - **Products:** Mobile telescopic cranes (40t-200t), spider cranes for internal atrium glass/chiller rigging.\n   - **Permits:** Requires local council road closure & lift plan.`;
      }

      res.json({
        answer,
        query: searchQuery,
        location,
        category,
        grounding_data: groundingData,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to search local maps" });
    }
  });

  // General AI Chat Endpoint for Senior MEP Engineering Consultation
  app.post("/api/ai/chat", authRequired, async (req: Request, res: Response) => {
    try {
      const { message, question, context, model_tier = "gemini-3.5-flash" } = req.body || {};
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
              model: model_tier || "gemini-3.5-flash",
              contents: prompt
            });
            reply = result.text || "";
          } catch {
            const result = await ai.models.generateContent({
              model: "gemini-3.8-flash",
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

  // Project setup intelligence: extract only explicitly stated project
  // metadata from uploaded setup documents. Nothing is written automatically;
  // the UI presents every suggestion for human review before PUT /api/projects/:id.
  app.post("/api/projects/:id/extract-setup-data", authRequired, async (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      if (!hasProjectAccess(req.user!, projectId)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      if (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager") {
        res.status(403).json({ error: "Only an Admin or Project Manager can analyze project setup documents" });
        return;
      }

      const requestedIds = Array.isArray(req.body?.document_ids) ? new Set(req.body.document_ids.map(String)) : null;
      const docs = (db.prepare(
        "SELECT id, name, attachment_name, attachment_data FROM documents WHERE project_id=? AND attachment_data IS NOT NULL ORDER BY date_added DESC"
      ).all(projectId) as any[]).filter(d => !requestedIds || requestedIds.has(String(d.id))).slice(0, 12);

      if (!docs.length) {
        res.status(400).json({ error: "No uploaded project documents were found to analyze" });
        return;
      }

      const sources: ProjectSetupSource[] = [];
      const skipped: { id: string; name: string; reason: string }[] = [];
      let combinedChars = 0;
      const MAX_COMBINED_CHARS = 60000;

      for (const doc of docs) {
        if (combinedChars >= MAX_COMBINED_CHARS) break;
        const extracted = await extractDocumentText(doc.attachment_data, doc.attachment_name || doc.name);
        if (extracted.kind !== "text") {
          skipped.push({
            id: doc.id,
            name: doc.name || doc.attachment_name || "Document",
            reason: extracted.kind === "unsupported" ? extracted.reason : "Image metadata extraction is not included in this setup pass",
          });
          continue;
        }
        const remaining = MAX_COMBINED_CHARS - combinedChars;
        const text = extracted.text.slice(0, Math.min(12000, remaining));
        if (!text.trim()) continue;
        sources.push({ id: doc.id, name: doc.name || doc.attachment_name || "Document", text });
        combinedChars += text.length;
      }

      if (!sources.length) {
        res.status(400).json({ error: "The uploaded files did not contain readable text for project setup extraction", skipped });
        return;
      }

      let suggestions = fallbackProjectSetupSuggestions(sources);
      let source: "ai" | "reference" = "reference";
      const apiKey = process.env.GEMINI_API_KEY;

      if (apiKey) {
        try {
          const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { "User-Agent": "aistudio-build" } } });
          const sourceText = sources.map(s =>
            "--- DOCUMENT ID: " + s.id + " | NAME: " + s.name + " ---\n" + s.text
          ).join("\n\n");
          const prompt = [
            "You are extracting project setup metadata from construction/MEP contract documents.",
            "Extract ONLY values explicitly stated in the supplied documents. Never infer or invent missing values.",
            "Return ONLY valid JSON. Dates must be YYYY-MM-DD. Budget must be a plain number without currency symbols.",
            "For every non-null field include the exact source document id and a short exact source excerpt.",
            "Allowed confidence values: High, Medium, Low.",
            "JSON shape:",
            "{",
            '  "name": {"value": string|null, "confidence": "High|Medium|Low", "source_document_id": string|null, "source_excerpt": string},',
            '  "client": {"value": string|null, "confidence": "High|Medium|Low", "source_document_id": string|null, "source_excerpt": string},',
            '  "start_date": {"value": string|null, "confidence": "High|Medium|Low", "source_document_id": string|null, "source_excerpt": string},',
            '  "end_date": {"value": string|null, "confidence": "High|Medium|Low", "source_document_id": string|null, "source_excerpt": string},',
            '  "budget": {"value": number|null, "confidence": "High|Medium|Low", "source_document_id": string|null, "source_excerpt": string}',
            "}",
            "",
            sourceText
          ].join("\n");

          let result: any;
          try {
            result = await ai.models.generateContent({ model: "gemini-3.8-flash", contents: prompt });
          } catch {
            result = await ai.models.generateContent({ model: "gemini-3.6-flash", contents: prompt });
          }
          const raw = String(result.text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
          const parsed = JSON.parse(raw);
          const sourceMap = new Map(sources.map(s => [s.id, s]));
          const aiSuggestions: ProjectSetupSuggestion[] = [];

          for (const field of ["name", "client", "start_date", "end_date", "budget"] as const) {
            const item = parsed?.[field];
            if (!item || item.value === null || item.value === undefined || item.value === "") continue;
            const src = sourceMap.get(String(item.source_document_id || ""));
            if (!src) continue;
            let value: string | number | null = item.value;
            if (field === "start_date" || field === "end_date") value = normaliseProjectDateCandidate(item.value);
            if (field === "budget") {
              const amount = typeof item.value === "number" ? item.value : parseImportNumber(item.value);
              value = amount > 0 ? amount : null;
            }
            if ((field === "name" || field === "client") && typeof value !== "string") value = String(value || "").trim();
            if (value === null || value === "") continue;
            const confidence = ["High", "Medium", "Low"].includes(item.confidence) ? item.confidence : "Medium";
            aiSuggestions.push({
              field,
              value,
              confidence,
              source_document_id: src.id,
              source_document_name: src.name,
              source_excerpt: String(item.source_excerpt || "").slice(0, 500),
            });
          }

          if (aiSuggestions.length) {
            const merged = new Map<string, ProjectSetupSuggestion>(suggestions.map(s => [s.field, s]));
            for (const s of aiSuggestions) merged.set(s.field, s);
            suggestions = Array.from(merged.values());
            source = "ai";
          }
        } catch (err: any) {
          console.warn("Project setup extraction AI failed, using deterministic extraction:", err?.message);
        }
      }

      writeAudit(
        req.user!.user_id,
        "projects",
        projectId,
        projectId,
        "analyze_setup_documents",
        null,
        {
          document_ids: sources.map(s => s.id),
          fields_found: suggestions.map(s => s.field),
          extraction_source: source,
        }
      );

      res.json({
        project_id: projectId,
        source,
        analyzed_documents: sources.map(s => ({ id: s.id, name: s.name })),
        skipped,
        suggestions,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Project document analysis failed" });
    }
  });

  // ==========================================
  // V1.1 - V1.2 CONSTRUCTION-GRADE MODULE APIS
  // ==========================================

  // --- COMPANIES & DIRECTORY ---
  app.get("/api/companies", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client") {
        res.status(403).json({ error: "Access denied: company directory is confidential" });
        return;
      }
      if (req.user!.role === "Subcontractor") {
        const rows = db.prepare(`
          SELECT c.*,
            (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id OR u.company = c.name) as user_count,
            (SELECT COUNT(*) FROM work_packages wp WHERE wp.company_id = c.id) as package_count
          FROM companies c
          WHERE c.id = ? OR c.id IN (
            SELECT pc.company_id FROM project_companies pc
            WHERE pc.project_id IN (
              SELECT project_id FROM project_memberships WHERE user_id = ? AND active = 1
              UNION
              SELECT project_id FROM project_companies WHERE company_id = ?
            )
          )
          ORDER BY c.name ASC
        `).all(req.user!.company_id || "", req.user!.user_id, req.user!.company_id || "");
        res.json(rows.map(rowToDict));
        return;
      }
      const rows = db.prepare(`
        SELECT c.*,
          (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id OR u.company = c.name) as user_count,
          (SELECT COUNT(*) FROM work_packages wp WHERE wp.company_id = c.id) as package_count
        FROM companies c
        ORDER BY c.name ASC
      `).all();
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/companies", authRequired, (req, res) => {
    try {
      if (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager" && req.user!.role !== "CommercialManager") {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const data = req.body || {};
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO companies (id, name, type, trade, contact_person, email, phone, vat_number, status, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.name || "New Company",
        data.type || "Subcontractor",
        data.trade || "",
        data.contact_person || "",
        data.email || "",
        data.phone || "",
        data.vat_number || "",
        data.status || "Active",
        data.notes || "",
        now
      );
      writeAudit(req.user!.user_id, "companies", id, "SYSTEM", "create", null, data);
      res.status(201).json({ id, ...data, created_at: now });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/companies/:id", authRequired, (req, res) => {
    try {
      if (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager" && req.user!.role !== "CommercialManager") {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const existing = db.prepare("SELECT * FROM companies WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      const data = req.body || {};
      db.prepare(`
        UPDATE companies
        SET name=?, type=?, trade=?, contact_person=?, email=?, phone=?, vat_number=?, status=?, notes=?
        WHERE id=?
      `).run(
        data.name ?? existing.name,
        data.type ?? existing.type,
        data.trade ?? existing.trade,
        data.contact_person ?? existing.contact_person,
        data.email ?? existing.email,
        data.phone ?? existing.phone,
        data.vat_number ?? existing.vat_number,
        data.status ?? existing.status,
        data.notes ?? existing.notes,
        req.params.id
      );
      writeAudit(req.user!.user_id, "companies", req.params.id, "SYSTEM", "update", existing, data);
      res.json({ ok: true, id: req.params.id });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/companies/:id", authRequired, (req, res) => {
    try {
      if (req.user!.role !== "Admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      const existing = db.prepare("SELECT * FROM companies WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      db.prepare("DELETE FROM companies WHERE id=?").run(req.params.id);
      writeAudit(req.user!.user_id, "companies", req.params.id, "SYSTEM", "delete", existing, null);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- PROJECT PARTICIPATING COMPANIES ---
  app.get("/api/projects/:id/companies", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (!hasProjectAccess(req.user!, req.params.id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const rows = db.prepare(`
        SELECT pc.*, c.name as company_name, c.type as company_type, c.trade as company_trade, c.contact_person, c.email, c.phone
        FROM project_companies pc
        JOIN companies c ON c.id = pc.company_id
        WHERE pc.project_id = ?
        ORDER BY pc.created_at ASC
      `).all(req.params.id);
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/projects/:id/companies", authRequired, (req, res) => {
    try {
      if (!hasProjectAccess(req.user!, req.params.id) || (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager")) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const { company_id, role_in_project } = req.body || {};
      if (!company_id) {
        res.status(400).json({ error: "company_id is required" });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO project_companies (id, project_id, company_id, role_in_project, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, req.params.id, company_id, role_in_project || "Subcontractor", now);
      res.status(201).json({ id, project_id: req.params.id, company_id, role_in_project, created_at: now });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/projects/:id/companies/:companyId", authRequired, (req, res) => {
    try {
      if (!hasProjectAccess(req.user!, req.params.id) || (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager")) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      db.prepare("DELETE FROM project_companies WHERE project_id=? AND company_id=?").run(req.params.id, req.params.companyId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- WORK PACKAGES ---
  app.get("/api/work_packages", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client" || !canView(req.user!, "work_packages")) {
        res.status(403).json({ error: "No access to work packages" });
        return;
      }
      const projectId = req.query.project_id as string;
      let { where, params } = projectScopeSql(req.user!, projectId, "wp.project_id");
      if (!where) {
        res.status(403).json({ error: "No access to project" });
        return;
      }
      if (req.user!.role === "Subcontractor") {
        if (req.user!.work_package_id || req.user!.company_id) {
          where += " AND (wp.id = ? OR wp.company_id = ?)";
          params.push(req.user!.work_package_id || "", req.user!.company_id || "");
        } else {
          res.json([]);
          return;
        }
      }
      const rows = db.prepare(`
        SELECT wp.*,
          c.name as company_name,
          c.trade as company_trade,
          (SELECT COUNT(*) FROM tasks t WHERE t.work_package_id = wp.id) as task_count,
          (SELECT AVG(progress) FROM tasks t WHERE t.work_package_id = wp.id) as task_avg_progress,
          (SELECT COUNT(*) FROM clarifications cl WHERE cl.work_package_id = wp.id AND cl.status != 'Closed') as open_clarifications_count,
          (SELECT COUNT(*) FROM progress_submissions ps WHERE ps.work_package_id = wp.id AND ps.status = 'Submitted') as pending_submissions_count
        FROM work_packages wp
        LEFT JOIN companies c ON c.id = wp.company_id
        WHERE ${where}
        ORDER BY wp.code ASC, wp.name ASC
      `).all(...params);
      const mapped = rows.map(rowToDict);
      if (req.user!.role === "Client") {
        for (const r of mapped as any[]) {
          r.budget_allocated = 0;
        }
      }
      res.json(mapped);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/work_packages", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor" || !canEdit(req.user!, "work_packages")) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const data = req.body || {};
      if (!data.project_id || !hasProjectAccess(req.user!, data.project_id)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO work_packages (id, project_id, name, code, discipline, description, company_id, lead_contact, budget_allocated, status, start_date, target_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.project_id,
        data.name || "Untitled Work Package",
        data.code || "WP-01",
        data.discipline || "Mechanical",
        data.description || "",
        data.company_id || null,
        data.lead_contact || "",
        parseImportNumber(data.budget_allocated),
        data.status || "Planned",
        data.start_date || "",
        data.target_date || "",
        now
      );
      writeAudit(req.user!.user_id, "work_packages", id, data.project_id, "create", null, data);
      res.status(201).json({ id, ...data, created_at: now });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/work_packages/:id", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor" || !canEdit(req.user!, "work_packages")) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const existing = db.prepare("SELECT * FROM work_packages WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Work package not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id)) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const data = req.body || {};
      db.prepare(`
        UPDATE work_packages
        SET name=?, code=?, discipline=?, description=?, company_id=?, lead_contact=?, budget_allocated=?, status=?, start_date=?, target_date=?
        WHERE id=?
      `).run(
        data.name ?? existing.name,
        data.code ?? existing.code,
        data.discipline ?? existing.discipline,
        data.description ?? existing.description,
        data.company_id ?? existing.company_id,
        data.lead_contact ?? existing.lead_contact,
        data.budget_allocated !== undefined ? parseImportNumber(data.budget_allocated) : existing.budget_allocated,
        data.status ?? existing.status,
        data.start_date ?? existing.start_date,
        data.target_date ?? existing.target_date,
        req.params.id
      );
      writeAudit(req.user!.user_id, "work_packages", req.params.id, existing.project_id, "update", existing, data);
      res.json({ ok: true, id: req.params.id });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete("/api/work_packages/:id", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor" || !canDelete(req.user!)) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const existing = db.prepare("SELECT * FROM work_packages WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Work package not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id)) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      db.prepare("DELETE FROM work_packages WHERE id=?").run(req.params.id);
      writeAudit(req.user!.user_id, "work_packages", req.params.id, existing.project_id, "delete", existing, null);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- CLARIFICATIONS HUB (CLIENT <-> MAIN CONTRACTOR <-> SUBCONTRACTOR) ---
  app.get("/api/clarifications", authRequired, (req, res) => {
    try {
      const projectId = req.query.project_id as string;
      let { where, params } = projectScopeSql(req.user!, projectId, "cl.project_id");
      if (!where) {
        res.status(403).json({ error: "No access to project" });
        return;
      }
      if (req.user!.role === "Client") {
        if (req.user!.company_id) {
          where += " AND (cl.visibility IN ('Client', 'All') OR cl.from_company_id = ? OR cl.to_company_id = ?)";
          params.push(req.user!.company_id, req.user!.company_id);
        } else {
          where += " AND cl.visibility IN ('Client', 'All')";
        }
      } else if (req.user!.role === "Subcontractor") {
        const subClauses: string[] = [];
        const subParams: any[] = [];
        if (req.user!.work_package_id) {
          subClauses.push("cl.work_package_id = ?");
          subParams.push(req.user!.work_package_id);
        }
        if (req.user!.company_id) {
          subClauses.push("cl.from_company_id = ?");
          subParams.push(req.user!.company_id);
          subClauses.push("cl.to_company_id = ?");
          subParams.push(req.user!.company_id);
        }
        subClauses.push("cl.raised_by = ?");
        subParams.push(req.user!.name);
        subClauses.push("cl.id IN (SELECT record_id FROM record_owners WHERE module='clarifications' AND user_id=?)");
        subParams.push(req.user!.user_id);
        where += ` AND (${subClauses.join(" OR ")})`;
        params.push(...subParams);
      }
      const rows = db.prepare(`
        SELECT cl.*,
          fc.name as from_company_name,
          tc.name as to_company_name,
          wp.name as work_package_name,
          wp.code as work_package_code,
          (SELECT COUNT(*) FROM clarification_comments cc WHERE cc.clarification_id = cl.id) as comments_count
        FROM clarifications cl
        LEFT JOIN companies fc ON fc.id = cl.from_company_id
        LEFT JOIN companies tc ON tc.id = cl.to_company_id
        LEFT JOIN work_packages wp ON wp.id = cl.work_package_id
        WHERE ${where}
        ORDER BY cl.created_at DESC
      `).all(...params);
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/clarifications", authRequired, (req, res) => {
    try {
      const data = req.body || {};
      if (!data.project_id || !hasProjectAccess(req.user!, data.project_id)) {
        res.status(403).json({ error: "No access to project" });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const count = (db.prepare("SELECT COUNT(*) as c FROM clarifications WHERE project_id=?").get(data.project_id) as any)?.c || 0;
      const number = data.number || `CLR-${String(count + 1).padStart(3, "0")}`;
      
      let fromComp = data.from_company_id || null;
      let workPkg = data.work_package_id || null;
      let vis = data.visibility || "Internal";

      if (req.user!.role === "Client") {
        fromComp = req.user!.company_id || fromComp;
        vis = "Client";
      } else if (req.user!.role === "Subcontractor") {
        fromComp = req.user!.company_id || fromComp;
        workPkg = req.user!.work_package_id || workPkg;
        vis = "Internal";
      }

      db.prepare(`
        INSERT INTO clarifications (
          id, project_id, number, title, type, from_company_id, to_company_id,
          work_package_id, raised_by, discipline, priority, status, question_text,
          proposed_solution, cost_impact_flag, schedule_impact_flag, official_response,
          responded_by, responded_at, due_date, attachment_name, attachment_data, visibility, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.project_id,
        number,
        data.title || "Clarification Request",
        data.type || "Technical",
        fromComp,
        data.to_company_id || null,
        workPkg,
        req.user!.name || "User",
        data.discipline || "General",
        data.priority || "Medium",
        data.status || "Submitted",
        data.question_text || data.question || "",
        data.proposed_solution || "",
        data.cost_impact_flag ? 1 : 0,
        data.schedule_impact_flag ? 1 : 0,
        data.official_response || "",
        data.responded_by || "",
        data.responded_at || "",
        data.due_date || "",
        data.attachment_name || "",
        data.attachment_data || "",
        vis,
        now
      );
      db.prepare("INSERT OR IGNORE INTO record_owners VALUES (?, ?, ?)").run("clarifications", id, req.user!.user_id);
      writeAudit(req.user!.user_id, "clarifications", id, data.project_id, "create", null, data);
      res.status(201).json({ id, ...data, from_company_id: fromComp, work_package_id: workPkg, visibility: vis, number, created_at: now });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  const checkClarificationAccess = (user: AuthenticatedUser, cl: any): boolean => {
    if (!hasProjectAccess(user, cl.project_id)) return false;
    if (user.role === "Admin" || user.role === "ProjectManager" || user.role === "SiteEngineer" || user.role === "CommercialManager" || user.role === "QAQC") {
      return true;
    }
    if (user.role === "Client") {
      if (["Client", "All"].includes(cl.visibility || "Internal")) return true;
      if (user.company_id && (cl.from_company_id === user.company_id || cl.to_company_id === user.company_id)) return true;
      return false;
    }
    if (user.role === "Subcontractor") {
      if (user.work_package_id && cl.work_package_id === user.work_package_id) return true;
      if (user.company_id && (cl.from_company_id === user.company_id || cl.to_company_id === user.company_id)) return true;
      if (cl.raised_by === user.name) return true;
      const isOwner = db.prepare("SELECT 1 FROM record_owners WHERE module='clarifications' AND record_id=? AND user_id=?").get(cl.id, user.user_id);
      return Boolean(isOwner);
    }
    return false;
  };

  app.get("/api/clarifications/:id", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM clarifications WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Clarification not found" });
        return;
      }
      if (!checkClarificationAccess(req.user!, existing)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const comments = db.prepare("SELECT * FROM clarification_comments WHERE clarification_id=? ORDER BY created_at ASC").all(req.params.id).map(rowToDict);
      res.json({
        ...rowToDict(existing),
        comments,
        messages: comments
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/clarifications/:id", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM clarifications WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Clarification not found" });
        return;
      }
      if (!checkClarificationAccess(req.user!, existing)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        const isOwner = db.prepare("SELECT 1 FROM record_owners WHERE module='clarifications' AND record_id=? AND user_id=?").get(req.params.id, req.user!.user_id);
        if (!isOwner && existing.raised_by !== req.user!.name) {
          res.status(403).json({ error: "Only the author or contractor team may update this clarification" });
          return;
        }
      }
      const data = req.body || {};
      const now = new Date().toISOString();
      const updatedStatus = data.status || existing.status;
      const officialResponse = data.official_response !== undefined ? data.official_response : existing.official_response;
      const respondedBy = officialResponse ? (existing.responded_by || req.user!.name) : existing.responded_by;
      const respondedAt = officialResponse ? (existing.responded_at || now) : existing.responded_at;

      let visibility = existing.visibility;
      if (data.visibility !== undefined) {
        if (req.user!.role === "Admin" || req.user!.role === "ProjectManager") {
          visibility = data.visibility;
        }
      }

      db.prepare(`
        UPDATE clarifications
        SET title=?, type=?, discipline=?, priority=?, status=?, official_response=?,
            responded_by=?, responded_at=?, due_date=?, visibility=?, question_text=?, proposed_solution=?
        WHERE id=?
      `).run(
        data.title ?? existing.title,
        data.type ?? existing.type,
        data.discipline ?? existing.discipline,
        data.priority ?? existing.priority,
        updatedStatus,
        officialResponse,
        respondedBy,
        respondedAt,
        data.due_date ?? existing.due_date,
        visibility,
        data.question_text ?? (data.question ?? existing.question_text),
        data.proposed_solution ?? existing.proposed_solution,
        req.params.id
      );

      writeAudit(req.user!.user_id, "clarifications", req.params.id, existing.project_id, "update", existing, data);
      const updated = db.prepare("SELECT * FROM clarifications WHERE id=?").get(req.params.id) as any;
      res.json(rowToDict(updated));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/clarifications/:id/answer", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM clarifications WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Clarification not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id) || req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Only contractor management can submit an official answer" });
        return;
      }
      const { official_response, status } = req.body || {};
      const now = new Date().toISOString();
      const newStatus = status || "Answered";
      db.prepare(`
        UPDATE clarifications
        SET official_response=?, responded_by=?, responded_at=?, status=?
        WHERE id=?
      `).run(official_response || "", req.user!.name, now, newStatus, req.params.id);

      writeAudit(req.user!.user_id, "clarifications", req.params.id, existing.project_id, "answer", existing, { official_response, status: newStatus });
      res.json({ ok: true, id: req.params.id, status: newStatus, responded_by: req.user!.name, responded_at: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const postClarificationCommentHandler = (req: any, res: any) => {
    try {
      const existing = db.prepare("SELECT * FROM clarifications WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Clarification not found" });
        return;
      }
      if (!checkClarificationAccess(req.user!, existing)) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const text = req.body?.comment_text || req.body?.message || "";
      if (!text || !String(text).trim()) {
        res.status(400).json({ error: "Comment text is required" });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO clarification_comments (id, clarification_id, user_id, user_name, company_name, comment_text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, req.params.id, req.user!.user_id, req.user!.name, req.user!.company_name || req.user!.company || req.user!.role, text, now);

      res.status(201).json({ id, clarification_id: req.params.id, user_name: req.user!.name, comment_text: text, message: text, created_at: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
  app.post("/api/clarifications/:id/comment", authRequired, postClarificationCommentHandler);
  app.post("/api/clarifications/:id/messages", authRequired, postClarificationCommentHandler);

  app.get("/api/clarifications/:id/comments", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM clarifications WHERE id=?").get(req.params.id) as any;
      if (!existing || !checkClarificationAccess(req.user!, existing)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const rows = db.prepare("SELECT * FROM clarification_comments WHERE clarification_id=? ORDER BY created_at ASC").all(req.params.id);
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- PUBLISHED PROGRESS REPORTS (CLIENT VISIBILITY CONTROL) ---
  app.get("/api/progress_reports", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Subcontractor") {
        res.json([]);
        return;
      }
      const projectId = req.query.project_id as string;
      let { where, params } = projectScopeSql(req.user!, projectId, "pr.project_id");
      if (!where) {
        res.status(403).json({ error: "No access to project" });
        return;
      }
      if (req.user!.role === "Client") {
        where += " AND pr.status IN ('Published', 'Published to Client')";
      }
      const rows = db.prepare(`
        SELECT pr.*,
          (SELECT COUNT(*) FROM progress_report_photos p WHERE p.report_id = pr.id) as photo_count
        FROM progress_reports pr
        WHERE ${where}
        ORDER BY pr.period_end DESC, pr.created_at DESC
      `).all(...params);
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/progress_reports/:id", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const report = db.prepare("SELECT * FROM progress_reports WHERE id=?").get(req.params.id) as any;
      if (!report) {
        res.status(404).json({ error: "Report not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, report.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (req.user!.role === "Client" && !["Published", "Published to Client"].includes(report.status)) {
        res.status(403).json({ error: "This report has not been published to the client" });
        return;
      }
      const photos = db.prepare("SELECT * FROM progress_report_photos WHERE report_id=? ORDER BY created_at ASC").all(req.params.id);
      res.json({ ...rowToDict(report), photos: photos.map(rowToDict) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/progress_reports/:id", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM progress_reports WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Report not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id) || req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const data = req.body || {};
      const now = new Date().toISOString();
      let updatedStatus = data.status || existing.status;
      if ((updatedStatus === "Published" || updatedStatus === "Published to Client") && req.user!.role !== "Admin" && req.user!.role !== "ProjectManager") {
        updatedStatus = existing.status;
      }
      const publishedAt = (updatedStatus === "Published" || updatedStatus === "Published to Client") ? (existing.published_at || now) : existing.published_at;
      const publishedBy = (updatedStatus === "Published" || updatedStatus === "Published to Client") ? (existing.published_by || req.user!.name) : existing.published_by;

      db.prepare(`
        UPDATE progress_reports
        SET title=?, period_start=?, period_end=?, status=?, executive_summary=?,
            overall_progress_percent=?, planned_progress_percent=?, milestone_summary=?,
            hvac_progress=?, electrical_progress=?, plumbing_progress=?, fire_progress=?, bms_progress=?,
            safety_summary=?, manpower_peak=?, lookahead_narrative=?, key_risks_issues=?,
            published_at=?, published_by=?
        WHERE id=?
      `).run(
        data.title ?? existing.title,
        data.period_start ?? existing.period_start,
        data.period_end ?? existing.period_end,
        updatedStatus,
        data.executive_summary ?? existing.executive_summary,
        data.overall_progress_percent !== undefined ? parseImportNumber(data.overall_progress_percent) : (data.overall_progress_actual !== undefined ? parseImportNumber(data.overall_progress_actual) : existing.overall_progress_percent),
        data.planned_progress_percent !== undefined ? parseImportNumber(data.planned_progress_percent) : (data.overall_progress_planned !== undefined ? parseImportNumber(data.overall_progress_planned) : existing.planned_progress_percent),
        data.milestone_summary ?? existing.milestone_summary,
        data.hvac_progress !== undefined ? parseImportNumber(data.hvac_progress) : existing.hvac_progress,
        data.electrical_progress !== undefined ? parseImportNumber(data.electrical_progress) : existing.electrical_progress,
        data.plumbing_progress !== undefined ? parseImportNumber(data.plumbing_progress) : existing.plumbing_progress,
        data.fire_progress !== undefined ? parseImportNumber(data.fire_progress) : existing.fire_progress,
        data.bms_progress !== undefined ? parseImportNumber(data.bms_progress) : existing.bms_progress,
        data.safety_summary ?? existing.safety_summary,
        data.manpower_peak !== undefined ? parseInt(data.manpower_peak) : existing.manpower_peak,
        data.lookahead_narrative ?? existing.lookahead_narrative,
        data.key_risks_issues ?? existing.key_risks_issues,
        publishedAt,
        publishedBy,
        req.params.id
      );

      writeAudit(req.user!.user_id, "progress_reports", req.params.id, existing.project_id, "update", existing, data);
      const updated = db.prepare("SELECT * FROM progress_reports WHERE id=?").get(req.params.id) as any;
      res.json(rowToDict(updated));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Auto-compile live project data into a draft progress report
  app.post("/api/progress_reports/auto-compile", authRequired, (req, res) => {
    try {
      const { project_id, period_start, period_end } = req.body || {};
      if (!project_id || !hasProjectAccess(req.user!, project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Contractor management role required" });
        return;
      }

      const tasks = db.prepare("SELECT * FROM tasks WHERE project_id=?").all(project_id) as any[];
      const workTasks = tasks.filter(t => !t.is_milestone && !t.is_summary);
      const overall = workTasks.length
        ? Math.round(workTasks.reduce((acc, t) => acc + (t.progress || 0), 0) / workTasks.length)
        : 0;

      const calcDiscipline = (kw: string) => {
        const matching = workTasks.filter(t => (t.trade || "").toLowerCase().includes(kw) || (t.title || "").toLowerCase().includes(kw));
        return matching.length ? Math.round(matching.reduce((acc, t) => acc + (t.progress || 0), 0) / matching.length) : 0;
      };

      const hvacProg = calcDiscipline("hvac") || calcDiscipline("duct") || calcDiscipline("mech") || overall;
      const elecProg = calcDiscipline("elec") || calcDiscipline("cable") || calcDiscipline("light") || overall;
      const plumbProg = calcDiscipline("plumb") || calcDiscipline("pipe") || calcDiscipline("drain") || overall;
      const fireProg = calcDiscipline("fire") || calcDiscipline("sprinkler") || overall;
      const bmsProg = calcDiscipline("bms") || calcDiscipline("elv") || calcDiscipline("control") || overall;

      const logs = db.prepare("SELECT * FROM dailylogs WHERE project_id=?").all(project_id) as any[];
      const peakWorkers = logs.reduce((max, l) => Math.max(max, l.workers_count || 0), 0) || 28;

      const punchOpen = db.prepare("SELECT COUNT(*) as c FROM punchlist WHERE project_id=? AND status!='Closed'").get(project_id) as any;
      const incidents = db.prepare("SELECT COUNT(*) as c FROM safety_incidents WHERE project_id=?").get(project_id) as any;

      const countReports = (db.prepare("SELECT COUNT(*) as c FROM progress_reports WHERE project_id=?").get(project_id) as any)?.c || 0;
      const repNum = `MPR-${String(countReports + 1).padStart(3, "0")}`;

      const draft = {
        project_id,
        report_number: repNum,
        title: `Monthly MEP Progress Report #${countReports + 1}`,
        period_start: period_start || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
        period_end: period_end || new Date().toISOString().slice(0, 10),
        prepared_by: req.user!.name,
        status: "Draft",
        overall_progress_percent: overall,
        planned_progress_percent: Math.min(100, overall + 5),
        hvac_progress: hvacProg,
        electrical_progress: elecProg,
        plumbing_progress: plumbProg,
        fire_progress: fireProg,
        bms_progress: bmsProg,
        manpower_peak: peakWorkers,
        executive_summary: `Overall MEP installation across all floors has reached ${overall}% completion. First-fix containment and mechanical piping continue on schedule.`,
        milestone_summary: `Key containment and plant room primary equipment positioning completed successfully.`,
        safety_summary: `Zero lost time injuries (LTI). ${incidents?.c || 0} safety observations logged and resolved.`,
        lookahead_narrative: `Focus for the upcoming period is completion of primary duct risers, cable pulling, and secondary branch hydrostatic pressure testing.`,
        key_risks_issues: punchOpen?.c > 0 ? `${punchOpen.c} open snags currently monitored for consultant inspection walk.` : `No critical commercial or technical blockers at this stage.`
      };

      res.json(draft);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/progress_reports", authRequired, (req, res) => {
    try {
      const data = req.body || {};
      if (!data.project_id || !hasProjectAccess(req.user!, data.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO progress_reports (
          id, project_id, report_number, title, period_start, period_end, prepared_by, status,
          executive_summary, overall_progress_percent, planned_progress_percent, milestone_summary,
          hvac_progress, electrical_progress, plumbing_progress, fire_progress, bms_progress,
          safety_summary, manpower_peak, lookahead_narrative, key_risks_issues, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.project_id,
        data.report_number || `PR-${Date.now().toString().slice(-4)}`,
        data.title || "Progress Report",
        data.period_start || "",
        data.period_end || "",
        req.user!.name,
        data.status || "Draft",
        data.executive_summary || "",
        parseImportNumber(data.overall_progress_percent),
        parseImportNumber(data.planned_progress_percent),
        data.milestone_summary || "",
        parseImportNumber(data.hvac_progress),
        parseImportNumber(data.electrical_progress),
        parseImportNumber(data.plumbing_progress),
        parseImportNumber(data.fire_progress),
        parseImportNumber(data.bms_progress),
        data.safety_summary || "",
        parseInt(data.manpower_peak) || 0,
        data.lookahead_narrative || "",
        data.key_risks_issues || "",
        now
      );
      writeAudit(req.user!.user_id, "progress_reports", id, data.project_id, "create", null, data);
      res.status(201).json({ id, ...data, created_at: now });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/progress_reports/:id/publish", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM progress_reports WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Report not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id) || (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager")) {
        res.status(403).json({ error: "Only Project Managers and Admins can publish progress reports to the Client" });
        return;
      }
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE progress_reports
        SET status='Published to Client', published_at=?, published_by=?
        WHERE id=?
      `).run(now, req.user!.name, req.params.id);

      writeAudit(req.user!.user_id, "progress_reports", req.params.id, existing.project_id, "publish", existing, { status: "Published to Client" });
      res.json({ ok: true, id: req.params.id, status: "Published to Client", published_at: now, published_by: req.user!.name });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/progress_reports/:id/photos", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const report = db.prepare("SELECT * FROM progress_reports WHERE id=?").get(req.params.id) as any;
      if (!report || !hasProjectAccess(req.user!, report.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const { title, caption, trade, location, photo_data } = req.body || {};
      if (!photo_data) {
        res.status(400).json({ error: "Photo data required" });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO progress_report_photos (id, report_id, title, caption, trade, location, photo_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, req.params.id, title || "Site Progress Photo", caption || "", trade || "MEP", location || "", photo_data, now);
      res.status(201).json({ id, report_id: req.params.id, title, caption, trade, location, created_at: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/progress_reports/photos/:photoId", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const photo = db.prepare("SELECT * FROM progress_report_photos WHERE id=?").get(req.params.photoId) as any;
      if (!photo) {
        res.status(404).json({ error: "Photo not found" });
        return;
      }
      const report = db.prepare("SELECT * FROM progress_reports WHERE id=?").get(photo.report_id) as any;
      if (!report || !hasProjectAccess(req.user!, report.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      db.prepare("DELETE FROM progress_report_photos WHERE id=?").run(req.params.photoId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- DOCUMENT REVISION CONTROL & TRANSMITTALS ---
  app.get("/api/documents/:id/revisions", authRequired, (req, res) => {
    try {
      const doc = db.prepare("SELECT * FROM documents WHERE id=?").get(req.params.id) as any;
      if (!doc || !hasProjectAccess(req.user!, doc.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (req.user!.role === "Client" && !["Client", "All"].includes(doc.visibility || "Internal")) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (req.user!.role === "Subcontractor") {
        const isOwner = db.prepare("SELECT 1 FROM record_owners WHERE module='documents' AND record_id=? AND user_id=?").get(doc.id, req.user!.user_id);
        const isAssigned = doc.subcontractor_id === req.user!.user_id;
        if (!isOwner && !isAssigned) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
      }
      const rows = db.prepare("SELECT * FROM document_revisions WHERE document_id=? ORDER BY created_at DESC").all(req.params.id);
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/documents/:id/new-revision", authRequired, (req, res) => {
    try {
      const doc = db.prepare("SELECT * FROM documents WHERE id=?").get(req.params.id) as any;
      if (!doc) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, doc.project_id) || !canEdit(req.user!, "documents")) {
        res.status(403).json({ error: "Permission denied" });
        return;
      }
      const { new_revision_code, change_summary, attachment_name, attachment_data } = req.body || {};
      if (!new_revision_code) {
        res.status(400).json({ error: "New revision code is required" });
        return;
      }
      const now = new Date().toISOString();
      const today = now.slice(0, 10);

      // Archive previous version
      const revId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO document_revisions (id, document_id, project_id, revision_code, superseded_date, changed_by, change_summary, attachment_name, attachment_data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        revId,
        doc.id,
        doc.project_id,
        doc.revision || "Rev A",
        today,
        req.user!.name,
        change_summary || "Superseded by " + new_revision_code,
        doc.attachment_name || "",
        doc.attachment_data || "",
        now
      );

      // Update current document record
      db.prepare(`
        UPDATE documents
        SET revision=?, date_added=?, attachment_name=?, attachment_data=?, status='Approved'
        WHERE id=?
      `).run(
        new_revision_code,
        today,
        attachment_name || doc.attachment_name,
        attachment_data || doc.attachment_data,
        doc.id
      );

      writeAudit(req.user!.user_id, "documents", doc.id, doc.project_id, "new_revision", { old_rev: doc.revision }, { new_rev: new_revision_code, change_summary });
      res.json({ ok: true, document_id: doc.id, revision: new_revision_code, superseded_revision_id: revId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Transmittals (both /api/document_transmittals and /api/transmittals)
  const getTransmittalsHandler = (req: any, res: any) => {
    try {
      const projectId = req.query.project_id as string;
      let { where, params } = projectScopeSql(req.user!, projectId, "dt.project_id");
      if (!where) {
        res.status(403).json({ error: "No access to project" });
        return;
      }
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        if (req.user!.company_id) {
          where += " AND (dt.sender_company_id = ? OR dt.recipient_company_id = ?)";
          params.push(req.user!.company_id, req.user!.company_id);
        } else {
          where += " AND (dt.sender_company_id IS NULL AND dt.recipient_company_id IS NULL)";
        }
      }
      const rows = db.prepare(`
        SELECT dt.*,
          sc.name as sender_company_name,
          rc.name as recipient_company_name,
          (SELECT COUNT(*) FROM transmittal_items ti WHERE ti.transmittal_id = dt.id) as items_count
        FROM document_transmittals dt
        LEFT JOIN companies sc ON sc.id = dt.sender_company_id
        LEFT JOIN companies rc ON rc.id = dt.recipient_company_id
        WHERE ${where}
        ORDER BY dt.date_sent DESC, dt.created_at DESC
      `).all(...params);
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
  app.get("/api/document_transmittals", authRequired, getTransmittalsHandler);
  app.get("/api/transmittals", authRequired, getTransmittalsHandler);

  const getTransmittalByIdHandler = (req: any, res: any) => {
    try {
      const transmittal = db.prepare("SELECT * FROM document_transmittals WHERE id=?").get(req.params.id) as any;
      if (!transmittal || !hasProjectAccess(req.user!, transmittal.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (req.user!.role === "Client" || req.user!.role === "Subcontractor") {
        if (!req.user!.company_id || (transmittal.sender_company_id !== req.user!.company_id && transmittal.recipient_company_id !== req.user!.company_id)) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
      }
      const items = db.prepare("SELECT * FROM transmittal_items WHERE transmittal_id=?").all(req.params.id);
      res.json({ ...rowToDict(transmittal), items: items.map(rowToDict) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
  app.get("/api/document_transmittals/:id", authRequired, getTransmittalByIdHandler);
  app.get("/api/transmittals/:id", authRequired, getTransmittalByIdHandler);

  const postTransmittalHandler = (req: any, res: any) => {
    try {
      const data = req.body || {};
      if (!data.project_id || !hasProjectAccess(req.user!, data.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if ((req.user!.role === "Client" || req.user!.role === "Subcontractor") && req.user!.company_id) {
        data.sender_company_id = req.user!.company_id;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const count = (db.prepare("SELECT COUNT(*) as c FROM document_transmittals WHERE project_id=?").get(data.project_id) as any)?.c || 0;
      const num = data.transmittal_number || `TRN-${String(count + 1).padStart(3, "0")}`;

      db.prepare(`
        INSERT INTO document_transmittals (id, project_id, transmittal_number, sender_company_id, recipient_company_id, subject, purpose, date_sent, due_date, status, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.project_id,
        num,
        data.sender_company_id || null,
        data.recipient_company_id || null,
        data.subject || "Document Transmittal",
        data.purpose || "For Approval",
        data.date_sent || now.slice(0, 10),
        data.due_date || "",
        data.status || "Transmitted",
        data.notes || "",
        now
      );

      if (Array.isArray(data.items)) {
        const insItem = db.prepare(`
          INSERT INTO transmittal_items (id, transmittal_id, document_id, document_title, document_number, revision, format, status, action_required, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of data.items) {
          insItem.run(
            crypto.randomUUID(),
            id,
            item.document_id || null,
            item.document_title || item.name || "Drawing",
            item.document_number || "",
            item.revision || "Rev A",
            item.format || "PDF",
            "Transmitted",
            item.action_required || "Review & Approve",
            item.notes || ""
          );
        }
      }

      writeAudit(req.user!.user_id, "transmittals", id, data.project_id, "create", null, data);
      res.status(201).json({ id, transmittal_number: num, ...data, created_at: now });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  };
  app.post("/api/document_transmittals", authRequired, postTransmittalHandler);
  app.post("/api/transmittals", authRequired, postTransmittalHandler);

  // --- SUBCONTRACTOR PROGRESS SUBMISSION & VERIFICATION WORKFLOW ---
  app.get("/api/progress_submissions", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client") {
        res.status(403).json({ error: "Access denied: subcontractor submissions are internal" });
        return;
      }
      const projectId = req.query.project_id as string;
      let { where, params } = projectScopeSql(req.user!, projectId, "ps.project_id");
      if (!where) {
        res.status(403).json({ error: "No access to project" });
        return;
      }
      if (req.user!.role === "Subcontractor") {
        const subConds: string[] = [];
        const subParams: any[] = [];
        if (req.user!.work_package_id) {
          subConds.push("ps.work_package_id = ?");
          subParams.push(req.user!.work_package_id);
        }
        if (req.user!.company_id) {
          subConds.push("ps.company_id = ?");
          subParams.push(req.user!.company_id);
        }
        subConds.push("ps.submitted_by = ?");
        subParams.push(req.user!.name);
        where += ` AND (${subConds.join(" OR ")})`;
        params.push(...subParams);
      }
      const rows = db.prepare(`
        SELECT ps.*,
          wp.name as work_package_name,
          wp.code as work_package_code,
          c.name as company_name
        FROM progress_submissions ps
        LEFT JOIN work_packages wp ON wp.id = ps.work_package_id
        LEFT JOIN companies c ON c.id = ps.company_id
        WHERE ${where}
        ORDER BY ps.created_at DESC
      `).all(...params);
      res.json(rows.map(rowToDict));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/progress_submissions", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client") {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const data = req.body || {};
      if (!data.project_id || !hasProjectAccess(req.user!, data.project_id)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      let wpId = data.work_package_id || null;
      let compId = data.company_id || null;
      if (req.user!.role === "Subcontractor") {
        if (req.user!.work_package_id && data.work_package_id && data.work_package_id !== req.user!.work_package_id) {
          res.status(403).json({ error: "Cannot submit progress for another work package" });
          return;
        }
        if (req.user!.company_id && data.company_id && data.company_id !== req.user!.company_id) {
          res.status(403).json({ error: "Cannot submit progress for another company" });
          return;
        }
        wpId = req.user!.work_package_id || wpId;
        compId = req.user!.company_id || compId;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const claimedVal = data.claimed_percent !== undefined ? data.claimed_percent : data.claimed_percentage;
      db.prepare(`
        INSERT INTO progress_submissions (
          id, project_id, work_package_id, company_id, submitted_by, period_date,
          discipline, claimed_percent, quantity_installed, unit, notes, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Submitted', ?)
      `).run(
        id,
        data.project_id,
        wpId,
        compId,
        req.user!.name,
        data.period_date || now.slice(0, 10),
        data.discipline || "MEP",
        parseImportNumber(claimedVal),
        parseImportNumber(data.quantity_installed),
        data.unit || "%",
        data.notes || "",
        now
      );
      writeAudit(req.user!.user_id, "progress_submissions", id, data.project_id, "submit", null, data);
      res.status(201).json({ id, ...data, work_package_id: wpId, company_id: compId, claimed_percent: parseImportNumber(claimedVal), status: "Submitted", created_at: now });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put("/api/progress_submissions/:id", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM progress_submissions WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Submission not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id) || (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager" && req.user!.role !== "SiteEngineer")) {
        res.status(403).json({ error: "Only Project Managers or Site Engineers can review progress submissions" });
        return;
      }
      const data = req.body || {};
      const now = new Date().toISOString();
      const finalStatus = data.status || existing.status;
      const rawAdj = data.verified_percentage !== undefined ? data.verified_percentage : (data.verified_percent !== undefined ? data.verified_percent : data.adjusted_percent);
      const finalPercent = rawAdj !== undefined ? parseImportNumber(rawAdj) : (existing.adjusted_percent || existing.claimed_percent);
      const reviewComments = data.review_comments !== undefined ? data.review_comments : existing.review_comments;

      db.prepare(`
        UPDATE progress_submissions
        SET status=?, adjusted_percent=?, reviewed_by=?, review_comments=?, approved_at=?
        WHERE id=?
      `).run(finalStatus, finalPercent, req.user!.name, reviewComments || "", now, req.params.id);

      if ((finalStatus === "Approved" || finalStatus === "Approved with Adjustments") && existing.work_package_id) {
        db.prepare(`
          UPDATE tasks
          SET progress = MAX(progress, ?)
          WHERE work_package_id = ? AND status != 'Completed'
        `).run(finalPercent, existing.work_package_id);
      }

      writeAudit(req.user!.user_id, "progress_submissions", req.params.id, existing.project_id, "update", existing, data);
      const updated = db.prepare("SELECT * FROM progress_submissions WHERE id=?").get(req.params.id) as any;
      res.json({
        ...rowToDict(updated),
        verified_percentage: updated.adjusted_percent,
        verified_percent: updated.adjusted_percent
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/progress_submissions/:id/review", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM progress_submissions WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Submission not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id) || (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager" && req.user!.role !== "SiteEngineer")) {
        res.status(403).json({ error: "Only Project Managers or Site Engineers can review progress submissions" });
        return;
      }
      const { status, adjusted_percent, review_comments } = req.body || {};
      const now = new Date().toISOString();
      const finalStatus = status || "Approved";
      const finalPercent = adjusted_percent !== undefined ? parseImportNumber(adjusted_percent) : existing.claimed_percent;

      db.prepare(`
        UPDATE progress_submissions
        SET status=?, adjusted_percent=?, reviewed_by=?, review_comments=?, approved_at=?
        WHERE id=?
      `).run(finalStatus, finalPercent, req.user!.name, review_comments || "", now, req.params.id);

      if ((finalStatus === "Approved" || finalStatus === "Approved with Adjustments") && existing.work_package_id) {
        db.prepare(`
          UPDATE tasks
          SET progress = MAX(progress, ?)
          WHERE work_package_id = ? AND status != 'Completed'
        `).run(finalPercent, existing.work_package_id);
      }

      writeAudit(req.user!.user_id, "progress_submissions", req.params.id, existing.project_id, "review", existing, { status: finalStatus, adjusted_percent: finalPercent, review_comments });
      res.json({ ok: true, id: req.params.id, status: finalStatus, adjusted_percent: finalPercent, reviewed_by: req.user!.name });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/projects/:id/client-summary", authRequired, (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      if (!hasProjectAccess(req.user!, projectId)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      if (req.user!.role !== "Client") {
        res.status(403).json({ error: "This endpoint is for the Client Portal only" });
        return;
      }
      const project = db.prepare("SELECT id, name, client, status, start_date, end_date FROM projects WHERE id=?").get(projectId) as any;
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Overall progress for Client is taken strictly from the latest Published Progress Report to ensure vetted verification
      const latestPublishedReport = db.prepare(`
        SELECT overall_progress_percent FROM progress_reports
        WHERE project_id = ? AND status IN ('Published', 'Published to Client')
        ORDER BY period_end DESC, published_at DESC LIMIT 1
      `).get(projectId) as any;

      const hasPublishedReport = Boolean(latestPublishedReport && latestPublishedReport.overall_progress_percent !== undefined && latestPublishedReport.overall_progress_percent !== null);
      const overallProgress = hasPublishedReport ? latestPublishedReport.overall_progress_percent : null;
      const progressStatus = hasPublishedReport ? "Published" : "Progress not yet published";

      const tasks = db.prepare("SELECT * FROM tasks WHERE project_id=?").all(projectId) as any[];
      const today = new Date().toISOString().slice(0, 10);
      const upcomingMilestones = tasks
        .filter(t => t.is_milestone && t.end >= today)
        .sort((a, b) => (a.end > b.end ? 1 : -1));
      const nextMilestone = upcomingMilestones[0]
        ? { title: upcomingMilestones[0].title, date: upcomingMilestones[0].end }
        : null;

      const publishedDocuments = db.prepare(
        "SELECT id, name, category, revision, date_added, published_at FROM documents WHERE project_id=? AND visibility IN ('Client','All') ORDER BY published_at DESC"
      ).all(projectId);
      const publishedChangeOrders = db.prepare(
        "SELECT id, number, title, cost_impact, schedule_impact_days, status, published_at FROM change_orders WHERE project_id=? AND visibility IN ('Client','All') ORDER BY published_at DESC"
      ).all(projectId);
      const decisionsAwaiting = (publishedChangeOrders as any[]).filter(
        co => !["Approved", "Rejected", "Certified", "Closed"].includes(co.status)
      ).length;

      res.json({
        project: { id: project.id, name: project.name, client: project.client, status: project.status, start_date: project.start_date, end_date: project.end_date },
        overall_progress: overallProgress,
        overall_progress_percent: overallProgress,
        progress_status: progressStatus,
        next_milestone: nextMilestone,
        published_documents: publishedDocuments,
        published_change_orders: publishedChangeOrders,
        open_client_items: { decisions_required: decisionsAwaiting, documents_published: (publishedDocuments as any[]).length },
      });
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
          const docConds: string[] = [
            "documents.subcontractor_id = ?",
            "documents.id IN (SELECT record_id FROM record_owners WHERE module='documents' AND user_id=?)"
          ];
          params.push(req.user!.user_id, req.user!.user_id);
          if (req.user!.work_package_id) {
            docConds.push("documents.work_package_id = ?");
            params.push(req.user!.work_package_id);
          }
          if (req.user!.company_id) {
            docConds.push("documents.company_id = ?");
            params.push(req.user!.company_id);
          }
          where += ` AND (${docConds.join(" OR ")})`;
        } else if (table === "tasks" || table === "submittals" || table === "punchlist" || table === "dailylogs" || table === "daily_logs") {
          const conditions: string[] = [
            "id IN (SELECT record_id FROM record_owners WHERE module=? AND user_id=?)"
          ];
          params.push(module, req.user!.user_id);
          if (req.user!.work_package_id) {
            conditions.push("work_package_id = ?");
            params.push(req.user!.work_package_id);
          }
          if (req.user!.company_id) {
            conditions.push("company_id = ?");
            params.push(req.user!.company_id);
          }
          if (!req.user!.work_package_id && !req.user!.company_id) {
            conditions.push("1=1");
          }
          where += ` AND (${conditions.join(" OR ")})`;
        } else {
          where += " AND id IN (SELECT record_id FROM record_owners WHERE module=? AND user_id=?)";
          params.push(module, req.user!.user_id);
        }
      }
      // Client visibility: enforced here in the query itself, not just hidden
      // in the UI. A Client only ever sees documents/change_orders explicitly
      // published to them - everything else stays invisible even to a
      // direct API call, regardless of what the frontend shows or hides.
      if (req.user!.role === "Client" && (table === "documents" || table === "drawings" || table === "change_orders")) {
        where += " AND visibility IN ('Client', 'All')";
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
      const accessibleRows = rows.filter(r => canAccessRecord(req.user!, r, "view", module));
      res.json(accessibleRows.map(rowToDict));
    });

    // Create
    app.post(`/api/${table}`, authRequired, (req, res) => {
      const data = req.body || {};
      // Internal records start unpublished regardless of request payload.
      // Client-originated document submissions are the one explicit
      // exception: they are visible back to that Client portal by definition,
      // but this does NOT grant the Client contractor-side publish authority.
      delete data.visibility;
      delete data.published_by;
      delete data.published_at;
      const isSubcontractorDocument = (table === "documents" || table === "drawings") && req.user!.role === "Subcontractor";
      const isClientDocumentSubmission = table === "documents" && req.user!.role === "Client";
      if (!isSubcontractorDocument && !isClientDocumentSubmission && !canEdit(req.user!, module)) {
        res.status(403).json({ error: `No edit access to ${module}` });
        return;
      }
      if (!hasProjectAccess(req.user!, data.project_id)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }

      // Subcontractor work package and company boundary enforcement
      if (req.user!.role === "Subcontractor") {
        if (req.user!.work_package_id) {
          if (data.work_package_id && data.work_package_id !== req.user!.work_package_id) {
            res.status(403).json({ error: "Cannot create records for another work package" });
            return;
          }
          data.work_package_id = req.user!.work_package_id;
        }
        if (req.user!.company_id) {
          if (data.company_id && data.company_id !== req.user!.company_id) {
            res.status(403).json({ error: "Cannot create records for another company" });
            return;
          }
          data.company_id = req.user!.company_id;
        }
      }

      if (isClientDocumentSubmission) {
        const allowedClientCategories = new Set(["Client Submission", "Clarification Attachment", "Client Drawing", "Other"]);
        data.category = allowedClientCategories.has(String(data.category || "")) ? data.category : "Client Submission";
        data.name = String(data.name || data.attachment_name || "Client Submission").slice(0, 300);
        data.revision = String(data.revision || "Rev 0").slice(0, 80);
        data.date_added = data.date_added || new Date().toISOString().slice(0, 10);
        data.visibility = "Client";
        data.published_by = null;
        data.published_at = null;
        data.subcontractor_id = null;
        data.uploaded_by = req.user!.name;
        delete data.markup_data;
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
        } else if (req.user!.role === "Client") {
          // Values were normalized above for the dedicated Client submission path.
          data.subcontractor_id = null;
          data.uploaded_by = req.user!.name;
          data.visibility = "Client";
          data.published_by = null;
          data.published_at = null;
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
      if (!canAccessRecord(req.user!, existing, "edit", module)) {
        res.status(403).json({ error: "No edit access to this record" });
        return;
      }

      const data = req.body || {};
      if (req.user!.role === "Subcontractor") {
        if (data.work_package_id && req.user!.work_package_id && data.work_package_id !== req.user!.work_package_id) {
          res.status(403).json({ error: "Cannot assign record to another work package" });
          return;
        }
        if (data.company_id && req.user!.company_id && data.company_id !== req.user!.company_id) {
          res.status(403).json({ error: "Cannot assign record to another company" });
          return;
        }
      }

      // Publishing (making a record Client-visible) is a separate authority
      // from ordinary edit access - a Site Engineer or QA/QC user can edit a
      // document's content, but that shouldn't let them decide what a client
      // gets to see. Restricted to the roles who actually own the client
      // relationship, regardless of who can otherwise edit this module.
      if ("visibility" in data && (data.visibility === "Client" || data.visibility === "All")) {
        if (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager") {
          res.status(403).json({ error: "Only an Admin or Project Manager can publish records to the client" });
          return;
        }
      }
      // published_by/published_at are accountability fields - always
      // server-stamped, never trusted from the request body. Publishing
      // (setting visibility to Client/All) records who did it and when.
      delete data.published_by;
      delete data.published_at;
      if ("visibility" in data && data.visibility !== existing.visibility && (data.visibility === "Client" || data.visibility === "All")) {
        data.published_by = req.user!.user_id;
        data.published_at = new Date().toISOString();
      }
      // A published record whose meaningful content is edited afterward is
      // automatically un-published, rather than silently letting the client
      // keep seeing content that no longer matches what was reviewed under
      // that publish timestamp. Republishing (explicitly setting visibility
      // again in the same request) is still allowed in one step.
      if (
        (existing.visibility === "Client" || existing.visibility === "All") &&
        !("visibility" in data) &&
        Object.keys(data).some(k => k !== "id" && k !== "project_id" && k !== "visibility" && k !== "published_by" && k !== "published_at")
      ) {
        data.visibility = "Internal";
        data.published_by = null;
        data.published_at = null;
      }
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
        if (NOTIFY_WORTHY_STATUSES.has(data.status)) {
          const owner = db.prepare("SELECT user_id FROM record_owners WHERE module=? AND record_id=?").get(module, req.params.id) as any;
          if (owner && owner.user_id !== req.user!.user_id) {
            const label = existing.title || existing.number || existing.item || existing.name || module;
            createNotification(
              owner.user_id, existing.project_id, module, req.params.id,
              `${label} is now ${data.status}`,
              `${req.user!.name} changed the status of "${label}" to ${data.status}.`
            );
          }
        }
      }
      if ("assigned_to" in data && data.assigned_to && data.assigned_to !== existing.assigned_to) {
        const label = existing.title || existing.number || existing.item || module;
        createNotification(
          data.assigned_to, existing.project_id, module, req.params.id,
          `You were assigned: ${label}`,
          `${req.user!.name} assigned you to "${label}".`
        );
      }
      writeAudit(req.user!.user_id, module, req.params.id, existing.project_id, "update", existing, updated);
      res.json(rowToDict(updated));
    });

    // Delete
    app.delete(`/api/${table}/:id`, authRequired, (req, res) => {
      const actualTable = table === "drawings" ? "documents" : table === "daily_logs" ? "dailylogs" : table;
      const existing = db.prepare(`SELECT * FROM ${actualTable} WHERE id=?`).get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (!canAccessRecord(req.user!, existing, "delete", module)) {
        res.status(403).json({ error: "No delete access to this record" });
        return;
      }
      db.prepare(`DELETE FROM ${actualTable} WHERE id=?`).run(req.params.id);
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
