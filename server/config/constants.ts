// ============================================================================
// Enterprise Configuration, RBAC Definitions, Table Schema Map & State Machines
// ============================================================================

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 60 * 1000;
export const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 hours

export const NOTIFY_WORTHY_STATUSES = new Set([
  "Approved", "Rejected", "Answered", "Completed", "Closed", "Rectified", "Certified",
]);

export const ROLE_DEFINITIONS = [
  {
    role: "Admin",
    title: "Executive System Administrator",
    category: "Executive & Governance",
    badgeColor: "#9333ea",
    description: "Highest level administration authority: enterprise user & role management, security audit oversight, multi-project governance, and full database access.",
    scope: "Enterprise-wide (All Projects)",
  },
  {
    role: "ProjectManager",
    title: "MEP Project Manager",
    category: "Project Leadership",
    badgeColor: "#2563eb",
    description: "Overall MEP project delivery leadership: programme schedule, variation claims, submittals, budgets, change orders, procurement, and commercial closeout.",
    scope: "Assigned Projects or Enterprise",
  },
  {
    role: "SiteEngineer",
    title: "MEP Site Engineer",
    category: "Site Operations",
    badgeColor: "#0284c7",
    description: "Field installation coordination: site inspections, snagging punch lists, drawing markups, RFI raising, daily logs, attendance, and equipment tracking.",
    scope: "Assigned Projects",
  },
  {
    role: "CommercialManager",
    title: "Quantity Surveyor / Commercial Lead",
    category: "Commercial & Finance",
    badgeColor: "#d97706",
    description: "Financial & contract engineering: BOQ management, progress valuations, change orders, vendor purchase orders, and cost variance control.",
    scope: "Assigned Projects",
  },
  {
    role: "QAQC",
    title: "QA/QC & Commissioning Lead",
    category: "Quality & Assurance",
    badgeColor: "#059669",
    description: "Quality assurance & system commissioning: site inspections, NCR non-conformance tracking, witness testing, and statutory handover packages.",
    scope: "Assigned Projects",
  },
  {
    role: "SafetyOfficer",
    title: "Site HSE & Safety Manager",
    category: "Health & Safety",
    badgeColor: "#dc2626",
    description: "Health & Safety governance: incident investigations, risk hazard mitigation, safety audits, inductions, PPE compliance, and attendance monitoring.",
    scope: "Assigned Projects",
  },
  {
    role: "Subcontractor",
    title: "Specialist Trade Subcontractor",
    category: "Trade Contractors",
    badgeColor: "#ea580c",
    description: "Specialized trade delivery (HVAC, Electrical, Plumbing, Fire): trade punch snags, daily logs, material requests, and timesheet logging.",
    scope: "Assigned Project & Trade Isolations",
  },
  {
    role: "Consultant",
    title: "Supervising Consultant / Client Rep",
    category: "Consultants & Clients",
    badgeColor: "#7c3aed",
    description: "Consultant review & technical approval: technical reviews of RFIs, submittals, inspection witness sign-offs, and compliance auditing.",
    scope: "Assigned Projects",
  },
  {
    role: "Client",
    title: "Client / Project Owner",
    category: "Consultants & Clients",
    badgeColor: "#0891b2",
    description: "Curated, read-only project visibility: overall health, milestones, and only the documents and change orders the project team has explicitly published to the client. Never sees raw internal records.",
    scope: "Assigned Projects (Published Data Only)",
  },
];

