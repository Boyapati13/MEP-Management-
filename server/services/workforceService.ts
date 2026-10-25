import crypto from "crypto";
import { db } from "../db/connection";
import { AuthenticatedUser, canAccessProject, hasProjectAccess, canAccessCompany, canAccessWorkPackage, canView, canEdit } from "../middleware/auth";

export type WorkforceAction = "view" | "edit" | "update" | "assign" | "verify" | "close";

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function geofenceStatus(distanceM: number, site: any, accuracyM?: number): string {
  if (accuracyM && accuracyM > 50) return "GPS Accuracy Poor";
  if (distanceM <= site.geofence_radius_m) return "Valid";
  if (distanceM <= site.geofence_warning_radius_m) return "Warning";
  return "Outside Geofence";
}

export function getWorkerPrincipal(userId: string): any | null {
  return (db.prepare(
    "SELECT w.*, c.name AS company_name FROM workers w LEFT JOIN companies c ON c.id=w.company_id " +
    "WHERE w.user_id=? AND w.status='Active' ORDER BY w.created_at DESC LIMIT 1"
  ).get(userId) as any) || null;
}

export function getActiveWorkerAssignment(
  workerId: string,
  projectId: string,
  siteId: string,
  workDate: string
): any | null {
  if (!workerId || !projectId || !siteId || !workDate) return null;
  return (db.prepare(
    "SELECT * FROM worker_assignments WHERE worker_id=? AND project_id=? AND site_id=? AND status='Active' " +
    "AND (start_date IS NULL OR start_date='' OR start_date<=?) " +
    "AND (end_date IS NULL OR end_date='' OR end_date>=?) " +
    "ORDER BY COALESCE(start_date,'') DESC, created_at DESC LIMIT 1"
  ).get(workerId, projectId, siteId, workDate, workDate) as any) || null;
}

export function canAccessWorker(user: AuthenticatedUser, worker: any, action: "view" | "edit"): boolean {
  if (!worker) return false;
  if (worker.project_id && !canAccessProject(user, worker.project_id)) return false;
  if (user.role === "Admin") return true;
  if (action === "view" && !canView(user, "workers")) return false;
  if (action === "edit" && !canEdit(user, "workers")) return false;

  if (user.role === "Worker") return worker.user_id === user.user_id || worker.id === user.worker_id;

  if (user.role === "Subcontractor") {
    if (!user.company_id || worker.company_id !== user.company_id) return false;
    if (user.work_package_id && worker.work_package_id && worker.work_package_id !== user.work_package_id) return false;
    return true;
  }

  if (user.role === "SiteSupervisor") {
    if (worker.supervisor_id === user.user_id) return true;
    return Boolean(db.prepare(
      "SELECT 1 FROM worker_assignments WHERE worker_id=? AND supervisor_id=? AND status='Active' LIMIT 1"
    ).get(worker.id, user.user_id));
  }

  return canAccessProject(user, worker.project_id);
}

export function canAccessSite(user: AuthenticatedUser, site: any, action: "view" | "edit"): boolean {
  if (!site || !site.project_id || !canAccessProject(user, site.project_id)) return false;
  if (user.role === "Admin") return true;
  if (site.status === "Inactive") return false;
  if (action === "edit") return user.role === "ProjectManager" && canEdit(user, "sites");
  return canView(user, "sites") || canView(user, "workforce") || canView(user, "attendance");
}

export function canAccessAttendance(user: AuthenticatedUser, record: any, action: "view" | "edit"): boolean {
  if (!record || !canAccessProject(user, record.project_id)) return false;
  if (user.role === "Admin") return true;
  if (user.role === "Worker") return record.user_id === user.user_id || record.worker_id === user.worker_id;
  const worker = record.worker_id ? db.prepare("SELECT * FROM workers WHERE id=?").get(record.worker_id) as any : null;
  if (user.role === "Subcontractor") return Boolean(worker && user.company_id && worker.company_id === user.company_id);
  if (user.role === "SiteSupervisor") {
    return Boolean(record.worker_id && db.prepare(
      "SELECT 1 FROM worker_assignments WHERE worker_id=? AND project_id=? AND supervisor_id=? AND status='Active' LIMIT 1"
    ).get(record.worker_id, record.project_id, user.user_id));
  }
  if (action === "edit") return canEdit(user, "attendance");
  return canView(user, "attendance") || user.role === "ProjectManager";
}

