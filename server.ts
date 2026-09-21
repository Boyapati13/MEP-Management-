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
import { runMigrations } from "./server/db/migrations";
import { registerWorkPackageRoutes } from "./server/routes/workPackageRoutes";
import { registerProcurementRoutes } from "./server/routes/procurementRoutes";
import { registerRiskRoutes } from "./server/routes/riskRoutes";
import { registerTaskRoutes } from "./server/routes/taskRoutes";
import { registerProgressRoutes } from "./server/routes/progressRoutes";
import { getNextSequence } from "./server/services/referenceSequence";
import { syncProcurementTaskBlocker } from "./server/services/blockerService";
import { calculateRiskScore } from "./server/services/riskService";
import { extractContractorDocumentIntelligence, applyContractorIntelligenceAndVerify, normalizeDate } from "./server/services/contractorDocIntelligence";

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
  worker_id?: string;
  access_scope?: 'company' | 'work_package' | 'explicit_packages';
  allowed_work_package_ids?: string[] | string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DB_PATH = process.env.MEP_DB_PATH || path.join(process.cwd(), "mep_pm.db");
const db = new DatabaseSync(DB_PATH);
try {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 10000;");
  initDb();
  runMigrations(db);
} catch (e: any) {
  console.error("Database initialization / migration runner warning:", e?.message);
}

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
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "workforce", "sites", "workers", "site_instructions", "leave_requests", "shift_templates",
      "payroll_periods", "payroll_entries", "payroll_profiles", "attendance_adjustments", "worker_assignments", "project_updates",
      "project_actions", "project_decisions"
    ],
    edit: [
      "tasks", "planner", "rfis", "submittals", "punchlist", "costs", "budget",
      "dailylogs", "documents", "projects",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "procurement", "material_requests", "risks", "ncrs",
      "commissioning", "handover", "wbs", "attendance",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "workforce", "sites", "workers", "site_instructions", "leave_requests", "shift_templates",
      "payroll_periods", "payroll_entries", "payroll_profiles", "attendance_adjustments", "worker_assignments", "project_updates",
      "project_actions", "project_decisions"
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
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "workforce", "sites", "workers", "site_instructions", "leave_requests", "shift_templates",
      "attendance_adjustments", "worker_assignments", "project_updates",
      "project_actions", "project_decisions"
    ],
    edit: [
      "tasks", "planner", "rfis", "submittals", "punchlist", "costs", "budget",
      "dailylogs", "documents", "projects",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "procurement", "material_requests", "risks", "ncrs",
      "commissioning", "handover", "wbs", "attendance",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "workforce", "sites", "workers", "site_instructions", "leave_requests", "shift_templates",
      "attendance_adjustments", "worker_assignments", "project_updates",
      "project_actions", "project_decisions"
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
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "workforce", "sites", "workers", "site_instructions", "leave_requests", "attendance_adjustments", "worker_assignments", "project_updates",
      "project_actions", "project_decisions"
    ],
    edit: [
      "tasks", "planner", "rfis", "submittals", "punchlist", "dailylogs", "documents",
      "change_orders", "safety_incidents", "inspections",
      "meeting_minutes", "timesheets", "equipment", "material_requests",
      "commissioning", "attendance",
      "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "site_instructions", "leave_requests", "attendance_adjustments", "project_updates",
      "project_actions", "project_decisions"
    ],
    delete: false,
  },
  CommercialManager: {
    view: [
      "dashboard", "costs", "budget", "change_orders", "purchase_orders",
      "procurement", "material_requests", "dependencies", "risks",
      "handover", "documents", "projects", "gantt", "wbs", "tasks", "planner", "submittals",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "payroll_periods", "payroll_entries", "payroll_profiles", "project_updates",
      "project_actions", "project_decisions"
    ],
    edit: [
      "costs", "budget", "change_orders", "purchase_orders",
      "procurement", "material_requests", "risks", "handover", "documents",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "payroll_periods", "payroll_entries", "payroll_profiles", "project_updates",
      "project_actions", "project_decisions"
    ],
    delete: false,
  },
  QAQC: {
    view: [
      "dashboard", "punchlist", "inspections", "ncrs", "commissioning",
      "handover", "submittals", "rfis", "dailylogs", "documents",
      "site_today", "equipment", "tasks", "planner",
      "companies", "work_packages", "clarifications", "transmittals", "progress_submissions", "project_updates",
      "project_actions", "project_decisions"
    ],
    edit: [
      "punchlist", "inspections", "ncrs", "commissioning",
      "handover", "documents",
      "clarifications", "transmittals", "project_updates",
      "project_actions", "project_decisions"
    ],
    delete: false,
  },
  SafetyOfficer: {
    view: [
      "dashboard", "safety_incidents", "risks", "inspections",
      "dailylogs", "timesheets", "attendance", "site_today",
      "documents", "equipment", "tasks", "planner",
      "companies", "work_packages", "clarifications", "progress_reports",
      "workforce", "sites", "workers", "project_updates",
      "project_actions", "project_decisions"
    ],
    edit: [
      "safety_incidents", "risks", "inspections", "dailylogs",
      "attendance", "documents", "clarifications", "project_updates",
      "project_actions", "project_decisions"
    ],
    delete: false,
  },
  Subcontractor: {
    view: [
      "dashboard", "tasks", "planner", "submittals", "punchlist", "dailylogs", "documents",
      "safety_incidents", "timesheets", "equipment", "dependencies",
      "material_requests", "site_today", "calendar", "attendance",
      "companies", "work_packages", "clarifications", "transmittals", "progress_submissions",
      "site_instructions", "leave_requests", "workers", "project_updates",
      "project_actions"
    ],
    edit: [
      "tasks", "planner", "submittals", "punchlist", "dailylogs", "documents", "safety_incidents",
      "timesheets", "dependencies", "material_requests", "attendance",
      "clarifications", "progress_submissions", "leave_requests", "project_updates"
    ],
    delete: false,
  },
  Consultant: {
    view: [
      "dashboard", "tasks", "planner", "gantt", "rfis", "submittals", "punchlist",
      "costs", "change_orders", "inspections", "meeting_minutes", "ncrs",
      "commissioning", "handover", "documents", "site_today", "calendar",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "project_updates",
      "project_actions", "project_decisions"
    ],
    edit: [
      "rfis", "submittals", "inspections", "commissioning", "handover",
      "clarifications", "transmittals",
      "project_actions", "project_decisions"
    ],
    delete: false,
  },
  Client: {
    view: ["client_dashboard", "projects", "documents", "change_orders", "progress_reports", "clarifications", "project_updates", "project_actions", "project_decisions"],
    edit: [],
    delete: false,
  },
  Worker: {
    view: [
      "attendance", "tasks", "site_instructions", "leave_requests",
      "timesheets", "documents", "workforce", "sites", "project_updates"
    ],
    edit: [
      "attendance", "site_instructions", "leave_requests", "timesheets"
    ],
    delete: false,
  },
  SiteSupervisor: {
    view: [
      "attendance", "tasks", "site_instructions", "leave_requests",
      "timesheets", "documents", "workforce", "sites", "workers",
      "attendance_adjustments", "shift_templates", "worker_assignments", "project_updates"
    ],
    edit: [
      "attendance", "site_instructions", "leave_requests", "timesheets",
      "attendance_adjustments", "tasks", "project_updates"
    ],
    delete: false,
  },
};