export const ROLE_PERMS: Record<string, { view: string[]; edit: string[]; delete: boolean }> = {
  Admin: {
    view: [
      "dashboard", "tasks", "planner", "rfis", "submittals", "punchlist",
      "costs", "budget", "dailylogs", "documents", "report", "projects", "gantt",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "procurement", "material_requests", "risks", "ncrs",
      "commissioning", "handover", "wbs", "audit", "users", "site_today", "calendar", "attendance",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "workforce", "sites", "workers", "site_instructions", "leave_requests", "shift_templates",
      "payroll_periods", "payroll_entries", "payroll_profiles", "attendance_adjustments", "worker_assignments", "project_updates",
      "project_actions", "project_decisions"
    ],
    edit: [
      "tasks", "planner", "rfis", "submittals", "punchlist", "costs", "budget",
      "dailylogs", "documents", "projects",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "procurement", "material_requests", "risks", "ncrs",
      "commissioning", "handover", "wbs", "attendance",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "workforce", "sites", "workers", "site_instructions", "leave_requests", "shift_templates",
      "payroll_periods", "payroll_entries", "payroll_profiles", "attendance_adjustments", "worker_assignments", "project_updates",
      "project_actions", "project_decisions"
    ],
    delete: true,
  },
  ProjectManager: {
    view: [
      "dashboard", "tasks", "planner", "rfis", "submittals", "punchlist",
      "costs", "budget", "dailylogs", "documents", "report", "projects", "gantt",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "procurement", "material_requests", "risks", "ncrs",
      "commissioning", "handover", "wbs", "audit", "site_today", "calendar", "attendance",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "workforce", "sites", "workers", "site_instructions", "leave_requests", "shift_templates",
      "attendance_adjustments", "worker_assignments", "project_updates",
      "project_actions", "project_decisions"
    ],
    edit: [
      "tasks", "planner", "rfis", "submittals", "punchlist", "costs", "budget",
      "dailylogs", "documents", "projects",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "procurement", "material_requests", "risks", "ncrs",
      "commissioning", "handover", "wbs", "attendance",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "workforce", "sites", "workers", "site_instructions", "leave_requests", "shift_templates",
      "attendance_adjustments", "worker_assignments", "project_updates",
      "project_actions", "project_decisions"
    ],
    delete: true,
  },
  SiteEngineer: {
    view: [
      "dashboard", "tasks", "planner", "rfis", "submittals", "punchlist",
      "costs", "budget", "dailylogs", "documents", "report", "gantt",
      "change_orders", "purchase_orders", "safety_incidents",
      "inspections", "meeting_minutes", "timesheets", "equipment",
      "dependencies", "material_requests", "ncrs", "commissioning",
      "wbs", "site_today", "calendar", "attendance",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "workforce", "sites", "workers", "site_instructions", "leave_requests", "attendance_adjustments", "worker_assignments", "project_updates",
      "project_actions", "project_decisions"
    ],
    edit: [
      "tasks", "planner", "rfis", "submittals", "punchlist", "dailylogs", "documents",
      "change_orders", "safety_incidents", "inspections",
      "meeting_minutes", "timesheets", "equipment", "material_requests",
      "commissioning", "attendance",
      "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "site_instructions", "leave_requests", "attendance_adjustments", "project_updates",
      "project_actions", "project_decisions"
    ],
    delete: false,
  },
  CommercialManager: {
    view: [
      "dashboard", "costs", "budget", "change_orders", "purchase_orders",
      "procurement", "material_requests", "dependencies", "risks",
      "handover", "documents", "projects", "gantt", "wbs", "tasks", "planner", "submittals",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "payroll_periods", "payroll_entries", "payroll_profiles", "project_updates",
      "project_actions", "project_decisions"
    ],
    edit: [
      "costs", "budget", "change_orders", "purchase_orders",
      "procurement", "material_requests", "risks", "handover", "documents",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "progress_submissions",
      "payroll_periods", "payroll_entries", "payroll_profiles", "project_updates",
      "project_actions", "project_decisions"
    ],
    delete: false,
  },
  QAQC: {
    view: [
      "dashboard", "punchlist", "inspections", "ncrs", "commissioning",
      "handover", "submittals", "rfis", "dailylogs", "documents",
      "site_today", "equipment", "tasks", "planner",
      "companies", "work_packages", "clarifications", "transmittals", "progress_submissions", "project_updates",
      "project_actions", "project_decisions"
    ],
    edit: [
      "punchlist", "inspections", "ncrs", "commissioning",
      "handover", "documents",
      "clarifications", "transmittals", "project_updates",
      "project_actions", "project_decisions"
    ],
    delete: false,
  },
  SafetyOfficer: {
    view: [
      "dashboard", "safety_incidents", "risks", "inspections",
      "dailylogs", "timesheets", "attendance", "site_today",
      "documents", "equipment", "tasks", "planner",
      "companies", "work_packages", "clarifications", "progress_reports",
      "workforce", "sites", "workers", "project_updates",
      "project_actions", "project_decisions"
    ],
    edit: [
      "safety_incidents", "risks", "inspections", "dailylogs",
      "attendance", "documents", "clarifications", "project_updates",
      "project_actions", "project_decisions"
    ],
    delete: false,
  },
  Subcontractor: {
    view: [
      "dashboard", "tasks", "planner", "submittals", "punchlist", "dailylogs", "documents",
      "safety_incidents", "timesheets", "equipment", "dependencies",
      "material_requests", "site_today", "calendar", "attendance",
      "companies", "work_packages", "clarifications", "transmittals", "progress_submissions",
      "site_instructions", "leave_requests", "workers", "project_updates",
      "project_actions"
    ],
    edit: [
      "tasks", "planner", "submittals", "punchlist", "dailylogs", "documents", "safety_incidents",
      "timesheets", "dependencies", "material_requests", "attendance",
      "clarifications", "progress_submissions", "leave_requests", "project_updates"
    ],
    delete: false,
  },
  Consultant: {
    view: [
      "dashboard", "tasks", "planner", "gantt", "rfis", "submittals", "punchlist",
      "costs", "change_orders", "inspections", "meeting_minutes", "ncrs",
      "commissioning", "handover", "documents", "site_today", "calendar",
      "companies", "work_packages", "clarifications", "progress_reports", "transmittals", "project_updates",
      "project_actions", "project_decisions"
    ],
    edit: [
      "rfis", "submittals", "inspections", "commissioning", "handover",
      "clarifications", "transmittals",
      "project_actions", "project_decisions"
    ],
    delete: false,
  },
  Client: {
    view: ["client_dashboard", "projects", "documents", "change_orders", "progress_reports", "clarifications", "project_updates", "project_actions", "project_decisions"],
    edit: [],
    delete: false,
  },
  Worker: {
    view: [
      "attendance", "tasks", "site_instructions", "leave_requests",
      "timesheets", "documents", "workforce", "sites", "project_updates"
    ],
    edit: [
      "attendance", "site_instructions", "leave_requests", "timesheets"
    ],
    delete: false,
  },
  SiteSupervisor: {
    view: [
      "attendance", "tasks", "site_instructions", "leave_requests",
      "timesheets", "documents", "workforce", "sites", "workers",
      "attendance_adjustments", "shift_templates", "worker_assignments", "project_updates"
    ],
    edit: [
      "attendance", "site_instructions", "leave_requests", "timesheets",
      "attendance_adjustments", "tasks", "project_updates"
    ],
    delete: false,
  },
};