export function canAccessSiteInstruction(user: AuthenticatedUser, instruction: any, action: WorkforceAction): boolean {
  if (!instruction || !instruction.project_id || !canAccessProject(user, instruction.project_id)) return false;
  if (user.role === "Admin") return true;

  if (user.role === "Worker") {
    const worker = getWorkerPrincipal(user.user_id);
    return Boolean(worker && instruction.assigned_worker_id === worker.id && (action === "view" || action === "update"));
  }

  if (user.role === "Subcontractor") {
    let scopedCompanyId: string | null = null;
    if (instruction.work_package_id) {
      const wp = db.prepare("SELECT company_id FROM work_packages WHERE id=? AND project_id=?").get(
        instruction.work_package_id, instruction.project_id
      ) as any;
      scopedCompanyId = wp?.company_id || null;
    }
    if (!scopedCompanyId && instruction.assigned_worker_id) {
      const worker = db.prepare("SELECT company_id FROM workers WHERE id=?").get(instruction.assigned_worker_id) as any;
      scopedCompanyId = worker?.company_id || null;
    }
    if (!user.company_id || scopedCompanyId !== user.company_id) return false;
    if (user.work_package_id && instruction.work_package_id && user.work_package_id !== instruction.work_package_id) return false;
    return action === "view" || action === "update";
  }

  if (user.role === "SiteSupervisor") {
    const directlyAssigned = instruction.assigned_supervisor_id === user.user_id;
    const supervisesWorker = Boolean(instruction.assigned_worker_id && db.prepare(
      "SELECT 1 FROM worker_assignments WHERE worker_id=? AND project_id=? AND supervisor_id=? AND status='Active' LIMIT 1"
    ).get(instruction.assigned_worker_id, instruction.project_id, user.user_id));
    const supervisesSite = Boolean(instruction.site_id && db.prepare(
      "SELECT 1 FROM worker_assignments WHERE project_id=? AND site_id=? AND supervisor_id=? AND status='Active' LIMIT 1"
    ).get(instruction.project_id, instruction.site_id, user.user_id));
    if (!directlyAssigned && !supervisesWorker && !supervisesSite) return false;
    return ["view", "update", "assign", "verify"].includes(action);
  }

  if (user.role === "ProjectManager") return true;
  if (action === "view") return canView(user, "site_instructions");
  return false;
}

export function canAccessPayroll(user: AuthenticatedUser): boolean {
  return user.role === "Admin" || user.role === "CommercialManager";
}

export function safeTimeZone(value: any): string {
  const candidate = String(value || "UTC");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
}

export function zonedParts(date: Date, timeZone: string): { date: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value])) as Record<string,string>;
  return {
    date: parts.year + "-" + parts.month + "-" + parts.day,
    hour: parseInt(parts.hour || "0", 10),
    minute: parseInt(parts.minute || "0", 10),
  };
}

