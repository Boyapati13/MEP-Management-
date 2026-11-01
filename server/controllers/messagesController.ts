import { Express, Request, Response } from "express";
import crypto from "crypto";
import { db, rowToDict } from "../db/connection";
import { authRequired, hasProjectAccess } from "../middleware/auth";
import { writeAudit } from "../services/auditService";

export function registerMessagesController(app: Express): void {
  // Ensure table exists
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
  `);

  // Seed authentic threads for bov-st-venera-2618 if empty
  seedProjectMessages();

  // ─── GET /api/projects/:projectId/messages ──────────────────────────────────
  app.get("/api/projects/:projectId/messages", authRequired, (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      if (!hasProjectAccess(req, projectId)) {
        return res.status(403).json({ error: "Access denied to project messages" });
      }

      const { channel, search, linked_item_type } = req.query;

      let sql = `
        SELECT * FROM project_messages 
        WHERE project_id = ? AND parent_id IS NULL
      `;
      const params: any[] = [projectId];

      if (channel && channel !== 'all') {
        sql += ` AND channel = ?`;
        params.push(channel);
      }

      if (linked_item_type) {
        sql += ` AND linked_item_type = ?`;
        params.push(linked_item_type);
      }

      if (search) {
        const q = `%${String(search).trim()}%`;
        sql += ` AND (subject LIKE ? OR body LIKE ? OR sender_name LIKE ? OR linked_item_label LIKE ?)`;
        params.push(q, q, q, q);
      }

      sql += ` ORDER BY is_pinned DESC, COALESCE(last_reply_at, created_at) DESC`;

      const rows = db.prepare(sql).all(...params);
      const threads = rows.map(r => rowToDict(r));

      res.json(threads);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load project messages" });
    }
  });

  // ─── GET /api/projects/:projectId/messages/:messageId/replies ───────────────
  app.get("/api/projects/:projectId/messages/:messageId/replies", authRequired, (req: Request, res: Response) => {
    try {
      const { projectId, messageId } = req.params;
      if (!hasProjectAccess(req, projectId)) {
        return res.status(403).json({ error: "Access denied to message thread" });
      }

      const parent = db.prepare("SELECT * FROM project_messages WHERE id = ? AND project_id = ?").get(messageId, projectId);
      if (!parent) {
        return res.status(404).json({ error: "Thread not found" });
      }

      const replies = db.prepare(`
        SELECT * FROM project_messages 
        WHERE parent_id = ? AND project_id = ?
        ORDER BY created_at ASC
      `).all(messageId, projectId).map(r => rowToDict(r));

      res.json({
        parent: rowToDict(parent),
        replies
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to load message replies" });
    }
  });

  // ─── POST /api/projects/:projectId/messages ─────────────────────────────────
  app.post("/api/projects/:projectId/messages", authRequired, (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      if (!hasProjectAccess(req, projectId)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const {
        channel = 'team',
        subject,
        body,
        priority = 'Normal',
        linked_item_type,
        linked_item_id,
        linked_item_label,
        attachment_name,
        attachment_url,
        attachment_type
      } = req.body;

      if (!body || !body.trim()) {
        return res.status(400).json({ error: "Message body is required" });
      }

      const id = `msg-${crypto.randomUUID().slice(0, 10)}`;
      const now = new Date().toISOString();
      const senderId = (req as any).user?.id || 'admin';
      const senderName = (req as any).user?.name || 'Administrator';
      const senderRole = (req as any).user?.role || 'Project Manager';

      db.prepare(`
        INSERT INTO project_messages (
          id, project_id, channel, parent_id, subject, body,
          sender_id, sender_name, sender_role, priority,
          linked_item_type, linked_item_id, linked_item_label,
          attachment_name, attachment_url, attachment_type,
          is_pinned, is_unread, reply_count, created_at, updated_at
        ) VALUES (
          ?, ?, ?, NULL, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          0, 0, 0, ?, ?
        )
      `).run(
        id, projectId, channel, subject || 'Discussion Thread', body.trim(),
        senderId, senderName, senderRole, priority,
        linked_item_type || null, linked_item_id || null, linked_item_label || null,
        attachment_name || null, attachment_url || null, attachment_type || null,
        now, now
      );

      writeAudit(req, projectId, 'project_messages', id, 'CREATE', { subject, channel });

      const created = rowToDict(db.prepare("SELECT * FROM project_messages WHERE id = ?").get(id));
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to create message thread" });
    }
  });

  // ─── POST /api/projects/:projectId/messages/:messageId/replies ──────────────
  app.post("/api/projects/:projectId/messages/:messageId/replies", authRequired, (req: Request, res: Response) => {
    try {
      const { projectId, messageId } = req.params;
      if (!hasProjectAccess(req, projectId)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const parent = db.prepare("SELECT * FROM project_messages WHERE id = ? AND project_id = ?").get(messageId, projectId) as any;
      if (!parent) {
        return res.status(404).json({ error: "Parent thread not found" });
      }

      const { body, attachment_name, attachment_url, attachment_type } = req.body;
      if (!body || !body.trim()) {
        return res.status(400).json({ error: "Reply body is required" });
      }

      const replyId = `msg-rep-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const senderId = (req as any).user?.id || 'admin';
      const senderName = (req as any).user?.name || 'Administrator';
      const senderRole = (req as any).user?.role || 'Project Manager';

      // Insert reply
      db.prepare(`
        INSERT INTO project_messages (
          id, project_id, channel, parent_id, subject, body,
          sender_id, sender_name, sender_role, priority,
          linked_item_type, linked_item_id, linked_item_label,
          attachment_name, attachment_url, attachment_type,
          is_pinned, is_unread, reply_count, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          0, 0, 0, ?, ?
        )
      `).run(
        replyId, projectId, parent.channel, messageId, `Re: ${parent.subject || 'Thread'}`, body.trim(),
        senderId, senderName, senderRole, parent.priority,
        parent.linked_item_type, parent.linked_item_id, parent.linked_item_label,
        attachment_name || null, attachment_url || null, attachment_type || null,
        now, now
      );

      // Update parent counter and last_reply_at
      db.prepare(`
        UPDATE project_messages 
        SET reply_count = reply_count + 1, last_reply_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, messageId);

      writeAudit(req, projectId, 'project_messages', replyId, 'REPLY', { parent_id: messageId });

      const reply = rowToDict(db.prepare("SELECT * FROM project_messages WHERE id = ?").get(replyId));
      res.status(201).json(reply);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to post reply" });
    }
  });

  // ─── PATCH /api/projects/:projectId/messages/:messageId/read ─────────────────
  app.patch("/api/projects/:projectId/messages/:messageId/read", authRequired, (req: Request, res: Response) => {
    try {
      const { projectId, messageId } = req.params;
      db.prepare("UPDATE project_messages SET is_unread = 0 WHERE id = ? AND project_id = ?").run(messageId, projectId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to update read state" });
    }
  });

  // ─── PATCH /api/projects/:projectId/messages/:messageId/pin ──────────────────
  app.patch("/api/projects/:projectId/messages/:messageId/pin", authRequired, (req: Request, res: Response) => {
    try {
      const { projectId, messageId } = req.params;
      db.prepare(`
        UPDATE project_messages 
        SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END 
        WHERE id = ? AND project_id = ?
      `).run(messageId, projectId);
      const updated = rowToDict(db.prepare("SELECT * FROM project_messages WHERE id = ?").get(messageId));
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to toggle pin" });
    }
  });

  // ─── GET /api/projects/:projectId/messages/stats ────────────────────────────
  app.get("/api/projects/:projectId/messages/stats", authRequired, (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const total = db.prepare("SELECT count(*) as count FROM project_messages WHERE project_id = ? AND parent_id IS NULL").get(projectId) as any;
      const unread = db.prepare("SELECT count(*) as count FROM project_messages WHERE project_id = ? AND parent_id IS NULL AND is_unread = 1").get(projectId) as any;
      const clientUnread = db.prepare("SELECT count(*) as count FROM project_messages WHERE project_id = ? AND channel = 'client' AND parent_id IS NULL AND is_unread = 1").get(projectId) as any;
      const subUnread = db.prepare("SELECT count(*) as count FROM project_messages WHERE project_id = ? AND channel = 'subcontractor' AND parent_id IS NULL AND is_unread = 1").get(projectId) as any;
      const teamUnread = db.prepare("SELECT count(*) as count FROM project_messages WHERE project_id = ? AND channel = 'team' AND parent_id IS NULL AND is_unread = 1").get(projectId) as any;

      res.json({
        total: total?.count || 0,
        unread: unread?.count || 0,
        byChannel: {
          client: clientUnread?.count || 0,
          subcontractor: subUnread?.count || 0,
          team: teamUnread?.count || 0,
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to get stats" });
    }
  });

  // ─── DELETE /api/projects/:projectId/messages/:messageId ────────────────────
  app.delete("/api/projects/:projectId/messages/:messageId", authRequired, (req: Request, res: Response) => {
    try {
      const { projectId, messageId } = req.params;
      db.prepare("DELETE FROM project_messages WHERE parent_id = ? AND project_id = ?").run(messageId, projectId);
      db.prepare("DELETE FROM project_messages WHERE id = ? AND project_id = ?").run(messageId, projectId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to delete message" });
    }
  });
}

function seedProjectMessages() {
  const projectId = 'bov-st-venera-2618';
  const count = db.prepare("SELECT count(*) as cnt FROM project_messages WHERE project_id = ?").get(projectId) as any;
  if (count && count.cnt > 0) return;

  const now = new Date();
  const d1 = new Date(now.getTime() - 2 * 86400000).toISOString();
  const d2 = new Date(now.getTime() - 1 * 86400000).toISOString();
  const d3 = new Date(now.getTime() - 4 * 3600000).toISOString();
  const d4 = new Date(now.getTime() - 2 * 3600000).toISOString();

  // Thread 1: Client Message
  const t1Id = 'msg-bov-client-01';
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
    'Level 1 Executive Boardroom & Hospitality Suite Luminaire Temperature',
    "Following the architect's sample board review yesterday, the bank's property board has confirmed a preference for 3000K Warm White luminaires for all client-facing reception and boardroom areas on Level 1, instead of standard 4000K. Please verify that this does not impact the delivery lead time.",
    'usr-client-01', 'Mark Farrugia', 'Client Project Manager (BOV)',
    'Task # E-12.01 · Recessed modular LED panels (WP-05)',
    'BOV_L1_Boardroom_Finish_Palette.pdf', 'https://example.com/palette.pdf', 'application/pdf',
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
    'msg-rep-01a', projectId, t1Id,
    'Re: Level 1 Executive Boardroom & Hospitality Suite Luminaire Temperature',
    "We contacted Philips / Signify technical sales. The 3000K optical modules share the exact same housing and driver specifications as the 4000K tender baseline, and the supplier confirmed zero lead time impact for the 35 units required for Zone 1.",
    'admin', 'David Spiteri', 'MEP Project Manager',
    'Task # E-12.01 · Recessed modular LED panels (WP-05)',
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
    'msg-rep-01b', projectId, t1Id,
    'Re: Level 1 Executive Boardroom & Hospitality Suite Luminaire Temperature',
    "Enser Ltd approves the 3000K variant on Drawing 2618-L-LTG-01 subject to maintaining average 500 lux across the meeting table surface in accordance with CIBSE Code for Lighting.",
    'usr-enser-01', 'Ing. Christian Borg', 'Consultant Electrical Engineer (Enser Ltd)',
    'Task # E-12.01 · Recessed modular LED panels (WP-05)',
    d3, d3
  );

  // Thread 2: Subcontractor Message
  const t2Id = 'msg-bov-sub-02';
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
    'Level 2 Main Riser Containment Clearances & Cat 6 Trunking Alignment',
    "Urgent coordination on Level 2: the chilled water piping bracket in Shaft B is positioned 180mm closer to the cable tray flange than indicated on drawing 2618-S-ELE-01. We require site engineer confirmation before pulling the Cat 6 bundles to ensure minimum 150mm separation from chilled water lines.",
    'usr-sub-01', 'Kevin Bonnici', 'Lead Electrical Subcontractor (ElectroData Ltd)',
    'Task # D-06.0 · 4-pair Cat 6 UTP (3,070m) (WP-06)',
    'Level2_ShaftB_Pipe_Clearance.png', 'https://example.com/clearance.png', 'image/png',
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
    'msg-rep-02a', projectId, t2Id,
    'Re: Level 2 Main Riser Containment Clearances & Cat 6 Trunking Alignment',
    "Inspected on site at 14:00 with HVAC foreman. We will offset the cable basket by 100mm towards the structural masonry wall using Unistrut brackets. The Cat 6 cables will have a safe 220mm clearance from the insulated pipework.",
    'usr-eng-01', 'Marco Vella', 'Site Mechanical & Electrical Engineer',
    'Task # D-06.0 · 4-pair Cat 6 UTP (3,070m) (WP-06)',
    d4, d4
  );

  // Thread 3: Team Message
  const t3Id = 'msg-bov-team-03';
  db.prepare(`
    INSERT INTO project_messages (
      id, project_id, channel, parent_id, subject, body,
      sender_id, sender_name, sender_role, priority,
      linked_item_type, linked_item_id, linked_item_label,
      is_pinned, is_unread, reply_count, last_reply_at, created_at, updated_at
    ) VALUES (?, ?, 'team', NULL, ?, ?, ?, ?, ?, 'Normal', 'drawing', 'dwg-2618-s-ele-01', ?, 0, 0, 1, ?, ?, ?)
  `).run(
    t3Id, projectId,
    'Enser Ltd Witness Testing for Submain Panel DB-L1 & Earth Fault Relay',
    "Please ensure that the factory test reports and calibrated injection test kits are prepared for the 400A MCCB with integrated electronic trip unit for DB-L1. Testing is scheduled for Wednesday 10:30 AM.",
    'usr-enser-01', 'Ing. Christian Borg', 'Consultant Electrical Engineer (Enser Ltd)',
    'Drawing 2618-S-ELE-01 · Electrical Distribution Single Line',
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
    'msg-rep-03a', projectId, t3Id,
    'Re: Enser Ltd Witness Testing for Submain Panel DB-L1 & Earth Fault Relay',
    "Understood. The panel builder has issued the calibrated test certificates (traceable to UKAS/EN standards), and our electrical testing engineer will have the secondary injection test kit set up 30 minutes prior.",
    'admin', 'David Spiteri', 'MEP Project Manager',
    'Drawing 2618-S-ELE-01 · Electrical Distribution Single Line',
    d4, d4
  );
}
