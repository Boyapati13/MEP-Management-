/**
 * MEP Management Platform — V1.4.1 Professional Navigation
 * Primary navigation describes construction work, not implementation technology.
 */
import {
  LayoutDashboard,
  Truck,
  HardHat,
  FileCheck2,
  Receipt,
  Sliders,
  Settings as SettingsIcon,
  Layers,
  CalendarCheck,
  Users,
  ShieldCheck,
  FileText,
  HelpCircle,
  FolderKanban,
  FileSpreadsheet,
  Package,
  ListTodo,
  CheckSquare,
  Flame,
  Building,
  UserCog,
  History,
  MapPinned,
  ClipboardList,
  TrendingUp
} from 'lucide-react';

export type NavigationDomain =
  | 'dashboard'
  | 'delivery'
  | 'site'
  | 'technical'
  | 'commercial'
  | 'controls'
  | 'settings';

export interface RouteItem {
  id: string;
  label: string;
  icon: any;
  domain: NavigationDomain;
  badgeKey?: string;
  allowedRoles?: string[];
}

export interface DomainConfig {
  id: NavigationDomain;
  label: string;
  icon: any;
  description: string;
  defaultRoute: string;
  allowedRoles?: string[];
}

export const DOMAINS: DomainConfig[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    description: 'Project health, attention items, lookahead and workforce',
    defaultRoute: 'dashboard'
  },
  {
    id: 'delivery',
    label: 'Delivery',
    icon: Truck,
    description: 'Programme, work packages and progress',
    defaultRoute: 'tasks'
  },
  {
    id: 'site',
    label: 'Site',
    icon: HardHat,
    description: 'Workforce, quality, site records and logistics',
    defaultRoute: 'workforce'
  },
  {
    id: 'technical',
    label: 'Technical',
    icon: FileCheck2,
    description: 'RFIs, submittals and controlled documents',
    defaultRoute: 'rfis'
  },
  {
    id: 'commercial',
    label: 'Commercial',
    icon: Receipt,
    description: 'BOQ, procurement and commercial changes',
    defaultRoute: 'boq'
  },
  {
    id: 'controls',
    label: 'Controls',
    icon: Sliders,
    description: 'Risks, actions and decisions',
    defaultRoute: 'risks'
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: SettingsIcon,
    description: 'Project setup, access and audit',
    defaultRoute: 'setup-checklist',
    allowedRoles: ['Admin', 'ProjectManager']
  }
];

export const ROUTE_ITEMS: RouteItem[] = [
  // Dashboard
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, domain: 'dashboard' },

  // Delivery
  { id: 'tasks', label: 'Programme & Tasks', icon: CalendarCheck, domain: 'delivery' },
  { id: 'project-detail', label: 'Work Packages', icon: Layers, domain: 'delivery' },
  { id: 'progress', label: 'Progress', icon: TrendingUp, domain: 'delivery' },

  // Site
  { id: 'workforce', label: 'Workforce', icon: Users, domain: 'site' },
  { id: 'inspections', label: 'Quality & Safety', icon: ShieldCheck, domain: 'site' },
  { id: 'updates', label: 'Site Records', icon: ClipboardList, domain: 'site' },
  { id: 'sites', label: 'Logistics & Maps', icon: MapPinned, domain: 'site' },

  // Technical
  { id: 'rfis', label: 'RFIs & Clarifications', icon: HelpCircle, domain: 'technical' },
  { id: 'submittals', label: 'Submittals', icon: FileCheck2, domain: 'technical' },
  { id: 'documents', label: 'Documents & Drawings', icon: FolderKanban, domain: 'technical' },

  // Commercial
  { id: 'boq', label: 'BOQ', icon: FileSpreadsheet, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager'] },
  { id: 'procurement', label: 'Procurement', icon: Package, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager', 'SiteEngineer'] },
  { id: 'change_orders', label: 'Changes & Claims', icon: Receipt, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager'] },

  // Controls
  { id: 'risks', label: 'Risks & Blockers', icon: Flame, domain: 'controls' },
  { id: 'actions', label: 'Actions', icon: ListTodo, domain: 'controls' },
  { id: 'decisions', label: 'Decisions', icon: CheckSquare, domain: 'controls' },

  // Settings
  { id: 'setup-checklist', label: 'Project Setup', icon: CheckSquare, domain: 'settings', allowedRoles: ['Admin', 'ProjectManager'] },
  { id: 'companies', label: 'Companies', icon: Building, domain: 'settings', allowedRoles: ['Admin', 'ProjectManager'] },
  { id: 'users', label: 'Users & Roles', icon: UserCog, domain: 'settings', allowedRoles: ['Admin', 'ProjectManager'] },
  { id: 'audit', label: 'Audit Trail', icon: History, domain: 'settings', allowedRoles: ['Admin'] }
];
