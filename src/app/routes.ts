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
  MessageSquare,
  Briefcase,
  AlertTriangle,
  Clock,
  Wrench,
  Award,
  CheckCircle
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
  // Executive & Portfolio
  { id: 'dashboard', label: 'Executive Control Tower', icon: LayoutDashboard, domain: 'dashboard' },
  { id: 'projects', label: 'Projects Portfolio', icon: Briefcase, domain: 'dashboard' },
  { id: 'project-detail', label: 'Work Packages & WBS', icon: Layers, domain: 'dashboard' },

  // Pillar 1: Commercial & Financial Control
  { id: 'boq', label: 'BOQ & Job Costing', icon: FileSpreadsheet, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager'] },
  { id: 'selections', label: 'Selections & Allowances', icon: Sliders, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager', 'SiteEngineer'] },
  { id: 'procurement', label: 'Procurement & POs', icon: Package, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager', 'SiteEngineer'] },
  { id: 'procurement-risk', label: 'Lead-Time & Supply Risk', icon: Truck, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager', 'SiteEngineer'] },
  { id: 'change_orders', label: 'Variations & Claims', icon: Receipt, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager'] },
  { id: 'payroll', label: 'Payroll & Timesheets', icon: DollarSign, domain: 'commercial', allowedRoles: ['Admin', 'ProjectManager', 'CommercialManager'] },

  // Pillar 2: Field & Site Operations
  { id: 'tasks', label: 'Master Schedule (Gantt)', icon: CalendarCheck, domain: 'delivery' },
  { id: 'messages', label: 'Project Correspondence', icon: MessageSquare, domain: 'delivery', badgeKey: 'unread_messages' },
  { id: 'workforce', label: 'Live Site Attendance', icon: Users, domain: 'delivery' },
  { id: 'workers', label: 'Personnel & Trade Roster', icon: HardHat, domain: 'delivery' },
  { id: 'worker-assignments', label: 'Crew & Site Assignments', icon: Users, domain: 'delivery' },
  { id: 'site-instructions', label: 'Field Directives', icon: ClipboardList, domain: 'delivery' },
  { id: 'punch-clock', label: 'GPS Punch Terminal', icon: Clock, domain: 'delivery' },
  { id: 'attendance-exceptions', label: 'Geofence & OT Exceptions', icon: AlertTriangle, domain: 'delivery' },
  { id: 'shift-templates', label: 'Shift & Roster Templates', icon: Clock, domain: 'delivery' },
  { id: 'leave', label: 'Leave & Absence Calendar', icon: CalendarCheck, domain: 'delivery' },
  { id: 'leave-approvals', label: 'Leave Approval Queue', icon: CheckCircle, domain: 'delivery' },
  { id: 'updates', label: 'Site Daily Logs', icon: ClipboardList, domain: 'delivery' },
  { id: 'progress', label: 'Progress & Milestones', icon: TrendingUp, domain: 'delivery' },
  { id: 'sites', label: 'Site Geofences & Maps', icon: MapPinned, domain: 'delivery' },
  { id: 'equipment', label: 'Plant & Equipment Register', icon: Wrench, domain: 'delivery' },
  { id: 'octo-inbox', label: 'WhatsApp Field Ingestion', icon: ClipboardList, domain: 'delivery', allowedRoles: ['Admin', 'ProjectManager'] },

  // Pillar 3: Technical & Quality Engineering
  { id: 'documents', label: 'Plans & Drawing Studio', icon: FolderKanban, domain: 'technical' },
  { id: 'submittals', label: 'Material Submittals', icon: FileCheck2, domain: 'technical' },
  { id: 'rfis', label: 'RFIs & Clarifications', icon: HelpCircle, domain: 'technical' },
  { id: 'inspections', label: 'QA/QC Inspections (WIR)', icon: ShieldCheck, domain: 'technical' },
  { id: 'ncrs', label: 'Non-Conformance (NCR)', icon: AlertTriangle, domain: 'technical' },
  { id: 'punchlist', label: 'Snagging & Punch List', icon: CheckSquare, domain: 'technical' },
  { id: 'commissioning', label: 'Testing & Commissioning', icon: Award, domain: 'technical' },
  { id: 'handover', label: 'Handover & O&M Dossiers', icon: FileText, domain: 'technical' },

  // Pillar 4: Project Governance & Controls
  { id: 'risks', label: '5x5 Risk Heat Map', icon: Flame, domain: 'controls' },
  { id: 'actions', label: 'Actions Register', icon: ListTodo, domain: 'controls' },
  { id: 'decisions', label: 'Decisions Log', icon: CheckSquare, domain: 'controls' },

  // System Administration
  { id: 'setup-checklist', label: 'Readiness Checklist', icon: CheckSquare, domain: 'settings', allowedRoles: ['Admin', 'ProjectManager'] },
  { id: 'companies', label: 'Company Hierarchy', icon: Building, domain: 'settings', allowedRoles: ['Admin', 'ProjectManager'] },
  { id: 'users', label: 'Users & 8-Role RBAC', icon: UserCog, domain: 'settings', allowedRoles: ['Admin', 'ProjectManager'] },
  { id: 'audit', label: 'Immutable Audit Trail', icon: History, domain: 'settings', allowedRoles: ['Admin'] }
];
