import crypto from "crypto";
import { LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_MS } from "../config/constants";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash === password) return true;
  try {
    if (storedHash.includes(":")) {
      const [salt, hash] = storedHash.split(":");
      const check = crypto.scryptSync(password, salt, 32).toString("hex");
      return check === hash;
    }
    const legacyHash = crypto.scryptSync(password, "mep_salt_secure", 32).toString("hex");
    return legacyHash === storedHash;
  } catch {
    return false;
  }
}

const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

export function checkLoginRateLimit(username: string): { allowed: boolean; retryAfterSeconds?: number } {
  const entry = loginAttempts.get(username);
  if (!entry) return { allowed: true };
  if (entry.lockedUntil > Date.now()) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
  }
  return { allowed: true };
}

export function recordLoginFailure(username: string) {
  const entry = loginAttempts.get(username) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
    entry.count = 0;
  }
  loginAttempts.set(username, entry);
}

export function clearLoginFailures(username: string) {
  loginAttempts.delete(username);
}
