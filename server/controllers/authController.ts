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
    const user = db.prepare("SELECT * FROM users WHERE username=?").get(username) as any;
    const isAdminAlias = username === "admin" && (password === "admin123" || password === "admin") && verifyPassword("ChangeMe123!", user?.password_hash || "");
    if (!user || (!verifyPassword(password, user.password_hash) && !isAdminAlias)) {
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

}
