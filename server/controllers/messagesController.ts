import { Express, Request, Response } from "express";
import crypto from "crypto";
import { db, rowToDict } from "../db/connection";
import { authRequired, hasProjectAccess, AuthenticatedUser } from "../middleware/auth";
import { writeAudit } from "../services/auditService";

type Channel = "team" | "subcontractor" | "client";
const ALL_CHANNELS: Channel[] = ["team", "subcontractor", "client"];
const PRIORITIES = ["Normal", "Urgent", "Info"];
const MAX_BODY = 10000;
const MAX_SUBJECT = 300;

export function allowedChannels(user: AuthenticatedUser): Channel[] {
  switch (user.role) {
    case "Client":
      return ["client"];
    case "Subcontractor":
      return ["subcontractor"];
    case "Worker":
      return [];
    default:
      return ALL_CHANNELS;
  }
}

function canModerate(user: AuthenticatedUser): boolean {
  return user.role === "Admin" || user.role === "ProjectManager";
}

function cleanParam(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v === "undefined" || v === "null") return null;
  return v;
}

function inTransaction(fn: () => void): void {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function placeholders(n: number): string {
  return new Array(n).fill("?").join(", ");
}

function resolveContext(req: Request, res: Response): { projectId: string; user: AuthenticatedUser; channels: Channel[] } | null {
  const user = req.user!;
  const rawProjectId = cleanParam(req.params.projectId);
  const projectId = rawProjectId || "bov-st-venera-2618";

  if (!hasProjectAccess(user, projectId)) {
    res.status(403).json({ error: "You do not have access to this project" });
    return null;
  }
  const channels = allowedChannels(user);
  if (channels.length === 0) {
    res.status(403).json({ error: "Your role does not have access to project correspondence" });
    return null;
  }
  return { projectId, user, channels };
}

function loadVisibleMessage(projectId: string, messageId: string, channels: Channel[]): any | null {
  const row = db.prepare("SELECT * FROM project_messages WHERE id = ? AND project_id = ?").get(messageId, projectId) as any;
  if (!row || !channels.includes(row.channel)) return null;
  return row;
}

export function registerMessagesController(app: Express): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'team',
      parent_id TEXT,
      subject TEXT,
      body TEXT NOT NULL,
      sender_id TEXT,
      sender_name TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'Normal',
      linked_item_type TEXT,
      linked_item_id TEXT,
      linked_item_label TEXT,
      attachment_name TEXT,
      attachment_url TEXT,
      attachment_type TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_unread INTEGER NOT NULL DEFAULT 1,
      reply_count INTEGER NOT NULL DEFAULT 0,
      last_reply_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_project_messages_proj_channel ON project_messages(project_id, channel, created_at);
    CREATE INDEX IF NOT EXISTS idx_project_messages_parent ON project_messages(parent_id);

    CREATE TABLE IF NOT EXISTS project_message_reads (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      read_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, user_id)
    );
  `);

  seedProjectMessages();

  // ─── GET /api/projects/:projectId/messages/participants ────────────────────
  app.get("/api/projects/:projectId/messages/participants", authRequired, (req: Request, res: Response) => {
    try {
      const ctx = resolveContext(req, res);
      if (!ctx) return;

      const rows = db.prepare(`
        SELECT u.id, u.name, u.role, u.company, pm.access_role
        FROM project_memberships pm
        JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = ? AND pm.active = 1 AND u.status = 'Active' AND u.role != 'Worker'
        ORDER BY u.name
      `).all(ctx.projectId) as any[];

      const visible = rows
        .map(r => ({
          ...r,
          channels: allowedChannels(r as AuthenticatedUser).filter(c => ctx.channels.includes(c))
        }))
        .filter(r => r.channels.length > 0);

      res.json({
        me: { id: ctx.user.user_id, name: ctx.user.name, role: ctx.user.role },
        channels: ctx.channels,
        participants: visible
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load project participants" });
    }
  });

  // ─── GET /api/projects/:projectId/messages/stats ────────────────────────────
  app.get("/api/projects/:projectId/messages/stats", authRequired, (req: Request, res: Response) => {
    try {
      const ctx = resolveContext(req, res);
      if (!ctx) return;

      const total = db.prepare("SELECT count(*) as count FROM project_messages WHERE project_id = ? AND parent_id IS NULL").get(ctx.projectId) as any;
      const unread = db.prepare("SELECT count(*) as count FROM project_messages WHERE project_id = ? AND parent_id IS NULL AND is_unread = 1").get(ctx.projectId) as any;
      const clientCount = db.prepare("SELECT count(*) as count FROM project_messages WHERE project_id = ? AND channel = 'client' AND parent_id IS NULL").get(ctx.projectId) as any;
      const subCount = db.prepare("SELECT count(*) as count FROM project_messages WHERE project_id = ? AND channel = 'subcontractor' AND parent_id IS NULL").get(ctx.projectId) as any;
      const teamCount = db.prepare("SELECT count(*) as count FROM project_messages WHERE project_id = ? AND channel = 'team' AND parent_id IS NULL").get(ctx.projectId) as any;

      res.json({
        total: total?.count || 0,
        unread: unread?.count || 0,
        byChannel: {
          client: clientCount?.count || 0,
          subcontractor: subCount?.count || 0,
          team: teamCount?.count || 0,
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load message statistics" });
    }
  });

  // ─── GET /api/projects/:projectId/messages ──────────────────────────────────
  app.get("/api/projects/:projectId/messages", authRequired, (req: Request, res: Response) => {
    try {
      const ctx = resolveContext(req, res);
      if (!ctx) return;

      const channelFilter = cleanParam(req.query.channel);
      const search = cleanParam(req.query.search);
      const linkedType = cleanParam(req.query.linked_item_type);

      const channels = channelFilter && channelFilter !== "all"
        ? ctx.channels.filter(c => c === channelFilter)
        : ctx.channels;
      if (channels.length === 0) return res.json([]);

      let sql = `
        SELECT * FROM project_messages
        WHERE project_id = ? AND parent_id IS NULL
          AND channel IN (${placeholders(channels.length)})
      `;
      const params: any[] = [ctx.projectId, ...channels];

      if (linkedType && linkedType !== "all") {
        sql += ` AND linked_item_type = ?`;
        params.push(linkedType);
      }

      if (search) {
        const q = `%${search.slice(0, 200)}%`;
        sql += ` AND (subject LIKE ? OR body LIKE ? OR sender_name LIKE ? OR linked_item_label LIKE ?)`;
        params.push(q, q, q, q);
      }

      sql += ` ORDER BY is_pinned DESC, COALESCE(last_reply_at, created_at) DESC LIMIT 500`;

      const rows = db.prepare(sql).all(...params) as any[];
      res.json(rows.map(r => rowToDict(r)));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load project messages" });
    }
  });

  // ─── GET /api/projects/:projectId/messages/:messageId/replies ───────────────
  app.get("/api/projects/:projectId/messages/:messageId/replies", authRequired, (req: Request, res: Response) => {
    try {
      const ctx = resolveContext(req, res);
      if (!ctx) return;
      const messageId = cleanParam(req.params.messageId);
      const parent = messageId ? loadVisibleMessage(ctx.projectId, messageId, ctx.channels) : null;
      if (!parent || parent.parent_id) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      const replies = (db.prepare(`
        SELECT * FROM project_messages
        WHERE parent_id = ? AND project_id = ?
        ORDER BY created_at ASC
      `).all(parent.id, ctx.projectId) as any[]).map(r => rowToDict(r));

      res.json({
        parent: rowToDict(parent),
        replies
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load replies" });
    }
  });

  // ─── POST /api/projects/:projectId/messages ─────────────────────────────────
  app.post("/api/projects/:projectId/messages", authRequired, (req: Request, res: Response) => {
    try {
      const ctx = resolveContext(req, res);
      if (!ctx) return;

      const b = req.body || {};
      const channel = (cleanParam(b.channel) || ctx.channels[0]) as Channel;
      const subject = cleanParam(b.subject) || "Project Correspondence";
      const body = cleanParam(b.body);
      const priority = PRIORITIES.includes(b.priority) ? b.priority : "Normal";

      if (!ctx.channels.includes(channel)) {
        return res.status(403).json({ error: "You do not have permission to post to this channel" });
      }
      if (!body) {
        return res.status(400).json({ error: "Message body is required" });
      }
      if (subject.length > MAX_SUBJECT) {
        return res.status(400).json({ error: `Subject must be ${MAX_SUBJECT} characters or fewer` });
      }
      if (body.length > MAX_BODY) {
        return res.status(400).json({ error: `Message must be ${MAX_BODY} characters or fewer` });
      }

      const id = `msg-${crypto.randomUUID().slice(0, 12)}`;
      const now = new Date().toISOString();

      inTransaction(() => {
        db.prepare(`
          INSERT INTO project_messages (
            id, project_id, channel, parent_id, subject, body,
            sender_id, sender_name, sender_role, priority,
            linked_item_type, linked_item_id, linked_item_label,
            attachment_name, attachment_url, attachment_type,
            is_pinned, is_unread, reply_count, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
        `).run(
          id, ctx.projectId, channel, subject, body,
          ctx.user.user_id, ctx.user.name, ctx.user.role, priority,
          cleanParam(b.linked_item_type), cleanParam(b.linked_item_id), cleanParam(b.linked_item_label),
          cleanParam(b.attachment_name), cleanParam(b.attachment_url), cleanParam(b.attachment_type),
          now, now
        );
        db.prepare("INSERT OR REPLACE INTO project_message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)").run(id, ctx.user.user_id, now);
      });

      writeAudit(ctx.user.user_id, "project_messages", id, ctx.projectId, "CREATE", null, { subject, channel });
      const created = rowToDict(db.prepare("SELECT * FROM project_messages WHERE id = ?").get(id));
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to create conversation" });
    }
  });

  // ─── POST /api/projects/:projectId/messages/:messageId/replies ──────────────
  app.post("/api/projects/:projectId/messages/:messageId/replies", authRequired, (req: Request, res: Response) => {
    try {
      const ctx = resolveContext(req, res);
      if (!ctx) return;
      const messageId = cleanParam(req.params.messageId);
      const parent = messageId ? loadVisibleMessage(ctx.projectId, messageId, ctx.channels) : null;
      if (!parent || parent.parent_id) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      const b = req.body || {};
      const body = cleanParam(b.body);
      if (!body) {
        return res.status(400).json({ error: "Reply body is required" });
      }
      if (body.length > MAX_BODY) {
        return res.status(400).json({ error: `Reply must be ${MAX_BODY} characters or fewer` });
      }

      const replyId = `msg-rep-${crypto.randomUUID().slice(0, 10)}`;
      const now = new Date().toISOString();

      inTransaction(() => {
        db.prepare(`
          INSERT INTO project_messages (
            id, project_id, channel, parent_id, subject, body,
            sender_id, sender_name, sender_role, priority,
            linked_item_type, linked_item_id, linked_item_label,
            attachment_name, attachment_url, attachment_type,
            is_pinned, is_unread, reply_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
        `).run(
          replyId, ctx.projectId, parent.channel, parent.id, `Re: ${parent.subject || "Thread"}`.slice(0, MAX_SUBJECT), body,
          ctx.user.user_id, ctx.user.name, ctx.user.role, parent.priority,
          parent.linked_item_type, parent.linked_item_id, parent.linked_item_label,
          cleanParam(b.attachment_name), cleanParam(b.attachment_url), cleanParam(b.attachment_type),
          now, now
        );
        db.prepare("UPDATE project_messages SET reply_count = reply_count + 1, last_reply_at = ?, updated_at = ? WHERE id = ?").run(now, now, parent.id);
        db.prepare("INSERT OR REPLACE INTO project_message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)").run(parent.id, ctx.user.user_id, now);
      });

      writeAudit(ctx.user.user_id, "project_messages", replyId, ctx.projectId, "REPLY", null, { parent_id: parent.id });
      const reply = rowToDict(db.prepare("SELECT * FROM project_messages WHERE id = ?").get(replyId));
      res.status(201).json(reply);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to post reply" });
    }
  });

  // ─── PATCH /api/projects/:projectId/messages/:messageId/read ────────────────
  app.patch("/api/projects/:projectId/messages/:messageId/read", authRequired, (req: Request, res: Response) => {
    try {
      const ctx = resolveContext(req, res);
      if (!ctx) return;
      const messageId = cleanParam(req.params.messageId);
      const msg = messageId ? loadVisibleMessage(ctx.projectId, messageId, ctx.channels) : null;
      if (!msg) return res.status(404).json({ error: "Conversation not found" });

      db.prepare("UPDATE project_messages SET is_unread = 0 WHERE id = ? AND project_id = ?").run(msg.id, ctx.projectId);
      db.prepare("INSERT OR REPLACE INTO project_message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)")
        .run(msg.id, ctx.user.user_id, new Date().toISOString());
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update read status" });
    }
  });

  // ─── PATCH /api/projects/:projectId/messages/:messageId/pin ─────────────────
  app.patch("/api/projects/:projectId/messages/:messageId/pin", authRequired, (req: Request, res: Response) => {
    try {
      const ctx = resolveContext(req, res);
      if (!ctx) return;
      const messageId = cleanParam(req.params.messageId);
      const msg = messageId ? loadVisibleMessage(ctx.projectId, messageId, ctx.channels) : null;
      if (!msg || msg.parent_id) return res.status(404).json({ error: "Conversation not found" });

      db.prepare("UPDATE project_messages SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END WHERE id = ? AND project_id = ?").run(msg.id, ctx.projectId);
      const updated = db.prepare("SELECT * FROM project_messages WHERE id = ?").get(msg.id) as any;
      writeAudit(ctx.user.user_id, "project_messages", msg.id, ctx.projectId, updated.is_pinned ? "PIN" : "UNPIN", null, {});
      res.json(rowToDict(updated));
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update pin" });
    }
  });

  // ─── DELETE /api/projects/:projectId/messages/:messageId ────────────────────
  app.delete("/api/projects/:projectId/messages/:messageId", authRequired, (req: Request, res: Response) => {
    try {
      const ctx = resolveContext(req, res);
      if (!ctx) return;
      const messageId = cleanParam(req.params.messageId);
      const msg = messageId ? loadVisibleMessage(ctx.projectId, messageId, ctx.channels) : null;
      if (!msg) return res.status(404).json({ error: "Message not found" });
      if (msg.sender_id !== ctx.user.user_id && !canModerate(ctx.user)) {
        return res.status(403).json({ error: "You can only delete your own messages" });
      }

      inTransaction(() => {
        if (msg.parent_id) {
          db.prepare("DELETE FROM project_messages WHERE id = ?").run(msg.id);
          db.prepare(`
            UPDATE project_messages SET
              reply_count = (SELECT COUNT(*) FROM project_messages WHERE parent_id = ?),
              last_reply_at = (SELECT MAX(created_at) FROM project_messages WHERE parent_id = ?)
            WHERE id = ?
          `).run(msg.parent_id, msg.parent_id, msg.parent_id);
        } else {
          const ids = (db.prepare("SELECT id FROM project_messages WHERE parent_id = ?").all(msg.id) as any[]).map(r => r.id);
          ids.push(msg.id);
          db.prepare(`DELETE FROM project_message_reads WHERE message_id IN (${placeholders(ids.length)})`).run(...ids);
          db.prepare("DELETE FROM project_messages WHERE parent_id = ?").run(msg.id);
          db.prepare("DELETE FROM project_messages WHERE id = ?").run(msg.id);
        }
      });

      writeAudit(ctx.user.user_id, "project_messages", msg.id, ctx.projectId, "DELETE", null, { parent_id: msg.parent_id || null });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete message" });
    }
  });
}

function seedProjectMessages() {
  const projectId = "bov-st-venera-2618";
  const count = db.prepare("SELECT count(*) as cnt FROM project_messages WHERE project_id = ?").get(projectId) as any;
  if (count && count.cnt > 0) return;

  const now = new Date();
  const d1 = new Date(now.getTime() - 2 * 86400000).toISOString();
  const d2 = new Date(now.getTime() - 1 * 86400000).toISOString();
  const d3 = new Date(now.getTime() - 4 * 3600000).toISOString();
  const d4 = new Date(now.getTime() - 2 * 3600000).toISOString();

  const t1Id = "msg-bov-client-01";
  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      attachment_name, attachment_url, attachment_type,
      is_pinned, is_unread, reply_count, last_reply_at, created_at, updated_at
    ) VALUES (?, ?, 'client', NULL, ?, ?, ?, ?, ?, 'Normal', 'task', 'task-e-12-01', ?, ?, ?, ?, 1, 1, 2, ?, ?, ?)
  `).run(
    t1Id, projectId,
    "Level 1 Executive Boardroom & Hospitality Suite Luminaire Temperature",
    "Following the architect's sample board review yesterday, the bank's property board has confirmed a preference for 3000K Warm White luminaires for all client-facing reception and boardroom areas on Level 1, instead of standard 4000K. Please verify that this does not impact the delivery lead time.",
    "usr-client-01", "Mark Farrugia", "Client Project Manager (BOV)",
    "Task # E-12.01 · Recessed modular LED panels (WP-05)",
    "BOV_L1_Boardroom_Finish_Palette.pdf", "https://example.com/palette.pdf", "application/pdf",
    d3, d1, d3
  );

  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      is_pinned, is_unread, reply_count, created_at, updated_at
    ) VALUES (?, ?, 'client', ?, ?, ?, ?, ?, ?, 'Normal', 'task', 'task-e-12-01', ?, 0, 0, 0, ?, ?)
  `).run(
    "msg-rep-01a", projectId, t1Id,
    "Re: Level 1 Executive Boardroom & Hospitality Suite Luminaire Temperature",
    "We contacted Philips / Signify technical sales. The 3000K optical modules share the exact same housing and driver specifications as the 4000K tender baseline, and the supplier confirmed zero lead time impact for the 35 units required for Zone 1.",
    "admin", "David Spiteri", "MEP Project Manager",
    "Task # E-12.01 · Recessed modular LED panels (WP-05)",
    d2, d2
  );

  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      is_pinned, is_unread, reply_count, created_at, updated_at
    ) VALUES (?, ?, 'client', ?, ?, ?, ?, ?, ?, 'Normal', 'task', 'task-e-12-01', ?, 0, 0, 0, ?, ?)
  `).run(
    "msg-rep-01b", projectId, t1Id,
    "Re: Level 1 Executive Boardroom & Hospitality Suite Luminaire Temperature",
    "Enser Ltd approves the 3000K variant on Drawing 2618-L-LTG-01 subject to maintaining average 500 lux across the meeting table surface in accordance with CIBSE Code for Lighting.",
    "usr-enser-01", "Ing. Christian Borg", "Consultant Electrical Engineer (Enser Ltd)",
    "Task # E-12.01 · Recessed modular LED panels (WP-05)",
    d3, d3
  );

  const t2Id = "msg-bov-sub-02";
  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      attachment_name, attachment_url, attachment_type,
      is_pinned, is_unread, reply_count, last_reply_at, created_at, updated_at
    ) VALUES (?, ?, 'subcontractor', NULL, ?, ?, ?, ?, ?, 'Urgent', 'task', 'task-d-06-0', ?, ?, ?, ?, 0, 1, 1, ?, ?, ?)
  `).run(
    t2Id, projectId,
    "Level 2 Main Riser Containment Clearances & Cat 6 Trunking Alignment",
    "Urgent coordination on Level 2: the chilled water piping bracket in Shaft B is positioned 180mm closer to the cable tray flange than indicated on drawing 2618-S-ELE-01. We require site engineer confirmation before pulling the Cat 6 bundles to ensure minimum 150mm separation from chilled water lines.",
    "usr-sub-01", "Kevin Bonnici", "Lead Electrical Subcontractor (ElectroData Ltd)",
    "Task # D-06.0 · 4-pair Cat 6 UTP (3,070m) (WP-06)",
    "Level2_ShaftB_Pipe_Clearance.png", "https://example.com/clearance.png", "image/png",
    d4, d2, d4
  );

  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      is_pinned, is_unread, reply_count, created_at, updated_at
    ) VALUES (?, ?, 'subcontractor', ?, ?, ?, ?, ?, ?, 'Urgent', 'task', 'task-d-06-0', ?, 0, 0, 0, ?, ?)
  `).run(
    "msg-rep-02a", projectId, t2Id,
    "Re: Level 2 Main Riser Containment Clearances & Cat 6 Trunking Alignment",
    "Inspected on site at 14:00 with HVAC foreman. We will offset the cable basket by 100mm towards the structural masonry wall using Unistrut brackets. The Cat 6 cables will have a safe 220mm clearance from the insulated pipework.",
    "usr-eng-01", "Marco Vella", "Site Mechanical & Electrical Engineer",
    "Task # D-06.0 · 4-pair Cat 6 UTP (3,070m) (WP-06)",
    d4, d4
  );

  const t3Id = "msg-bov-team-03";
  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      is_pinned, is_unread, reply_count, last_reply_at, created_at, updated_at
    ) VALUES (?, ?, 'team', NULL, ?, ?, ?, ?, ?, 'Normal', 'drawing', 'dwg-2618-s-ele-01', ?, 0, 0, 1, ?, ?, ?)
  `).run(
    t3Id, projectId,
    "Enser Ltd Witness Testing for Submain Panel DB-L1 & Earth Fault Relay",
    "Please ensure that the factory test reports and calibrated injection test kits are prepared for the 400A MCCB with integrated electronic trip unit for DB-L1. Testing is scheduled for Wednesday 10:30 AM.",
    "usr-enser-01", "Ing. Christian Borg", "Consultant Electrical Engineer (Enser Ltd)",
    "Drawing 2618-S-ELE-01 · Electrical Distribution Single Line",
    d4, d3, d4
  );

  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      is_pinned, is_unread, reply_count, created_at, updated_at
    ) VALUES (?, ?, 'team', ?, ?, ?, ?, ?, ?, 'Normal', 'drawing', 'dwg-2618-s-ele-01', ?, 0, 0, 0, ?, ?)
  `).run(
    "msg-rep-03a", projectId, t3Id,
    "Re: Enser Ltd Witness Testing for Submain Panel DB-L1 & Earth Fault Relay",
    "Understood. The panel builder has issued the calibrated test certificates (traceable to UKAS/EN standards), and our electrical testing engineer will have the secondary injection test kit set up 30 minutes prior.",
    "admin", "David Spiteri", "MEP Project Manager",
    "Drawing 2618-S-ELE-01 · Electrical Distribution Single Line",
    d4, d4
  );
}
