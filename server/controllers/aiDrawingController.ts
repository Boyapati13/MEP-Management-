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
  ProjectSetupSource,
  ProjectSetupSuggestion,
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
  extractBoqItemsFromText,
  applyContractorIntelligenceAndVerify,
  normalizeDate,
} from "../services/contractorDocIntelligence";

export function registerAiDrawingController(app: Express): void {
  const upload = multer({ storage: multer.memoryStorage() });

  // Instant Contract & BOQ Auto-Fill Preview / Parse Endpoint
  app.post("/api/projects/parse-document", authRequired, upload.single("file"), async (req: Request, res: Response) => {
    try {
      let filename = req.body?.filename || "document.txt";
      let dataUrl = req.body?.attachment_data || "";

      if (req.file) {
        filename = req.file.originalname || filename;
        const mime = req.file.mimetype || "application/octet-stream";
        dataUrl = `data:${mime};base64,${req.file.buffer.toString("base64")}`;
      }

      if (!dataUrl) {
        res.status(400).json({ error: "No document provided for auto-fill extraction" });
        return;
      }

      const extractedDoc = await extractDocumentText(dataUrl, filename);
      let rawText = "";
      if (extractedDoc.kind === "text") {
        rawText = extractedDoc.text;
      } else if (req.file) {
        rawText = req.file.buffer.toString("utf-8");
      }

      const extracted = extractContractorDocumentIntelligence(rawText, filename);
      const boqItems = extracted.boqItems || extractBoqItemsFromText(rawText, filename, extracted.trades, extracted.budget);
      const boqTotal = boqItems.reduce((s, r) => s + (Number(r.tender_amount) || 0), 0);
      const disciplines = Array.from(new Set(boqItems.map(b => b.discipline).filter(Boolean)));
      const systems = Array.from(new Set(boqItems.map(b => b.system).filter(Boolean)));

      const fnLower = filename.toLowerCase();
      let documentCategory = "Contract";
      if (fnLower.includes("boq") || fnLower.includes("bill of quantities") || fnLower.endsWith(".csv") || fnLower.endsWith(".tsv") || fnLower.endsWith(".xlsx")) {
        documentCategory = "BOQ";
      } else if (fnLower.includes("tender") || fnLower.includes("rfq") || fnLower.includes("quote")) {
        documentCategory = "Tender";
      } else if (fnLower.includes("prog") || fnLower.includes("sched")) {
        documentCategory = "Programme";
      } else if (fnLower.includes("spec")) {
        documentCategory = "Specification";
      }

      res.json({
        success: true,
        filename,
        document_category: documentCategory,
        extracted: {
          ...extracted,
          budget: extracted.budget || (boqTotal > 0 ? boqTotal : 500000),
        },
        boq_items: boqItems,
        boq_summary: {
          count: boqItems.length,
          total_amount: boqTotal,
          disciplines,
          systems,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to parse document for auto-fill" });
    }
  });

  // BOQ & Contract File Import (supports CSV, TSV, TXT, PDF, DOCX)
  app.post("/api/boq/import", authRequired, upload.single("file"), async (req: Request, res: Response) => {
    try {
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
        res.status(400).json({ error: "A CSV, XLSX, PDF, DOCX, or text-based BOQ/Contract file is required" });
        return;
      }

      const filename = file.originalname;
      const mimeType = file.mimetype || "application/octet-stream";
      const attData = `data:${mimeType};base64,` + file.buffer.toString("base64");

      const textExtraction = await extractDocumentText(attData, filename);
      const textContent = textExtraction.kind === "text" ? textExtraction.text : file.buffer.toString("utf-8");

      const extractedMeta = extractContractorDocumentIntelligence(textContent, filename);
      const lines = textContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

      const parsedRows: Array<Record<string, any>> = [];
      if (lines.length >= 2 && /[,;\t]/.test(lines[0])) {
        const separator = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
        const headerCols = lines[0].split(separator).map(normaliseHeader);
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(separator);
          const rowObj: Record<string, string> = {};
          for (let j = 0; j < headerCols.length; j++) {
            rowObj[headerCols[j]] = (parts[j] || "").trim().replace(/^["']|["']$/g, "");
          }
          if (rowObj.description || rowObj.itemdescription || rowObj.scope || rowObj.name) {
            parsedRows.push(rowObj);
          }
        }
      }

      // If not a simple CSV header file (e.g., PDF/DOCX/Contract or multi-line header BOQ), use intelligent BOQ extractor
      if (parsedRows.length === 0) {
        const smartBoq = extractedMeta.boqItems || extractBoqItemsFromText(textContent, filename, extractedMeta.trades, extractedMeta.budget);
        for (const sb of smartBoq) {
          parsedRows.push({
            itemnumber: sb.item_number,
            description: sb.description,
            unit: sb.unit,
            tenderquantity: String(sb.tender_quantity),
            tenderrate: String(sb.tender_rate),
            tenderamount: String(sb.tender_amount),
            discipline: sb.discipline,
            system: sb.system,
            building: sb.building || "Main Building",
            floor: sb.floor || "All Levels",
            area: sb.area || "Site-Wide",
          });
        }
      }

      const docId = crypto.randomUUID();
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
      const createdBoqRows: Array<{ id: string; code: string; desc: string; disc: string; sys: string; unit: string; qty: number; amount: number }> = [];

      for (const r of parsedRows) {
        const description = r.description || r.itemdescription || r.scope || r.name;
        if (!description) continue;

        const qty = parseImportNumber(r.tenderquantity || r.quantity || r.qty) || 1;
        const rate = parseImportNumber(r.tenderrate || r.rate || r.unitrate || r.price);
        const amount = parseImportNumber(r.tenderamount || r.amount || r.total || r.value) || (qty * rate);
        const calcRate = rate > 0 ? rate : (qty > 0 ? Math.round((amount / qty) * 100) / 100 : amount);
        const discipline = (r.discipline || r.trade || r.category || "MEP").trim();
        const system = (r.system || r.subsystem || `${discipline} System`).trim();
        const itemCode = r.itemnumber || r.itemno || r.code || r.number || `${imported + 1}.01`;
        const unit = r.unit || r.uom || "Item";
        const itemId = crypto.randomUUID();

        insertBoq.run(
          itemId, projectId, itemCode, description,
          unit, qty, calcRate, amount,
          parseImportNumber(r.revisedquantity) || qty, parseImportNumber(r.installedquantity),
          parseImportNumber(r.claimedquantity), parseImportNumber(r.certifiedquantity),
          discipline, system, r.building || "Main Building", r.floor || r.level || "All Levels", r.area || r.room || "Site-Wide",
          docId, now
        );

        createdBoqRows.push({ id: itemId, code: itemCode, desc: description, disc: discipline, sys: system, unit, qty, amount });
        imported++;
        totalAmount += amount;
        if (discipline) disciplines.add(discipline);
        if (system) systems.add(`${discipline}:${system}`);
      }

      if (imported === 0) {
        res.status(400).json({ error: "No rows contained a usable description column" });
        return;
      }

      // Auto-fill Project Master fields (budget + any blank client/dates/contractor fields extracted from the document)
      const projRow = db.prepare("SELECT * FROM projects WHERE id=?").get(projectId) as any;
      if (projRow) {
        const finalBudget = totalAmount > 0 ? totalAmount : (extractedMeta.budget || projRow.budget || 0);
        const nextClient = (!projRow.client || projRow.client === "Primary Employer / Client") && extractedMeta.client ? extractedMeta.client : projRow.client;
        const nextStart = !projRow.start_date && extractedMeta.startDate ? extractedMeta.startDate : projRow.start_date;
        const nextEnd = !projRow.end_date && extractedMeta.endDate ? extractedMeta.endDate : projRow.end_date;
        const nextContractor = !projRow.main_contractor && extractedMeta.mainContractor ? extractedMeta.mainContractor : projRow.main_contractor;
        const nextConsultant = !projRow.consultant && extractedMeta.consultant ? extractedMeta.consultant : projRow.consultant;
        const nextLocation = !projRow.location && extractedMeta.location ? extractedMeta.location : projRow.location;
        db.prepare(`
          UPDATE projects
          SET budget=?, contract_value=?, client=?, client_name=?, start_date=?, end_date=?,
              main_contractor=?, consultant=?, location=?
          WHERE id=?
        `).run(finalBudget, finalBudget, nextClient, nextClient, nextStart, nextEnd, nextContractor, nextConsultant, nextLocation, projectId);
      }

      // Update Job Costing Budget lines (by discipline)
      db.prepare("DELETE FROM costs WHERE project_id=? AND category='BOQ / Tender Import'").run(projectId);
      const discTotals = new Map<string, number>();
      for (const row of createdBoqRows) {
        discTotals.set(row.disc, (discTotals.get(row.disc) || 0) + row.amount);
      }
      const insertCost = db.prepare("INSERT INTO costs VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const [disc, sumAmt] of discTotals.entries()) {
        insertCost.run(
          crypto.randomUUID(), projectId, disc || "BOQ / Tender Import",
          `${disc} Trade Budget (Auto-filled from ${filename})`, sumAmt, 0, today
        );
      }

      // Auto-fill WBS & Work Packages
      const insertWbs = db.prepare("INSERT INTO wbs_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const existingWps = new Set(
        (db.prepare("SELECT UPPER(discipline) as d FROM work_packages WHERE project_id=?").all(projectId) as any[]).map(w => w.d)
      );
      let wpCreatedCount = 0;
      for (const d of disciplines) {
        insertWbs.run(crypto.randomUUID(), projectId, null, d.slice(0, 12).toUpperCase(), d, "Discipline", d, "", 1);
        if (!existingWps.has(d.toUpperCase())) {
          db.prepare(`
            INSERT INTO work_packages (id, project_id, name, code, discipline, description, budget_allocated, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?)
          `).run(
            crypto.randomUUID(), projectId, `${d} Engineering & Installation Package`,
            `WP-${d.slice(0, 4).toUpperCase()}`, d, `Auto-created from BOQ import (${filename})`,
            discTotals.get(d) || 0, now
          );
          existingWps.add(d.toUpperCase());
          wpCreatedCount++;
        }
      }
      for (const s of systems) {
        const [d, sys] = s.split(":");
        insertWbs.run(crypto.randomUUID(), projectId, null, `${d.slice(0, 6).toUpperCase()}-${sys.slice(0, 6).toUpperCase()}`, sys, "System", d, sys, 1);
      }

      // Auto-fill Programme Tasks & Material Requests from imported BOQ
      const existingTasks = new Set(
        (db.prepare("SELECT LOWER(title) as t FROM tasks WHERE project_id=?").all(projectId) as any[]).map(r => r.t)
      );
      const existingMats = new Set(
        (db.prepare("SELECT LOWER(item) as i FROM material_requests WHERE project_id=?").all(projectId) as any[]).map(r => r.i)
      );
      let tasksCreated = 0;
      let matsCreated = 0;
      const baseStart = extractedMeta.startDate || today;
      for (const s of systems) {
        const [d, sys] = s.split(":");
        const title = `${sys || d} — Supply, Installation & Testing`;
        if (!existingTasks.has(title.toLowerCase())) {
          const endIso = new Date(Date.now() + (14 + tasksCreated * 7) * 86400000).toISOString().split("T")[0];
          db.prepare(`
            INSERT INTO tasks (id, project_id, title, trade, assignee, start, end, progress, status, wbs_code, priority, description)
            VALUES (?, ?, ?, ?, 'MEP Site Team', ?, ?, 0, 'Not Started', ?, 'High', ?)
          `).run(crypto.randomUUID(), projectId, title, d || "MEP", baseStart, endIso, `BOQ-${tasksCreated + 1}`, `Auto-generated from BOQ system: ${sys}`);
          existingTasks.add(title.toLowerCase());
          tasksCreated++;
        }
      }
      for (const row of createdBoqRows) {
        if (!existingMats.has(row.desc.toLowerCase())) {
          const reqDate = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
          db.prepare(`
            INSERT INTO material_requests (id, project_id, item, spec, quantity, unit, required_date, supplier, status, boq_item_id, wbs_code)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Approved MEP Vendor', 'Draft', ?, ?)
          `).run(
            crypto.randomUUID(), projectId, row.desc, `${row.disc} — ${row.sys} (BOQ #${row.code})`,
            row.qty, row.unit, reqDate, row.id, row.code
          );
          existingMats.add(row.desc.toLowerCase());
          matsCreated++;
        }
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
        work_packages_created: wpCreatedCount,
        tasks_created: tasksCreated,
        material_requests_created: matsCreated,
        project_budget_updated: totalAmount > 0,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "BOQ import failed" });
    }
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

      // Run full Contractor Document Intelligence on the extracted text
      const primaryDoc = docs[0];
      const combinedDocText = sources.map(s => s.text).join("\n\n");
      let extracted = extractContractorDocumentIntelligence(combinedDocText, primaryDoc.attachment_name || primaryDoc.name || "Contractor Document");

      let source: "ai" | "reference" = "reference";
      const apiKey = process.env.GEMINI_API_KEY;

      if (apiKey && combinedDocText.length > 50) {
        try {
          const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { "User-Agent": "aistudio-build" } } });
          const prompt = [
            "You are an expert MEP construction manager analyzing contractor agreement / RFQ / tender documents.",
            "Extract the following metadata accurately from the text below. Return ONLY valid JSON.",
            "Fields: projectName (string), client (string), mainContractor (string), subcontractor (string), consultant (string),",
            "budget (number), currency (string, e.g. EUR, USD, AED, GBP), startDate (YYYY-MM-DD), endDate (YYYY-MM-DD),",
            "location (string), contractType (string), trades (array of strings, e.g. Electrical, HVAC, Plumbing, Fire Fighting, ELV),",
            "milestones (array of {title: string, trade: string, priority: string}).",
            "",
            "--- DOCUMENT EXCERPT ---",
            combinedDocText.slice(0, 25000)
          ].join("\n");

          let result: any;
          try {
            result = await ai.models.generateContent({ model: "gemini-3.8-flash", contents: prompt });
          } catch {
            result = await ai.models.generateContent({ model: "gemini-3.6-flash", contents: prompt });
          }
          const raw = String(result.text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
          const parsed = JSON.parse(raw);
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
          source = "ai";
        } catch (err: any) {
          console.warn("Project setup extraction AI fallback to rule engine:", err?.message);
        }
      }

      // Build structured suggestions list by combining rule-engine fallback with contractor intelligence
      const fallbackList = fallbackProjectSetupSuggestions(sources);
      const suggestionMap = new Map<string, ProjectSetupSuggestion>();
      for (const item of fallbackList) {
        suggestionMap.set(item.field, item);
      }

      const firstSource = sources[0];
      if (extracted.projectName && !suggestionMap.has("name")) {
        suggestionMap.set("name", {
          field: "name",
          value: extracted.projectName,
          confidence: "High",
          source_document_id: firstSource.id,
          source_document_name: firstSource.name,
          source_excerpt: extracted.sourceExcerpts?.projectName || `Project: ${extracted.projectName}`
        });
      }
      if (extracted.client && !suggestionMap.has("client")) {
        suggestionMap.set("client", {
          field: "client",
          value: extracted.client,
          confidence: "High",
          source_document_id: firstSource.id,
          source_document_name: firstSource.name,
          source_excerpt: extracted.sourceExcerpts?.client || `Client: ${extracted.client}`
        });
      }
      if (extracted.startDate && !suggestionMap.has("start_date")) {
        suggestionMap.set("start_date", {
          field: "start_date",
          value: extracted.startDate,
          confidence: "High",
          source_document_id: firstSource.id,
          source_document_name: firstSource.name,
          source_excerpt: extracted.sourceExcerpts?.startDate || `Start Date: ${extracted.startDate}`
        });
      }
      if (extracted.endDate && !suggestionMap.has("end_date")) {
        suggestionMap.set("end_date", {
          field: "end_date",
          value: extracted.endDate,
          confidence: "High",
          source_document_id: firstSource.id,
          source_document_name: firstSource.name,
          source_excerpt: extracted.sourceExcerpts?.endDate || `End Date: ${extracted.endDate}`
        });
      }
      if (extracted.budget && !suggestionMap.has("budget")) {
        suggestionMap.set("budget", {
          field: "budget",
          value: extracted.budget,
          confidence: "High",
          source_document_id: firstSource.id,
          source_document_name: firstSource.name,
          source_excerpt: extracted.sourceExcerpts?.budget || `Budget: ${extracted.budget} ${extracted.currency}`
        });
      }

      // Sync extracted object with fallback suggestions if missing
      if (!extracted.projectName && suggestionMap.has("name")) extracted.projectName = String(suggestionMap.get("name")!.value);
      if (!extracted.client && suggestionMap.has("client")) extracted.client = String(suggestionMap.get("client")!.value);
      if (!extracted.startDate && suggestionMap.has("start_date")) extracted.startDate = String(suggestionMap.get("start_date")!.value);
      if (!extracted.endDate && suggestionMap.has("end_date")) extracted.endDate = String(suggestionMap.get("end_date")!.value);
      if (!extracted.budget && suggestionMap.has("budget")) extracted.budget = Number(suggestionMap.get("budget")!.value);

      const suggestions = Array.from(suggestionMap.values());
      const shouldAutoApply = req.body?.auto_apply === true;
      let verifiedResult: any = null;

      if (shouldAutoApply) {
        const b64 = (primaryDoc.attachment_data || "").replace(/^data:.*?;base64,/, "");
        const primaryBuffer = Buffer.from(b64, "base64");
        verifiedResult = applyContractorIntelligenceAndVerify(
          db,
          extracted,
          {
            name: primaryDoc.attachment_name || primaryDoc.name || "Contractor Document",
            buffer: primaryBuffer,
            mimeType: "application/pdf"
          },
          projectId,
          req.user!.user_id
        );
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
          auto_updated: shouldAutoApply,
          report: verifiedResult?.report || null
        }
      );

      const existingProject = db.prepare("SELECT * FROM projects WHERE id=?").get(projectId) as any;
      res.json({
        success: true,
        auto_updated: shouldAutoApply,
        project_id: projectId,
        project: verifiedResult?.project || existingProject,
        report: verifiedResult?.report || null,
        work_packages: verifiedResult?.workPackages || [],
        tasks: verifiedResult?.tasks || [],
        extracted,
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

}
