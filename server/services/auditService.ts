import crypto from "crypto";
import { Response } from "express";
import { db } from "../db/connection";
import { NOTIFY_WORTHY_STATUSES } from "../config/constants";

export { NOTIFY_WORTHY_STATUSES };

export interface SseClient {
  id: string;
  userId: string;
  role: string;
  res: Response;
}

const sseClients = new Set<SseClient>();

export function registerSseClient(client: SseClient): () => void {
  sseClients.add(client);
  return () => {
    sseClients.delete(client);
  };
}

export function getActiveSseClientCount(): number {
  return sseClients.size;
}

export function broadcastRealtimeEvent(payload: Record<string, any>): void {
  if (sseClients.size === 0) return;
  const serialized = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(serialized);
    } catch {
      sseClients.delete(client);
    }
  }
}

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
  const ts = new Date().toISOString();
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
      ts
    );
  } catch (err) {
    console.error("Audit write error:", err);
  }
  broadcastRealtimeEvent({
    type: "mutation",
    userId,
    module,
    recordId,
    projectId,
    action,
    timestamp: ts,
  });
}

// Creates an in-app notification for a single user. Used by the generic PUT
// handler when a record's status changes to something the record's creator
// (looked up via record_owners) would want to know about, and by anything
// that assigns a person to a task. Never throws - a notification failing to
// write should never break the request that triggered it.
export function createNotification(userId: string, projectId: string | null, module: string, recordId: string, title: string, message: string) {
  if (!userId) return;
  const ts = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO notifications (id, user_id, project_id, module, record_id, title, message, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(crypto.randomUUID(), userId, projectId, module, recordId, title, message, ts);
  } catch (err) {
    console.error("Notification write error:", err);
  }
  broadcastRealtimeEvent({
    type: "notification",
    targetUserId: userId,
    projectId,
    module,
    recordId,
    title,
    message,
    timestamp: ts,
  });
}
