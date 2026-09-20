export interface PolicyUser {
  user_id: string;
  name: string;
  role: string;
  company_id?: string;
  work_package_id?: string;
  access_scope?: string;
  allowed_work_package_ids?: string[] | string;
}

/**
 * Evaluates access to Procurement Programme Impact analytics.
 * Worker: false (403)
 * Client: false (403)
 * Subcontractor: true (only with data redaction and own-package filtering)
 * Leadership / Management / Engineering: true
 */
export function canViewProgrammeProcurementRisk(user: PolicyUser, hasProjectAccess: boolean): boolean {
  if (!user || !hasProjectAccess) return false;
  if (user.role === 'Worker' || user.role === 'Client') return false;
  if (['Admin', 'ProjectManager', 'CommercialManager', 'SiteEngineer', 'QAQC'].includes(user.role)) return true;
  if (user.role === 'Subcontractor') return true;
  return false;
}

/**
 * Evaluates access to the 5x5 Risk Heat Map Matrix.
 * Worker: false (403)
 * Client: false (403)
 * Subcontractor: true (scoped to own package risks)
 * Leadership / Management / Engineering: true
 */
export function canViewRiskMatrix(user: PolicyUser, hasProjectAccess: boolean): boolean {
  if (!user || !hasProjectAccess) return false;
  if (user.role === 'Worker' || user.role === 'Client') return false;
  if (['Admin', 'ProjectManager', 'CommercialManager', 'SiteEngineer', 'SafetyOfficer', 'QAQC', 'Consultant'].includes(user.role)) return true;
  if (user.role === 'Subcontractor') return true;
  return false;
}

/**
 * Evaluates access to a specific risk record.
 */
export function canAccessRisk(user: PolicyUser, risk: any, action: 'view' | 'edit' | 'delete' = 'view'): boolean {
  if (!user || !risk) return false;
  if (user.role === 'Admin') return true;
  if (user.role === 'Worker') return false;
  if (user.role === 'Client') {
    return action === 'view' && (risk.visibility === 'Client' || risk.status === 'Published');
  }
  if (user.role === 'Subcontractor') {
    // Subcontractors can only view or manage risks tied to their assigned work package
    if (!risk.work_package_id && !risk.linked_task_id) return false;
    if (user.work_package_id && risk.work_package_id) {
      return user.work_package_id === risk.work_package_id;
    }
    return false;
  }
  return true;
}

/**
 * Evaluates access to a specific Project Action item.
 */
export function canAccessProjectAction(user: PolicyUser, actionItem: any, action: 'view' | 'edit' | 'delete' = 'view'): boolean {
  if (!user || !actionItem) return false;
  if (user.role === 'Admin' || user.role === 'ProjectManager' || user.role === 'SiteEngineer') return true;
  if (user.role === 'Client') {
    return action === 'view' && actionItem.visibility === 'Client';
  }
  if (user.role === 'Subcontractor') {
    if (action === 'delete') return false;
    return (
      actionItem.assigned_to_user_id === user.user_id ||
      actionItem.owner_company_id === user.company_id ||
      (user.work_package_id && actionItem.work_package_id === user.work_package_id)
    );
  }
  if (user.role === 'Worker') {
    return action === 'view' && actionItem.assigned_to_user_id === user.user_id;
  }
  return true;
}

/**
 * Evaluates access to a specific Project Decision item.
 */
export function canAccessProjectDecision(user: PolicyUser, decision: any, action: 'view' | 'edit' | 'delete' = 'view'): boolean {
  if (!user || !decision) return false;
  if (user.role === 'Admin' || user.role === 'ProjectManager') return true;
  if (user.role === 'Worker') return false;
  if (user.role === 'Client') {
    return action === 'view' && (decision.visibility === 'Client' || decision.status === 'Approved');
  }
  if (user.role === 'Subcontractor') {
    return action === 'view' && decision.visibility !== 'Internal';
  }
  return true;
}

/**
 * Evaluates access to a Progress Report.
 * Clients can ONLY access published reports; draft reports are strictly forbidden/hidden (404/403).
 */
export function canAccessProgressReport(user: PolicyUser, report: any): boolean {
  if (!user || !report) return false;
  if (user.role === 'Admin' || user.role === 'ProjectManager' || user.role === 'CommercialManager' || user.role === 'SiteEngineer') {
    return true;
  }
  if (user.role === 'Client') {
    return report.status === 'Published';
  }
  if (user.role === 'Subcontractor') {
    return report.status === 'Published';
  }
  return false;
}