export const TABLE_CONFIG: Record<string, { cols: string[]; module: string }> = {
  tasks: {
    cols: [
      "id", "project_id", "title", "description", "trade", "assignee", "assigned_worker_id",
      "start", "end", "progress", "status", "priority", "wbs_code", "wbs_item_id", "duration",
      "is_summary", "is_milestone", "work_package_id", "company_id", "site_id", "supervisor_id",
      "baseline_start_date", "baseline_end_date", "forecast_start_date", "forecast_end_date",
      "actual_start_date", "actual_end_date", "drawing_ref", "drawing_id", "boq_ref",
      "boq_item_id", "procurement_item_id", "evidence_required", "evidence_type",
      "evidence_url", "evidence_notes", "blocker_count"
    ],
    module: "tasks",
  },
  task_blockers: {
    cols: ["id", "task_id", "project_id", "blocker_type", "description", "blocking_trade", "impact_days", "status", "reported_by", "reported_by_name", "resolved_by", "resolved_by_name", "resolution_notes", "created_at", "resolved_at"],
    module: "tasks",
  },
  project_updates: {
    cols: ["id", "project_id", "title", "category", "content", "progress_percent", "trade", "work_package_id", "weather", "location", "pinned", "attachment_data", "attachment_name", "created_by", "created_by_name", "created_at"],
    module: "project_updates",
  },
  rfis: {
    cols: ["id", "project_id", "number", "subject", "trade", "raised_by", "date_raised", "due_date", "status"],
    module: "rfis",
  },
  submittals: {
    cols: ["id", "project_id", "number", "item", "title", "trade", "subcontractor", "spec_section", "date_submitted", "due_date", "status", "work_package_id", "company_id"],
    module: "submittals",
  },
  punchlist: {
    cols: ["id", "project_id", "item", "description", "trade", "contractor", "location", "floor", "priority", "date_raised", "status", "attachment_data", "x_percent", "y_percent", "work_package_id", "company_id"],
    module: "punchlist",
  },
  dailylogs: {
    cols: ["id", "project_id", "date", "log_date", "trade", "weather", "crew", "workers_count", "notes", "work_performed", "delays", "safety_incidents", "work_package_id", "company_id"],
    module: "dailylogs",
  },
  daily_logs: {
    cols: ["id", "project_id", "date", "log_date", "trade", "weather", "crew", "workers_count", "notes", "work_performed", "delays", "safety_incidents", "work_package_id", "company_id"],
    module: "dailylogs",
  },
  documents: {
    cols: ["id", "project_id", "name", "category", "revision", "date_added", "attachment_name", "attachment_data", "subcontractor_id", "uploaded_by", "markup_data", "visibility", "published_by", "published_at", "work_package_id", "status", "document_number", "discipline"],
    module: "documents",
  },
  drawings: {
    cols: ["id", "project_id", "name", "category", "revision", "date_added", "attachment_name", "attachment_data", "subcontractor_id", "uploaded_by", "markup_data", "visibility", "published_by", "published_at", "work_package_id", "status", "document_number", "discipline"],
    module: "documents",
  },
  costs: {
    cols: ["id", "project_id", "category", "description", "planned", "actual", "date_logged"],
    module: "costs",
  },
  boq_items: {
    cols: [
      "id", "project_id", "item_number", "description", "unit", "tender_quantity", "tender_rate",
      "tender_amount", "revised_quantity", "installed_quantity", "claimed_quantity", "certified_quantity",
      "discipline", "system", "building", "floor", "area", "source_document_id", "imported_at"
    ],
    module: "budget",
  },
  change_orders: {
    cols: ["id", "project_id", "number", "title", "trade", "reason", "cost_impact", "schedule_impact_days", "date_raised", "status", "visibility", "published_by", "published_at"],
    module: "change_orders",
  },
  purchase_orders: {
    cols: ["id", "project_id", "po_number", "vendor", "trade", "description", "amount", "order_date", "expected_delivery", "expected_delivery_date", "actual_delivery_date", "lead_time_days", "task_id", "status"],
    module: "purchase_orders",
  },
  safety_incidents: {
    cols: ["id", "project_id", "date", "trade", "incident_type", "severity", "description", "corrective_action", "status"],
    module: "safety_incidents",
  },
  inspections: {
    cols: ["id", "project_id", "date", "trade", "inspection_type", "inspector", "result", "notes"],
    module: "inspections",
  },
  meeting_minutes: {
    cols: ["id", "project_id", "date", "meeting_type", "attendees", "subject", "notes"],
    module: "meeting_minutes",
  },
  timesheets: {
    cols: ["id", "project_id", "date", "worker", "trade", "task", "hours"],
    module: "timesheets",
  },
  equipment: {
    cols: ["id", "project_id", "name", "type", "assigned_to", "status", "notes"],
    module: "equipment",
  },
  wbs_items: {
    cols: ["id", "project_id", "parent_id", "code", "name", "level", "discipline", "system", "active"],
    module: "wbs",
  },
  wbs: {
    cols: ["id", "project_id", "parent_id", "code", "name", "level", "discipline", "system", "active"],
    module: "wbs",
  },
  dependencies: {
    cols: [
      "id", "project_id", "task_id", "predecessor_task_id", "dependency_type", "task_owner", "dependent_party", "description",
      "dependency_owner", "required_date", "completed_date", "status", "impact_if_late",
      "programme_impact", "commercial_impact", "next_action"
    ],
    module: "dependencies",
  },
  procurement_items: {
    cols: [
      "id", "project_id", "pr_number", "material", "specification", "boq_reference",
      "drawing_reference", "quantity", "unit", "required_on_site", "responsible_buyer",
      "selected_supplier", "po_number", "po_date", "expected_delivery", "actual_delivery",
      "delivered_quantity", "outstanding_quantity", "inspection_status", "storage_location", "status"
    ],
    module: "procurement",
  },
  material_requests: {
    cols: [
      "id", "project_id", "location", "discipline", "system", "material", "description",
      "quantity", "unit", "required_date", "reason", "drawing", "boq_reference", "requested_by", "task_id", "status"
    ],
    module: "material_requests",
  },
  risks: {
    cols: ["id", "project_id", "risk_no", "title", "category", "probability", "impact", "risk_score", "risk_level", "owner", "mitigation", "target_date", "contingency_cost", "linked_task_id", "status", "created_by", "created_at"],
    module: "risks",
  },
  project_risks: {
    cols: ["id", "project_id", "risk_no", "title", "category", "probability", "impact", "risk_score", "risk_level", "owner", "mitigation", "target_date", "contingency_cost", "linked_task_id", "status", "created_by", "created_at"],
    module: "risks",
  },
  project_actions: {
    cols: ["id", "project_id", "action_no", "title", "description", "assigned_to_user_id", "assigned_to_name", "priority", "status", "due_date", "source_type", "source_id", "created_by", "created_at", "completed_at"],
    module: "project_actions",
  },
  actions: {
    cols: ["id", "project_id", "action_no", "title", "description", "assigned_to_user_id", "assigned_to_name", "priority", "status", "due_date", "source_type", "source_id", "created_by", "created_at", "completed_at"],
    module: "project_actions",
  },
  project_decisions: {
    cols: ["id", "project_id", "decision_no", "title", "context", "options_considered", "decision_taken", "decided_by", "decision_date", "cost_impact", "schedule_impact_days", "status", "created_by", "created_at"],
    module: "project_decisions",
  },
  decisions: {
    cols: ["id", "project_id", "decision_no", "title", "context", "options_considered", "decision_taken", "decided_by", "decision_date", "cost_impact", "schedule_impact_days", "status", "created_by", "created_at"],
    module: "project_decisions",
  },
  ncrs: {
    cols: [
      "id", "project_id", "number", "location", "description", "raised_against", "raised_date",
      "responsible_party", "root_cause", "corrective_action", "target_date", "verification",
      "closure_date", "status"
    ],
    module: "ncrs",
  },
  commissioning_tests: {
    cols: [
      "id", "project_id", "system", "subsystem", "equipment", "test_type", "power_available",
      "installation_complete", "controls_complete", "interface_complete", "drawings_approved",
      "test_date", "test_engineer", "witness", "result", "failure_reason", "retest_date",
      "certificate", "status", "comments"
    ],
    module: "commissioning",
  },
  handover_items: {
    cols: [
      "id", "project_id", "contractor", "system", "item_type", "description", "required",
      "submitted", "approved", "due_date", "status", "notes"
    ],
    module: "handover",
  },
  plan_buckets: {
    cols: ["id", "project_id", "source_document_id", "name", "order_index", "created_at"],
    module: "planner",
  },
  plan_tasks: {
    cols: [
      "id", "project_id", "bucket_id", "title", "description", "trade", "priority", "status",
      "due_date", "assigned_to", "source_document_id", "source_excerpt", "order_index", "created_at"
    ],
    module: "planner",
  },
  plan_task_checklist: {
    cols: ["id", "project_id", "task_id", "label", "is_checked", "order_index"],
    module: "planner",
  },
};

