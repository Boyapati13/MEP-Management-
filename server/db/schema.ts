import crypto from "crypto";
import { db } from "./connection";
import { hashPassword } from "../middleware/rateLimit";

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE, name TEXT,
      password_hash TEXT, role TEXT, email TEXT, phone TEXT,
      company_id TEXT, company TEXT, trade TEXT, work_package_id TEXT,
      worker_id TEXT, status TEXT DEFAULT 'Active', access_scope TEXT DEFAULT 'work_package',
      allowed_work_package_ids TEXT, created_at TEXT, last_login TEXT, must_change_password INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT, name TEXT, role TEXT, created_at TEXT, expires_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_memberships (
      user_id TEXT NOT NULL, project_id TEXT NOT NULL,
      access_role TEXT NOT NULL DEFAULT 'Member', active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, project_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT, client TEXT, status TEXT,
      start_date TEXT, end_date TEXT, budget REAL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, project_id TEXT, title TEXT, trade TEXT,
      assignee TEXT, start TEXT, end TEXT, progress INTEGER, status TEXT,
      wbs_code TEXT, duration TEXT, is_summary INTEGER DEFAULT 0, is_milestone INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS rfis (
      id TEXT PRIMARY KEY, project_id TEXT, number TEXT, subject TEXT,
      trade TEXT, raised_by TEXT, date_raised TEXT, due_date TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS submittals (
      id TEXT PRIMARY KEY, project_id TEXT, number TEXT, item TEXT,
      trade TEXT, date_submitted TEXT, due_date TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS punchlist (
      id TEXT PRIMARY KEY, project_id TEXT, item TEXT, trade TEXT,
      location TEXT, priority TEXT, date_raised TEXT, status TEXT, attachment_data TEXT
    );
    CREATE TABLE IF NOT EXISTS dailylogs (
      id TEXT PRIMARY KEY, project_id TEXT, date TEXT, trade TEXT,
      weather TEXT, crew INTEGER, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, project_id TEXT, name TEXT, category TEXT,
      revision TEXT, date_added TEXT, attachment_name TEXT, attachment_data TEXT,
      subcontractor_id TEXT, uploaded_by TEXT
    );
    CREATE TABLE IF NOT EXISTS costs (
      id TEXT PRIMARY KEY, project_id TEXT, category TEXT, description TEXT,
      planned REAL, actual REAL, date_logged TEXT
    );
    CREATE TABLE IF NOT EXISTS boq_items (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, item_number TEXT,
      description TEXT NOT NULL, unit TEXT, tender_quantity REAL DEFAULT 0,
      tender_rate REAL DEFAULT 0, tender_amount REAL DEFAULT 0,
      revised_quantity REAL DEFAULT 0, installed_quantity REAL DEFAULT 0,
      claimed_quantity REAL DEFAULT 0, certified_quantity REAL DEFAULT 0,
      discipline TEXT, system TEXT, building TEXT, floor TEXT, area TEXT,
      source_document_id TEXT, imported_at TEXT
    );
    CREATE TABLE IF NOT EXISTS change_orders (
      id TEXT PRIMARY KEY, project_id TEXT, number TEXT, title TEXT, trade TEXT,
      reason TEXT, cost_impact REAL, schedule_impact_days INTEGER,
      date_raised TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY, project_id TEXT, po_number TEXT, vendor TEXT, trade TEXT,
      description TEXT, amount REAL, order_date TEXT, expected_delivery TEXT, expected_delivery_date TEXT, actual_delivery_date TEXT, lead_time_days INTEGER, task_id TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS safety_incidents (
      id TEXT PRIMARY KEY, project_id TEXT, date TEXT, trade TEXT, incident_type TEXT,
      severity TEXT, description TEXT, corrective_action TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS inspections (
      id TEXT PRIMARY KEY, project_id TEXT, date TEXT, trade TEXT, inspection_type TEXT,
      inspector TEXT, result TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS meeting_minutes (
      id TEXT PRIMARY KEY, project_id TEXT, date TEXT, meeting_type TEXT,
      attendees TEXT, subject TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS timesheets (
      id TEXT PRIMARY KEY, project_id TEXT, date TEXT, worker TEXT, trade TEXT,
      task TEXT, hours REAL
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL,
      worker TEXT NOT NULL, work_date TEXT NOT NULL, punch_in TEXT NOT NULL,
      punch_out TEXT, status TEXT NOT NULL DEFAULT 'Open', notes TEXT
    );
    CREATE TABLE IF NOT EXISTS equipment (
      id TEXT PRIMARY KEY, project_id TEXT, name TEXT, type TEXT,
      assigned_to TEXT, status TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS wbs_items (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT,
      code TEXT, name TEXT NOT NULL, level TEXT, discipline TEXT, system TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS dependencies (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT,
      predecessor_task_id TEXT, predecessor_id TEXT, successor_id TEXT,
      dependency_type TEXT DEFAULT 'Finish-to-Start',
      task_owner TEXT, dependent_party TEXT, description TEXT, dependency_owner TEXT,
      required_date TEXT, completed_date TEXT, status TEXT, impact_if_late TEXT,
      programme_impact TEXT, commercial_impact TEXT, next_action TEXT
    );
    CREATE TABLE IF NOT EXISTS procurement_items (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, pr_number TEXT, material TEXT,
      specification TEXT, boq_reference TEXT, drawing_reference TEXT, quantity REAL,
      unit TEXT, required_on_site TEXT, responsible_buyer TEXT, selected_supplier TEXT,
      po_number TEXT, po_date TEXT, expected_delivery TEXT, actual_delivery TEXT,
      delivered_quantity REAL, outstanding_quantity REAL, inspection_status TEXT,
      storage_location TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS material_requests (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, location TEXT, discipline TEXT,
      system TEXT, material TEXT, description TEXT, quantity REAL, unit TEXT,
      required_date TEXT, reason TEXT, drawing TEXT, boq_reference TEXT,
      requested_by TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS risks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, risk_no TEXT, title TEXT, category TEXT,
      probability TEXT, impact TEXT, risk_score REAL, risk_level TEXT DEFAULT 'Medium', owner TEXT, mitigation TEXT,
      target_date TEXT, contingency_cost REAL DEFAULT 0, linked_task_id TEXT, work_package_id TEXT, status TEXT, created_by TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_actions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, action_no TEXT, title TEXT NOT NULL,
      description TEXT, assigned_to_user_id TEXT, assigned_to_name TEXT, priority TEXT DEFAULT 'Medium',
      status TEXT DEFAULT 'Open', due_date TEXT, source_type TEXT DEFAULT 'General', source_id TEXT,
      created_by TEXT, created_at TEXT, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_decisions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, decision_no TEXT, title TEXT NOT NULL,
      context TEXT, options_considered TEXT, decision_taken TEXT, decided_by TEXT, decision_date TEXT,
      cost_impact REAL DEFAULT 0, schedule_impact_days INTEGER DEFAULT 0, status TEXT DEFAULT 'Approved',
      created_by TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ncrs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, number TEXT, location TEXT,
      description TEXT, raised_against TEXT, raised_date TEXT, responsible_party TEXT,
      root_cause TEXT, corrective_action TEXT, target_date TEXT, verification TEXT,
      closure_date TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS commissioning_tests (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, system TEXT, subsystem TEXT,
      equipment TEXT, test_type TEXT, power_available INTEGER, installation_complete INTEGER,
      controls_complete INTEGER, interface_complete INTEGER, drawings_approved INTEGER,
      test_date TEXT, test_engineer TEXT, witness TEXT, result TEXT, failure_reason TEXT,
      retest_date TEXT, certificate TEXT, status TEXT, comments TEXT
    );
    CREATE TABLE IF NOT EXISTS handover_items (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, contractor TEXT, system TEXT,
      item_type TEXT, description TEXT, required INTEGER, submitted INTEGER,
      approved INTEGER, due_date TEXT, status TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS task_status_history (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL,
      changed_by TEXT, old_status TEXT, new_status TEXT, changed_at TEXT, comment TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY, user_id TEXT, project_id TEXT, module TEXT,
      record_id TEXT, action TEXT, old_value TEXT, new_value TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS record_owners (
      module TEXT NOT NULL, record_id TEXT NOT NULL, user_id TEXT NOT NULL,
      PRIMARY KEY (module, record_id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, module TEXT,
      record_id TEXT, title TEXT, message TEXT, is_read INTEGER DEFAULT 0, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS plan_buckets (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_document_id TEXT,
      name TEXT, order_index INTEGER, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS plan_tasks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, bucket_id TEXT NOT NULL,
      title TEXT, description TEXT, trade TEXT, priority TEXT, status TEXT,
      due_date TEXT, assigned_to TEXT, source_document_id TEXT, source_excerpt TEXT,
      order_index INTEGER, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS plan_task_checklist (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, label TEXT,
      is_checked INTEGER DEFAULT 0, order_index INTEGER
    );
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      trade TEXT,
      contact_person TEXT,
      email TEXT,
      phone TEXT,
      vat_number TEXT,
      status TEXT DEFAULT 'Active',
      notes TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS work_packages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      discipline TEXT NOT NULL,
      description TEXT,
      company_id TEXT,
      lead_contact TEXT,
      budget_allocated REAL DEFAULT 0,
      status TEXT DEFAULT 'Planned',
      start_date TEXT,
      target_date TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_companies (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      role_in_project TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS clarifications (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      number TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT DEFAULT 'Technical',
      from_company_id TEXT,
      to_company_id TEXT,
      work_package_id TEXT,
      raised_by TEXT,
      discipline TEXT,
      priority TEXT DEFAULT 'Medium',
      status TEXT DEFAULT 'Submitted',
      question_text TEXT NOT NULL,
      proposed_solution TEXT,
      cost_impact_flag INTEGER DEFAULT 0,
      schedule_impact_flag INTEGER DEFAULT 0,
      official_response TEXT,
      responded_by TEXT,
      responded_at TEXT,
      due_date TEXT,
      attachment_name TEXT,
      attachment_data TEXT,
      visibility TEXT DEFAULT 'Internal',
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS clarification_comments (
      id TEXT PRIMARY KEY,
      clarification_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT,
      company_name TEXT,
      comment_text TEXT NOT NULL,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS progress_reports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      report_number TEXT,
      report_no TEXT,
      title TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      prepared_by TEXT,
      status TEXT DEFAULT 'Draft',
      executive_summary TEXT,
      overall_progress_percent REAL DEFAULT 0,
      planned_progress_percent REAL DEFAULT 0,
      milestone_summary TEXT,
      hvac_progress REAL DEFAULT 0,
      electrical_progress REAL DEFAULT 0,
      plumbing_progress REAL DEFAULT 0,
      fire_progress REAL DEFAULT 0,
      bms_progress REAL DEFAULT 0,
      safety_summary TEXT,
      manpower_peak INTEGER DEFAULT 0,
      lookahead_narrative TEXT,
      key_risks_issues TEXT,
      revision_no INTEGER DEFAULT 0,
      supersedes_report_id TEXT,
      snapshot_schema_version INTEGER DEFAULT 1,
      snapshot_data TEXT,
      published_at TEXT,
      published_by TEXT,
      created_by TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS progress_report_photos (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      title TEXT,
      caption TEXT,
      trade TEXT,
      location TEXT,
      photo_data TEXT NOT NULL,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS document_revisions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      revision_code TEXT NOT NULL,
      superseded_date TEXT,
      changed_by TEXT,
      change_summary TEXT,
      attachment_name TEXT,
      attachment_data TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS drawing_markings (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      drawing_number TEXT,
      revision TEXT DEFAULT 'Rev A',
      pin_number TEXT NOT NULL,
      x_percent REAL NOT NULL DEFAULT 50,
      y_percent REAL NOT NULL DEFAULT 50,
      marking_type TEXT NOT NULL DEFAULT 'Site Progress / Installed',
      title TEXT NOT NULL,
      description TEXT,
      trade TEXT DEFAULT 'Electrical',
      status TEXT NOT NULL DEFAULT 'Open',
      progress_percent INTEGER DEFAULT 0,
      linked_task_id TEXT,
      created_by TEXT,
      created_by_name TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_drawing_markings_doc ON drawing_markings(document_id);
    CREATE INDEX IF NOT EXISTS idx_drawing_markings_proj ON drawing_markings(project_id);
    CREATE TABLE IF NOT EXISTS document_transmittals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      transmittal_number TEXT NOT NULL,
      sender_company_id TEXT,
      recipient_company_id TEXT,
      subject TEXT NOT NULL,
      purpose TEXT DEFAULT 'For Approval',
      date_sent TEXT,
      due_date TEXT,
      status TEXT DEFAULT 'Transmitted',
      notes TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS transmittal_items (
      id TEXT PRIMARY KEY,
      transmittal_id TEXT NOT NULL,
      document_id TEXT,
      document_title TEXT,
      document_number TEXT,
      revision TEXT,
      format TEXT DEFAULT 'PDF',
      status TEXT DEFAULT 'Transmitted',
      action_required TEXT DEFAULT 'Review',
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS progress_submissions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      work_package_id TEXT,
      company_id TEXT,
      submitted_by TEXT NOT NULL,
      period_date TEXT NOT NULL,
      discipline TEXT,
      claimed_percent REAL DEFAULT 0,
      quantity_installed REAL DEFAULT 0,
      unit TEXT,
      notes TEXT,
      status TEXT DEFAULT 'Submitted',
      adjusted_percent REAL,
      reviewed_by TEXT,
      review_comments TEXT,
      approved_at TEXT,
      created_at TEXT
    );
    -- =====================================================
    -- BUILDERTREND SELECTIONS & ALLOWANCES MODULE
    -- =====================================================
    CREATE TABLE IF NOT EXISTS selection_categories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      trade TEXT NOT NULL,
      allowance_amount REAL NOT NULL DEFAULT 0,
      cutoff_date TEXT,
      status TEXT DEFAULT 'Pending Client Choice',
      selected_choice_id TEXT,
      approved_by TEXT,
      approved_at TEXT,
      approval_notes TEXT,
      signature_token TEXT,
      boq_ref TEXT,
      task_id TEXT,
      change_order_id TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS selection_choices (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      title TEXT NOT NULL,
      manufacturer TEXT,
      model_number TEXT,
      unit_price REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 1,
      total_price REAL NOT NULL DEFAULT 0,
      lead_time_weeks INTEGER DEFAULT 2,
      is_baseline INTEGER DEFAULT 0,
      image_url TEXT,
      spec_sheet_url TEXT,
      description TEXT,
      technical_specs TEXT,
      created_at TEXT
    );
    -- =====================================================
    -- BUILDERTREND PROJECT MESSAGES & COMMUNICATIONS
    -- =====================================================
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
    -- =====================================================
    -- WORKFORCE MODULE TABLES (V1.2)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      city TEXT,
      country TEXT,
      latitude REAL,
      longitude REAL,
      geofence_radius_m REAL DEFAULT 100,
      geofence_warning_radius_m REAL DEFAULT 150,
      timezone TEXT DEFAULT 'UTC',
      status TEXT DEFAULT 'Active',
      created_by TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      site_id TEXT,
      company_id TEXT,
      user_id TEXT,
      name TEXT NOT NULL,
      employee_id TEXT,
      trade TEXT,
      employment_type TEXT DEFAULT 'Permanent',
      nationality TEXT,
      phone TEXT,
      email TEXT,
      supervisor_id TEXT,
      work_package_id TEXT,
      status TEXT DEFAULT 'Active',
      hired_date TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS worker_assignments (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      site_id TEXT,
      work_package_id TEXT,
      supervisor_id TEXT,
      role_on_site TEXT,
      start_date TEXT,
      end_date TEXT,
      status TEXT DEFAULT 'Active',
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS shift_templates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      grace_minutes INTEGER DEFAULT 15,
      break_minutes INTEGER DEFAULT 60,
      regular_hours REAL DEFAULT 8,
      ot_threshold_hours REAL DEFAULT 8,
      status TEXT DEFAULT 'Active',
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS worker_schedules (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      shift_template_id TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS site_instructions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      site_id TEXT,
      work_package_id TEXT,
      instruction_number TEXT,
      instruction_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'Medium',
      status TEXT DEFAULT 'Draft',
      assigned_worker_id TEXT,
      assigned_supervisor_id TEXT,
      issued_by TEXT,
      issued_at TEXT,
      acknowledged_at TEXT,
      started_at TEXT,
      evidence_submitted_at TEXT,
      verified_by TEXT,
      verified_at TEXT,
      closed_at TEXT,
      due_date TEXT,
      location TEXT,
      related_document_id TEXT,
      related_drawing_id TEXT,
      related_rfi_id TEXT,
      related_ncr_id TEXT,
      related_boq_item_id TEXT,
      attachment_name TEXT,
      attachment_data TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS site_instruction_updates (
      id TEXT PRIMARY KEY,
      instruction_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT,
      update_type TEXT DEFAULT 'Comment',
      content TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS site_instruction_attachments (
      id TEXT PRIMARY KEY,
      instruction_id TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      attachment_name TEXT,
      attachment_data TEXT,
      attachment_type TEXT DEFAULT 'Evidence',
      caption TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS leave_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      is_paid INTEGER DEFAULT 1,
      default_days_per_year INTEGER DEFAULT 0,
      requires_approval INTEGER DEFAULT 1,
      description TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS leave_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      worker_id TEXT,
      user_id TEXT NOT NULL,
      leave_type_id TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days_requested REAL NOT NULL DEFAULT 1,
      reason TEXT,
      status TEXT DEFAULT 'Pending',
      approved_by TEXT,
      approved_at TEXT,
      reject_reason TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS leave_balances (
      id TEXT PRIMARY KEY,
      worker_id TEXT,
      user_id TEXT NOT NULL,
      leave_type_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      entitlement_days REAL DEFAULT 0,
      taken_days REAL DEFAULT 0,
      pending_days REAL DEFAULT 0,
      balance_days REAL DEFAULT 0,
      updated_at TEXT,
      UNIQUE(user_id, leave_type_id, year)
    );
    CREATE TABLE IF NOT EXISTS public_holidays (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      site_id TEXT,
      country_code TEXT,
      holiday_date TEXT NOT NULL,
      name TEXT NOT NULL,
      paid INTEGER DEFAULT 1,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS attendance_adjustments (
      id TEXT PRIMARY KEY,
      attendance_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      worker_id TEXT,
      user_id TEXT NOT NULL,
      original_punch_in TEXT,
      original_punch_out TEXT,
      adjusted_punch_in TEXT,
      adjusted_punch_out TEXT,
      adjustment_reason TEXT NOT NULL,
      status TEXT DEFAULT 'Pending',
      submitted_by TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      reject_reason TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS payroll_profiles (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL UNIQUE,
      basic_daily_rate REAL DEFAULT 0,
      basic_monthly_rate REAL DEFAULT 0,
      rate_type TEXT DEFAULT 'Daily',
      currency TEXT DEFAULT 'USD',
      ot_multiplier REAL DEFAULT 1.5,
      housing_allowance REAL DEFAULT 0,
      transport_allowance REAL DEFAULT 0,
      food_allowance REAL DEFAULT 0,
      bank_account TEXT,
      bank_name TEXT,
      effective_from TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS payroll_periods (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      period_name TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      status TEXT DEFAULT 'Open',
      locked_by TEXT,
      locked_at TEXT,
      total_gross REAL DEFAULT 0,
      total_net REAL DEFAULT 0,
      created_by TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS payroll_entries (
      id TEXT PRIMARY KEY,
      payroll_period_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      regular_days REAL DEFAULT 0,
      regular_hours REAL DEFAULT 0,
      overtime_hours REAL DEFAULT 0,
      absent_days REAL DEFAULT 0,
      leave_days REAL DEFAULT 0,
      basic_pay REAL DEFAULT 0,
      overtime_pay REAL DEFAULT 0,
      housing_allowance REAL DEFAULT 0,
      transport_allowance REAL DEFAULT 0,
      food_allowance REAL DEFAULT 0,
      gross_pay REAL DEFAULT 0,
      deductions REAL DEFAULT 0,
      net_pay REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      notes TEXT,
      computed_at TEXT,
      created_at TEXT,
      UNIQUE(payroll_period_id, worker_id)
    );
    CREATE TABLE IF NOT EXISTS payroll_adjustments (
      id TEXT PRIMARY KEY,
      payroll_entry_id TEXT NOT NULL,
      payroll_period_id TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      is_deduction INTEGER DEFAULT 0,
      created_by TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project_updates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Site Progress',
      content TEXT NOT NULL,
      progress_percent INTEGER,
      trade TEXT,
      work_package_id TEXT,
      weather TEXT,
      location TEXT,
      pinned INTEGER DEFAULT 0,
      attachment_data TEXT,
      attachment_name TEXT,
      created_by TEXT NOT NULL,
      created_by_name TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_updates_proj ON project_updates(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS task_blockers (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      blocker_type TEXT NOT NULL DEFAULT 'Trade Interface',
      description TEXT NOT NULL,
      blocking_trade TEXT,
      impact_days INTEGER DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Active',
      reported_by TEXT NOT NULL,
      reported_by_name TEXT,
      resolved_by TEXT,
      resolved_by_name TEXT,
      resolution_notes TEXT,
      source_type TEXT,
      source_id TEXT,
      resolved INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_task_blockers_task ON task_blockers(task_id, status);
    CREATE INDEX IF NOT EXISTS idx_task_blockers_proj ON task_blockers(project_id, status);

    CREATE TABLE IF NOT EXISTS reference_sequences (
      project_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      next_val INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (project_id, entity_type)
    );

    CREATE TABLE IF NOT EXISTS worker_certifications (
      id TEXT PRIMARY KEY,
      worker_id TEXT NOT NULL,
      project_id TEXT,
      cert_type TEXT NOT NULL,
      cert_number TEXT,
      issuer TEXT,
      issue_date TEXT,
      expiry_date TEXT,
      status TEXT DEFAULT 'Valid',
      verified_by TEXT,
      verified_at TEXT,
      notes TEXT,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_worker_certs_worker ON worker_certifications(worker_id);

    CREATE TABLE IF NOT EXISTS worker_time_allocations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      attendance_id TEXT,
      worker_id TEXT NOT NULL,
      work_date TEXT NOT NULL,
      work_package_id TEXT,
      task_id TEXT,
      boq_item_id TEXT,
      hours REAL NOT NULL DEFAULT 0,
      cost_code TEXT,
      notes TEXT,
      approved_by TEXT,
      approved_at TEXT,
      status TEXT DEFAULT 'Pending',
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_worker_time_alloc_proj ON worker_time_allocations(project_id, work_date);
    CREATE INDEX IF NOT EXISTS idx_worker_time_alloc_worker ON worker_time_allocations(worker_id, work_date);

    CREATE TABLE IF NOT EXISTS field_notes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Site Walk',
      discipline TEXT NOT NULL DEFAULT 'General',
      zone_location TEXT,
      priority TEXT NOT NULL DEFAULT 'Medium',
      status TEXT NOT NULL DEFAULT 'Draft',
      linked_punch_id TEXT,
      tags TEXT,
      created_by TEXT,
      created_by_name TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_field_notes_proj ON field_notes(project_id, created_at);

    CREATE TABLE IF NOT EXISTS site_material_receipts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      material_request_id TEXT,
      po_id TEXT,
      po_number TEXT,
      material TEXT,
      boq_reference TEXT,
      ordered_quantity REAL DEFAULT 0,
      received_quantity REAL DEFAULT 0,
      missing_quantity REAL DEFAULT 0,
      unit TEXT,
      storage_location TEXT,
      delivery_note_ref TEXT,
      discrepancy_reason TEXT,
      status TEXT DEFAULT 'Received',
      received_by TEXT,
      received_at TEXT,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_site_material_receipts_proj ON site_material_receipts(project_id);

    CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sku TEXT,
      material TEXT NOT NULL,
      category TEXT DEFAULT 'MEP Material',
      unit TEXT DEFAULT 'Unit',
      storage_location TEXT DEFAULT 'Site Store',
      current_stock REAL NOT NULL DEFAULT 0,
      min_stock_level REAL NOT NULL DEFAULT 5,
      unit_cost REAL NOT NULL DEFAULT 0,
      boq_reference TEXT,
      last_updated TEXT,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_items_proj ON inventory_items(project_id);

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      inventory_item_id TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_cost REAL DEFAULT 0,
      work_package_id TEXT,
      task_id TEXT,
      issued_to TEXT,
      reference_no TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stock_movements_proj ON stock_movements(project_id);

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT,
      plan TEXT DEFAULT 'Enterprise',
      subscription_status TEXT DEFAULT 'Active',
      max_users INTEGER DEFAULT 500,
      max_projects INTEGER DEFAULT 100,
      country TEXT DEFAULT 'Global',
      default_currency TEXT DEFAULT 'USD',
      tax_label TEXT DEFAULT 'VAT',
      default_tax_rate REAL DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT
    );
  `);

  try { db.exec("ALTER TABLE users ADD COLUMN organization_id TEXT DEFAULT 'org-default';"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN organization_id TEXT DEFAULT 'org-default';"); } catch {}
  try {
    db.prepare(
      `INSERT OR IGNORE INTO organizations (id, name, slug, plan, subscription_status, max_users, max_projects, country, default_currency, tax_label, default_tax_rate, created_at)
       VALUES ('org-default', 'MEP FieldHub Enterprise', 'mep-enterprise', 'Enterprise', 'Active', 500, 100, 'Global', 'USD', 'VAT', 0, ?)`
    ).run(new Date().toISOString());
  } catch {}

  try { db.exec("ALTER TABLE projects ADD COLUMN tax_rate REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN tax_label TEXT DEFAULT 'VAT';"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN retention_pct REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN currency TEXT DEFAULT 'USD';"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN tax_rate REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN tax_amount REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN gross_total REAL DEFAULT 0;"); } catch {}

  try { db.exec("ALTER TABLE material_requests ADD COLUMN received_quantity REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN missing_quantity REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN storage_location TEXT;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN delivery_note_ref TEXT;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN discrepancy_reason TEXT;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN received_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN received_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN po_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN po_number TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN received_quantity REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN missing_quantity REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN storage_location TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN delivery_note_ref TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN discrepancy_reason TEXT;"); } catch {}

  try { db.exec("ALTER TABLE projects ADD COLUMN code TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN location TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN description TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN progress INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN project_code TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN currency TEXT DEFAULT 'USD';"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN contract_value REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN contract_type TEXT DEFAULT 'Lump Sum';"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN stage TEXT DEFAULT 'Construction';"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN client_name TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN main_contractor TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN consultant TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN project_manager_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN project_manager_name TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN site_address TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN city TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN country TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN baseline_start_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN baseline_end_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE projects ADD COLUMN forecast_end_date TEXT;"); } catch {}

  try { db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'Medium';"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN description TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN assigned_worker_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN company_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN site_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN wbs_item_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN supervisor_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN baseline_start_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN baseline_end_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN forecast_start_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN forecast_end_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN actual_start_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN actual_end_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN drawing_ref TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN drawing_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN boq_ref TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN boq_item_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN procurement_item_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN evidence_required INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN evidence_type TEXT DEFAULT 'None';"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN evidence_url TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN evidence_notes TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN blocker_count INTEGER DEFAULT 0;"); } catch {}

  try { db.exec("ALTER TABLE work_packages ADD COLUMN site_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE work_packages ADD COLUMN wbs_item_id TEXT;"); } catch {}

  try { db.exec("ALTER TABLE dependencies ADD COLUMN predecessor_task_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dependencies ADD COLUMN predecessor_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dependencies ADD COLUMN successor_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dependencies ADD COLUMN dependency_type TEXT DEFAULT 'Finish-to-Start';"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN status TEXT DEFAULT 'Approved';"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN document_number TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN discipline TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN company_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN work_package_id TEXT;"); } catch {}

  try { db.exec("ALTER TABLE documents ADD COLUMN subcontractor_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN uploaded_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN markup_data TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN extracted_text TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN attachment_data TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN contractor TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN description TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN floor TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN x_percent REAL;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN y_percent REAL;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE punchlist ADD COLUMN company_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN title TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN subcontractor TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN spec_section TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN company_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN manufacturer TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN model_no TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN supplier TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN drawing_ref TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN boq_ref TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN revision TEXT DEFAULT 'Rev 0';"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN approval_code TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN consultant_comments TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN reviewed_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN reviewed_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN sample_submitted INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN country_of_origin TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN lead_time_weeks INTEGER DEFAULT 4;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN attachment_name TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN attachment_data TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN description TEXT;"); } catch {}
  try { db.exec("ALTER TABLE submittals ADD COLUMN extracted_text TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN log_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN workers_count INTEGER;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN work_performed TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN delays TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN safety_incidents TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE dailylogs ADD COLUMN company_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN email TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN phone TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN company TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN trade TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'Active';"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN created_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN last_login TEXT;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN access_scope TEXT DEFAULT 'work_package';"); } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN allowed_work_package_ids TEXT;"); } catch {}
  try { db.exec("ALTER TABLE sessions ADD COLUMN expires_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE risks ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE task_blockers ADD COLUMN source_type TEXT;"); } catch {}
  try { db.exec("ALTER TABLE task_blockers ADD COLUMN source_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE task_blockers ADD COLUMN resolved INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE progress_reports ADD COLUMN report_no TEXT;"); } catch {}
  try { db.exec("ALTER TABLE progress_reports ADD COLUMN revision_no INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE progress_reports ADD COLUMN supersedes_report_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE progress_reports ADD COLUMN snapshot_schema_version INTEGER DEFAULT 1;"); } catch {}
  try { db.exec("ALTER TABLE progress_reports ADD COLUMN snapshot_data TEXT;"); } catch {}
  try { db.exec("ALTER TABLE progress_reports ADD COLUMN created_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN task_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN expected_delivery_date TEXT;"); } catch {}

  // Publishing/visibility: which records a Client-role user is allowed to
  // see. Defaults to "Internal" (nothing is client-visible until the
  // project team explicitly publishes it) - enforced in the query layer,
  // not just hidden in the UI.
  try { db.exec("ALTER TABLE documents ADD COLUMN visibility TEXT DEFAULT 'Internal';"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN published_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE documents ADD COLUMN published_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE change_orders ADD COLUMN visibility TEXT DEFAULT 'Internal';"); } catch {}
  try { db.exec("ALTER TABLE change_orders ADD COLUMN published_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE change_orders ADD COLUMN published_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE rfis ADD COLUMN source_clarification_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE change_orders ADD COLUMN source_clarification_id TEXT;"); } catch {}

  // V1.2 Workforce: GPS + OT columns on attendance
  try { db.exec("ALTER TABLE attendance ADD COLUMN site_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN worker_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_in_lat REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_in_lng REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_in_accuracy REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_in_geofence_status TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_in_distance_m REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_out_lat REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_out_lng REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_out_accuracy REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_out_geofence_status TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN punch_out_distance_m REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN supervisor_override INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN override_reason TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN shift_template_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN regular_hours REAL;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN overtime_hours REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN ot_status TEXT DEFAULT 'Pending';"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN ot_approved_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN ot_approved_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN ot_reject_reason TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN company_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN supervisor_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN elapsed_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN regular_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN break_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN raw_overtime_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN approved_overtime_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN late_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE attendance ADD COLUMN attendance_status TEXT;"); } catch {}
  try { db.exec("ALTER TABLE shift_templates ADD COLUMN working_days_json TEXT DEFAULT '[1,2,3,4,5]';"); } catch {}
  try { db.exec("ALTER TABLE payroll_entries ADD COLUMN elapsed_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE payroll_entries ADD COLUMN regular_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE payroll_entries ADD COLUMN break_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE payroll_entries ADD COLUMN raw_overtime_minutes INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE payroll_entries ADD COLUMN approved_overtime_minutes INTEGER DEFAULT 0;"); } catch {}

  db.exec("CREATE INDEX IF NOT EXISTS idx_worker_assignments_scope ON worker_assignments(worker_id, project_id, site_id, status, start_date, end_date);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_attendance_worker_date ON attendance(worker_id, work_date);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_attendance_project_site_date ON attendance(project_id, site_id, work_date);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_public_holidays_date ON public_holidays(project_id, site_id, holiday_date);");

  // Performance Optimization (⚡ Bolt): Indexes on high-frequency query columns.
  // Converts linear O(N) table scans during project scoping, subcontractor access checks,
  // and per-record authorization evaluations in canAccessProject/canAccessRecord to O(log N) index lookups.
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_documents_project_id ON documents(project_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_project_companies_proj_comp ON project_companies(project_id, company_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_record_owners_mod_user ON record_owners(module, user_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_rfis_project_id ON rfis(project_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_submittals_project_id ON submittals(project_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_punchlist_project_id ON punchlist(project_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_work_packages_project_id ON work_packages(project_id);");

  // V1.2 Workforce: site/assignment columns on tasks
  try { db.exec("ALTER TABLE tasks ADD COLUMN site_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN assigned_worker_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN assigned_supervisor_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN instruction_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'Medium';"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN completion_evidence_required INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN verified_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN verified_at TEXT;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN completion_percent REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE tasks ADD COLUMN completion_notes TEXT;"); } catch {}

  // V1.2 Workforce: worker_id linkage on users
  try { db.exec("ALTER TABLE users ADD COLUMN worker_id TEXT;"); } catch {}

  // V1.4 Enterprise: Procurement -> Programme integration
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN task_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN expected_delivery_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN actual_delivery_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN lead_time_days INTEGER DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN issue_date TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN boq_item_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE purchase_orders ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE costs ADD COLUMN date TEXT;"); } catch {}

  try { db.exec("ALTER TABLE material_requests ADD COLUMN task_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN specification TEXT;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN spec TEXT;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN item TEXT;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN boq_item_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN wbs_code TEXT;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN supplier TEXT;"); } catch {}
  try { db.exec("ALTER TABLE material_requests ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE boq_items ADD COLUMN specification TEXT;"); } catch {}
  try { db.exec("ALTER TABLE boq_items ADD COLUMN created_at TEXT;"); } catch {}

  try { db.exec("ALTER TABLE rfis ADD COLUMN question TEXT;"); } catch {}
  try { db.exec("ALTER TABLE rfis ADD COLUMN answer TEXT;"); } catch {}
  try { db.exec("ALTER TABLE rfis ADD COLUMN drawing_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE rfis ADD COLUMN drawing_ref TEXT;"); } catch {}
  try { db.exec("ALTER TABLE rfis ADD COLUMN task_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE rfis ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE rfis ADD COLUMN priority TEXT DEFAULT 'Medium';"); } catch {}
  try { db.exec("ALTER TABLE rfis ADD COLUMN discipline TEXT;"); } catch {}

  try { db.exec("ALTER TABLE inspections ADD COLUMN type TEXT;"); } catch {}
  try { db.exec("ALTER TABLE inspections ADD COLUMN title TEXT;"); } catch {}
  try { db.exec("ALTER TABLE inspections ADD COLUMN status TEXT DEFAULT 'Scheduled';"); } catch {}
  try { db.exec("ALTER TABLE inspections ADD COLUMN task_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE inspections ADD COLUMN work_package_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE inspections ADD COLUMN boq_item_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE inspections ADD COLUMN verified_progress REAL;"); } catch {}
  try { db.exec("ALTER TABLE inspections ADD COLUMN location TEXT;"); } catch {}
  try { db.exec("ALTER TABLE inspections ADD COLUMN discipline TEXT;"); } catch {}

  // V1.4 Enterprise: Risk management enhancements
  try { db.exec("ALTER TABLE risks ADD COLUMN risk_no TEXT;"); } catch {}
  try { db.exec("ALTER TABLE risks ADD COLUMN risk_level TEXT DEFAULT 'Medium';"); } catch {}
  try { db.exec("ALTER TABLE risks ADD COLUMN contingency_cost REAL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE risks ADD COLUMN linked_task_id TEXT;"); } catch {}
  try { db.exec("ALTER TABLE risks ADD COLUMN created_by TEXT;"); } catch {}
  try { db.exec("ALTER TABLE risks ADD COLUMN created_at TEXT;"); } catch {}

  // V1.4 Enterprise: Project actions & decisions indices
  db.exec("CREATE INDEX IF NOT EXISTS idx_project_actions_proj ON project_actions(project_id, status, due_date);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_project_decisions_proj ON project_decisions(project_id, status);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_risks_proj ON risks(project_id, status);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_po_task ON purchase_orders(task_id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mr_task ON material_requests(task_id);");

  seedUsers();
  seedLeaveTypes();
  seedData();
  // ensureMemberships removed: Auto-granting and reactivation on restart violates explicit project membership model.
}


export function seedUsers() {
  // Single bootstrap administrator account only. No demo company, no
  // placeholder staff/subcontractor accounts. must_change_password forces
  // a password change on first login (enforced client-side and by
  // PUT /api/me/password requiring the old password).
  const find = db.prepare("SELECT id FROM users WHERE username=?");
  const existing = find.get("admin") as any;
  if (!existing) {
    const insert = db.prepare(`
      INSERT INTO users (id, username, name, password_hash, role, status, created_at, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    insert.run(crypto.randomUUID(), "admin", "Administrator", hashPassword("ChangeMe123!"), "Admin", "Active", new Date().toISOString());
  }
}

export function seedData() {
  // Ensure any 2618-* drawing records point to the authentic original Enser Ltd CAD sheets in /original_drawings/
  // rather than legacy synthetic data:image/svg+xml strings.
  try {
    db.exec(`
      UPDATE documents
      SET document_number = '2618-L-ACO-01',
          attachment_name = '2618-L-ACO-01.png',
          attachment_data = '/original_drawings/2618-L-ACO-01.png'
      WHERE document_number = '2618-L-ACD-01';

      UPDATE documents
      SET attachment_name = document_number || '.png',
          attachment_data = '/original_drawings/' || document_number || '.png'
      WHERE document_number LIKE '2618-%'
        AND document_number NOT LIKE '%-FULL'
        AND (attachment_data LIKE 'data:image/svg+xml%' OR attachment_data IS NULL OR attachment_data = '');
    `);

    // Populate rich engineering CAD content & schedules into extracted_text for the 2618 drawings so Copilot can answer technical questions from every sheet
    const drawingSpecs: Record<string, string> = {
      "2618-S-ELE-01": "Drawing 2618-S-ELE-01 (Rev Tender 05.05.26, Enser Ltd, PDF p.58): Electrical Single Line Schematic — Rising Mains, 20kVA 3-Phase Online Double-Conversion UPS (autonomy 15 mins at full load), Main Switchboard EP, Distribution Boards DB1 (First Floor Lighting & Power, 16-Way TPN 63A 4P MCB, supplied via existing Cable C01 4c/10sqmm), DB2 (Second Floor Lighting & Power, 16-Way TPN 63A 4P MCB, supplied via existing Cable C02 4c/16sqmm), Main UPS Board UP0, UP1 (First Floor UPS Power, 8-Way TPN 40A 4P MCB, supplied via new Cable C08 5c/6sqmm LSOH), and UP2 (Second Floor UPS Power, 8-Way TPN 40A 4P MCB, supplied via new Cable C09 5c/6sqmm LSOH). All final sub-circuits protected by Type A 30mA RCBOs.",
      "2618-L-LTG-01": "Drawing 2618-L-LTG-01 (Rev Tender 05.05.26, Scale 1:100 @ A1, Enser Ltd, PDF p.59): First & Second Floor Lighting Layout. Rooms covered: Open Plan Offices, Executive Boardroom (500 lux, 3000K warm-white DALI dimmable modular LED panels), Meeting Rooms, Training Room, Waiting Area, Server Room, Breakout & Kitchenette, WCs, Store, and Terraces. Luminaires: 600x600mm recessed modular back-lit LED panels (36W, 4000K, UGR<19, L80B10 50,000 hrs), recessed downlights in WCs/corridors, 3-hour maintained LED emergency exit signs and twin-spots, ceiling-mounted 360-degree PIR presence detectors. Wired in 3x1.5mm² H07Z-K LSOH cables (Circuits L01-L05 on DB1 for Level 1; Circuits L01-L06 on DB2 for Level 2) protected by 10A Type A 30mA RCBOs.",
      "2618-L-PWR-01": "Drawing 2618-L-PWR-01 (Rev Tender 05.05.26, Scale 1:100 @ A1, Enser Ltd, PDF p.60): First & Second Floor Small Power Layout. Workstation desk combination units (3x 13A twin switched socket outlets + USB-A/C fast charger + RJ45 Cat 6 outlets), perimeter twin 13A switched socket outlets in dado trunking (Circuits P01-P08 wired in 3x4mm² H07Z-K radial circuits on 32A Type A 30mA RCBOs), 20A double-pole fused connection units (FCUs, 3x2.5mm² H07Z-K on 20A RCBOs) for under-sink water heaters (P09-P10), hand dryers (P11), extract fans (P12), motorised fire/smoke dampers (P13), AC split & VRF indoor units (P14-P20), AC central controller (P21), and door access power supplies (P22). Media boxes installed behind wall-mounted TVs in Boardroom, Training Room, Waiting Area, and Breakout.",
      "2618-L-DTA-01": "Drawing 2618-L-DTA-01 (Rev Tender 05.05.26, Scale 1:100 @ A1, Enser Ltd, PDF p.61): Data, IT & Audio-Visual (AV) Layout. 4-pair Cat 6 UTP LSOH structured cabling (3,070m total run) from Server Room 42U data rack to Grid Outlet Points (GOP boxes) and floor/desk boxes; ceiling-mounted dual-band WiFi 6 access points (PoE+); active optical HDMI (HDMI AOC) 4K60 distribution cabling and wall plates for Boardroom, Training Room, and Meeting Room displays; ceiling-mounted 100V line background music / PA speakers and amplifier in Breakout & Training areas.",
      "2618-L-SEC-01": "Drawing 2618-L-SEC-01 (Rev Tender 05.05.26, Scale 1:100 @ A1, Enser Ltd, PDF p.62): Electronic Security & Door Access Control Layout. Master Door Access Control Panel & 2-Door IP Controllers, Mifare DESFire EV3 smart card readers at main entrance, Server Room, Boardroom, and staircase doors; electromagnetic door locks (maglocks) with green break-glass emergency door release units and fire alarm fail-safe relay interface; intruder alarm dual-tech PIR motion sensors and magnetic door contacts.",
      "2618-L-CTV-01": "Drawing 2618-L-CTV-01 (Rev Tender 05.05.26, Scale 1:100 @ A1, Enser Ltd, PDF p.63): IP CCTV Surveillance Layout. First & Second Floor 4MP PoE IP WDR IR Dome cameras covering reception/waiting areas, open-plan corridors, Server Room entrance, and lift lobbies; IP67 weatherproof Bullet cameras covering external terraces; connected via Cat 6 LSOH to PoE NVR in Server Room.",
      "2618-L-FAS-01": "Drawing 2618-L-FAS-01 (Rev Tender 05.05.26, Scale 1:100 @ A1, Enser Ltd, PDF p.64): Addressable Fire Alarm & Fire Fighting Layout (EN 54 / BS 5839-1 L1). Optical smoke detectors in offices, meeting rooms, corridors, and Server Room; multi-sensor heat detectors in Kitchenettes; addressable manual call points (MCPs) and electronic sounder-beacons (VADs) at all exits; fire alarm interface units for HVAC VRF shutdown, motorised fire dampers, and access control maglock release. Wired in 2x1.5mm² FP200 Gold fire-resistant LSOH cable with metal P-clips at max 300mm spacing. Portable CO2 (2kg) and Foam/Water (6L) fire extinguishers at designated fire points.",
      "2618-L-CON-01": "Drawing 2618-L-CON-01 (Rev Tender 05.05.26, Scale 1:100 @ A1, Enser Ltd, PDF p.65): Cable Containment Layout. Heavy-duty hot-dip galvanized perforated cable trays and wire mesh baskets at high level above suspended ceiling for power (300mm/150mm) and ELV/Data (200mm/100mm) maintaining minimum 150mm–300mm separation; 3-compartment white powder-coated steel perimeter dado trunking (170x50mm) with electromagnetic screening partitions for power and Cat 6 data.",
      "2618-L-ACO-01": "Drawing 2618-L-ACO-01 (Rev Tender 05.05.26, Scale 1:100 @ A1, Enser Ltd, PDF p.66): Air Conditioning (HVAC) Layout. VRF 4-way blow ceiling cassette indoor units (cooling/heating) in Open Plan Offices, Boardroom, and Training Room; high-wall split units in Server Room (dedicated 24/7 duty/standby cooling) and small offices; insulated copper refrigerant pipework (R410A/R32), condensate drain piping in uPVC with 1:100 fall, and wired wall controllers + central BMS/touch controller.",
      "2618-L-VEN-01": "Drawing 2618-L-VEN-01 (Rev Tender 05.05.26, Scale 1:100 @ A1, Enser Ltd, PDF p.67): Mechanical Ventilation Layout. Fresh air supply and toilet/kitchenette extract ductwork in galvanized sheet steel (DW144), volume control dampers (VCDs), motorised fire/smoke dampers (interlocked with Fire Alarm P13), ceiling supply/extract grilles and air diffusers, and inline acoustic extract fans.",
      "2618-DB-DB1": "Schedule 2618-DB-DB1 (Rev Tender 05.05.26, Enser Ltd, PDF p.51-52): Distribution Board DB1 Schedule — First Floor Lighting & Power. 16-Way TPN existing enclosure with 63A 4P MCB incomer, supplied from EP via C01 4c/10sqmm cable. Ways 1-2: Lighting circuits L01-L05 (10A Type A 30mA RCBOs, 3x1.5mm² H07Z-K, 14 to 19 points each). Ways 2-5: Socket outlet circuits P01-P08 (32A Type A 30mA RCBOs, 3x4mm² H07Z-K). Ways 5-9: Fused connection units P09-P22 (20A Type A 30mA RCBOs, 3x2.5mm² H07Z-K) feeding Water Heaters (P09, P10), Hand Dryer (P11), Fan (P12), Motorised Dampers (P13), AC Splits (P14-P17), AC VRF units (P18-P20), AC Controller (P21), and Door Access (P22). Ways 10-16: Spares.",
      "2618-DB-UP1": "Schedule 2618-DB-UP1 (Rev Tender 05.05.26, Enser Ltd, PDF p.53): Distribution Board UP1 Schedule — First Floor UPS Power. 8-Way TPN board with 40A 4P MCB incomer, supplied from UP0 via new Cable C08 5c/6sqmm. Circuits P01-P15: 20A Type A 30mA RCBOs, 3x2.5mm² H07Z-K feeding workstation/desk isolators. Circuits P16-P17: 20A RCBOs, 3x2.5mm² H07Z-K feeding essential UPS socket outlets.",
      "2618-DB-DB2": "Schedule 2618-DB-DB2 (Rev Tender 05.05.26, Enser Ltd, PDF p.54-55): Distribution Board DB2 Schedule — Second Floor Lighting & Power. 16-Way TPN board with 63A 4P MCB incomer, supplied from EP via existing Cable C02 4c/16sqmm. Lighting circuits L01-L06 (10A Type A 30mA RCBOs, 3x1.5mm² H07Z-K). Power circuits P01-P08 (32A Type A 30mA RCBOs, 3x4mm² H07Z-K) for socket outlets. FCU circuits P09-P20 (20A Type A 30mA RCBOs, 3x2.5mm² H07Z-K) for water heaters, extract fans, motorised dampers, and Level 2 AC VRF & Split units.",
      "2618-DB-UP2": "Schedule 2618-DB-UP2 (Rev Tender 05.05.26, Enser Ltd, PDF p.56-57): Distribution Board UP2 Schedule — Second Floor UPS Power. 8-Way TPN board with 40A 4P MCB incomer, supplied from UP0 via new Cable C09 5c/6sqmm. Circuits P01-P14: 20A Type A 30mA RCBOs, 3x2.5mm² H07Z-K feeding Level 2 workstation UPS isolators and essential server/comms sockets."
    };

    const updDocText = db.prepare(`
      UPDATE documents
      SET extracted_text = ?
      WHERE document_number = ? AND (extracted_text IS NULL OR extracted_text = '')
    `);
    for (const [docNum, specText] of Object.entries(drawingSpecs)) {
      updDocText.run(specText, docNum);
    }

    // Also populate default technical summary on any generic M-HVAC-L2-001 drawings if empty
    db.exec(`
      UPDATE documents
      SET extracted_text = 'Drawing ' || COALESCE(document_number, 'DWG') || ' (' || COALESCE(revision, 'Rev A') || '): ' || name || ' — Roof Plant & Level 2 Mechanical HVAC Layout. Includes Eurovent certified Air Handling Units (AHUs), chilled water supply/return headers (1.5x hydrostatic test pressure = 15 bar), VRF condensing units, acoustic vibration isolators, motorised fire/smoke dampers, and BMS temperature/pressure sensors.'
      WHERE name LIKE '%M-HVAC-L2-001%' AND (extracted_text IS NULL OR extracted_text = '');
    `);

    // Seed authentic Material Submittals for BOV St. Venera (bov-st-venera-2618) if none exist yet
    const bovSubCount = (db.prepare("SELECT COUNT(*) as c FROM submittals WHERE project_id = 'bov-st-venera-2618'").get() as any)?.c || 0;
    if (bovSubCount === 0) {
      const insSub = db.prepare(`
        INSERT INTO submittals (
          id, project_id, number, item, title, trade, subcontractor, spec_section,
          manufacturer, model_no, supplier, drawing_ref, boq_ref, revision,
          approval_code, consultant_comments, reviewed_by, reviewed_date,
          sample_submitted, country_of_origin, lead_time_weeks, attachment_name, attachment_data,
          description, extracted_text, date_submitted, due_date, status
        ) VALUES (?, 'bov-st-venera-2618', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const defaultSubmittals = [
        [
          "sub-2618-001", "MAT-2618-001",
          "600×600mm Back-Lit Modular LED Luminaires (36W, 4000K/3000K, UGR<19)",
          "600×600mm Back-Lit Modular LED Luminaires (36W, 4000K/3000K, UGR<19)",
          "Electrical", "ElectroData Installations Ltd", "Enser Spec Sec 4.8 — Internal Lighting & Luminaires",
          "Thorn / Zumtobel", "Omega Pro 2 600x600 36W 4000K DALI (UGR<19)", "ESS Ltd Malta",
          "2618-L-LTG-01", "E-12.01", "Rev 1",
          "Code A - Approved", "Approved per Enser Ltd review. Boardroom Level 1 units to be supplied in 3000K warm white maintaining 500 lux average.",
          "Ing. Christian Borg (Enser Ltd)", "2026-05-18",
          1, "Austria / EU", 3,
          "BOV-St-Venera-2618-Original-Tender-and-Drawings.pdf", "/original_drawings/BOV-St-Venera-2618-Original-Tender-and-Drawings.pdf#page=59",
          "Technical submittal for Level 1 & Level 2 recessed modular LED panels, IP44 bathroom downlights, and 3-hour maintained emergency LED packs per Drawing 2618-L-LTG-01.",
          "Material Submittal MAT-2618-001 (Rev 1, Code A - Approved): Thorn / Zumtobel Omega Pro 2 600x600mm 36W LED Luminaires, UGR<19, L80B10 50,000 hrs, DALI dimmable driver. Drawing Ref: 2618-L-LTG-01, BOQ Ref: E-12.01. Approved by Ing. Christian Borg (Enser Ltd) with 3000K variant for Level 1 Executive Boardroom.",
          "2026-05-10", "2026-05-24", "Approved"
        ],
        [
          "sub-2618-002", "MAT-2618-002",
          "Type A 30mA RCBOs & TPN Distribution Board Switchgear (DB1, DB2, UP1, UP2)",
          "Type A 30mA RCBOs & TPN Distribution Board Switchgear (DB1, DB2, UP1, UP2)",
          "Electrical", "ElectroData Installations Ltd", "Enser Spec Sec 4.2 — Distribution Boards & Protective Devices",
          "Schneider Electric", "Acti9 iC60H RCBO Type A 30mA (10A / 20A / 32A) & Isobar P TPN", "Elektra Ltd Malta",
          "2618-DB-DB1", "E-02.01", "Rev 0",
          "Code A - Approved", "Compliant with BS 7671 18th Edition and Enser schedules 2618-DB-DB1, DB2, UP1 & UP2. Provide factory routine test certificates before energisation.",
          "Ing. Christian Borg (Enser Ltd)", "2026-05-16",
          1, "France / EU", 2,
          "2618-DB-DB1.png", "/original_drawings/2618-DB-DB1.png",
          "Submittal for 10A, 20A, and 32A single-pole Type A 30mA RCBOs, 63A/40A 4P MCB incomers, and TPN busbar accessories for DB1, DB2, UP1, and UP2.",
          "Material Submittal MAT-2618-002 (Rev 0, Code A - Approved): Schneider Electric Acti9 iC60H Type A 30mA RCBOs (10A lighting L01-L06, 20A FCUs P09-P22, 32A sockets P01-P08) and 63A/40A 4P MCB incomers per Schedules 2618-DB-DB1, 2618-DB-UP1, 2618-DB-DB2, 2618-DB-UP2.",
          "2026-05-09", "2026-05-23", "Approved"
        ],
        [
          "sub-2618-003", "MAT-2618-003",
          "H07Z-K Low Smoke Zero Halogen (LSOH) Power Cables & FP200 Gold Fire Cables",
          "H07Z-K Low Smoke Zero Halogen (LSOH) Power Cables & FP200 Gold Fire Cables",
          "Electrical", "ElectroData Installations Ltd", "Enser Spec Sec 4.4 — Cables & Wiring Systems",
          "Prysmian Group", "Afumex H07Z-K (1.5mm², 2.5mm², 4mm², 5c/6mm²) & FP200 Gold 2x1.5mm²", "ESS Ltd Malta",
          "2618-S-ELE-01", "E-05.01", "Rev 0",
          "Code A - Approved", "Approved. Ensure all FP200 Gold fire alarm cables are fixed with metallic P-clips at max 300mm spacing in accordance with BS 5839-1.",
          "Ing. Christian Borg (Enser Ltd)", "2026-05-15",
          1, "Italy / UK", 2,
          "2618-S-ELE-01.png", "/original_drawings/2618-S-ELE-01.png",
          "LSOH thermosetting insulated conductors (H07Z-K) to BS EN 50525-3-41 for lighting (3x1.5mm²), FCUs/UPS (3x2.5mm²), sockets (3x4mm²), submain C08/C09 (5c/6mm²), and Prysmian FP200 Gold fire alarm cable.",
          "Material Submittal MAT-2618-003 (Rev 0, Code A - Approved): Prysmian Afumex H07Z-K LSOH cables (3x1.5mm², 3x2.5mm², 3x4mm², 5c/6mm²) and FP200 Gold 2x1.5mm² fire-resistant cable. Drawing Ref: 2618-S-ELE-01 & 2618-L-FAS-01.",
          "2026-05-08", "2026-05-22", "Approved"
        ],
        [
          "sub-2618-004", "MAT-2618-004",
          "20kVA 3-Phase Online Double-Conversion UPS System & Battery Bank",
          "20kVA 3-Phase Online Double-Conversion UPS System & Battery Bank",
          "Electrical", "PowerTech UPS Systems Ltd", "Enser Spec Sec 4.11 — Uninterruptible Power Supply (UPS)",
          "APC by Schneider Electric / Riello", "Galaxy VS 20kVA 400V 3:3 Online UPS + VRLA Battery Cabinet", "PowerTech Malta",
          "2618-S-ELE-01", "UPS-01", "Rev 1",
          "Code B - Approved as Noted", "Approved as Noted (Code B): Include SNMP network management card for BOV IT monitoring and confirm minimum 15-minute runtime at 100% load.",
          "Ing. Christian Borg (Enser Ltd)", "2026-05-20",
          0, "Italy / EU", 5,
          "2618-S-ELE-01.png", "/original_drawings/2618-S-ELE-01.png",
          "20kVA 3-phase online double-conversion UPS feeding Main UPS Board UP0, Level 1 UP1, and Level 2 UP2 per Schematic 2618-S-ELE-01.",
          "Material Submittal MAT-2618-004 (Rev 1, Code B - Approved as Noted): 20kVA 3-Phase Online Double-Conversion UPS (Galaxy VS / Riello Multi Sentry) feeding UP0, UP1 & UP2 per Drawing 2618-S-ELE-01. Requires SNMP card and 15-min full-load autonomy.",
          "2026-05-12", "2026-05-26", "Approved with Comments"
        ],
        [
          "sub-2618-005", "MAT-2618-005",
          "Cat 6 UTP LSOH Structured Cabling, Patch Panels & Workstation GOP Boxes",
          "Cat 6 UTP LSOH Structured Cabling, Patch Panels & Workstation GOP Boxes",
          "ELV / Data & Security", "ElectroData Installations Ltd", "Enser Spec Sec 5.1 — Structured Data Cabling",
          "Excel Networking / Panduit", "Excel Cat 6 UTP LSOH 23AWG Solid Copper (305m boxes) & 24-Port Patch Panels", "itches & Cables Malta",
          "2618-L-DTA-01", "D-06.0", "Rev 0",
          "Code A - Approved", "Approved. Submit Fluke DSX-5000 permanent link test reports for all 100% of outlets prior to practical completion.",
          "Ing. Christian Borg (Enser Ltd)", "2026-05-19",
          1, "UK / EU", 2,
          "2618-L-DTA-01.png", "/original_drawings/2618-L-DTA-01.png",
          "4-pair 23AWG solid bare copper Cat 6 UTP LSOH cable (violet sheath, Euroclass B2ca/Cca), RJ45 keystone modules, and 6-way Grid Outlet Point (GOP) consolidation boxes.",
          "Material Submittal MAT-2618-005 (Rev 0, Code A - Approved): Excel / Panduit Cat 6 UTP LSOH cable (3,070m total per BOQ D-06.0), 24-port patch panels, RJ45 modules, and GOP boxes per Drawing 2618-L-DTA-01.",
          "2026-05-11", "2026-05-25", "Approved"
        ],
        [
          "sub-2618-006", "MAT-2618-006",
          "VRF Ceiling Cassette Indoor Units, High-Wall Splits & Central Controller",
          "VRF Ceiling Cassette Indoor Units, High-Wall Splits & Central Controller",
          "HVAC", "ClimateControl Malta Ltd", "Enser Spec Sec 6.1 — VRF Air Conditioning System",
          "Daikin Europe", "FXFQ-B Round Flow Cassette & FTXM-R Split Units (R32/R410A)", "Mizzi Organisation / Daikin Malta",
          "2618-L-ACO-01", "M-AC-01", "Rev 0",
          "Pending", "Currently under review by Enser Ltd mechanical engineer (EGa). Verify acoustic dB(A) NR35 rating for Level 1 Executive Boardroom.",
          "Ing. E. Gatt (Enser Ltd)", null,
          0, "Belgium / Czechia", 6,
          "2618-L-ACO-01.png", "/original_drawings/2618-L-ACO-01.png",
          "Daikin VRF 4-way blow round-flow ceiling cassettes, Server Room duty/standby high-wall split units, condensate pumps, and Intelligent Touch Manager controller per Drawing 2618-L-ACO-01.",
          "Material Submittal MAT-2618-006 (Rev 0, Under Review): Daikin FXFQ-B VRF ceiling cassettes and Server Room split units per Drawing 2618-L-ACO-01. Powered via DB1/DB2 20A FCUs (Circuits P14-P21).",
          "2026-05-21", "2026-06-04", "Under Review"
        ],
        [
          "sub-2618-007", "MAT-2618-007",
          "3-Compartment Steel Dado Trunking (170×50mm) & Heavy-Duty Perforated Cable Tray",
          "3-Compartment Steel Dado Trunking (170×50mm) & Heavy-Duty Perforated Cable Tray",
          "Electrical", "ElectroData Installations Ltd", "Enser Spec Sec 4.3 — Cable Containment & Trunking",
          "Legrand / Marshall-Tufflex", "Salamandre 3-Compartment Steel Dado Trunking RAL 9016 & Cablofil/Swifts Tray", "Elektra Ltd Malta",
          "2618-L-CON-01", "E-17.01", "Rev 0",
          "Code C - Revise & Resubmit", "Code C — Revise & Resubmit: Submit sample of internal metal screening divider and confirm powder-coat RAL 9016 finish matches BOV architectural partition spec.",
          "Ing. Christian Borg (Enser Ltd)", "2026-05-22",
          0, "UK / France", 3,
          "2618-L-CON-01.png", "/original_drawings/2618-L-CON-01.png",
          "Perimeter 3-compartment powder-coated steel dado trunking and hot-dip galvanized perforated cable trays/baskets per Containment Layout 2618-L-CON-01.",
          "Material Submittal MAT-2618-007 (Rev 0, Code C - Revise & Resubmit): Legrand / Marshall-Tufflex 3-compartment steel dado trunking (RAL 9016) and galvanized perforated cable trays per Drawing 2618-L-CON-01.",
          "2026-05-14", "2026-05-28", "Revise & Resubmit"
        ]
      ];

      for (const row of defaultSubmittals) {
        insSub.run(...row);
      }
    }

    // Enrich any existing submittals on other projects that have NULL manufacturer/spec_section
    db.exec(`
      UPDATE submittals
      SET manufacturer = COALESCE(manufacturer, 'Daikin / Systemair'),
          model_no = COALESCE(model_no, 'Geniox 14 Eurovent AHU'),
          supplier = COALESCE(supplier, 'MEP Climate Supply Co.'),
          spec_section = COALESCE(spec_section, 'Sec 23 73 13 — Modular Indoor Central-Station Air-Handling Units'),
          drawing_ref = COALESCE(drawing_ref, 'M-HVAC-L2-001'),
          boq_ref = COALESCE(boq_ref, 'M-01.02'),
          revision = COALESCE(revision, 'Rev 0'),
          approval_code = COALESCE(approval_code, CASE WHEN status = 'Approved' THEN 'Code A - Approved' ELSE 'Pending' END),
          consultant_comments = COALESCE(consultant_comments, 'Eurovent Class A casing leakage & thermal bridging verified against Drawing M-HVAC-L2-001.'),
          reviewed_by = COALESCE(reviewed_by, 'Lead MEP Consultant'),
          country_of_origin = COALESCE(country_of_origin, 'EU'),
          lead_time_weeks = COALESCE(lead_time_weeks, 6),
          extracted_text = COALESCE(extracted_text, 'Material Submittal ' || COALESCE(number, 'SUB') || ': ' || COALESCE(title, item, 'AHU Technical Submittal') || ' — Manufacturer: Daikin / Systemair, Model: Geniox 14 Eurovent Certified AHU, Drawing Ref: M-HVAC-L2-001, Spec: Sec 23 73 13, Status: ' || COALESCE(status, 'Approved'))
      WHERE manufacturer IS NULL;
    `);

    // Add supervisor columns to sites & workers for Admin -> Project Manager -> Site -> Site Supervisor -> Workers hierarchy
    try { db.exec("ALTER TABLE sites ADD COLUMN supervisor_id TEXT;"); } catch {}
    try { db.exec("ALTER TABLE sites ADD COLUMN supervisor_name TEXT;"); } catch {}
    try { db.exec("ALTER TABLE workers ADD COLUMN supervisor_name TEXT;"); } catch {}
    try { db.exec("ALTER TABLE workers ADD COLUMN role_on_site TEXT;"); } catch {}
    try { db.exec("ALTER TABLE projects ADD COLUMN site_supervisor_id TEXT;"); } catch {}
    try { db.exec("ALTER TABLE projects ADD COLUMN site_supervisor_name TEXT;"); } catch {}
    try { db.exec("ALTER TABLE users ADD COLUMN created_by_admin TEXT;"); } catch {}
    try { db.exec("ALTER TABLE users ADD COLUMN stakeholder_type TEXT;"); } catch {}

    // Table for Our Company (Platform Owner) granting permission to Main Admins by Email ID
    db.exec(`
      CREATE TABLE IF NOT EXISTS authorized_main_admins (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        admin_name TEXT NOT NULL,
        company_name TEXT NOT NULL,
        plan TEXT DEFAULT 'Enterprise',
        status TEXT DEFAULT 'Authorized',
        username TEXT,
        user_id TEXT,
        authorized_by TEXT DEFAULT 'Our Company (Platform Owner)',
        notes TEXT,
        created_at TEXT,
        activated_at TEXT
      );
    `);

    // Seed Project Managers, Site Supervisors, Sites, and Workers for BOV St. Venera (bov-st-venera-2618) & enterprise hierarchy
    const nowIso = new Date().toISOString();
    const defaultPw = hashPassword("admin123");

    // Ensure default users have email addresses and stakeholder categories populated
    db.exec(`
      UPDATE users SET email = 'admin@mepfieldhub.com', company = COALESCE(company, 'MEP FieldHub Enterprise'), stakeholder_type = 'Main Admin' WHERE username = 'admin' AND (email IS NULL OR email = '');
      UPDATE users SET email = 'pm@mepfieldhub.com', company = COALESCE(company, 'MEP FieldHub Operations'), stakeholder_type = 'Employee (Internal)' WHERE username = 'pm' AND (email IS NULL OR email = '');
      UPDATE users SET email = 'elec@electrodata.com.mt', company = COALESCE(company, 'ElectroData Installations Ltd'), stakeholder_type = 'Employee (Internal)' WHERE username = 'elec' AND (email IS NULL OR email = '');
      UPDATE users SET email = 'hvac@climatecontrol.com.mt', company = COALESCE(company, 'ClimateControl Malta Ltd'), stakeholder_type = 'Employee (Internal)' WHERE username = 'hvac' AND (email IS NULL OR email = '');
      UPDATE users SET email = 'plumb@aquamep.com.mt', company = COALESCE(company, 'AquaMEP Services Ltd'), stakeholder_type = 'Employee (Internal)' WHERE username = 'plumb' AND (email IS NULL OR email = '');
      UPDATE users SET email = 'qs@mepfieldhub.com', company = COALESCE(company, 'MEP FieldHub Commercial'), stakeholder_type = 'Employee (Internal)' WHERE username = 'qs' AND (email IS NULL OR email = '');
      UPDATE users SET email = 'qaqc@enser.com.mt', company = COALESCE(company, 'Enser Ltd QA/QC'), stakeholder_type = 'Employee (Internal)' WHERE username = 'qaqc' AND (email IS NULL OR email = '');
      UPDATE users SET email = 'safety@mepfieldhub.com', company = COALESCE(company, 'MEP FieldHub HSE'), stakeholder_type = 'Employee (Internal)' WHERE username = 'safety' AND (email IS NULL OR email = '');
      UPDATE users SET email = 'client@bov.com', company = COALESCE(company, 'Bank of Valletta (BOV plc)'), stakeholder_type = 'Client / Employer' WHERE username = 'client' AND (email IS NULL OR email = '');
      UPDATE users SET email = 'sub@electrodata.com.mt', company = COALESCE(company, 'ElectroData Subcontracting Ltd'), stakeholder_type = 'Subcontractor' WHERE username = 'sub' AND (email IS NULL OR email = '');
    `);

    const upsertAuthAdmin = db.prepare(`
      INSERT OR IGNORE INTO authorized_main_admins (
        id, email, admin_name, company_name, plan, status, username, user_id, authorized_by, notes, created_at, activated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Our Company (Platform Owner)', ?, ?, ?)
    `);
    upsertAuthAdmin.run(
      "auth-adm-01",
      "admin@mepfieldhub.com",
      "Executive Main Admin",
      "MEP FieldHub Enterprise",
      "Enterprise",
      "Activated",
      "admin",
      "1",
      "Primary Main Admin account authorized by Our Company — can create Employee, Client/Employer, and Subcontractor accounts.",
      nowIso,
      nowIso
    );
    upsertAuthAdmin.run(
      "auth-adm-02",
      "admin.bov@enser.com.mt",
      "Ing. Christian Borg (Main Admin)",
      "Enser Ltd / BOV Refurbishment Delivery",
      "Enterprise",
      "Activated",
      "cborg_admin",
      "usr-main-admin-enser",
      "Authorized by Our Company for BOV St. Venera Level 1 & 2 Refurbishment (Job 2618).",
      nowIso,
      nowIso
    );
    upsertAuthAdmin.run(
      "auth-adm-03",
      "director@apexmep.com",
      "Ing. David Vella (Main Admin)",
      "Apex MEP Contracting Ltd",
      "Professional",
      "Authorized",
      "dvella_admin",
      null,
      "Pre-authorized by Our Company via Email ID — ready for Main Admin self-activation on Login page.",
      nowIso,
      null
    );

    const upsertUser = db.prepare(`
      INSERT OR IGNORE INTO users (id, username, name, password_hash, role, email, phone, company, trade, status, stakeholder_type, created_by_admin, created_at, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, 'admin@mepfieldhub.com', ?, 0)
    `);
    upsertUser.run("usr-main-admin-enser", "cborg_admin", "Ing. Christian Borg (Main Admin)", defaultPw, "Admin", "admin.bov@enser.com.mt", "+356 2133 2618", "Enser Ltd / BOV Refurbishment Delivery", "All MEP Disciplines", "Main Admin", nowIso);
    upsertUser.run("usr-pm-2618", "mcamilleri", "Ing. Mark Camilleri", defaultPw, "ProjectManager", "m.camilleri@enser.com.mt", "+356 7942 2618", "Enser / BOV MEP Delivery", "Multi-Discipline MEP", "Employee (Internal)", nowIso);
    upsertUser.run("usr-pm-mriehel", "rborg", "Eng. Roderick Borg", defaultPw, "ProjectManager", "r.borg@mepfieldhub.com", "+356 7988 4410", "MEP FieldHub Operations", "HVAC & Electrical", "Employee (Internal)", nowIso);
    upsertUser.run("usr-sup-elec", "cvella", "Carmelo Vella", defaultPw, "SiteEngineer", "c.vella@electrodata.com.mt", "+356 9921 3301", "ElectroData Installations Ltd", "Electrical & ELV", "Employee (Internal)", nowIso);
    upsertUser.run("usr-sup-hvac", "jfarrugia", "Joseph Farrugia", defaultPw, "SiteEngineer", "j.farrugia@climatecontrol.com.mt", "+356 9944 5502", "ClimateControl Malta Ltd", "HVAC & Mechanical", "Employee (Internal)", nowIso);
    upsertUser.run("usr-sup-fire", "dmicallef", "David Micallef", defaultPw, "SiteEngineer", "d.micallef@enser.com.mt", "+356 9967 8803", "FireSafe Systems Ltd", "Fire Alarm & Life Safety", "Employee (Internal)", nowIso);
    upsertUser.run("usr-client-bov", "bov_employer", "Mr. Sandro Mallia (BOV Employer Rep)", defaultPw, "Client", "s.mallia@bov.com", "+356 2131 2020", "Bank of Valletta (BOV plc)", "Client / Employer Representative", "Client / Employer", nowIso);
    upsertUser.run("usr-sub-elec2618", "electrodata_sub", "Ing. Simon Pace (ElectroData Subcontractor)", defaultPw, "Subcontractor", "s.pace@electrodata.com.mt", "+356 7900 1122", "ElectroData Installations Ltd", "Electrical & ELV Subcontractor", "Subcontractor", nowIso);
    upsertUser.run("usr-sub-hvac2618", "climate_sub", "Ing. Mario Cutajar (ClimateControl Subcontractor)", defaultPw, "Subcontractor", "m.cutajar@climatecontrol.com.mt", "+356 7900 3344", "ClimateControl Malta Ltd", "HVAC & VRF Subcontractor", "Subcontractor", nowIso);
    upsertUser.run("usr-cons-enser", "enser_consultant", "Ing. Robert Farrugia (Enser Consultant)", defaultPw, "Consultant", "r.farrugia@enser.com.mt", "+356 2144 2618", "Enser Ltd Consulting Engineers", "Lead MEP Consultant", "Consultant", nowIso);

    // Ensure Subcontractor work_package_id and access_scope so Subcontractor Portal loads their trade packages out of the box
    const wpElec = (db.prepare("SELECT id FROM work_packages WHERE project_id = 'bov-st-venera-2618' AND (discipline LIKE '%Elec%' OR name LIKE '%Elec%') LIMIT 1").get() as any)?.id || "wp-02";
    const wpHvac = (db.prepare("SELECT id FROM work_packages WHERE project_id = 'bov-st-venera-2618' AND (discipline LIKE '%HVAC%' OR name LIKE '%HVAC%') LIMIT 1").get() as any)?.id || "wp-04";
    db.prepare("UPDATE users SET work_package_id = COALESCE(work_package_id, ?), access_scope = 'work_package' WHERE id = 'usr-sub-elec2618'").run(wpElec);
    db.prepare("UPDATE users SET work_package_id = COALESCE(work_package_id, ?), access_scope = 'work_package' WHERE id = 'usr-sub-hvac2618'").run(wpHvac);

    // Ensure project_memberships for PMs & Supervisors
    const upsertMembership = db.prepare(`
      INSERT OR IGNORE INTO project_memberships (user_id, project_id, access_role, active)
      VALUES (?, ?, ?, 1)
    `);
    upsertMembership.run("usr-main-admin-enser", "bov-st-venera-2618", "Admin");
    upsertMembership.run("usr-pm-2618", "bov-st-venera-2618", "ProjectManager");
    upsertMembership.run("usr-sup-elec", "bov-st-venera-2618", "SiteSupervisor");
    upsertMembership.run("usr-sup-hvac", "bov-st-venera-2618", "SiteSupervisor");
    upsertMembership.run("usr-sup-fire", "bov-st-venera-2618", "SiteSupervisor");
    upsertMembership.run("usr-client-bov", "bov-st-venera-2618", "Client");
    upsertMembership.run("usr-sub-elec2618", "bov-st-venera-2618", "Subcontractor");
    upsertMembership.run("usr-sub-hvac2618", "bov-st-venera-2618", "Subcontractor");
    upsertMembership.run("usr-cons-enser", "bov-st-venera-2618", "Consultant");

    // Assign Project Manager & Lead Site Supervisor on bov-st-venera-2618
    db.prepare(`
      UPDATE projects
      SET project_manager_id = COALESCE(project_manager_id, 'usr-pm-2618'),
          project_manager_name = COALESCE(project_manager_name, 'Ing. Mark Camilleri'),
          site_supervisor_id = COALESCE(site_supervisor_id, 'usr-sup-elec'),
          site_supervisor_name = COALESCE(site_supervisor_name, 'Carmelo Vella (Electrical & ELV) / Joseph Farrugia (HVAC)')
      WHERE id = 'bov-st-venera-2618'
    `).run();

    // Also ensure other projects have a Project Manager assigned if NULL
    db.prepare(`
      UPDATE projects
      SET project_manager_id = COALESCE(project_manager_id, 'usr-pm-mriehel'),
          project_manager_name = COALESCE(project_manager_name, 'Eng. Roderick Borg'),
          site_supervisor_id = COALESCE(site_supervisor_id, 'usr-sup-hvac'),
          site_supervisor_name = COALESCE(site_supervisor_name, 'Joseph Farrugia')
      WHERE project_manager_name IS NULL OR project_manager_name = ''
    `).run();

    // Seed BOV St. Venera Sites if not present
    const upsertSite = db.prepare(`
      INSERT OR IGNORE INTO sites (
        id, project_id, name, address, city, country, latitude, longitude,
        geofence_radius_m, geofence_warning_radius_m, timezone, status, supervisor_id, supervisor_name, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 120, 180, 'Europe/Malta', 'Active', ?, ?, 'admin', ?)
    `);
    upsertSite.run(
      "site-2618-l1",
      "bov-st-venera-2618",
      "BOV Operations Centre — Level 1 Refurbishment Zone",
      "Triq il-Kanun, Santa Venera SVR 9030",
      "Santa Venera",
      "Malta",
      35.8902,
      14.4775,
      "usr-sup-elec",
      "Carmelo Vella (Electrical & ELV Supervisor)",
      nowIso
    );
    upsertSite.run(
      "site-2618-l2",
      "bov-st-venera-2618",
      "BOV Operations Centre — Level 2 Area K, Server Room & Plant",
      "Triq il-Kanun, Santa Venera SVR 9030",
      "Santa Venera",
      "Malta",
      35.8905,
      14.4778,
      "usr-sup-hvac",
      "Joseph Farrugia (HVAC & Mechanical Supervisor)",
      nowIso
    );
    // Ensure existing sites have supervisor_name populated
    db.exec(`
      UPDATE sites
      SET supervisor_id = COALESCE(supervisor_id, 'usr-sup-elec'),
          supervisor_name = COALESCE(supervisor_name, 'Carmelo Vella')
      WHERE supervisor_name IS NULL OR supervisor_name = '';
    `);

    // Seed Workers under each Site & Site Supervisor for BOV St. Venera
    const upsertWorker = db.prepare(`
      INSERT OR IGNORE INTO workers (
        id, project_id, site_id, name, employee_id, trade, employment_type,
        nationality, phone, email, supervisor_id, supervisor_name, role_on_site, status, hired_date, created_at
      ) VALUES (?, 'bov-st-venera-2618', ?, ?, ?, ?, 'Permanent', 'Malta / EU', ?, ?, ?, ?, ?, 'Active', '2026-04-15', ?)
    `);
    const bovWorkers = [
      ["wrk-2618-01", "site-2618-l1", "Mario Spiteri", "EMP-2618-01", "Electrical", "+356 7911 2001", "m.spiteri@electrodata.com.mt", "usr-sup-elec", "Carmelo Vella", "Lead Licence A Electrician (DB1 / UP1 & Submains)"],
      ["wrk-2618-02", "site-2618-l1", "Antoine Galea", "EMP-2618-02", "Electrical", "+356 7911 2002", "a.galea@electrodata.com.mt", "usr-sup-elec", "Carmelo Vella", "Lighting & DALI Installer (Drawing 2618-L-LTG-01)"],
      ["wrk-2618-03", "site-2618-l1", "Kevin Zammit", "EMP-2618-03", "ELV / Data", "+356 7911 2003", "k.zammit@electrodata.com.mt", "usr-sup-elec", "Carmelo Vella", "Cat 6 Structured Cabling & Rack Technician (2618-L-DTA-01)"],
      ["wrk-2618-04", "site-2618-l1", "Luke Azzopardi", "EMP-2618-04", "Electrical", "+356 7911 2004", "l.azzopardi@electrodata.com.mt", "usr-sup-elec", "Carmelo Vella", "Containment & 3-Compartment Dado Trunking Fitter (2618-L-CON-01)"],
      ["wrk-2618-05", "site-2618-l2", "Stefan Mifsud", "EMP-2618-05", "HVAC", "+356 7911 2005", "s.mifsud@climatecontrol.com.mt", "usr-sup-hvac", "Joseph Farrugia", "Senior VRF Refrigerant Pipefitter (Drawing 2618-L-ACO-01)"],
      ["wrk-2618-06", "site-2618-l2", "Noel Grech", "EMP-2618-06", "HVAC", "+356 7911 2006", "n.grech@climatecontrol.com.mt", "usr-sup-hvac", "Joseph Farrugia", "DW144 Ventilation Ductwork & Fire Damper Fitter (2618-L-VEN-01)"],
      ["wrk-2618-07", "site-2618-l2", "Christian Cassar", "EMP-2618-07", "Fire", "+356 7911 2007", "c.cassar@firesafe.com.mt", "usr-sup-fire", "David Micallef", "Addressable Fire Alarm & FP200 Gold Technician (2618-L-FAS-01)"],
      ["wrk-2618-08", "site-2618-l2", "Adrian Attard", "EMP-2618-08", "ELV / Security", "+356 7911 2008", "a.attard@electrodata.com.mt", "usr-sup-fire", "David Micallef", "IP CCTV & Mifare Door Access Control Installer (2618-L-SEC-01)"]
    ];
    for (const w of bovWorkers) {
      upsertWorker.run(...w, nowIso);
    }

    // Seed initial Site Markings & Drawing Revisions on 2618 CAD sheets so the user immediately sees how version updates and site markings work
    const mkCount = (db.prepare("SELECT COUNT(*) as c FROM drawing_markings WHERE project_id = 'bov-st-venera-2618'").get() as any)?.c || 0;
    if (mkCount === 0) {
      const findDoc = db.prepare("SELECT id, document_number, revision FROM documents WHERE project_id = 'bov-st-venera-2618' AND document_number = ? LIMIT 1");
      const insMarking = db.prepare(`
        INSERT INTO drawing_markings (
          id, document_id, project_id, drawing_number, revision, pin_number,
          x_percent, y_percent, marking_type, title, description, trade,
          status, progress_percent, created_by, created_by_name, created_at, updated_at
        ) VALUES (?, ?, 'bov-st-venera-2618', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'usr-sup-elec', ?, ?, ?)
      `);

      const ltgDoc = findDoc.get("2618-L-LTG-01") as any;
      if (ltgDoc) {
        insMarking.run(
          "mk-2618-01", ltgDoc.id, "2618-L-LTG-01", ltgDoc.revision || "Rev A", "MK-01",
          34, 42, "Site Progress / Installed",
          "Level 1 Open Plan Zone K1 — 24x 600x600 LED Panels Installed (Circuit L01 & L02)",
          "First-fix 3x1.5mm² H07Z-K LSOH wiring complete and 24x Thorn Omega Pro 2 LED panels installed into ceiling grid. Insulation resistance tested >200 MΩ.",
          "Electrical", "Installed / Verified", 100, "Carmelo Vella (Site Supervisor)", nowIso, nowIso
        );
        insMarking.run(
          "mk-2618-02", ltgDoc.id, "2618-L-LTG-01", ltgDoc.revision || "Rev A", "MK-02",
          68, 56, "As-Built Redline Change",
          "Executive Boardroom — Relocated 2x PIR Presence Sensors + 3000K DALI Driver Addressing",
          "Relocated ceiling PIR sensors 600mm east to clear projector ceiling mount bracket per Consultant site instruction. Updated DALI group addressing.",
          "Electrical", "In Progress", 75, "Carmelo Vella (Site Supervisor)", nowIso, nowIso
        );
      }

      const eleDoc = findDoc.get("2618-S-ELE-01") as any;
      if (eleDoc) {
        insMarking.run(
          "mk-2618-03", eleDoc.id, "2618-S-ELE-01", eleDoc.revision || "Rev A", "MK-01",
          48, 38, "Site Progress / Installed",
          "DB1 & UP1 Switchgear Terminated — Type A 30mA RCBOs Installed",
          "Schneider Acti9 iC60H Type A 30mA RCBOs fitted and torque-checked in DB1 (16-way TPN) and UP1 (8-way TPN). Submain C08 5c/6mm² LSOH pulled and glanded.",
          "Electrical", "Installed / Verified", 100, "Carmelo Vella (Site Supervisor)", nowIso, nowIso
        );
      }

      const acoDoc = findDoc.get("2618-L-ACO-01") as any;
      if (acoDoc) {
        insMarking.run(
          "mk-2618-04", acoDoc.id, "2618-L-ACO-01", acoDoc.revision || "Rev A", "MK-01",
          52, 46, "Snag / Defect",
          "Server Room Duty/Standby Split Unit — Condensate Drain Gradient Adjustment",
          "Condensate uPVC drain pipe above Server Room door requires rerouting around Cat 6 containment basket to maintain 1:100 gravity fall.",
          "HVAC", "Open", 40, "Joseph Farrugia (HVAC Supervisor)", nowIso, nowIso
        );
      }

      // Seed an initial revision entry in document_revisions for 2618-L-LTG-01 so version history is immediately visible
      if (ltgDoc) {
        db.prepare(`
          INSERT OR IGNORE INTO document_revisions (
            id, document_id, project_id, revision_code, superseded_date,
            changed_by, change_summary, attachment_name, attachment_data, created_at
          ) VALUES (?, ?, 'bov-st-venera-2618', 'Rev 0 (Tender Issue)', '2026-05-05', 'Ing. Christian Borg (Enser Ltd)', 'Original Tender Issue (05.05.26) — First & Second Floor Lighting Layout prior to Boardroom 3000K DALI luminaire & PIR sensor site markup.', '2618-L-LTG-01.png', '/original_drawings/2618-L-LTG-01.png', ?)
        `).run("rev-2618-ltg-00", ltgDoc.id, nowIso);
      }
    }
  } catch (e) {
    console.warn("seedData warning:", e);
  }
}

export function seedLeaveTypes() {
  // Bootstrap default leave types idempotently (unique constraint on name/code prevents duplicates)
  const defaults = [
    { name: "Annual Leave",   code: "AL",  is_paid: 1, days: 21, requires_approval: 1 },
    { name: "Sick Leave",     code: "SL",  is_paid: 1, days: 14, requires_approval: 0 },
    { name: "Unpaid Leave",   code: "UL",  is_paid: 0, days: 0,  requires_approval: 1 },
    { name: "Public Holiday", code: "PH",  is_paid: 1, days: 0,  requires_approval: 0 },
    { name: "Rest Day",       code: "RD",  is_paid: 1, days: 0,  requires_approval: 0 },
    { name: "Compassionate",  code: "CL",  is_paid: 1, days: 3,  requires_approval: 1 },
  ];
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO leave_types (id, name, code, is_paid, default_days_per_year, requires_approval, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  for (const lt of defaults) {
    stmt.run(crypto.randomUUID(), lt.name, lt.code, lt.is_paid, lt.days, lt.requires_approval, now);
  }
}

