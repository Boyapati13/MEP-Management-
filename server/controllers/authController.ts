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

export function registerAuthController(app: Express): void {
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
    const cleanIdent = String(username).trim();
    const user = db.prepare("SELECT * FROM users WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?)").get(cleanIdent, cleanIdent) as any;
    if (!user || !verifyPassword(password, user.password_hash)) {
      recordLoginFailure(username);
      res.status(401).json({ error: "Invalid email ID / username or password" });
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
    const userPayload = {
      id: user.id,
      user_id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      email: user.email || "",
      company: user.company || "",
      trade: user.trade || "",
      status: user.status || "Active",
      must_change_password: !!user.must_change_password,
      permissions: ROLE_PERMS[user.role] || ROLE_PERMS.SiteEngineer,
    };
    res.json({
      token,
      ...userPayload,
      user: userPayload,
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

  // Check if an Email ID has been granted Main Admin permission by Our Company
  app.get("/api/auth/check-main-admin-email", (req, res) => {
    try {
      const cleanEmail = String(req.query.email || "").trim().toLowerCase();
      if (!cleanEmail) {
        const list = db
          .prepare("SELECT email, admin_name, company_name, plan, status, username FROM authorized_main_admins WHERE status != 'Revoked' ORDER BY created_at DESC")
          .all();
        res.json({ authorized: false, available_authorized_emails: list });
        return;
      }
      const record = db.prepare("SELECT * FROM authorized_main_admins WHERE LOWER(email)=?").get(cleanEmail) as any;
      if (!record || record.status === "Revoked") {
        res.status(404).json({
          authorized: false,
          error: `Permission Denied: Our Company has not yet granted Main Admin permission to "${cleanEmail}". Please ask Our Company (Platform Owner) to authorize your Email ID in Step 1 first.`,
        });
        return;
      }
      res.json({
        authorized: true,
        email: record.email,
        admin_name: record.admin_name,
        company_name: record.company_name,
        username: record.username || cleanEmail.split("@")[0],
        plan: record.plan || "Enterprise",
        status: record.status,
        authorized_by: record.authorized_by || "Our Company (Platform Owner)",
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to verify Main Admin Email ID" });
    }
  });

  // Self-service SaaS Organization Signup & Authorized Main Admin Email ID Activation
  app.post("/api/auth/register-organization", (req, res) => {
    const { organization_name, country, currency, plan, admin_name, username, email, password, require_preauth } = req.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();
    const preAuth = cleanEmail
      ? (db.prepare("SELECT * FROM authorized_main_admins WHERE LOWER(email)=?").get(cleanEmail) as any)
      : null;

    if (require_preauth && (!preAuth || preAuth.status === "Revoked")) {
      res.status(403).json({
        error: `Access Denied: Our Company has not granted Main Admin permission to Email ID "${cleanEmail || "provided"}". Our Company must first authorize your Email ID in Step 1 before you can activate a Main Admin account.`,
      });
      return;
    }

    const finalOrgName = String(organization_name || preAuth?.company_name || "MEP Enterprise Workspace").trim();
    const finalAdminName = String(admin_name || preAuth?.admin_name || "Main Administrator").trim();
    const finalUsername = String(username || preAuth?.username || cleanEmail.split("@")[0] || "main_admin").trim().toLowerCase();

    if (!finalOrgName || !finalAdminName || !finalUsername || !password) {
      res.status(400).json({ error: "Email ID, admin_name, organization_name, and password are required" });
      return;
    }
    if (String(password).length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters." });
      return;
    }
    const existingByEmailOrUser = db.prepare("SELECT * FROM users WHERE LOWER(username)=? OR ( ? != '' AND LOWER(email)=? )").get(finalUsername, cleanEmail, cleanEmail) as any;

    const orgId = `org-${crypto.randomUUID().slice(0, 8)}`;
    const userId = existingByEmailOrUser?.id || preAuth?.user_id || crypto.randomUUID();
    const now = new Date().toISOString();
    const chosenPlan = ["Starter", "Professional", "Enterprise"].includes(plan || preAuth?.plan) ? (plan || preAuth?.plan) : "Enterprise";
    const maxUsers = chosenPlan === "Starter" ? 15 : chosenPlan === "Professional" ? 75 : 500;
    const maxProjects = chosenPlan === "Starter" ? 5 : chosenPlan === "Professional" ? 25 : 100;

    try {
      db.prepare(
        `INSERT OR IGNORE INTO organizations (id, name, slug, plan, subscription_status, max_users, max_projects, country, default_currency, tax_label, default_tax_rate, created_at)
         VALUES (?, ?, ?, ?, 'Active', ?, ?, ?, ?, 'VAT', 0, ?)`
      ).run(
        orgId,
        finalOrgName,
        finalOrgName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        chosenPlan,
        maxUsers,
        maxProjects,
        country || "Global",
        currency || "EUR",
        now
      );
    } catch {}

    if (existingByEmailOrUser) {
      db.prepare(
        `UPDATE users SET password_hash=?, name=?, role='Admin', email=COALESCE(NULLIF(?,''), email), company=?, status='Active', stakeholder_type='Main Admin', must_change_password=0 WHERE id=?`
      ).run(hashPassword(password), finalAdminName, cleanEmail, finalOrgName, existingByEmailOrUser.id);
    } else {
      db.prepare(
        `INSERT INTO users (id, username, password_hash, name, role, email, company, status, stakeholder_type, organization_id, created_at)
         VALUES (?, ?, ?, ?, 'Admin', ?, ?, 'Active', 'Main Admin', ?, ?)`
      ).run(userId, finalUsername, hashPassword(password), finalAdminName, cleanEmail, finalOrgName, orgId, now);
    }

    if (cleanEmail) {
      try {
        db.prepare(`
          INSERT INTO authorized_main_admins (id, email, admin_name, company_name, plan, status, username, user_id, authorized_by, notes, created_at, activated_at)
          VALUES (?, ?, ?, ?, ?, 'Activated', ?, ?, 'Our Company (Platform Owner)', 'Activated via Main Admin Email ID', ?, ?)
          ON CONFLICT(email) DO UPDATE SET
            status='Activated',
            admin_name=excluded.admin_name,
            company_name=excluded.company_name,
            username=excluded.username,
            user_id=excluded.user_id,
            activated_at=excluded.activated_at
        `).run(`auth-adm-${crypto.randomUUID().slice(0, 6)}`, cleanEmail, finalAdminName, finalOrgName, chosenPlan, finalUsername, userId, now, now);
      } catch {}
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
    db.prepare("INSERT INTO sessions (token, user_id, name, role, created_at, expires_at) VALUES (?, ?, ?, 'Admin', ?, ?)").run(token, userId, finalAdminName, now, expiresAt);
    res.cookie("mep_session", token, { httpOnly: true, sameSite: "lax", maxAge: SESSION_LIFETIME_MS, path: "/" });
    writeAudit(userId, "organizations", orgId, "SYSTEM", "ACTIVATE_MAIN_ADMIN", null, { organization_name: finalOrgName, email: cleanEmail, plan: chosenPlan });

    res.status(201).json({
      ok: true,
      token,
      user: {
        id: userId,
        user_id: userId,
        username: finalUsername,
        email: cleanEmail,
        name: finalAdminName,
        company: finalOrgName,
        role: "Admin",
        organization_id: orgId,
        permissions: ROLE_PERMS.Admin,
      },
      organization: db.prepare("SELECT * FROM organizations WHERE id=?").get(orgId),
    });
  });

  // Self-service password reset request (never leaks account existence)
  app.post("/api/auth/forgot-password", (req, res) => {
    const { identifier } = req.body || {};
    if (!identifier) {
      res.status(400).json({ error: "Username or email is required" });
      return;
    }
    const clean = String(identifier).trim().toLowerCase();
    const user = db.prepare("SELECT id FROM users WHERE LOWER(username)=? OR LOWER(email)=? LIMIT 1").get(clean, clean) as any;
    if (user) {
      const rawToken = crypto.randomBytes(24).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      db.prepare("INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(crypto.randomUUID(), user.id, tokenHash, expiresAt, now.toISOString());
      writeAudit(user.id, "users", user.id, "SYSTEM", "FORGOT_PASSWORD_REQUEST");
    }
    res.json({ ok: true, message: "If a matching account exists, password reset instructions have been issued." });
  });

  // Organization & SaaS Plan Settings
  app.get("/api/organization", authRequired, (req, res) => {
    const uRow = db.prepare("SELECT organization_id FROM users WHERE id=?").get(req.user!.user_id) as any;
    const orgId = uRow?.organization_id || "org-default";
    const org = db.prepare("SELECT * FROM organizations WHERE id=?").get(orgId) || db.prepare("SELECT * FROM organizations LIMIT 1").get();
    const userCount = (db.prepare("SELECT COUNT(*) as c FROM users").get() as any)?.c || 0;
    const projectCount = (db.prepare("SELECT COUNT(*) as c FROM projects").get() as any)?.c || 0;
    res.json({ organization: org, usage: { users: userCount, projects: projectCount } });
  });

  app.put("/api/organization", authRequired, (req, res) => {
    if (req.user!.role !== "Admin") {
      res.status(403).json({ error: "Only Admin can update organization settings" });
      return;
    }
    const uRow = db.prepare("SELECT organization_id FROM users WHERE id=?").get(req.user!.user_id) as any;
    const orgId = uRow?.organization_id || "org-default";
    const { name, plan, country, default_currency, tax_label, default_tax_rate } = req.body || {};
    db.prepare(
      `UPDATE organizations
       SET name=COALESCE(?,name), plan=COALESCE(?,plan), country=COALESCE(?,country),
           default_currency=COALESCE(?,default_currency), tax_label=COALESCE(?,tax_label),
           default_tax_rate=COALESCE(?,default_tax_rate)
       WHERE id=?`
    ).run(name || null, plan || null, country || null, default_currency || null, tax_label || null, default_tax_rate ?? null, orgId);
    writeAudit(req.user!.user_id, "organizations", orgId, "SYSTEM", "UPDATE_ORG", null, req.body);
    res.json(db.prepare("SELECT * FROM organizations WHERE id=?").get(orgId));
  });

}
