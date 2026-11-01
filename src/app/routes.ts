/**
 * MEP Management Platform — Professional ERP Navigation System
 * Reorganized into 4 Core Enterprise ERP Pillars + Administration:
 * 1. COMMERCIAL & FINANCE (BOQ, Procurement/POs, Variations & Job Costing)
 * 2. FIELD OPERATIONS & DELIVERY (Programme, Work Packages, Workforce/GPS, Site Records, WhatsApp)
 * 3. TECHNICAL & QUALITY (Drawings Studio, Submittals, RFIs, QA/QC Inspections & Handover)
 * 4. PROJECT GOVERNANCE & RISK (Control Tower, Decisions, Actions, Risk Matrix)
 * 5. ENTERPRISE SETTINGS (Projects, Companies, Roles & Audit)
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
  TrendingUp,
  DollarSign,
  MessageSquare
} from 'lucide-react';

export type NavigationDomain =
  | 'dashboard'
  | 'commercial'
  | 'delivery'
  | 'technical'
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
  pillar: string;
  description: string;
  defaultRoute: string;
  allowedRoles?: string[];
}

export const DOMAINS: DomainConfig[] = [
  {
    id: 'dashboard',
    label: 'Overview',
    pillar: 'Executive Cockpit',
    icon: LayoutDashboard,
    description: 'Executive Cockpit, Attention Radar & Key Performance Metrics',
    defaultRoute: 'dashboard'
  },
  {
    id: 'commercial',
    label: 'Commercial & Cost',
    pillar: 'Pillar 1: Financial Control',
    icon: Receipt,
    description: 'BOQ, 6-Column Job Costing, Purchase Orders & Change Variations',
    defaultRoute: 'boq',
    allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager']
  },
  {
    id: 'delivery',
    label: 'Field & Operations',
    pillar: 'Pillar 2: Field Delivery',
    icon: HardHat,
    description: 'Programme Schedule, Work Packages, Mobile Workforce & Site Logs',
    defaultRoute: 'tasks'
  },
  {
    id: 'technical',
    label: 'Technical & Quality',
    pillar: 'Pillar 3: Quality & Engineering',
    icon: FileCheck2,
    description: 'Drawing Redlines, CSI Submittals, RFIs, QA/QC Inspections & Handover',
    defaultRoute: 'documents'
  },
  {
    id: 'controls',
    label: 'Governance & Risk',
    pillar: 'Pillar 4: Project Governance',
    icon: Sliders,
    description: '5x5 Risk Matrix, Actions Register & Governance Decisions',
    defaultRoute: 'risks'
  },
  {
    id: 'settings',
    label: 'Admin & Setup',
    pillar: 'System Configuration',
    icon: SettingsIcon,
    description: 'Project Setup, Company Directory, Role Security & Audit Trail',
    defaultRoute: 'setup-checklist',
    allowedRoles: ['Admin', 'ProjectManager']
  }
];

export const ROUTE_ITEMS: RouteItem[] = [
  // Executive Dashboard
  { id: 'dashboard', label: 'Executive Dashboard', icon: LayoutDashboard, domain: 'dashboard' },

  // Pillar 1: Commercial & Financial Control
  { id: 'boq', label: 'BOQ & Job Costing', icon: FileSpreadsheet, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager'] },
  { id: 'selections', label: 'Selections & Allowances', icon: Sliders, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager', 'SiteEngineer'] },
  { id: 'procurement', label: 'Procurement & POs', icon: Package, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager', 'SiteEngineer'] },
  { id: 'change_orders', label: 'Variations & Claims', icon: Receipt, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager'] },

  // Pillar 2: Field & Site Operations
  { id: 'tasks', label: 'Gantt & Kanban Programme', icon: CalendarCheck, domain: 'delivery' },
  { id: 'messages', label: 'Project Messages', icon: MessageSquare, domain: 'delivery', badgeKey: 'unread_messages' },
  { id: 'project-detail', label: 'Work Packages', icon: Layers, domain: 'delivery' },
  { id: 'progress', label: 'Progress Reports', icon: TrendingUp, domain: 'delivery' },
  { id: 'workforce', label: 'Workforce & Attendance', icon: Users, domain: 'delivery' },
  { id: 'updates', label: 'Site Daily Logs', icon: ClipboardList, domain: 'delivery' },
  { id: 'sites', label: 'Site Logistics & Maps', icon: MapPinned, domain: 'delivery' },
  { id: 'octo-inbox', label: 'WhatsApp Site Inbox', icon: ClipboardList, domain: 'delivery', allowedRoles: ['Admin', 'ProjectManager'] },

  // Pillar 3: Technical & Quality Engineering
  { id: 'documents', label: 'Plans & Drawing Studio', icon: FolderKanban, domain: 'technical' },
  { id: 'submittals', label: 'Material Submittals', icon: FileCheck2, domain: 'technical' },
  { id: 'rfis', label: 'RFIs & Clarifications', icon: HelpCircle, domain: 'technical' },
  { id: 'inspections', label: 'QA/QC Inspections & NCRs', icon: ShieldCheck, domain: 'technical' },

  // Pillar 4: Project Governance & Controls
  { id: 'risks', label: '5x5 Risk Heat Map', icon: Flame, domain: 'controls' },
  { id: 'actions', label: 'Actions Register', icon: ListTodo, domain: 'controls' },
  { id: 'decisions', label: 'Decisions Log', icon: CheckSquare, domain: 'controls' },

  // System Administration
  { id: 'setup-checklist', label: 'Readiness Checklist', icon: CheckSquare, domain: 'settings', allowedRoles: ['Admin', 'ProjectManager'] },
  { id: 'companies', label: 'Company Hierarchy', icon: Building, domain: 'settings', allowedRoles: ['Admin', 'ProjectManager'] },
  { id: 'users', label: 'User Provisioning', icon: UserCog, domain: 'settings', allowedRoles: ['Admin', 'ProjectManager'] },
  { id: 'audit', label: 'Audit Log Trail', icon: History, domain: 'settings', allowedRoles: ['Admin'] }
];
