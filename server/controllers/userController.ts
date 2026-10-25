import { Express, Request, Response } from "express";
import crypto from "crypto";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import { MEP_REFERENCE_KNOWLEDGE, MEP_DEFECT_PATTERNS, suggestFixFallback } from "../../mep_brain";
import { db, rowToDict } from "../db/connection";
import {
  SESSION_LIFETIME_MS,
  ROLE_DEFINITIONS,
  ROLE_PERMS,
  TABLE_CONFIG,
  VALID_TRANSITIONS,
  NOTIFY_WORTHY_STATUSES,
} from "../config/constants";
import {
  hashPassword,
  verifyPassword,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
} from "../middleware/rateLimit";
import {
  AuthenticatedUser,
  authRequired,
  getCurrentUser,
  canAccessProject,
  hasProjectAccess,
  canAccessCompany,
  canAccessWorkPackage,
  projectScopeSql,
  canView,
  canEdit,
  canDelete,
  canPerformAction,
  externalRecordDto,
  canAccessRecord,
} from "../middleware/auth";
import { auditSafeValue, writeAudit, createNotification } from "../services/auditService";
import {
  normaliseHeader,
  extractDocumentText,
  parseImportNumber,
  normaliseProjectDateCandidate,
  fallbackProjectSetupSuggestions,
} from "../services/documentParserService";
import {
  haversineDistance,
  geofenceStatus,
  getWorkerPrincipal,
  getActiveWorkerAssignment,
  canAccessWorker,
  canAccessSite,
  canAccessAttendance,
  canAccessSiteInstruction,
  canAccessPayroll,
  safeTimeZone,
  zonedParts,
  addIsoDays,
  weekdayNumber,
  parseWorkingDays,
  getWorkerShift,
  resolveWorkDateForPunch,
  isPublicHoliday,
  scheduledWorkingDay,
  attendanceStatusForRecord,
  recalculateAttendanceRecord,
  calculateDailyAttendanceStatus,
  chargeableLeaveDays,
} from "../services/workforceService";
import { registerWorkPackageRoutes } from "../routes/workPackageRoutes";
import { registerProcurementRoutes } from "../routes/procurementRoutes";
import { registerRiskRoutes } from "../routes/riskRoutes";
import { registerOctoRoutes } from "../routes/octoRoutes";
import { registerTaskRoutes } from "../routes/taskRoutes";
import { registerProgressRoutes } from "../routes/progressRoutes";
import { getNextSequence } from "../services/referenceSequence";
import { syncProcurementTaskBlocker } from "../services/blockerService";
import { calculateRiskScore } from "../services/riskService";
import {
  extractContractorDocumentIntelligence,
  applyContractorIntelligenceAndVerify,
  normalizeDate,
} from "../services/contractorDocIntelligence";

export function registerUserController(app: Express): void {
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

}
