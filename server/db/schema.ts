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
  `);

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
  // Intentionally a no-op: no demo/sample projects, tasks, RFIs, etc.
  // are created on startup. New installs start with zero projects;
  // the bootstrap admin account creates real projects from the UI.
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