export const WORKFLOW_STATUSES: Record<string, Record<string, string[]>> = {
  submittals: {
    Draft: ["Submitted"],
    Submitted: ["Under Review"],
    "Under Review": ["Approved", "Approved With Comments", "Revise and Resubmit", "Rejected"],
    Approved: ["Closed"],
    "Approved With Comments": ["Closed"],
    "Revise and Resubmit": ["Submitted"],
    Rejected: ["Draft"],
  },
  change_orders: {
    "Potential Variation": ["Under Preparation", "Rejected"],
    "Under Preparation": ["Submitted"],
    Submitted: ["Technical Review", "Rejected"],
    "Technical Review": ["Commercial Review", "Rejected"],
    "Commercial Review": ["Approved", "Partially Approved", "Rejected"],
    Approved: ["PO Pending", "Work In Progress"],
    "Partially Approved": ["PO Pending"],
    "PO Pending": ["PO Issued"],
    "PO Issued": ["Work In Progress"],
    "Work In Progress": ["Work Complete"],
    "Work Complete": ["Claimed"],
    Claimed: ["Certified"],
    Certified: ["Paid"],
    Paid: ["Closed"],
  },
  procurement_items: {
    "Not Requested": ["RFQ"],
    RFQ: ["Quotation Received"],
    "Quotation Received": ["Under Review"],
    "Under Review": ["Approved", "Rejected"],
    Approved: ["PO Pending"],
    "PO Pending": ["Ordered"],
    Ordered: ["Manufacturing", "In Transit"],
    Manufacturing: ["Ready for Dispatch"],
    "Ready for Dispatch": ["In Transit"],
    "In Transit": ["Partially Delivered", "Delivered"],
    "Partially Delivered": ["Delivered"],
    Delivered: ["Installed"],
  },
  ncrs: {
    Open: ["Under Investigation"],
    "Under Investigation": ["Corrective Action"],
    "Corrective Action": ["Verification"],
    Verification: ["Closed", "Rejected"],
    Rejected: ["Corrective Action"],
  },
  commissioning_tests: {
    Planned: ["Ready for Commissioning"],
    "Ready for Commissioning": ["Testing"],
    Testing: ["Passed", "Failed"],
    Failed: ["Testing"],
    Passed: ["Accepted"],
    Accepted: ["Closed"],
  },
  handover_items: {
    Required: ["Submitted"],
    Submitted: ["Under Review"],
    "Under Review": ["Approved", "Rejected"],
    Rejected: ["Submitted"],
    Approved: ["Closed"],
  },
  punchlist: {
    Open: ["In Progress", "Closed"],
    "In Progress": ["Resolved", "Open"],
    Resolved: ["Closed", "In Progress"],
    Closed: ["Open"],
  },
  clarifications: {
    Draft: ["Submitted"],
    Submitted: ["Under Review", "Contractor Review", "Client Review"],
    "Under Review": ["Contractor Review", "Client Review", "Answered", "Closed"],
    "Contractor Review": ["Client Review", "Answered", "Closed"],
    "Client Review": ["Answered", "Closed", "Disputed"],
    Answered: ["Closed", "Disputed"],
    Disputed: ["Under Review", "Answered"],
    Closed: ["Under Review"],
  },
  progress_reports: {
    Draft: ["Ready for Review"],
    "Ready for Review": ["Published to Client", "Draft"],
    "Published to Client": ["Archived"],
    Archived: ["Published to Client"],
  },
  document_transmittals: {
    Draft: ["Transmitted"],
    Transmitted: ["Acknowledged", "Approved", "Rejected"],
    Acknowledged: ["Approved", "Rejected"],
    Approved: ["Closed"],
    Rejected: ["Draft"],
  },
  progress_submissions: {
    Submitted: ["Under Inspection", "Approved", "Approved with Adjustments", "Rejected"],
    "Under Inspection": ["Approved", "Approved with Adjustments", "Rejected"],
    Approved: ["Closed"],
    "Approved with Adjustments": ["Closed"],
    Rejected: ["Submitted"],
  },
  // Site instruction 7-stage FSM
  site_instructions: {
    Draft: ["Assigned"],
    Assigned: ["Acknowledged", "Draft"],
    Acknowledged: ["In Progress"],
    "In Progress": ["Ready for Verification"],
    "Ready for Verification": ["Verified", "In Progress"],
    Verified: ["Closed"],
    Closed: [],
  },
  // Leave request approval FSM
  leave_requests: {
    Pending: ["Approved", "Rejected"],
    Approved: ["Cancelled"],
    Rejected: ["Pending"],
    Cancelled: [],
  },
  // Attendance adjustment FSM
  attendance_adjustments: {
    Pending: ["Approved", "Rejected"],
    Approved: [],
    Rejected: ["Pending"],
  },
  // Overtime approval FSM (on attendance records)
  overtime_approval: {
    Pending: ["Approved", "Rejected"],
    Approved: [],
    Rejected: ["Pending"],
  },
};

export const VALID_TRANSITIONS = WORKFLOW_STATUSES;

