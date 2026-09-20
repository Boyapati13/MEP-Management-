/**
 * MEP Management Platform — V1.4.1 UX Presentation Permissions
 * Guides frontend layout visibility, action affordances, and field-level masking.
 * Note: Real security is always strictly enforced on the server.
 */
import { NavigationDomain, ROUTE_ITEMS, DOMAINS } from './routes';

export type UserRole =
  | 'Admin'
  | 'ProjectManager'
  | 'SiteEngineer'
  | 'SiteSupervisor'
  | 'CommercialManager'
  | 'QAQC'
  | 'SafetyOfficer'
  | 'Subcontractor'
  | 'Client'
  | 'Worker';

export interface UserSession {
  id?: string;
  user_id?: string;
  name?: string;
  email?: string;
  role: UserRole | string;
  company_id?: string;
  work_package_id?: string;
  access_scope?: 'company' | 'work_package' | 'explicit_packages';
  allowed_work_package_ids?: string[] | string;
}

export type WorkspaceType = 'internal' | 'subcontractor' | 'client' | 'worker';

export function getWorkspaceForRole(role?: string): WorkspaceType {
  if (role === 'Subcontractor') return 'subcontractor';
  if (role === 'Client') return 'client';
  if (role === 'Worker') return 'worker';
  return 'internal';
}

export function canShowDomain(user: UserSession | null, domain: NavigationDomain): boolean {
  if (!user) return false;
  const role = user.role;

  // Role-specific workspace filtering
  if (role === 'Worker') return false; // Workers use mobile shell
  if (role === 'Subcontractor') {
    // Subcontractors have dedicated isolated navigation in SubcontractorLayout
    return false;
  }
  if (role === 'Client') {
    // Clients have curated portal in ClientPortalLayout
    return false;
  }

  const domainCfg = DOMAINS.find(d => d.id === domain);
  if (!domainCfg) return false;

  if (domainCfg.allowedRoles && !domainCfg.allowedRoles.includes(role)) {
    return false;
  }

  return true;
}

export function canShowRoute(user: UserSession | null, routeId: string): boolean {
  if (!user) return false;
  const role = user.role;

  const item = ROUTE_ITEMS.find(r => r.id === routeId);
  if (!item) return true;

  if (item.allowedRoles && !item.allowedRoles.includes(role)) {
    return false;
  }

  return true;
}

/**
 * Field-level presentation permission check.
 * Example: Non-commercial roles should not see unit rates or profit margins.
 */
export function canShowField(user: UserSession | null, field: string): boolean {
  if (!user) return false;
  const role = user.role;

  const commercialSensitiveFields = [
    'unit_rate',
    'total_cost',
    'labour_cost',
    'hourly_rate',
    'profit_margin',
    'certified_amount',
    'claim_financials'
  ];

  if (commercialSensitiveFields.includes(field)) {
    return ['Admin', 'ProjectManager', 'CommercialManager'].includes(role);
  }

  return true;
}

/**
 * Action affordance check.
 */
export function canShowAction(user: UserSession | null, action: string, context?: any): boolean {
  if (!user) return false;
  const role = user.role;

  switch (action) {
    case 'publish_progress_report':
    case 'revise_progress_report':
      return ['Admin', 'ProjectManager'].includes(role);

    case 'verify_progress_claim':
      return (
        ['Admin', 'ProjectManager', 'CommercialManager'].includes(role) &&
        (!user.company_id || user.company_id !== context?.company_id)
      );

    case 'submit_progress_claim':
      return ['Subcontractor', 'Admin', 'CommercialManager'].includes(role);

    case 'manage_users':
    case 'view_audit':
      return role === 'Admin';

    case 'manage_sites':
    case 'edit_work_package':
      return ['Admin', 'ProjectManager'].includes(role);

    default:
      return true;
  }
}
