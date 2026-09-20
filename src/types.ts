// ─────────────────────────────────────────────────────────────────────────────
// MEP Management Platform — Shared TypeScript Types
// ─────────────────────────────────────────────────────────────────────────────

export interface User {
  user_id: string;
  name: string;
  role: string;
  username: string;
  email?: string;
  phone?: string;
  company_id?: string;
  work_package_id?: string;
  worker_id?: string;
  status: string;
  must_change_password?: number;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  status: string;
  start_date?: string;
  end_date?: string;
  budget?: number;
}

export interface Site {
  id: string;
  project_id: string;
  name: string;
  address?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  geofence_radius_m: number;
  geofence_warning_radius_m: number;
  timezone: string;
  status: string;
  created_at?: string;
}

export interface Worker {
  id: string;
  project_id?: string;
  site_id?: string;
  company_id?: string;
  company_name?: string;
  user_id?: string;
  name: string;
  employee_id?: string;
  trade?: string;
  employment_type: string;
  nationality?: string;
  phone?: string;
  email?: string;
  supervisor_id?: string;
  work_package_id?: string;
  status: string;
  hired_date?: string;
  created_at?: string;
}

export interface WorkerAssignment {
  id: string;
  worker_id: string;
  worker_name?: string;
  trade?: string;
  project_id: string;
  site_id?: string;
  site_name?: string;
  work_package_id?: string;
  supervisor_id?: string;
  role_on_site?: string;
  start_date?: string;
  end_date?: string;
  status: string;
}

export interface ShiftTemplate {
  id: string;
  project_id: string;
  name: string;
  start_time: string;
  end_time: string;
  grace_minutes: number;
  break_minutes: number;
  regular_hours: number;
  ot_threshold_hours: number;
  status: string;
}

export interface AttendanceRecord {
  id: string;
  project_id: string;
  user_id: string;
  worker: string;
  worker_id?: string;
  site_id?: string;
  site_name?: string;
  work_date: string;
  punch_in: string;
  punch_out?: string;
  status: string;
  notes?: string;
  punch_in_lat?: number;
  punch_in_lng?: number;
  punch_in_accuracy?: number;
  punch_in_geofence_status?: string;
  punch_in_distance_m?: number;
  punch_out_lat?: number;
  punch_out_lng?: number;
  punch_out_geofence_status?: string;
  punch_out_distance_m?: number;
  supervisor_override?: number;
  override_reason?: string;
  regular_hours?: number;
  overtime_hours?: number;
  ot_status?: string;
  ot_approved_by?: string;
  hours?: number;
  trade?: string;
  employment_type?: string;
  company_name?: string;
}

export interface SiteInstruction {
  id: string;
  project_id: string;
  site_id?: string;
  site_name?: string;
  work_package_id?: string;
  instruction_number: string;
  instruction_type: string;
  title: string;
  description?: string;
  priority: string;
  status: string;
  assigned_worker_id?: string;
  assigned_worker_name?: string;
  assigned_supervisor_id?: string;
  issued_by?: string;
  issued_at?: string;
  acknowledged_at?: string;
  started_at?: string;
  evidence_submitted_at?: string;
  verified_by?: string;
  verified_at?: string;
  closed_at?: string;
  due_date?: string;
  location?: string;
  attachment_name?: string;
  created_at: string;
  updates?: SiteInstructionUpdate[];
  attachments?: SiteInstructionAttachment[];
}

export interface SiteInstructionUpdate {
  id: string;
  instruction_id: string;
  user_id: string;
  user_name?: string;
  update_type: string;
  content: string;
  old_status?: string;
  new_status?: string;
  created_at: string;
}

export interface SiteInstructionAttachment {
  id: string;
  instruction_id: string;
  uploaded_by: string;
  attachment_name?: string;
  attachment_type: string;
  caption?: string;
  created_at: string;
}

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  is_paid: number;
  default_days_per_year: number;
  requires_approval: number;
  description?: string;
}

export interface LeaveRequest {
  id: string;
  project_id: string;
  worker_id?: string;
  user_id: string;
  leave_type_id: string;
  leave_type_name?: string;
  leave_type_code?: string;
  is_paid?: number;
  start_date: string;
  end_date: string;
  days_requested: number;
  reason?: string;
  status: string;
  approved_by?: string;
  approved_at?: string;
  reject_reason?: string;
  created_at: string;
}

export interface LeaveBalance {
  id: string;
  user_id: string;
  leave_type_id: string;
  leave_type_name?: string;
  code?: string;
  year: number;
  entitlement_days: number;
  taken_days: number;
  pending_days: number;
  balance_days: number;
}

