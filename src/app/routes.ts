/**
 * MEP Management Platform — V1.4.1 Consolidated Domain Routes
 * 6 Primary Operational Domains + Settings
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
  AlertOctagon,
  Users,
  MapPin,
  Clock,
  ShieldCheck,
  FileText,
  HelpCircle,
  FolderKanban,
  FileSpreadsheet,
  Coins,
  Package,
  FileCheck,
  ListTodo,
  CheckCircle2,
  Flame,
  Building,
  UserCog,
  History,
  CheckSquare
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
  subcontractorVisible?: boolean;
  clientVisible?: boolean;
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
    description: 'Executive Control Tower, health KPIs and immediate attention items',
    defaultRoute: 'dashboard'
  },
  {
    id: 'delivery',
    label: 'Delivery',
    icon: Truck,
    description: 'Work packages, baseline schedule, task readiness and procurement buffer',
    defaultRoute: 'work-packages'
  },
  {
    id: 'site',
    label: 'Site',
    icon: HardHat,
    description: 'Live field feed, workforce operations, instructions and site quality',
    defaultRoute: 'updates'
  },
  {
    id: 'technical',
    label: 'Technical',
    icon: FileCheck2,
    description: 'Technical coordination, engineering submittals, RFIs and commissioning',
    defaultRoute: 'documents'
  },
  {
    id: 'commercial',
    label: 'Commercial',
    icon: Receipt,
    description: 'Payment claims, variations, procurement commitments and BOQ',
    defaultRoute: 'progress'
  },
  {
    id: 'controls',
    label: 'Controls',
    icon: Sliders,
    description: 'Formal actions, decisions registers and 5x5 risk management',
    defaultRoute: 'actions'
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: SettingsIcon,
    description: 'Tenant configuration, user access, enterprise audit and checklists',
    defaultRoute: 'users',
    allowedRoles: ['Admin', 'ProjectManager']
  }
];

export const ROUTE_ITEMS: RouteItem[] = [
  // Dashboard
  { id: 'dashboard', label: 'Executive Overview', icon: LayoutDashboard, domain: 'dashboard' },

  // Delivery Domain
  { id: 'work-packages', label: 'Work Packages', icon: Layers, domain: 'delivery' },
  { id: 'tasks', label: 'Tasks & Schedule', icon: CalendarCheck, domain: 'delivery' },
  { id: 'procurement-risk', label: 'Procurement Risk', icon: AlertOctagon, domain: 'delivery', allowedRoles: ['Admin', 'ProjectManager', 'SiteEngineer', 'CommercialManager'] },

  // Site Domain
  { id: 'updates', label: 'Live Site Feed', icon: HardHat, domain: 'site' },
  { id: 'workforce', label: 'Workforce Hub', icon: Users, domain: 'site' },
  { id: 'sites', label: 'Project Sites & Geofences', icon: MapPin, domain: 'site' },
  { id: 'workers', label: 'Field Workers', icon: Users, domain: 'site' },
  { id: 'site-instructions', label: 'Site Instructions', icon: FileText, domain: 'site' },
  { id: 'timesheets', label: 'Timesheets & Attendance', icon: Clock, domain: 'site' },
  { id: 'punch-clock', label: 'Punch Clock', icon: Clock, domain: 'site' },
  { id: 'site-quality', label: 'Quality & Safety (NCR / Punch)', icon: ShieldCheck, domain: 'site' },

  // Technical Domain
  { id: 'documents', label: 'Documents & Drawings', icon: FolderKanban, domain: 'technical' },
  { id: 'submittals', label: 'Technical Submittals', icon: FileCheck, domain: 'technical' },
  { id: 'rfis', label: 'Requests for Information (RFIs)', icon: HelpCircle, domain: 'technical' },
  { id: 'clarifications', label: 'Technical Clarifications', icon: HelpCircle, domain: 'technical' },
  { id: 'commissioning', label: 'Commissioning & Handover', icon: CheckCircle2, domain: 'technical' },

  // Commercial Domain
  { id: 'progress', label: 'Progress Claims (IPC)', icon: Coins, domain: 'commercial' },
  { id: 'change_orders', label: 'Change Orders & Variations', icon: FileSpreadsheet, domain: 'commercial' },
  { id: 'boq', label: 'Bill of Quantities (BOQ)', icon: FileSpreadsheet, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager'] },
  { id: 'procurement', label: 'Procurement & Orders', icon: Package, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager'] },
  { id: 'payroll', label: 'Labour Cost & Payroll', icon: Coins, domain: 'commercial', allowedRoles: ['Admin', 'CommercialManager'] },

  // Controls Domain
  { id: 'actions', label: 'Project Actions Register', icon: ListTodo, domain: 'controls' },
  { id: 'decisions', label: 'Project Decisions Register', icon: CheckSquare, domain: 'controls' },
  { id: 'risks', label: 'Risk Register & Heatmap', icon: Flame, domain: 'controls' },

  // Settings Domain
  { id: 'companies', label: 'Companies & Subcontractors', icon: Building, domain: 'settings', allowedRoles: ['Admin', 'ProjectManager'] },
  { id: 'users', label: 'User Directory & Roles', icon: UserCog, domain: 'settings', allowedRoles: ['Admin', 'ProjectManager'] },
  { id: 'audit', label: 'Enterprise Audit Trail', icon: History, domain: 'settings', allowedRoles: ['Admin'] },
  { id: 'setup-checklist', label: 'Project Setup Checklist', icon: CheckSquare, domain: 'settings', allowedRoles: ['Admin', 'ProjectManager'] }
];
