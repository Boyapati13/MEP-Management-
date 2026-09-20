export type SubcontractorAccessScope = 'company' | 'work_package' | 'explicit_packages';

export interface SubcontractorAccessUser {
  user_id: string;
  role: string;
  company_id?: string;
  work_package_id?: string;
  access_scope?: SubcontractorAccessScope;
  allowed_work_package_ids?: string[] | string;
}

/**
 * Authoritative check for whether a user can access a specific work package.
 * Implements explicit Subcontractor access scopes:
 * - 'company': all packages belonging to user's company
 * - 'work_package': strictly the package matching user.work_package_id
 * - 'explicit_packages': strictly packages enumerated in user.allowed_work_package_ids
 */
export function canAccessWorkPackage(
  user: SubcontractorAccessUser,
  wp: { id: string; company_id?: string | null }
): boolean {
  if (!user || !wp) return false;

  // Main contractor leadership and engineering roles
  if (['Admin', 'ProjectManager', 'SiteEngineer', 'CommercialManager', 'SafetyOfficer', 'QAQC', 'Consultant'].includes(user.role)) {
    return true;
  }

  // Subcontractor explicit scope rules
  if (user.role === 'Subcontractor') {
    const scope: SubcontractorAccessScope = user.access_scope || 'work_package';

    if (scope === 'company') {
      return Boolean(user.company_id && wp.company_id && user.company_id === wp.company_id);
    }

    if (scope === 'work_package') {
      return Boolean(user.work_package_id && user.work_package_id === wp.id);
    }

    if (scope === 'explicit_packages') {
      let ids: string[] = [];
      if (Array.isArray(user.allowed_work_package_ids)) {
        ids = user.allowed_work_package_ids;
      } else if (typeof user.allowed_work_package_ids === 'string') {
        try {
          ids = JSON.parse(user.allowed_work_package_ids);
        } catch {
          ids = user.allowed_work_package_ids.split(',').map(s => s.trim()).filter(Boolean);
        }
      }
      return ids.includes(wp.id);
    }

    return false;
  }

  // Workers and clients do not have command center access to work packages
  return false;
}