export interface AttendanceAdjustment {
  id: string;
  attendance_id: string;
  project_id: string;
  worker_id?: string;
  user_id: string;
  original_punch_in?: string;
  original_punch_out?: string;
  adjusted_punch_in?: string;
  adjusted_punch_out?: string;
  adjustment_reason: string;
  status: string;
  submitted_by: string;
  approved_by?: string;
  approved_at?: string;
  reject_reason?: string;
  created_at: string;
}

export interface PayrollProfile {
  id: string;
  worker_id: string;
  worker_name?: string;
  basic_daily_rate: number;
  basic_monthly_rate: number;
  rate_type: string;
  currency: string;
  ot_multiplier: number;
  housing_allowance: number;
  transport_allowance: number;
  food_allowance: number;
  bank_account?: string;
  bank_name?: string;
  effective_from?: string;
}

export interface PayrollPeriod {
  id: string;
  project_id: string;
  period_name: string;
  period_start: string;
  period_end: string;
  status: string;
  locked_by?: string;
  locked_at?: string;
  total_gross: number;
  total_net: number;
  created_by?: string;
  created_at: string;
  entries?: PayrollEntry[];
  adjustments?: PayrollAdjustment[];
}

export interface PayrollEntry {
  id: string;
  payroll_period_id: string;
  worker_id: string;
  worker_name?: string;
  trade?: string;
  employee_id?: string;
  project_id: string;
  regular_days: number;
  regular_hours: number;
  overtime_hours: number;
  absent_days: number;
  leave_days: number;
  basic_pay: number;
  overtime_pay: number;
  housing_allowance: number;
  transport_allowance: number;
  food_allowance: number;
  gross_pay: number;
  deductions: number;
  net_pay: number;
  currency: string;
  notes?: string;
  computed_at?: string;
}

export interface PayrollAdjustment {
  id: string;
  payroll_entry_id: string;
  worker_id: string;
  type: string;
  description: string;
  amount: number;
  is_deduction: number;
}

export interface WorkforceDashboard {
  today: string;
  present_count: number;
  completed_count: number;
  present_workers: AttendanceRecord[];
  exceptions: AttendanceRecord[];
  pending_overtime: AttendanceRecord[];
}

export interface SiteControl {
  site: Site;
  present_workers: AttendanceRecord[];
  today_attendance: AttendanceRecord[];
  open_instructions: SiteInstruction[];
  pending_leave: LeaveRequest[];
  today: string;
}

export type GeofenceStatus = 'Valid' | 'Warning' | 'Outside Geofence' | 'GPS Accuracy Poor' | 'Supervisor Override' | null;

export const INSTRUCTION_TYPES = [
  'Safety',
  'Quality',
  'Construction',
  'Installation',
  'Testing',
  'Inspection',
  'Rework',
  'Maintenance',
  'General',
] as const;

export const INSTRUCTION_STATUSES = [
  'Draft',
  'Assigned',
  'Acknowledged',
  'In Progress',
  'Ready for Verification',
  'Verified',
  'Closed',
] as const;

export const PRIORITY_COLORS: Record<string, string> = {
  Critical: 'bg-red-100 text-red-800',
  High: 'bg-orange-100 text-orange-800',
  Medium: 'bg-yellow-100 text-yellow-800',
  Low: 'bg-green-100 text-green-800',
};

export const STATUS_COLORS: Record<string, string> = {
  // Instruction statuses
  Draft: 'bg-gray-100 text-gray-700',
  Assigned: 'bg-blue-100 text-blue-700',
  Acknowledged: 'bg-indigo-100 text-indigo-700',
  'In Progress': 'bg-yellow-100 text-yellow-700',
  'Ready for Verification': 'bg-purple-100 text-purple-700',
  Verified: 'bg-teal-100 text-teal-700',
  Closed: 'bg-green-100 text-green-700',
  // Leave/OT statuses
  Pending: 'bg-yellow-100 text-yellow-700',
  Approved: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  Cancelled: 'bg-gray-100 text-gray-600',
  // Attendance
  Open: 'bg-blue-100 text-blue-700',
  // Payroll
  Locked: 'bg-gray-800 text-white',
  // Workers/sites
  Active: 'bg-emerald-100 text-emerald-700',
  Inactive: 'bg-gray-100 text-gray-500',
};

export const GEOFENCE_COLORS: Record<string, string> = {
  Valid: 'text-green-600',
  Warning: 'text-yellow-600',
  'Outside Geofence': 'text-red-600',
  'GPS Accuracy Poor': 'text-orange-600',
  'Supervisor Override': 'text-purple-600',
};
