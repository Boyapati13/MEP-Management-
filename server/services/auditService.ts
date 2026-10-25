import crypto from "crypto";
import { db } from "../db/connection";
import { NOTIFY_WORTHY_STATUSES } from "../config/constants";

export { NOTIFY_WORTHY_STATUSES };

export function auditSafeValue(module: string, value: any): any {
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

export function writeAudit(userId: string, module: string, recordId: string, projectId: string, action: string, oldValue: any = null, newValue: any = null) {
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
export function createNotification(userId: string, projectId: string | null, module: string, recordId: string, title: string, message: string) {
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
