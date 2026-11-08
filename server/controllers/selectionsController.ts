import { Express, Request, Response } from "express";
import crypto from "crypto";
import { db, rowToDict } from "../db/connection";
import { authRequired, hasProjectAccess } from "../middleware/auth";
import { writeAudit } from "../services/auditService";

export function registerSelectionsController(app: Express): void {
  // ─── GET /api/projects/:projectId/selections ──────────────────────────────────
  app.get("/api/projects/:projectId/selections", authRequired, (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      if (!hasProjectAccess(req.user!, projectId)) {
        return res.status(403).json({ error: "Access denied to project selections" });
      }

      // Fetch categories
      const categoriesRows = db
        .prepare("SELECT * FROM selection_categories WHERE project_id = ? ORDER BY cutoff_date ASC, created_at ASC")
        .all(projectId);

      const categoryIds = categoriesRows.map((r: any) => r.id);
      let choicesMap: Record<string, any[]> = {};

      if (categoryIds.length > 0) {
        const placeholders = categoryIds.map(() => "?").join(",");
        const choicesRows = db
          .prepare(`SELECT * FROM selection_choices WHERE category_id IN (${placeholders}) ORDER BY is_baseline DESC, unit_price ASC`)
          .all(...categoryIds);

        for (const choice of choicesRows) {
          const dict = rowToDict(choice);
          if (dict) {
            if (!choicesMap[dict.category_id]) choicesMap[dict.category_id] = [];
            choicesMap[dict.category_id].push(dict);
          }
        }
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let totalAllowance = 0;
      let totalSelected = 0;
      let approvedCount = 0;
      let pendingCount = 0;
      let overdueCount = 0;

      const categories = categoriesRows.map((row: any) => {
        const cat = rowToDict(row)!;
        const choices = choicesMap[cat.id] || [];
        const selectedChoice = choices.find((c) => c.id === cat.selected_choice_id) || null;

        const allowanceAmount = Number(cat.allowance_amount) || 0;
        const selectedAmount = selectedChoice ? Number(selectedChoice.total_price) || 0 : 0;
        const variance = selectedChoice ? selectedAmount - allowanceAmount : 0;

        let daysUntilCutoff: number | null = null;
        let isOverdue = false;

        if (cat.cutoff_date) {
          const cutoff = new Date(cat.cutoff_date + "T00:00:00");
          const diffTime = cutoff.getTime() - today.getTime();
          daysUntilCutoff = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          isOverdue = daysUntilCutoff < 0 && cat.status !== "Approved";
        }

        totalAllowance += allowanceAmount;
        totalSelected += selectedAmount;

        if (cat.status === "Approved") {
          approvedCount++;
        } else {
          pendingCount++;
          if (isOverdue) overdueCount++;
        }

        return {
          ...cat,
          choices,
          selected_choice: selectedChoice,
          selected_amount: selectedAmount,
          variance,
          is_over_allowance: variance > 0,
          is_under_allowance: variance < 0,
          days_until_cutoff: daysUntilCutoff,
          is_overdue: isOverdue,
        };
      });

      const netVariance = totalSelected - totalAllowance;

      res.json({
        categories,
        metrics: {
          total_allowance: totalAllowance,
          total_selected: totalSelected,
          net_variance: netVariance,
          categories_count: categories.length,
          approved_count: approvedCount,
          pending_count: pendingCount,
          overdue_count: overdueCount,
        },
      });
    } catch (err: any) {
      console.error("Error fetching selections:", err);
      res.status(500).json({ error: err.message || "Failed to load selections" });
    }
  });

  // ─── POST /api/projects/:projectId/selections/categories ─────────────────────
  app.post("/api/projects/:projectId/selections/categories", authRequired, (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      if (!hasProjectAccess(req.user!, projectId)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { name, trade, allowance_amount, cutoff_date, boq_ref, task_id } = req.body;
      if (!name || !trade) {
        return res.status(400).json({ error: "Name and Trade are required" });
      }

      const id = "sel_cat_" + crypto.randomUUID().slice(0, 8);
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO selection_categories (
          id, project_id, name, trade, allowance_amount, cutoff_date,
          status, boq_ref, task_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'Pending Client Choice', ?, ?, ?, ?)
      `).run(
        id,
        projectId,
        name,
        trade,
        Number(allowance_amount) || 0,
        cutoff_date || null,
        boq_ref || null,
        task_id || null,
        now,
        now
      );

      writeAudit(req.user!.user_id, "selections", id, projectId, "CREATE_SELECTION_CATEGORY", null, {
        details: `Created selection allowance category: ${name} (€${allowance_amount})`,
      });

      const created = rowToDict(db.prepare("SELECT * FROM selection_categories WHERE id = ?").get(id));
      res.status(201).json(created);
    } catch (err: any) {
      console.error("Error creating selection category:", err);
      res.status(500).json({ error: err.message || "Failed to create selection category" });
    }
  });

  // ─── PUT /api/selections/categories/:categoryId ──────────────────────────────
  app.put("/api/selections/categories/:categoryId", authRequired, (req: Request, res: Response) => {
    try {
      const { categoryId } = req.params;
      const existing: any = db.prepare("SELECT * FROM selection_categories WHERE id = ?").get(categoryId);
      if (!existing) return res.status(404).json({ error: "Category not found" });

      if (!hasProjectAccess(req.user!, existing.project_id)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { name, trade, allowance_amount, cutoff_date, boq_ref, task_id, status } = req.body;
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE selection_categories
        SET name = COALESCE(?, name),
            trade = COALESCE(?, trade),
            allowance_amount = COALESCE(?, allowance_amount),
            cutoff_date = COALESCE(?, cutoff_date),
            boq_ref = COALESCE(?, boq_ref),
            task_id = COALESCE(?, task_id),
            status = COALESCE(?, status),
            updated_at = ?
        WHERE id = ?
      `).run(
        name ?? null,
        trade ?? null,
        allowance_amount != null ? Number(allowance_amount) : null,
        cutoff_date ?? null,
        boq_ref ?? null,
        task_id ?? null,
        status ?? null,
        now,
        categoryId
      );

      const updated = rowToDict(db.prepare("SELECT * FROM selection_categories WHERE id = ?").get(categoryId));
      res.json(updated);
    } catch (err: any) {
      console.error("Error updating selection category:", err);
      res.status(500).json({ error: err.message || "Failed to update category" });
    }
  });

  // ─── DELETE /api/selections/categories/:categoryId ───────────────────────────
  app.delete("/api/selections/categories/:categoryId", authRequired, (req: Request, res: Response) => {
    try {
      const { categoryId } = req.params;
      const existing: any = db.prepare("SELECT * FROM selection_categories WHERE id = ?").get(categoryId);
      if (!existing) return res.status(404).json({ error: "Category not found" });

      if (!hasProjectAccess(req.user!, existing.project_id)) {
        return res.status(403).json({ error: "Access denied" });
      }

      db.prepare("DELETE FROM selection_choices WHERE category_id = ?").run(categoryId);
      db.prepare("DELETE FROM selection_categories WHERE id = ?").run(categoryId);

      res.json({ success: true, message: "Category and options deleted" });
    } catch (err: any) {
      console.error("Error deleting category:", err);
      res.status(500).json({ error: err.message || "Failed to delete category" });
    }
  });

  // ─── POST /api/selections/categories/:categoryId/choices ─────────────────────
  app.post("/api/selections/categories/:categoryId/choices", authRequired, (req: Request, res: Response) => {
    try {
      const { categoryId } = req.params;
      const category: any = db.prepare("SELECT * FROM selection_categories WHERE id = ?").get(categoryId);
      if (!category) return res.status(404).json({ error: "Category not found" });

      if (!hasProjectAccess(req.user!, category.project_id)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const {
        title,
        manufacturer,
        model_number,
        unit_price,
        quantity,
        lead_time_weeks,
        is_baseline,
        image_url,
        spec_sheet_url,
        description,
        technical_specs,
      } = req.body;

      if (!title) {
        return res.status(400).json({ error: "Choice title is required" });
      }

      const id = "sel_opt_" + crypto.randomUUID().slice(0, 8);
      const now = new Date().toISOString();
      const qty = Number(quantity) > 0 ? Number(quantity) : 1;
      const uPrice = Number(unit_price) >= 0 ? Number(unit_price) : 0;
      const totalPrice = qty * uPrice;

      db.prepare(`
        INSERT INTO selection_choices (
          id, category_id, title, manufacturer, model_number,
          unit_price, quantity, total_price, lead_time_weeks,
          is_baseline, image_url, spec_sheet_url, description,
          technical_specs, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        categoryId,
        title,
        manufacturer || null,
        model_number || null,
        uPrice,
        qty,
        totalPrice,
        Number(lead_time_weeks) || 2,
        is_baseline ? 1 : 0,
        image_url || null,
        spec_sheet_url || null,
        description || null,
        technical_specs || null,
        now
      );

      // If category has no selected choice yet and this is baseline, auto-select it
      if (!category.selected_choice_id && is_baseline) {
        db.prepare("UPDATE selection_categories SET selected_choice_id = ? WHERE id = ?").run(id, categoryId);
      }

      const created = rowToDict(db.prepare("SELECT * FROM selection_choices WHERE id = ?").get(id));
      res.status(201).json(created);
    } catch (err: any) {
      console.error("Error creating choice:", err);
      res.status(500).json({ error: err.message || "Failed to create choice" });
    }
  });

  // ─── PUT /api/selections/choices/:choiceId ───────────────────────────────────
  app.put("/api/selections/choices/:choiceId", authRequired, (req: Request, res: Response) => {
    try {
      const { choiceId } = req.params;
      const choice: any = db.prepare("SELECT * FROM selection_choices WHERE id = ?").get(choiceId);
      if (!choice) return res.status(404).json({ error: "Choice not found" });

      const category: any = db.prepare("SELECT * FROM selection_categories WHERE id = ?").get(choice.category_id);
      if (!category || !hasProjectAccess(req.user!, category.project_id)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const {
        title,
        manufacturer,
        model_number,
        unit_price,
        quantity,
        lead_time_weeks,
        is_baseline,
        image_url,
        spec_sheet_url,
        description,
        technical_specs,
      } = req.body;

      const qty = quantity != null ? Number(quantity) : choice.quantity;
      const uPrice = unit_price != null ? Number(unit_price) : choice.unit_price;
      const totalPrice = qty * uPrice;

      db.prepare(`
        UPDATE selection_choices
        SET title = COALESCE(?, title),
            manufacturer = COALESCE(?, manufacturer),
            model_number = COALESCE(?, model_number),
            unit_price = ?,
            quantity = ?,
            total_price = ?,
            lead_time_weeks = COALESCE(?, lead_time_weeks),
            is_baseline = COALESCE(?, is_baseline),
            image_url = COALESCE(?, image_url),
            spec_sheet_url = COALESCE(?, spec_sheet_url),
            description = COALESCE(?, description),
            technical_specs = COALESCE(?, technical_specs)
        WHERE id = ?
      `).run(
        title ?? null,
        manufacturer ?? null,
        model_number ?? null,
        uPrice,
        qty,
        totalPrice,
        lead_time_weeks != null ? Number(lead_time_weeks) : null,
        is_baseline != null ? (is_baseline ? 1 : 0) : null,
        image_url ?? null,
        spec_sheet_url ?? null,
        description ?? null,
        technical_specs ?? null,
        choiceId
      );

      const updated = rowToDict(db.prepare("SELECT * FROM selection_choices WHERE id = ?").get(choiceId));
      res.json(updated);
    } catch (err: any) {
      console.error("Error updating choice:", err);
      res.status(500).json({ error: err.message || "Failed to update choice" });
    }
  });

  // ─── DELETE /api/selections/choices/:choiceId ─────────────────────────────────
  app.delete("/api/selections/choices/:choiceId", authRequired, (req: Request, res: Response) => {
    try {
      const { choiceId } = req.params;
      const choice: any = db.prepare("SELECT * FROM selection_choices WHERE id = ?").get(choiceId);
      if (!choice) return res.status(404).json({ error: "Choice not found" });

      const category: any = db.prepare("SELECT * FROM selection_categories WHERE id = ?").get(choice.category_id);
      if (!category || !hasProjectAccess(req.user!, category.project_id)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // If this choice was the selected choice, clear it
      if (category.selected_choice_id === choiceId) {
        db.prepare("UPDATE selection_categories SET selected_choice_id = NULL, status = 'Pending Client Choice' WHERE id = ?").run(
          choice.category_id
        );
      }

      db.prepare("DELETE FROM selection_choices WHERE id = ?").run(choiceId);
      res.json({ success: true, message: "Choice deleted" });
    } catch (err: any) {
      console.error("Error deleting choice:", err);
      res.status(500).json({ error: err.message || "Failed to delete choice" });
    }
  });

  // ─── POST /api/selections/categories/:categoryId/select (E-Signature & Approval) ───
  app.post("/api/selections/categories/:categoryId/select", authRequired, (req: Request, res: Response) => {
    try {
      const { categoryId } = req.params;
      const category: any = db.prepare("SELECT * FROM selection_categories WHERE id = ?").get(categoryId);
      if (!category) return res.status(404).json({ error: "Category not found" });

      if (!hasProjectAccess(req.user!, category.project_id)) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { choice_id, approved_by, approval_notes, signature_token, lock_approval } = req.body;
      const choice: any = db.prepare("SELECT * FROM selection_choices WHERE id = ? AND category_id = ?").get(choice_id, categoryId);

      if (!choice) {
        return res.status(400).json({ error: "Invalid choice selected for this category" });
      }

      const now = new Date().toISOString();
      const status = lock_approval ? "Approved" : "Selected";
      const signerName = approved_by || (req as any).user?.name || "Client Representative";
      const sigToken = signature_token || "SIG-" + crypto.randomBytes(4).toString("hex").toUpperCase();

      db.prepare(`
        UPDATE selection_categories
        SET selected_choice_id = ?,
            status = ?,
            approved_by = ?,
            approved_at = ?,
            approval_notes = ?,
            signature_token = ?,
            updated_at = ?
        WHERE id = ?
      `).run(choice_id, status, signerName, now, approval_notes || null, sigToken, now, categoryId);

      writeAudit(req.user!.user_id, "selections", categoryId, category.project_id, "APPROVE_SELECTION_CHOICE", null, {
        details: `Client approved selection: ${choice.title} for category ${category.name} (${status})`,
      });

      const updated = rowToDict(db.prepare("SELECT * FROM selection_categories WHERE id = ?").get(categoryId));
      res.json({
        success: true,
        category: updated,
        selected_choice: rowToDict(choice),
      });
    } catch (err: any) {
      console.error("Error approving selection:", err);
      res.status(500).json({ error: err.message || "Failed to approve selection" });
    }
  });

  // ─── POST /api/selections/categories/:categoryId/create-variation (Auto Change Order) ───
  app.post("/api/selections/categories/:categoryId/create-variation", authRequired, (req: Request, res: Response) => {
    try {
      const { categoryId } = req.params;
      const category: any = db.prepare("SELECT * FROM selection_categories WHERE id = ?").get(categoryId);
      if (!category) return res.status(404).json({ error: "Category not found" });

      if (!hasProjectAccess(req.user!, category.project_id)) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!category.selected_choice_id) {
        return res.status(400).json({ error: "Cannot create variation without an active selection" });
      }

      const choice: any = db.prepare("SELECT * FROM selection_choices WHERE id = ?").get(category.selected_choice_id);
      if (!choice) return res.status(404).json({ error: "Selected choice not found" });

      const allowance = Number(category.allowance_amount) || 0;
      const total = Number(choice.total_price) || 0;
      const variance = total - allowance;

      if (variance <= 0) {
        return res.status(400).json({ error: "Selection does not exceed allowance. No variation needed." });
      }

      const coId = "co_sel_" + crypto.randomUUID().slice(0, 8);
      const coNumber = `VoR-SEL-${(category.boq_ref || category.name.slice(0, 4)).replace(/[^a-zA-Z0-9]/g, "")}-${Math.floor(100 + Math.random() * 900)}`;
      const title = `Selection Upgrade: ${choice.title} over Allowance (${category.name})`;
      const reason = `Client selected upgrade option '${choice.title}' (${choice.manufacturer || "Custom"}) exceeding original allowance of €${allowance.toLocaleString()} by €${variance.toLocaleString()}.`;
      const today = new Date().toISOString().split("T")[0];

      db.prepare(`
        INSERT INTO change_orders (
          id, project_id, number, title, trade, reason,
          cost_impact, schedule_impact_days, date_raised, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Approved')
      `).run(coId, category.project_id, coNumber, title, category.trade, reason, variance, 0, today);

      // Link change order to category
      db.prepare("UPDATE selection_categories SET change_order_id = ? WHERE id = ?").run(coId, categoryId);

      writeAudit(req.user!.user_id, "change_orders", coId, category.project_id, "CREATE_CHANGE_ORDER_FROM_SELECTION", null, {
        details: `Generated change order ${coNumber} for €${variance} from selection overage`,
      });

      const changeOrder = rowToDict(db.prepare("SELECT * FROM change_orders WHERE id = ?").get(coId));
      res.status(201).json({
        success: true,
        change_order: changeOrder,
        variance,
      });
    } catch (err: any) {
      console.error("Error generating variation:", err);
      res.status(500).json({ error: err.message || "Failed to generate variation" });
    }
  });

  // ─── POST /api/projects/:projectId/selections/seed-defaults ──────────────────
  app.post("/api/projects/:projectId/selections/seed-defaults", authRequired, (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      if (!hasProjectAccess(req.user!, projectId)) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Check if project already has categories
      const existingCount: any = db
        .prepare("SELECT COUNT(*) as count FROM selection_categories WHERE project_id = ?")
        .get(projectId);

      if (existingCount && existingCount.count > 0 && !req.query.force) {
        return res.json({ message: "Selections already exist", count: existingCount.count });
      }

      const now = new Date().toISOString();
      const inTwoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0];
      const inFourWeeks = new Date(Date.now() + 28 * 86400000).toISOString().split("T")[0];
      const pastThreeDays = new Date(Date.now() - 3 * 86400000).toISOString().split("T")[0];

      // High-fidelity commercial MEP selection categories matched to BOV St. Venera BOQ items
      const seedData = [
        {
          name: "Architectural Office Luminaires & Linear LED",
          trade: "Electrical",
          allowance: 12500,
          cutoff: inTwoWeeks,
          boq_ref: "BOQ-2618-3.0",
          status: "Pending Client Choice",
          choices: [
            {
              title: "Baseline Tender Spec: Philips CoreLine LED 40W 4000K",
              manufacturer: "Philips Lighting",
              model: "RC132V LED36S/840 PSD W60L60",
              unit_price: 125,
              qty: 100,
              is_baseline: 1,
              lead_weeks: 3,
              image: "https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?w=500&auto=format&fit=crop&q=80",
              desc: "Standard recessed 600x600 micro-prismatic optic, UGR<19, DALI dimmable.",
              specs: "Lumens: 3600lm | CCT: 4000K | CRI: 80 | Life: 50,000h L80 | Warranty: 5 Years",
            },
            {
              title: "Upgrade Option A: Zumtobel MIREL Evolution High CRI90 Architectural",
              manufacturer: "Zumtobel",
              model: "MIREL-EVO-600-3400-940-LDO",
              unit_price: 155,
              qty: 100,
              is_baseline: 0,
              lead_weeks: 4,
              image: "https://images.unsplash.com/photo-1540932239986-30128078f3c5?w=500&auto=format&fit=crop&q=80",
              desc: "Premium architectural louvered luminaire with tunable circadian support and glare rating UGR<16.",
              specs: "Lumens: 3800lm | CCT: 4000K Tunable | CRI: 92 | Life: 70,000h L90 | Warranty: 7 Years",
            },
            {
              title: "Design Option B: Artemide Acoustic Panel Integrated Linear LED",
              manufacturer: "Artemide",
              model: "EGG-ACOUSTIC-1200",
              unit_price: 180,
              qty: 100,
              is_baseline: 0,
              lead_weeks: 6,
              image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=500&auto=format&fit=crop&q=80",
              desc: "Sound absorbing felt body with recessed micro-downlights. High acoustic damping (NRC 0.85).",
              specs: "Lumens: 4200lm | CCT: 3500K | CRI: 95 | Sound NRC: 0.85 | Warranty: 5 Years",
            },
          ],
        },
        {
          name: "Modular 10kVA Online Double-Conversion UPS System",
          trade: "Critical Power",
          allowance: 9200,
          cutoff: pastThreeDays, // Past due to demonstrate Buildertrend cutoff alert
          boq_ref: "BOQ-2618-UPS.01",
          status: "Pending Client Choice",
          choices: [
            {
              title: "Baseline Tender Spec: Riello Multi Sentry 10kVA Tower",
              manufacturer: "Riello UPS",
              model: "MST-10-V2",
              unit_price: 9200,
              qty: 1,
              is_baseline: 1,
              lead_weeks: 4,
              image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=500&auto=format&fit=crop&q=80",
              desc: "VFI-SS-111 online double conversion, internal 10-min battery runtime at 80% load.",
              specs: "Efficiency: 96.5% | PF: 0.9 | Runtime: 10 min | SNMP Card Included",
            },
            {
              title: "Upgrade Option A: Schneider Galaxy VL 15kVA Modular N+1 with Li-Ion",
              manufacturer: "Schneider Electric",
              model: "GVL15K10H-LI",
              unit_price: 11450,
              qty: 1,
              is_baseline: 0,
              lead_weeks: 5,
              image: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=500&auto=format&fit=crop&q=80",
              desc: "Hot-swappable power modules, Lithium-ion 15-year battery pack, EcoStruxure cloud telemetrics.",
              specs: "Efficiency: 99% ECOnversion | PF: 1.0 | Battery: Li-Ion 15yr | Warranty: 10 Years",
            },
          ],
        },
        {
          name: "Main Distribution Board (MDB) & Intelligent Metering",
          trade: "Electrical",
          allowance: 14800,
          cutoff: inFourWeeks,
          boq_ref: "BOQ-2618-E-01",
          status: "Approved",
          selected_index: 1,
          approved_by: "Bank of Valletta Facilities Directorate",
          approval_notes: "Approved Schneider smart breaker package with Modbus gateway for central BMS logging.",
          choices: [
            {
              title: "Baseline Tender Spec: ABB ArTu-K Form 2b Distribution Enclosure",
              manufacturer: "ABB",
              model: "ARTU-K-250A-F2",
              unit_price: 14800,
              qty: 1,
              is_baseline: 1,
              lead_weeks: 3,
              image: "https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=500&auto=format&fit=crop&q=80",
              desc: "IP43 floor standing steel enclosure with Tmax XT MCCB incoming 250A.",
              specs: "In: 250A | Icu: 36kA | Form: 2b | IP: IP43 | Standard DIN meters",
            },
            {
              title: "Selected Option: Schneider PrismaSeT G with PowerTag Smart Cloud Breakers",
              manufacturer: "Schneider Electric",
              model: "LVS-PRISMA-G-250-IOT",
              unit_price: 16250,
              qty: 1,
              is_baseline: 0,
              lead_weeks: 4,
              image: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=500&auto=format&fit=crop&q=80",
              desc: "Form 3b compartmentalized board with wireless PowerTag sub-metering on all 18 outgoing ways.",
              specs: "In: 250A | Icu: 50kA | Form: 3b | Comms: Modbus TCP/IP & LoRaWAN | Wireless sensors",
            },
          ],
        },
        {
          name: "Floor 1 & 2 Server Room 42U Racks & Structured Cat6A Patching",
          trade: "ELV",
          allowance: 7600,
          cutoff: inTwoWeeks,
          boq_ref: "BOQ-2618-8.0",
          status: "Pending Client Choice",
          choices: [
            {
              title: "Baseline Tender Spec: Legrand LCS3 42U Server Rack 800x1000",
              manufacturer: "Legrand",
              model: "LCS3-42U-8010",
              unit_price: 3800,
              qty: 2,
              is_baseline: 1,
              lead_weeks: 2,
              image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=500&auto=format&fit=crop&q=80",
              desc: "Perforated 80% airflow doors, high-density vertical cable trays, grounding kit.",
              specs: "Capacity: 42U | Depth: 1000mm | Static Load: 1500kg | 24-Port Cat6A Panels x 8",
            },
            {
              title: "Upgrade Option A: APC NetShelter SX with Integrated Zero-U Smart Switched PDU",
              manufacturer: "APC by Schneider",
              model: "AR3300-SMART-PDU",
              unit_price: 4650,
              qty: 2,
              is_baseline: 0,
              lead_weeks: 3,
              image: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=500&auto=format&fit=crop&q=80",
              desc: "Includes dual redundant IP-metered zero-U PDUs with environmental temp/humidity sensors.",
              specs: "Capacity: 42U | Depth: 1200mm | Zero-U PDU x 4 | Environmental Probe x 2 | Smart lock",
            },
          ],
        },
      ];

      for (const catData of seedData) {
        const catId = "sel_cat_" + crypto.randomUUID().slice(0, 8);
        db.prepare(`
          INSERT INTO selection_categories (
            id, project_id, name, trade, allowance_amount, cutoff_date,
            status, approved_by, approved_at, approval_notes, signature_token,
            boq_ref, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          catId,
          projectId,
          catData.name,
          catData.trade,
          catData.allowance,
          catData.cutoff,
          catData.status,
          catData.approved_by || null,
          catData.approved_by ? now : null,
          catData.approval_notes || null,
          catData.approved_by ? "SIG-BOV-" + crypto.randomBytes(3).toString("hex").toUpperCase() : null,
          catData.boq_ref,
          now,
          now
        );

        let selectedChoiceId: string | null = null;

        for (let i = 0; i < catData.choices.length; i++) {
          const ch = catData.choices[i];
          const choiceId = "sel_opt_" + crypto.randomUUID().slice(0, 8);
          const total = ch.qty * ch.unit_price;

          db.prepare(`
            INSERT INTO selection_choices (
              id, category_id, title, manufacturer, model_number,
              unit_price, quantity, total_price, lead_time_weeks,
              is_baseline, image_url, description, technical_specs, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            choiceId,
            catId,
            ch.title,
            ch.manufacturer,
            ch.model,
            ch.unit_price,
            ch.qty,
            total,
            ch.lead_weeks,
            ch.is_baseline,
            ch.image,
            ch.desc,
            ch.specs,
            now
          );

          if (catData.selected_index != null && catData.selected_index === i) {
            selectedChoiceId = choiceId;
          } else if (catData.selected_index == null && ch.is_baseline) {
            selectedChoiceId = choiceId;
          }
        }

        if (selectedChoiceId) {
          db.prepare("UPDATE selection_categories SET selected_choice_id = ? WHERE id = ?").run(selectedChoiceId, catId);
        }
      }

      writeAudit(req.user!.user_id, "selections", projectId, projectId, "SEED_DEFAULT_SELECTIONS", null, {
        details: `Seeded ${seedData.length} commercial selection categories with full choice options`,
      });

      res.status(201).json({ success: true, count: seedData.length });
    } catch (err: any) {
      console.error("Error seeding selections:", err);
      res.status(500).json({ error: err.message || "Failed to seed selections" });
    }
  });
}