export function addIsoDays(dateString: string, days: number): string {
  const d = new Date(dateString + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayNumber(dateString: string): number {
  return new Date(dateString + "T12:00:00Z").getUTCDay();
}

export function parseWorkingDays(value: any): number[] {
  try {
    const parsed = JSON.parse(String(value || "[1,2,3,4,5]"));
    if (Array.isArray(parsed)) {
      const days = parsed.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
      if (days.length) return [...new Set(days)];
    }
  } catch {}
  return [1,2,3,4,5];
}

export function getWorkerShift(workerId: string, workDate: string): any | null {
  return (db.prepare(
    "SELECT st.* FROM worker_schedules ws JOIN shift_templates st ON st.id=ws.shift_template_id " +
    "WHERE ws.worker_id=? AND st.status='Active' AND ws.effective_from<=? " +
    "AND (ws.effective_to IS NULL OR ws.effective_to='' OR ws.effective_to>=?) " +
    "ORDER BY ws.effective_from DESC LIMIT 1"
  ).get(workerId, workDate, workDate) as any) || null;
}

export function resolveWorkDateForPunch(workerId: string, site: any, now: Date): { workDate: string; shift: any | null } {
  const local = zonedParts(now, site?.timezone || "UTC");
  let workDate = local.date;
  let shift = getWorkerShift(workerId, workDate);
  if (shift && String(shift.start_time || "") > String(shift.end_time || "")) {
    const endParts = String(shift.end_time || "00:00").split(":").map(Number);
    const localMinutes = local.hour * 60 + local.minute;
    const endMinutes = (endParts[0] || 0) * 60 + (endParts[1] || 0);
    if (localMinutes < endMinutes) {
      workDate = addIsoDays(workDate, -1);
      shift = getWorkerShift(workerId, workDate) || shift;
    }
  }
  return { workDate, shift };
}

export function isPublicHoliday(projectId: string, siteId: string | null, workDate: string): any | null {
  return (db.prepare(
    "SELECT * FROM public_holidays WHERE holiday_date=? " +
    "AND (project_id IS NULL OR project_id=?) AND (site_id IS NULL OR site_id=?) " +
    "ORDER BY CASE WHEN site_id IS NULL THEN 1 ELSE 0 END, CASE WHEN project_id IS NULL THEN 1 ELSE 0 END LIMIT 1"
  ).get(workDate, projectId, siteId) as any) || null;
}

export function scheduledWorkingDay(workerId: string, workDate: string): boolean {
  const shift = getWorkerShift(workerId, workDate);
  const workingDays = parseWorkingDays(shift?.working_days_json);
  return workingDays.includes(weekdayNumber(workDate));
}

export function attendanceStatusForRecord(record: any): string {
  const geofenceException = ["Outside Geofence", "GPS Accuracy Poor"].includes(record.punch_in_geofence_status)
    || ["Outside Geofence", "GPS Accuracy Poor"].includes(record.punch_out_geofence_status);
  if (geofenceException) return "Attendance Exception";
  if (!record.punch_out) {
    const site = record.site_id ? db.prepare("SELECT timezone FROM sites WHERE id=?").get(record.site_id) as any : null;
    const today = zonedParts(new Date(), site?.timezone || "UTC").date;
    if (record.work_date < today) return "Missing Punch";
    if ((record.late_minutes || 0) > 0) return "Late";
    return "Present";
  }
  if ((record.late_minutes || 0) > 0) return "Late";
  return "Present";
}

export function recalculateAttendanceRecord(attendanceId: string): any | null {
  const record = db.prepare("SELECT * FROM attendance WHERE id=?").get(attendanceId) as any;
  if (!record) return null;

  const shift = record.shift_template_id
    ? db.prepare("SELECT * FROM shift_templates WHERE id=?").get(record.shift_template_id) as any
    : null;
  let elapsedMinutes = 0;
  let breakMinutes = 0;
  let regularMinutes = 0;
  let rawOtMinutes = 0;
  let approvedOtMinutes = 0;
  let lateMinutes = 0;

  if (record.punch_in && record.punch_out) {
    elapsedMinutes = Math.max(0, Math.round((new Date(record.punch_out).getTime() - new Date(record.punch_in).getTime()) / 60000));
    breakMinutes = Math.min(elapsedMinutes, Math.max(0, Number(shift?.break_minutes || 0)));
    const workedMinutes = Math.max(0, elapsedMinutes - breakMinutes);
    const thresholdMinutes = Math.max(0, Math.round(Number(shift?.ot_threshold_hours ?? shift?.regular_hours ?? 8) * 60));
    regularMinutes = Math.min(workedMinutes, thresholdMinutes || workedMinutes);
    rawOtMinutes = Math.max(0, workedMinutes - regularMinutes);
    approvedOtMinutes = record.ot_status === "Approved" ? rawOtMinutes : 0;
  }

  if (shift && record.punch_in) {
    const site = record.site_id ? db.prepare("SELECT timezone FROM sites WHERE id=?").get(record.site_id) as any : null;
    const localPunch = zonedParts(new Date(record.punch_in), site?.timezone || "UTC");
    const start = String(shift.start_time || "00:00").split(":").map(Number);
    let punchMinute = localPunch.hour * 60 + localPunch.minute;
    if (localPunch.date > record.work_date && String(shift.start_time || "") > String(shift.end_time || "")) punchMinute += 1440;
    const scheduledMinute = (start[0] || 0) * 60 + (start[1] || 0);
    const grace = Math.max(0, Number(shift.grace_minutes || 0));
    lateMinutes = Math.max(0, punchMinute - scheduledMinute - grace);
  }

  const compatibilityRegularHours = Math.round((regularMinutes / 60) * 100) / 100;
  const compatibilityOvertimeHours = Math.round((rawOtMinutes / 60) * 100) / 100;
  const next = { ...record, late_minutes: lateMinutes };
  const attendanceStatus = attendanceStatusForRecord(next);

  db.prepare(
    "UPDATE attendance SET elapsed_minutes=?,regular_minutes=?,break_minutes=?,raw_overtime_minutes=?," +
    "approved_overtime_minutes=?,late_minutes=?,attendance_status=?,regular_hours=?,overtime_hours=? WHERE id=?"
  ).run(
    elapsedMinutes, regularMinutes, breakMinutes, rawOtMinutes, approvedOtMinutes, lateMinutes,
    attendanceStatus, compatibilityRegularHours, compatibilityOvertimeHours, attendanceId
  );
  return db.prepare("SELECT * FROM attendance WHERE id=?").get(attendanceId) as any;
}

export function calculateDailyAttendanceStatus(workerId: string, projectId: string, siteId: string | null, workDate: string): string {
  const leave = db.prepare(
    "SELECT lr.*, lt.code, lt.name, lt.is_paid FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id " +
    "WHERE lr.worker_id=? AND lr.project_id=? AND lr.status='Approved' AND lr.start_date<=? AND lr.end_date>=? LIMIT 1"
  ).get(workerId, projectId, workDate, workDate) as any;
  if (leave) {
    const code = String(leave.code || "").toUpperCase();
    const name = String(leave.name || "").toLowerCase();
    if (code === "SL" || name.includes("sick")) return "Sick Leave";
    if (!leave.is_paid || code === "UL" || name.includes("unpaid")) return "Unpaid Leave";
    if (code === "AL" || name.includes("annual")) return "Annual Leave";
    return "Leave";
  }

  if (isPublicHoliday(projectId, siteId, workDate)) return "Public Holiday";
  if (!scheduledWorkingDay(workerId, workDate)) return "Rest Day";

  const attendance = db.prepare(
    "SELECT * FROM attendance WHERE worker_id=? AND project_id=? AND work_date=? ORDER BY punch_in DESC LIMIT 1"
  ).get(workerId, projectId, workDate) as any;
  if (attendance) return attendance.attendance_status || attendanceStatusForRecord(attendance);
  return "Absent";
}

export function chargeableLeaveDays(workerId: string, projectId: string, startDate: string, endDate: string): number {
  if (!workerId || !startDate || !endDate || endDate < startDate) return 0;
  let days = 0;
  let cursor = startDate;
  let guard = 0;
  while (cursor <= endDate && guard < 370) {
    const assignment = db.prepare(
      "SELECT * FROM worker_assignments WHERE worker_id=? AND project_id=? AND status='Active' " +
      "AND (start_date IS NULL OR start_date='' OR start_date<=?) AND (end_date IS NULL OR end_date='' OR end_date>=?) " +
      "ORDER BY created_at DESC LIMIT 1"
    ).get(workerId, projectId, cursor, cursor) as any;
    const siteId = assignment?.site_id || null;
    if (scheduledWorkingDay(workerId, cursor) && !isPublicHoliday(projectId, siteId, cursor)) days++;
    cursor = addIsoDays(cursor, 1);
    guard++;
  }
  return days;
}

