import { Express } from "express";
import crypto from "crypto";
import { broadcastRealtimeEvent } from "../services/auditService";

export function registerFieldNotesRoutes(
  app: Express,
  db: any,
  authRequired: any,
  hasProjectAccess: any,
  writeAudit: any
) {
  // GET field notes for a project
  app.get("/api/field_notes", authRequired, (req: any, res: any) => {
    try {
      const { project_id, category, status } = req.query;
      if (!project_id || typeof project_id !== "string") {
        return res.status(400).json({ error: "project_id query parameter is required" });
      }
      if (!hasProjectAccess(req.user, project_id)) {
        return res.status(403).json({ error: "Forbidden: no access to this project" });
      }
      const clauses = ["project_id = ?"];
      const params: any[] = [project_id];
      if (category && category !== "All") {
        clauses.push("category = ?");
        params.push(category);
      }
      if (status && status !== "All") {
        clauses.push("status = ?");
        params.push(status);
      }
      const rows = db
        .prepare(`SELECT * FROM field_notes WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`)
        .all(...params);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create a new field note
  app.post("/api/field_notes", authRequired, (req: any, res: any) => {
    try {
      const b = req.body || {};
      const projectId = b.project_id;
      if (!projectId) {
        return res.status(400).json({ error: "project_id is required" });
      }
      if (!hasProjectAccess(req.user, projectId)) {
        return res.status(403).json({ error: "Forbidden: no access to this project" });
      }
      const title = String(b.title || "").trim();
      const body = String(b.body || "").trim();
      if (!title && !body) {
        return res.status(400).json({ error: "Either title or note body is required" });
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const finalTitle = title || body.slice(0, 80);
      const finalBody = body || finalTitle;

      db.prepare(`
        INSERT INTO field_notes (
          id, project_id, title, body, category, discipline, zone_location,
          priority, status, linked_punch_id, tags, created_by, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        projectId,
        finalTitle,
        finalBody,
        b.category || "Site Walk",
        b.discipline || "General",
        b.zone_location || "",
        b.priority || "Medium",
        b.status || "Draft",
        null,
        b.tags || "",
        req.user.user_id,
        req.user.name || req.user.username || "Engineer",
        now,
        now
      );

      writeAudit(req.user, projectId, "field_notes", id, "CREATE", { title: finalTitle, category: b.category || "Site Walk" });
      broadcastRealtimeEvent({
        type: "mutation",
        userId: req.user.user_id,
        module: "field_notes",
        recordId: id,
        projectId,
        action: "CREATE",
      });

      const created = db.prepare("SELECT * FROM field_notes WHERE id = ?").get(id);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update field note
  app.put("/api/field_notes/:id", authRequired, (req: any, res: any) => {
    try {
      const existing = db.prepare("SELECT * FROM field_notes WHERE id = ?").get(req.params.id) as any;
      if (!existing) return res.status(404).json({ error: "Field note not found" });
      if (!hasProjectAccess(req.user, existing.project_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const b = req.body || {};
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE field_notes
        SET title = ?, body = ?, category = ?, discipline = ?, zone_location = ?,
            priority = ?, status = ?, tags = ?, updated_at = ?
        WHERE id = ?
      `).run(
        b.title !== undefined ? String(b.title).trim() : existing.title,
        b.body !== undefined ? String(b.body).trim() : existing.body,
        b.category !== undefined ? b.category : existing.category,
        b.discipline !== undefined ? b.discipline : existing.discipline,
        b.zone_location !== undefined ? b.zone_location : existing.zone_location,
        b.priority !== undefined ? b.priority : existing.priority,
        b.status !== undefined ? b.status : existing.status,
        b.tags !== undefined ? b.tags : existing.tags,
        now,
        existing.id
      );

      writeAudit(req.user, existing.project_id, "field_notes", existing.id, "UPDATE", { status: b.status || existing.status });
      broadcastRealtimeEvent({
        type: "mutation",
        userId: req.user.user_id,
        module: "field_notes",
        recordId: existing.id,
        projectId: existing.project_id,
        action: "UPDATE",
      });
      res.json(db.prepare("SELECT * FROM field_notes WHERE id = ?").get(existing.id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE field note
  app.delete("/api/field_notes/:id", authRequired, (req: any, res: any) => {
    try {
      const existing = db.prepare("SELECT * FROM field_notes WHERE id = ?").get(req.params.id) as any;
      if (!existing) return res.status(404).json({ error: "Field note not found" });
      if (!hasProjectAccess(req.user, existing.project_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      db.prepare("DELETE FROM field_notes WHERE id = ?").run(existing.id);
      writeAudit(req.user, existing.project_id, "field_notes", existing.id, "DELETE", { title: existing.title });
      broadcastRealtimeEvent({
        type: "mutation",
        userId: req.user.user_id,
        module: "field_notes",
        recordId: existing.id,
        projectId: existing.project_id,
        action: "DELETE",
      });
      res.json({ deleted: true, id: existing.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST convert single field note -> official punchlist snag item
  app.post("/api/field_notes/:id/convert-to-snag", authRequired, (req: any, res: any) => {
    try {
      const note = db.prepare("SELECT * FROM field_notes WHERE id = ?").get(req.params.id) as any;
      if (!note) return res.status(404).json({ error: "Field note not found" });
      if (!hasProjectAccess(req.user, note.project_id)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (note.linked_punch_id) {
        const existingPunch = db.prepare("SELECT * FROM punchlist WHERE id = ?").get(note.linked_punch_id);
        if (existingPunch) {
          return res.json({ note, punch_item: existingPunch, already_converted: true });
        }
      }

      const b = req.body || {};
      const punchId = crypto.randomUUID();
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();
      const snagText = String(b.item || `${note.title}${note.body && note.body !== note.title ? ` — ${note.body}` : ""}`).trim();
      const trade = b.trade || note.discipline || "General";
      const location = b.location || note.zone_location || "Site Wide";
      const priority = b.priority || note.priority || "Medium";

      db.exec("BEGIN TRANSACTION");
      try {
        db.prepare(`
          INSERT INTO punchlist (id, project_id, item, trade, location, priority, date_raised, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'Open')
        `).run(punchId, note.project_id, snagText, trade, location, priority, today);

        db.prepare(`
          UPDATE field_notes
          SET status = 'Converted to Snag', linked_punch_id = ?, updated_at = ?
          WHERE id = ?
        `).run(punchId, now, note.id);
        db.exec("COMMIT");
      } catch (txErr) {
        try { db.exec("ROLLBACK"); } catch {}
        throw txErr;
      }

      writeAudit(req.user, note.project_id, "punchlist", punchId, "CREATE_FROM_NOTE", { note_id: note.id, item: snagText });
      broadcastRealtimeEvent({
        type: "mutation",
        userId: req.user.user_id,
        module: "punchlist",
        recordId: punchId,
        projectId: note.project_id,
        action: "CREATE",
      });
      broadcastRealtimeEvent({
        type: "mutation",
        userId: req.user.user_id,
        module: "field_notes",
        recordId: note.id,
        projectId: note.project_id,
        action: "UPDATE",
      });

      res.status(201).json({
        note: db.prepare("SELECT * FROM field_notes WHERE id = ?").get(note.id),
        punch_item: db.prepare("SELECT * FROM punchlist WHERE id = ?").get(punchId),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST batch snag list creator -> creates N punchlist items in one atomic transaction
  app.post("/api/punchlist/batch", authRequired, (req: any, res: any) => {
    try {
      const b = req.body || {};
      const projectId = b.project_id;
      const items = Array.isArray(b.items) ? b.items : [];
      if (!projectId) return res.status(400).json({ error: "project_id is required" });
      if (!hasProjectAccess(req.user, projectId)) return res.status(403).json({ error: "Forbidden" });
      if (items.length === 0) return res.status(400).json({ error: "At least one snag item is required" });

      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();
      const createdIds: string[] = [];
      const linkedNoteIds: string[] = [];

      const insertPunch = db.prepare(`
        INSERT INTO punchlist (id, project_id, item, trade, location, priority, date_raised, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateNote = db.prepare(`
        UPDATE field_notes SET status = 'Converted to Snag', linked_punch_id = ?, updated_at = ? WHERE id = ? AND project_id = ?
      `);

      db.exec("BEGIN TRANSACTION");
      try {
        for (const raw of items) {
          const text = String(raw.item || "").trim();
          if (!text) continue;
          const pid = crypto.randomUUID();
          insertPunch.run(
            pid,
            projectId,
            text,
            raw.trade || "General",
            raw.location || "Site Wide",
            raw.priority || "Medium",
            raw.date_raised || today,
            raw.status || "Open"
          );
          createdIds.push(pid);
          if (raw.note_id) {
            updateNote.run(pid, now, raw.note_id, projectId);
            linkedNoteIds.push(raw.note_id);
          }
        }
        db.exec("COMMIT");
      } catch (txErr) {
        try { db.exec("ROLLBACK"); } catch {}
        throw txErr;
      }

      if (createdIds.length === 0) {
        return res.status(400).json({ error: "No valid non-empty snag descriptions provided" });
      }

      writeAudit(req.user, projectId, "punchlist", createdIds[0], "BATCH_CREATE", {
        count: createdIds.length,
        list_title: b.list_title || "Site Walk Snag List",
      });
      broadcastRealtimeEvent({
        type: "mutation",
        userId: req.user.user_id,
        module: "punchlist",
        recordId: createdIds[0],
        projectId,
        action: "CREATE",
      });
      if (linkedNoteIds.length > 0) {
        broadcastRealtimeEvent({
          type: "mutation",
          userId: req.user.user_id,
          module: "field_notes",
          recordId: linkedNoteIds[0],
          projectId,
          action: "UPDATE",
        });
      }

      const placeholders = createdIds.map(() => "?").join(",");
      const created = db.prepare(`SELECT * FROM punchlist WHERE id IN (${placeholders})`).all(...createdIds);
      res.status(201).json({ count: created.length, items: created });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
