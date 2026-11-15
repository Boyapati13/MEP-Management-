import { Express, Request, Response, NextFunction } from "express";
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
import { answerCopilotQuestion, getProjectCopilotContext } from "../services/copilotService";

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

  // BOQ & Contract File Import (supports CSV, TSV, TXT, PDF, DOCX, XLSX)
  app.post(
    "/api/boq/import",
    authRequired,
    (req: Request, res: Response, next: NextFunction) => {
      upload.single("file")(req, res, (err: any) => {
        if (err) {
          return res.status(400).json({ error: `File upload error: ${err?.message || String(err)}` });
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      try {
        let projectId = req.body?.project_id;
        // Project ID fallback if empty, undefined, or 'all'
        if (!projectId || projectId === "all" || projectId === "ALL") {
          if (req.user!.role === "Admin") {
            const firstProj = db.prepare("SELECT id FROM projects ORDER BY rowid DESC LIMIT 1").get() as any;
            if (firstProj) projectId = firstProj.id;
          } else {
            const userProj = db.prepare(
              "SELECT project_id FROM project_memberships WHERE user_id=? AND active=1 LIMIT 1"
            ).get(req.user!.user_id) as any;
            if (userProj) projectId = userProj.project_id;
            else {
              const anyProj = db.prepare("SELECT id FROM projects LIMIT 1").get() as any;
              if (anyProj) projectId = anyProj.id;
            }
          }
        }

        if (!projectId) {
          res.status(400).json({ error: "No active project found. Please select or create a project first." });
          return;
        }

        if (!hasProjectAccess(req.user!, projectId) && req.user!.role !== "Admin") {
          res.status(403).json({ error: "You do not have access to this project" });
          return;
        }

        const canImport =
          canEdit(req.user!, "budget") ||
          canEdit(req.user!, "projects") ||
          canEdit(req.user!, "documents") ||
          ["Admin", "ProjectManager", "CommercialManager", "SiteEngineer"].includes(req.user!.role);

        if (!canImport) {
          res.status(403).json({
            error: `Your role (${req.user!.role}) does not have permission to import BOQs. Permitted roles: Admin, ProjectManager, CommercialManager, SiteEngineer.`,
          });
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

        // Search for delimited table header within first 30 lines
        const headerIdx = lines.findIndex(l =>
          /(description|item|scope|particulars|material)/i.test(l) &&
          /(qty|quantity|rate|amount|total|price|unit|uom|disc|trade)/i.test(l) &&
          /[,;\t|]/.test(l)
        );

        if (headerIdx !== -1) {
          const headerLine = lines[headerIdx];
          const separator = headerLine.includes("\t") ? "\t" : headerLine.includes("|") ? "|" : headerLine.includes(";") ? ";" : ",";
          const headerCols = headerLine.split(separator).map(normaliseHeader);
          for (let i = headerIdx + 1; i < lines.length; i++) {
            const parts = lines[i].split(separator);
            const rowObj: Record<string, string> = {};
            for (let j = 0; j < headerCols.length; j++) {
              rowObj[headerCols[j]] = (parts[j] || "").trim().replace(/^["']|["']$/g, "");
            }
            if (rowObj.description || rowObj.itemdescription || rowObj.scope || rowObj.name || rowObj.item || rowObj.particulars) {
              parsedRows.push(rowObj);
            }
          }
        } else if (lines.length >= 2 && /[,;\t]/.test(lines[0])) {
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

        // If not a simple delimited file (e.g., PDF/DOCX/Contract or complex header BOQ), use intelligent BOQ extractor
        if (parsedRows.length === 0) {
          const smartBoq = extractedMeta.boqItems || extractBoqItemsFromText(textContent, filename, extractedMeta.trades, extractedMeta.budget);
          for (const sb of smartBoq) {
            parsedRows.push({
              itemnumber: sb.item_number,
              description: sb.description,
              specification: sb.specification || `${sb.discipline} — ${sb.system} | ${sb.description} (BOQ #${sb.item_number}, UOM: ${sb.unit})`,
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

      const insertBoq = db.prepare(`
        INSERT INTO boq_items (
          id, project_id, item_number, description, specification, unit,
          tender_quantity, tender_rate, tender_amount, revised_quantity,
          installed_quantity, claimed_quantity, certified_quantity,
          discipline, system, building, floor, area, source_document_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const createdBoqRows: Array<{ id: string; code: string; desc: string; spec: string; disc: string; sys: string; unit: string; qty: number; amount: number; area: string }> = [];

      for (const r of parsedRows) {
        const description = r.description || r.itemdescription || r.scope || r.name || r.material || r.item;
        if (!description) continue;

        const qty = parseImportNumber(r.tenderquantity || r.quantity || r.qty) || 1;
        const rate = parseImportNumber(r.tenderrate || r.rate || r.unitrate || r.price);
        const amount = parseImportNumber(r.tenderamount || r.amount || r.total || r.value) || (qty * rate);
        const calcRate = rate > 0 ? rate : (qty > 0 ? Math.round((amount / qty) * 100) / 100 : amount);
        const discipline = (r.discipline || r.trade || r.category || "MEP").trim();
        const system = (r.system || r.subsystem || `${discipline} System`).trim();
        const itemCode = r.itemnumber || r.itemno || r.code || r.number || `${imported + 1}.01`;
        const unit = r.unit || r.uom || "Item";
        const specText =
          r.specification ||
          r.spec ||
          r.technicalspecification ||
          r.specifications ||
          r.notes ||
          r.remarks ||
          `${discipline} — ${system} | ${description} (BOQ #${itemCode}, UOM: ${unit})`;
        const areaText = r.area || r.room || "Site-Wide";
        const itemId = crypto.randomUUID();

        insertBoq.run(
          itemId, projectId, itemCode, description, specText,
          unit, qty, calcRate, amount,
          parseImportNumber(r.revisedquantity) || qty, parseImportNumber(r.installedquantity),
          parseImportNumber(r.claimedquantity), parseImportNumber(r.certifiedquantity),
          discipline, system, r.building || "Main Building", r.floor || r.level || "All Levels", areaText,
          docId, now
        );

        createdBoqRows.push({ id: itemId, code: itemCode, desc: description, spec: specText, disc: discipline, sys: system, unit, qty, amount, area: areaText });
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
      const insertCost = db.prepare("INSERT INTO costs (id, project_id, category, description, planned, actual, date_logged) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const [disc, sumAmt] of discTotals.entries()) {
        insertCost.run(
          crypto.randomUUID(), projectId, disc || "BOQ / Tender Import",
          `${disc} Trade Budget (Auto-filled from ${filename})`, sumAmt, 0, today
        );
      }

      // Auto-fill WBS & Work Packages
      const insertWbs = db.prepare("INSERT INTO wbs_items (id, project_id, parent_id, code, name, level, discipline, system, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
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

      const wpByDisc = new Map<string, string>();
      const allProjectWps = db.prepare("SELECT id, discipline FROM work_packages WHERE project_id=?").all(projectId) as any[];
      for (const w of allProjectWps) {
        if (w.discipline) wpByDisc.set(String(w.discipline).toUpperCase(), w.id);
      }

      // Auto-fill Programme Tasks & Material Requests from imported BOQ
      const existingTasks = new Set(
        (db.prepare("SELECT LOWER(title) as t FROM tasks WHERE project_id=?").all(projectId) as any[]).map(r => r.t)
      );
      const existingMats = new Set(
        (db.prepare("SELECT LOWER(COALESCE(material, item, description, '')) as i FROM material_requests WHERE project_id=?").all(projectId) as any[]).map(r => r.i)
      );
      let tasksCreated = 0;
      let matsCreated = 0;
      const baseStart = extractedMeta.startDate || today;
      for (const s of systems) {
        const [d, sys] = s.split(":");
        const title = `${sys || d} — Supply, Installation & Testing`;
        if (!existingTasks.has(title.toLowerCase())) {
          const endIso = new Date(Date.now() + (14 + tasksCreated * 7) * 86400000).toISOString().split("T")[0];
          const wpId = wpByDisc.get((d || "").toUpperCase()) || allProjectWps[0]?.id || null;
          db.prepare(`
            INSERT INTO tasks (id, project_id, title, trade, assignee, start, end, progress, status, wbs_code, priority, work_package_id, description)
            VALUES (?, ?, ?, ?, 'MEP Site Team', ?, ?, 0, 'Not Started', ?, 'High', ?, ?)
          `).run(crypto.randomUUID(), projectId, title, d || "MEP", baseStart, endIso, `BOQ-${tasksCreated + 1}`, wpId, `Auto-generated from BOQ system: ${sys}`);
          existingTasks.add(title.toLowerCase());
          tasksCreated++;
        }
      }

      const insertMatReq = db.prepare(`
        INSERT INTO material_requests (
          id, project_id, location, discipline, system, material, item, specification, spec,
          description, quantity, unit, required_date, boq_reference, boq_item_id, wbs_code,
          supplier, work_package_id, requested_by, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertProcItem = db.prepare(`
        INSERT INTO procurement_items (
          id, project_id, pr_number, material, specification, boq_reference,
          quantity, unit, required_on_site, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const row of createdBoqRows) {
        if (!existingMats.has(row.desc.toLowerCase())) {
          const reqDate = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
          const wpId = wpByDisc.get((row.disc || "").toUpperCase()) || allProjectWps[0]?.id || null;
          insertMatReq.run(
            crypto.randomUUID(),
            projectId,
            row.area || "Site-Wide",
            row.disc || "MEP",
            row.sys || "General",
            row.desc,
            row.desc,
            row.spec,
            row.spec,
            row.spec,
            row.qty,
            row.unit,
            reqDate,
            row.code,
            row.id,
            row.code,
            "Approved MEP Vendor",
            wpId,
            req.user!.user_id,
            "Draft"
          );
          insertProcItem.run(
            crypto.randomUUID(),
            projectId,
            `MR-${row.code}`,
            row.desc,
            row.spec,
            row.code,
            row.qty,
            row.unit,
            reqDate,
            "Requested"
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

  // MEP Project Copilot Intelligence endpoint (answers all questions with full project context)
  app.post(["/api/ai/chat", "/api/copilot/ask", "/api/copilot"], authRequired, async (req: Request, res: Response) => {
    try {
      const result = await answerCopilotQuestion(req.user!, req.body);
      res.json({
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("Copilot error:", err);
      res.status(500).json({ error: err.message || "Failed to process Copilot query" });
    }
  });

  // Project Copilot Quick Facts & Context
  app.get("/api/ai/copilot/context", authRequired, (req: Request, res: Response) => {
    try {
      const projectId = (req.query.project_id as string) || undefined;
      const ctx = getProjectCopilotContext(projectId, req.user);
      if (!ctx) {
        res.status(404).json({ error: "Project not found or accessible" });
        return;
      }
      const p = ctx.project;
      res.json({
        project_id: p.id,
        name: p.name,
        code: p.code,
        client: p.client || p.client_name,
        main_contractor: p.main_contractor,
        consultant: p.consultant,
        budget: p.budget || p.contract_value || ctx.boqSummary.totalAmount,
        currency: p.currency || "USD",
        start_date: p.start_date,
        end_date: p.end_date,
        status: p.status,
        stage: p.stage,
        work_packages_count: ctx.workPackages.length,
        boq_count: ctx.boqSummary.count,
        boq_total_amount: ctx.boqSummary.totalAmount,
        open_snags_count: ctx.punchlist.openCount,
        documents_count: ctx.documents.length,
        submittals_count: ctx.submittals.length,
        tasks_count: ctx.tasks.total,
        risks_count: ctx.risks.length,
        workforce_today_count: ctx.workforceToday.length,
        disciplines: ctx.boqSummary.byDiscipline.map(d => d.discipline),
        documents_list: ctx.documents.slice(0, 16).map(d => ({
          id: d.id,
          code: d.document_number || d.category || "DOC",
          name: d.name || d.attachment_name,
          category: d.category,
          discipline: d.discipline,
          revision: d.revision,
        })),
        submittals_list: ctx.submittals.slice(0, 12).map(s => ({
          id: s.id,
          number: s.number || "SUB",
          title: s.title || s.item,
          manufacturer: s.manufacturer,
          model_no: s.model_no,
          drawing_ref: s.drawing_ref,
          approval_code: s.approval_code || s.status,
          status: s.status,
        })),
      });
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

  // =========================================================================
  // DRAWING REVISION CONTROL (NEW VERSION UPLOAD) & SITE MARKINGS ON DRAWINGS
  // =========================================================================

  // Get revision history + site markings for a specific drawing/document
  app.get("/api/documents/:id/revisions", authRequired, (req: Request, res: Response) => {
    try {
      const docId = String(req.params.id);
      const doc = rowToDict(db.prepare("SELECT * FROM documents WHERE id = ?").get(docId));
      if (!doc) {
        res.status(404).json({ error: "Document or drawing not found" });
        return;
      }
      let parsedMarkup: any = {};
      try {
        parsedMarkup = doc.markup_data ? (typeof doc.markup_data === "string" ? JSON.parse(doc.markup_data) : doc.markup_data) : {};
      } catch {
        parsedMarkup = {};
      }

      // Seed default CAD redline pen & markup shapes on 2618 sheets if none exist yet
      if (!Array.isArray(parsedMarkup.shapes)) {
        if (doc.document_number === "2618-L-LTG-01" || String(doc.name || "").includes("2618-L-LTG-01")) {
          parsedMarkup.shapes = [
            {
              id: "shp-seed-cloud-1",
              type: "cloud",
              color: "#ef4444",
              strokeWidth: 3,
              x1: 24,
              y1: 31,
              x2: 46,
              y2: 52,
              label: "REV CLOUD: Area K1 24x LED 600x600 Circuit L2/C1-C3 Verified",
              author: "Carmelo Vella",
            },
            {
              id: "shp-seed-arrow-1",
              type: "arrow",
              color: "#f59e0b",
              strokeWidth: 3,
              x1: 58,
              y1: 46,
              x2: 67,
              y2: 55,
              label: "Relocate PIR Sensor",
              author: "Carmelo Vella",
            },
            {
              id: "shp-seed-rect-1",
              type: "rect",
              color: "#10b981",
              strokeWidth: 3,
              x1: 62,
              y1: 50,
              x2: 76,
              y2: 63,
              label: "Boardroom DALI Zone",
              author: "Ing. Mark Camilleri",
            },
            {
              id: "shp-seed-text-1",
              type: "text",
              color: "#ef4444",
              strokeWidth: 3,
              x1: 25,
              y1: 28,
              x2: 45,
              y2: 30,
              text: "REDLINE CHANGE: Add 2x 3hr Maintained Emergency Pack (L2/EM-04)",
              author: "Carmelo Vella",
            },
            {
              id: "shp-seed-pen-1",
              type: "pen",
              color: "#3b82f6",
              strokeWidth: 3,
              points: [
                { x: 46, y: 41 },
                { x: 50, y: 41.5 },
                { x: 54, y: 43 },
                { x: 58, y: 45 },
                { x: 62, y: 50 },
              ],
              author: "Carmelo Vella",
            },
          ];
          db.prepare("UPDATE documents SET markup_data = ? WHERE id = ?").run(JSON.stringify(parsedMarkup), docId);
          doc.markup_data = JSON.stringify(parsedMarkup);
        } else {
          parsedMarkup.shapes = [];
        }
      }

      const revisions = db
        .prepare("SELECT * FROM document_revisions WHERE document_id = ? ORDER BY created_at DESC")
        .all(docId)
        .map(rowToDict);
      const markings = db
        .prepare("SELECT * FROM drawing_markings WHERE document_id = ? ORDER BY created_at ASC")
        .all(docId)
        .map(rowToDict);
      res.json({
        document: doc,
        current_revision: doc.revision || "Rev A",
        revisions,
        markings,
        shapes: parsedMarkup.shapes || [],
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load drawing revisions" });
    }
  });

  // Save freehand pen strokes & vector markup shapes (cloud, rect, ellipse, arrow, line, highlighter, text) on a drawing
  app.put("/api/documents/:id/markup-shapes", authRequired, (req: Request, res: Response) => {
    try {
      const docId = String(req.params.id);
      const existing = rowToDict(db.prepare("SELECT * FROM documents WHERE id = ?").get(docId));
      if (!existing) {
        res.status(404).json({ error: "Drawing not found" });
        return;
      }
      let parsedMarkup: any = {};
      try {
        parsedMarkup = existing.markup_data
          ? typeof existing.markup_data === "string"
            ? JSON.parse(existing.markup_data)
            : existing.markup_data
          : {};
      } catch {
        parsedMarkup = {};
      }

      const shapes = Array.isArray(req.body?.shapes) ? req.body.shapes : [];
      parsedMarkup.shapes = shapes;
      parsedMarkup.lastMarkupUpdatedBy = req.user?.name || req.user?.user_id || "Site Engineer";
      parsedMarkup.lastMarkupUpdatedAt = new Date().toISOString();

      const serialized = JSON.stringify(parsedMarkup);
      db.prepare("UPDATE documents SET markup_data = ? WHERE id = ?").run(serialized, docId);

      const updatedDoc = rowToDict(db.prepare("SELECT * FROM documents WHERE id = ?").get(docId));
      res.json({
        success: true,
        document: updatedDoc,
        shapes,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to save drawing markup shapes" });
    }
  });

  // Upload a new version/revision of an existing drawing or document
  app.post("/api/documents/:id/new-version", authRequired, async (req: Request, res: Response) => {
    try {
      const docId = String(req.params.id);
      const existing = rowToDict(db.prepare("SELECT * FROM documents WHERE id = ?").get(docId));
      if (!existing) {
        res.status(404).json({ error: "Drawing or document not found" });
        return;
      }

      const newRevision = String(req.body?.new_revision || req.body?.revision || req.body?.revision_code || "Rev B").trim();
      const changeSummary = String(req.body?.change_summary || req.body?.notes || `Updated to ${newRevision}`).trim();
      const newAttachmentData = req.body?.attachment_data || existing.attachment_data;
      const newAttachmentName = req.body?.attachment_name || existing.attachment_name;
      const newStatus = req.body?.status || existing.status || "Approved";
      const carryOverMarkings = req.body?.carry_over_markings !== false;
      const nowIso = new Date().toISOString();
      const actorName = req.user?.name || req.user?.user_id || "Project Engineer";

      // 1. Archive the previous revision into document_revisions
      const revId = `rev-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO document_revisions (
          id, document_id, project_id, revision_code, superseded_date,
          changed_by, change_summary, attachment_name, attachment_data, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        revId,
        docId,
        existing.project_id,
        existing.revision || "Rev 0",
        nowIso.slice(0, 10),
        actorName,
        changeSummary,
        existing.attachment_name || null,
        existing.attachment_data || null,
        nowIso
      );

      // 2. Extract text if a new file was uploaded, and append revision note to extracted_text for AI Copilot
      let updatedExtractedText = existing.extracted_text || "";
      if (req.body?.attachment_data && req.body.attachment_data !== existing.attachment_data) {
        try {
          const parsed = await extractDocumentText(req.body.attachment_data, newAttachmentName || existing.name || "drawing");
          if (parsed.kind === "text" && parsed.text.trim().length > 20) {
            updatedExtractedText = parsed.text.slice(0, 50000);
          }
        } catch {}
      }
      const revNote = `\n[Revision Update ${newRevision} on ${nowIso.slice(0, 10)} by ${actorName}]: ${changeSummary}`;
      updatedExtractedText = `${updatedExtractedText}${revNote}`.trim();

      // 3. Update the main document record to the new version
      db.prepare(`
        UPDATE documents
        SET revision = ?,
            status = ?,
            date_added = ?,
            attachment_name = ?,
            attachment_data = ?,
            extracted_text = ?
        WHERE id = ?
      `).run(
        newRevision,
        newStatus,
        nowIso.slice(0, 10),
        newAttachmentName,
        newAttachmentData,
        updatedExtractedText,
        docId
      );

      // 4. Carry over existing site markings to the new revision if requested
      if (carryOverMarkings) {
        db.prepare("UPDATE drawing_markings SET revision = ?, updated_at = ? WHERE document_id = ?").run(
          newRevision,
          nowIso,
          docId
        );
      }

      // 5. Log a project update so the site timeline shows the new drawing version
      try {
        db.prepare(`
          INSERT INTO project_updates (
            id, project_id, title, category, content, trade, location, pinned, created_by, created_by_name, created_at
          ) VALUES (?, ?, ?, 'Drawing Revision', ?, ?, ?, 0, ?, ?, ?)
        `).run(
          `upd-${crypto.randomUUID().slice(0, 8)}`,
          existing.project_id,
          `Drawing ${existing.document_number || existing.name} Updated to ${newRevision}`,
          `New version ${newRevision} issued (superseding ${existing.revision || "Rev 0"}): ${changeSummary}`,
          existing.discipline || "Electrical",
          existing.document_number || "Site",
          req.user?.user_id || "admin",
          actorName,
          nowIso
        );
      } catch {}

      const updatedDoc = rowToDict(db.prepare("SELECT * FROM documents WHERE id = ?").get(docId));
      const revisions = db
        .prepare("SELECT * FROM document_revisions WHERE document_id = ? ORDER BY created_at DESC")
        .all(docId)
        .map(rowToDict);

      res.status(201).json({
        success: true,
        document: updatedDoc,
        revisions,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to upload new drawing version" });
    }
  });

  // Get site markings for a drawing or project
  app.get("/api/documents/:id/markings", authRequired, (req: Request, res: Response) => {
    try {
      const docId = String(req.params.id);
      const rows = db
        .prepare("SELECT * FROM drawing_markings WHERE document_id = ? ORDER BY created_at ASC")
        .all(docId)
        .map(rowToDict);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to fetch drawing site markings" });
    }
  });

  app.get("/api/drawing-markings", authRequired, (req: Request, res: Response) => {
    try {
      const projectId = req.query.project_id ? String(req.query.project_id) : "";
      const docId = req.query.document_id ? String(req.query.document_id) : "";
      let rows: any[] = [];
      if (docId) {
        rows = db.prepare("SELECT * FROM drawing_markings WHERE document_id = ? ORDER BY created_at ASC").all(docId).map(rowToDict);
      } else if (projectId) {
        rows = db.prepare("SELECT * FROM drawing_markings WHERE project_id = ? ORDER BY created_at DESC").all(projectId).map(rowToDict);
      } else {
        rows = db.prepare("SELECT * FROM drawing_markings ORDER BY created_at DESC LIMIT 200").all().map(rowToDict);
      }
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to fetch drawing markings" });
    }
  });

  // Create a new Site Marking / Redline Pin on a drawing
  app.post("/api/documents/:id/markings", authRequired, (req: Request, res: Response) => {
    try {
      const docId = String(req.params.id);
      const doc = rowToDict(db.prepare("SELECT * FROM documents WHERE id = ?").get(docId));
      if (!doc) {
        res.status(404).json({ error: "Drawing not found" });
        return;
      }

      const existingCount = (db.prepare("SELECT COUNT(*) as c FROM drawing_markings WHERE document_id = ?").get(docId) as any)?.c || 0;
      const pinNumber = req.body?.pin_number || `MK-${String(existingCount + 1).padStart(2, "0")}`;
      const xPercent = Math.max(2, Math.min(98, Number(req.body?.x_percent ?? 50)));
      const yPercent = Math.max(2, Math.min(98, Number(req.body?.y_percent ?? 50)));
      const markingType = String(req.body?.marking_type || "Site Progress / Installed");
      const title = String(req.body?.title || "Site Marking Update").trim();
      const description = String(req.body?.description || "").trim();
      const trade = String(req.body?.trade || doc.discipline || "Electrical");
      const status = String(req.body?.status || "Installed / Verified");
      const progressPercent = Number(req.body?.progress_percent ?? (status === "Installed / Verified" ? 100 : 50));
      const linkedTaskId = req.body?.linked_task_id || null;
      const nowIso = new Date().toISOString();
      const actorName = req.user?.name || req.user?.user_id || "Site Supervisor";
      const markingId = `mk-${crypto.randomUUID().slice(0, 8)}`;

      db.prepare(`
        INSERT INTO drawing_markings (
          id, document_id, project_id, drawing_number, revision, pin_number,
          x_percent, y_percent, marking_type, title, description, trade,
          status, progress_percent, linked_task_id, created_by, created_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        markingId,
        docId,
        doc.project_id,
        doc.document_number || doc.name,
        doc.revision || "Rev A",
        pinNumber,
        xPercent,
        yPercent,
        markingType,
        title,
        description,
        trade,
        status,
        progressPercent,
        linkedTaskId,
        req.user?.user_id || "admin",
        actorName,
        nowIso,
        nowIso
      );

      // Append site marking note to drawing extracted_text so AI Copilot can answer questions about site markings on the drawing
      const markingText = `\n[Site Marking ${pinNumber} (${markingType} - ${status}, ${progressPercent}%) on ${doc.document_number || doc.name} at (${Math.round(xPercent)}%, ${Math.round(yPercent)}%) by ${actorName}]: ${title}. ${description}`;
      db.prepare("UPDATE documents SET extracted_text = COALESCE(extracted_text, '') || ? WHERE id = ?").run(markingText, docId);

      // Optionally update linked WBS task progress
      if (linkedTaskId && progressPercent >= 0) {
        try {
          db.prepare("UPDATE tasks SET progress = ?, status = ? WHERE id = ?").run(
            progressPercent,
            progressPercent >= 100 ? "Completed" : progressPercent > 0 ? "In Progress" : "Not Started",
            linkedTaskId
          );
        } catch {}
      }

      // Also post a site update entry so the project timeline reflects the drawing site marking
      try {
        db.prepare(`
          INSERT INTO project_updates (
            id, project_id, title, category, content, progress_percent, trade, location, pinned, created_by, created_by_name, created_at
          ) VALUES (?, ?, ?, 'Drawing Site Marking', ?, ?, ?, ?, 0, ?, ?, ?)
        `).run(
          `upd-${crypto.randomUUID().slice(0, 8)}`,
          doc.project_id,
          `[${doc.document_number || "DWG"} ${pinNumber}] ${title}`,
          `${markingType} marked on Drawing ${doc.document_number || doc.name} (${doc.revision || "Rev A"}): ${description || title}`,
          progressPercent,
          trade,
          `${doc.document_number || "Drawing"} (${Math.round(xPercent)}%, ${Math.round(yPercent)}%)`,
          req.user?.user_id || "admin",
          actorName,
          nowIso
        );
      } catch {}

      const created = rowToDict(db.prepare("SELECT * FROM drawing_markings WHERE id = ?").get(markingId));
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to save drawing site marking" });
    }
  });

  // Update a site marking status/progress/notes
  app.put("/api/drawing-markings/:markingId", authRequired, (req: Request, res: Response) => {
    try {
      const markingId = String(req.params.markingId);
      const existing = rowToDict(db.prepare("SELECT * FROM drawing_markings WHERE id = ?").get(markingId));
      if (!existing) {
        res.status(404).json({ error: "Site marking not found" });
        return;
      }
      const title = req.body?.title ?? existing.title;
      const description = req.body?.description ?? existing.description;
      const markingType = req.body?.marking_type ?? existing.marking_type;
      const status = req.body?.status ?? existing.status;
      const progressPercent = req.body?.progress_percent !== undefined ? Number(req.body.progress_percent) : existing.progress_percent;
      const nowIso = new Date().toISOString();

      db.prepare(`
        UPDATE drawing_markings
        SET title = ?, description = ?, marking_type = ?, status = ?, progress_percent = ?, updated_at = ?
        WHERE id = ?
      `).run(title, description, markingType, status, progressPercent, nowIso, markingId);

      const updated = rowToDict(db.prepare("SELECT * FROM drawing_markings WHERE id = ?").get(markingId));
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to update site marking" });
    }
  });

  app.delete("/api/drawing-markings/:markingId", authRequired, (req: Request, res: Response) => {
    try {
      const markingId = String(req.params.markingId);
      db.prepare("DELETE FROM drawing_markings WHERE id = ?").run(markingId);
      res.json({ deleted: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to delete site marking" });
    }
  });

  // =========================================================================
  // ADMIN PROFILE & COMMAND HIERARCHY (ADMIN -> PM -> SITES -> SUPERVISORS -> WORKERS)
  // =========================================================================
  app.get("/api/admin/command-hierarchy", authRequired, (req: Request, res: Response) => {
    try {
      const users = db.prepare(`
        SELECT u.id, u.username, u.name, u.role, u.email, u.phone, u.company_id, u.company, u.trade,
          u.work_package_id, u.worker_id, u.stakeholder_type, u.created_by_admin, u.status, u.created_at,
          (SELECT GROUP_CONCAT(p.name, ', ') FROM project_memberships pm JOIN projects p ON p.id = pm.project_id WHERE pm.user_id = u.id AND pm.active = 1) as project_names
        FROM users u
        ORDER BY u.name ASC
      `).all().map(rowToDict);
      const projects = db.prepare("SELECT * FROM projects ORDER BY name ASC").all().map(rowToDict);
      const sites = db.prepare("SELECT * FROM sites ORDER BY name ASC").all().map(rowToDict);
      const workers = db.prepare("SELECT * FROM workers ORDER BY name ASC").all().map(rowToDict);
      const workPackages = db.prepare("SELECT * FROM work_packages ORDER BY code ASC").all().map(rowToDict);

      const adminUsers = users.filter((u: any) => u.role === "Admin");
      const pmUsers = users.filter((u: any) => u.role === "ProjectManager");
      const supervisorUsers = users.filter((u: any) => u.role === "SiteEngineer" || u.role === "QAQC" || u.role === "SafetyOfficer");

      // Build structured Project Manager -> Projects -> Sites -> Site Supervisors -> Workers tree
      const projectManagers = pmUsers.map((pm: any) => {
        const pmProjects = projects.filter(
          (p: any) =>
            p.project_manager_id === pm.id ||
            (p.project_manager_name && p.project_manager_name.toLowerCase().includes((pm.name || "").toLowerCase()))
        );

        const enrichedProjects = pmProjects.map((proj: any) => {
          const projSites = sites.filter((s: any) => s.project_id === proj.id);
          const projWorkers = workers.filter((w: any) => w.project_id === proj.id);

          const enrichedSites = projSites.map((site: any) => {
            const siteWorkers = projWorkers.filter((w: any) => w.site_id === site.id);
            const supUser = users.find((u: any) => u.id === site.supervisor_id) || null;
            return {
              ...site,
              supervisor: supUser || {
                id: site.supervisor_id || "sup-default",
                name: site.supervisor_name || proj.site_supervisor_name || "Assigned Site Supervisor",
                role: "Site Supervisor",
              },
              workers: siteWorkers,
            };
          });

          // Group workers by supervisor on this project as well
          const supervisorMap = new Map<string, { supervisor: any; sites: string[]; workers: any[] }>();
          for (const site of enrichedSites) {
            const supKey = site.supervisor?.id || site.supervisor_name || "default";
            if (!supervisorMap.has(supKey)) {
              supervisorMap.set(supKey, {
                supervisor: site.supervisor,
                sites: [site.name],
                workers: [],
              });
            } else {
              const entry = supervisorMap.get(supKey)!;
              if (!entry.sites.includes(site.name)) entry.sites.push(site.name);
            }
          }
          for (const w of projWorkers) {
            const supKey = w.supervisor_id || w.supervisor_name || "default";
            const supUser = users.find((u: any) => u.id === w.supervisor_id);
            if (!supervisorMap.has(supKey)) {
              supervisorMap.set(supKey, {
                supervisor: supUser || { id: supKey, name: w.supervisor_name || "Site Supervisor", role: "SiteEngineer", trade: w.trade },
                sites: [],
                workers: [w],
              });
            } else {
              supervisorMap.get(supKey)!.workers.push(w);
            }
          }

          return {
            ...proj,
            sites: enrichedSites,
            supervisors: Array.from(supervisorMap.values()),
            workers: projWorkers,
          };
        });

        const totalSitesUnderPm = enrichedProjects.reduce((acc: number, p: any) => acc + p.sites.length, 0);
        const totalWorkersUnderPm = enrichedProjects.reduce((acc: number, p: any) => acc + p.workers.length, 0);

        return {
          ...pm,
          projects: enrichedProjects,
          total_projects: enrichedProjects.length,
          total_sites: totalSitesUnderPm,
          total_workers: totalWorkersUnderPm,
        };
      }).sort((a: any, b: any) => (b.total_workers - a.total_workers) || (b.total_projects - a.total_projects));

      const currentAdmin = adminUsers.find((u: any) => u.id === req.user?.user_id) || adminUsers[0] || {
        id: req.user?.user_id || "admin",
        name: req.user?.name || "Executive Administrator",
        username: "admin",
        role: "Admin",
        email: "admin@mepfieldhub.com",
        company: "MEP FieldHub Enterprise",
      };

      let authorizedMainAdmins: any[] = [];
      try {
        authorizedMainAdmins = db.prepare("SELECT * FROM authorized_main_admins ORDER BY created_at DESC").all().map(rowToDict);
      } catch {}

      res.json({
        adminProfile: {
          ...currentAdmin,
          total_project_managers: pmUsers.length,
          total_projects: projects.length,
          total_sites: sites.length,
          total_supervisors: supervisorUsers.length,
          total_workers: workers.length,
        },
        authorizedMainAdmins,
        projectManagers,
        supervisors: supervisorUsers,
        projects,
        sites,
        workers,
        workPackages,
        users,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load command hierarchy" });
    }
  });

  app.post("/api/admin/assign-hierarchy", authRequired, (req: Request, res: Response) => {
    try {
      const action = String(req.body?.action || "");
      const nowIso = new Date().toISOString();

      if (action === "assign_project_leadership") {
        const { project_id, project_manager_id, project_manager_name, site_supervisor_id, site_supervisor_name } = req.body;
        db.prepare(`
          UPDATE projects
          SET project_manager_id = COALESCE(?, project_manager_id),
              project_manager_name = COALESCE(?, project_manager_name),
              site_supervisor_id = COALESCE(?, site_supervisor_id),
              site_supervisor_name = COALESCE(?, site_supervisor_name)
          WHERE id = ?
        `).run(project_manager_id || null, project_manager_name || null, site_supervisor_id || null, site_supervisor_name || null, project_id);
        res.json({ success: true });
        return;
      }

      if (action === "assign_site_supervisor") {
        const { site_id, supervisor_id, supervisor_name } = req.body;
        db.prepare("UPDATE sites SET supervisor_id = ?, supervisor_name = ? WHERE id = ?").run(
          supervisor_id || null,
          supervisor_name || null,
          site_id
        );
        // Also update workers on that site if requested
        if (req.body?.update_site_workers) {
          db.prepare("UPDATE workers SET supervisor_id = ?, supervisor_name = ? WHERE site_id = ?").run(
            supervisor_id || null,
            supervisor_name || null,
            site_id
          );
        }
        res.json({ success: true });
        return;
      }

      if (action === "create_or_assign_worker") {
        const { id, name, employee_id, trade, phone, email, project_id, site_id, supervisor_id, supervisor_name, role_on_site } = req.body;
        if (id) {
          db.prepare(`
            UPDATE workers
            SET name = COALESCE(?, name),
                trade = COALESCE(?, trade),
                project_id = COALESCE(?, project_id),
                site_id = COALESCE(?, site_id),
                supervisor_id = COALESCE(?, supervisor_id),
                supervisor_name = COALESCE(?, supervisor_name),
                role_on_site = COALESCE(?, role_on_site)
            WHERE id = ?
          `).run(name || null, trade || null, project_id || null, site_id || null, supervisor_id || null, supervisor_name || null, role_on_site || null, id);
          res.json({ success: true, id });
          return;
        } else {
          const newId = `wrk-${crypto.randomUUID().slice(0, 8)}`;
          db.prepare(`
            INSERT INTO workers (
              id, project_id, site_id, name, employee_id, trade, employment_type,
              nationality, phone, email, supervisor_id, supervisor_name, role_on_site, status, hired_date, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'Permanent', 'Malta / EU', ?, ?, ?, ?, ?, 'Active', ?, ?)
          `).run(
            newId,
            project_id || "bov-st-venera-2618",
            site_id || "site-2618-l1",
            name,
            employee_id || `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
            trade || "Electrical",
            phone || "",
            email || "",
            supervisor_id || "usr-sup-elec",
            supervisor_name || "Carmelo Vella",
            role_on_site || "MEP Site Technician",
            nowIso.slice(0, 10),
            nowIso
          );
          res.status(201).json({ success: true, id: newId });
          return;
        }
      }

      if (action === "create_site") {
        const { project_id, name, address, city, supervisor_id, supervisor_name } = req.body;
        const newSiteId = `site-${crypto.randomUUID().slice(0, 8)}`;
        db.prepare(`
          INSERT INTO sites (
            id, project_id, name, address, city, country, latitude, longitude,
            geofence_radius_m, geofence_warning_radius_m, timezone, status, supervisor_id, supervisor_name, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, 'Malta', 35.8902, 14.4775, 120, 180, 'Europe/Malta', 'Active', ?, ?, ?, ?)
        `).run(
          newSiteId,
          project_id || "bov-st-venera-2618",
          name,
          address || "Triq il-Kanun, Santa Venera",
          city || "Santa Venera",
          supervisor_id || "usr-sup-elec",
          supervisor_name || "Carmelo Vella",
          req.user?.user_id || "admin",
          nowIso
        );
        res.status(201).json({ success: true, id: newSiteId });
        return;
      }

      if (action === "create_staff" || action === "provision_stakeholder") {
        const { name, username, role, email, phone, company, trade, project_id, stakeholder_type, password, work_package_id } = req.body;
        const cleanEmail = String(email || "").trim().toLowerCase();
        const cleanUsername = String(username || cleanEmail.split("@")[0] || name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 14)).trim().toLowerCase();
        if (!name || !cleanEmail) {
          res.status(400).json({ error: "Full Name and Email ID are required to create a user account." });
          return;
        }
        const existingUser = db.prepare("SELECT id FROM users WHERE LOWER(username)=? OR LOWER(email)=?").get(cleanUsername, cleanEmail) as any;
        const newUserId = existingUser?.id || `usr-${crypto.randomUUID().slice(0, 8)}`;
        const pwHash = hashPassword(password || "admin123");
        const resolvedRole = role || "SiteEngineer";
        const resolvedStakeholder =
          stakeholder_type ||
          (resolvedRole === "Client"
            ? "Client / Employer"
            : resolvedRole === "Subcontractor"
            ? "Subcontractor"
            : resolvedRole === "Consultant"
            ? "Consultant"
            : resolvedRole === "Admin"
            ? "Main Admin"
            : "Employee (Internal)");

        const targetProjectIds: string[] = [];
        if (project_id && project_id !== "ALL") {
          targetProjectIds.push(String(project_id));
        } else {
          const allProjs = db.prepare("SELECT id FROM projects").all() as any[];
          for (const p of allProjs) targetProjectIds.push(p.id);
        }
        const primaryProjId = targetProjectIds[0] || "bov-st-venera-2618";

        // Resolve or create company record for Subcontractor / Client / Consultant so company-scoped access checks succeed
        let resolvedCompanyId: string | null = null;
        if (company && (resolvedRole === "Subcontractor" || resolvedRole === "Client" || resolvedRole === "Consultant")) {
          try {
            const existingComp = db.prepare("SELECT id FROM companies WHERE LOWER(name)=LOWER(?) LIMIT 1").get(String(company).trim()) as any;
            resolvedCompanyId = existingComp?.id || `comp-${crypto.randomUUID().slice(0, 8)}`;
            if (!existingComp) {
              db.prepare(`
                INSERT OR IGNORE INTO companies (id, name, type, trade, contact_person, email, phone, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?)
              `).run(
                resolvedCompanyId,
                String(company).trim(),
                resolvedRole === "Client" ? "Client" : resolvedRole,
                trade || "MEP",
                name,
                cleanEmail,
                phone || "",
                nowIso
              );
            }
            for (const pid of targetProjectIds) {
              const pcExists = db.prepare("SELECT 1 FROM project_companies WHERE project_id=? AND company_id=?").get(pid, resolvedCompanyId);
              if (!pcExists) {
                db.prepare("INSERT OR IGNORE INTO project_companies (id, project_id, company_id, role_in_project, created_at) VALUES (?, ?, ?, ?, ?)").run(
                  `pc-${crypto.randomUUID().slice(0, 8)}`,
                  pid,
                  resolvedCompanyId,
                  resolvedRole,
                  nowIso
                );
              }
            }
          } catch {}
        }

        // Resolve work_package_id for Subcontractor so Subcontractor Portal Command Center works out of the box
        let resolvedWpId: string | null = work_package_id || null;
        if (resolvedRole === "Subcontractor" && !resolvedWpId) {
          try {
            const wpMatch = db.prepare(
              "SELECT id FROM work_packages WHERE project_id=? AND (LOWER(discipline) LIKE LOWER(?) OR LOWER(name) LIKE LOWER(?)) LIMIT 1"
            ).get(primaryProjId, `%${(trade || "Electrical").split(" ")[0]}%`, `%${(trade || "Electrical").split(" ")[0]}%`) as any;
            const anyWp = wpMatch || (db.prepare("SELECT id FROM work_packages WHERE project_id=? LIMIT 1").get(primaryProjId) as any);
            if (anyWp) resolvedWpId = anyWp.id;
          } catch {}
        }

        if (existingUser) {
          db.prepare(`
            UPDATE users
            SET name=?, role=?, email=?, phone=?, company_id=COALESCE(?, company_id), company=?, trade=?,
                work_package_id=COALESCE(?, work_package_id), stakeholder_type=?, status='Active'
            WHERE id=?
          `).run(
            name,
            resolvedRole,
            cleanEmail,
            phone || "",
            resolvedCompanyId,
            company || "Enser / MEP Delivery",
            trade || "Multi-Discipline MEP",
            resolvedWpId,
            resolvedStakeholder,
            newUserId
          );
        } else {
          db.prepare(`
            INSERT INTO users (
              id, username, name, password_hash, role, email, phone, company_id, company, trade,
              work_package_id, access_scope, status, stakeholder_type, created_by_admin, created_at, must_change_password
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?, 0)
          `).run(
            newUserId,
            cleanUsername,
            name,
            pwHash,
            resolvedRole,
            cleanEmail,
            phone || "",
            resolvedCompanyId,
            company || "Enser / MEP Delivery",
            trade || "Multi-Discipline MEP",
            resolvedWpId,
            resolvedRole === "Subcontractor" ? "work_package" : "company",
            resolvedStakeholder,
            req.user?.name || "Main Admin",
            nowIso
          );
        }

        // If role === 'Worker', also link/create a worker profile so WorkerMobileShell works immediately on login
        if (resolvedRole === "Worker") {
          try {
            const wrkId = `wrk-${crypto.randomUUID().slice(0, 8)}`;
            const firstSite = db.prepare("SELECT id, supervisor_id, supervisor_name FROM sites WHERE project_id=? LIMIT 1").get(primaryProjId) as any;
            db.prepare(`
              INSERT OR IGNORE INTO workers (
                id, user_id, project_id, site_id, name, employee_id, trade, employment_type,
                nationality, phone, email, supervisor_id, supervisor_name, role_on_site, status, hired_date, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Permanent', 'Malta / EU', ?, ?, ?, ?, 'MEP Site Technician', 'Active', ?, ?)
            `).run(
              wrkId,
              newUserId,
              primaryProjId,
              firstSite?.id || "site-2618-l1",
              name,
              `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
              trade || "Electrical",
              phone || "",
              cleanEmail,
              firstSite?.supervisor_id || "usr-sup-elec",
              firstSite?.supervisor_name || "Carmelo Vella",
              nowIso.slice(0, 10),
              nowIso
            );
            db.prepare("UPDATE users SET worker_id=? WHERE id=?").run(wrkId, newUserId);
          } catch {}
        }

        for (const pid of targetProjectIds) {
          db.prepare("INSERT OR IGNORE INTO project_memberships (user_id, project_id, access_role, active) VALUES (?, ?, ?, 1)").run(
            newUserId,
            pid,
            resolvedRole
          );
        }
        if (project_id && project_id !== "ALL") {
          if (resolvedRole === "ProjectManager" && action === "create_staff") {
            db.prepare("UPDATE projects SET project_manager_id = ?, project_manager_name = ? WHERE id = ?").run(newUserId, name, project_id);
          } else if (resolvedRole === "SiteEngineer" && action === "create_staff") {
            db.prepare("UPDATE projects SET site_supervisor_id = ?, site_supervisor_name = ? WHERE id = ?").run(newUserId, name, project_id);
          }
        }
        res.status(201).json({
          success: true,
          id: newUserId,
          username: cleanUsername,
          email: cleanEmail,
          role: resolvedRole,
          stakeholder_type: resolvedStakeholder,
          company_id: resolvedCompanyId,
          work_package_id: resolvedWpId,
        });
        return;
      }

      if (action === "toggle_main_admin_status") {
        const { email } = req.body;
        const cleanEmail = String(email || "").trim().toLowerCase();
        const existing = db.prepare("SELECT * FROM authorized_main_admins WHERE LOWER(email)=?").get(cleanEmail) as any;
        if (!existing) {
          res.status(404).json({ error: "Authorized Main Admin record not found" });
          return;
        }
        const nextStatus = existing.status === "Revoked" ? (existing.user_id ? "Activated" : "Authorized") : "Revoked";
        db.prepare("UPDATE authorized_main_admins SET status=? WHERE LOWER(email)=?").run(nextStatus, cleanEmail);
        if (existing.user_id) {
          db.prepare("UPDATE users SET status=? WHERE id=?").run(nextStatus === "Revoked" ? "Inactive" : "Active", existing.user_id);
        }
        res.json({ success: true, email: cleanEmail, status: nextStatus });
        return;
      }

      if (action === "delete_main_admin") {
        const { email } = req.body;
        const cleanEmail = String(email || "").trim().toLowerCase();
        const existing = db.prepare("SELECT * FROM authorized_main_admins WHERE LOWER(email)=?").get(cleanEmail) as any;
        if (existing?.user_id) {
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(existing.user_id);
          db.prepare("DELETE FROM users WHERE id=? AND username != 'admin'").run(existing.user_id);
        }
        db.prepare("DELETE FROM authorized_main_admins WHERE LOWER(email)=?").run(cleanEmail);
        res.json({ success: true, email: cleanEmail });
        return;
      }

      if (action === "authorize_main_admin") {
        const { email, admin_name, company_name, plan, username, password, notes, provision_now } = req.body;
        const cleanEmail = String(email || "").trim().toLowerCase();
        if (!cleanEmail || !admin_name || !company_name) {
          res.status(400).json({ error: "Main Admin Email ID, Full Name, and Company Name are required." });
          return;
        }
        const cleanUsername = String(username || cleanEmail.split("@")[0] || "main_admin").trim().toLowerCase();
        const shouldActivate = provision_now !== false && Boolean(password || true);
        const pwHash = hashPassword(password || "admin123");
        let userId: string | null = null;

        if (shouldActivate) {
          const existing = db.prepare("SELECT id FROM users WHERE LOWER(email)=? OR LOWER(username)=?").get(cleanEmail, cleanUsername) as any;
          userId = existing?.id || `usr-admin-${crypto.randomUUID().slice(0, 6)}`;
          if (existing) {
            db.prepare(`
              UPDATE users SET name=?, email=?, company=?, role='Admin', status='Active', stakeholder_type='Main Admin' WHERE id=?
            `).run(admin_name, cleanEmail, company_name, userId);
          } else {
            db.prepare(`
              INSERT INTO users (id, username, name, password_hash, role, email, company, trade, status, stakeholder_type, created_by_admin, created_at, must_change_password)
              VALUES (?, ?, ?, ?, 'Admin', ?, ?, 'All MEP Disciplines', 'Active', 'Main Admin', 'Our Company (Platform Owner)', ?, 0)
            `).run(userId, cleanUsername, admin_name, pwHash, cleanEmail, company_name, nowIso);
          }
        }

        const authId = `auth-adm-${crypto.randomUUID().slice(0, 6)}`;
        db.prepare(`
          INSERT INTO authorized_main_admins (
            id, email, admin_name, company_name, plan, status, username, user_id, authorized_by, notes, created_at, activated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Our Company (Platform Owner)', ?, ?, ?)
          ON CONFLICT(email) DO UPDATE SET
            admin_name=excluded.admin_name,
            company_name=excluded.company_name,
            plan=excluded.plan,
            status=excluded.status,
            username=excluded.username,
            user_id=COALESCE(excluded.user_id, authorized_main_admins.user_id),
            notes=excluded.notes,
            activated_at=COALESCE(excluded.activated_at, authorized_main_admins.activated_at)
        `).run(
          authId,
          cleanEmail,
          admin_name,
          company_name,
          plan || "Enterprise",
          shouldActivate ? "Activated" : "Authorized",
          cleanUsername,
          userId,
          notes || "Authorized by Our Company via Email ID — permitted to create Employee, Client/Employer & Subcontractor accounts.",
          nowIso,
          shouldActivate ? nowIso : null
        );

        res.status(201).json({
          success: true,
          email: cleanEmail,
          username: cleanUsername,
          status: shouldActivate ? "Activated" : "Authorized",
          user_id: userId,
        });
        return;
      }

      res.status(400).json({ error: "Unknown hierarchy action" });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to update command hierarchy" });
    }
  });

  app.get("/api/admin/authorized-main-admins", authRequired, (_req: Request, res: Response) => {
    try {
      const rows = db.prepare("SELECT * FROM authorized_main_admins ORDER BY created_at DESC").all().map(rowToDict);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load authorized main admins" });
    }
  });

  // ==========================================
  // V1.1 - V1.2 CONSTRUCTION-GRADE MODULE APIS
  // ==========================================

}