const TABLE_CONFIG: Record<string, { cols: string[]; module: string }> = {
  tasks: {
    cols: [
      "id", "project_id", "title", "description", "trade", "assignee", "assigned_worker_id",
      "start", "end", "progress", "status", "priority", "wbs_code", "wbs_item_id", "duration",
      "is_summary", "is_milestone", "work_package_id", "company_id", "site_id", "supervisor_id",
      "baseline_start_date", "baseline_end_date", "forecast_start_date", "forecast_end_date",
      "actual_start_date", "actual_end_date", "drawing_ref", "drawing_id", "boq_ref",
      "boq_item_id", "procurement_item_id", "evidence_required", "evidence_type",
      "evidence_url", "evidence_notes", "blocker_count"
    ],
    module: "tasks",
  },
  task_blockers: {
    cols: ["id", "task_id", "project_id", "blocker_type", "description", "blocking_trade", "impact_days", "status", "reported_by", "reported_by_name", "resolved_by", "resolved_by_name", "resolution_notes", "created_at", "resolved_at"],
    module: "tasks",
  },
  project_updates: {
    cols: ["id", "project_id", "title", "category", "content", "progress_percent", "trade", "work_package_id", "weather", "location", "pinned", "attachment_data", "attachment_name", "created_by", "created_by_name", "created_at"],
    module: "project_updates",
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
    cols: ["id", "project_id", "po_number", "vendor", "trade", "description", "amount", "order_date", "expected_delivery", "expected_delivery_date", "actual_delivery_date", "lead_time_days", "task_id", "status"],
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
  wbs: {
    cols: ["id", "project_id", "parent_id", "code", "name", "level", "discipline", "system", "active"],
    module: "wbs",
  },
  dependencies: {
    cols: [
      "id", "project_id", "task_id", "predecessor_task_id", "dependency_type", "task_owner", "dependent_party", "description",
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
      "quantity", "unit", "required_date", "reason", "drawing", "boq_reference", "requested_by", "task_id", "status"
    ],
    module: "material_requests",
  },
  risks: {
    cols: ["id", "project_id", "risk_no", "title", "category", "probability", "impact", "risk_score", "risk_level", "owner", "mitigation", "target_date", "contingency_cost", "linked_task_id", "status", "created_by", "created_at"],
    module: "risks",
  },
  project_risks: {
    cols: ["id", "project_id", "risk_no", "title", "category", "probability", "impact", "risk_score", "risk_level", "owner", "mitigation", "target_date", "contingency_cost", "linked_task_id", "status", "created_by", "created_at"],
    module: "risks",
  },
  project_actions: {
    cols: ["id", "project_id", "action_no", "title", "description", "assigned_to_user_id", "assigned_to_name", "priority", "status", "due_date", "source_type", "source_id", "created_by", "created_at", "completed_at"],
    module: "project_actions",
  },
  actions: {
    cols: ["id", "project_id", "action_no", "title", "description", "assigned_to_user_id", "assigned_to_name", "priority", "status", "due_date", "source_type", "source_id", "created_by", "created_at", "completed_at"],
    module: "project_actions",
  },
  project_decisions: {
    cols: ["id", "project_id", "decision_no", "title", "context", "options_considered", "decision_taken", "decided_by", "decision_date", "cost_impact", "schedule_impact_days", "status", "created_by", "created_at"],
    module: "project_decisions",
  },
  decisions: {
    cols: ["id", "project_id", "decision_no", "title", "context", "options_considered", "decision_taken", "decided_by", "decision_date", "cost_impact", "schedule_impact_days", "status", "created_by", "created_at"],
    module: "project_decisions",
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
  // Site instruction 7-stage FSM
  site_instructions: {
    Draft: ["Assigned"],
    Assigned: ["Acknowledged", "Draft"],
    Acknowledged: ["In Progress"],
    "In Progress": ["Ready for Verification"],
    "Ready for Verification": ["Verified", "In Progress"],
    Verified: ["Closed"],
    Closed: [],
  },
  // Leave request approval FSM
  leave_requests: {
    Pending: ["Approved", "Rejected"],
    Approved: ["Cancelled"],
    Rejected: ["Pending"],
    Cancelled: [],
  },
  // Attendance adjustment FSM
  attendance_adjustments: {
    Pending: ["Approved", "Rejected"],
    Approved: [],
    Rejected: ["Pending"],
  },
  // Overtime approval FSM (on attendance records)
  overtime_approval: {
    Pending: ["Approved", "Rejected"],
    Approved: [],
    Rejected: ["Pending"],
  },
};

// Database Initialization & Seeding
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE, name TEXT,
      password_hash TEXT, role TEXT, email TEXT, phone TEXT,
      company_id TEXT, company TEXT, trade TEXT, work_package_id TEXT,
      worker_id TEXT, status TEXT DEFAULT 'Active', access_scope TEXT DEFAULT 'work_package',
      allowed_work_package_ids TEXT, created_at TEXT, last_login TEXT, must_change_password INTEGER DEFAULT 0
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
      description TEXT, amount REAL, order_date TEXT, expected_delivery TEXT, expected_delivery_date TEXT, actual_delivery_date TEXT, lead_time_days INTEGER, task_id TEXT, status TEXT
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
      predecessor_task_id TEXT, predecessor_id TEXT, successor_id TEXT,
      dependency_type TEXT DEFAULT 'Finish-to-Start',
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
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, risk_no TEXT, title TEXT, category TEXT,
      probability TEXT, impact TEXT, risk_score REAL, risk_level TEXT DEFAULT 'Medium', owner TEXT, mitigation TEXT,
      target_date TEXT, contingency_cost REAL DEFAULT 0, linked_task_id TEXT, work_package_id TEXT, status TEXT, created_by TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_actions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, action_no TEXT, title TEXT NOT NULL,
      description TEXT, assigned_to_user_id TEXT, assigned_to_name TEXT, priority TEXT DEFAULT 'Medium',
      status TEXT DEFAULT 'Open', due_date TEXT, source_type TEXT DEFAULT 'General', source_id TEXT,
      created_by TEXT, created_at TEXT, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_decisions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, decision_no TEXT, title TEXT NOT NULL,
      context TEXT, options_considered TEXT, decision_taken TEXT, decided_by TEXT, decision_date TEXT,
      cost_impact REAL DEFAULT 0, schedule_impact_days INTEGER DEFAULT 0, status TEXT DEFAULT 'Approved',
      created_by TEXT, created_at TEXT
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
      report_number TEXT,
      report_no TEXT,
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
      revision_no INTEGER DEFAULT 0,
      supersedes_report_id TEXT,
      snapshot_schema_version INTEGER DEFAULT 1,
      snapshot_data TEXT,
      published_at TEXT,
      published_by TEXT,
      created_by TEXT,
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
    -- =====================================================
    -- WORKFORCE MODULE TABLES (V1.2)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      city TEXT,
      country TEXT,
      latitude REAL,
      longitude REAL,
      geofence_radius_m REAL DEFAULT 100,
      geofence_warning_radius_m REAL DEFAULT 150,
      timezone TEXT DEFAULT 'UTC',
      status TEXT DEFAULT 'Active',
      created_by TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      site_id TEXT,
      company_id TEXT,
      user_id TEXT,
      name TEXT NOT NULL,
      employee_id TEXT,
      trade TEXT,
      employment_type TEXT DEFAULT 'Permanent',
      nationality TEXT,
      phone TEXT,
      email TEXT,
      supervisor_id TEXT,
      work_package_id TEXT,
      status TEXT DEFAULT 'Active',
      hired_date TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS worker_assignments (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      site_id TEXT,
      work_package_id TEXT,
      supervisor_id TEXT,
      role_on_site TEXT,
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT 'Active',
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS shift_templates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      grace_minutes INTEGER DEFAULT 15,
      break_minutes INTEGER DEFAULT 60,
      regular_hours REAL DEFAULT 8,
      ot_threshold_hours REAL DEFAULT 8,
      status TEXT DEFAULT 'Active',
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS worker_schedules (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      shift_template_id TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS site_instructions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      site_id TEXT,
      work_package_id TEXT,
      instruction_number TEXT,
      instruction_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'Medium',
      status TEXT DEFAULT 'Draft',
      assigned_worker_id TEXT,
      assigned_supervisor_id TEXT,
      issued_by TEXT,
      issued_at TEXT,
      acknowledged_at TEXT,
      started_at TEXT,
      evidence_submitted_at TEXT,
      verified_by TEXT,
      verified_at TEXT,
      closed_at TEXT,
      due_date TEXT,
      location TEXT,
      related_document_id TEXT,
      related_drawing_id TEXT,
      related_rfi_id TEXT,
      related_ncr_id TEXT,
      related_boq_item_id TEXT,
      attachment_name TEXT,
      attachment_data TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS site_instruction_updates (
      id TEXT PRIMARY KEY,
      instruction_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT,
      update_type TEXT DEFAULT 'Comment',
      content TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS site_instruction_attachments (
      id TEXT PRIMARY KEY,
      instruction_id TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      attachment_name TEXT,
      attachment_data TEXT,
      attachment_type TEXT DEFAULT 'Evidence',
      caption TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS leave_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      is_paid INTEGER DEFAULT 1,
      default_days_per_year INTEGER DEFAULT 0,
      requires_approval INTEGER DEFAULT 1,
      description TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS leave_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      worker_id TEXT,
      user_id TEXT NOT NULL,
      leave_type_id TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days_requested REAL NOT NULL DEFAULT 1,
      reason TEXT,
      status TEXT DEFAULT 'Pending',
      approved_by TEXT,
      approved_at TEXT,
      reject_reason TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS leave_balances (
      id TEXT PRIMARY KEY,
      worker_id TEXT,
      user_id TEXT NOT NULL,
      leave_type_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      entitlement_days REAL DEFAULT 0,
      taken_days REAL DEFAULT 0,
      pending_days REAL DEFAULT 0,
      balance_days REAL DEFAULT 0,
      updated_at TEXT,
      UNIQUE(user_id, leave_type_id, year)
    );
    CREATE TABLE IF NOT EXISTS public_holidays (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      site_id TEXT,
      country_code TEXT,
      holiday_date TEXT NOT NULL,
      name TEXT NOT NULL,
      paid INTEGER DEFAULT 1,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS attendance_adjustments (
      id TEXT PRIMARY KEY,
      attendance_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      worker_id TEXT,
      user_id TEXT NOT NULL,
      original_punch_in TEXT,
      original_punch_out TEXT,
      adjusted_punch_in TEXT,
      adjusted_punch_out TEXT,
      adjustment_reason TEXT NOT NULL,
      status TEXT DEFAULT 'Pending',
      submitted_by TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      reject_reason TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS payroll_profiles (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL UNIQUE,
      basic_daily_rate REAL DEFAULT 0,
      basic_monthly_rate REAL DEFAULT 0,
      rate_type TEXT DEFAULT 'Daily',
      currency TEXT DEFAULT 'USD',
      ot_multiplier REAL DEFAULT 1.5,
      housing_allowance REAL DEFAULT 0,
      transport_allowance REAL DEFAULT 0,
      food_allowance REAL DEFAULT 0,
      bank_account TEXT,
      bank_name TEXT,
      effective_from TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS payroll_periods (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      period_name TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      status TEXT DEFAULT 'Open',
      locked_by TEXT,
      locked_at TEXT,
      total_gross REAL DEFAULT 0,
      total_net REAL DEFAULT 0,
      created_by TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS payroll_entries (
      id TEXT PRIMARY KEY,
      payroll_period_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      regular_days REAL DEFAULT 0,
      regular_hours REAL DEFAULT 0,
      overtime_hours REAL DEFAULT 0,
      absent_days REAL DEFAULT 0,
      leave_days REAL DEFAULT 0,
      basic_pay REAL DEFAULT 0,
      overtime_pay REAL DEFAULT 0,
      housing_allowance REAL DEFAULT 0,
      transport_allowance REAL DEFAULT 0,
      food_allowance REAL DEFAULT 0,
      gross_pay REAL DEFAULT 0,
      deductions REAL DEFAULT 0,
      net_pay REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      notes TEXT,
      computed_at TEXT,
      created_at TEXT,
      UNIQUE(payroll_period_id, worker_id)
    );
    CREATE TABLE IF NOT EXISTS payroll_adjustments (
      id TEXT PRIMARY KEY,
      payroll_entry_id TEXT NOT NULL,
      payroll_period_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      is_deduction INTEGER DEFAULT 0,
      created_by TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_updates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Site Progress',
      content TEXT NOT NULL,
      progress_percent INTEGER,
      trade TEXT,
      work_package_id TEXT,
      weather TEXT,
      location TEXT,
      pinned INTEGER DEFAULT 0,
      attachment_data TEXT,
      attachment_name TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_updates_proj ON project_updates(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS task_blockers (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      blocker_type TEXT NOT NULL DEFAULT 'Trade Interface',
      description TEXT NOT NULL,
      blocking_trade TEXT,
      impact_days INTEGER DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Active',
      reported_by TEXT NOT NULL,
      reported_by_name TEXT,
      resolved_by TEXT,
      resolved_by_name TEXT,
      resolution_notes TEXT,
      source_type TEXT,
      source_id TEXT,
      resolved INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_task_blockers_task ON task_blockers(task_id, status);
    CREATE INDEX IF NOT EXISTS idx_task_blockers_proj ON task_blockers(project_id, status);

    CREATE TABLE IF NOT EXISTS reference_sequences (
      project_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      next_val INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (project_id, entity_type)
    );
  `);

  try { db.exec("ALTER TABLE projects ADD COLUMN code TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN location TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN description TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN progress INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN project_code TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN currency TEXT DEFAULT 'USD';"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN contract_value REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN contract_type TEXT DEFAULT 'Lump Sum';"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN stage TEXT DEFAULT 'Construction';"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN client_name TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN main_contractor TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN consultant TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN project_manager_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN project_manager_name TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN site_address TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN city TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN country TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN baseline_start_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN baseline_end_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN forecast_end_date TEXT;"); } catch {}

  try { db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'Medium';"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN description TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN assigned_worker_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN company_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN site_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN wbs_item_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN supervisor_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN baseline_start_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN baseline_end_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN forecast_start_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN forecast_end_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN actual_start_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN actual_end_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN drawing_ref TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN drawing_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN boq_ref TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN boq_item_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN procurement_item_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN evidence_required INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN evidence_type TEXT DEFAULT 'None';"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN evidence_url TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN evidence_notes TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN blocker_count INTEGER DEFAULT 0;"); } catch {}

  try { db.exec("ALTER TABLE work_packages ADD COLUMN site_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE work_packages ADD COLUMN wbs_item_id TEXT;"); } catch {}

  try { db.exec("ALTER TABLE dependencies ADD COLUMN predecessor_task_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dependencies ADD COLUMN predecessor_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dependencies ADD COLUMN successor_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dependencies ADD COLUMN dependency_type TEXT DEFAULT 'Finish-to-Start';"); } catch {}
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
  try { db.exec("ALTER TABLE users ADD COLUMN access_scope TEXT DEFAULT 'work_package';"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN allowed_work_package_ids TEXT;"); } catch {}
  try { db.exec("ALTER TABLE sessions ADD COLUMN expires_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE risks ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE task_blockers ADD COLUMN source_type TEXT;"); } catch {}
  try { db.exec("ALTER TABLE task_blockers ADD COLUMN source_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE task_blockers ADD COLUMN resolved INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE progress_reports ADD COLUMN report_no TEXT;"); } catch {}
  try { db.exec("ALTER TABLE progress_reports ADD COLUMN revision_no INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE progress_reports ADD COLUMN supersedes_report_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE progress_reports ADD COLUMN snapshot_schema_version INTEGER DEFAULT 1;"); } catch {}
  try { db.exec("ALTER TABLE progress_reports ADD COLUMN snapshot_data TEXT;"); } catch {}
  try { db.exec("ALTER TABLE progress_reports ADD COLUMN created_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN task_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN expected_delivery_date TEXT;"); } catch {}

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
  try { db.exec("ALTER TABLE rfis ADD COLUMN source_clarification_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE change_orders ADD COLUMN source_clarification_id TEXT;"); } catch {}

  // V1.2 Workforce: GPS + OT columns on attendance
  try { db.exec("ALTER TABLE attendance ADD COLUMN site_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN worker_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_in_lat REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_in_lng REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_in_accuracy REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_in_geofence_status TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_in_distance_m REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_out_lat REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_out_lng REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_out_accuracy REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_out_geofence_status TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_out_distance_m REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN supervisor_override INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN override_reason TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN shift_template_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN regular_hours REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN overtime_hours REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN ot_status TEXT DEFAULT 'Pending';"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN ot_approved_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN ot_approved_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN ot_reject_reason TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN company_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN supervisor_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN elapsed_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN regular_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN break_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN raw_overtime_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN approved_overtime_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN late_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN attendance_status TEXT;"); } catch {}
  try { db.exec("ALTER TABLE shift_templates ADD COLUMN working_days_json TEXT DEFAULT '[1,2,3,4,5]';"); } catch {}
  try { db.exec("ALTER TABLE payroll_entries ADD COLUMN elapsed_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE payroll_entries ADD COLUMN regular_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE payroll_entries ADD COLUMN break_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE payroll_entries ADD COLUMN raw_overtime_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE payroll_entries ADD COLUMN approved_overtime_minutes INTEGER DEFAULT 0;"); } catch {}

  db.exec("CREATE INDEX IF NOT EXISTS idx_worker_assignments_scope ON worker_assignments(worker_id, project_id, site_id, status, start_date, end_date);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_attendance_worker_date ON attendance(worker_id, work_date);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_attendance_project_site_date ON attendance(project_id, site_id, work_date);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_public_holidays_date ON public_holidays(project_id, site_id, holiday_date);");

  // V1.2 Workforce: site/assignment columns on tasks
  try { db.exec("ALTER TABLE tasks ADD COLUMN site_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN assigned_worker_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN assigned_supervisor_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN instruction_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'Medium';"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN completion_evidence_required INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN verified_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN verified_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN completion_percent REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN completion_notes TEXT;"); } catch {}

  // V1.2 Workforce: worker_id linkage on users
  try { db.exec("ALTER TABLE users ADD COLUMN worker_id TEXT;"); } catch {}

  // V1.4 Enterprise: Procurement -> Programme integration
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN task_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN expected_delivery_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN actual_delivery_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN lead_time_days INTEGER DEFAULT 0;"); } catch {}

  try { db.exec("ALTER TABLE material_requests ADD COLUMN task_id TEXT;"); } catch {}

  // V1.4 Enterprise: Risk management enhancements
  try { db.exec("ALTER TABLE risks ADD COLUMN risk_no TEXT;"); } catch {}
  try { db.exec("ALTER TABLE risks ADD COLUMN risk_level TEXT DEFAULT 'Medium';"); } catch {}
  try { db.exec("ALTER TABLE risks ADD COLUMN contingency_cost REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE risks ADD COLUMN linked_task_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE risks ADD COLUMN created_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE risks ADD COLUMN created_at TEXT;"); } catch {}

  // V1.4 Enterprise: Project actions & decisions indices
  db.exec("CREATE INDEX IF NOT EXISTS idx_project_actions_proj ON project_actions(project_id, status, due_date);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_project_decisions_proj ON project_decisions(project_id, status);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_risks_proj ON risks(project_id, status);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_po_task ON purchase_orders(task_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mr_task ON material_requests(task_id);");

  seedUsers();
  seedLeaveTypes();
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

function seedLeaveTypes() {
  // Bootstrap default leave types idempotently (unique constraint on name/code prevents duplicates)
  const defaults = [
    { name: "Annual Leave",   code: "AL",  is_paid: 1, days: 21, requires_approval: 1 },
    { name: "Sick Leave",     code: "SL",  is_paid: 1, days: 14, requires_approval: 0 },
    { name: "Unpaid Leave",   code: "UL",  is_paid: 0, days: 0,  requires_approval: 1 },
    { name: "Public Holiday", code: "PH",  is_paid: 1, days: 0,  requires_approval: 0 },
    { name: "Rest Day",       code: "RD",  is_paid: 1, days: 0,  requires_approval: 0 },
    { name: "Compassionate",  code: "CL",  is_paid: 1, days: 3,  requires_approval: 1 },
  ];
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO leave_types (id, name, code, is_paid, default_days_per_year, requires_approval, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  for (const lt of defaults) {
    stmt.run(crypto.randomUUID(), lt.name, lt.code, lt.is_paid, lt.days, lt.requires_approval, now);
  }
}

// Permissions & Scope Helpers
function canAccessProject(user: AuthenticatedUser, projectId?: string): boolean {
  if (!projectId) return false;
  if (user.role === "Admin") return true;

  // Active individual user membership is required
  const memberRow = db.prepare(
    "SELECT 1 FROM project_memberships WHERE user_id=? AND project_id=? AND active=1"
  ).get(user.user_id, projectId);
  if (!memberRow) return false;

  // If user belongs to a company, that company must be Active AND participate in the project
  if (user.company_id) {
    const comp = db.prepare("SELECT status FROM companies WHERE id=?").get(user.company_id) as any;
    if (!comp || comp.status === "Inactive") return false;

    const compRow = db.prepare(
      "SELECT 1 FROM project_companies WHERE project_id=? AND company_id=?"
    ).get(projectId, user.company_id);
    if (!compRow) return false;
  }
  return true;
}

const hasProjectAccess = canAccessProject;

function canAccessCompany(user: AuthenticatedUser, companyId?: string): boolean {
  if (!companyId) return true;
  if (user.role === "Admin") return true;
  if (user.role === "Client") return false;
  if (user.role === "Subcontractor") {
    return user.company_id === companyId;
  }
  return true;
}

function canAccessWorkPackage(user: AuthenticatedUser, workPackageId?: string, projectId?: string): boolean {
  if (!workPackageId) return true;
  if (user.role === "Admin") return true;
  if (projectId && !canAccessProject(user, projectId)) return false;

  if (user.role === "Subcontractor") {
    if (!user.work_package_id) return false;
    return user.work_package_id === workPackageId;
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

function canPerformAction(
  user: AuthenticatedUser,
  module: string,
  action: "view" | "create" | "edit" | "delete" | "approve" | "publish"
): boolean {
  if (user.role === "Admin") return true;
  const perms = ROLE_PERMS[user.role];
  if (!perms) return false;

  if (action === "view") return perms.view.includes(module);
  if (action === "create" || action === "edit") return perms.edit.includes(module);
  if (action === "delete") return Boolean(perms.delete);
  if (action === "approve") return user.role === "ProjectManager" || user.role === "CommercialManager";
  if (action === "publish") return user.role === "ProjectManager";
  return false;
}

function externalRecordDto(record: any, user: AuthenticatedUser, module: string): any {
  if (!record) return null;
  const dto = { ...record };
  delete dto.password_hash;

  if (user.role === "Client") {
    if (module === "documents" || module === "drawings") {
      delete dto.subcontractor_id;
      delete dto.subcontractor_username;
      delete dto.markup_data;
      delete dto.internal_notes;
    }
    if (module === "projects") {
      delete dto.budget;
      delete dto.contract_sum;
      delete dto.internal_margin;
      delete dto.target_cost;
    }
    if (module === "change_orders") {
      delete dto.internal_cost;
      delete dto.contractor_markup;
      delete dto.internal_notes;
    }
    if (module === "progress_reports") {
      delete dto.internal_comments;
      delete dto.contractor_notes;
    }
    if (module === "clarifications") {
      delete dto.internal_notes;
    }
  }

  if (user.role === "Subcontractor") {
    if (module === "projects") {
      delete dto.budget;
    }
    if (module === "change_orders") {
      delete dto.internal_contractor_budget;
    }
  }

  // Phase 3: Payroll compensation isolation - only Admin and CommercialManager see compensation
  if (user.role !== "Admin" && user.role !== "CommercialManager") {
    delete dto.basic_daily_rate;
    delete dto.basic_monthly_rate;
    delete dto.basic_pay;
    delete dto.overtime_pay;
    delete dto.housing_allowance;
    delete dto.transport_allowance;
    delete dto.food_allowance;
    delete dto.gross_pay;
    delete dto.net_pay;
    delete dto.deductions;
    delete dto.bank_account;
    delete dto.bank_name;
    delete dto.ot_multiplier;
  }

  return dto;
}

// Centralized record authorization helper enforcing project, company, work package, role, and visibility rules
function canAccessRecord(
  user: AuthenticatedUser,
  record: any,
  action: "view" | "edit" | "delete" | "create",
  module: string
): boolean {
  if (!record) return false;
  if (record.project_id && !canAccessProject(user, record.project_id)) return false;
  if (user.role === "Admin") return true;

  // Phase 3: Worker role scoping - can only view/edit records associated with themselves
  if (user.role === "Worker") {
    if (module === "workers") {
      return record.user_id === user.user_id || record.id === user.worker_id;
    }
    if (module === "attendance") {
      return record.user_id === user.user_id || record.worker_id === user.worker_id;
    }
    if (module === "site_instructions") {
      return record.assigned_worker_id === user.worker_id || record.assigned_worker_id === user.user_id;
    }
    if (module === "leave_requests") {
      return record.user_id === user.user_id || record.worker_id === user.worker_id;
    }
    if (module === "payroll_entries" || module === "payroll_profiles" || module === "payroll_periods") {
      return false;
    }
  }

  // Phase 3: SiteSupervisor role scoping
  if (user.role === "SiteSupervisor") {
    if (module === "workers") {
      return record.supervisor_id === user.user_id || record.supervisor_id === user.worker_id;
    }
    if (module === "payroll_entries" || module === "payroll_profiles" || module === "payroll_periods") {
      return false;
    }
  }

  // Phase 3: Payroll modules - strictly Admin & CommercialManager
  if (module === "payroll_profiles" || module === "payroll_entries" || module === "payroll_adjustments") {
    if (user.role !== "Admin" && user.role !== "CommercialManager") return false;
  }

  if (action === "view" && !canView(user, module)) return false;
  if ((action === "edit" || action === "create") && !canEdit(user, module)) {
    const isSpecialAllowed = (module === "documents" || module === "drawings" || module === "clarifications" || module === "progress_submissions") && user.role === "Subcontractor";
    if (!isSpecialAllowed) return false;
  }
  if (action === "delete" && !canDelete(user)) {
    const isOwnDoc = (module === "documents" || module === "drawings") && user.role === "Subcontractor" &&
      (record.subcontractor_id === user.user_id ||
       Boolean(db.prepare("SELECT 1 FROM record_owners WHERE module='documents' AND record_id=? AND user_id=?").get(record.id, user.user_id)));
    if (!isOwnDoc) return false;
  }

  // Client role rules
  if (user.role === "Client") {
    if (action !== "view") {
      if (action === "create" && (module === "documents" || module === "clarifications")) {
        return true;
      }
      return false;
    }
    if (module === "projects") {
      return canAccessProject(user, record.id || record.project_id);
    }
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


type WorkforceAction = "view" | "edit" | "update" | "assign" | "verify" | "close";

function getWorkerPrincipal(userId: string): any | null {
  return (db.prepare(
    "SELECT w.*, c.name AS company_name FROM workers w LEFT JOIN companies c ON c.id=w.company_id " +
    "WHERE w.user_id=? AND w.status='Active' ORDER BY w.created_at DESC LIMIT 1"
  ).get(userId) as any) || null;
}

function getActiveWorkerAssignment(
  workerId: string,
  projectId: string,
  siteId: string,
  workDate: string
): any | null {
  if (!workerId || !projectId || !siteId || !workDate) return null;
  return (db.prepare(
    "SELECT * FROM worker_assignments WHERE worker_id=? AND project_id=? AND site_id=? AND status='Active' " +
    "AND (start_date IS NULL OR start_date='' OR start_date<=?) " +
    "AND (end_date IS NULL OR end_date='' OR end_date>=?) " +
    "ORDER BY COALESCE(start_date,'') DESC, created_at DESC LIMIT 1"
  ).get(workerId, projectId, siteId, workDate, workDate) as any) || null;
}

function canAccessWorker(user: AuthenticatedUser, worker: any, action: "view" | "edit"): boolean {
  if (!worker) return false;
  if (worker.project_id && !canAccessProject(user, worker.project_id)) return false;
  if (user.role === "Admin") return true;
  if (action === "view" && !canView(user, "workers")) return false;
  if (action === "edit" && !canEdit(user, "workers")) return false;

  if (user.role === "Worker") return worker.user_id === user.user_id || worker.id === user.worker_id;

  if (user.role === "Subcontractor") {
    if (!user.company_id || worker.company_id !== user.company_id) return false;
    if (user.work_package_id && worker.work_package_id && worker.work_package_id !== user.work_package_id) return false;
    return true;
  }

  if (user.role === "SiteSupervisor") {
    if (worker.supervisor_id === user.user_id) return true;
    return Boolean(db.prepare(
      "SELECT 1 FROM worker_assignments WHERE worker_id=? AND supervisor_id=? AND status='Active' LIMIT 1"
    ).get(worker.id, user.user_id));
  }

  return canAccessProject(user, worker.project_id);
}

function canAccessSite(user: AuthenticatedUser, site: any, action: "view" | "edit"): boolean {
  if (!site || !site.project_id || !canAccessProject(user, site.project_id)) return false;
  if (user.role === "Admin") return true;
  if (site.status === "Inactive") return false;
  if (action === "edit") return user.role === "ProjectManager" && canEdit(user, "sites");
  return canView(user, "sites") || canView(user, "workforce") || canView(user, "attendance");
}

function canAccessAttendance(user: AuthenticatedUser, record: any, action: "view" | "edit"): boolean {
  if (!record || !canAccessProject(user, record.project_id)) return false;
  if (user.role === "Admin") return true;
  if (user.role === "Worker") return record.user_id === user.user_id || record.worker_id === user.worker_id;
  const worker = record.worker_id ? db.prepare("SELECT * FROM workers WHERE id=?").get(record.worker_id) as any : null;
  if (user.role === "Subcontractor") return Boolean(worker && user.company_id && worker.company_id === user.company_id);
  if (user.role === "SiteSupervisor") {
    return Boolean(record.worker_id && db.prepare(
      "SELECT 1 FROM worker_assignments WHERE worker_id=? AND project_id=? AND supervisor_id=? AND status='Active' LIMIT 1"
    ).get(record.worker_id, record.project_id, user.user_id));
  }
  if (action === "edit") return canEdit(user, "attendance");
  return canView(user, "attendance") || user.role === "ProjectManager";
}

function canAccessSiteInstruction(user: AuthenticatedUser, instruction: any, action: WorkforceAction): boolean {
  if (!instruction || !instruction.project_id || !canAccessProject(user, instruction.project_id)) return false;
  if (user.role === "Admin") return true;

  if (user.role === "Worker") {
    const worker = getWorkerPrincipal(user.user_id);
    return Boolean(worker && instruction.assigned_worker_id === worker.id && (action === "view" || action === "update"));
  }

  if (user.role === "Subcontractor") {
    let scopedCompanyId: string | null = null;
    if (instruction.work_package_id) {
      const wp = db.prepare("SELECT company_id FROM work_packages WHERE id=? AND project_id=?").get(
        instruction.work_package_id, instruction.project_id
      ) as any;
      scopedCompanyId = wp?.company_id || null;
    }
    if (!scopedCompanyId && instruction.assigned_worker_id) {
      const worker = db.prepare("SELECT company_id FROM workers WHERE id=?").get(instruction.assigned_worker_id) as any;
      scopedCompanyId = worker?.company_id || null;
    }
    if (!user.company_id || scopedCompanyId !== user.company_id) return false;
    if (user.work_package_id && instruction.work_package_id && user.work_package_id !== instruction.work_package_id) return false;
    return action === "view" || action === "update";
  }

  if (user.role === "SiteSupervisor") {
    const directlyAssigned = instruction.assigned_supervisor_id === user.user_id;
    const supervisesWorker = Boolean(instruction.assigned_worker_id && db.prepare(
      "SELECT 1 FROM worker_assignments WHERE worker_id=? AND project_id=? AND supervisor_id=? AND status='Active' LIMIT 1"
    ).get(instruction.assigned_worker_id, instruction.project_id, user.user_id));
    const supervisesSite = Boolean(instruction.site_id && db.prepare(
      "SELECT 1 FROM worker_assignments WHERE project_id=? AND site_id=? AND supervisor_id=? AND status='Active' LIMIT 1"
    ).get(instruction.project_id, instruction.site_id, user.user_id));
    if (!directlyAssigned && !supervisesWorker && !supervisesSite) return false;
    return ["view", "update", "assign", "verify"].includes(action);
  }

  if (user.role === "ProjectManager") return true;
  if (action === "view") return canView(user, "site_instructions");
  return false;
}

function canAccessPayroll(user: AuthenticatedUser): boolean {
  return user.role === "Admin" || user.role === "CommercialManager";
}

function safeTimeZone(value: any): string {
  const candidate = String(value || "UTC");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

function zonedParts(date: Date, timeZone: string): { date: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value])) as Record<string,string>;
  return {
    date: parts.year + "-" + parts.month + "-" + parts.day,
    hour: parseInt(parts.hour || "0", 10),
    minute: parseInt(parts.minute || "0", 10),
  };
}

function addIsoDays(dateString: string, days: number): string {
  const d = new Date(dateString + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayNumber(dateString: string): number {
  return new Date(dateString + "T12:00:00Z").getUTCDay();
}

function parseWorkingDays(value: any): number[] {
  try {
    const parsed = JSON.parse(String(value || "[1,2,3,4,5]"));
    if (Array.isArray(parsed)) {
      const days = parsed.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
      if (days.length) return [...new Set(days)];
    }
  } catch {}
  return [1,2,3,4,5];
}

function getWorkerShift(workerId: string, workDate: string): any | null {
  return (db.prepare(
    "SELECT st.* FROM worker_schedules ws JOIN shift_templates st ON st.id=ws.shift_template_id " +
    "WHERE ws.worker_id=? AND st.status='Active' AND ws.effective_from<=? " +
    "AND (ws.effective_to IS NULL OR ws.effective_to='' OR ws.effective_to>=?) " +
    "ORDER BY ws.effective_from DESC LIMIT 1"
  ).get(workerId, workDate, workDate) as any) || null;
}

function resolveWorkDateForPunch(workerId: string, site: any, now: Date): { workDate: string; shift: any | null } {
  const local = zonedParts(now, site?.timezone || "UTC");
  let workDate = local.date;
  let shift = getWorkerShift(workerId, workDate);
  if (shift && String(shift.start_time || "") > String(shift.end_time || "")) {
    const endParts = String(shift.end_time || "00:00").split(":").map(Number);
    const localMinutes = local.hour * 60 + local.minute;
    const endMinutes = (endParts[0] || 0) * 60 + (endParts[1] || 0);
    if (localMinutes < endMinutes) {
      workDate = addIsoDays(workDate, -1);
      shift = getWorkerShift(workerId, workDate) || shift;
    }
  }
  return { workDate, shift };
}

function isPublicHoliday(projectId: string, siteId: string | null, workDate: string): any | null {
  return (db.prepare(
    "SELECT * FROM public_holidays WHERE holiday_date=? " +
    "AND (project_id IS NULL OR project_id=?) AND (site_id IS NULL OR site_id=?) " +
    "ORDER BY CASE WHEN site_id IS NULL THEN 1 ELSE 0 END, CASE WHEN project_id IS NULL THEN 1 ELSE 0 END LIMIT 1"
  ).get(workDate, projectId, siteId) as any) || null;
}

function scheduledWorkingDay(workerId: string, workDate: string): boolean {
  const shift = getWorkerShift(workerId, workDate);
  const workingDays = parseWorkingDays(shift?.working_days_json);
  return workingDays.includes(weekdayNumber(workDate));
}

function attendanceStatusForRecord(record: any): string {
  const geofenceException = ["Outside Geofence", "GPS Accuracy Poor"].includes(record.punch_in_geofence_status)
    || ["Outside Geofence", "GPS Accuracy Poor"].includes(record.punch_out_geofence_status);
  if (geofenceException) return "Attendance Exception";
  if (!record.punch_out) {
    const site = record.site_id ? db.prepare("SELECT timezone FROM sites WHERE id=?").get(record.site_id) as any : null;
    const today = zonedParts(new Date(), site?.timezone || "UTC").date;
    if (record.work_date < today) return "Missing Punch";
    if ((record.late_minutes || 0) > 0) return "Late";
    return "Present";
  }
  if ((record.late_minutes || 0) > 0) return "Late";
  return "Present";
}

function recalculateAttendanceRecord(attendanceId: string): any | null {
  const record = db.prepare("SELECT * FROM attendance WHERE id=?").get(attendanceId) as any;
  if (!record) return null;

  const shift = record.shift_template_id
    ? db.prepare("SELECT * FROM shift_templates WHERE id=?").get(record.shift_template_id) as any
    : null;
  let elapsedMinutes = 0;
  let breakMinutes = 0;
  let regularMinutes = 0;
  let rawOtMinutes = 0;
  let approvedOtMinutes = 0;
  let lateMinutes = 0;

  if (record.punch_in && record.punch_out) {
    elapsedMinutes = Math.max(0, Math.round((new Date(record.punch_out).getTime() - new Date(record.punch_in).getTime()) / 60000));
    breakMinutes = Math.min(elapsedMinutes, Math.max(0, Number(shift?.break_minutes || 0)));
    const workedMinutes = Math.max(0, elapsedMinutes - breakMinutes);
    const thresholdMinutes = Math.max(0, Math.round(Number(shift?.ot_threshold_hours ?? shift?.regular_hours ?? 8) * 60));
    regularMinutes = Math.min(workedMinutes, thresholdMinutes || workedMinutes);
    rawOtMinutes = Math.max(0, workedMinutes - regularMinutes);
    approvedOtMinutes = record.ot_status === "Approved" ? rawOtMinutes : 0;
  }

  if (shift && record.punch_in) {
    const site = record.site_id ? db.prepare("SELECT timezone FROM sites WHERE id=?").get(record.site_id) as any : null;
    const localPunch = zonedParts(new Date(record.punch_in), site?.timezone || "UTC");
    const start = String(shift.start_time || "00:00").split(":").map(Number);
    let punchMinute = localPunch.hour * 60 + localPunch.minute;
    if (localPunch.date > record.work_date && String(shift.start_time || "") > String(shift.end_time || "")) punchMinute += 1440;
    const scheduledMinute = (start[0] || 0) * 60 + (start[1] || 0);
    const grace = Math.max(0, Number(shift.grace_minutes || 0));
    lateMinutes = Math.max(0, punchMinute - scheduledMinute - grace);
  }

  const compatibilityRegularHours = Math.round((regularMinutes / 60) * 100) / 100;
  const compatibilityOvertimeHours = Math.round((rawOtMinutes / 60) * 100) / 100;
  const next = { ...record, late_minutes: lateMinutes };
  const attendanceStatus = attendanceStatusForRecord(next);

  db.prepare(
    "UPDATE attendance SET elapsed_minutes=?,regular_minutes=?,break_minutes=?,raw_overtime_minutes=?," +
    "approved_overtime_minutes=?,late_minutes=?,attendance_status=?,regular_hours=?,overtime_hours=? WHERE id=?"
  ).run(
    elapsedMinutes, regularMinutes, breakMinutes, rawOtMinutes, approvedOtMinutes, lateMinutes,
    attendanceStatus, compatibilityRegularHours, compatibilityOvertimeHours, attendanceId
  );
  return db.prepare("SELECT * FROM attendance WHERE id=?").get(attendanceId) as any;
}

function calculateDailyAttendanceStatus(workerId: string, projectId: string, siteId: string | null, workDate: string): string {
  const leave = db.prepare(
    "SELECT lr.*, lt.code, lt.name, lt.is_paid FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id " +
    "WHERE lr.worker_id=? AND lr.project_id=? AND lr.status='Approved' AND lr.start_date<=? AND lr.end_date>=? LIMIT 1"
  ).get(workerId, projectId, workDate, workDate) as any;
  if (leave) {
    const code = String(leave.code || "").toUpperCase();
    const name = String(leave.name || "").toLowerCase();
    if (code === "SL" || name.includes("sick")) return "Sick Leave";
    if (!leave.is_paid || code === "UL" || name.includes("unpaid")) return "Unpaid Leave";
    if (code === "AL" || name.includes("annual")) return "Annual Leave";
    return "Leave";
  }

  if (isPublicHoliday(projectId, siteId, workDate)) return "Public Holiday";
  if (!scheduledWorkingDay(workerId, workDate)) return "Rest Day";

  const attendance = db.prepare(
    "SELECT * FROM attendance WHERE worker_id=? AND project_id=? AND work_date=? ORDER BY punch_in DESC LIMIT 1"
  ).get(workerId, projectId, workDate) as any;
  if (attendance) return attendance.attendance_status || attendanceStatusForRecord(attendance);
  return "Absent";
}

function chargeableLeaveDays(workerId: string, projectId: string, startDate: string, endDate: string): number {
  if (!workerId || !startDate || !endDate || endDate < startDate) return 0;
  let days = 0;
  let cursor = startDate;
  let guard = 0;
  while (cursor <= endDate && guard < 370) {
    const assignment = db.prepare(
      "SELECT * FROM worker_assignments WHERE worker_id=? AND project_id=? AND status='Active' " +
      "AND (start_date IS NULL OR start_date='' OR start_date<=?) AND (end_date IS NULL OR end_date='' OR end_date>=?) " +
      "ORDER BY created_at DESC LIMIT 1"
    ).get(workerId, projectId, cursor, cursor) as any;
    const siteId = assignment?.site_id || null;
    if (scheduledWorkingDay(workerId, cursor) && !isPublicHoliday(projectId, siteId, cursor)) days++;
    cursor = addIsoDays(cursor, 1);
    guard++;
  }
  return days;
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

// Authentication Helper & Middleware
function getCurrentUser(req: Request): AuthenticatedUser | null {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const session = db.prepare("SELECT * FROM sessions WHERE token=?").get(token) as any;
  if (!session) return null;

  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token=?").run(token);
    return null;
  }
  // Re-fetch current live user and verify active status on every request (P1 session revocation)
  const userRow = db.prepare("SELECT id, username, name, role, status, email, phone, company_id, company, trade, work_package_id, worker_id, access_scope, allowed_work_package_ids FROM users WHERE id=?").get(session.user_id) as any;
  if (!userRow || userRow.status !== "Active") {
    db.prepare("DELETE FROM sessions WHERE token=?").run(token);
    return null;
  }
  if (userRow.company_id) {
    const comp = db.prepare("SELECT status FROM companies WHERE id=?").get(userRow.company_id) as any;
    if (comp && comp.status === "Inactive") {
      db.prepare("DELETE FROM sessions WHERE token=?").run(token);
      return null;
    }
  }
  return {
    user_id: userRow.id,
    name: userRow.name,
    role: userRow.role,
    email: userRow.email || undefined,
    company_id: userRow.company_id || undefined,
    company: userRow.company || undefined,
    trade: userRow.trade || undefined,
    work_package_id: userRow.work_package_id || undefined,
    worker_id: userRow.worker_id || undefined,
    access_scope: userRow.access_scope || 'work_package',
    allowed_work_package_ids: userRow.allowed_work_package_ids || undefined,
  };
}

function authRequired(req: Request, res: Response, next: NextFunction): void {
  const user = getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.user = user;
  next();
}

async function startServer() {
  initDb();

  // Haversine formula: returns distance in metres between two lat/lng points
  function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000; // Earth radius in metres
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // Compute geofence status given distance and site config
  function geofenceStatus(distanceM: number, site: any, accuracyM?: number): string {
    if (accuracyM && accuracyM > 50) return 'GPS Accuracy Poor';
    if (distanceM <= site.geofence_radius_m) return 'Valid';
    if (distanceM <= site.geofence_warning_radius_m) return 'Warning';
    return 'Outside Geofence';
  }

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

  // Health & Readiness Observability
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "mep-project-manager",
      version: "1.4.1",
      git_sha: "c539a9d",
      uptime: process.uptime()
    });
  });

  app.get("/api/ready", (_req, res) => {
    try {
      const ping = db.prepare("SELECT 1 as ok").get() as any;
      const migrations = db.prepare("SELECT COUNT(*) as count FROM _migrations").get() as any;
      res.json({
        ready: true,
        db: ping && ping.ok === 1 ? "connected" : "error",
        migrations_applied: migrations ? migrations.count : 0,
        version: "1.4.1",
        timestamp: new Date().toISOString()
      });
    } catch (e: any) {
      res.status(503).json({ ready: false, error: e?.message || "Database not ready" });
    }
  });

  // Auth Endpoints
  app.post(["/api/login", "/api/auth/login"], (req, res) => {
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

  // Cache for Google's public certificates for Firebase ID Token verification
  let googleCertsCache: { [kid: string]: string } = {};
  let googleCertsExpiresAt = 0;

  async function getGooglePublicKeys(): Promise<{ [kid: string]: string }> {
    if (Date.now() < googleCertsExpiresAt && Object.keys(googleCertsCache).length > 0) {
      return googleCertsCache;
    }
    try {
      const res = await fetch("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com", {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const cacheControl = res.headers.get("cache-control") || "";
        const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
        const maxAgeSec = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
        googleCertsCache = await res.json();
        googleCertsExpiresAt = Date.now() + maxAgeSec * 1000;
        return googleCertsCache;
      }
    } catch {
      // Offline fallback
    }
    return googleCertsCache;
  }

  async function verifyFirebaseIdToken(token: string): Promise<{ uid: string; email?: string }> {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Malformed Firebase ID token: must contain 3 segments");
    }

    let header: any;
    let payload: any;
    try {
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf-8"));
      payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    } catch {
      throw new Error("Invalid ID token format or payload");
    }

    if (header.alg !== "RS256") {
      throw new Error("Invalid Firebase ID token algorithm: must be RS256");
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < nowSec) {
      throw new Error("Firebase ID token has expired");
    }

    if (!payload.sub && !payload.user_id) {
      throw new Error("Invalid Firebase ID token claims: missing subject");
    }

    // Cryptographic signature verification
    const signedData = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
    let sigBuffer: Buffer;
    try {
      sigBuffer = Buffer.from(parts[2], "base64url");
      if (sigBuffer.length === 0) {
        throw new Error("Empty signature");
      }
    } catch {
      throw new Error("Invalid signature encoding");
    }

    let signatureValid = false;

    // Check test public key if present (for deterministic test environments)
    if (process.env.FIREBASE_TEST_PUBLIC_KEY) {
      try {
        const verify = crypto.createVerify("RSA-SHA256");
        verify.update(signedData);
        if (verify.verify(process.env.FIREBASE_TEST_PUBLIC_KEY, sigBuffer)) {
          signatureValid = true;
        }
      } catch {}
    }

    // Check Google's official public certificates
    if (!signatureValid) {
      const certs = await getGooglePublicKeys();
      const cert = header.kid ? certs[header.kid] : null;
      if (cert) {
        try {
          const verify = crypto.createVerify("RSA-SHA256");
          verify.update(signedData);
          if (verify.verify(cert, sigBuffer)) {
            signatureValid = true;
          }
        } catch {}
      }
    }

    if (!signatureValid) {
      throw new Error("Cryptographic signature verification failed: invalid token signature");
    }

    return {
      uid: payload.sub || payload.user_id,
      email: payload.email || undefined,
    };
  }

  // Firebase Google Auth SSO Endpoint (Hardened: P0 fix - requires valid ID token & pre-approved user)
  app.post("/api/firebase-auth-login", async (req, res) => {
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

      let verifiedIdentity: { uid: string; email?: string };
      try {
        verifiedIdentity = await verifyFirebaseIdToken(tokenToVerify);
      } catch (err: any) {
        res.status(401).json({ error: err.message || "Cryptographic verification failed" });
        return;
      }

      // Match against pre-approved active application user - NEVER auto-create with all-project SiteEngineer!
      let user = db.prepare("SELECT * FROM users WHERE (username=? OR (email IS NOT NULL AND email=?)) AND status='Active'").get(verifiedIdentity.uid, verifiedIdentity.email || "") as any;
      if (!user && verifiedIdentity.email) {
        user = db.prepare("SELECT * FROM users WHERE email=? AND status='Active'").get(verifiedIdentity.email) as any;
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
        email: user.email || verifiedIdentity.email || "",
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
    const { username, name, password, role, email, phone, company_id, company, trade, work_package_id, status, project_ids, project_id, access_scope, allowed_work_package_ids } = req.body || {};
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
    const scope = access_scope || (assignedRole === 'Subcontractor' ? 'work_package' : null);
    const allowedWpIds = allowed_work_package_ids ? (Array.isArray(allowed_work_package_ids) ? JSON.stringify(allowed_work_package_ids) : String(allowed_work_package_ids)) : null;

    try {
      db.prepare(`
        INSERT INTO users (id, username, name, password_hash, role, email, phone, company_id, company, trade, work_package_id, status, access_scope, allowed_work_package_ids, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, username.trim(), (name || username).trim(), hashPassword(password), assignedRole,
        email ? String(email).trim() : null,
        phone ? String(phone).trim() : null,
        company_id ? String(company_id).trim() : null,
        company ? String(company).trim() : null,
        trade ? String(trade).trim() : "General MEP",
        work_package_id ? String(work_package_id).trim() : null,
        userStatus,
        scope,
        allowedWpIds,
        now
      );

      // Project assignments
      const allProjectIds = new Set<string>();
      if (Array.isArray(project_ids)) {
        project_ids.forEach(p => p && allProjectIds.add(p));
      }
      if (project_id) {
        allProjectIds.add(project_id);
      }

      if (assignedRole === "Admin" || (Array.isArray(project_ids) && project_ids.includes("ALL"))) {
        const projects = db.prepare("SELECT id FROM projects").all() as { id: string }[];
        const insertMem = db.prepare("INSERT OR IGNORE INTO project_memberships VALUES (?, ?, ?, 1)");
        for (const p of projects) {
          insertMem.run(id, p.id, assignedRole === "Admin" ? "Executive" : assignedRole);
        }
      } else if (allProjectIds.size > 0) {
        const insertMem = db.prepare("INSERT OR IGNORE INTO project_memberships VALUES (?, ?, ?, 1)");
        for (const pid of allProjectIds) {
          insertMem.run(id, pid, assignedRole);
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
    const mapped = rows.map(r => externalRecordDto(rowToDict(r), req.user!, "projects"));
    res.json(mapped);
  });

  app.get("/api/projects/:id", authRequired, (req, res) => {
    if (!hasProjectAccess(req.user!, req.params.id)) {
      res.status(403).json({ error: "Forbidden: no access to this project" });
      return;
    }
    const project = db.prepare("SELECT * FROM projects WHERE id=?").get(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    res.json(externalRecordDto(rowToDict(project), req.user!, "projects"));
  });

  app.post("/api/projects", authRequired, (req, res) => {
    if (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager") {
      res.status(403).json({ error: "Admin or Project Manager access required to create project" });
      return;
    }
    const data = req.body || {};
    const id = crypto.randomUUID();
    const projectCode = data.project_code || data.code || `PRJ-${Math.floor(100 + Math.random() * 900)}`;
    const clientName = data.client_name || data.client || "";
    const contractVal = data.contract_value !== undefined ? parseImportNumber(data.contract_value) : parseImportNumber(data.budget);

    const cols = [
      "id", "name", "client", "status", "start_date", "end_date", "budget", "code", "location", "description", "progress",
      "project_code", "currency", "contract_value", "contract_type", "stage", "client_name", "main_contractor",
      "consultant", "project_manager_id", "project_manager_name", "site_address", "city", "country",
      "baseline_start_date", "baseline_end_date", "forecast_end_date"
    ];
    const values = [
      id,
      data.name || "Untitled Project",
      clientName,
      data.status || "Active",
      data.start_date || "",
      data.end_date || "",
      contractVal,
      projectCode,
      data.location || null,
      data.description || null,
      data.progress ? parseInt(data.progress, 10) : 0,
      projectCode,
      data.currency || "USD",
      contractVal,
      data.contract_type || "Lump Sum",
      data.stage || "Construction",
      clientName,
      data.main_contractor || null,
      data.consultant || null,
      data.project_manager_id || req.user!.user_id,
      data.project_manager_name || req.user!.name,
      data.site_address || null,
      data.city || null,
      data.country || null,
      data.baseline_start_date || data.start_date || null,
      data.baseline_end_date || data.end_date || null,
      data.forecast_end_date || data.end_date || null
    ];
    db.prepare(`INSERT INTO projects (${cols.join(",")}) VALUES (${cols.map(() => '?').join(',')})`).run(...values);
    db.prepare(`
      INSERT OR IGNORE INTO project_memberships (user_id, project_id, access_role)
      VALUES (?, ?, 'Project Manager')
    `).run(req.user!.user_id, id);
    writeAudit(req.user!.user_id, "projects", id, id, "create", null, data);
    const created = db.prepare("SELECT * FROM projects WHERE id=?").get(id);
    res.status(201).json(rowToDict(created));
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
    const cols = [
      "name", "client", "status", "start_date", "end_date", "budget", "code", "location", "description", "progress",
      "project_code", "currency", "contract_value", "contract_type", "stage", "client_name", "main_contractor",
      "consultant", "project_manager_id", "project_manager_name", "site_address", "city", "country",
      "baseline_start_date", "baseline_end_date", "forecast_end_date"
    ];
    const updates: string[] = [];
    const vals: any[] = [];
    for (const c of cols) {
      if (c in data) {
        updates.push(`${c}=?`);
        if (c === "budget" || c === "contract_value") {
          vals.push(parseImportNumber(data[c]));
        } else if (c === "progress") {
          vals.push(parseInt(data[c], 10));
        } else {
          vals.push(data[c]);
        }
      }
    }
    // Cross-sync code and project_code
    if (("project_code" in data) && !("code" in data)) {
      updates.push("code=?");
      vals.push(data.project_code);
    } else if (("code" in data) && !("project_code" in data)) {
      updates.push("project_code=?");
      vals.push(data.code);
    }
    // Cross-sync client and client_name
    if (("client_name" in data) && !("client" in data)) {
      updates.push("client=?");
      vals.push(data.client_name);
    } else if (("client" in data) && !("client_name" in data)) {
      updates.push("client_name=?");
      vals.push(data.client);
    }
    // Cross-sync budget and contract_value
    if (("contract_value" in data) && !("budget" in data)) {
      updates.push("budget=?");
      vals.push(parseImportNumber(data.contract_value));
    } else if (("budget" in data) && !("contract_value" in data)) {
      updates.push("contract_value=?");
      vals.push(parseImportNumber(data.budget));
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
    const scoped = projectScopeSql(req.user!, projectId, "a.project_id");
    if (!scoped.where) {
      res.status(403).json({ error: "No access to this project" });
      return;
    }
    let where = scoped.where;
    const params: any[] = [...scoped.params];

    if (req.user!.role === "Worker") {
      where += " AND a.user_id=?";
      params.push(req.user!.user_id);
    } else if (req.user!.role === "Subcontractor") {
      if (!req.user!.company_id) { res.json([]); return; }
      where += " AND w.company_id=?";
      params.push(req.user!.company_id);
    } else if (req.user!.role === "SiteSupervisor") {
      where += " AND EXISTS (SELECT 1 FROM worker_assignments wa WHERE wa.worker_id=a.worker_id AND wa.project_id=a.project_id AND wa.supervisor_id=? AND wa.status='Active')";
      params.push(req.user!.user_id);
    }

    const rows = db.prepare(
      "SELECT a.*, w.company_id as worker_company_id, w.trade as worker_trade FROM attendance a " +
      "LEFT JOIN workers w ON w.id=a.worker_id WHERE " + where + " ORDER BY a.punch_in DESC"
    ).all(...params) as any[];
    const now = new Date();
    const result = rows
      .filter(row => canAccessAttendance(req.user!, row, "view"))
      .map(row => {
        const record = { ...row };
        const start = new Date(row.punch_in);
        const end = row.punch_out ? new Date(row.punch_out) : now;
        record.hours = Math.round((Math.max(0, end.getTime() - start.getTime()) / 3600000) * 100) / 100;
        return record;
      });
    res.json(result);
  });

  app.post("/api/attendance/punch-in", authRequired, (req, res) => {
    if (req.user!.role === "Worker") {
      res.status(410).json({ error: "Workers must use /api/attendance/gps-punch-in with an assigned site and GPS location" });
      return;
    }
    let projectId = req.body?.project_id;
    if (!projectId) {
      const defaultProj = db.prepare("SELECT project_id FROM project_memberships WHERE user_id=? AND active=1 LIMIT 1").get(req.user!.user_id) as any;
      if (defaultProj) projectId = defaultProj.project_id;
    }
    if (!projectId || !hasProjectAccess(req.user!, projectId)) {
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
    const notes = req.body?.shift_notes || req.body?.notes || "";
    db.prepare("INSERT INTO attendance (id, project_id, user_id, worker, work_date, punch_in, punch_out, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, 'Open', ?)").run(
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
    if (table === "projects" && (req.user!.role === "Client" || req.user!.role === "Subcontractor")) {
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
    db.prepare(`
      INSERT INTO purchase_orders (id, project_id, po_number, vendor, trade, description, amount, order_date, expected_delivery, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
      controls_complete: row.controls_complete || row.controls_online,
      interface_complete: row.interface_complete || row.interface_ready,
      drawings_approved: row.drawings_approved,
    };
    const missing = Object.keys(prerequisites).filter(k => !prerequisites[k]);
    const isReady = missing.length === 0;
    res.json({ ready: isReady, is_ready: isReady, missing, prerequisites });
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
    const newStatus = req.body?.status || req.body?.stage;
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
    res.status(200).json({
      document_id: docId,
      filename,
      imported,
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

  // Contractor Document Intelligence & Multi-Portal Auto-Update:
  // Parses uploaded contractor document (PDF, Word, TXT, CSV), auto-populates
  // Project Master, Company Directory, Work Packages, Schedule Tasks, and Document Store,
  // and executes an automated multi-portal verification check.
  const handleContractorDocUpload = async (req: Request, res: Response) => {
    try {
      if (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager" && req.user!.role !== "CommercialManager") {
        res.status(403).json({ error: "Only Admin, Project Manager, or Commercial Manager can process contractor documents" });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "No contractor document file was uploaded. Supported: PDF, DOCX, CSV, TXT" });
        return;
      }

      const targetProjectId = req.params.id || req.body?.project_id || undefined;
      if (targetProjectId && !hasProjectAccess(req.user!, targetProjectId)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }

      // Convert buffer to data-url for extractDocumentText
      const mimeType = file.mimetype || "application/octet-stream";
      const base64 = file.buffer.toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64}`;

      const textExtraction = await extractDocumentText(dataUrl, file.originalname);
      let rawText = "";
      if (textExtraction.kind === "text") {
        rawText = textExtraction.text;
      } else {
        rawText = file.buffer.toString("utf-8");
      }

      // Extract intelligence from document text
      let extracted = extractContractorDocumentIntelligence(rawText, file.originalname);

      // Optional AI enhancement if Gemini is configured
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey && rawText.length > 50) {
        try {
          const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { "User-Agent": "aistudio-build" } } });
          const prompt = [
            "You are an expert MEP construction manager analyzing a contractor agreement / submittal.",
            "Extract the following metadata accurately from the text below. Return ONLY valid JSON.",
            "Fields: projectName (string), client (string), mainContractor (string), subcontractor (string), consultant (string),",
            "budget (number), currency (string, e.g. USD, AED, EUR, GBP), startDate (YYYY-MM-DD), endDate (YYYY-MM-DD),",
            "location (string), contractType (string), trades (array of strings, e.g. HVAC, Electrical, Plumbing, Fire Fighting, ELV),",
            "milestones (array of {title: string, trade: string, priority: string}).",
            "",
            "--- DOCUMENT EXCERPT ---",
            rawText.slice(0, 25000)
          ].join("\n");

          let aiRes: any;
          try {
            aiRes = await ai.models.generateContent({ model: "gemini-3.8-flash", contents: prompt });
          } catch {
            aiRes = await ai.models.generateContent({ model: "gemini-3.6-flash", contents: prompt });
          }
          const rawJson = String(aiRes.text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
          const parsed = JSON.parse(rawJson);
          if (parsed.projectName) extracted.projectName = parsed.projectName;
          if (parsed.client) extracted.client = parsed.client;
          if (parsed.mainContractor) extracted.mainContractor = parsed.mainContractor;
          if (parsed.subcontractor) extracted.subcontractor = parsed.subcontractor;
          if (parsed.consultant) extracted.consultant = parsed.consultant;
          if (typeof parsed.budget === "number" && parsed.budget > 0) extracted.budget = parsed.budget;
          if (parsed.currency) extracted.currency = parsed.currency;
          if (parsed.startDate) extracted.startDate = normalizeDate(parsed.startDate) || extracted.startDate;
          if (parsed.endDate) extracted.endDate = normalizeDate(parsed.endDate) || extracted.endDate;
          if (parsed.location) extracted.location = parsed.location;
          if (Array.isArray(parsed.trades) && parsed.trades.length) extracted.trades = parsed.trades;
          if (Array.isArray(parsed.milestones) && parsed.milestones.length) extracted.milestones = parsed.milestones;
        } catch (e: any) {
          console.warn("AI contractor document extraction fallback to rule-engine:", e?.message);
        }
      }

      // Apply to database across all modules and verify automatically
      const result = applyContractorIntelligenceAndVerify(
        db,
        extracted,
        { name: file.originalname, buffer: file.buffer, mimeType: file.mimetype },
        targetProjectId,
        req.user!.user_id
      );

      res.status(201).json({
        success: true,
        project_id: result.projectId,
        project: result.project,
        report: result.report,
        work_packages: result.workPackages,
        tasks: result.tasks,
        extracted
      });
    } catch (err: any) {
      console.error("Contractor document processing failed:", err);
      res.status(500).json({ error: err.message || "Failed to process contractor document" });
    }
  };

  app.post("/api/projects/upload-contractor-doc", authRequired, upload.single("file"), handleContractorDocUpload);
  app.post("/api/projects/:id/upload-contractor-doc", authRequired, upload.single("file"), handleContractorDocUpload);

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
        INSERT INTO work_packages (id, project_id, name, code, discipline, description, company_id, lead_contact, budget_allocated, status, start_date, target_date, created_at, site_id, wbs_item_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        now,
        data.site_id || null,
        data.wbs_item_id || null
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
        SET name=?, code=?, discipline=?, description=?, company_id=?, lead_contact=?, budget_allocated=?, status=?, start_date=?, target_date=?, site_id=?, wbs_item_id=?
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
        data.site_id !== undefined ? data.site_id : existing.site_id,
        data.wbs_item_id !== undefined ? data.wbs_item_id : existing.wbs_item_id,
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

  // --- V1.4.1 EXTRACTED DOMAIN ROUTES ---
  registerWorkPackageRoutes(app, db, authRequired, hasProjectAccess, rowToDict);
  registerProcurementRoutes(app, db, authRequired, hasProjectAccess);
  registerRiskRoutes(app, db, authRequired, hasProjectAccess);
  registerTaskRoutes(app, db, authRequired, hasProjectAccess);

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

  // Convert Clarification to RFI (Section 16)
  app.post("/api/clarifications/:id/convert-to-rfi", authRequired, (req, res) => {
    try {
      const { id } = req.params;
      const clarification = db.prepare("SELECT * FROM clarifications WHERE id=?").get(id) as any;
      if (!clarification) {
        res.status(404).json({ error: "Clarification not found" });
        return;
      }
      if (!canAccessRecord(req.user!, clarification, "edit", "clarifications")) {
        res.status(403).json({ error: "No permission to convert this clarification" });
        return;
      }
      if (!canEdit(req.user!, "rfis")) {
        res.status(403).json({ error: "No permission to create RFIs" });
        return;
      }

      const existingRfis = db.prepare("SELECT count(*) as count FROM rfis WHERE project_id=?").get(clarification.project_id) as any;
      const rfiNum = `RFI-${String((existingRfis?.count || 0) + 1).padStart(3, "0")}`;
      const rfiId = crypto.randomUUID();
      const today = new Date().toISOString().slice(0, 10);
      const dueDate = clarification.due_date || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

      db.prepare(`
        INSERT INTO rfis (id, project_id, number, subject, trade, raised_by, date_raised, due_date, status, source_clarification_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rfiId,
        clarification.project_id,
        rfiNum,
        clarification.title + ": " + clarification.question_text,
        clarification.discipline || "General",
        req.user!.name,
        today,
        dueDate,
        "Open",
        clarification.id
      );

      db.prepare("UPDATE clarifications SET status='Converted to RFI' WHERE id=?").run(id);

      const createdRfi = db.prepare("SELECT * FROM rfis WHERE id=?").get(rfiId);
      res.status(201).json({
        message: "Clarification converted to RFI successfully",
        rfi: createdRfi,
        clarification_id: clarification.id
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Convert Clarification to Potential Variation (Section 16)
  app.post("/api/clarifications/:id/convert-to-variation", authRequired, (req, res) => {
    try {
      const { id } = req.params;
      const clarification = db.prepare("SELECT * FROM clarifications WHERE id=?").get(id) as any;
      if (!clarification) {
        res.status(404).json({ error: "Clarification not found" });
        return;
      }
      if (!canAccessRecord(req.user!, clarification, "edit", "clarifications")) {
        res.status(403).json({ error: "No permission to convert this clarification" });
        return;
      }
      if (!canEdit(req.user!, "change_orders")) {
        res.status(403).json({ error: "No permission to create Change Orders / Variations" });
        return;
      }

      const existingCos = db.prepare("SELECT count(*) as count FROM change_orders WHERE project_id=?").get(clarification.project_id) as any;
      const coNum = `VO-${String((existingCos?.count || 0) + 1).padStart(3, "0")}`;
      const coId = crypto.randomUUID();
      const today = new Date().toISOString().slice(0, 10);

      db.prepare(`
        INSERT INTO change_orders (id, project_id, number, title, trade, reason, cost_impact, schedule_impact_days, date_raised, status, source_clarification_id, visibility)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        coId,
        clarification.project_id,
        coNum,
        clarification.title,
        clarification.discipline || "General",
        clarification.question_text + (clarification.proposed_solution ? `\nProposed Solution: ${clarification.proposed_solution}` : ""),
        req.body?.cost_impact || 0,
        req.body?.schedule_impact_days || 0,
        today,
        "Potential Variation",
        clarification.id,
        "Internal"
      );

      db.prepare("UPDATE clarifications SET status='Converted to Variation' WHERE id=?").run(id);

      const createdCo = db.prepare("SELECT * FROM change_orders WHERE id=?").get(coId);
      res.status(201).json({
        message: "Clarification converted to Variation successfully",
        variation: createdCo,
        clarification_id: clarification.id
      });
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

  // Consolidated transactional publication & revision routes
  registerProgressRoutes(app, db, authRequired, hasProjectAccess, writeAudit);

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
      const newRevisionCode = req.body?.new_revision_code || req.body?.revision;
      const changeSummary = req.body?.change_summary || req.body?.notes;
      const attachmentName = req.body?.attachment_name;
      const attachmentData = req.body?.attachment_data;
      if (!newRevisionCode) {
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
        changeSummary || "Superseded by " + newRevisionCode,
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
        newRevisionCode,
        today,
        attachmentName || doc.attachment_name,
        attachmentData || doc.attachment_data,
        doc.id
      );

      writeAudit(req.user!.user_id, "documents", doc.id, doc.project_id, "new_revision", { old_rev: doc.revision }, { new_rev: newRevisionCode, change_summary: changeSummary });
      res.status(201).json({ ok: true, document_id: doc.id, revision: newRevisionCode, superseded_revision_id: revId });
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

  app.get("/api/progress_submissions/:id", authRequired, (req, res) => {
    try {
      if (req.user!.role === "Client") {
        res.status(403).json({ error: "Access denied: subcontractor submissions are internal" });
        return;
      }
      const submission = db.prepare(`
        SELECT ps.*, wp.name as work_package_name
        FROM progress_submissions ps
        LEFT JOIN work_packages wp ON wp.id = ps.work_package_id
        WHERE ps.id = ?
      `).get(req.params.id) as any;

      if (!submission) {
        res.status(404).json({ error: "Submission not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, submission.project_id)) {
        res.status(403).json({ error: "No access to this project" });
        return;
      }
      if (req.user!.role === "Subcontractor") {
        const isWpMatch = !req.user!.work_package_id || req.user!.work_package_id === submission.work_package_id;
        const isCoMatch = !req.user!.company_id || req.user!.company_id === submission.company_id;
        const isAuthor = submission.submitted_by === req.user!.name;
        if (!isWpMatch || !isCoMatch || !isAuthor) {
          res.status(403).json({ error: "Forbidden: no access to this submission" });
          return;
        }
      }
      res.json(rowToDict(submission));
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

  app.post("/api/progress_submissions/:id/verify", authRequired, (req, res) => {
    try {
      const existing = db.prepare("SELECT * FROM progress_submissions WHERE id=?").get(req.params.id) as any;
      if (!existing) {
        res.status(404).json({ error: "Submission not found" });
        return;
      }
      if (!hasProjectAccess(req.user!, existing.project_id) || (req.user!.role !== "Admin" && req.user!.role !== "ProjectManager" && req.user!.role !== "SiteEngineer")) {
        res.status(403).json({ error: "Only Project Managers or Site Engineers can verify progress submissions" });
        return;
      }
      const data = req.body || {};
      const now = new Date().toISOString();
      const rawAdj = data.verified_percent !== undefined ? data.verified_percent : (data.verified_percentage !== undefined ? data.verified_percentage : data.adjusted_percent);
      const finalPercent = rawAdj !== undefined ? parseImportNumber(rawAdj) : existing.claimed_percent;
      const reviewComments = data.verification_notes || data.review_comments || "";

      db.prepare(`
        UPDATE progress_submissions
        SET status='Approved with Adjustments', adjusted_percent=?, reviewed_by=?, review_comments=?, approved_at=?
        WHERE id=?
      `).run(finalPercent, req.user!.name, reviewComments, now, req.params.id);

      if (existing.work_package_id) {
        db.prepare(`
          UPDATE tasks
          SET progress = MAX(progress, ?)
          WHERE work_package_id = ? AND status != 'Completed'
        `).run(finalPercent, existing.work_package_id);
      }

      writeAudit(req.user!.user_id, "progress_submissions", req.params.id, existing.project_id, "verify", existing, data);
      const updated = db.prepare("SELECT * FROM progress_submissions WHERE id=?").get(req.params.id) as any;
      res.json({
        ...rowToDict(updated),
        verified_percent: updated.adjusted_percent,
        verified_percentage: updated.adjusted_percent
      });
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

  // =====================================================================
  // PROJECT UPDATES & LIVE PROGRESS FEED API
  // =====================================================================

  app.get('/api/project_updates', authRequired, (req, res) => {
    if (!canView(req.user!, 'project_updates')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const category = req.query.category as string;
    const trade = req.query.trade as string;
    const { where, params } = projectScopeSql(req.user!, projectId);
    if (!where) { res.status(403).json({ error: 'No project access' }); return; }
    let sql = `SELECT u.*, p.name as project_name FROM project_updates u LEFT JOIN projects p ON p.id = u.project_id WHERE ${where}`;
    if (category && category !== 'All') { sql += ' AND u.category = ?'; params.push(category); }
    if (trade && trade !== 'All') { sql += ' AND u.trade = ?'; params.push(trade); }
    sql += ' ORDER BY u.pinned DESC, u.created_at DESC';
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  });

  app.post('/api/project_updates', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'project_updates')) { res.status(403).json({ error: 'No edit access' }); return; }
    const { project_id, title, category, content, progress_percent, trade, work_package_id, weather, location, pinned, attachment_data, attachment_name } = req.body || {};
    if (!project_id || !title || !content) {
      res.status(400).json({ error: 'project_id, title, and content are required' });
      return;
    }
    if (!hasProjectAccess(req.user!, project_id)) {
      res.status(403).json({ error: 'No access to this project' });
      return;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const authorName = req.user!.name || 'Site Engineer';
    const prg = (progress_percent !== undefined && progress_percent !== null && progress_percent !== '') ? parseInt(String(progress_percent), 10) : null;

    db.prepare(`
      INSERT INTO project_updates (
        id, project_id, title, category, content, progress_percent, trade,
        work_package_id, weather, location, pinned, attachment_data, attachment_name,
        created_by, created_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, project_id, title, category || 'Site Progress', content,
      prg, trade || null, work_package_id || null, weather || null, location || null,
      pinned ? 1 : 0, attachment_data || null, attachment_name || null,
      req.user!.user_id, authorName, now
    );

    if (prg !== null && (req.user!.role === 'Admin' || req.user!.role === 'ProjectManager')) {
      try {
        db.prepare('UPDATE projects SET progress=? WHERE id=?').run(prg, project_id);
      } catch {}
    }

    try {
      const members = db.prepare('SELECT DISTINCT user_id FROM project_memberships WHERE project_id=? AND user_id != ?').all(project_id, req.user!.user_id) as any[];
      for (const m of members) {
        createNotification(
          m.user_id, project_id, 'project_updates', id,
          `Project Update: ${title}`,
          `${authorName} posted a new ${category || 'update'}: "${title}"`
        );
      }
    } catch {}

    writeAudit(req.user!.user_id, 'project_updates', id, project_id, 'create', null, { title, category });
    res.status(201).json(db.prepare('SELECT * FROM project_updates WHERE id=?').get(id));
  });

  app.get('/api/project_updates/:id', authRequired, (req, res) => {
    if (!canView(req.user!, 'project_updates')) { res.status(403).json({ error: 'No access' }); return; }
    const update = db.prepare('SELECT u.*, p.name as project_name FROM project_updates u LEFT JOIN projects p ON p.id = u.project_id WHERE u.id=?').get(req.params.id) as any;
    if (!update) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, update.project_id)) { res.status(403).json({ error: 'No access' }); return; }
    res.json(update);
  });

  app.delete('/api/project_updates/:id', authRequired, (req, res) => {
    const update = db.prepare('SELECT * FROM project_updates WHERE id=?').get(req.params.id) as any;
    if (!update) { res.status(404).json({ error: 'Not found' }); return; }
    if (req.user!.role !== 'Admin' && update.created_by !== req.user!.user_id) {
      res.status(403).json({ error: 'Only Admin or update creator can delete' });
      return;
    }
    db.prepare('DELETE FROM project_updates WHERE id=?').run(req.params.id);
    writeAudit(req.user!.user_id, 'project_updates', req.params.id, update.project_id, 'delete', update, null);
    res.json({ ok: true });
  });

  app.get('/api/projects/:id/feed', authRequired, (req, res) => {
    const projectId = req.params.id;
    if (!hasProjectAccess(req.user!, projectId)) {
      res.status(403).json({ error: 'No access to this project' });
      return;
    }
    const feed: any[] = [];

    try {
      const updates = db.prepare('SELECT * FROM project_updates WHERE project_id=? ORDER BY created_at DESC LIMIT 30').all(projectId) as any[];
      for (const u of updates) {
        feed.push({
          id: u.id,
          type: 'update',
          category: u.category || 'Site Progress',
          title: u.title,
          content: u.content,
          progress_percent: u.progress_percent,
          trade: u.trade,
          weather: u.weather,
          location: u.location,
          author: u.created_by_name || 'Team Member',
          created_at: u.created_at,
          attachment_data: u.attachment_data,
          attachment_name: u.attachment_name,
        });
      }
    } catch {}

    try {
      const reports = db.prepare('SELECT * FROM progress_reports WHERE project_id=? ORDER BY created_at DESC LIMIT 10').all(projectId) as any[];
      for (const r of reports) {
        feed.push({
          id: r.id,
          type: 'report',
          category: 'Progress Report',
          title: r.title || `Progress Report: ${r.report_date || r.created_at?.slice(0, 10)}`,
          content: r.executive_summary || 'Formal progress report compiled and issued.',
          progress_percent: r.overall_progress_percent,
          author: 'Project Manager',
          created_at: r.created_at,
          status: r.status,
        });
      }
    } catch {}

    try {
      const logs = db.prepare('SELECT * FROM dailylogs WHERE project_id=? ORDER BY log_date DESC LIMIT 15').all(projectId) as any[];
      for (const l of logs) {
        feed.push({
          id: l.id,
          type: 'dailylog',
          category: 'Daily Site Log',
          title: `Site Log: ${l.log_date || l.date || 'Site Entry'} (${l.trade || 'All Trades'})`,
          content: [l.work_performed, l.delays ? `Delays: ${l.delays}` : '', l.safety_incidents ? `Safety: ${l.safety_incidents}` : ''].filter(Boolean).join(' • ') || 'Work recorded for site.',
          crew: l.crew || l.workers_count,
          weather: l.weather,
          trade: l.trade,
          author: 'Site Team',
          created_at: l.log_date ? `${l.log_date}T18:00:00.000Z` : l.created_at || new Date().toISOString(),
        });
      }
    } catch {}

    try {
      const milestones = db.prepare("SELECT * FROM tasks WHERE project_id=? AND is_milestone=1 AND status IN ('Completed', 'Closed') ORDER BY end DESC LIMIT 10").all(projectId) as any[];
      for (const m of milestones) {
        feed.push({
          id: m.id,
          type: 'milestone',
          category: 'Milestone Completed',
          title: `Milestone Achieved: ${m.title}`,
          content: `Trade: ${m.trade || 'General'} • Target Date: ${m.end || m.start || 'Achieved'}`,
          progress_percent: 100,
          trade: m.trade,
          author: 'Project Management',
          created_at: m.end ? `${m.end}T17:00:00.000Z` : new Date().toISOString(),
        });
      }
    } catch {}

    feed.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    res.json(feed.slice(0, 50));
  });

  app.get('/api/projects/:id/overview', authRequired, (req, res) => {
    const projectId = req.params.id;
    if (!hasProjectAccess(req.user!, projectId)) {
      res.status(403).json({ error: 'No access to this project' });
      return;
    }
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId) as any;
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const tasks = db.prepare('SELECT * FROM tasks WHERE project_id=? ORDER BY wbs_code ASC, start ASC').all(projectId) as any[];
    const workPackages = db.prepare('SELECT * FROM work_packages WHERE project_id=?').all(projectId) as any[];
    const members = db.prepare('SELECT u.id, u.name, u.role, u.email, pm.access_role FROM project_memberships pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id=?').all(projectId) as any[];
    const companies = db.prepare('SELECT c.*, pc.relationship FROM project_companies pc JOIN companies c ON c.id = pc.company_id WHERE pc.project_id=?').all(projectId) as any[];
    const recentUpdates = db.prepare('SELECT * FROM project_updates WHERE project_id=? ORDER BY created_at DESC LIMIT 6').all(projectId) as any[];
    const rfis = db.prepare('SELECT status FROM rfis WHERE project_id=?').all(projectId) as any[];
    const snags = db.prepare('SELECT status FROM punchlist WHERE project_id=?').all(projectId) as any[];
    const ncrs = db.prepare('SELECT status FROM ncrs WHERE project_id=?').all(projectId) as any[];

    const completedTasks = tasks.filter(t => ['completed', 'closed'].includes((t.status || '').toLowerCase())).length;
    const inProgressTasks = tasks.filter(t => ['in progress', 'under review'].includes((t.status || '').toLowerCase())).length;
    const avgProgress = tasks.length ? Math.round(tasks.reduce((sum, t) => sum + (t.progress || 0), 0) / tasks.length) : (project.progress || 0);

    const openSnags = snags.filter(s => !['closed', 'complete verified'].includes((s.status || '').toLowerCase())).length;
    const openRfis = rfis.filter(r => !['closed', 'answered'].includes((r.status || '').toLowerCase())).length;
    const openNcrs = ncrs.filter(n => !['closed', 'rectified'].includes((n.status || '').toLowerCase())).length;

    let health = (openNcrs > 2 || openSnags > 10) ? 'RED' : (openSnags > 0 || openRfis > 3) ? 'AMBER' : 'GREEN';

    res.json({
      project: {
        ...project,
        calculated_progress: avgProgress,
        health,
      },
      stats: {
        total_tasks: tasks.length,
        completed_tasks: completedTasks,
        in_progress_tasks: inProgressTasks,
        work_packages_count: workPackages.length,
        team_count: members.length,
        subcontractors_count: companies.length,
        open_snags: openSnags,
        open_rfis: openRfis,
        open_ncrs: openNcrs,
      },
      tasks: tasks.slice(0, 30),
      work_packages: workPackages,
      members,
      companies,
      recent_updates: recentUpdates,
    });
  });

  // --- PROJECT MASTER DETAILS & GOVERNANCE ---
  app.get('/api/projects/:id/master', authRequired, (req, res) => {
    const projectId = req.params.id;
    if (!hasProjectAccess(req.user!, projectId)) {
      res.status(403).json({ error: 'No access to this project' });
      return;
    }
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId) as any;
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const sites = db.prepare('SELECT * FROM sites WHERE project_id=? ORDER BY name').all(projectId) as any[];
    const workPackages = db.prepare(`
      SELECT wp.*, c.name as company_name, s.name as site_name
      FROM work_packages wp
      LEFT JOIN companies c ON c.id = wp.company_id
      LEFT JOIN sites s ON s.id = wp.site_id
      WHERE wp.project_id=?
      ORDER BY wp.code ASC
    `).all(projectId) as any[];
    const wbsItems = db.prepare('SELECT * FROM wbs_items WHERE project_id=? ORDER BY code ASC').all(projectId) as any[];
    const tasks = db.prepare(`
      SELECT t.*, s.name as site_name, wp.name as work_package_name, c.name as company_name, sup.name as supervisor_name, w.name as worker_name
      FROM tasks t
      LEFT JOIN sites s ON s.id = t.site_id
      LEFT JOIN work_packages wp ON wp.id = t.work_package_id
      LEFT JOIN companies c ON c.id = t.company_id
      LEFT JOIN users sup ON sup.id = t.supervisor_id
      LEFT JOIN workers w ON w.id = t.assigned_worker_id
      WHERE t.project_id=?
      ORDER BY t.wbs_code ASC, t.start ASC
    `).all(projectId) as any[];

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => ['completed', 'closed'].includes((t.status || '').toLowerCase())).length;
    const inProgressTasks = tasks.filter(t => ['in progress', 'under review'].includes((t.status || '').toLowerCase())).length;
    const blockedTasks = tasks.filter(t => (t.status || '').toLowerCase() === 'blocked').length;
    const avgProgress = totalTasks ? Math.round(tasks.reduce((sum, t) => sum + (t.progress || 0), 0) / totalTasks) : (project.progress || 0);

    let scheduleVarianceDays = 0;
    const targetEnd = project.forecast_end_date || project.end_date;
    if (project.baseline_end_date && targetEnd) {
      const baseMs = new Date(project.baseline_end_date).getTime();
      const targetMs = new Date(targetEnd).getTime();
      if (!isNaN(baseMs) && !isNaN(targetMs)) {
        scheduleVarianceDays = Math.round((targetMs - baseMs) / (1000 * 60 * 60 * 24));
      }
    }

    const trades = ['HVAC', 'Electrical', 'Plumbing', 'Fire Fighting', 'ELV'];
    const tradeDistribution: Record<string, { total: number; completed: number; in_progress: number; progress_avg: number }> = {};
    for (const tr of trades) {
      const trTasks = tasks.filter(t => (t.trade || '').toLowerCase() === tr.toLowerCase());
      const trComp = trTasks.filter(t => ['completed', 'closed'].includes((t.status || '').toLowerCase())).length;
      const trProg = trTasks.length ? Math.round(trTasks.reduce((s, t) => s + (t.progress || 0), 0) / trTasks.length) : 0;
      tradeDistribution[tr] = {
        total: trTasks.length,
        completed: trComp,
        in_progress: trTasks.filter(t => ['in progress', 'under review'].includes((t.status || '').toLowerCase())).length,
        progress_avg: trProg
      };
    }

    res.json({
      ...rowToDict(project),
      id: project.id,
      name: project.name,
      project_code: project.project_code || project.code,
      contract_value: project.contract_value ?? project.budget ?? 0,
      currency: project.currency || 'USD',
      stage: project.stage || 'Construction',
      contract_type: project.contract_type || 'Lump Sum',
      calculated_progress: avgProgress,
      schedule_variance_days: scheduleVarianceDays,
      variance_days: scheduleVarianceDays,
      sites_count: sites.length,
      work_packages_count: workPackages.length,
      tasks_count: totalTasks,
      trades_breakdown: trades.map(tr => ({
        trade: tr,
        total_tasks: tradeDistribution[tr]?.total || 0,
        completed_tasks: tradeDistribution[tr]?.completed || 0,
        in_progress: tradeDistribution[tr]?.in_progress || 0,
        avg_progress: tradeDistribution[tr]?.progress_avg || 0
      })),
      project: {
        ...project,
        project_code: project.project_code || project.code,
        contract_value: project.contract_value ?? project.budget ?? 0,
        currency: project.currency || 'USD',
        stage: project.stage || 'Construction',
        contract_type: project.contract_type || 'Lump Sum',
        calculated_progress: avgProgress,
        schedule_variance_days: scheduleVarianceDays,
        variance_days: scheduleVarianceDays,
      },
      stats: {
        total_tasks: totalTasks,
        completed_tasks: completedTasks,
        in_progress_tasks: inProgressTasks,
        blocked_tasks: blockedTasks,
        sites_count: sites.length,
        work_packages_count: workPackages.length,
        wbs_count: wbsItems.length,
      },
      sites,
      work_packages: workPackages,
      wbs_items: wbsItems,
      trade_distribution: tradeDistribution,
    });
  });

  // --- WBS HIERARCHICAL TREE (Project -> WBS -> Work Package -> Site -> Tasks) ---
  app.get('/api/projects/:id/wbs-tree', authRequired, (req, res) => {
    const projectId = req.params.id;
    if (!hasProjectAccess(req.user!, projectId)) {
      res.status(403).json({ error: 'No access to this project' });
      return;
    }
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(projectId) as any;
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const wbsItems = db.prepare('SELECT * FROM wbs_items WHERE project_id=? ORDER BY code ASC').all(projectId) as any[];
    const workPackages = db.prepare(`
      SELECT wp.*, c.name as company_name, s.name as site_name
      FROM work_packages wp
      LEFT JOIN companies c ON c.id = wp.company_id
      LEFT JOIN sites s ON s.id = wp.site_id
      WHERE wp.project_id=?
      ORDER BY wp.code ASC
    `).all(projectId) as any[];
    const tasks = db.prepare(`
      SELECT t.*, s.name as site_name, wp.name as work_package_name, c.name as company_name, sup.name as supervisor_name, w.name as worker_name
      FROM tasks t
      LEFT JOIN sites s ON s.id = t.site_id
      LEFT JOIN work_packages wp ON wp.id = t.work_package_id
      LEFT JOIN companies c ON c.id = t.company_id
      LEFT JOIN users sup ON sup.id = t.supervisor_id
      LEFT JOIN workers w ON w.id = t.assigned_worker_id
      WHERE t.project_id=?
      ORDER BY t.wbs_code ASC, t.start ASC
    `).all(projectId) as any[];

    const rootNodes = wbsItems.length > 0
      ? wbsItems
      : [{ id: 'wbs-root', code: 'WBS-01', name: 'General MEP Scope', discipline: 'Multi-Disciplinary' }];

    const tree = rootNodes.map(wbs => {
      const matchedPackages = workPackages.filter(wp => wp.wbs_item_id === wbs.id || (!wp.wbs_item_id && wp.discipline === wbs.discipline));
      const effectivePackages = matchedPackages.length > 0
        ? matchedPackages
        : [{ id: 'wp-gen', code: 'WP-GEN', name: 'General Package', company_name: 'Main Contractor', site_name: 'Main Site' }];

      const packagesWithTasks = effectivePackages.map(wp => {
        const pkgTasks = tasks.filter(t => t.work_package_id === wp.id || (wp.id === 'wp-gen' && (!t.work_package_id || t.wbs_code === wbs.code || t.wbs_item_id === wbs.id)));
        const totalTasks = pkgTasks.length;
        const comp = pkgTasks.filter(t => ['completed', 'closed'].includes((t.status || '').toLowerCase())).length;
        const avg = totalTasks ? Math.round(pkgTasks.reduce((s, t) => s + (t.progress || 0), 0) / totalTasks) : 0;
        return {
          ...wp,
          task_count: totalTasks,
          completed_task_count: comp,
          progress_percent: avg,
          tasks: pkgTasks
        };
      });

      const allWbsTasks = packagesWithTasks.flatMap(p => p.tasks);
      const wbsTaskCount = allWbsTasks.length;
      const wbsCompCount = allWbsTasks.filter(t => ['completed', 'closed'].includes((t.status || '').toLowerCase())).length;
      const wbsAvg = wbsTaskCount ? Math.round(allWbsTasks.reduce((s, t) => s + (t.progress || 0), 0) / wbsTaskCount) : 0;

      return {
        ...wbs,
        total_tasks: wbsTaskCount,
        completed_tasks: wbsCompCount,
        progress_percent: wbsAvg,
        work_packages: packagesWithTasks
      };
    });

    res.json({
      project_id: projectId,
      project_name: project.name,
      project_code: project.project_code || project.code,
      total_wbs_nodes: wbsItems.length,
      total_work_packages: workPackages.length,
      total_tasks: tasks.length,
      tree
    });
  });

  // =====================================================================
  // WORKFORCE MODULE API (V1.2)
  // =====================================================================

  // --- SITES ---
  app.get('/api/sites', authRequired, (req, res) => {
    if (!canView(req.user!, 'sites')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId);
    if (!where) { res.status(403).json({ error: 'No project access' }); return; }
    const rows = db.prepare(`SELECT * FROM sites WHERE ${where} ORDER BY name`).all(...params);
    res.json(rows);
  });

  app.post('/api/sites', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'sites')) { res.status(403).json({ error: 'No edit access' }); return; }
    const { project_id, name, address, city, country, latitude, longitude, geofence_radius_m, geofence_warning_radius_m, timezone } = req.body;
    if (!project_id || !name) { res.status(400).json({ error: 'project_id and name required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO sites (id,project_id,name,address,city,country,latitude,longitude,geofence_radius_m,geofence_warning_radius_m,timezone,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, project_id, name, address||null, city||null, country||null, latitude||null, longitude||null, geofence_radius_m||100, geofence_warning_radius_m||150, timezone||'UTC', 'Active', req.user!.user_id, now);
    writeAudit(req.user!.user_id, 'sites', id, project_id, 'create', null, { name });
    res.status(201).json(db.prepare('SELECT * FROM sites WHERE id=?').get(id));
  });

  app.get('/api/sites/:id', authRequired, (req, res) => {
    if (!canView(req.user!, 'sites')) { res.status(403).json({ error: 'No access' }); return; }
    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(req.params.id) as any;
    if (!site) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, site.project_id)) { res.status(403).json({ error: 'No access' }); return; }
    res.json(site);
  });

  app.put('/api/sites/:id', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'sites')) { res.status(403).json({ error: 'No edit access' }); return; }
    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(req.params.id) as any;
    if (!site) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, site.project_id)) { res.status(403).json({ error: 'No access' }); return; }
    const { name, address, city, country, latitude, longitude, geofence_radius_m, geofence_warning_radius_m, timezone, status } = req.body;
    db.prepare(`UPDATE sites SET name=COALESCE(?,name),address=COALESCE(?,address),city=COALESCE(?,city),country=COALESCE(?,country),latitude=COALESCE(?,latitude),longitude=COALESCE(?,longitude),geofence_radius_m=COALESCE(?,geofence_radius_m),geofence_warning_radius_m=COALESCE(?,geofence_warning_radius_m),timezone=COALESCE(?,timezone),status=COALESCE(?,status) WHERE id=?`)
      .run(name||null, address||null, city||null, country||null, latitude||null, longitude||null, geofence_radius_m||null, geofence_warning_radius_m||null, timezone||null, status||null, req.params.id);
    writeAudit(req.user!.user_id, 'sites', req.params.id, site.project_id, 'update', site, req.body);
    res.json(db.prepare('SELECT * FROM sites WHERE id=?').get(req.params.id));
  });

  // Site control screen
  app.get('/api/sites/:id/control', authRequired, (req, res) => {
    if (!canView(req.user!, 'sites')) { res.status(403).json({ error: 'No access' }); return; }
    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(req.params.id) as any;
    if (!site) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, site.project_id)) { res.status(403).json({ error: 'No access' }); return; }
    const today = new Date().toISOString().split('T')[0];
    const presentWorkers = db.prepare(
      `SELECT a.*, w.trade, w.employment_type, w.employee_id FROM attendance a LEFT JOIN workers w ON w.id = a.worker_id WHERE a.site_id=? AND a.work_date=? AND a.punch_out IS NULL`
    ).all(req.params.id, today);
    const todayAttendance = db.prepare(
      `SELECT a.*, w.trade FROM attendance a LEFT JOIN workers w ON w.id = a.worker_id WHERE a.site_id=? AND a.work_date=?`
    ).all(req.params.id, today);
    const openInstructions = db.prepare(
      `SELECT * FROM site_instructions WHERE site_id=? AND status NOT IN ('Closed') ORDER BY priority DESC, created_at DESC`
    ).all(req.params.id);
    const pendingLeave = db.prepare(
      `SELECT lr.*, lt.name as leave_type_name FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id WHERE lr.project_id=? AND lr.status='Pending' ORDER BY lr.created_at DESC`
    ).all(site.project_id);
    res.json({ site, present_workers: presentWorkers, today_attendance: todayAttendance, open_instructions: openInstructions, pending_leave: pendingLeave, today: today });
  });

  // --- WORKERS ---
  app.get('/api/workers', authRequired, (req, res) => {
    if (!canView(req.user!, 'workers')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const siteId = req.query.site_id as string;
    const scoped = projectScopeSql(req.user!, projectId, 'w.project_id');
    if (!scoped.where) { res.status(403).json({ error: 'No project access' }); return; }
    let where = scoped.where;
    const params: any[] = [...scoped.params];

    if (siteId) {
      const site = db.prepare('SELECT * FROM sites WHERE id=?').get(siteId) as any;
      if (!site || !canAccessSite(req.user!, site, 'view')) { res.status(403).json({ error: 'No site access' }); return; }
      where += ' AND w.site_id=?';
      params.push(siteId);
    }

    if (req.user!.role === 'SiteSupervisor') {
      where += " AND EXISTS (SELECT 1 FROM worker_assignments wa WHERE wa.worker_id=w.id AND wa.supervisor_id=? AND wa.status='Active')";
      params.push(req.user!.user_id);
    } else if (req.user!.role === 'Worker') {
      where += ' AND w.user_id=?';
      params.push(req.user!.user_id);
    } else if (req.user!.role === 'Subcontractor') {
      if (!req.user!.company_id) { res.json([]); return; }
      where += ' AND w.company_id=?';
      params.push(req.user!.company_id);
      if (req.user!.work_package_id) {
        where += ' AND (w.work_package_id=? OR EXISTS (SELECT 1 FROM worker_assignments wa WHERE wa.worker_id=w.id AND wa.work_package_id=? AND wa.status=\'Active\'))';
        params.push(req.user!.work_package_id, req.user!.work_package_id);
      }
    }

    const rows = db.prepare(
      'SELECT w.*, c.name as company_name FROM workers w LEFT JOIN companies c ON c.id=w.company_id WHERE ' + where + ' ORDER BY w.name'
    ).all(...params) as any[];
    res.json(rows.filter(row => canAccessWorker(req.user!, row, 'view')).map(rowToDict));
  });

  app.post('/api/workers', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'workers')) { res.status(403).json({ error: 'No edit access' }); return; }
    const { project_id, site_id, company_id, user_id, name, employee_id, trade, employment_type, nationality, phone, email, supervisor_id, work_package_id } = req.body;
    if (!name) { res.status(400).json({ error: 'name required' }); return; }
    if (project_id && !hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }

    if (site_id) {
      const site = db.prepare('SELECT * FROM sites WHERE id=?').get(site_id) as any;
      if (!site || site.project_id !== project_id || site.status !== 'Active') { res.status(422).json({ error: 'site_id must be an active site in the project' }); return; }
    }
    if (company_id && project_id) {
      const pc = db.prepare('SELECT 1 FROM project_companies WHERE project_id=? AND company_id=?').get(project_id, company_id);
      if (!pc) { res.status(422).json({ error: 'company_id must participate in the project' }); return; }
    }
    if (work_package_id) {
      const wp = db.prepare('SELECT * FROM work_packages WHERE id=?').get(work_package_id) as any;
      if (!wp || wp.project_id !== project_id || (company_id && wp.company_id && wp.company_id !== company_id)) {
        res.status(422).json({ error: 'work_package_id is not valid for this project/company' }); return;
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO workers (id,project_id,site_id,company_id,user_id,name,employee_id,trade,employment_type,nationality,phone,email,supervisor_id,work_package_id,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, project_id||null, site_id||null, company_id||null, user_id||null, name, employee_id||null, trade||null, employment_type||'Permanent', nationality||null, phone||null, email||null, supervisor_id||null, work_package_id||null, 'Active', now);
    if (user_id) db.prepare('UPDATE users SET worker_id=? WHERE id=?').run(id, user_id);
    writeAudit(req.user!.user_id, 'workers', id, project_id||null, 'create', null, { name, company_id, site_id, work_package_id });
    res.status(201).json(db.prepare('SELECT * FROM workers WHERE id=?').get(id));
  });

  app.get('/api/workers/:id', authRequired, (req, res) => {
    if (!canView(req.user!, 'workers')) { res.status(403).json({ error: 'No access' }); return; }
    const worker = db.prepare('SELECT w.*, c.name as company_name FROM workers w LEFT JOIN companies c ON c.id=w.company_id WHERE w.id=?').get(req.params.id) as any;
    if (!worker) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessWorker(req.user!, worker, 'view')) { res.status(403).json({ error: 'No access' }); return; }
    res.json(rowToDict(worker));
  });

  app.put('/api/workers/:id', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'workers')) { res.status(403).json({ error: 'No edit access' }); return; }
    const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(req.params.id) as any;
    if (!worker) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessWorker(req.user!, worker, 'edit')) { res.status(403).json({ error: 'No access' }); return; }

    const { name, trade, employment_type, nationality, phone, email, supervisor_id, site_id, status, work_package_id } = req.body;
    if (site_id) {
      const site = db.prepare('SELECT * FROM sites WHERE id=?').get(site_id) as any;
      if (!site || site.project_id !== worker.project_id) { res.status(422).json({ error: 'site_id must belong to worker project' }); return; }
    }
    if (work_package_id) {
      const wp = db.prepare('SELECT * FROM work_packages WHERE id=?').get(work_package_id) as any;
      if (!wp || wp.project_id !== worker.project_id || (worker.company_id && wp.company_id && wp.company_id !== worker.company_id)) {
        res.status(422).json({ error: 'work_package_id is not valid for worker project/company' }); return;
      }
    }

    db.prepare('UPDATE workers SET name=COALESCE(?,name),trade=COALESCE(?,trade),employment_type=COALESCE(?,employment_type),nationality=COALESCE(?,nationality),phone=COALESCE(?,phone),email=COALESCE(?,email),supervisor_id=COALESCE(?,supervisor_id),site_id=COALESCE(?,site_id),status=COALESCE(?,status),work_package_id=COALESCE(?,work_package_id) WHERE id=?')
      .run(name||null, trade||null, employment_type||null, nationality||null, phone||null, email||null, supervisor_id||null, site_id||null, status||null, work_package_id||null, req.params.id);
    writeAudit(req.user!.user_id, 'workers', req.params.id, worker.project_id, 'update', worker, req.body);
    res.json(db.prepare('SELECT * FROM workers WHERE id=?').get(req.params.id));
  });

  app.get('/api/workers/:id/profile', authRequired, (req, res) => {
    if (!canView(req.user!, 'workers')) { res.status(403).json({ error: 'No access' }); return; }
    const worker = db.prepare('SELECT w.*, c.name as company_name FROM workers w LEFT JOIN companies c ON c.id=w.company_id WHERE w.id=?').get(req.params.id) as any;
    if (!worker) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessWorker(req.user!, worker, 'view')) { res.status(403).json({ error: 'No access' }); return; }
    const recentAttendance = db.prepare('SELECT * FROM attendance WHERE worker_id=? ORDER BY work_date DESC LIMIT 30').all(req.params.id);
    const tasks = db.prepare('SELECT * FROM tasks WHERE assigned_worker_id=? ORDER BY start DESC LIMIT 20').all(req.params.id);
    const instructions = db.prepare('SELECT * FROM site_instructions WHERE assigned_worker_id=? ORDER BY created_at DESC LIMIT 20').all(req.params.id);
    const leaveRequests = db.prepare('SELECT lr.*, lt.name as leave_type_name FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id WHERE lr.worker_id=? ORDER BY lr.created_at DESC LIMIT 20').all(req.params.id);
    const payrollEntries = canAccessPayroll(req.user!)
      ? db.prepare('SELECT pe.*, pp.period_name, pp.period_start, pp.period_end FROM payroll_entries pe JOIN payroll_periods pp ON pp.id=pe.payroll_period_id WHERE pe.worker_id=? ORDER BY pp.period_start DESC LIMIT 12').all(req.params.id)
      : [];
    res.json({ worker: rowToDict(worker), attendance: recentAttendance, tasks, instructions, leave_requests: leaveRequests, payroll_entries: payrollEntries });
  });

  // --- WORKER ASSIGNMENTS ---
  app.get('/api/worker_assignments', authRequired, (req, res) => {
    if (!canView(req.user!, 'worker_assignments')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const scoped = projectScopeSql(req.user!, projectId, 'wa.project_id');
    if (!scoped.where) { res.status(403).json({ error: 'No project access' }); return; }
    let where = scoped.where;
    const params = [...scoped.params];
    if (req.user!.role === 'Worker') {
      const worker = getWorkerPrincipal(req.user!.user_id);
      if (!worker) { res.json([]); return; }
      where += ' AND wa.worker_id=?'; params.push(worker.id);
    } else if (req.user!.role === 'SiteSupervisor') {
      where += ' AND wa.supervisor_id=?'; params.push(req.user!.user_id);
    } else if (req.user!.role === 'Subcontractor') {
      if (!req.user!.company_id) { res.json([]); return; }
      where += ' AND w.company_id=?'; params.push(req.user!.company_id);
    }
    const rows = db.prepare(
      'SELECT wa.*, w.name as worker_name, w.trade, w.company_id, s.name as site_name FROM worker_assignments wa ' +
      'LEFT JOIN workers w ON w.id=wa.worker_id LEFT JOIN sites s ON s.id=wa.site_id WHERE ' + where + ' ORDER BY wa.created_at DESC'
    ).all(...params);
    res.json(rows);
  });

  app.post('/api/worker_assignments', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'worker_assignments')) { res.status(403).json({ error: 'No edit access' }); return; }
    const { worker_id, project_id, site_id, work_package_id, supervisor_id, role_on_site, start_date, end_date } = req.body;
    if (!worker_id || !project_id || !site_id) { res.status(400).json({ error: 'worker_id, project_id and site_id required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }

    const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(worker_id) as any;
    if (!worker || worker.status !== 'Active') { res.status(422).json({ error: 'Active worker required' }); return; }
    if (worker.project_id && worker.project_id !== project_id) { res.status(422).json({ error: 'Worker belongs to another project' }); return; }
    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(site_id) as any;
    if (!site || site.project_id !== project_id || site.status !== 'Active') { res.status(422).json({ error: 'Active site in the same project required' }); return; }
    if (work_package_id) {
      const wp = db.prepare('SELECT * FROM work_packages WHERE id=?').get(work_package_id) as any;
      if (!wp || wp.project_id !== project_id || (worker.company_id && wp.company_id && wp.company_id !== worker.company_id)) {
        res.status(422).json({ error: 'Invalid work package for worker project/company' }); return;
      }
    }
    if (start_date && end_date && end_date < start_date) { res.status(422).json({ error: 'end_date cannot precede start_date' }); return; }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO worker_assignments (id,worker_id,project_id,site_id,work_package_id,supervisor_id,role_on_site,start_date,end_date,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, worker_id, project_id, site_id, work_package_id||null, supervisor_id||null, role_on_site||null, start_date||null, end_date||null, 'Active', now);
    db.prepare('UPDATE workers SET site_id=?,work_package_id=COALESCE(?,work_package_id),supervisor_id=COALESCE(?,supervisor_id) WHERE id=?')
      .run(site_id, work_package_id||null, supervisor_id||null, worker_id);
    writeAudit(req.user!.user_id, 'worker_assignments', id, project_id, 'create', null, req.body);
    res.status(201).json(db.prepare('SELECT * FROM worker_assignments WHERE id=?').get(id));
  });

  app.delete('/api/worker_assignments/:id', authRequired, (req, res) => {
    if (!canDelete(req.user!)) { res.status(403).json({ error: 'No delete access' }); return; }
    const wa = db.prepare('SELECT * FROM worker_assignments WHERE id=?').get(req.params.id) as any;
    if (!wa) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, wa.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    db.prepare('DELETE FROM worker_assignments WHERE id=?').run(req.params.id);
    writeAudit(req.user!.user_id, 'worker_assignments', req.params.id, wa.project_id, 'delete', wa, null);
    res.json({ ok: true });
  });

  // --- LIVE WORKFORCE DASHBOARD ---
  app.get('/api/workforce/today', authRequired, (req, res) => {
    if (!canView(req.user!, 'workforce')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const siteId = req.query.site_id as string;
    const scoped = projectScopeSql(req.user!, projectId, 'wa.project_id');
    if (!scoped.where) { res.status(403).json({ error: 'No project access' }); return; }

    if (siteId) {
      const site = db.prepare('SELECT * FROM sites WHERE id=?').get(siteId) as any;
      if (!site || !canAccessSite(req.user!, site, 'view')) { res.status(403).json({ error: 'No site access' }); return; }
    }

    let where = scoped.where + " AND wa.status='Active' AND w.status='Active' AND s.status='Active'";
    const params: any[] = [...scoped.params];
    if (siteId) { where += ' AND wa.site_id=?'; params.push(siteId); }
    if (req.user!.role === 'SiteSupervisor') { where += ' AND wa.supervisor_id=?'; params.push(req.user!.user_id); }
    if (req.user!.role === 'Subcontractor') {
      if (!req.user!.company_id) { res.json({ today: null, expected_count: 0, present_count: 0, late_count: 0, leave_count: 0, sick_count: 0, absent_count: 0, not_punched_count: 0, exception_count: 0, workers: [] }); return; }
      where += ' AND w.company_id=?'; params.push(req.user!.company_id);
    }
    if (req.user!.role === 'Worker') {
      const worker = getWorkerPrincipal(req.user!.user_id);
      if (!worker) { res.status(403).json({ error: 'Worker profile required' }); return; }
      where += ' AND wa.worker_id=?'; params.push(worker.id);
    }

    const assignments = db.prepare(
      'SELECT wa.*, w.name as worker_name, w.user_id, w.trade, w.employment_type, w.employee_id, w.company_id, ' +
      'c.name as company_name, s.name as site_name, s.timezone FROM worker_assignments wa ' +
      'JOIN workers w ON w.id=wa.worker_id JOIN sites s ON s.id=wa.site_id ' +
      'LEFT JOIN companies c ON c.id=w.company_id WHERE ' + where + ' ORDER BY s.name,w.name'
    ).all(...params) as any[];

    const now = new Date();
    const workerRows: any[] = [];
    const seen = new Set<string>();
    for (const a of assignments) {
      const workDate = zonedParts(now, a.timezone || 'UTC').date;
      if ((a.start_date && a.start_date > workDate) || (a.end_date && a.end_date < workDate)) continue;
      const key = a.worker_id + ':' + a.site_id;
      if (seen.has(key)) continue;
      seen.add(key);
      const status = calculateDailyAttendanceStatus(a.worker_id, a.project_id, a.site_id, workDate);
      const attendance = db.prepare('SELECT * FROM attendance WHERE worker_id=? AND project_id=? AND site_id=? AND work_date=? ORDER BY punch_in DESC LIMIT 1')
        .get(a.worker_id, a.project_id, a.site_id, workDate) as any;
      workerRows.push({
        worker_id: a.worker_id,
        worker_name: a.worker_name,
        employee_id: a.employee_id,
        company_id: a.company_id,
        company_name: a.company_name,
        trade: a.trade,
        project_id: a.project_id,
        site_id: a.site_id,
        site_name: a.site_name,
        work_package_id: a.work_package_id,
        supervisor_id: a.supervisor_id,
        work_date: workDate,
        status,
        punch_in: attendance?.punch_in || null,
        punch_out: attendance?.punch_out || null,
        late_minutes: attendance?.late_minutes || 0,
        geofence_status: attendance?.punch_in_geofence_status || null,
      });
    }

    const activePresent = workerRows.filter(w => w.punch_in && !w.punch_out);
    const late = workerRows.filter(w => w.status === 'Late');
    const leave = workerRows.filter(w => w.status === 'Annual Leave' || w.status === 'Leave');
    const sick = workerRows.filter(w => w.status === 'Sick Leave');
    const absent = workerRows.filter(w => w.status === 'Absent');
    const exceptions = workerRows.filter(w => w.status === 'Attendance Exception');
    const expected = workerRows.filter(w => !['Rest Day','Public Holiday'].includes(w.status));
    const pendingOt = workerRows.flatMap(w => {
      const row = db.prepare("SELECT * FROM attendance WHERE worker_id=? AND project_id=? AND work_date=? AND raw_overtime_minutes>0 AND ot_status='Pending' ORDER BY punch_in DESC LIMIT 1")
        .get(w.worker_id, w.project_id, w.work_date) as any;
      return row ? [{ ...row, worker_name: w.worker_name }] : [];
    });
    const todayValues = [...new Set(workerRows.map(w => w.work_date))];

    res.json({
      today: todayValues.length === 1 ? todayValues[0] : null,
      dates_by_timezone: todayValues,
      expected_count: expected.length,
      present_count: activePresent.length,
      completed_count: workerRows.filter(w => w.punch_out).length,
      late_count: late.length,
      leave_count: leave.length,
      sick_count: sick.length,
      absent_count: absent.length,
      not_punched_count: absent.length,
      exception_count: exceptions.length,
      workers: workerRows,
      present_workers: activePresent,
      exceptions,
      pending_overtime: pendingOt,
    });
  });

  // Workforce calendar (per worker per day P/L/A status)
  app.get('/api/workforce/calendar', authRequired, (req, res) => {
    if (!canView(req.user!, 'workforce')) { res.status(403).json({ error: 'No access' }); return; }
    const { project_id, worker_id, month, year } = req.query as any;
    if (!project_id) { res.status(400).json({ error: 'project_id required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const y = parseInt(year || new Date().getFullYear().toString());
    const m = parseInt(month || (new Date().getMonth()+1).toString());
    const startDate = `${y}-${String(m).padStart(2,'0')}-01`;
    const endDate = `${y}-${String(m).padStart(2,'0')}-31`;
    let where = 'a.project_id=? AND a.work_date>=? AND a.work_date<=?';
    const params: any[] = [project_id, startDate, endDate];
    if (worker_id) { where += ' AND a.worker_id=?'; params.push(worker_id); }
    if (req.user!.role === 'Worker') {
      const workerRow = db.prepare('SELECT id FROM workers WHERE user_id=?').get(req.user!.user_id) as any;
      if (workerRow) { where += ' AND a.worker_id=?'; params.push(workerRow.id); }
    }
    const attendance = db.prepare(`SELECT a.work_date, a.worker_id, a.punch_in, a.punch_out, a.status, a.regular_hours, a.overtime_hours, w.name as worker_name FROM attendance a LEFT JOIN workers w ON w.id=a.worker_id WHERE ${where} ORDER BY a.work_date, w.name`).all(...params);
    const leaves = db.prepare(`SELECT lr.*, lt.code as leave_code FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id WHERE lr.project_id=? AND lr.start_date<=? AND lr.end_date>=? AND lr.status='Approved'`).all(project_id, endDate, startDate);
    res.json({ year: y, month: m, attendance, approved_leaves: leaves });
  });

  // GPS-aware punch-in (server-time authority, server-side Haversine geofencing)
  app.post('/api/attendance/gps-punch-in', authRequired, (req, res) => {
    const projectId = String(req.body?.project_id || '');
    const siteId = String(req.body?.site_id || '');
    if (!projectId || !siteId) { res.status(400).json({ error: 'project_id and site_id required' }); return; }
    if (!hasProjectAccess(req.user!, projectId)) { res.status(403).json({ error: 'No project access' }); return; }
    if (!canEdit(req.user!, 'attendance')) { res.status(403).json({ error: 'No edit access' }); return; }

    const worker = getWorkerPrincipal(req.user!.user_id);
    if (!worker || worker.status !== 'Active') { res.status(403).json({ error: 'Active worker profile required' }); return; }

    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(siteId) as any;
    if (!site || site.status !== 'Active' || site.project_id !== projectId) {
      res.status(403).json({ error: 'Worker is not authorized for this active project site' }); return;
    }

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const resolved = resolveWorkDateForPunch(worker.id, site, nowDate);
    const assignment = getActiveWorkerAssignment(worker.id, projectId, siteId, resolved.workDate);
    if (!assignment) { res.status(403).json({ error: 'No active worker assignment for this project, site and work date' }); return; }

    const active = db.prepare('SELECT id FROM attendance WHERE user_id=? AND punch_out IS NULL').get(req.user!.user_id);
    if (active) { res.status(409).json({ error: 'Already punched in' }); return; }

    const { lat, lng, accuracy } = req.body;
    const latitude = Number(lat);
    const longitude = Number(lng);
    const accuracyM = Number(accuracy);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        !Number.isFinite(accuracyM) || accuracyM < 0) {
      res.status(400).json({ error: 'Valid lat, lng and non-negative GPS accuracy are required' }); return;
    }
    if (site.latitude == null || site.longitude == null) {
      res.status(409).json({ error: 'Site GPS coordinates are not configured' }); return;
    }
    let geofence: string | null = null;
    let distanceM: number | null = null;
    {
      distanceM = haversineDistance(latitude, longitude, site.latitude, site.longitude);
      geofence = geofenceStatus(distanceM, site, accuracyM);
    }

    const shift = resolved.shift || getWorkerShift(worker.id, resolved.workDate);
    const id = crypto.randomUUID();
    const notes = req.body?.shift_notes || req.body?.notes || '';
    db.prepare(
      'INSERT INTO attendance (id,project_id,user_id,worker,work_date,punch_in,punch_out,status,notes,site_id,worker_id,' +
      'punch_in_lat,punch_in_lng,punch_in_accuracy,punch_in_geofence_status,punch_in_distance_m,shift_template_id,' +
      'company_id,work_package_id,supervisor_id,elapsed_minutes,regular_minutes,break_minutes,raw_overtime_minutes,' +
      'approved_overtime_minutes,late_minutes,attendance_status,ot_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      id, projectId, req.user!.user_id, worker.name || req.user!.name, resolved.workDate, now, null, 'Open', notes,
      siteId, worker.id, latitude, longitude,
      accuracyM, geofence, distanceM, shift?.id || null,
      worker.company_id || null, assignment.work_package_id || worker.work_package_id || null,
      assignment.supervisor_id || worker.supervisor_id || null, 0, 0, 0, 0, 0, 0,
      geofence && geofence !== 'Valid' ? 'Attendance Exception' : 'Present', 'None'
    );
    const created = recalculateAttendanceRecord(id) || db.prepare('SELECT * FROM attendance WHERE id=?').get(id);
    writeAudit(req.user!.user_id, 'attendance', id, projectId, 'gps_punch_in', null, {
      worker_id: worker.id, site_id: siteId, work_date: resolved.workDate, punch_in: now, geofence, distance_m: distanceM
    });
    res.status(201).json(created);
  });

  

  // GPS-aware punch-out (server-time authority, server-side Haversine geofencing)
  app.post('/api/attendance/gps-punch-out', authRequired, (req, res) => {
    const active = db.prepare('SELECT * FROM attendance WHERE user_id=? AND punch_out IS NULL').get(req.user!.user_id) as any;
    if (!active) { res.status(409).json({ error: 'Not punched in' }); return; }
    if (!canAccessAttendance(req.user!, active, 'edit')) { res.status(403).json({ error: 'No access' }); return; }

    const site = db.prepare('SELECT * FROM sites WHERE id=?').get(active.site_id) as any;
    if (!site || site.project_id !== active.project_id) { res.status(409).json({ error: 'Attendance site is no longer valid for the project' }); return; }

    const { lat, lng, accuracy } = req.body;
    const latitude = Number(lat);
    const longitude = Number(lng);
    const accuracyM = Number(accuracy);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        !Number.isFinite(accuracyM) || accuracyM < 0) {
      res.status(400).json({ error: 'Valid lat, lng and non-negative GPS accuracy are required' }); return;
    }
    if (site.latitude == null || site.longitude == null) {
      res.status(409).json({ error: 'Site GPS coordinates are not configured' }); return;
    }
    const now = new Date().toISOString();
    let geofence: string | null = null;
    let distanceM: number | null = null;
    {
      distanceM = haversineDistance(latitude, longitude, site.latitude, site.longitude);
      geofence = geofenceStatus(distanceM, site, accuracyM);
    }

    db.prepare(
      "UPDATE attendance SET punch_out=?,status='Closed',punch_out_lat=?,punch_out_lng=?,punch_out_accuracy=?," +
      "punch_out_geofence_status=?,punch_out_distance_m=? WHERE id=?"
    ).run(
      now, latitude, longitude,
      accuracyM, geofence, distanceM, active.id
    );

    let updated = recalculateAttendanceRecord(active.id) as any;
    const nextOtStatus = (updated?.raw_overtime_minutes || 0) > 0 ? 'Pending' : 'None';
    db.prepare('UPDATE attendance SET ot_status=?,approved_overtime_minutes=0,ot_approved_by=NULL,ot_approved_at=NULL,ot_reject_reason=NULL WHERE id=?')
      .run(nextOtStatus, active.id);
    updated = db.prepare('SELECT * FROM attendance WHERE id=?').get(active.id) as any;
    writeAudit(req.user!.user_id, 'attendance', active.id, active.project_id, 'gps_punch_out', active, {
      punch_out: now,
      elapsed_minutes: updated.elapsed_minutes,
      break_minutes: updated.break_minutes,
      regular_minutes: updated.regular_minutes,
      raw_overtime_minutes: updated.raw_overtime_minutes,
      geofence,
    });
    res.json(updated);
  });

  

  // Attendance exceptions (missing punch / geofence violations)
  app.get('/api/attendance/exceptions', authRequired, (req, res) => {
    if (!canView(req.user!, 'attendance')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const scoped = projectScopeSql(req.user!, projectId, 'a.project_id');
    if (!scoped.where) { res.status(403).json({ error: 'No project access' }); return; }

    const days = Math.max(1, Math.min(90, parseInt(req.query.days as string || '7', 10) || 7));
    const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    let where = scoped.where + ' AND a.work_date>=?';
    const params: any[] = [...scoped.params, since];

    if (req.user!.role === 'Worker') {
      where += ' AND a.user_id=?'; params.push(req.user!.user_id);
    } else if (req.user!.role === 'Subcontractor') {
      if (!req.user!.company_id) { res.json([]); return; }
      where += ' AND w.company_id=?'; params.push(req.user!.company_id);
    } else if (req.user!.role === 'SiteSupervisor') {
      where += " AND EXISTS (SELECT 1 FROM worker_assignments wa WHERE wa.worker_id=a.worker_id AND wa.project_id=a.project_id AND wa.supervisor_id=? AND wa.status='Active')";
      params.push(req.user!.user_id);
    }

    const rows = db.prepare(
      "SELECT a.*, w.name as worker_name, w.trade, w.company_id as worker_company_id, s.name as site_name " +
      "FROM attendance a LEFT JOIN workers w ON w.id=a.worker_id LEFT JOIN sites s ON s.id=a.site_id WHERE " +
      where + " AND ((a.punch_out IS NULL AND a.work_date < date('now')) " +
      "OR a.punch_in_geofence_status IN ('Outside Geofence','GPS Accuracy Poor') " +
      "OR a.punch_out_geofence_status IN ('Outside Geofence','GPS Accuracy Poor') " +
      "OR a.attendance_status='Attendance Exception') ORDER BY a.work_date DESC"
    ).all(...params) as any[];

    res.json(rows.filter(row => canAccessAttendance(req.user!, row, 'view')));
  });

  // Overtime approval (blocks self-approval)
  app.post('/api/attendance/:id/overtime-approve', authRequired, (req, res) => {
    if (!['Admin','ProjectManager','SiteSupervisor'].includes(req.user!.role)) { res.status(403).json({ error: 'No approval authority' }); return; }
    const record = db.prepare('SELECT * FROM attendance WHERE id=?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessAttendance(req.user!, record, 'edit')) { res.status(403).json({ error: 'No access' }); return; }
    if (record.user_id === req.user!.user_id) { res.status(403).json({ error: 'Cannot approve own overtime' }); return; }

    const { action, reject_reason } = req.body;
    if (!['Approved','Rejected'].includes(action)) { res.status(400).json({ error: 'action must be Approved or Rejected' }); return; }
    const now = new Date().toISOString();
    const approvedMinutes = action === 'Approved' ? Number(record.raw_overtime_minutes || 0) : 0;
    db.prepare('UPDATE attendance SET ot_status=?,approved_overtime_minutes=?,ot_approved_by=?,ot_approved_at=?,ot_reject_reason=? WHERE id=?')
      .run(action, approvedMinutes, req.user!.user_id, now, action === 'Rejected' ? (reject_reason||null) : null, req.params.id);
    writeAudit(req.user!.user_id, 'attendance', req.params.id, record.project_id, `ot_${action.toLowerCase()}`, record, { action, approved_overtime_minutes: approvedMinutes });
    createNotification(record.user_id, record.project_id, 'attendance', req.params.id, `Overtime ${action}`, `Your overtime for ${record.work_date} was ${action.toLowerCase()} by ${req.user!.name}`);
    res.json(db.prepare('SELECT * FROM attendance WHERE id=?').get(req.params.id));
  });

  

  // Attendance adjustment (correction request)
  app.post('/api/attendance/:id/adjust', authRequired, (req, res) => {
    const record = db.prepare('SELECT * FROM attendance WHERE id=?').get(req.params.id) as any;
    if (!record) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessAttendance(req.user!, record, 'edit')) { res.status(403).json({ error: 'No access' }); return; }
    if (req.user!.role === 'Worker' && record.user_id !== req.user!.user_id) { res.status(403).json({ error: 'Workers may only correct their own attendance' }); return; }

    const { adjusted_punch_in, adjusted_punch_out, adjustment_reason } = req.body;
    if (!adjustment_reason) { res.status(400).json({ error: 'adjustment_reason required' }); return; }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO attendance_adjustments (id,attendance_id,project_id,worker_id,user_id,original_punch_in,original_punch_out,adjusted_punch_in,adjusted_punch_out,adjustment_reason,status,submitted_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, req.params.id, record.project_id, record.worker_id||null, record.user_id, record.punch_in, record.punch_out, adjusted_punch_in||null, adjusted_punch_out||null, adjustment_reason, 'Pending', req.user!.user_id, now);
    writeAudit(req.user!.user_id, 'attendance_adjustments', id, record.project_id, 'submit', null, req.body);
    res.status(201).json(db.prepare('SELECT * FROM attendance_adjustments WHERE id=?').get(id));
  });

  app.post('/api/attendance_adjustments/:id/approve', authRequired, (req, res) => {
    if (!['Admin','ProjectManager','SiteSupervisor'].includes(req.user!.role)) { res.status(403).json({ error: 'No approval authority' }); return; }
    const adj = db.prepare('SELECT * FROM attendance_adjustments WHERE id=?').get(req.params.id) as any;
    if (!adj) { res.status(404).json({ error: 'Not found' }); return; }
    const record = db.prepare('SELECT * FROM attendance WHERE id=?').get(adj.attendance_id) as any;
    if (!record || !canAccessAttendance(req.user!, record, 'edit')) { res.status(403).json({ error: 'No access' }); return; }
    if (adj.submitted_by === req.user!.user_id || record.user_id === req.user!.user_id) { res.status(403).json({ error: 'Cannot approve own adjustment' }); return; }

    const { action, reject_reason } = req.body;
    if (!['Approved','Rejected'].includes(action)) { res.status(400).json({ error: 'action must be Approved or Rejected' }); return; }
    const now = new Date().toISOString();
    db.prepare('UPDATE attendance_adjustments SET status=?,approved_by=?,approved_at=?,reject_reason=? WHERE id=?')
      .run(action, req.user!.user_id, now, reject_reason||null, req.params.id);

    if (action === 'Approved') {
      if (adj.adjusted_punch_in) db.prepare('UPDATE attendance SET punch_in=? WHERE id=?').run(adj.adjusted_punch_in, adj.attendance_id);
      if (adj.adjusted_punch_out) db.prepare('UPDATE attendance SET punch_out=?,status=\'Closed\' WHERE id=?').run(adj.adjusted_punch_out, adj.attendance_id);
      if (adj.adjusted_punch_in && record.worker_id && record.site_id) {
        const site = db.prepare('SELECT * FROM sites WHERE id=?').get(record.site_id) as any;
        if (site) {
          const resolved = resolveWorkDateForPunch(record.worker_id, site, new Date(adj.adjusted_punch_in));
          db.prepare('UPDATE attendance SET work_date=?,shift_template_id=? WHERE id=?').run(resolved.workDate, resolved.shift?.id || record.shift_template_id || null, adj.attendance_id);
        }
      }
      const recalculated = recalculateAttendanceRecord(adj.attendance_id) as any;
      const approvedMinutes = recalculated?.ot_status === 'Approved' ? Number(recalculated.raw_overtime_minutes || 0) : 0;
      db.prepare('UPDATE attendance SET approved_overtime_minutes=? WHERE id=?').run(approvedMinutes, adj.attendance_id);
    }

    writeAudit(req.user!.user_id, 'attendance_adjustments', req.params.id, adj.project_id, action.toLowerCase(), adj, { action });
    createNotification(adj.user_id, adj.project_id, 'attendance', adj.attendance_id, `Attendance Adjustment ${action}`, `Your attendance correction request was ${action.toLowerCase()}`);
    res.json(db.prepare('SELECT * FROM attendance_adjustments WHERE id=?').get(req.params.id));
  });

  

  // --- SHIFT TEMPLATES ---
  app.get('/api/shift_templates', authRequired, (req, res) => {
    if (!canView(req.user!, 'shift_templates')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId);
    if (!where) { res.status(403).json({ error: 'No project access' }); return; }
    res.json(db.prepare('SELECT * FROM shift_templates WHERE ' + where + ' ORDER BY name').all(...params));
  });

  app.post('/api/shift_templates', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'shift_templates')) { res.status(403).json({ error: 'No edit access' }); return; }
    const { project_id, name, start_time, end_time, grace_minutes, break_minutes, regular_hours, ot_threshold_hours, working_days_json } = req.body;
    if (!project_id || !name || !start_time || !end_time) { res.status(400).json({ error: 'project_id, name, start_time, end_time required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const workingDays = JSON.stringify(parseWorkingDays(working_days_json));
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO shift_templates (id,project_id,name,start_time,end_time,grace_minutes,break_minutes,regular_hours,ot_threshold_hours,status,created_at,working_days_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, project_id, name, start_time, end_time, grace_minutes??15, break_minutes??60, regular_hours??8, ot_threshold_hours??8, 'Active', now, workingDays);
    res.status(201).json(db.prepare('SELECT * FROM shift_templates WHERE id=?').get(id));
  });

  app.put('/api/shift_templates/:id', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'shift_templates')) { res.status(403).json({ error: 'No edit access' }); return; }
    const tmpl = db.prepare('SELECT * FROM shift_templates WHERE id=?').get(req.params.id) as any;
    if (!tmpl) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, tmpl.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const { name, start_time, end_time, grace_minutes, break_minutes, regular_hours, ot_threshold_hours, status, working_days_json } = req.body;
    const workingDays = working_days_json === undefined ? null : JSON.stringify(parseWorkingDays(working_days_json));
    db.prepare('UPDATE shift_templates SET name=COALESCE(?,name),start_time=COALESCE(?,start_time),end_time=COALESCE(?,end_time),grace_minutes=COALESCE(?,grace_minutes),break_minutes=COALESCE(?,break_minutes),regular_hours=COALESCE(?,regular_hours),ot_threshold_hours=COALESCE(?,ot_threshold_hours),status=COALESCE(?,status),working_days_json=COALESCE(?,working_days_json) WHERE id=?')
      .run(name||null, start_time||null, end_time||null, grace_minutes??null, break_minutes??null, regular_hours??null, ot_threshold_hours??null, status||null, workingDays, req.params.id);
    res.json(db.prepare('SELECT * FROM shift_templates WHERE id=?').get(req.params.id));
  });

  app.get('/api/worker_schedules', authRequired, (req, res) => {
    const projectId = req.query.project_id as string;
    const workerId = req.query.worker_id as string;
    if (!projectId || !hasProjectAccess(req.user!, projectId)) { res.status(403).json({ error: 'No project access' }); return; }
    let sql = 'SELECT ws.*, st.project_id, st.name as shift_name, st.start_time, st.end_time, st.working_days_json FROM worker_schedules ws JOIN shift_templates st ON st.id=ws.shift_template_id JOIN workers w ON w.id=ws.worker_id WHERE st.project_id=?';
    const params: any[] = [projectId];
    if (workerId) {
      const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(workerId) as any;
      if (!worker || !canAccessWorker(req.user!, worker, 'view')) { res.status(403).json({ error: 'No worker access' }); return; }
      sql += ' AND ws.worker_id=?'; params.push(workerId);
    }
    if (req.user!.role === 'Worker') {
      const worker = getWorkerPrincipal(req.user!.user_id);
      if (!worker) { res.json([]); return; }
      sql += ' AND ws.worker_id=?'; params.push(worker.id);
    } else if (req.user!.role === 'SiteSupervisor') {
      sql += " AND EXISTS (SELECT 1 FROM worker_assignments wa WHERE wa.worker_id=ws.worker_id AND wa.project_id=? AND wa.supervisor_id=? AND wa.status='Active')";
      params.push(projectId, req.user!.user_id);
    } else if (req.user!.role === 'Subcontractor') {
      if (!req.user!.company_id) { res.json([]); return; }
      sql += ' AND w.company_id=?'; params.push(req.user!.company_id);
    }
    sql += ' ORDER BY ws.effective_from DESC';
    res.json(db.prepare(sql).all(...params));
  });

  app.post('/api/worker_schedules', authRequired, (req, res) => {
    if (!['Admin','ProjectManager','SiteSupervisor'].includes(req.user!.role)) { res.status(403).json({ error: 'No schedule authority' }); return; }
    const { worker_id, shift_template_id, effective_from, effective_to } = req.body;
    if (!worker_id || !shift_template_id || !effective_from) { res.status(400).json({ error: 'worker_id, shift_template_id and effective_from required' }); return; }
    if (effective_to && effective_to < effective_from) { res.status(422).json({ error: 'effective_to cannot precede effective_from' }); return; }
    const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(worker_id) as any;
    const shift = db.prepare('SELECT * FROM shift_templates WHERE id=?').get(shift_template_id) as any;
    if (!worker || !shift) { res.status(404).json({ error: 'Worker or shift template not found' }); return; }
    if (!hasProjectAccess(req.user!, shift.project_id) || (worker.project_id && worker.project_id !== shift.project_id)) {
      res.status(403).json({ error: 'Worker and shift must be in an authorized project' }); return;
    }
    if (req.user!.role === 'SiteSupervisor' && !canAccessWorker(req.user!, worker, 'view')) {
      res.status(403).json({ error: 'No worker access' }); return;
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO worker_schedules (id,worker_id,shift_template_id,effective_from,effective_to,created_at) VALUES (?,?,?,?,?,?)')
      .run(id, worker_id, shift_template_id, effective_from, effective_to||null, now);
    writeAudit(req.user!.user_id, 'worker_schedules', id, shift.project_id, 'create', null, { worker_id, shift_template_id, effective_from, effective_to });
    res.status(201).json(db.prepare('SELECT * FROM worker_schedules WHERE id=?').get(id));
  });

  app.get('/api/public_holidays', authRequired, (req, res) => {
    const projectId = req.query.project_id as string;
    if (!projectId || !hasProjectAccess(req.user!, projectId)) { res.status(403).json({ error: 'No project access' }); return; }
    const siteId = req.query.site_id as string;
    let sql = 'SELECT * FROM public_holidays WHERE (project_id=? OR project_id IS NULL)';
    const params: any[] = [projectId];
    if (siteId) { sql += ' AND (site_id=? OR site_id IS NULL)'; params.push(siteId); }
    sql += ' ORDER BY holiday_date';
    res.json(db.prepare(sql).all(...params));
  });

  app.post('/api/public_holidays', authRequired, (req, res) => {
    if (!['Admin','ProjectManager'].includes(req.user!.role)) { res.status(403).json({ error: 'No edit access' }); return; }
    const { project_id, site_id, country_code, holiday_date, name, paid } = req.body;
    if (!project_id || !holiday_date || !name) { res.status(400).json({ error: 'project_id, holiday_date and name required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    if (site_id) {
      const site = db.prepare('SELECT * FROM sites WHERE id=?').get(site_id) as any;
      if (!site || site.project_id !== project_id) { res.status(422).json({ error: 'site_id must belong to project' }); return; }
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO public_holidays (id,project_id,site_id,country_code,holiday_date,name,paid,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, project_id, site_id||null, country_code||null, holiday_date, name, paid === false ? 0 : 1, now);
    res.status(201).json(db.prepare('SELECT * FROM public_holidays WHERE id=?').get(id));
  });

  

  // --- SITE INSTRUCTIONS ---
  app.get('/api/site_instructions', authRequired, (req, res) => {
    if (!canView(req.user!, 'site_instructions')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const scoped = projectScopeSql(req.user!, projectId, 'si.project_id');
    if (!scoped.where) { res.status(403).json({ error: 'No project access' }); return; }
    const rows = db.prepare(
      'SELECT si.*, w.name as assigned_worker_name, s.name as site_name FROM site_instructions si ' +
      'LEFT JOIN workers w ON w.id=si.assigned_worker_id LEFT JOIN sites s ON s.id=si.site_id WHERE ' +
      scoped.where + ' ORDER BY si.created_at DESC'
    ).all(...scoped.params) as any[];
    res.json(rows.filter(row => canAccessSiteInstruction(req.user!, row, 'view')));
  });

  app.post('/api/site_instructions', authRequired, (req, res) => {
    if (!['Admin','ProjectManager'].includes(req.user!.role)) { res.status(403).json({ error: 'Only Admin or ProjectManager can issue official site instructions' }); return; }
    const { project_id, site_id, work_package_id, instruction_type, title, description, priority, assigned_worker_id, assigned_supervisor_id, due_date, location, related_document_id, related_rfi_id, related_ncr_id, related_boq_item_id } = req.body;
    if (!project_id || !instruction_type || !title) { res.status(400).json({ error: 'project_id, instruction_type, title required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    if (site_id) {
      const site = db.prepare('SELECT * FROM sites WHERE id=?').get(site_id) as any;
      if (!site || site.project_id !== project_id || site.status !== 'Active') { res.status(422).json({ error: 'site_id must be an active site in this project' }); return; }
    }
    if (work_package_id) {
      const wp = db.prepare('SELECT * FROM work_packages WHERE id=?').get(work_package_id) as any;
      if (!wp || wp.project_id !== project_id) { res.status(422).json({ error: 'work_package_id must belong to project' }); return; }
    }
    if (assigned_worker_id) {
      const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(assigned_worker_id) as any;
      if (!worker || worker.status !== 'Active') { res.status(422).json({ error: 'Active assigned worker required' }); return; }
      if (site_id) {
        const workDate = due_date || zonedParts(new Date(), (db.prepare('SELECT timezone FROM sites WHERE id=?').get(site_id) as any)?.timezone || 'UTC').date;
        const assignment = getActiveWorkerAssignment(worker.id, project_id, site_id, workDate);
        if (!assignment) { res.status(422).json({ error: 'Assigned worker has no active assignment for this project/site' }); return; }
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM site_instructions WHERE project_id=?').get(project_id) as any;
    const instrNum = `SI-${String((countRow.cnt||0)+1).padStart(4,'0')}`;
    db.prepare('INSERT INTO site_instructions (id,project_id,site_id,work_package_id,instruction_number,instruction_type,title,description,priority,status,assigned_worker_id,assigned_supervisor_id,issued_by,issued_at,due_date,location,related_document_id,related_rfi_id,related_ncr_id,related_boq_item_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, project_id, site_id||null, work_package_id||null, instrNum, instruction_type, title, description||null, priority||'Medium', 'Draft', assigned_worker_id||null, assigned_supervisor_id||null, req.user!.user_id, now, due_date||null, location||null, related_document_id||null, related_rfi_id||null, related_ncr_id||null, related_boq_item_id||null, now);
    writeAudit(req.user!.user_id, 'site_instructions', id, project_id, 'create', null, { title, instruction_type });
    res.status(201).json(db.prepare('SELECT * FROM site_instructions WHERE id=?').get(id));
  });

  app.get('/api/site_instructions/:id', authRequired, (req, res) => {
    const instr = db.prepare('SELECT si.*, w.name as assigned_worker_name, s.name as site_name FROM site_instructions si LEFT JOIN workers w ON w.id=si.assigned_worker_id LEFT JOIN sites s ON s.id=si.site_id WHERE si.id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessSiteInstruction(req.user!, instr, 'view')) { res.status(403).json({ error: 'No access' }); return; }
    const updates = db.prepare('SELECT * FROM site_instruction_updates WHERE instruction_id=? ORDER BY created_at ASC').all(req.params.id);
    const attachments = db.prepare('SELECT * FROM site_instruction_attachments WHERE instruction_id=? ORDER BY created_at ASC').all(req.params.id);
    res.json({ ...instr, updates, attachments });
  });

  app.put('/api/site_instructions/:id', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessSiteInstruction(req.user!, instr, 'update')) { res.status(403).json({ error: 'No access' }); return; }
    if (!['Draft','Assigned'].includes(instr.status)) { res.status(400).json({ error: 'Can only edit Draft or Assigned instructions' }); return; }
    const { title, description, priority, due_date, location, assigned_worker_id, assigned_supervisor_id } = req.body;
    db.prepare('UPDATE site_instructions SET title=COALESCE(?,title),description=COALESCE(?,description),priority=COALESCE(?,priority),due_date=COALESCE(?,due_date),location=COALESCE(?,location),assigned_worker_id=COALESCE(?,assigned_worker_id),assigned_supervisor_id=COALESCE(?,assigned_supervisor_id) WHERE id=?')
      .run(title||null, description||null, priority||null, due_date||null, location||null, assigned_worker_id||null, assigned_supervisor_id||null, req.params.id);
    writeAudit(req.user!.user_id, 'site_instructions', req.params.id, instr.project_id, 'update', instr, req.body);
    res.json(db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id));
  });

  function advanceInstruction(instrId: string, newStatus: string, userId: string, userName: string, updateType: string, content: string, extraFields?: Record<string,any>): { error?: string; ok?: boolean; instruction?: any } {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(instrId) as any;
    if (!instr) return { error: 'Instruction not found' };
    const now = new Date().toISOString();
    const allowed = ((WORKFLOW_STATUSES.site_instructions as any)[instr.status] || []) as string[];
    if (!allowed.includes(newStatus)) return { error: `Cannot move from ${instr.status} to ${newStatus}` };
    const updateData: any = { status: newStatus, ...(extraFields||{}) };
    const setClauses = Object.keys(updateData).map((k: string) => `${k}=?`).join(',');
    db.prepare(`UPDATE site_instructions SET ${setClauses} WHERE id=?`).run(...(Object.values(updateData) as any[]), instrId);
    db.prepare('INSERT INTO site_instruction_updates (id,instruction_id,user_id,user_name,update_type,content,old_status,new_status,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(crypto.randomUUID(), instrId, userId, userName, updateType, content, instr.status, newStatus, now);
    return { ok: true, instruction: db.prepare('SELECT * FROM site_instructions WHERE id=?').get(instrId) };
  }

  app.post('/api/site_instructions/:id/assign', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessSiteInstruction(req.user!, instr, 'assign')) { res.status(403).json({ error: 'No assignment authority' }); return; }
    const { assigned_worker_id, assigned_supervisor_id } = req.body;
    if (!assigned_worker_id) { res.status(400).json({ error: 'assigned_worker_id required' }); return; }
    const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(assigned_worker_id) as any;
    if (!worker || worker.status !== 'Active') { res.status(422).json({ error: 'Active worker required' }); return; }
    if (instr.site_id) {
      const assignmentDate = instr.due_date || zonedParts(new Date(), (db.prepare('SELECT timezone FROM sites WHERE id=?').get(instr.site_id) as any)?.timezone || 'UTC').date;
      if (!getActiveWorkerAssignment(worker.id, instr.project_id, instr.site_id, assignmentDate)) {
        res.status(422).json({ error: 'Worker is not assigned to this instruction site/project' }); return;
      }
    }
    db.prepare('UPDATE site_instructions SET assigned_worker_id=?,assigned_supervisor_id=?,issued_at=? WHERE id=?')
      .run(assigned_worker_id, assigned_supervisor_id||null, new Date().toISOString(), req.params.id);
    const result = advanceInstruction(req.params.id, 'Assigned', req.user!.user_id, req.user!.name, 'Assignment', `Assigned by ${req.user!.name}`);
    if (result.error) { res.status(400).json(result); return; }
    if (worker.user_id) createNotification(worker.user_id, instr.project_id, 'site_instructions', req.params.id, `Instruction Assigned: ${instr.title}`, `You have been assigned instruction ${instr.instruction_number}`);
    writeAudit(req.user!.user_id, 'site_instructions', req.params.id, instr.project_id, 'assign', instr, req.body);
    res.json(result.instruction);
  });

  app.post('/api/site_instructions/:id/acknowledge', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (req.user!.role !== 'Worker' || !canAccessSiteInstruction(req.user!, instr, 'update')) { res.status(403).json({ error: 'Not assigned to you' }); return; }
    const now = new Date().toISOString();
    db.prepare('UPDATE site_instructions SET acknowledged_at=? WHERE id=?').run(now, req.params.id);
    const result = advanceInstruction(req.params.id, 'Acknowledged', req.user!.user_id, req.user!.name, 'Acknowledgement', req.body.comment||'Acknowledged');
    if (result.error) { res.status(400).json(result); return; }
    writeAudit(req.user!.user_id, 'site_instructions', req.params.id, instr.project_id, 'acknowledge', instr, {});
    res.json(result.instruction);
  });

  app.post('/api/site_instructions/:id/start', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (req.user!.role !== 'Worker' || !canAccessSiteInstruction(req.user!, instr, 'update')) { res.status(403).json({ error: 'Not assigned to you' }); return; }
    db.prepare('UPDATE site_instructions SET started_at=? WHERE id=?').run(new Date().toISOString(), req.params.id);
    const result = advanceInstruction(req.params.id, 'In Progress', req.user!.user_id, req.user!.name, 'Started', req.body.comment||'Work started');
    if (result.error) { res.status(400).json(result); return; }
    res.json(result.instruction);
  });

  app.post('/api/site_instructions/:id/evidence', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (req.user!.role !== 'Worker' || !canAccessSiteInstruction(req.user!, instr, 'update')) { res.status(403).json({ error: 'Not assigned to you' }); return; }
    const { comment, attachment_name, attachment_data } = req.body;
    const now = new Date().toISOString();
    db.prepare('UPDATE site_instructions SET evidence_submitted_at=? WHERE id=?').run(now, req.params.id);
    if (attachment_name && attachment_data) {
      db.prepare('INSERT INTO site_instruction_attachments (id,instruction_id,uploaded_by,attachment_name,attachment_data,attachment_type,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(crypto.randomUUID(), req.params.id, req.user!.user_id, attachment_name, attachment_data, 'Evidence', now);
    }
    const result = advanceInstruction(req.params.id, 'Ready for Verification', req.user!.user_id, req.user!.name, 'Evidence', comment||'Evidence submitted');
    if (result.error) { res.status(400).json(result); return; }
    res.json(result.instruction);
  });

  app.post('/api/site_instructions/:id/verify', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessSiteInstruction(req.user!, instr, 'verify')) { res.status(403).json({ error: 'No verification authority' }); return; }
    const { action, comment } = req.body;
    if (!['Verified','In Progress'].includes(action)) { res.status(400).json({ error: 'action must be Verified or In Progress (reject back)' }); return; }
    const now = new Date().toISOString();
    if (action === 'Verified') db.prepare('UPDATE site_instructions SET verified_by=?,verified_at=? WHERE id=?').run(req.user!.user_id, now, req.params.id);
    const result = advanceInstruction(req.params.id, action, req.user!.user_id, req.user!.name, action === 'Verified' ? 'Verification' : 'Rejection', comment||`${action} by ${req.user!.name}`);
    if (result.error) { res.status(400).json(result); return; }
    writeAudit(req.user!.user_id, 'site_instructions', req.params.id, instr.project_id, action.toLowerCase(), instr, { action, comment });
    res.json(result.instruction);
  });

  app.post('/api/site_instructions/:id/close', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessSiteInstruction(req.user!, instr, 'close')) { res.status(403).json({ error: 'No close authority' }); return; }
    const now = new Date().toISOString();
    db.prepare('UPDATE site_instructions SET closed_at=? WHERE id=?').run(now, req.params.id);
    const result = advanceInstruction(req.params.id, 'Closed', req.user!.user_id, req.user!.name, 'Closure', req.body.comment||'Closed');
    if (result.error) { res.status(400).json(result); return; }
    writeAudit(req.user!.user_id, 'site_instructions', req.params.id, instr.project_id, 'close', instr, { comment: req.body.comment||null });
    res.json(result.instruction);
  });

  app.get('/api/site_instructions/:id/updates', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessSiteInstruction(req.user!, instr, 'view')) { res.status(403).json({ error: 'No access' }); return; }
    res.json(db.prepare('SELECT * FROM site_instruction_updates WHERE instruction_id=? ORDER BY created_at ASC').all(req.params.id));
  });

  app.post('/api/site_instructions/:id/updates', authRequired, (req, res) => {
    const instr = db.prepare('SELECT * FROM site_instructions WHERE id=?').get(req.params.id) as any;
    if (!instr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!canAccessSiteInstruction(req.user!, instr, 'update')) { res.status(403).json({ error: 'No access' }); return; }
    const { content, update_type } = req.body;
    if (!content) { res.status(400).json({ error: 'content required' }); return; }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO site_instruction_updates (id,instruction_id,user_id,user_name,update_type,content,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, req.params.id, req.user!.user_id, req.user!.name, update_type||'Comment', content, now);
    res.status(201).json(db.prepare('SELECT * FROM site_instruction_updates WHERE id=?').get(id));
  });

  

  // --- LEAVE MANAGEMENT ---
  app.get('/api/leave_types', authRequired, (req, res) => {
    res.json(db.prepare('SELECT * FROM leave_types ORDER BY name').all());
  });

  app.get('/api/leave_requests', authRequired, (req, res) => {
    if (!canView(req.user!, 'leave_requests')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    let where = '1=1';
    const params: any[] = [];
    if (projectId) {
      if (!hasProjectAccess(req.user!, projectId)) { res.status(403).json({ error: 'No project access' }); return; }
      where += ' AND lr.project_id=?'; params.push(projectId);
    }
    // Workers only see own requests
    if (req.user!.role === 'Worker') { where += ' AND lr.user_id=?'; params.push(req.user!.user_id); }
    // Supervisors see requests from supervised workers
    else if (req.user!.role === 'SiteSupervisor') {
      where += ' AND lr.worker_id IN (SELECT id FROM workers WHERE supervisor_id=?)'; params.push(req.user!.user_id);
    }
    const rows = db.prepare(`SELECT lr.*, lt.name as leave_type_name, lt.code as leave_type_code, lt.is_paid FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id WHERE ${where} ORDER BY lr.created_at DESC`).all(...params);
    res.json(rows);
  });

  app.post('/api/leave_requests', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'leave_requests')) { res.status(403).json({ error: 'No edit access' }); return; }
    const { project_id, leave_type_id, start_date, end_date, reason } = req.body;
    if (!project_id || !leave_type_id || !start_date || !end_date) { res.status(400).json({ error: 'project_id, leave_type_id, start_date, end_date required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    if (end_date < start_date) { res.status(422).json({ error: 'end_date cannot precede start_date' }); return; }
    const workerRow = getWorkerPrincipal(req.user!.user_id);
    if (!workerRow) { res.status(403).json({ error: 'Worker profile required for leave request' }); return; }
    const assignment = db.prepare("SELECT 1 FROM worker_assignments WHERE worker_id=? AND project_id=? AND status='Active' LIMIT 1").get(workerRow.id, project_id);
    if (!assignment) { res.status(403).json({ error: 'Active project assignment required for leave request' }); return; }
    const days = chargeableLeaveDays(workerRow.id, project_id, start_date, end_date);
    if (days <= 0) { res.status(422).json({ error: 'Requested range contains no chargeable working days' }); return; }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO leave_requests (id,project_id,worker_id,user_id,leave_type_id,start_date,end_date,days_requested,reason,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, project_id, workerRow.id, req.user!.user_id, leave_type_id, start_date, end_date, days, reason||null, 'Pending', now);
    const yr = new Date(start_date + 'T12:00:00Z').getUTCFullYear();
    db.prepare('INSERT INTO leave_balances (id,worker_id,user_id,leave_type_id,year,pending_days,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,leave_type_id,year) DO UPDATE SET pending_days=pending_days+?, updated_at=?')
      .run(crypto.randomUUID(), workerRow.id, req.user!.user_id, leave_type_id, yr, days, now, days, now);
    writeAudit(req.user!.user_id, 'leave_requests', id, project_id, 'submit', null, { ...req.body, chargeable_days: days });
    res.status(201).json(db.prepare('SELECT lr.*, lt.name as leave_type_name FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id WHERE lr.id=?').get(id));
  });

  app.get('/api/leave_requests/:id', authRequired, (req, res) => {
    if (!canView(req.user!, 'leave_requests')) { res.status(403).json({ error: 'No access' }); return; }
    const lr = db.prepare('SELECT lr.*, lt.name as leave_type_name FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id WHERE lr.id=?').get(req.params.id) as any;
    if (!lr) { res.status(404).json({ error: 'Not found' }); return; }
    if (req.user!.role === 'Worker' && lr.user_id !== req.user!.user_id) { res.status(403).json({ error: 'No access' }); return; }
    res.json(lr);
  });

  // Leave approval (blocks self-approval)
  app.post('/api/leave_requests/:id/approve', authRequired, (req, res) => {
    if (!['Admin','ProjectManager','SiteSupervisor'].includes(req.user!.role)) { res.status(403).json({ error: 'No approval authority' }); return; }
    const lr = db.prepare('SELECT * FROM leave_requests WHERE id=?').get(req.params.id) as any;
    if (!lr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, lr.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    if (lr.user_id === req.user!.user_id) { res.status(403).json({ error: 'Cannot approve own leave request' }); return; }
    if (req.user!.role === 'SiteSupervisor') {
      const supervised = lr.worker_id && db.prepare(
        "SELECT 1 FROM worker_assignments WHERE worker_id=? AND project_id=? AND supervisor_id=? AND status='Active' LIMIT 1"
      ).get(lr.worker_id, lr.project_id, req.user!.user_id);
      if (!supervised) { res.status(403).json({ error: 'Leave request is outside supervisor scope' }); return; }
    }
    if (lr.status !== 'Pending') { res.status(400).json({ error: 'Leave request is not pending' }); return; }
    const now = new Date().toISOString();
    db.prepare('UPDATE leave_requests SET status=?,approved_by=?,approved_at=?,reject_reason=NULL WHERE id=?')
      .run('Approved', req.user!.user_id, now, req.params.id);
    const yr = new Date(lr.start_date + 'T12:00:00Z').getUTCFullYear();
    db.prepare('UPDATE leave_balances SET pending_days=MAX(0,pending_days-?),taken_days=taken_days+?,balance_days=balance_days-?,updated_at=? WHERE user_id=? AND leave_type_id=? AND year=?')
      .run(lr.days_requested, lr.days_requested, lr.days_requested, now, lr.user_id, lr.leave_type_id, yr);
    createNotification(lr.user_id, lr.project_id, 'leave_requests', req.params.id, 'Leave Approved', `Your ${lr.days_requested}-day leave request has been approved`);
    writeAudit(req.user!.user_id, 'leave_requests', req.params.id, lr.project_id, 'approve', lr, { action: 'Approved' });
    res.json(db.prepare('SELECT * FROM leave_requests WHERE id=?').get(req.params.id));
  });

  app.post('/api/leave_requests/:id/reject', authRequired, (req, res) => {
    if (!['Admin','ProjectManager','SiteSupervisor'].includes(req.user!.role)) { res.status(403).json({ error: 'No approval authority' }); return; }
    const lr = db.prepare('SELECT * FROM leave_requests WHERE id=?').get(req.params.id) as any;
    if (!lr) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, lr.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    if (lr.user_id === req.user!.user_id) { res.status(403).json({ error: 'Cannot reject own leave request' }); return; }
    if (req.user!.role === 'SiteSupervisor') {
      const supervised = lr.worker_id && db.prepare(
        "SELECT 1 FROM worker_assignments WHERE worker_id=? AND project_id=? AND supervisor_id=? AND status='Active' LIMIT 1"
      ).get(lr.worker_id, lr.project_id, req.user!.user_id);
      if (!supervised) { res.status(403).json({ error: 'Leave request is outside supervisor scope' }); return; }
    }
    if (lr.status !== 'Pending') { res.status(400).json({ error: 'Leave request is not pending' }); return; }
    const { reject_reason } = req.body;
    const now = new Date().toISOString();
    db.prepare('UPDATE leave_requests SET status=?,approved_by=?,approved_at=?,reject_reason=? WHERE id=?')
      .run('Rejected', req.user!.user_id, now, reject_reason||null, req.params.id);
    const yr = new Date(lr.start_date + 'T12:00:00Z').getUTCFullYear();
    db.prepare('UPDATE leave_balances SET pending_days=MAX(0,pending_days-?),updated_at=? WHERE user_id=? AND leave_type_id=? AND year=?')
      .run(lr.days_requested, now, lr.user_id, lr.leave_type_id, yr);
    createNotification(lr.user_id, lr.project_id, 'leave_requests', req.params.id, 'Leave Rejected', `Your leave request was rejected. Reason: ${reject_reason||'Not specified'}`);
    writeAudit(req.user!.user_id, 'leave_requests', req.params.id, lr.project_id, 'reject', lr, { reject_reason: reject_reason||null });
    res.json(db.prepare('SELECT * FROM leave_requests WHERE id=?').get(req.params.id));
  });

  app.get('/api/leave_balances', authRequired, (req, res) => {
    if (!canView(req.user!, 'leave_requests')) { res.status(403).json({ error: 'No access' }); return; }
    let where = '1=1';
    const params: any[] = [];
    if (req.user!.role === 'Worker') { where += ' AND lb.user_id=?'; params.push(req.user!.user_id); }
    const year = req.query.year || new Date().getFullYear();
    where += ' AND lb.year=?'; params.push(year);
    const rows = db.prepare(`SELECT lb.*, lt.name as leave_type_name, lt.code FROM leave_balances lb JOIN leave_types lt ON lt.id=lb.leave_type_id WHERE ${where} ORDER BY lt.name`).all(...params);
    res.json(rows);
  });

  // --- PAYROLL (Admin & CommercialManager only) ---
  app.get('/api/payroll_profiles', authRequired, (req, res) => {
    if (!canAccessPayroll(req.user!)) { res.status(403).json({ error: 'No access to payroll financial data' }); return; }
    const workerId = req.query.worker_id as string;
    if (workerId) {
      const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(workerId) as any;
      if (!worker) { res.status(404).json({ error: 'Worker not found' }); return; }
      if (req.user!.role !== 'Admin' && !hasProjectAccess(req.user!, worker.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
      const profile = db.prepare('SELECT * FROM payroll_profiles WHERE worker_id=?').get(workerId);
      res.json(profile ? [profile] : []);
      return;
    }
    if (req.user!.role === 'Admin') {
      res.json(db.prepare('SELECT pp.*, w.name as worker_name, w.project_id FROM payroll_profiles pp JOIN workers w ON w.id=pp.worker_id ORDER BY w.name').all());
      return;
    }
    const scoped = projectScopeSql(req.user!, 'ALL', 'w.project_id');
    if (!scoped.where) { res.status(403).json({ error: 'No project access' }); return; }
    res.json(db.prepare(
      'SELECT pp.*, w.name as worker_name, w.project_id FROM payroll_profiles pp JOIN workers w ON w.id=pp.worker_id WHERE ' +
      scoped.where + ' ORDER BY w.name'
    ).all(...scoped.params));
  });

  app.post('/api/payroll_profiles', authRequired, (req, res) => {
    if (!canAccessPayroll(req.user!)) { res.status(403).json({ error: 'No access' }); return; }
    const { worker_id, basic_daily_rate, basic_monthly_rate, rate_type, currency, ot_multiplier, housing_allowance, transport_allowance, food_allowance, bank_account, bank_name, effective_from } = req.body;
    if (!worker_id) { res.status(400).json({ error: 'worker_id required' }); return; }
    const worker = db.prepare('SELECT * FROM workers WHERE id=?').get(worker_id) as any;
    if (!worker) { res.status(404).json({ error: 'Worker not found' }); return; }
    if (req.user!.role !== 'Admin' && !hasProjectAccess(req.user!, worker.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const numeric = [basic_daily_rate, basic_monthly_rate, ot_multiplier, housing_allowance, transport_allowance, food_allowance]
      .filter(v => v !== undefined && v !== null)
      .map(Number);
    if (numeric.some(v => !Number.isFinite(v) || v < 0)) { res.status(422).json({ error: 'Payroll rates and allowances must be non-negative numbers' }); return; }

    const existing = db.prepare('SELECT * FROM payroll_profiles WHERE worker_id=?').get(worker_id) as any;
    const id = existing?.id || crypto.randomUUID();
    const now = new Date().toISOString();
    if (existing) {
      db.prepare('UPDATE payroll_profiles SET basic_daily_rate=?,basic_monthly_rate=?,rate_type=?,currency=?,ot_multiplier=?,housing_allowance=?,transport_allowance=?,food_allowance=?,bank_account=?,bank_name=?,effective_from=?,updated_at=? WHERE worker_id=?')
        .run(Number(basic_daily_rate||0), Number(basic_monthly_rate||0), rate_type||'Daily', currency||'USD', Number(ot_multiplier??1.5), Number(housing_allowance||0), Number(transport_allowance||0), Number(food_allowance||0), bank_account||null, bank_name||null, effective_from||null, now, worker_id);
    } else {
      db.prepare('INSERT INTO payroll_profiles (id,worker_id,basic_daily_rate,basic_monthly_rate,rate_type,currency,ot_multiplier,housing_allowance,transport_allowance,food_allowance,bank_account,bank_name,effective_from,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, worker_id, Number(basic_daily_rate||0), Number(basic_monthly_rate||0), rate_type||'Daily', currency||'USD', Number(ot_multiplier??1.5), Number(housing_allowance||0), Number(transport_allowance||0), Number(food_allowance||0), bank_account||null, bank_name||null, effective_from||null, now, now);
    }
    writeAudit(req.user!.user_id, 'payroll_profiles', id, worker.project_id, existing ? 'update' : 'create', existing, { worker_id, rate_type, currency });
    res.status(existing ? 200 : 201).json(db.prepare('SELECT * FROM payroll_profiles WHERE worker_id=?').get(worker_id));
  });

  app.put('/api/payroll_profiles/:id', authRequired, (req, res) => {
    if (!canAccessPayroll(req.user!)) { res.status(403).json({ error: 'No access' }); return; }
    const profile = db.prepare('SELECT pp.*, w.project_id FROM payroll_profiles pp JOIN workers w ON w.id=pp.worker_id WHERE pp.id=?').get(req.params.id) as any;
    if (!profile) { res.status(404).json({ error: 'Not found' }); return; }
    if (req.user!.role !== 'Admin' && !hasProjectAccess(req.user!, profile.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const now = new Date().toISOString();
    const { basic_daily_rate, basic_monthly_rate, rate_type, currency, ot_multiplier, housing_allowance, transport_allowance, food_allowance, bank_account, bank_name } = req.body;
    const numeric = [basic_daily_rate, basic_monthly_rate, ot_multiplier, housing_allowance, transport_allowance, food_allowance]
      .filter(v => v !== undefined && v !== null)
      .map(Number);
    if (numeric.some(v => !Number.isFinite(v) || v < 0)) { res.status(422).json({ error: 'Payroll rates and allowances must be non-negative numbers' }); return; }
    db.prepare('UPDATE payroll_profiles SET basic_daily_rate=COALESCE(?,basic_daily_rate),basic_monthly_rate=COALESCE(?,basic_monthly_rate),rate_type=COALESCE(?,rate_type),currency=COALESCE(?,currency),ot_multiplier=COALESCE(?,ot_multiplier),housing_allowance=COALESCE(?,housing_allowance),transport_allowance=COALESCE(?,transport_allowance),food_allowance=COALESCE(?,food_allowance),bank_account=COALESCE(?,bank_account),bank_name=COALESCE(?,bank_name),updated_at=? WHERE id=?')
      .run(basic_daily_rate??null, basic_monthly_rate??null, rate_type||null, currency||null, ot_multiplier??null, housing_allowance??null, transport_allowance??null, food_allowance??null, bank_account||null, bank_name||null, now, req.params.id);
    writeAudit(req.user!.user_id, 'payroll_profiles', req.params.id, profile.project_id, 'update', profile, { rate_type, currency });
    res.json(db.prepare('SELECT * FROM payroll_profiles WHERE id=?').get(req.params.id));
  });

  app.get('/api/payroll_periods', authRequired, (req, res) => {
    if (!canAccessPayroll(req.user!)) { res.status(403).json({ error: 'No access to payroll financial data' }); return; }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId);
    if (!where) { res.status(403).json({ error: 'No project access' }); return; }
    res.json(db.prepare(`SELECT * FROM payroll_periods WHERE ${where} ORDER BY period_start DESC`).all(...params));
  });

  app.post('/api/payroll_periods', authRequired, (req, res) => {
    if (!['Admin','CommercialManager'].includes(req.user!.role)) { res.status(403).json({ error: 'No access' }); return; }
    const { project_id, period_name, period_start, period_end } = req.body;
    if (!project_id || !period_name || !period_start || !period_end) { res.status(400).json({ error: 'project_id, period_name, period_start, period_end required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO payroll_periods (id,project_id,period_name,period_start,period_end,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, project_id, period_name, period_start, period_end, 'Open', req.user!.user_id, now);
    res.status(201).json(db.prepare('SELECT * FROM payroll_periods WHERE id=?').get(id));
  });

  app.get('/api/payroll_periods/:id', authRequired, (req, res) => {
    if (!canAccessPayroll(req.user!)) { res.status(403).json({ error: 'No access to payroll financial data' }); return; }
    const period = db.prepare('SELECT * FROM payroll_periods WHERE id=?').get(req.params.id) as any;
    if (!period) { res.status(404).json({ error: 'Not found' }); return; }
    if (!hasProjectAccess(req.user!, period.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const entries = db.prepare('SELECT pe.*, w.name as worker_name, w.trade, w.employee_id FROM payroll_entries pe JOIN workers w ON w.id=pe.worker_id WHERE pe.payroll_period_id=? ORDER BY w.name').all(req.params.id);
    const adjustments = db.prepare('SELECT * FROM payroll_adjustments WHERE payroll_period_id=?').all(req.params.id);
    res.json({ ...period, entries, adjustments });
  });

  app.post('/api/payroll_periods/:id/lock', authRequired, (req, res) => {
    if (req.user!.role !== 'Admin') { res.status(403).json({ error: 'Only Admin can lock payroll' }); return; }
    const period = db.prepare('SELECT * FROM payroll_periods WHERE id=?').get(req.params.id) as any;
    if (!period) { res.status(404).json({ error: 'Not found' }); return; }
    if (period.status === 'Locked') { res.status(400).json({ error: 'Already locked' }); return; }
    const now = new Date().toISOString();
    db.prepare('UPDATE payroll_periods SET status=?,locked_by=?,locked_at=? WHERE id=?').run('Locked', req.user!.user_id, now, req.params.id);
    writeAudit(req.user!.user_id, 'payroll_periods', req.params.id, period.project_id, 'lock', period, { locked_at: now });
    res.json(db.prepare('SELECT * FROM payroll_periods WHERE id=?').get(req.params.id));
  });

  // Compute payroll entries from attendance data
  app.post('/api/payroll_periods/:id/compute', authRequired, (req, res) => {
    if (!canAccessPayroll(req.user!)) { res.status(403).json({ error: 'No access' }); return; }
    const period = db.prepare('SELECT * FROM payroll_periods WHERE id=?').get(req.params.id) as any;
    if (!period) { res.status(404).json({ error: 'Not found' }); return; }
    if (period.status === 'Locked') { res.status(400).json({ error: 'Period is locked' }); return; }
    if (!hasProjectAccess(req.user!, period.project_id)) { res.status(403).json({ error: 'No project access' }); return; }

    const attendance = db.prepare(
      'SELECT a.*, w.id as wid FROM attendance a JOIN workers w ON w.id=a.worker_id ' +
      'WHERE a.project_id=? AND a.work_date>=? AND a.work_date<=? AND a.punch_out IS NOT NULL'
    ).all(period.project_id, period.period_start, period.period_end) as any[];

    const byWorker = new Map<string, any[]>();
    for (const row of attendance) {
      if (!row.wid) continue;
      if (!byWorker.has(row.wid)) byWorker.set(row.wid, []);
      byWorker.get(row.wid)!.push(row);
    }

    const paidLeaveCandidates = db.prepare(
      "SELECT DISTINCT lr.worker_id FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id " +
      "WHERE lr.project_id=? AND lr.status='Approved' AND lt.is_paid=1 AND lr.start_date<=? AND lr.end_date>=? AND lr.worker_id IS NOT NULL"
    ).all(period.project_id, period.period_end, period.period_start) as any[];
    for (const row of paidLeaveCandidates) {
      if (!byWorker.has(row.worker_id)) byWorker.set(row.worker_id, []);
    }

    const now = new Date().toISOString();
    let totalGross = 0;
    let totalNet = 0;
    let workersComputed = 0;
    for (const [workerId, rows] of byWorker) {
      const profile = db.prepare('SELECT * FROM payroll_profiles WHERE worker_id=?').get(workerId) as any;
      if (!profile) continue;

      const elapsedMinutes = rows.reduce((s: number, r: any) => s + Number(r.elapsed_minutes || 0), 0);
      const breakMinutes = rows.reduce((s: number, r: any) => s + Number(r.break_minutes || 0), 0);
      const regularMinutes = rows.reduce((s: number, r: any) => s + Number(r.regular_minutes || Math.round(Number(r.regular_hours || 0) * 60)), 0);
      const rawOtMinutes = rows.reduce((s: number, r: any) => s + Number(r.raw_overtime_minutes || Math.round(Number(r.overtime_hours || 0) * 60)), 0);
      const approvedOtMinutes = rows.reduce((s: number, r: any) => {
        if (r.ot_status !== 'Approved') return s;
        return s + Number(r.approved_overtime_minutes || r.raw_overtime_minutes || Math.round(Number(r.overtime_hours || 0) * 60));
      }, 0);

      const paidLeaves = db.prepare(
        "SELECT lr.start_date,lr.end_date FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id " +
        "WHERE lr.worker_id=? AND lr.project_id=? AND lr.status='Approved' AND lt.is_paid=1 AND lr.start_date<=? AND lr.end_date>=?"
      ).all(workerId, period.project_id, period.period_end, period.period_start) as any[];
      let paidLeaveDays = 0;
      for (const leave of paidLeaves) {
        const clippedStart = leave.start_date < period.period_start ? period.period_start : leave.start_date;
        const clippedEnd = leave.end_date > period.period_end ? period.period_end : leave.end_date;
        paidLeaveDays += chargeableLeaveDays(workerId, period.project_id, clippedStart, clippedEnd);
      }

      const regularHours = regularMinutes / 60;
      const approvedOvertimeHours = approvedOtMinutes / 60;
      const standardDailyMinutes = 480;
      const regularDays = regularMinutes / standardDailyMinutes + paidLeaveDays;
      const basicPay = profile.rate_type === 'Daily' ? regularDays * Number(profile.basic_daily_rate || 0) : Number(profile.basic_monthly_rate || 0);
      const hourlyBase = Number(profile.basic_daily_rate || 0) / 8;
      const overtimePay = approvedOvertimeHours * hourlyBase * Number(profile.ot_multiplier || 1.5);
      const grossPay = basicPay + overtimePay + Number(profile.housing_allowance || 0) + Number(profile.transport_allowance || 0) + Number(profile.food_allowance || 0);
      const netPay = grossPay;

      totalGross += grossPay;
      totalNet += netPay;
      workersComputed++;

      db.prepare(
        'INSERT INTO payroll_entries (id,payroll_period_id,worker_id,project_id,regular_days,regular_hours,overtime_hours,leave_days,' +
        'basic_pay,overtime_pay,housing_allowance,transport_allowance,food_allowance,gross_pay,net_pay,currency,computed_at,created_at,' +
        'elapsed_minutes,regular_minutes,break_minutes,raw_overtime_minutes,approved_overtime_minutes) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(payroll_period_id,worker_id) DO UPDATE SET regular_days=excluded.regular_days,regular_hours=excluded.regular_hours,' +
        'overtime_hours=excluded.overtime_hours,leave_days=excluded.leave_days,basic_pay=excluded.basic_pay,overtime_pay=excluded.overtime_pay,' +
        'housing_allowance=excluded.housing_allowance,transport_allowance=excluded.transport_allowance,food_allowance=excluded.food_allowance,' +
        'gross_pay=excluded.gross_pay,net_pay=excluded.net_pay,currency=excluded.currency,computed_at=excluded.computed_at,' +
        'elapsed_minutes=excluded.elapsed_minutes,regular_minutes=excluded.regular_minutes,break_minutes=excluded.break_minutes,' +
        'raw_overtime_minutes=excluded.raw_overtime_minutes,approved_overtime_minutes=excluded.approved_overtime_minutes'
      ).run(
        crypto.randomUUID(), period.id, workerId, period.project_id,
        Math.round(regularDays * 100) / 100,
        Math.round(regularHours * 100) / 100,
        Math.round(approvedOvertimeHours * 100) / 100,
        paidLeaveDays,
        Math.round(basicPay * 100) / 100,
        Math.round(overtimePay * 100) / 100,
        Number(profile.housing_allowance || 0),
        Number(profile.transport_allowance || 0),
        Number(profile.food_allowance || 0),
        Math.round(grossPay * 100) / 100,
        Math.round(netPay * 100) / 100,
        profile.currency || 'USD',
        now, now,
        elapsedMinutes, regularMinutes, breakMinutes, rawOtMinutes, approvedOtMinutes
      );
    }

    db.prepare('UPDATE payroll_periods SET total_gross=?,total_net=? WHERE id=?')
      .run(Math.round(totalGross*100)/100, Math.round(totalNet*100)/100, period.id);
    writeAudit(req.user!.user_id, 'payroll_periods', period.id, period.project_id, 'compute', null, {
      workers: workersComputed, total_gross: totalGross, approved_ot_only: true
    });
    res.json({ ok: true, workers_computed: workersComputed, total_gross: Math.round(totalGross*100)/100, total_net: Math.round(totalNet*100)/100 });
  });

  

  // Payroll adjustments (bonuses, deductions)
  app.post('/api/payroll_adjustments', authRequired, (req, res) => {
    if (!canAccessPayroll(req.user!)) { res.status(403).json({ error: 'No access' }); return; }
    const { payroll_entry_id, payroll_period_id, worker_id, type, description, amount, is_deduction } = req.body;
    if (!payroll_entry_id || !payroll_period_id || !worker_id || !type || !description || amount == null) {
      res.status(400).json({ error: 'Missing required fields' }); return;
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0) { res.status(422).json({ error: 'amount must be a non-negative number' }); return; }
    const period = db.prepare('SELECT * FROM payroll_periods WHERE id=?').get(payroll_period_id) as any;
    if (!period) { res.status(404).json({ error: 'Payroll period not found' }); return; }
    if (period.status === 'Locked') { res.status(400).json({ error: 'Period is locked' }); return; }
    if (req.user!.role !== 'Admin' && !hasProjectAccess(req.user!, period.project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const entry = db.prepare('SELECT * FROM payroll_entries WHERE id=? AND payroll_period_id=? AND worker_id=?').get(payroll_entry_id, payroll_period_id, worker_id) as any;
    if (!entry) { res.status(422).json({ error: 'Payroll entry does not match period and worker' }); return; }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO payroll_adjustments (id,payroll_entry_id,payroll_period_id,worker_id,type,description,amount,is_deduction,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, payroll_entry_id, payroll_period_id, worker_id, type, description, numericAmount, is_deduction?1:0, req.user!.user_id, now);
    const delta = is_deduction ? -numericAmount : numericAmount;
    db.prepare('UPDATE payroll_entries SET deductions=deductions+?,net_pay=net_pay+?,gross_pay=gross_pay+? WHERE id=?')
      .run(is_deduction?numericAmount:0, delta, is_deduction?0:delta, payroll_entry_id);
    writeAudit(req.user!.user_id, 'payroll_adjustments', id, period.project_id, 'create', null, { payroll_entry_id, worker_id, type, amount: numericAmount, is_deduction: Boolean(is_deduction) });
    res.status(201).json(db.prepare('SELECT * FROM payroll_adjustments WHERE id=?').get(id));
  });

  // --- WORKFORCE REPORTS ---
  app.get('/api/reports/workforce/daily', authRequired, (req, res) => {
    if (!canView(req.user!, 'workforce')) { res.status(403).json({ error: 'No access' }); return; }
    const { project_id, date, site_id } = req.query as any;
    if (!project_id) { res.status(400).json({ error: 'project_id required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const reportDate = date || new Date().toISOString().split('T')[0];
    let where = 'a.project_id=? AND a.work_date=?';
    const params: any[] = [project_id, reportDate];
    if (site_id) { where += ' AND a.site_id=?'; params.push(site_id); }
    const attendance = db.prepare(`SELECT a.*, w.name as worker_name, w.trade, w.employee_id, w.employment_type, c.name as company_name, s.name as site_name FROM attendance a LEFT JOIN workers w ON w.id=a.worker_id LEFT JOIN companies c ON c.id=w.company_id LEFT JOIN sites s ON s.id=a.site_id WHERE ${where} ORDER BY w.name`).all(...params);
    const summary = {
      date: reportDate,
      total_present: (attendance as any[]).filter(r => r.punch_in).length,
      total_completed: (attendance as any[]).filter(r => r.punch_out).length,
      total_regular_hours: Math.round((attendance as any[]).reduce((s: number, r: any) => s+(r.regular_hours||0), 0)*100)/100,
      total_overtime_hours: Math.round((attendance as any[]).reduce((s: number, r: any) => s+(r.overtime_hours||0), 0)*100)/100,
      geofence_violations: (attendance as any[]).filter(r => r.punch_in_geofence_status === 'Outside Geofence').length,
    };
    res.json({ summary, records: attendance });
  });

  app.get('/api/reports/workforce/payroll-hours', authRequired, (req, res) => {
    if (!['Admin','CommercialManager','ProjectManager'].includes(req.user!.role)) { res.status(403).json({ error: 'No access' }); return; }
    const { project_id, period_start, period_end } = req.query as any;
    if (!project_id || !period_start || !period_end) { res.status(400).json({ error: 'project_id, period_start, period_end required' }); return; }
    if (!hasProjectAccess(req.user!, project_id)) { res.status(403).json({ error: 'No project access' }); return; }
    const rows = db.prepare(`SELECT w.id as worker_id, w.name as worker_name, w.trade, w.employee_id, SUM(a.regular_hours) as total_regular_hours, SUM(a.overtime_hours) as total_overtime_hours, COUNT(a.id) as days_worked FROM attendance a JOIN workers w ON w.user_id=a.user_id WHERE a.project_id=? AND a.work_date>=? AND a.work_date<=? AND a.punch_out IS NOT NULL GROUP BY w.id ORDER BY w.name`).all(project_id, period_start, period_end);
    res.json({ project_id, period_start, period_end, workers: rows });
  });

  // =====================================================================
  // PROJECT MANAGEMENT CORE & CONTROL TOWER API (V1.3)
  // =====================================================================

  // --- PROJECT CONTROL TOWER & DETERMINISTIC ATTENTION ENGINE ---
  app.get('/api/control-tower', authRequired, (req, res) => {
    if (!canView(req.user!, 'dashboard') && !canView(req.user!, 'tasks')) {
      res.status(403).json({ error: 'No access' });
      return;
    }
    const projectId = req.query.project_id as string;
    const { where: mainWhere } = projectScopeSql(req.user!, projectId);
    if (!mainWhere) {
      res.status(403).json({ error: 'No project access' });
      return;
    }

    const today = new Date().toISOString().split('T')[0];

    // 1. Manpower Radar: Live Present Headcount vs Scheduled/Expected
    const attScope = projectScopeSql(req.user!, projectId, 'a.project_id');
    const presentWorkers = db.prepare(`
      SELECT a.*, w.name as worker_name, w.trade as worker_trade, w.company_id as worker_company_id, c.name as company_name, s.name as site_name
      FROM attendance a
      LEFT JOIN workers w ON w.id = a.worker_id
      LEFT JOIN companies c ON c.id = w.company_id
      LEFT JOIN sites s ON s.id = a.site_id
      WHERE a.work_date = ? AND a.punch_out IS NULL AND ${attScope.where}
    `).all(today, ...attScope.params) as any[];

    // Expected staffing today from worker_assignments
    const assignScope = projectScopeSql(req.user!, projectId, 'wa.project_id');
    const activeAssignments = db.prepare(`
      SELECT wa.*, w.name as worker_name, w.trade, w.company_id, c.name as company_name
      FROM worker_assignments wa
      JOIN workers w ON w.id = wa.worker_id
      LEFT JOIN companies c ON c.id = w.company_id
      WHERE wa.status = 'Active' AND wa.start_date <= ? AND (wa.end_date IS NULL OR wa.end_date >= ?)
      AND ${assignScope.where}
    `).all(today, today, ...assignScope.params) as any[];

    // Present count by trade
    const presentByTrade: Record<string, number> = {};
    for (const w of presentWorkers) {
      const t = w.worker_trade || 'General';
      presentByTrade[t] = (presentByTrade[t] || 0) + 1;
    }

    // Expected count by trade
    const expectedByTrade: Record<string, number> = {};
    for (const w of activeAssignments) {
      const t = w.trade || 'General';
      expectedByTrade[t] = (expectedByTrade[t] || 0) + 1;
    }

    // 2. Deterministic Attention Engine Queue
    const attentionItems: any[] = [];

    // Attention Type A: Critical Blocked Tasks (Severity: CRITICAL)
    const taskScope = projectScopeSql(req.user!, projectId, 't.project_id');
    const blockedTasks = db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.status = 'Blocked' AND ${taskScope.where}
      ORDER BY t.end ASC
    `).all(...taskScope.params) as any[];

    for (const t of blockedTasks) {
      attentionItems.push({
        id: `blocker-task-${t.id}`,
        type: 'BLOCKED_TASK',
        severity: t.priority === 'Critical' || t.priority === 'High' ? 'CRITICAL' : 'HIGH',
        title: `Task Blocked: ${t.title}`,
        subtitle: `Trade: ${t.trade || 'General'} • WBS: ${t.wbs_code || 'N/A'}`,
        project_id: t.project_id,
        project_name: t.project_name,
        target_id: t.id,
        target_module: 'tasks',
        created_at: t.start,
        action_label: 'View Blocker',
      });
    }

    // Attention Type B: Urgent Open Site Instructions
    const instrScope = projectScopeSql(req.user!, projectId, 'si.project_id');
    const urgentInstructions = db.prepare(`
      SELECT si.*, p.name as project_name
      FROM site_instructions si
      JOIN projects p ON p.id = si.project_id
      WHERE si.status NOT IN ('Closed', 'Verified') AND si.priority IN ('Critical', 'Urgent', 'High')
      AND ${instrScope.where}
      ORDER BY si.created_at ASC
    `).all(...instrScope.params) as any[];

    for (const si of urgentInstructions) {
      attentionItems.push({
        id: `instruction-${si.id}`,
        type: 'URGENT_INSTRUCTION',
        severity: si.priority === 'Critical' || si.priority === 'Urgent' ? 'CRITICAL' : 'HIGH',
        title: `Site Instruction: ${si.title}`,
        subtitle: `Status: ${si.status} • Priority: ${si.priority}`,
        project_id: si.project_id,
        project_name: si.project_name,
        target_id: si.id,
        target_module: 'site-instructions',
        created_at: si.created_at,
        action_label: 'Open Instruction',
      });
    }

    // Attention Type C: Pending Overtime Approvals
    if (['Admin', 'ProjectManager', 'SiteSupervisor'].includes(req.user!.role)) {
      const otScope = projectScopeSql(req.user!, projectId, 'a.project_id');
      const pendingOT = db.prepare(`
        SELECT a.*, w.name as worker_name, w.trade, p.name as project_name
        FROM attendance a
        JOIN workers w ON w.id = a.worker_id
        JOIN projects p ON p.id = a.project_id
        WHERE a.ot_status = 'Pending' AND a.raw_overtime_minutes > 0
        AND ${otScope.where}
        ORDER BY a.work_date DESC LIMIT 15
      `).all(...otScope.params) as any[];

      for (const ot of pendingOT) {
        attentionItems.push({
          id: `ot-${ot.id}`,
          type: 'PENDING_OVERTIME',
          severity: 'HIGH',
          title: `Overtime Pending: ${ot.worker_name} (${Math.round((ot.raw_overtime_minutes || 0) / 60 * 10) / 10}h)`,
          subtitle: `Date: ${ot.work_date} • Trade: ${ot.trade || 'General'}`,
          project_id: ot.project_id,
          project_name: ot.project_name,
          target_id: ot.id,
          target_module: 'attendance-exceptions',
          created_at: ot.work_date,
          action_label: 'Review OT',
        });
      }
    }

    // Attention Type D: Pending Leave Requests
    if (['Admin', 'ProjectManager', 'SiteSupervisor'].includes(req.user!.role)) {
      const leaveScope = projectScopeSql(req.user!, projectId, 'lr.project_id');
      const pendingLeave = db.prepare(`
        SELECT lr.*, w.name as worker_name, lt.name as leave_type_name, p.name as project_name
        FROM leave_requests lr
        JOIN workers w ON w.id = lr.worker_id
        JOIN leave_types lt ON lt.id = lr.leave_type_id
        JOIN projects p ON p.id = lr.project_id
        WHERE lr.status = 'Pending' AND ${leaveScope.where}
        ORDER BY lr.start_date ASC LIMIT 10
      `).all(...leaveScope.params) as any[];

      for (const lr of pendingLeave) {
        attentionItems.push({
          id: `leave-${lr.id}`,
          type: 'PENDING_LEAVE',
          severity: 'MEDIUM',
          title: `Leave Approval: ${lr.worker_name} (${lr.leave_type_name})`,
          subtitle: `${lr.start_date} to ${lr.end_date} (${lr.days_requested} days)`,
          project_id: lr.project_id,
          project_name: lr.project_name,
          target_id: lr.id,
          target_module: 'leave-approvals',
          created_at: lr.created_at,
          action_label: 'Review Leave',
        });
      }
    }

    // Attention Type E: Overdue Tasks (end < today and progress < 100)
    const overdueScope = projectScopeSql(req.user!, projectId, 't.project_id');
    const overdueTasks = db.prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.end < ? AND (t.progress < 100 OR t.progress IS NULL) AND t.status != 'Completed'
      AND ${overdueScope.where}
      ORDER BY t.end ASC LIMIT 15
    `).all(today, ...overdueScope.params) as any[];

    for (const ot of overdueTasks) {
      attentionItems.push({
        id: `overdue-task-${ot.id}`,
        type: 'OVERDUE_TASK',
        severity: ot.priority === 'Critical' ? 'CRITICAL' : 'HIGH',
        title: `Overdue Task: ${ot.title} (${ot.progress || 0}%)`,
        subtitle: `Due: ${ot.end} • Trade: ${ot.trade || 'General'}`,
        project_id: ot.project_id,
        project_name: ot.project_name,
        target_id: ot.id,
        target_module: 'tasks',
        created_at: ot.end,
        action_label: 'View Task',
      });
    }

    // Sort attention items: CRITICAL first, then HIGH, then MEDIUM
    const severityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    attentionItems.sort((a, b) => (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99));

    const radar = {
      present_count: presentWorkers.length,
      expected_count: activeAssignments.length,
      variance_percent: activeAssignments.length > 0
        ? Math.round(((presentWorkers.length - activeAssignments.length) / activeAssignments.length) * 100)
        : 0,
      present_by_trade: presentByTrade,
      expected_by_trade: expectedByTrade,
      present_workers: presentWorkers.slice(0, 20),
    };

    res.json({
      today,
      radar,
      attention_items: attentionItems,
      metrics: {
        total_blocked_tasks: blockedTasks.length,
        total_urgent_instructions: urgentInstructions.length,
        total_overdue_tasks: overdueTasks.length,
        total_attention_items: attentionItems.length,
      },
    });
  });

  // --- 2-WEEK LOOKAHEAD SCHEDULE & DEPENDENCY ENGINE ---
  app.get('/api/tasks/lookahead', authRequired, (req, res) => {
    if (!canView(req.user!, 'tasks')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId, 't.project_id');
    if (!where) { res.status(403).json({ error: 'No project access' }); return; }

    const days = parseInt(req.query.days as string) || 14;
    const startDate = (req.query.start_date as string) || new Date().toISOString().split('T')[0];
    const targetDateObj = new Date(startDate);
    targetDateObj.setDate(targetDateObj.getDate() + days);
    const endDate = targetDateObj.toISOString().split('T')[0];

    const tasks = db.prepare(`
      SELECT t.*, p.name as project_name, w.name as assigned_worker_name, wp.name as work_package_name
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      LEFT JOIN workers w ON w.id = t.assigned_worker_id
      LEFT JOIN work_packages wp ON wp.id = t.work_package_id
      WHERE t.status != 'Completed'
        AND t.start <= ?
        AND t.end >= ?
        AND ${where}
      ORDER BY t.start ASC, t.priority DESC
    `).all(endDate, startDate, ...params) as any[];

    const taskIds = tasks.map(t => t.id);
    const dependencies = taskIds.length > 0
      ? db.prepare(`
          SELECT d.*, pred.title as predecessor_title, pred.status as predecessor_status, pred.progress as predecessor_progress, pred.end as predecessor_end
          FROM dependencies d
          LEFT JOIN tasks pred ON pred.id = d.predecessor_task_id
          WHERE d.task_id IN (${taskIds.map(() => '?').join(',')})
        `).all(...taskIds) as any[]
      : [];

    const blockers = taskIds.length > 0
      ? db.prepare(`
          SELECT task_id, COUNT(*) as active_blockers
          FROM task_blockers
          WHERE task_id IN (${taskIds.map(() => '?').join(',')}) AND status = 'Active'
          GROUP BY task_id
        `).all(...taskIds) as any[]
      : [];

    const blockerMap = new Map(blockers.map(b => [b.task_id, b.active_blockers]));

    const depMap = new Map<string, any[]>();
    for (const d of dependencies) {
      if (!depMap.has(d.task_id)) depMap.set(d.task_id, []);
      depMap.get(d.task_id)!.push(d);
    }

    const today = new Date().toISOString().split('T')[0];
    const enrichedTasks = tasks.map(t => {
      const taskDeps = depMap.get(t.id) || [];
      const activeBlockerCount = blockerMap.get(t.id) || 0;

      const riskyPredecessors = taskDeps.filter(d =>
        d.predecessor_status === 'Blocked' ||
        (d.predecessor_end < today && (d.predecessor_progress || 0) < 100 && d.predecessor_status !== 'Completed')
      );

      const hasRisk = riskyPredecessors.length > 0;

      return {
        ...t,
        active_blocker_count: activeBlockerCount,
        predecessor_risk: hasRisk,
        risky_predecessors: riskyPredecessors.map(rp => ({
          predecessor_id: rp.predecessor_task_id,
          title: rp.predecessor_title,
          status: rp.predecessor_status,
          end: rp.predecessor_end,
          progress: rp.predecessor_progress,
        })),
        dependencies_count: taskDeps.length,
      };
    });

    res.json({
      start_date: startDate,
      end_date: endDate,
      window_days: days,
      tasks: enrichedTasks,
      metrics: {
        total_lookahead_tasks: enrichedTasks.length,
        blocked_tasks: enrichedTasks.filter(t => t.status === 'Blocked' || t.active_blocker_count > 0).length,
        predecessor_risk_tasks: enrichedTasks.filter(t => t.predecessor_risk).length,
        in_progress_tasks: enrichedTasks.filter(t => t.status === 'In Progress').length,
        not_started_tasks: enrichedTasks.filter(t => t.status === 'Not Started').length,
      }
    });
  });

  // --- TASK BLOCKERS REGISTER & LIFECYCLE ---
  app.get('/api/blockers', authRequired, (req, res) => {
    if (!canView(req.user!, 'tasks')) { res.status(403).json({ error: 'No access' }); return; }
    const projectId = req.query.project_id as string;
    const { where, params } = projectScopeSql(req.user!, projectId, 'b.project_id');
    if (!where) { res.status(403).json({ error: 'No project access' }); return; }

    const taskId = req.query.task_id as string;
    let sql = `
      SELECT b.*, t.title as task_title, t.trade as task_trade, p.name as project_name
      FROM task_blockers b
      JOIN tasks t ON t.id = b.task_id
      JOIN projects p ON p.id = b.project_id
      WHERE ${where}
    `;
    const qParams = [...params];
    if (taskId) {
      sql += ' AND b.task_id = ?';
      qParams.push(taskId);
    }
    sql += " ORDER BY CASE WHEN b.status = 'Active' THEN 0 ELSE 1 END, b.created_at DESC";

    const rows = db.prepare(sql).all(...qParams);
    res.json(rows);
  });

  app.get('/api/tasks/:id/blockers', authRequired, (req, res) => {
    if (!canView(req.user!, 'tasks')) { res.status(403).json({ error: 'No access' }); return; }
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id) as any;
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    if (!hasProjectAccess(req.user!, task.project_id)) { res.status(403).json({ error: 'No access' }); return; }

    const blockers = db.prepare('SELECT * FROM task_blockers WHERE task_id=? ORDER BY created_at DESC').all(req.params.id);
    res.json(blockers);
  });

  app.post('/api/tasks/:id/blockers', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'tasks')) { res.status(403).json({ error: 'No edit access' }); return; }
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id) as any;
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    if (!hasProjectAccess(req.user!, task.project_id)) { res.status(403).json({ error: 'No access' }); return; }

    const { blocker_type, description, blocking_trade, impact_days } = req.body;
    if (!description) { res.status(400).json({ error: 'description is required' }); return; }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO task_blockers (id, task_id, project_id, blocker_type, description, blocking_trade, impact_days, status, reported_by, reported_by_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?)
    `).run(
      id,
      task.id,
      task.project_id,
      blocker_type || 'Trade Interface',
      description,
      blocking_trade || null,
      impact_days ? Number(impact_days) : 1,
      req.user!.user_id,
      req.user!.name || req.user!.email || 'User',
      now
    );

    // Update task status to Blocked
    db.prepare("UPDATE tasks SET status='Blocked' WHERE id=?").run(task.id);

    try {
      db.prepare("INSERT INTO task_status_history (id, task_id, from_status, to_status, changed_by, notes, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(crypto.randomUUID(), task.id, task.status, 'Blocked', req.user!.user_id, `Blocker raised: ${description}`, now);
    } catch {}

    writeAudit(req.user!.user_id, 'task_blockers', id, task.project_id, 'create', null, { task_id: task.id, description, blocker_type });

    res.status(201).json(db.prepare('SELECT * FROM task_blockers WHERE id=?').get(id));
  });

  app.post('/api/tasks/:id/blockers/:blockerId/resolve', authRequired, (req, res) => {
    if (!canEdit(req.user!, 'tasks')) { res.status(403).json({ error: 'No edit access' }); return; }
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id) as any;
    if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
    if (!hasProjectAccess(req.user!, task.project_id)) { res.status(403).json({ error: 'No access' }); return; }

    const blocker = db.prepare('SELECT * FROM task_blockers WHERE id=? AND task_id=?').get(req.params.blockerId, req.params.id) as any;
    if (!blocker) { res.status(404).json({ error: 'Blocker not found' }); return; }

    const { resolution_notes } = req.body;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE task_blockers
      SET status='Resolved', resolved_by=?, resolved_by_name=?, resolution_notes=?, resolved_at=?
      WHERE id=?
    `).run(
      req.user!.user_id,
      req.user!.name || req.user!.email || 'User',
      resolution_notes || 'Blocker resolved',
      now,
      blocker.id
    );

    const remainingActive = db.prepare("SELECT COUNT(*) as count FROM task_blockers WHERE task_id=? AND status='Active'").get(task.id) as any;

    let updatedTaskStatus = task.status;
    if ((remainingActive?.count || 0) === 0 && task.status === 'Blocked') {
      updatedTaskStatus = (task.progress && task.progress > 0) ? 'In Progress' : 'Not Started';
      db.prepare("UPDATE tasks SET status=? WHERE id=?").run(updatedTaskStatus, task.id);

      try {
        db.prepare("INSERT INTO task_status_history (id, task_id, from_status, to_status, changed_by, notes, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(crypto.randomUUID(), task.id, 'Blocked', updatedTaskStatus, req.user!.user_id, `All blockers resolved. ${resolution_notes || ''}`, now);
      } catch {}
    }

    writeAudit(req.user!.user_id, 'task_blockers', blocker.id, task.project_id, 'resolve', blocker, { resolution_notes });

    res.json({
      ok: true,
      blocker: db.prepare('SELECT * FROM task_blockers WHERE id=?').get(blocker.id),
      remaining_active_blockers: remainingActive?.count || 0,
      task_status: updatedTaskStatus,
    });
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
      const actualTable = table === "drawings" ? "documents" : table === "daily_logs" ? "dailylogs" : table === "wbs" ? "wbs_items" : table === "actions" ? "project_actions" : table === "decisions" ? "project_decisions" : table === "project_risks" ? "risks" : table;
      if (actualTable === "project_actions") {
        const today = new Date().toISOString().slice(0, 10);
        try {
          db.prepare("UPDATE project_actions SET status='Overdue' WHERE status NOT IN ('Completed', 'Closed') AND due_date IS NOT NULL AND due_date != '' AND due_date < ?").run(today);
        } catch {}
      }
      const projectId = req.query.project_id as string;
      let { where, params } = projectScopeSql(req.user!, projectId, `${actualTable}.project_id`);
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
            `${actualTable}.id IN (SELECT record_id FROM record_owners WHERE module=? AND user_id=?)`
          ];
          params.push(module, req.user!.user_id);
          if (req.user!.work_package_id) {
            conditions.push(`${actualTable}.work_package_id = ?`);
            params.push(req.user!.work_package_id);
          }
          if (req.user!.company_id) {
            conditions.push(`${actualTable}.company_id = ?`);
            params.push(req.user!.company_id);
          }
          if (!req.user!.work_package_id && !req.user!.company_id) {
            conditions.push("1=1");
          }
          where += ` AND (${conditions.join(" OR ")})`;
        } else {
          where += ` AND ${actualTable}.id IN (SELECT record_id FROM record_owners WHERE module=? AND user_id=?)`;
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

      let rows: any[];
      if (actualTable === "documents") {
        rows = db.prepare(`
          SELECT documents.*, users.name as subcontractor_name, users.username as subcontractor_username
          FROM documents
          LEFT JOIN users ON users.id = documents.subcontractor_id
          WHERE ${where}
          ORDER BY documents.date_added DESC
        `).all(...params);
      } else if (actualTable === "tasks") {
        rows = db.prepare(`
          SELECT tasks.*,
            s.name as site_name,
            wp.name as work_package_name,
            wp.code as work_package_code,
            c.name as company_name,
            sup.name as supervisor_name,
            w.name as worker_name
          FROM tasks
          LEFT JOIN sites s ON s.id = tasks.site_id
          LEFT JOIN work_packages wp ON wp.id = tasks.work_package_id
          LEFT JOIN companies c ON c.id = tasks.company_id
          LEFT JOIN users sup ON sup.id = tasks.supervisor_id
          LEFT JOIN workers w ON w.id = tasks.assigned_worker_id
          WHERE ${where}
          ORDER BY tasks.wbs_code ASC, tasks.start ASC
        `).all(...params);
      } else {
        rows = db.prepare(`SELECT * FROM ${actualTable} WHERE ${where}`).all(...params);
      }
      const accessibleRows = rows.filter(r => canAccessRecord(req.user!, r, "view", module));
      res.json(accessibleRows.map(r => externalRecordDto(rowToDict(r), req.user!, module)));
    });

    // Direct GET by ID with full authorization check
    app.get(`/api/${table}/:id`, authRequired, (req, res) => {
      const actualTable = table === "drawings" ? "documents" : table === "daily_logs" ? "dailylogs" : table === "wbs" ? "wbs_items" : table === "actions" ? "project_actions" : table === "decisions" ? "project_decisions" : table === "project_risks" ? "risks" : table;
      let record: any;
      if (actualTable === "documents") {
        record = db.prepare(`
          SELECT documents.*, users.name as subcontractor_name, users.username as subcontractor_username
          FROM documents
          LEFT JOIN users ON users.id = documents.subcontractor_id
          WHERE documents.id = ?
        `).get(req.params.id);
      } else if (actualTable === "tasks") {
        record = db.prepare(`
          SELECT tasks.*,
            s.name as site_name,
            wp.name as work_package_name,
            wp.code as work_package_code,
            c.name as company_name,
            sup.name as supervisor_name,
            w.name as worker_name
          FROM tasks
          LEFT JOIN sites s ON s.id = tasks.site_id
          LEFT JOIN work_packages wp ON wp.id = tasks.work_package_id
          LEFT JOIN companies c ON c.id = tasks.company_id
          LEFT JOIN users sup ON sup.id = tasks.supervisor_id
          LEFT JOIN workers w ON w.id = tasks.assigned_worker_id
          WHERE tasks.id = ?
        `).get(req.params.id);
      } else {
        record = db.prepare(`SELECT * FROM ${actualTable} WHERE id = ?`).get(req.params.id);
      }

      if (!record) {
        res.status(404).json({ error: "Record not found" });
        return;
      }

      if (!canAccessRecord(req.user!, record, "view", module)) {
        res.status(403).json({ error: "Forbidden: no permission to access this record" });
        return;
      }

      res.json(externalRecordDto(rowToDict(record), req.user!, module));
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
      } else if (table === "wbs_items") {
        if (data.active === undefined) data.active = 1;
      } else if (table === "plan_task_checklist") {
        if (data.is_checked === undefined) data.is_checked = 0;
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
      const actualTable = table === "drawings" ? "documents" : table === "daily_logs" ? "dailylogs" : table === "wbs" ? "wbs_items" : table === "actions" ? "project_actions" : table === "decisions" ? "project_decisions" : table === "project_risks" ? "risks" : table;

      if (actualTable === "project_actions") {
        if (!data.action_no) {
          data.action_no = getNextSequence(db, data.project_id, "action");
        }
        data.created_by = req.user!.user_id;
        data.created_at = new Date().toISOString();
      }
      if (actualTable === "project_decisions") {
        if (!data.decision_no) {
          data.decision_no = getNextSequence(db, data.project_id, "decision");
        }
        data.created_by = req.user!.user_id;
        data.created_at = new Date().toISOString();
      }
      if (actualTable === "risks" && (data.probability !== undefined || data.impact !== undefined)) {
        if (data.probability !== undefined) {
          const p = Number(data.probability);
          if (!isNaN(p) && (p < 1 || p > 5)) {
            res.status(400).json({ error: "probability must be between 1 and 5" });
            return;
          }
        }
        if (data.impact !== undefined) {
          const i = Number(data.impact);
          if (!isNaN(i) && (i < 1 || i > 5)) {
            res.status(400).json({ error: "impact must be between 1 and 5" });
            return;
          }
        }
        const evaluated = calculateRiskScore(data.probability, data.impact);
        data.risk_score = evaluated.score;
        data.risk_level = evaluated.level;
        data.created_by = data.created_by || req.user!.user_id;
        data.created_at = data.created_at || new Date().toISOString();
      }

      const values = cols.map(c => (c === "id" ? id : data[c] !== undefined ? data[c] : null));
      const placeholders = cols.map(() => "?").join(",");
      db.prepare(`INSERT INTO ${actualTable} (${cols.join(",")}) VALUES (${placeholders})`).run(...values);
      db.prepare("INSERT OR IGNORE INTO record_owners VALUES (?, ?, ?)").run(module, id, req.user!.user_id);

      if (actualTable === "purchase_orders" && data.task_id) {
        try {
          syncProcurementTaskBlocker(db, {
            id,
            project_id: data.project_id,
            task_id: data.task_id,
            po_number: data.po_number,
            item_name: data.description,
            expected_delivery_date: data.expected_delivery_date || data.expected_delivery,
            status: data.status
          });
        } catch {}
      }

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
      const actualTable = table === "drawings" ? "documents" : table === "daily_logs" ? "dailylogs" : table === "wbs" ? "wbs_items" : table === "actions" ? "project_actions" : table === "decisions" ? "project_decisions" : table === "project_risks" ? "risks" : table;
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

      // Immutable governance fields protection
      const immutableFields = ["id", "project_id", "created_by", "created_at", "action_no", "decision_no", "reference"];
      for (const field of immutableFields) {
        if (field in data && data[field] !== undefined && data[field] !== null && existing[field] && String(data[field]) !== String(existing[field])) {
          res.status(400).json({ error: `Field '${field}' is immutable and cannot be altered` });
          return;
        }
      }

      if (actualTable === "risks" && (data.probability !== undefined || data.impact !== undefined)) {
        if (data.probability !== undefined) {
          const p = Number(data.probability);
          if (!isNaN(p) && (p < 1 || p > 5)) {
            res.status(400).json({ error: "probability must be between 1 and 5" });
            return;
          }
        }
        if (data.impact !== undefined) {
          const i = Number(data.impact);
          if (!isNaN(i) && (i < 1 || i > 5)) {
            res.status(400).json({ error: "impact must be between 1 and 5" });
            return;
          }
        }
        const prob = data.probability !== undefined ? data.probability : existing.probability;
        const imp = data.impact !== undefined ? data.impact : existing.impact;
        const evaluated = calculateRiskScore(prob, imp);
        data.risk_score = evaluated.score;
        data.risk_level = evaluated.level;
      }

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

      if (actualTable === "purchase_orders") {
        try {
          syncProcurementTaskBlocker(db, {
            id: req.params.id,
            project_id: updated.project_id,
            task_id: updated.task_id,
            po_number: updated.po_number,
            item_name: updated.description,
            expected_delivery_date: updated.expected_delivery_date || updated.expected_delivery,
            status: updated.status
          });
        } catch {}
      }

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
      const actualTable = table === "drawings" ? "documents" : table === "daily_logs" ? "dailylogs" : table === "wbs" ? "wbs_items" : table === "actions" ? "project_actions" : table === "decisions" ? "project_decisions" : table === "project_risks" ? "risks" : table;
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
  if (process.env.NODE_ENV === "test") {
    // In test mode, omit Vite dev server to allow instantaneous startup
  } else if (process.env.NODE_ENV !== "production") {
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
