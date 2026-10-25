import { Request, Response, NextFunction } from "express";
import { db } from "../db/connection";
import { ROLE_PERMS } from "../config/constants";

export interface AuthenticatedUser {
  user_id: string;
  name: string;
  role: "Admin" | "ProjectManager" | "SiteEngineer" | "CommercialManager" | "SafetyOfficer" | "QAQC" | "Subcontractor" | "Consultant" | "Client" | string;
  email?: string;
  company_id?: string;
  company?: string;
  trade?: string;
  work_package_id?: string;
  specialization?: string;
  worker_id?: string;
  access_scope?: 'company' | 'work_package' | 'explicit_packages';
  allowed_work_package_ids?: string[] | string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

// Permissions & Scope Helpers
export function canAccessProject(user: AuthenticatedUser, projectId?: string): boolean {
  if (!projectId) return false;
  if (user.role === "Admin") return true;

  // Active individual user membership is required
  const memberRow = db.prepare(
    "SELECT 1 FROM project_memberships WHERE user_id=? AND project_id=? AND active=1"
  ).get(user.user_id, projectId);
  if (!memberRow) return false;

  // If user belongs to a company, that company must be Active AND participate in the project
  if (user.company_id) {
    const comp = db.prepare("SELECT status FROM companies WHERE id=?").get(user.company_id) as any;
    if (!comp || comp.status === "Inactive") return false;

    const compRow = db.prepare(
      "SELECT 1 FROM project_companies WHERE project_id=? AND company_id=?"
    ).get(projectId, user.company_id);
    if (!compRow) return false;
  }
  return true;
}

export const hasProjectAccess = canAccessProject;

export function canAccessCompany(user: AuthenticatedUser, companyId?: string): boolean {
  if (!companyId) return true;
  if (user.role === "Admin") return true;
  if (user.role === "Client") return false;
  if (user.role === "Subcontractor") {
    return user.company_id === companyId;
  }
  return true;
}

export function canAccessWorkPackage(user: AuthenticatedUser, workPackageId?: string, projectId?: string): boolean {
  if (!workPackageId) return true;
  if (user.role === "Admin") return true;
  if (projectId && !canAccessProject(user, projectId)) return false;

  if (user.role === "Subcontractor") {
    if (!user.work_package_id) return false;
    return user.work_package_id === workPackageId;
  }
  return true;
}

export function projectScopeSql(user: AuthenticatedUser, projectId?: string | null, column: string = "project_id"): { where: string | null; params: any[] } {
  if (projectId && projectId !== "ALL") {
    if (!hasProjectAccess(user, projectId)) {
      return { where: null, params: [] };
    }
    return { where: `${column}=?`, params: [projectId] };
  }
  if (user.role === "Admin") {
    return { where: "1=1", params: [] };
  }
  if (user.company_id) {
    return {
      where: `${column} IN (SELECT pm.project_id FROM project_memberships pm INNER JOIN project_companies pc ON pc.project_id = pm.project_id AND pc.company_id = ? WHERE pm.user_id=? AND pm.active=1)`,
      params: [user.company_id, user.user_id],
    };
  }
  return {
    where: `${column} IN (SELECT project_id FROM project_memberships WHERE user_id=? AND active=1)`,
    params: [user.user_id],
  };
}

export function canView(user: AuthenticatedUser, module: string): boolean {
  const perms = ROLE_PERMS[user.role];
  return perms ? perms.view.includes(module) : false;
}

export function canEdit(user: AuthenticatedUser, module: string): boolean {
  const perms = ROLE_PERMS[user.role];
  return perms ? perms.edit.includes(module) : false;
}

export function canDelete(user: AuthenticatedUser): boolean {
  const perms = ROLE_PERMS[user.role];
  return perms ? perms.delete : false;
}

export function canPerformAction(
  user: AuthenticatedUser,
  module: string,
  action: "view" | "create" | "edit" | "delete" | "approve" | "publish"
): boolean {
  if (user.role === "Admin") return true;
  const perms = ROLE_PERMS[user.role];
  if (!perms) return false;

  if (action === "view") return perms.view.includes(module);
  if (action === "create" || action === "edit") return perms.edit.includes(module);
  if (action === "delete") return Boolean(perms.delete);
  if (action === "approve") return user.role === "ProjectManager" || user.role === "CommercialManager";
  if (action === "publish") return user.role === "ProjectManager";
  return false;
}

export function externalRecordDto(record: any, user: AuthenticatedUser, module: string): any {
  if (!record) return null;
  const dto = { ...record };
  delete dto.password_hash;

  if (user.role === "Client") {
    if (module === "documents" || module === "drawings") {
      delete dto.subcontractor_id;
      delete dto.subcontractor_username;
      delete dto.markup_data;
      delete dto.internal_notes;
    }
    if (module === "projects") {
      delete dto.budget;
      delete dto.contract_sum;
      delete dto.internal_margin;
      delete dto.target_cost;
    }
    if (module === "change_orders") {
      delete dto.internal_cost;
      delete dto.contractor_markup;
      delete dto.internal_notes;
    }
    if (module === "progress_reports") {
      delete dto.internal_comments;
      delete dto.contractor_notes;
    }
    if (module === "clarifications") {
      delete dto.internal_notes;
    }
  }

  if (user.role === "Subcontractor") {
    if (module === "projects") {
      delete dto.budget;
    }
    if (module === "change_orders") {
      delete dto.internal_contractor_budget;
    }
  }

  // Phase 3: Payroll compensation isolation - only Admin and CommercialManager see compensation
  if (user.role !== "Admin" && user.role !== "CommercialManager") {
    delete dto.basic_daily_rate;
    delete dto.basic_monthly_rate;
    delete dto.basic_pay;
    delete dto.overtime_pay;
    delete dto.housing_allowance;
    delete dto.transport_allowance;
    delete dto.food_allowance;
    delete dto.gross_pay;
    delete dto.net_pay;
    delete dto.deductions;
    delete dto.bank_account;
    delete dto.bank_name;
    delete dto.ot_multiplier;
  }

  return dto;
}

// Centralized record authorization helper enforcing project, company, work package, role, and visibility rules
export function canAccessRecord(
  user: AuthenticatedUser,
  record: any,
  action: "view" | "edit" | "delete" | "create",
  module: string
): boolean {
  if (!record) return false;
  if (record.project_id && !canAccessProject(user, record.project_id)) return false;
  if (user.role === "Admin") return true;

  // Phase 3: Worker role scoping - can only view/edit records associated with themselves
  if (user.role === "Worker") {
    if (module === "workers") {
      return record.user_id === user.user_id || record.id === user.worker_id;
    }
    if (module === "attendance") {
      return record.user_id === user.user_id || record.worker_id === user.worker_id;
    }
    if (module === "site_instructions") {
      return record.assigned_worker_id === user.worker_id || record.assigned_worker_id === user.user_id;
    }
    if (module === "leave_requests") {
      return record.user_id === user.user_id || record.worker_id === user.worker_id;
    }
    if (module === "payroll_entries" || module === "payroll_profiles" || module === "payroll_periods") {
      return false;
    }
  }

  // Phase 3: SiteSupervisor role scoping
  if (user.role === "SiteSupervisor") {
    if (module === "workers") {
      return record.supervisor_id === user.user_id || record.supervisor_id === user.worker_id;
    }
    if (module === "payroll_entries" || module === "payroll_profiles" || module === "payroll_periods") {
      return false;
    }
  }

  // Phase 3: Payroll modules - strictly Admin & CommercialManager
  if (module === "payroll_profiles" || module === "payroll_entries" || module === "payroll_adjustments") {
    if (user.role !== "Admin" && user.role !== "CommercialManager") return false;
  }

  if (action === "view" && !canView(user, module)) return false;
  if ((action === "edit" || action === "create") && !canEdit(user, module)) {
    const isSpecialAllowed = (module === "documents" || module === "drawings" || module === "clarifications" || module === "progress_submissions") && user.role === "Subcontractor";
    if (!isSpecialAllowed) return false;
  }
  if (action === "delete" && !canDelete(user)) {
    const isOwnDoc = (module === "documents" || module === "drawings") && user.role === "Subcontractor" &&
      (record.subcontractor_id === user.user_id ||
       Boolean(db.prepare("SELECT 1 FROM record_owners WHERE module='documents' AND record_id=? AND user_id=?").get(record.id, user.user_id)));
    if (!isOwnDoc) return false;
  }

  // Client role rules
  if (user.role === "Client") {
    if (action !== "view") {
      if (action === "create" && (module === "documents" || module === "clarifications")) {
        return true;
      }
      return false;
    }
    if (module === "projects") {
      return canAccessProject(user, record.id || record.project_id);
    }
    if (module === "documents" || module === "drawings") {
      return record.visibility === "Client" || record.visibility === "All" || record.uploaded_by === user.name;
    }
    if (module === "change_orders") {
      return record.visibility === "Client" || record.visibility === "All";
    }
    if (module === "progress_reports") {
      return record.status === "Published" || record.status === "Published to Client";
    }
    if (module === "clarifications") {
      return record.visibility === "Client" || record.visibility === "All" || record.to_company_id === user.company_id || record.from_company_id === user.company_id;
    }
    return false;
  }

  // Subcontractor role rules
  if (user.role === "Subcontractor") {
    // Cross work-package isolation
    if (record.work_package_id && user.work_package_id) {
      if (record.work_package_id !== user.work_package_id) return false;
    } else if (record.work_package_id && !user.work_package_id) {
      if (!(user.company_id && record.company_id && record.company_id === user.company_id)) {
        return false;
      }
    }

    // Cross company isolation
    if (record.company_id && user.company_id) {
      if (record.company_id !== user.company_id) return false;
    } else if (record.company_id && !user.company_id) {
      return false;
    }

    // If user is bound to a work package or company, restrict generic unassigned records
    if (user.work_package_id || user.company_id) {
      if (!record.work_package_id && !record.company_id) {
        const isOwner = Boolean(db.prepare("SELECT 1 FROM record_owners WHERE module=? AND record_id=? AND user_id=?").get(module, record.id, user.user_id));
        const isAssigned = (record.subcontractor_id === user.user_id) || (record.assignee === user.name) || (user.company && record.contractor === user.company);
        if (!isOwner && !isAssigned) return false;
      }
    }

    // Documents specific checks
    if (module === "documents" || module === "drawings") {
      const isOwner = record.subcontractor_id === user.user_id;
      const isRecordOwner = Boolean(
        db.prepare("SELECT 1 FROM record_owners WHERE module='documents' AND record_id=? AND user_id=?").get(record.id, user.user_id)
      );
      const isWpMatch = Boolean(user.work_package_id && record.work_package_id === user.work_package_id);
      const isCoMatch = Boolean(user.company_id && record.company_id === user.company_id);
      if (!isOwner && !isRecordOwner && !isWpMatch && !isCoMatch) return false;
    }

    return true;
  }

  return true;
}


// Authentication Helper & Middleware
export function getCurrentUser(req: Request): AuthenticatedUser | null {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const session = db.prepare("SELECT * FROM sessions WHERE token=?").get(token) as any;
  if (!session) return null;

  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token=?").run(token);
    return null;
  }
  // Re-fetch current live user and verify active status on every request (P1 session revocation)
  const userRow = db.prepare("SELECT id, username, name, role, status, email, phone, company_id, company, trade, work_package_id, worker_id, access_scope, allowed_work_package_ids FROM users WHERE id=?").get(session.user_id) as any;
  if (!userRow || userRow.status !== "Active") {
    db.prepare("DELETE FROM sessions WHERE token=?").run(token);
    return null;
  }
  if (userRow.company_id) {
    const comp = db.prepare("SELECT status FROM companies WHERE id=?").get(userRow.company_id) as any;
    if (comp && comp.status === "Inactive") {
      db.prepare("DELETE FROM sessions WHERE token=?").run(token);
      return null;
    }
  }
  return {
    user_id: userRow.id,
    name: userRow.name,
    role: userRow.role,
    email: userRow.email || undefined,
    company_id: userRow.company_id || undefined,
    company: userRow.company || undefined,
    trade: userRow.trade || undefined,
    work_package_id: userRow.work_package_id || undefined,
    worker_id: userRow.worker_id || undefined,
    access_scope: userRow.access_scope || 'work_package',
    allowed_work_package_ids: userRow.allowed_work_package_ids || undefined,
  };
}

export function authRequired(req: Request, res: Response, next: NextFunction): void {
  const user = getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.user = user;
  next();
}
