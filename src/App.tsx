/**
 * MEP Management Platform — Complete SaaS Frontend
 * React 19 + Tailwind CSS + Lucide React
 */
import React, { useState, useEffect, useCallback, createContext, useContext, useRef, type ReactNode, type FormEvent } from 'react';
import {
  Building2, Users, MapPin, ClipboardList, Calendar, Clock, DollarSign,
  BarChart3, Settings, Bell, LogOut, Menu, X, ChevronRight, ChevronDown,
  CheckCircle, AlertCircle, AlertTriangle, XCircle, Timer, Loader2,
  Plus, Edit2, Eye, Lock, RefreshCw, Download, Search, Filter,
  Navigation, Wifi, WifiOff, Camera, FileText, ArrowLeft, Award,
  UserCheck, TrendingUp, Layers, Home, Zap, Shield, Activity,
  BookOpen, Briefcase, MoreVertical, Check, RotateCcw, Send,
  ThumbsUp, ThumbsDown, Coffee, Plane, Stethoscope, Star,
  ChevronLeft, Upload, Map, Cpu, Package, HardHat, Grid,
  PieChart, Sun, Moon, ChevronUp, Pin, Image as ImageIcon, CheckSquare, Folder, Trash2,
  Smartphone
} from 'lucide-react';
import {
  api, authApi, sitesApi, workersApi, workforceApi, attendanceApi,
  instructionsApi, leaveApi, shiftsApi, payrollApi, projectsApi,
  dashboardApi, tasksApi, updatesApi, getToken, setToken, clearToken
} from './api';
import {
  STATUS_COLORS, PRIORITY_COLORS, GEOFENCE_COLORS, INSTRUCTION_TYPES
} from './types';
import { WorkerMobileShell } from './components/WorkerMobileShell';
import { ProjectControlTower } from './components/ProjectControlTower';
import { ProjectMasterOverview } from './components/ProjectMasterOverview';
import { TaskDetailModal } from './components/TaskDetailModal';
import { ProjectActionsRegister } from './components/ProjectActionsRegister';
import { ProjectDecisionsRegister } from './components/ProjectDecisionsRegister';
import { RiskMatrixHeatMapModal } from './components/RiskMatrixHeatMapModal';

// ─── Auth Context ─────────────────────────────────────────────────────────────
interface AuthCtx {
  user: any | null;
  setUser: (u: any) => void;
  logout: () => void;
}
const AuthContext = createContext<AuthCtx>({ user: null, setUser: () => {}, logout: () => {} });
const useAuth = () => useContext(AuthContext);

// ─── Project Context ──────────────────────────────────────────────────────────
interface ProjCtx {
  projects: any[];
  selectedProject: string;
  setSelectedProject: (id: string) => void;
  reload: () => void;
}
const ProjectContext = createContext<ProjCtx>({ projects: [], selectedProject: '', setSelectedProject: () => {}, reload: () => {} });
const useProject = () => useContext(ProjectContext);

// ─── Notification Toast ───────────────────────────────────────────────────────
interface Toast { id: string; type: 'success' | 'error' | 'info'; message: string; }
interface ToastCtx { addToast: (type: Toast['type'], msg: string) => void; }
const ToastContext = createContext<ToastCtx>({ addToast: () => {} });
const useToast = () => useContext(ToastContext);

// ─── Utilities ────────────────────────────────────────────────────────────────
function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function fmt(dateStr?: string, opts?: Intl.DateTimeFormatOptions): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString(undefined, opts || { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return dateStr; }
}

function fmtDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try { return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return dateStr; }
}

function fmtHours(h?: number): string {
  if (h == null || h === 0) return '0h';
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function Badge({ label, color }: { label: string; color?: string }) {
  const cls = color || STATUS_COLORS[label] || 'bg-gray-100 text-gray-600';
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', cls)}>{label}</span>;
}

function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void; key?: any }) {
  return <div onClick={onClick} className={cn('bg-white rounded-2xl shadow-sm border border-gray-100', className)}>{children}</div>;
}

function StatCard({ label, value, icon: Icon, color, sub }: { label: string; value: string | number; icon: any; color: string; sub?: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 mb-1">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <div className={cn('p-3 rounded-xl', color)}>
          <Icon size={20} className="text-white" />
        </div>
      </div>
    </Card>
  );
}

function Spinner({ size = 20 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-blue-600" />;
}

function EmptyState({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <Icon size={48} className="mb-4 opacity-30" />
      <p className="text-lg font-medium text-gray-500">{title}</p>
      {subtitle && <p className="text-sm mt-1">{subtitle}</p>}
    </div>
  );
}

function Modal({ open, onClose, title, children, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  if (!open) return null;
  const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className={cn('bg-white rounded-2xl shadow-2xl w-full overflow-hidden', sizes[size])} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={20} /></button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';
const selectCls = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';
const btnPrimary = 'inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const btnSecondary = 'inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors';
const btnDanger = 'inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-xl hover:bg-red-700 transition-colors';
const btnGreen = 'inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors';

// ─── Login Page ───────────────────────────────────────────────────────────────
function LoginPage() {
  const { setUser } = useAuth();
  const { addToast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { token, user } = await authApi.login(username, password);
      setToken(token);
      setUser(user);
      addToast('success', `Welcome back, ${user.name}!`);
    } catch (err: any) {
      addToast('error', err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-500/20 rounded-3xl mb-4 backdrop-blur border border-blue-400/30">
            <HardHat size={36} className="text-blue-300" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">MEP Management</h1>
          <p className="text-blue-300 mt-2 text-sm">Professional Construction Platform</p>
        </div>
        <Card className="p-8 bg-white/5 backdrop-blur border border-white/10">
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-blue-200 mb-2">Username</label>
              <input className={cn(inputCls, 'bg-white/10 border-white/20 text-white placeholder-blue-300 focus:ring-blue-400')} placeholder="admin" value={username} onChange={e => setUsername(e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-blue-200 mb-2">Password</label>
              <input type="password" className={cn(inputCls, 'bg-white/10 border-white/20 text-white placeholder-blue-300 focus:ring-blue-400')} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <button type="submit" disabled={loading} className={cn(btnPrimary, 'w-full justify-center py-3 bg-blue-500 hover:bg-blue-400 text-base mt-2')}>
              {loading ? <Spinner size={16} /> : <><Shield size={16} />Sign In</>}
            </button>
          </form>
        </Card>
        <p className="text-center text-blue-400/60 text-xs mt-6">MEP Management Platform v1.2 — Enterprise Edition</p>
      </div>
    </div>
  );
}

// ─── Nav Link Component ───────────────────────────────────────────────────────
function NavItem({ icon: Icon, label, active, onClick, badge }: { icon: any; label: string; active?: boolean; onClick: () => void; badge?: number }) {
  return (
    <button onClick={onClick} className={cn(
      'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all',
      active ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    )}>
      <Icon size={18} />
      <span className="flex-1 text-left">{label}</span>
      {badge ? <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">{badge}</span> : null}
    </button>
  );
}

function NavGroup({ icon: Icon, label, children, defaultOpen }: { icon: any; label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-500 uppercase tracking-wider hover:bg-gray-50 transition-all">
        <Icon size={16} />
        <span className="flex-1 text-left">{label}</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && <div className="ml-2 mt-1 space-y-0.5">{children}</div>}
    </div>
  );
}

// ─── Main App Shell ───────────────────────────────────────────────────────────
type Page =
  | 'dashboard' | 'projects' | 'project-detail' | 'tasks' | 'updates'
  | 'actions' | 'decisions'
  | 'rfis' | 'submittals' | 'documents'
  | 'ncrs' | 'inspections' | 'commissioning' | 'handover' | 'progress'
  | 'clarifications' | 'change_orders' | 'boq' | 'procurement' | 'risks'
  | 'punchlist' | 'dailylogs' | 'timesheets' | 'attendance' | 'equipment'
  | 'companies' | 'users' | 'audit'
  // Workforce pages
  | 'workforce' | 'sites' | 'site-detail' | 'site-control'
  | 'workers' | 'worker-profile' | 'worker-assignments'
  | 'site-instructions' | 'instruction-detail'
  | 'leave' | 'leave-approvals' | 'leave-balances'
  | 'attendance-exceptions' | 'shift-templates'
  | 'payroll' | 'payroll-detail'
  | 'punch-clock';

function AppShell() {
  const { user, logout } = useAuth();
  const { projects, selectedProject, setSelectedProject } = useProject();
  const [page, setPage] = useState<Page>('dashboard');
  const [pageParam, setPageParam] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const { addToast } = useToast();

  const navigate = useCallback((p: Page, param?: string) => {
    setPage(p);
    setPageParam(param || '');
    setMobileSidebar(false);
  }, []);

  const role = user?.role || '';
  const isWorkforceRole = ['Admin', 'ProjectManager', 'SiteEngineer', 'SiteSupervisor', 'Worker', 'SafetyOfficer'].includes(role);
  const isPayrollRole = ['Admin', 'CommercialManager', 'ProjectManager'].includes(role);
  const isWorkerOnly = role === 'Worker';
  const isSupervisor = role === 'SiteSupervisor';
  const [workerMobileMode, setWorkerMobileMode] = useState(isWorkerOnly);

  if (isWorkerOnly || workerMobileMode) {
    return (
      <WorkerMobileShell
        onExitMobile={!isWorkerOnly ? () => setWorkerMobileMode(false) : undefined}
        isWorkerOnly={isWorkerOnly}
      />
    );
  }

  const selectedProj = projects.find(p => p.id === selectedProject);

  function renderPage() {
    switch (page) {
      case 'dashboard': return <ProjectDashboardPage navigate={navigate} />;
      case 'projects': return <ProjectsPage navigate={navigate} />;
      case 'project-detail': return <ProjectDetailPage projectId={pageParam} navigate={navigate} />;
      case 'tasks': return <TasksPage navigate={navigate} />;
      case 'actions': return <div className="space-y-6"><ProjectActionsRegister projectId={selectedProject} /></div>;
      case 'decisions': return <div className="space-y-6"><ProjectDecisionsRegister projectId={selectedProject} /></div>;
      case 'updates': return <ProjectUpdatesPage navigate={navigate} />;
      case 'progress': return <ProjectUpdatesPage navigate={navigate} />;
      case 'workforce': return <WorkforceDashboardPage />;
      case 'sites': return <SitesPage navigate={navigate} />;
      case 'site-detail': return <SiteDetailPage siteId={pageParam} navigate={navigate} />;
      case 'site-control': return <SiteControlPage siteId={pageParam} navigate={navigate} />;
      case 'workers': return <WorkersPage navigate={navigate} />;
      case 'worker-profile': return <WorkerProfilePage workerId={pageParam} navigate={navigate} />;
      case 'worker-assignments': return <WorkerAssignmentsPage />;
      case 'site-instructions': return <SiteInstructionsPage navigate={navigate} />;
      case 'instruction-detail': return <InstructionDetailPage instrId={pageParam} navigate={navigate} />;
      case 'leave': return <LeaveCalendarPage />;
      case 'leave-approvals': return <LeaveApprovalsPage />;
      case 'leave-balances': return <LeaveBalancesPage />;
      case 'attendance-exceptions': return <AttendanceExceptionsPage />;
      case 'shift-templates': return <ShiftTemplatesPage />;
      case 'payroll': return <PayrollPeriodsPage navigate={navigate} />;
      case 'payroll-detail': return <PayrollPeriodDetailPage periodId={pageParam} navigate={navigate} />;
      case 'punch-clock': return <PunchClockPage />;
      default: return <GenericPage page={page} />;
    }
  }

  const Sidebar = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-md">
            <HardHat size={18} className="text-white" />
          </div>
          {sidebarOpen && <div><p className="font-bold text-gray-900 text-sm leading-tight">MEP Management</p><p className="text-xs text-gray-400">v1.4.1 Enterprise</p></div>}
        </div>
      </div>

      {/* Project selector */}
      {sidebarOpen && projects.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100">
          <label className="text-xs text-gray-400 font-medium uppercase tracking-wider mb-1 block">Project</label>
          <select className={cn(selectCls, 'text-xs')} value={selectedProject} onChange={e => setSelectedProject(e.target.value)}>
            <option value="">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
        {!isWorkerOnly && <>
          <NavItem icon={Home} label="Dashboard" active={page === 'dashboard'} onClick={() => navigate('dashboard')} />
          <NavItem icon={Briefcase} label="Projects" active={page === 'projects' || page === 'project-detail'} onClick={() => navigate('projects')} />
          <NavItem icon={TrendingUp} label="Project Updates" active={page === 'updates'} onClick={() => navigate('updates')} />
          <NavItem icon={Grid} label="Tasks & Schedule" active={page === 'tasks'} onClick={() => navigate('tasks')} />
          <NavItem icon={AlertCircle} label="Actions Register" active={page === 'actions'} onClick={() => navigate('actions')} />
          <NavItem icon={Shield} label="Decisions Register" active={page === 'decisions'} onClick={() => navigate('decisions')} />
        </>}

        {isWorkerOnly && (
          <NavItem icon={Timer} label="Punch Clock" active={page === 'punch-clock'} onClick={() => navigate('punch-clock')} />
        )}

        {!isWorkerOnly && !isSupervisor && sidebarOpen && (
          <NavGroup icon={Layers} label="Project Execution" defaultOpen={false}>
            <NavItem icon={FileText} label="Documents" active={page === 'documents'} onClick={() => navigate('documents')} />
            <NavItem icon={BookOpen} label="RFIs" active={page === 'rfis'} onClick={() => navigate('rfis')} />
            <NavItem icon={ClipboardList} label="Submittals" active={page === 'submittals'} onClick={() => navigate('submittals')} />
            <NavItem icon={Shield} label="NCRs" active={page === 'ncrs'} onClick={() => navigate('ncrs')} />
            <NavItem icon={CheckCircle} label="Inspections" active={page === 'inspections'} onClick={() => navigate('inspections')} />
            <NavItem icon={Cpu} label="Commissioning" active={page === 'commissioning'} onClick={() => navigate('commissioning')} />
            <NavItem icon={Package} label="Handover" active={page === 'handover'} onClick={() => navigate('handover')} />
            <NavItem icon={MessageSquare} label="Clarifications" active={page === 'clarifications'} onClick={() => navigate('clarifications')} />
            <NavItem icon={TrendingUp} label="Progress Claims" active={page === 'progress'} onClick={() => navigate('progress')} />
          </NavGroup>
        )}

        {isWorkforceRole && sidebarOpen && (
          <NavGroup icon={Users} label="Workforce" defaultOpen={true}>
            {!isWorkerOnly && <NavItem icon={Activity} label="Live Workforce" active={page === 'workforce'} onClick={() => navigate('workforce')} />}
            {!isWorkerOnly && <NavItem icon={MapPin} label="Sites" active={page === 'sites'} onClick={() => navigate('sites')} />}
            {!isWorkerOnly && <NavItem icon={Users} label="Workers" active={page === 'workers'} onClick={() => navigate('workers')} />}
            {(isWorkerOnly || isSupervisor) && <NavItem icon={Timer} label="Punch Clock" active={page === 'punch-clock'} onClick={() => navigate('punch-clock')} />}
            <NavItem icon={ClipboardList} label="Site Instructions" active={page === 'site-instructions'} onClick={() => navigate('site-instructions')} />
            <NavItem icon={Calendar} label="Leave" active={page === 'leave'} onClick={() => navigate('leave')} />
            {!isWorkerOnly && <NavItem icon={UserCheck} label="Leave Approvals" active={page === 'leave-approvals'} onClick={() => navigate('leave-approvals')} />}
            {!isWorkerOnly && <NavItem icon={AlertTriangle} label="Exceptions" active={page === 'attendance-exceptions'} onClick={() => navigate('attendance-exceptions')} />}
            {!isWorkerOnly && !isSupervisor && <NavItem icon={Clock} label="Shift Templates" active={page === 'shift-templates'} onClick={() => navigate('shift-templates')} />}
          </NavGroup>
        )}

        {isPayrollRole && sidebarOpen && (
          <NavGroup icon={DollarSign} label="Payroll">
            <NavItem icon={DollarSign} label="Payroll Periods" active={page === 'payroll'} onClick={() => navigate('payroll')} />
          </NavGroup>
        )}

        {!isWorkerOnly && !isSupervisor && sidebarOpen && (
          <NavGroup icon={Briefcase} label="Commercial">
            <NavItem icon={BarChart3} label="BOQ" active={page === 'boq'} onClick={() => navigate('boq')} />
            <NavItem icon={TrendingUp} label="Change Orders" active={page === 'change_orders'} onClick={() => navigate('change_orders')} />
            <NavItem icon={Package} label="Procurement" active={page === 'procurement'} onClick={() => navigate('procurement')} />
            <NavItem icon={AlertCircle} label="Risks" active={page === 'risks'} onClick={() => navigate('risks')} />
          </NavGroup>
        )}

        {role === 'Admin' && sidebarOpen && (
          <NavGroup icon={Settings} label="Admin">
            <NavItem icon={Users} label="Users" active={page === 'users'} onClick={() => navigate('users')} />
            <NavItem icon={Building2} label="Companies" active={page === 'companies'} onClick={() => navigate('companies')} />
            <NavItem icon={Shield} label="Audit Log" active={page === 'audit'} onClick={() => navigate('audit')} />
          </NavGroup>
        )}
      </nav>

      {/* User info */}
      <div className="border-t border-gray-100 p-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          {sidebarOpen && <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
            <p className="text-xs text-gray-400 truncate">{user?.role}</p>
          </div>}
          <button onClick={logout} className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Desktop sidebar */}
      <div className={cn('hidden lg:flex flex-col bg-white border-r border-gray-100 transition-all duration-300 flex-shrink-0', sidebarOpen ? 'w-64' : 'w-16')}>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="absolute left-0 top-4 ml-1 hidden lg:block z-10">
        </button>
        {Sidebar}
      </div>

      {/* Mobile sidebar overlay */}
      {mobileSidebar && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileSidebar(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-2xl">{Sidebar}</div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-100 px-4 lg:px-6 py-3 flex items-center gap-4 flex-shrink-0">
          <button onClick={() => setMobileSidebar(true)} className="lg:hidden text-gray-500">
            <Menu size={22} />
          </button>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="hidden lg:block text-gray-400 hover:text-gray-600">
            <Menu size={20} />
          </button>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-gray-800 capitalize">{page.replace(/-/g, ' ')}</h2>
            {selectedProj && <p className="text-xs text-gray-400">{selectedProj.name}</p>}
          </div>
          <div className="flex items-center gap-2">
            {!isWorkerOnly && (
              <button
                onClick={() => setWorkerMobileMode(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors border border-blue-200 shadow-sm"
                title="Preview Worker Mobile App"
              >
                <Smartphone size={14} />
                <span className="hidden sm:inline">Worker App</span>
              </button>
            )}
            <button className="text-gray-400 hover:text-blue-600 transition-colors">
              <Bell size={20} />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 lg:p-6">
            {renderPage()}
          </div>
        </main>
      </div>
    </div>
  );
}

// Placeholder icon workaround
const MessageSquare = ({ size }: { size: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;

// ─── Workforce Dashboard ──────────────────────────────────────────────────────
function WorkforceDashboardPage() {
  const { selectedProject } = useProject();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (selectedProject) params.project_id = selectedProject;
      const d = await workforceApi.today(params);
      setData(d);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [selectedProject]);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  if (loading && !data) return <div className="flex justify-center py-20"><Spinner size={32} /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live Workforce</h1>
          <p className="text-gray-500 text-sm mt-0.5">Real-time site presence — {data?.today}</p>
        </div>
        <button onClick={load} className={btnSecondary}><RefreshCw size={14} />Refresh</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Currently On Site" value={data?.present_count || 0} icon={Users} color="bg-blue-500" sub="punched in" />
        <StatCard label="Completed Today" value={data?.completed_count || 0} icon={CheckCircle} color="bg-green-500" sub="punched out" />
        <StatCard label="Geofence Exceptions" value={data?.exceptions?.length || 0} icon={AlertTriangle} color="bg-orange-500" sub="need review" />
        <StatCard label="OT Pending Approval" value={data?.pending_overtime?.length || 0} icon={Clock} color="bg-purple-500" sub="overtime" />
      </div>

      {/* Present workers */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Currently On Site ({data?.present_count || 0})</h3>
          <div className="flex items-center gap-2 text-green-500 text-sm font-medium">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            Live
          </div>
        </div>
        <div className="overflow-x-auto">
          {(!data?.present_workers?.length) ? (
            <EmptyState icon={Users} title="No workers on site" subtitle="Check back when workers punch in" />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-6 py-3">Worker</th>
                  <th className="px-6 py-3">Trade</th>
                  <th className="px-6 py-3">Site</th>
                  <th className="px-6 py-3">Company</th>
                  <th className="px-6 py-3">Punch In</th>
                  <th className="px-6 py-3">Geofence</th>
                  <th className="px-6 py-3">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(data.present_workers as any[]).map(w => {
                  const elapsed = ((Date.now() - new Date(w.punch_in).getTime()) / 3600000).toFixed(1);
                  return (
                    <tr key={w.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 font-medium text-gray-900">{w.worker}</td>
                      <td className="px-6 py-3 text-gray-500">{w.trade || '—'}</td>
                      <td className="px-6 py-3 text-gray-500">{w.site_name || '—'}</td>
                      <td className="px-6 py-3 text-gray-500">{w.company_name || '—'}</td>
                      <td className="px-6 py-3 text-gray-600">{fmt(w.punch_in, { timeStyle: 'short' })}</td>
                      <td className="px-6 py-3">
                        {w.punch_in_geofence_status ? (
                          <span className={cn('text-xs font-medium', GEOFENCE_COLORS[w.punch_in_geofence_status])}>
                            ● {w.punch_in_geofence_status}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-6 py-3 text-gray-600 font-mono">{elapsed}h</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Exceptions */}
      {(data?.exceptions?.length > 0) && (
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-orange-50">
            <h3 className="font-semibold text-orange-800 flex items-center gap-2"><AlertTriangle size={16} />Geofence Exceptions ({data.exceptions.length})</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {(data.exceptions as any[]).map(e => (
              <div key={e.id} className="px-6 py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{e.worker}</p>
                  <p className="text-xs text-gray-400">{e.work_date} • {fmt(e.punch_in, { timeStyle: 'short' })}</p>
                </div>
                <Badge label={e.punch_in_geofence_status || 'Unknown'} color="bg-orange-100 text-orange-700" />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Pending OT */}
      {(data?.pending_overtime?.length > 0) && (
        <Card className="overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800">Pending Overtime Approval ({data.pending_overtime.length})</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {(data.pending_overtime as any[]).map(ot => (
              <OvertimeApprovalRow key={ot.id} record={ot} onRefresh={load} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function OvertimeApprovalRow({ record, onRefresh }: { record: any; onRefresh: () => void; key?: any }) {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(false);

  async function handleAction(action: 'Approved' | 'Rejected') {
    setLoading(true);
    try {
      await attendanceApi.approveOT(record.id, action);
      addToast('success', `Overtime ${action.toLowerCase()}`);
      onRefresh();
    } catch (err: any) { addToast('error', err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="px-6 py-3 flex items-center justify-between">
      <div>
        <p className="font-medium text-gray-900 text-sm">{record.worker_name || record.worker}</p>
        <p className="text-xs text-gray-400">{record.work_date} • OT: {fmtHours(record.overtime_hours)}</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => handleAction('Approved')} disabled={loading} className={btnGreen + ' py-1 text-xs'}><Check size={12} />Approve</button>
        <button onClick={() => handleAction('Rejected')} disabled={loading} className={btnDanger + ' py-1 text-xs'}><X size={12} />Reject</button>
      </div>
    </div>
  );
}

// ─── Punch Clock Page ─────────────────────────────────────────────────────────
function PunchClockPage() {
  const { user } = useAuth();
  const { projects } = useProject();
  const { addToast } = useToast();
  const [activeRecord, setActiveRecord] = useState<any>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [selectedProject, setSelectedProjectLocal] = useState('');
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState('');
  const [attendanceList, setAttendanceList] = useState<any[]>([]);

  useEffect(() => {
    loadAttendance();
    const t = setInterval(() => {
      if (activeRecord) {
        const ms = Date.now() - new Date(activeRecord.punch_in).getTime();
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        setElapsed(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [activeRecord]);

  useEffect(() => {
    if (selectedProject) loadSites(selectedProject);
  }, [selectedProject]);

  async function loadAttendance() {
    try {
      const records = await attendanceApi.list();
      setAttendanceList(records);
      const active = records.find((r: any) => !r.punch_out);
      setActiveRecord(active || null);
    } catch {}
  }

  async function loadSites(projectId: string) {
    try {
      const s = await sitesApi.list(projectId);
      setSites(s);
    } catch {}
  }

  async function getGPS() {
    setGpsLoading(true);
    setGpsError('');
    if (!navigator.geolocation) { setGpsError('Geolocation not supported'); setGpsLoading(false); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); setGpsLoading(false); },
      err => { setGpsError(err.message); setGpsLoading(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function punchIn() {
    setLoading(true);
    try {
      await attendanceApi.punchIn({
        project_id: selectedProject,
        site_id: selectedSite || undefined,
        lat: gps?.lat,
        lng: gps?.lng,
        accuracy: gps?.accuracy,
      });
      addToast('success', 'Punched in successfully!');
      await loadAttendance();
    } catch (err: any) { addToast('error', err.message); }
    finally { setLoading(false); }
  }

  async function punchOut() {
    setLoading(true);
    try {
      await attendanceApi.punchOut({
        lat: gps?.lat,
        lng: gps?.lng,
        accuracy: gps?.accuracy,
      });
      addToast('success', 'Punched out successfully!');
      await loadAttendance();
    } catch (err: any) { addToast('error', err.message); }
    finally { setLoading(false); }
  }

  const geofenceColor = activeRecord?.punch_in_geofence_status
    ? GEOFENCE_COLORS[activeRecord.punch_in_geofence_status] || 'text-gray-400'
    : 'text-gray-400';

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Punch Clock</h1>
        <p className="text-gray-500 text-sm mt-1">{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      {/* Status Card */}
      <Card className="p-8 text-center">
        <div className={cn('w-32 h-32 rounded-full flex items-center justify-center mx-auto mb-6 border-4 transition-all',
          activeRecord ? 'border-green-400 bg-green-50' : 'border-gray-200 bg-gray-50')}>
          <div className="text-center">
            <div className={cn('text-3xl font-bold font-mono', activeRecord ? 'text-green-600' : 'text-gray-400')}>
              {activeRecord ? elapsed || '00:00:00' : '--:--:--'}
            </div>
            <p className={cn('text-xs mt-1 font-medium', activeRecord ? 'text-green-500' : 'text-gray-400')}>
              {activeRecord ? 'ON SITE' : 'OFF SITE'}
            </p>
          </div>
        </div>

        {activeRecord ? (
          <>
            <p className="text-gray-600 text-sm mb-2">Punched in at <strong>{fmt(activeRecord.punch_in, { timeStyle: 'short' })}</strong></p>
            {activeRecord.punch_in_geofence_status && (
              <p className={cn('text-xs font-medium mb-4', geofenceColor)}>
                ● {activeRecord.punch_in_geofence_status}
                {activeRecord.punch_in_distance_m != null && ` (${Math.round(activeRecord.punch_in_distance_m)}m from site)`}
              </p>
            )}
            <div className="mb-4">
              <button onClick={getGPS} disabled={gpsLoading} className={cn(btnSecondary, 'mx-auto text-xs py-1.5')}>
                {gpsLoading ? <Spinner size={12} /> : <Navigation size={12} />}
                {gps ? `GPS: ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : 'Get GPS Location'}
              </button>
            </div>
            <button onClick={punchOut} disabled={loading} className={cn(btnDanger, 'w-full justify-center py-4 text-base font-bold')}>
              {loading ? <Spinner size={18} /> : <><Timer size={18} />PUNCH OUT</>}
            </button>
          </>
        ) : (
          <>
            <div className="space-y-3 mb-6 text-left">
              <FormField label="Project" required>
                <select className={selectCls} value={selectedProject} onChange={e => setSelectedProjectLocal(e.target.value)}>
                  <option value="">Select project...</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </FormField>
              {sites.length > 0 && (
                <FormField label="Site">
                  <select className={selectCls} value={selectedSite} onChange={e => setSelectedSite(e.target.value)}>
                    <option value="">No specific site</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </FormField>
              )}
            </div>
            <div className="mb-4">
              <button onClick={getGPS} disabled={gpsLoading} className={cn(btnSecondary, 'w-full justify-center py-2')}>
                {gpsLoading ? <Spinner size={14} /> : <Navigation size={14} />}
                {gps ? `✓ GPS: ±${Math.round(gps.accuracy)}m accuracy` : 'Get GPS Location (optional)'}
              </button>
              {gpsError && <p className="text-red-500 text-xs mt-1 text-center">{gpsError}</p>}
            </div>
            <button onClick={punchIn} disabled={loading || !selectedProject} className={cn(btnPrimary, 'w-full justify-center py-4 text-base font-bold bg-green-600 hover:bg-green-700')}>
              {loading ? <Spinner size={18} /> : <><Timer size={18} />PUNCH IN</>}
            </button>
          </>
        )}
      </Card>

      {/* Recent attendance */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800 text-sm">Recent Attendance</h3>
        </div>
        <div className="divide-y divide-gray-50">
          {attendanceList.slice(0, 7).map((r: any) => (
            <div key={r.id} className="px-5 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">{fmtDate(r.work_date)}</p>
                <p className="text-xs text-gray-400">
                  {fmt(r.punch_in, { timeStyle: 'short' })}
                  {r.punch_out && ` → ${fmt(r.punch_out, { timeStyle: 'short' })}`}
                  {r.regular_hours != null && ` • ${fmtHours(r.regular_hours)} regular`}
                  {r.overtime_hours > 0 && ` + ${fmtHours(r.overtime_hours)} OT`}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge label={r.status} />
                {r.ot_status && r.ot_status !== 'None' && <Badge label={`OT: ${r.ot_status}`} />}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ─── Sites Page ───────────────────────────────────────────────────────────────
function SitesPage({ navigate }: { navigate: (p: Page, param?: string) => void }) {
  const { selectedProject } = useProject();
  const { addToast } = useToast();
  const [sites, setSites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', city: '', country: '', latitude: '', longitude: '', geofence_radius_m: '100', geofence_warning_radius_m: '150', timezone: 'UTC' });

  const load = useCallback(async () => {
    setLoading(true);
    try { setSites(await sitesApi.list(selectedProject || undefined)); }
    catch {} finally { setLoading(false); }
  }, [selectedProject]);

  useEffect(() => { load(); }, [load]);

  async function createSite(e: FormEvent) {
    e.preventDefault();
    try {
      await sitesApi.create({ ...form, project_id: selectedProject, latitude: form.latitude ? parseFloat(form.latitude) : null, longitude: form.longitude ? parseFloat(form.longitude) : null, geofence_radius_m: parseFloat(form.geofence_radius_m), geofence_warning_radius_m: parseFloat(form.geofence_warning_radius_m) });
      addToast('success', 'Site created');
      setShowCreate(false);
      load();
    } catch (err: any) { addToast('error', err.message); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Sites</h1>
        <button onClick={() => setShowCreate(true)} className={btnPrimary}><Plus size={16} />New Site</button>
      </div>
      {loading ? <div className="flex justify-center py-20"><Spinner size={32} /></div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sites.map(s => (
            <Card key={s.id} className="p-5 hover:shadow-md transition-shadow cursor-pointer" onClick={() => navigate('site-control', s.id)}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center"><MapPin size={18} className="text-blue-600" /></div>
                <Badge label={s.status} />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">{s.name}</h3>
              <p className="text-sm text-gray-500 mb-3">{[s.address, s.city, s.country].filter(Boolean).join(', ') || 'No address'}</p>
              {s.latitude && <p className="text-xs text-gray-400 font-mono">{s.latitude.toFixed(4)}, {s.longitude?.toFixed(4)}</p>}
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                <p className="text-xs text-gray-400">Geofence: {s.geofence_radius_m}m</p>
                <button onClick={e => { e.stopPropagation(); navigate('site-control', s.id); }} className="text-xs text-blue-600 hover:underline">Site Control →</button>
              </div>
            </Card>
          ))}
          {!sites.length && <EmptyState icon={MapPin} title="No sites yet" subtitle="Create your first construction site" />}
        </div>
      )}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Site">
        <form onSubmit={createSite} className="space-y-4">
          <FormField label="Site Name" required><input className={inputCls} value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></FormField>
          <FormField label="Address"><input className={inputCls} value={form.address} onChange={e => setForm({...form, address: e.target.value})} /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="City"><input className={inputCls} value={form.city} onChange={e => setForm({...form, city: e.target.value})} /></FormField>
            <FormField label="Country"><input className={inputCls} value={form.country} onChange={e => setForm({...form, country: e.target.value})} /></FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Latitude"><input type="number" step="any" className={inputCls} value={form.latitude} onChange={e => setForm({...form, latitude: e.target.value})} placeholder="25.2048" /></FormField>
            <FormField label="Longitude"><input type="number" step="any" className={inputCls} value={form.longitude} onChange={e => setForm({...form, longitude: e.target.value})} placeholder="55.2708" /></FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Geofence Radius (m)"><input type="number" className={inputCls} value={form.geofence_radius_m} onChange={e => setForm({...form, geofence_radius_m: e.target.value})} /></FormField>
            <FormField label="Warning Radius (m)"><input type="number" className={inputCls} value={form.geofence_warning_radius_m} onChange={e => setForm({...form, geofence_warning_radius_m: e.target.value})} /></FormField>
          </div>
          <FormField label="Timezone"><input className={inputCls} value={form.timezone} onChange={e => setForm({...form, timezone: e.target.value})} /></FormField>
          <div className="flex gap-3 pt-2">
            <button type="submit" className={btnPrimary}>Create Site</button>
            <button type="button" onClick={() => setShowCreate(false)} className={btnSecondary}>Cancel</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ─── Site Detail Page ─────────────────────────────────────────────────────────
function SiteDetailPage({ siteId, navigate }: { siteId: string; navigate: (p: Page, param?: string) => void }) {
  const [site, setSite] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { sitesApi.get(siteId).then(setSite).catch(() => {}).finally(() => setLoading(false)); }, [siteId]);
  if (loading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>;
  if (!site) return <EmptyState icon={MapPin} title="Site not found" />;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('sites')} className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></button>
        <h1 className="text-2xl font-bold text-gray-900">{site.name}</h1>
        <Badge label={site.status} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-semibold text-gray-800 mb-3">Location Details</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Address</span><span>{site.address || '—'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">City</span><span>{site.city || '—'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Country</span><span>{site.country || '—'}</span></div>
            {site.latitude && <div className="flex justify-between"><span className="text-gray-500">GPS</span><span className="font-mono text-xs">{site.latitude?.toFixed(5)}, {site.longitude?.toFixed(5)}</span></div>}
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold text-gray-800 mb-3">Geofence Config</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Valid Radius</span><span className="text-green-600 font-medium">{site.geofence_radius_m}m</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Warning Radius</span><span className="text-yellow-600 font-medium">{site.geofence_warning_radius_m}m</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Outside (&gt;{site.geofence_warning_radius_m}m)</span><span className="text-red-600 font-medium">Flagged</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Timezone</span><span>{site.timezone}</span></div>
          </div>
        </Card>
      </div>
      <button onClick={() => navigate('site-control', siteId)} className={cn(btnPrimary, 'w-full justify-center py-3')}><Activity size={16} />Open Site Control</button>
    </div>
  );
}

// ─── Site Control Page ────────────────────────────────────────────────────────
function SiteControlPage({ siteId, navigate }: { siteId: string; navigate: (p: Page, param?: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await sitesApi.control(siteId)); }
    catch {} finally { setLoading(false); }
  }, [siteId]);
  useEffect(() => { load(); }, [load]);
  if (loading && !data) return <div className="flex justify-center py-20"><Spinner size={32} /></div>;
  const site = data?.site;
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('sites')} className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Site Control — {site?.name}</h1>
          <p className="text-sm text-gray-500">{data?.today}</p>
        </div>
        <button onClick={load} className={cn(btnSecondary, 'ml-auto')}><RefreshCw size={14} /></button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="On Site Now" value={data?.present_workers?.length || 0} icon={Users} color="bg-blue-500" />
        <StatCard label="Total Today" value={data?.today_attendance?.length || 0} icon={Activity} color="bg-green-500" />
        <StatCard label="Open Instructions" value={data?.open_instructions?.length || 0} icon={ClipboardList} color="bg-orange-500" />
        <StatCard label="Pending Leave" value={data?.pending_leave?.length || 0} icon={Calendar} color="bg-purple-500" />
      </div>
      {/* Present Workers */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <h3 className="font-semibold text-gray-800">On Site Now ({data?.present_workers?.length || 0})</h3>
        </div>
        {(!data?.present_workers?.length) ? (
          <EmptyState icon={Users} title="No workers on site" />
        ) : (
          <div className="divide-y divide-gray-50">
            {(data.present_workers as any[]).map((w: any) => (
              <div key={w.id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm text-gray-900">{w.worker}</p>
                  <p className="text-xs text-gray-400">{w.trade || '—'} • {fmt(w.punch_in, { timeStyle: 'short' })}</p>
                </div>
                {w.punch_in_geofence_status && <Badge label={w.punch_in_geofence_status} color={w.punch_in_geofence_status === 'Valid' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'} />}
              </div>
            ))}
          </div>
        )}
      </Card>
      {/* Open Instructions */}
      {(data?.open_instructions?.length > 0) && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100"><h3 className="font-semibold text-gray-800">Open Instructions ({data.open_instructions.length})</h3></div>
          <div className="divide-y divide-gray-50">
            {(data.open_instructions as any[]).slice(0, 5).map((i: any) => (
              <div key={i.id} className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50" onClick={() => navigate('instruction-detail', i.id)}>
                <div>
                  <p className="text-sm font-medium text-gray-900">{i.instruction_number} — {i.title}</p>
                  <p className="text-xs text-gray-400">{i.instruction_type} • {i.assigned_worker_name || 'Unassigned'}</p>
                </div>
                <div className="flex gap-2">
                  <Badge label={i.priority} color={PRIORITY_COLORS[i.priority]} />
                  <Badge label={i.status} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Workers Page ─────────────────────────────────────────────────────────────
function WorkersPage({ navigate }: { navigate: (p: Page, param?: string) => void }) {
  const { selectedProject } = useProject();
  const { addToast } = useToast();
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', trade: '', employment_type: 'Permanent', nationality: '', phone: '', email: '', company_id: '', employee_id: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string,string> = {};
      if (selectedProject) params.project_id = selectedProject;
      setWorkers(await workersApi.list(params));
    } catch {} finally { setLoading(false); }
  }, [selectedProject]);

  useEffect(() => { load(); }, [load]);

  const filtered = workers.filter(w => !search || w.name.toLowerCase().includes(search.toLowerCase()) || (w.trade||'').toLowerCase().includes(search.toLowerCase()));

  async function createWorker(e: FormEvent) {
    e.preventDefault();
    try {
      await workersApi.create({ ...form, project_id: selectedProject });
      addToast('success', 'Worker created');
      setShowCreate(false);
      load();
    } catch (err: any) { addToast('error', err.message); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Workers</h1>
        <button onClick={() => setShowCreate(true)} className={btnPrimary}><Plus size={16} />Add Worker</button>
      </div>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className={cn(inputCls, 'pl-9')} placeholder="Search workers..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {loading ? <div className="flex justify-center py-20"><Spinner size={32} /></div> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Employee ID</th>
                  <th className="px-5 py-3">Trade</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Company</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(w => (
                  <tr key={w.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate('worker-profile', w.id)}>
                    <td className="px-5 py-3 font-medium text-gray-900">{w.name}</td>
                    <td className="px-5 py-3 text-gray-500 font-mono">{w.employee_id || '—'}</td>
                    <td className="px-5 py-3 text-gray-500">{w.trade || '—'}</td>
                    <td className="px-5 py-3 text-gray-500">{w.employment_type}</td>
                    <td className="px-5 py-3 text-gray-500">{w.company_name || '—'}</td>
                    <td className="px-5 py-3"><Badge label={w.status} /></td>
                    <td className="px-5 py-3"><ChevronRight size={16} className="text-gray-300" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && <EmptyState icon={Users} title="No workers found" />}
          </div>
        </Card>
      )}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Worker">
        <form onSubmit={createWorker} className="space-y-3">
          <FormField label="Full Name" required><input className={inputCls} value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Employee ID"><input className={inputCls} value={form.employee_id} onChange={e => setForm({...form, employee_id: e.target.value})} /></FormField>
            <FormField label="Trade"><input className={inputCls} value={form.trade} onChange={e => setForm({...form, trade: e.target.value})} placeholder="Electrician, Plumber..." /></FormField>
          </div>
          <FormField label="Employment Type">
            <select className={selectCls} value={form.employment_type} onChange={e => setForm({...form, employment_type: e.target.value})}>
              {['Permanent','Contract','Daily','Temporary'].map(t => <option key={t}>{t}</option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Phone"><input className={inputCls} value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></FormField>
            <FormField label="Nationality"><input className={inputCls} value={form.nationality} onChange={e => setForm({...form, nationality: e.target.value})} /></FormField>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className={btnPrimary}>Add Worker</button>
            <button type="button" onClick={() => setShowCreate(false)} className={btnSecondary}>Cancel</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ─── Worker Profile Page ──────────────────────────────────────────────────────
function WorkerProfilePage({ workerId, navigate }: { workerId: string; navigate: (p: Page, param?: string) => void }) {
  const [profile, setProfile] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    workersApi.profile(workerId).then(setProfile).catch(() => {}).finally(() => setLoading(false));
  }, [workerId]);

  if (loading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>;
  if (!profile) return <EmptyState icon={Users} title="Worker not found" />;

  const w = profile.worker;
  const tabs = ['overview', 'tasks', 'instructions', 'attendance', 'leave', 'payroll'];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('workers')} className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{w.name}</h1>
          <p className="text-gray-500 text-sm">{w.trade || '—'} · {w.employment_type} · {w.company_name || 'No company'}</p>
        </div>
        <Badge label={w.status} />
      </div>
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {tabs.map(t => (
          <button key={t} onClick={() => setActiveTab(t)} className={cn('flex-1 min-w-max px-3 py-2 rounded-lg text-sm font-medium capitalize transition-all', activeTab === t ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700')}>
            {t}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-5">
            <h3 className="font-semibold text-gray-800 mb-3">Personal Info</h3>
            <div className="space-y-2 text-sm">
              {[['Employee ID', w.employee_id], ['Phone', w.phone], ['Email', w.email], ['Nationality', w.nationality], ['Hired Date', fmtDate(w.hired_date)]].map(([label, val]) => (
                <div key={label as string} className="flex justify-between"><span className="text-gray-500">{label}</span><span>{val || '—'}</span></div>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="font-semibold text-gray-800 mb-3">Assignment</h3>
            <div className="space-y-2 text-sm">
              {[['Project', w.project_id], ['Site', w.site_id], ['Work Package', w.work_package_id], ['Supervisor', w.supervisor_id]].map(([label, val]) => (
                <div key={label as string} className="flex justify-between"><span className="text-gray-500">{label}</span><span className="text-gray-400">{val || '—'}</span></div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {activeTab === 'tasks' && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-5 py-3">Title</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(profile.tasks as any[]).map((t: any) => (
                  <tr key={t.id}>
                    <td className="px-5 py-3">{t.title}</td>
                    <td className="px-5 py-3"><Badge label={t.status} /></td>
                    <td className="px-5 py-3">{t.progress || 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!profile.tasks?.length && <EmptyState icon={Grid} title="No tasks assigned" />}
          </div>
        </Card>
      )}

      {activeTab === 'instructions' && (
        <Card className="overflow-hidden">
          {(!profile.instructions?.length) ? <EmptyState icon={ClipboardList} title="No instructions" /> : (
            <div className="divide-y divide-gray-50">
              {(profile.instructions as any[]).map((i: any) => (
                <div key={i.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{i.instruction_number} — {i.title}</p>
                    <p className="text-xs text-gray-400">{i.instruction_type} • {fmtDate(i.created_at)}</p>
                  </div>
                  <Badge label={i.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'attendance' && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-5 py-3">Date</th><th className="px-5 py-3">In</th><th className="px-5 py-3">Out</th><th className="px-5 py-3">Regular</th><th className="px-5 py-3">OT</th><th className="px-5 py-3">Geofence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(profile.attendance as any[]).map((a: any) => (
                  <tr key={a.id}>
                    <td className="px-5 py-3">{fmtDate(a.work_date)}</td>
                    <td className="px-5 py-3">{fmt(a.punch_in, { timeStyle: 'short' })}</td>
                    <td className="px-5 py-3">{a.punch_out ? fmt(a.punch_out, { timeStyle: 'short' }) : '—'}</td>
                    <td className="px-5 py-3">{fmtHours(a.regular_hours)}</td>
                    <td className="px-5 py-3">{a.overtime_hours > 0 ? fmtHours(a.overtime_hours) : '—'}</td>
                    <td className="px-5 py-3">{a.punch_in_geofence_status ? <span className={cn('text-xs', GEOFENCE_COLORS[a.punch_in_geofence_status])}>●&nbsp;{a.punch_in_geofence_status}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!profile.attendance?.length && <EmptyState icon={Clock} title="No attendance records" />}
          </div>
        </Card>
      )}

      {activeTab === 'leave' && (
        <Card className="overflow-hidden">
          {(!profile.leave_requests?.length) ? <EmptyState icon={Calendar} title="No leave requests" /> : (
            <div className="divide-y divide-gray-50">
              {(profile.leave_requests as any[]).map((lr: any) => (
                <div key={lr.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{lr.leave_type_name}</p>
                    <p className="text-xs text-gray-400">{fmtDate(lr.start_date)} – {fmtDate(lr.end_date)} ({lr.days_requested} days)</p>
                  </div>
                  <Badge label={lr.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === 'payroll' && (
        <Card className="overflow-hidden">
          {(!profile.payroll_entries?.length) ? <EmptyState icon={DollarSign} title="No payroll entries" subtitle="Access restricted to Admin and Finance" /> : (
            <div className="divide-y divide-gray-50">
              {(profile.payroll_entries as any[]).map((pe: any) => (
                <div key={pe.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{pe.period_name}</p>
                    <p className="text-xs text-gray-400">{fmtDate(pe.period_start)} – {fmtDate(pe.period_end)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-gray-900">{pe.currency} {pe.net_pay?.toLocaleString()}</p>
                    <p className="text-xs text-gray-400">{fmtHours(pe.regular_hours)} reg + {fmtHours(pe.overtime_hours)} OT</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Worker Assignments Page ──────────────────────────────────────────────────
function WorkerAssignmentsPage() {
  const { selectedProject } = useProject();
  const { addToast } = useToast();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ worker_id: '', project_id: selectedProject, site_id: '', work_package_id: '', role_on_site: '', start_date: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try { setAssignments(await api.get<any[]>(`/api/worker_assignments${selectedProject ? `?project_id=${selectedProject}` : ''}`)); }
    catch {} finally { setLoading(false); }
  }, [selectedProject]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Worker Assignments</h1>
        <button onClick={() => setShowCreate(true)} className={btnPrimary}><Plus size={16} />New Assignment</button>
      </div>
      {loading ? <div className="flex justify-center py-20"><Spinner size={32} /></div> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-5 py-3">Worker</th><th className="px-5 py-3">Trade</th><th className="px-5 py-3">Site</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Start Date</th><th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {assignments.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{a.worker_name || a.worker_id}</td>
                    <td className="px-5 py-3 text-gray-500">{a.trade || '—'}</td>
                    <td className="px-5 py-3 text-gray-500">{a.site_name || '—'}</td>
                    <td className="px-5 py-3 text-gray-500">{a.role_on_site || '—'}</td>
                    <td className="px-5 py-3 text-gray-500">{fmtDate(a.start_date)}</td>
                    <td className="px-5 py-3"><Badge label={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!assignments.length && <EmptyState icon={Users} title="No assignments yet" />}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Site Instructions Page ───────────────────────────────────────────────────
function SiteInstructionsPage({ navigate }: { navigate: (p: Page, param?: string) => void }) {
  const { selectedProject } = useProject();
  const { addToast } = useToast();
  const [instructions, setInstructions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', instruction_type: 'General', description: '', priority: 'Medium', due_date: '', location: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string,string> = {};
      if (selectedProject) params.project_id = selectedProject;
      setInstructions(await instructionsApi.list(params));
    } catch {} finally { setLoading(false); }
  }, [selectedProject]);

  useEffect(() => { load(); }, [load]);

  const filtered = instructions.filter(i =>
    (!search || i.title.toLowerCase().includes(search.toLowerCase()) || i.instruction_number?.includes(search)) &&
    (!filterStatus || i.status === filterStatus) &&
    (!filterType || i.instruction_type === filterType)
  );

  async function createInstruction(e: FormEvent) {
    e.preventDefault();
    try {
      await instructionsApi.create({ ...form, project_id: selectedProject });
      addToast('success', 'Instruction created');
      setShowCreate(false);
      load();
    } catch (err: any) { addToast('error', err.message); }
  }

  const statusCounts = instructions.reduce((acc, i) => { acc[i.status] = (acc[i.status] || 0) + 1; return acc; }, {} as Record<string,number>);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Site Instructions</h1>
        <button onClick={() => setShowCreate(true)} className={btnPrimary}><Plus size={16} />New Instruction</button>
      </div>
      {/* Status summary chips */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(statusCounts).map(([status, count]) => (
          <button key={status} onClick={() => setFilterStatus(filterStatus === status ? '' : status)}
            className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition-all', filterStatus === status ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300')}>
            {status} <span className="ml-1 font-bold">{count as number}</span>
          </button>
        ))}
      </div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className={cn(inputCls, 'pl-9')} placeholder="Search instructions..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className={cn(selectCls, 'w-auto min-w-36')} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {INSTRUCTION_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
      </div>

      {loading ? <div className="flex justify-center py-20"><Spinner size={32} /></div> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-5 py-3">Number</th><th className="px-5 py-3">Title</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Assigned To</th><th className="px-5 py-3">Priority</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(i => (
                  <tr key={i.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate('instruction-detail', i.id)}>
                    <td className="px-5 py-3 font-mono text-gray-500 text-xs">{i.instruction_number}</td>
                    <td className="px-5 py-3 font-medium text-gray-900">{i.title}</td>
                    <td className="px-5 py-3 text-gray-500">{i.instruction_type}</td>
                    <td className="px-5 py-3 text-gray-500">{i.assigned_worker_name || <span className="text-gray-300 italic">Unassigned</span>}</td>
                    <td className="px-5 py-3"><Badge label={i.priority} color={PRIORITY_COLORS[i.priority]} /></td>
                    <td className="px-5 py-3"><Badge label={i.status} /></td>
                    <td className="px-5 py-3 text-gray-400 text-xs">{i.due_date ? fmtDate(i.due_date) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && <EmptyState icon={ClipboardList} title="No instructions found" />}
          </div>
        </Card>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Site Instruction" size="lg">
        <form onSubmit={createInstruction} className="space-y-4">
          <FormField label="Title" required><input className={inputCls} value={form.title} onChange={e => setForm({...form, title: e.target.value})} required /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type" required>
              <select className={selectCls} value={form.instruction_type} onChange={e => setForm({...form, instruction_type: e.target.value})}>
                {INSTRUCTION_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </FormField>
            <FormField label="Priority">
              <select className={selectCls} value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}>
                {['Critical','High','Medium','Low'].map(p => <option key={p}>{p}</option>)}
              </select>
            </FormField>
          </div>
          <FormField label="Description"><textarea className={cn(inputCls, 'h-24 resize-none')} value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Due Date"><input type="date" className={inputCls} value={form.due_date} onChange={e => setForm({...form, due_date: e.target.value})} /></FormField>
            <FormField label="Location"><input className={inputCls} value={form.location} onChange={e => setForm({...form, location: e.target.value})} placeholder="Level 3, Zone B..." /></FormField>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className={btnPrimary}>Create Instruction</button>
            <button type="button" onClick={() => setShowCreate(false)} className={btnSecondary}>Cancel</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ─── Instruction Detail Page ──────────────────────────────────────────────────
function InstructionDetailPage({ instrId, navigate }: { instrId: string; navigate: (p: Page, param?: string) => void }) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [instr, setInstr] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setInstr(await instructionsApi.get(instrId)); }
    catch {} finally { setLoading(false); }
  }, [instrId]);

  useEffect(() => { load(); }, [load]);

  const role = user?.role || '';
  const isWorker = role === 'Worker';
  const canVerify = ['Admin','ProjectManager','SiteEngineer','SiteSupervisor'].includes(role);

  async function action(fn: () => Promise<any>) {
    setActionLoading(true);
    try { await fn(); addToast('success', 'Done'); await load(); }
    catch (err: any) { addToast('error', err.message); }
    finally { setActionLoading(false); }
  }

  async function addComment() {
    if (!comment.trim()) return;
    await action(() => instructionsApi.addUpdate(instrId, comment));
    setComment('');
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>;
  if (!instr) return <EmptyState icon={ClipboardList} title="Instruction not found" />;

  const FSM_ACTIONS: Record<string, { label: string; icon: any; fn: () => Promise<any>; color: string }[]> = {
    Assigned: isWorker ? [{ label: 'Acknowledge', icon: Check, fn: () => instructionsApi.acknowledge(instrId), color: btnPrimary }] : [],
    Acknowledged: isWorker ? [{ label: 'Start Work', icon: Zap, fn: () => instructionsApi.start(instrId), color: btnGreen }] : [],
    'In Progress': isWorker ? [{ label: 'Submit Evidence', icon: Upload, fn: () => instructionsApi.submitEvidence(instrId, { comment }), color: btnPrimary }] : [],
    'Ready for Verification': canVerify ? [
      { label: 'Verify', icon: CheckCircle, fn: () => instructionsApi.verify(instrId, 'Verified', comment), color: btnGreen },
      { label: 'Reject Back', icon: RotateCcw, fn: () => instructionsApi.verify(instrId, 'In Progress', comment), color: btnDanger },
    ] : [],
    Verified: canVerify ? [{ label: 'Close', icon: Lock, fn: () => instructionsApi.close(instrId, comment), color: btnPrimary }] : [],
  };

  const actions = FSM_ACTIONS[instr.status] || [];

  const STATUS_ORDER = ['Draft','Assigned','Acknowledged','In Progress','Ready for Verification','Verified','Closed'];
  const currentIdx = STATUS_ORDER.indexOf(instr.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('site-instructions')} className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></button>
        <div className="flex-1">
          <p className="text-xs text-gray-400 font-mono">{instr.instruction_number}</p>
          <h1 className="text-xl font-bold text-gray-900">{instr.title}</h1>
        </div>
        <div className="flex gap-2">
          <Badge label={instr.priority} color={PRIORITY_COLORS[instr.priority]} />
          <Badge label={instr.status} />
        </div>
      </div>

      {/* Progress stepper */}
      <Card className="p-5">
        <div className="flex items-center justify-between overflow-x-auto gap-1">
          {STATUS_ORDER.map((s, idx) => (
            <div key={s} className="flex items-center min-w-0">
              <div className={cn('flex flex-col items-center text-center', idx <= currentIdx ? 'text-blue-600' : 'text-gray-300')}>
                <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold', idx < currentIdx ? 'bg-blue-600 text-white' : idx === currentIdx ? 'border-2 border-blue-600 text-blue-600' : 'border-2 border-gray-200 text-gray-300')}>
                  {idx < currentIdx ? <Check size={14} /> : idx + 1}
                </div>
                <p className="text-xs mt-1 whitespace-nowrap hidden sm:block">{s}</p>
              </div>
              {idx < STATUS_ORDER.length - 1 && <div className={cn('h-0.5 flex-1 mx-1 min-w-4', idx < currentIdx ? 'bg-blue-600' : 'bg-gray-200')} />}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main details */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-5">
            <h3 className="font-semibold text-gray-800 mb-3">Details</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Type</span><span>{instr.instruction_type}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Site</span><span>{instr.site_name || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Location</span><span>{instr.location || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Due Date</span><span className={instr.due_date && instr.due_date < new Date().toISOString().split('T')[0] ? 'text-red-600 font-medium' : ''}>{fmtDate(instr.due_date)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Assigned Worker</span><span>{instr.assigned_worker_name || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Issued By</span><span>{instr.issued_by || '—'}</span></div>
            </div>
            {instr.description && <div className="mt-4 pt-4 border-t border-gray-100"><p className="text-sm text-gray-700 whitespace-pre-wrap">{instr.description}</p></div>}
          </Card>

          {/* Action buttons */}
          {actions.length > 0 && (
            <Card className="p-5">
              <h3 className="font-semibold text-gray-800 mb-3">Actions</h3>
              <textarea className={cn(inputCls, 'h-20 resize-none mb-3')} placeholder="Add a comment (optional)..." value={comment} onChange={e => setComment(e.target.value)} />
              <div className="flex flex-wrap gap-3">
                {actions.map(a => (
                  <button key={a.label} onClick={() => action(a.fn)} disabled={actionLoading} className={a.color}>
                    {actionLoading ? <Spinner size={14} /> : <a.icon size={14} />}{a.label}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Timeline */}
          <Card className="p-5">
            <h3 className="font-semibold text-gray-800 mb-4">Timeline</h3>
            <div className="space-y-4">
              {(instr.updates as any[] || []).map((u: any) => (
                <div key={u.id} className="flex gap-3">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-gray-500">
                    {u.user_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-900">{u.user_name}</span>
                      <Badge label={u.update_type} color="bg-gray-100 text-gray-500" />
                      {u.new_status && <span className="text-xs text-gray-400">→ {u.new_status}</span>}
                    </div>
                    <p className="text-sm text-gray-600">{u.content}</p>
                    <p className="text-xs text-gray-400 mt-1">{fmt(u.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
            {/* Add comment */}
            <div className="mt-4 pt-4 border-t border-gray-100 flex gap-3">
              <input className={cn(inputCls, 'flex-1')} placeholder="Add a comment..." value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => e.key === 'Enter' && addComment()} />
              <button onClick={addComment} className={btnPrimary}><Send size={14} /></button>
            </div>
          </Card>
        </div>

        {/* Sidebar info */}
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="font-semibold text-gray-800 mb-3">Timeline</h3>
            <div className="space-y-2 text-xs text-gray-500">
              {[['Issued', instr.issued_at], ['Acknowledged', instr.acknowledged_at], ['Started', instr.started_at], ['Evidence', instr.evidence_submitted_at], ['Verified', instr.verified_at], ['Closed', instr.closed_at]].filter(([,v]) => v).map(([l, v]) => (
                <div key={l as string} className="flex justify-between">
                  <span className="text-gray-400">{l}</span>
                  <span>{fmt(v as string, { dateStyle: 'short', timeStyle: 'short' })}</span>
                </div>
              ))}
            </div>
          </Card>
          {instr.attachments?.length > 0 && (
            <Card className="p-5">
              <h3 className="font-semibold text-gray-800 mb-3">Attachments ({instr.attachments.length})</h3>
              <div className="space-y-2">
                {(instr.attachments as any[]).map((a: any) => (
                  <div key={a.id} className="flex items-center gap-2 text-sm text-blue-600">
                    <Camera size={14} />
                    <span className="truncate">{a.attachment_name || 'Attachment'}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Leave Calendar Page ──────────────────────────────────────────────────────
function LeaveCalendarPage() {
  const { selectedProject } = useProject();
  const { addToast } = useToast();
  const [leaves, setLeaves] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ leave_type_id: '', start_date: '', end_date: '', reason: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string,string> = {};
      if (selectedProject) params.project_id = selectedProject;
      const [l, t, b] = await Promise.all([leaveApi.list(params), leaveApi.types(), leaveApi.balances()]);
      setLeaves(l); setTypes(t); setBalances(b);
    } catch {} finally { setLoading(false); }
  }, [selectedProject]);

  useEffect(() => { load(); }, [load]);

  async function submitLeave(e: FormEvent) {
    e.preventDefault();
    try {
      await leaveApi.submit({ ...form, project_id: selectedProject });
      addToast('success', 'Leave request submitted');
      setShowCreate(false); load();
    } catch (err: any) { addToast('error', err.message); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Leave</h1>
        <button onClick={() => setShowCreate(true)} className={btnPrimary}><Plus size={16} />Request Leave</button>
      </div>
      {/* Balances */}
      {balances.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {balances.map(b => (
            <Card key={b.id} className="p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">{b.leave_type_name}</p>
              <p className="text-2xl font-bold text-gray-900">{b.balance_days ?? b.entitlement_days - b.taken_days}</p>
              <p className="text-xs text-gray-400">days left</p>
            </Card>
          ))}
        </div>
      )}
      {loading ? <div className="flex justify-center py-10"><Spinner size={28} /></div> : (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">My Leave Requests</h3>
          </div>
          {!leaves.length ? <EmptyState icon={Calendar} title="No leave requests" /> : (
            <div className="divide-y divide-gray-50">
              {leaves.map(lr => (
                <div key={lr.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{lr.leave_type_name}</p>
                    <p className="text-xs text-gray-400">{fmtDate(lr.start_date)} – {fmtDate(lr.end_date)} · {lr.days_requested} day{lr.days_requested !== 1 ? 's' : ''}</p>
                    {lr.reason && <p className="text-xs text-gray-400 italic">{lr.reason}</p>}
                  </div>
                  <Badge label={lr.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Request Leave">
        <form onSubmit={submitLeave} className="space-y-4">
          <FormField label="Leave Type" required>
            <select className={selectCls} value={form.leave_type_id} onChange={e => setForm({...form, leave_type_id: e.target.value})} required>
              <option value="">Select type...</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.name} {t.is_paid ? '(Paid)' : '(Unpaid)'}</option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="From" required><input type="date" className={inputCls} value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} required /></FormField>
            <FormField label="To" required><input type="date" className={inputCls} value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} required /></FormField>
          </div>
          <FormField label="Reason"><textarea className={cn(inputCls, 'h-20 resize-none')} value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} /></FormField>
          <div className="flex gap-3"><button type="submit" className={btnPrimary}>Submit Request</button><button type="button" onClick={() => setShowCreate(false)} className={btnSecondary}>Cancel</button></div>
        </form>
      </Modal>
    </div>
  );
}

// ─── Leave Approvals Page ─────────────────────────────────────────────────────
function LeaveApprovalsPage() {
  const { selectedProject } = useProject();
  const { addToast } = useToast();
  const [leaves, setLeaves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectId, setRejectId] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string,string> = {};
      if (selectedProject) params.project_id = selectedProject;
      const all = await leaveApi.list(params);
      setLeaves(all.filter((l: any) => l.status === 'Pending'));
    } catch {} finally { setLoading(false); }
  }, [selectedProject]);

  useEffect(() => { load(); }, [load]);

  async function handleApprove(id: string) {
    try { await leaveApi.approve(id); addToast('success', 'Leave approved'); load(); }
    catch (err: any) { addToast('error', err.message); }
  }

  async function handleReject() {
    try { await leaveApi.reject(rejectId, rejectReason); addToast('success', 'Leave rejected'); setRejectId(''); setRejectReason(''); load(); }
    catch (err: any) { addToast('error', err.message); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Leave Approvals</h1>
      {loading ? <div className="flex justify-center py-10"><Spinner size={28} /></div> : (
        <Card className="overflow-hidden">
          {!leaves.length ? <EmptyState icon={UserCheck} title="No pending leave requests" subtitle="All requests have been processed" /> : (
            <div className="divide-y divide-gray-50">
              {leaves.map(lr => (
                <div key={lr.id} className="px-5 py-4 flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-48">
                    <p className="font-medium text-gray-900 text-sm">{lr.leave_type_name} — {lr.days_requested} days</p>
                    <p className="text-xs text-gray-400">{fmtDate(lr.start_date)} – {fmtDate(lr.end_date)}</p>
                    {lr.reason && <p className="text-xs text-gray-500 italic mt-1">"{lr.reason}"</p>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleApprove(lr.id)} className={cn(btnGreen, 'py-1.5 text-xs')}><Check size={12} />Approve</button>
                    <button onClick={() => setRejectId(lr.id)} className={cn(btnDanger, 'py-1.5 text-xs')}><X size={12} />Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
      <Modal open={!!rejectId} onClose={() => setRejectId('')} title="Reject Leave Request" size="sm">
        <FormField label="Rejection Reason"><textarea className={cn(inputCls, 'h-24')} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Please provide a reason..." /></FormField>
        <div className="flex gap-3 mt-4"><button onClick={handleReject} className={btnDanger}>Reject</button><button onClick={() => setRejectId('')} className={btnSecondary}>Cancel</button></div>
      </Modal>
    </div>
  );
}

// ─── Leave Balances Page ──────────────────────────────────────────────────────
function LeaveBalancesPage() {
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { leaveApi.balances().then(setBalances).catch(() => {}).finally(() => setLoading(false)); }, []);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Leave Balances</h1>
      {loading ? <div className="flex justify-center py-10"><Spinner size={28} /></div> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-5 py-3">Leave Type</th><th className="px-5 py-3">Year</th><th className="px-5 py-3">Entitlement</th><th className="px-5 py-3">Taken</th><th className="px-5 py-3">Pending</th><th className="px-5 py-3">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {balances.map(b => (
                  <tr key={b.id}>
                    <td className="px-5 py-3 font-medium text-gray-900">{b.leave_type_name}</td>
                    <td className="px-5 py-3 text-gray-500">{b.year}</td>
                    <td className="px-5 py-3">{b.entitlement_days}</td>
                    <td className="px-5 py-3 text-red-500">{b.taken_days}</td>
                    <td className="px-5 py-3 text-yellow-500">{b.pending_days}</td>
                    <td className="px-5 py-3 font-bold text-green-600">{b.balance_days ?? b.entitlement_days - b.taken_days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!balances.length && <EmptyState icon={Calendar} title="No balances found" />}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Attendance Exceptions Page ───────────────────────────────────────────────
function AttendanceExceptionsPage() {
  const { selectedProject } = useProject();
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string,string> = { days: '14' };
      if (selectedProject) params.project_id = selectedProject;
      setExceptions(await attendanceApi.exceptions(params));
    } catch {} finally { setLoading(false); }
  }, [selectedProject]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Attendance Exceptions</h1>
        <button onClick={load} className={btnSecondary}><RefreshCw size={14} /></button>
      </div>
      {loading ? <div className="flex justify-center py-10"><Spinner size={28} /></div> : (
        <Card className="overflow-hidden">
          {!exceptions.length ? <EmptyState icon={CheckCircle} title="No exceptions" subtitle="All attendance records are clean" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                    <th className="px-5 py-3">Worker</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Punch In</th><th className="px-5 py-3">Punch Out</th><th className="px-5 py-3">Issue</th><th className="px-5 py-3">Geofence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {exceptions.map(e => (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-900">{e.worker_name || e.worker}</td>
                      <td className="px-5 py-3">{fmtDate(e.work_date)}</td>
                      <td className="px-5 py-3">{fmt(e.punch_in, { timeStyle: 'short' })}</td>
                      <td className="px-5 py-3">{e.punch_out ? fmt(e.punch_out, { timeStyle: 'short' }) : <span className="text-red-500 font-medium">Missing</span>}</td>
                      <td className="px-5 py-3"><Badge label={!e.punch_out ? 'Missing Punch' : 'Geofence'} color={!e.punch_out ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'} /></td>
                      <td className="px-5 py-3">{e.punch_in_geofence_status ? <span className={cn('text-xs', GEOFENCE_COLORS[e.punch_in_geofence_status])}>● {e.punch_in_geofence_status}</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Shift Templates Page ─────────────────────────────────────────────────────
function ShiftTemplatesPage() {
  const { selectedProject } = useProject();
  const { addToast } = useToast();
  const [shifts, setShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', start_time: '07:00', end_time: '17:00', grace_minutes: '15', break_minutes: '60', regular_hours: '8', ot_threshold_hours: '8' });

  const load = useCallback(async () => {
    setLoading(true);
    try { setShifts(await shiftsApi.list(selectedProject || undefined)); }
    catch {} finally { setLoading(false); }
  }, [selectedProject]);

  useEffect(() => { load(); }, [load]);

  async function createShift(e: FormEvent) {
    e.preventDefault();
    try {
      await shiftsApi.create({ ...form, project_id: selectedProject, grace_minutes: parseInt(form.grace_minutes), break_minutes: parseInt(form.break_minutes), regular_hours: parseFloat(form.regular_hours), ot_threshold_hours: parseFloat(form.ot_threshold_hours) });
      addToast('success', 'Shift template created'); setShowCreate(false); load();
    } catch (err: any) { addToast('error', err.message); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Shift Templates</h1>
        <button onClick={() => setShowCreate(true)} className={btnPrimary}><Plus size={16} />New Shift</button>
      </div>
      {loading ? <div className="flex justify-center py-10"><Spinner size={28} /></div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shifts.map(s => (
            <Card key={s.id} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center"><Clock size={18} className="text-indigo-600" /></div>
                <Badge label={s.status} />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{s.name}</h3>
              <div className="space-y-1 text-sm text-gray-500">
                <p>🕐 {s.start_time} – {s.end_time}</p>
                <p>⏱ {s.regular_hours}h regular · OT after {s.ot_threshold_hours}h</p>
                <p>🍽 {s.break_minutes}min break · {s.grace_minutes}min grace</p>
              </div>
            </Card>
          ))}
          {!shifts.length && <EmptyState icon={Clock} title="No shift templates" subtitle="Create shift patterns for your project" />}
        </div>
      )}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Shift Template">
        <form onSubmit={createShift} className="space-y-4">
          <FormField label="Shift Name" required><input className={inputCls} value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Day Shift, Night Shift..." required /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start Time"><input type="time" className={inputCls} value={form.start_time} onChange={e => setForm({...form, start_time: e.target.value})} /></FormField>
            <FormField label="End Time"><input type="time" className={inputCls} value={form.end_time} onChange={e => setForm({...form, end_time: e.target.value})} /></FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Grace Minutes"><input type="number" className={inputCls} value={form.grace_minutes} onChange={e => setForm({...form, grace_minutes: e.target.value})} /></FormField>
            <FormField label="Break Minutes"><input type="number" className={inputCls} value={form.break_minutes} onChange={e => setForm({...form, break_minutes: e.target.value})} /></FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Regular Hours"><input type="number" step="0.5" className={inputCls} value={form.regular_hours} onChange={e => setForm({...form, regular_hours: e.target.value})} /></FormField>
            <FormField label="OT Threshold Hours"><input type="number" step="0.5" className={inputCls} value={form.ot_threshold_hours} onChange={e => setForm({...form, ot_threshold_hours: e.target.value})} /></FormField>
          </div>
          <div className="flex gap-3"><button type="submit" className={btnPrimary}>Create Shift</button><button type="button" onClick={() => setShowCreate(false)} className={btnSecondary}>Cancel</button></div>
        </form>
      </Modal>
    </div>
  );
}

// ─── Payroll Periods Page ─────────────────────────────────────────────────────
function PayrollPeriodsPage({ navigate }: { navigate: (p: Page, param?: string) => void }) {
  const { selectedProject } = useProject();
  const { addToast } = useToast();
  const [periods, setPeriods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ period_name: '', period_start: '', period_end: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try { setPeriods(await payrollApi.periods(selectedProject || undefined)); }
    catch {} finally { setLoading(false); }
  }, [selectedProject]);

  useEffect(() => { load(); }, [load]);

  async function createPeriod(e: FormEvent) {
    e.preventDefault();
    try {
      await payrollApi.createPeriod({ ...form, project_id: selectedProject });
      addToast('success', 'Payroll period created'); setShowCreate(false); load();
    } catch (err: any) { addToast('error', err.message); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Payroll Periods</h1>
        <button onClick={() => setShowCreate(true)} className={btnPrimary}><Plus size={16} />New Period</button>
      </div>
      {loading ? <div className="flex justify-center py-10"><Spinner size={28} /></div> : (
        <Card className="overflow-hidden">
          {!periods.length ? <EmptyState icon={DollarSign} title="No payroll periods" subtitle="Create your first payroll period" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                    <th className="px-5 py-3">Period</th><th className="px-5 py-3">Dates</th><th className="px-5 py-3">Total Gross</th><th className="px-5 py-3">Total Net</th><th className="px-5 py-3">Status</th><th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {periods.map(p => (
                    <tr key={p.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate('payroll-detail', p.id)}>
                      <td className="px-5 py-3 font-medium text-gray-900">{p.period_name}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{fmtDate(p.period_start)} – {fmtDate(p.period_end)}</td>
                      <td className="px-5 py-3 font-medium">{p.total_gross?.toLocaleString()}</td>
                      <td className="px-5 py-3 font-medium text-green-600">{p.total_net?.toLocaleString()}</td>
                      <td className="px-5 py-3"><Badge label={p.status} /></td>
                      <td className="px-5 py-3"><ChevronRight size={16} className="text-gray-300" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Payroll Period">
        <form onSubmit={createPeriod} className="space-y-4">
          <FormField label="Period Name" required><input className={inputCls} value={form.period_name} onChange={e => setForm({...form, period_name: e.target.value})} placeholder="March 2026" required /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start Date" required><input type="date" className={inputCls} value={form.period_start} onChange={e => setForm({...form, period_start: e.target.value})} required /></FormField>
            <FormField label="End Date" required><input type="date" className={inputCls} value={form.period_end} onChange={e => setForm({...form, period_end: e.target.value})} required /></FormField>
          </div>
          <div className="flex gap-3"><button type="submit" className={btnPrimary}>Create Period</button><button type="button" onClick={() => setShowCreate(false)} className={btnSecondary}>Cancel</button></div>
        </form>
      </Modal>
    </div>
  );
}

// ─── Payroll Period Detail Page ───────────────────────────────────────────────
function PayrollPeriodDetailPage({ periodId, navigate }: { periodId: string; navigate: (p: Page, param?: string) => void }) {
  const { addToast } = useToast();
  const [period, setPeriod] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [locking, setLocking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPeriod(await payrollApi.getPeriod(periodId)); }
    catch {} finally { setLoading(false); }
  }, [periodId]);

  useEffect(() => { load(); }, [load]);

  async function compute() {
    setComputing(true);
    try { await payrollApi.compute(periodId); addToast('success', 'Payroll computed'); await load(); }
    catch (err: any) { addToast('error', err.message); }
    finally { setComputing(false); }
  }

  async function lock() {
    if (!confirm('Lock this payroll period? This cannot be undone.')) return;
    setLocking(true);
    try { await payrollApi.lock(periodId); addToast('success', 'Period locked'); await load(); }
    catch (err: any) { addToast('error', err.message); }
    finally { setLocking(false); }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>;
  if (!period) return <EmptyState icon={DollarSign} title="Period not found" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('payroll')} className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{period.period_name}</h1>
          <p className="text-gray-500 text-sm">{fmtDate(period.period_start)} – {fmtDate(period.period_end)}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge label={period.status} />
          {period.status !== 'Locked' && <>
            <button onClick={compute} disabled={computing} className={btnSecondary}>{computing ? <Spinner size={14} /> : <RefreshCw size={14} />}Compute</button>
            <button onClick={lock} disabled={locking} className={btnPrimary}>{locking ? <Spinner size={14} /> : <Lock size={14} />}Lock</button>
          </>}
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Gross" value={`${period.entries?.[0]?.currency || 'USD'} ${period.total_gross?.toLocaleString()}`} icon={DollarSign} color="bg-blue-500" />
        <StatCard label="Total Net" value={`${period.total_net?.toLocaleString()}`} icon={TrendingUp} color="bg-green-500" />
        <StatCard label="Workers" value={period.entries?.length || 0} icon={Users} color="bg-indigo-500" />
        <StatCard label="Adjustments" value={period.adjustments?.length || 0} icon={Edit2} color="bg-orange-500" />
      </div>
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100"><h3 className="font-semibold text-gray-800">Payroll Entries</h3></div>
        {(!period.entries?.length) ? <EmptyState icon={Users} title="No entries" subtitle="Click Compute to generate payroll from attendance data" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-5 py-3">Worker</th><th className="px-5 py-3">Trade</th><th className="px-5 py-3">Days</th><th className="px-5 py-3">Reg Hrs</th><th className="px-5 py-3">OT Hrs</th><th className="px-5 py-3">Basic</th><th className="px-5 py-3">Allowances</th><th className="px-5 py-3">Gross</th><th className="px-5 py-3">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(period.entries as any[]).map((e: any) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{e.worker_name}</td>
                    <td className="px-5 py-3 text-gray-500">{e.trade || '—'}</td>
                    <td className="px-5 py-3">{e.regular_days?.toFixed(1)}</td>
                    <td className="px-5 py-3">{e.regular_hours?.toFixed(1)}</td>
                    <td className="px-5 py-3 text-orange-600">{e.overtime_hours?.toFixed(1) || '—'}</td>
                    <td className="px-5 py-3">{e.basic_pay?.toLocaleString()}</td>
                    <td className="px-5 py-3 text-gray-500">{(e.housing_allowance + e.transport_allowance + e.food_allowance)?.toLocaleString()}</td>
                    <td className="px-5 py-3 font-medium">{e.gross_pay?.toLocaleString()}</td>
                    <td className="px-5 py-3 font-bold text-green-600">{e.net_pay?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <td className="px-5 py-3 font-bold" colSpan={7}>TOTAL</td>
                  <td className="px-5 py-3 font-bold">{period.total_gross?.toLocaleString()}</td>
                  <td className="px-5 py-3 font-bold text-green-600">{period.total_net?.toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}


// ─── Project Dashboard Page ───────────────────────────────────────────────────
function ProjectDashboardPage({ navigate }: { navigate: (page: Page, param?: string) => void }) {
  const { projects, selectedProject, setSelectedProject, reload: reloadProjects } = useProject();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [portfolio, setPortfolio] = useState<any[]>([]);
  const [recentUpdates, setRecentUpdates] = useState<any[]>([]);
  const [upcomingTasks, setUpcomingTasks] = useState<any[]>([]);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [dashboardView, setDashboardView] = useState<'control_tower' | 'portfolio'>('control_tower');
  const [newProjectData, setNewProjectData] = useState({ name: '', code: '', client: '', status: 'Active', budget: '', location: '', description: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [port, updates, tasks] = await Promise.all([
        projectsApi.portfolio().catch(() => projectsApi.list()),
        updatesApi.list({ limit: '6' }).catch(() => []),
        tasksApi.list({ limit: '8' }).catch(() => [])
      ]);
      setPortfolio(Array.isArray(port) ? port : []);
      setRecentUpdates(Array.isArray(updates) ? updates : []);
      setUpcomingTasks(Array.isArray(tasks) ? tasks : []);
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeProjects = portfolio.filter(p => p.status === 'Active');
  const delayedProjects = portfolio.filter(p => p.status === 'Delayed' || p.health === 'RED');
  const avgProgress = portfolio.length > 0
    ? Math.round(portfolio.reduce((acc, p) => acc + (Number(p.calculated_progress ?? p.progress) || 0), 0) / portfolio.length)
    : 0;
  const totalBudget = portfolio.reduce((acc, p) => acc + (Number(p.budget ?? p.contract_value) || 0), 0);

  const handleCreateProject = async (e: FormEvent) => {
    e.preventDefault();
    if (!newProjectData.name || !newProjectData.client) {
      addToast('error', 'Project Name and Client are required');
      return;
    }
    try {
      await projectsApi.create({
        name: newProjectData.name,
        code: newProjectData.code || undefined,
        client: newProjectData.client,
        status: newProjectData.status,
        budget: newProjectData.budget ? Number(newProjectData.budget) : 0,
        location: newProjectData.location || undefined,
        description: newProjectData.description || undefined
      });
      addToast('success', 'Project created successfully');
      setShowNewProjectModal(false);
      setNewProjectData({ name: '', code: '', client: '', status: 'Active', budget: '', location: '', description: '' });
      reloadProjects();
      loadData();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to create project');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Project Management & Updates</h1>
          <p className="text-gray-500 text-sm mt-0.5">Real-time MEP project portfolio, live site progress feed, and task execution</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} className={btnSecondary}><RefreshCw size={14} />Refresh</button>
          <button onClick={() => navigate('updates')} className={btnSecondary}><TrendingUp size={14} />Site Updates</button>
          {['Admin', 'ProjectManager'].includes(user?.role) && (
            <button onClick={() => setShowNewProjectModal(true)} className={btnPrimary}><Plus size={14} />New Project</button>
          )}
        </div>
      </div>

      {/* View Switcher: Control Tower vs Portfolio */}
      <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
        <button
          onClick={() => setDashboardView('control_tower')}
          className={`px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-2 transition-all ${
            dashboardView === 'control_tower'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          <Zap size={14} /> Control Tower & Lookahead
        </button>
        <button
          onClick={() => setDashboardView('portfolio')}
          className={`px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-2 transition-all ${
            dashboardView === 'portfolio'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          <Briefcase size={14} /> Portfolio Overview ({portfolio.length})
        </button>
      </div>

      {dashboardView === 'control_tower' ? (
        <ProjectControlTower projectId={selectedProject || undefined} navigate={navigate} />
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Portfolio" value={portfolio.length} icon={Briefcase} color="bg-blue-600" sub={`${activeProjects.length} Active • ${delayedProjects.length} Delayed`} />
        <StatCard label="Avg Portfolio Progress" value={`${avgProgress}%`} icon={TrendingUp} color="bg-emerald-600" sub="across all active jobs" />
        <StatCard label="Total Contract Value" value={`${(totalBudget / 1000000).toFixed(2)}M`} icon={DollarSign} color="bg-indigo-600" sub="approved budget" />
        <StatCard label="Recent Updates Logged" value={recentUpdates.length} icon={Activity} color="bg-amber-600" sub="site posts & milestones" />
      </div>

      {/* Project Portfolio Overview Cards */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Building2 size={20} className="text-blue-600" /> Active MEP Projects
          </h2>
          <button onClick={() => navigate('projects')} className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1">
            View All Projects <ChevronRight size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Spinner size={32} /></div>
        ) : portfolio.length === 0 ? (
          <EmptyState icon={Briefcase} title="No projects found" subtitle="Create your first MEP project to begin tracking" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {portfolio.map((p) => {
              const prog = Number(p.calculated_progress ?? p.progress) || 0;
              const health = p.health || (prog > 70 ? 'GREEN' : prog > 30 ? 'AMBER' : 'BLUE');
              const healthColor = health === 'GREEN' ? 'bg-emerald-500' : health === 'RED' ? 'bg-red-500' : 'bg-amber-500';

              return (
                <Card key={p.id} className="p-5 hover:shadow-md transition-shadow cursor-pointer border border-gray-100 flex flex-col justify-between" onClick={() => { setSelectedProject(p.id); navigate('project-detail', p.id); }}>
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        {p.code && <span className="text-xs font-semibold px-2 py-0.5 rounded bg-gray-100 text-gray-600 mr-2">{p.code}</span>}
                        <h3 className="font-bold text-gray-900 text-base hover:text-blue-600 transition-colors mt-1">{p.name}</h3>
                        <p className="text-xs text-gray-500">{p.client}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={cn('w-2.5 h-2.5 rounded-full', healthColor)} title={`Health: ${health}`} />
                        <Badge label={p.status || 'Active'} />
                      </div>
                    </div>

                    {p.location && (
                      <p className="text-xs text-gray-500 flex items-center gap-1 mb-3">
                        <MapPin size={12} className="text-gray-400" /> {p.location}
                      </p>
                    )}

                    {/* Progress Bar */}
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-xs font-medium text-gray-600 mb-1.5">
                        <span>MEP Progress</span>
                        <span className="font-bold text-gray-900">{prog}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                        <div
                          className={cn('h-2.5 rounded-full transition-all duration-500', prog >= 100 ? 'bg-emerald-500' : prog >= 50 ? 'bg-blue-600' : 'bg-amber-500')}
                          style={{ width: `${Math.min(prog, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 pt-3 border-t border-gray-50 flex items-center justify-between text-xs text-gray-500">
                    <span>Budget: <strong className="text-gray-900 font-semibold">{p.budget ? `${Number(p.budget).toLocaleString()}` : '—'}</strong></span>
                    <span className="text-blue-600 font-medium flex items-center gap-0.5">Details <ChevronRight size={14} /></span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Grid: Recent Site Updates & Quick Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Site Updates (2 Cols) */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <TrendingUp size={20} className="text-emerald-600" /> Live Site Updates Feed
            </h2>
            <button onClick={() => navigate('updates')} className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1">
              View All Feed <ChevronRight size={16} />
            </button>
          </div>

          <Card className="divide-y divide-gray-100 overflow-hidden">
            {recentUpdates.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <Activity size={36} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No site updates posted yet.</p>
                <button onClick={() => navigate('updates')} className={btnPrimary + ' mt-3 text-xs'}><Plus size={12} /> Post First Update</button>
              </div>
            ) : (
              recentUpdates.slice(0, 5).map(u => (
                <div key={u.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {u.pinned ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold"><Pin size={10} /> PINNED</span> : null}
                        <Badge label={u.category || 'General'} color="bg-blue-50 text-blue-700" />
                        {u.trade && <span className="text-xs font-semibold px-2 py-0.5 rounded bg-purple-50 text-purple-700">{u.trade}</span>}
                        {u.project_name && <span className="text-xs text-gray-400 font-medium">• {u.project_name}</span>}
                      </div>
                      <h4 className="text-sm font-semibold text-gray-900">{u.title}</h4>
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2">{u.content}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                        <span>{u.created_by_name || 'Site Team'}</span>
                        <span>•</span>
                        <span>{fmt(u.created_at)}</span>
                        {u.location && <><span>•</span><span><MapPin size={10} className="inline mr-0.5" />{u.location}</span></>}
                      </div>
                    </div>
                    {u.attachment_data && (
                      <img src={u.attachment_data} alt="Site attachment" className="w-16 h-16 rounded-lg object-cover border border-gray-200 flex-shrink-0" />
                    )}
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>

        {/* Priority Tasks (1 Col) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <CheckSquare size={20} className="text-blue-600" /> Tasks Programme
            </h2>
            <button onClick={() => navigate('tasks')} className="text-sm font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1">
              View Tasks <ChevronRight size={16} />
            </button>
          </div>

          <Card className="divide-y divide-gray-100 overflow-hidden">
            {upcomingTasks.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <CheckSquare size={36} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No tasks scheduled.</p>
                <button onClick={() => navigate('tasks')} className={btnSecondary + ' mt-3 text-xs'}><Plus size={12} /> Add Task</button>
              </div>
            ) : (
              upcomingTasks.slice(0, 6).map(t => (
                <div key={t.id} className="p-3.5 hover:bg-gray-50 transition-colors flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', PRIORITY_COLORS[t.priority || 'Medium'] || 'bg-gray-100 text-gray-600')}>
                        {t.priority || 'Normal'}
                      </span>
                      {t.trade && <span className="text-xs text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">{t.trade}</span>}
                    </div>
                    <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{t.project_name || (t.end ? `Due: ${fmtDate(t.end)}` : 'In progress')}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <Badge label={t.status || 'Not Started'} />
                    <p className="text-xs font-semibold text-gray-700 mt-1">{t.progress || 0}%</p>
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
      </>
      )}

      {/* Modal: New Project */}
      <Modal open={showNewProjectModal} onClose={() => setShowNewProjectModal(false)} title="Create New Project" size="md">
        <form onSubmit={handleCreateProject} className="space-y-4">
          <FormField label="Project Name" required>
            <input type="text" required value={newProjectData.name} onChange={e => setNewProjectData(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Al Wasl Tower MEP Package" className={inputCls} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Project Code">
              <input type="text" value={newProjectData.code} onChange={e => setNewProjectData(d => ({ ...d, code: e.target.value }))} placeholder="e.g. PRJ-202" className={inputCls} />
            </FormField>
            <FormField label="Status">
              <select value={newProjectData.status} onChange={e => setNewProjectData(d => ({ ...d, status: e.target.value }))} className={selectCls}>
                <option value="Planning">Planning</option>
                <option value="Active">Active</option>
                <option value="Delayed">Delayed</option>
                <option value="Completed">Completed</option>
              </select>
            </FormField>
          </div>
          <FormField label="Client / Employer" required>
            <input type="text" required value={newProjectData.client} onChange={e => setNewProjectData(d => ({ ...d, client: e.target.value }))} placeholder="e.g. Emaar Properties / Dubai Holding" className={inputCls} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Total Budget (USD)">
              <input type="number" value={newProjectData.budget} onChange={e => setNewProjectData(d => ({ ...d, budget: e.target.value }))} placeholder="e.g. 5000000" className={inputCls} />
            </FormField>
            <FormField label="Location">
              <input type="text" value={newProjectData.location} onChange={e => setNewProjectData(d => ({ ...d, location: e.target.value }))} placeholder="e.g. Downtown Dubai, UAE" className={inputCls} />
            </FormField>
          </div>
          <FormField label="Project Scope / Description">
            <textarea rows={3} value={newProjectData.description} onChange={e => setNewProjectData(d => ({ ...d, description: e.target.value }))} placeholder="Brief summary of MEP scope (HVAC, Electrical, Plumbing, Fire Fighting)..." className={inputCls} />
          </FormField>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
            <button type="button" onClick={() => setShowNewProjectModal(false)} className={btnSecondary}>Cancel</button>
            <button type="submit" className={btnPrimary}><Plus size={14} /> Create Project</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ─── Projects Portfolio Page ──────────────────────────────────────────────────
function ProjectsPage({ navigate }: { navigate: (page: Page, param?: string) => void }) {
  const { setSelectedProject, reload: reloadGlobalProjects } = useProject();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<any | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    project_code: '',
    client: '',
    status: 'Active',
    budget: '',
    currency: 'USD',
    contract_type: '',
    stage: 'Construction',
    consultant: '',
    main_contractor: '',
    location: '',
    description: '',
    start_date: '',
    end_date: '',
    progress: '0'
  });

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await projectsApi.portfolio().catch(() => projectsApi.list());
      setProjects(Array.isArray(data) ? data : []);
    } catch (err: any) {
      addToast('error', 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const filtered = projects.filter(p => {
    const matchesSearch =
      (p.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.code || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.project_code || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.client || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.location || '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'All' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleOpenCreate = () => {
    setEditingProject(null);
    const rndCode = `PRJ-${Math.floor(100 + Math.random() * 900)}`;
    setFormData({
      name: '',
      code: rndCode,
      project_code: rndCode,
      client: '',
      status: 'Active',
      budget: '',
      currency: 'USD',
      contract_type: '',
      stage: 'Construction',
      consultant: '',
      main_contractor: '',
      location: '',
      description: '',
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
      progress: '0'
    });
    setShowModal(true);
  };

  const handleOpenEdit = (p: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProject(p);
    setFormData({
      name: p.name || '',
      code: p.project_code || p.code || '',
      project_code: p.project_code || p.code || '',
      client: p.client_name || p.client || '',
      status: p.status || 'Active',
      budget: p.contract_value ?? p.budget ? String(p.contract_value ?? p.budget) : '',
      currency: p.currency || 'USD',
      contract_type: p.contract_type || '',
      stage: p.stage || 'Construction',
      consultant: p.consultant || '',
      main_contractor: p.main_contractor || '',
      location: p.location || '',
      description: p.description || '',
      start_date: p.start_date || '',
      end_date: p.end_date || '',
      progress: p.progress != null ? String(p.progress) : '0'
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete project "${name}"?`)) return;
    try {
      await projectsApi.delete(id);
      addToast('success', 'Project deleted');
      loadProjects();
      reloadGlobalProjects();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to delete project');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.client) {
      addToast('error', 'Project Name and Client are required');
      return;
    }
    try {
      const payload = {
        name: formData.name,
        code: formData.project_code || formData.code || undefined,
        project_code: formData.project_code || formData.code || undefined,
        client: formData.client,
        client_name: formData.client,
        status: formData.status,
        budget: formData.budget ? Number(formData.budget) : 0,
        contract_value: formData.budget ? Number(formData.budget) : 0,
        currency: formData.currency,
        contract_type: formData.contract_type,
        stage: formData.stage,
        consultant: formData.consultant || undefined,
        main_contractor: formData.main_contractor || undefined,
        location: formData.location || undefined,
        description: formData.description || undefined,
        start_date: formData.start_date || undefined,
        end_date: formData.end_date || undefined,
        progress: Number(formData.progress) || 0
      };

      if (editingProject) {
        await projectsApi.update(editingProject.id, payload);
        addToast('success', 'Project updated');
      } else {
        await projectsApi.create(payload);
        addToast('success', 'Project created');
      }
      setShowModal(false);
      loadProjects();
      reloadGlobalProjects();
    } catch (err: any) {
      addToast('error', err.message || 'Operation failed');
    }
  };

  const isManager = ['Admin', 'ProjectManager'].includes(user?.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects Portfolio</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage all active MEP jobs, contracts, schedules, and site operations</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadProjects} className={btnSecondary}><RefreshCw size={14} />Refresh</button>
          {isManager && (
            <button onClick={handleOpenCreate} className={btnPrimary}><Plus size={14} />New Project</button>
          )}
        </div>
      </div>

      {/* Filters and View Toggles */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center gap-2 flex-1 max-w-md bg-gray-50 px-3 py-2 rounded-xl border border-gray-200">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="Search projects by name, code, client, location..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-sm w-full focus:outline-none text-gray-800 placeholder-gray-400"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          {['All', 'Active', 'Planning', 'Delayed', 'Completed'].map(st => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={cn('px-3 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap',
                statusFilter === st ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              )}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Projects Content */}
      {loading ? (
        <div className="flex justify-center py-20"><Spinner size={32} /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Briefcase} title="No matching projects" subtitle={search ? 'Try adjusting your search filters' : 'Create your first project to get started'} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(p => {
            const prog = Number(p.calculated_progress ?? p.progress) || 0;
            const health = p.health || (prog > 70 ? 'GREEN' : prog > 30 ? 'AMBER' : 'BLUE');
            const healthBg = health === 'GREEN' ? 'bg-emerald-500' : health === 'RED' ? 'bg-red-500' : 'bg-amber-500';

            return (
              <Card
                key={p.id}
                className="p-5 hover:shadow-lg transition-all cursor-pointer border border-gray-100 flex flex-col justify-between"
                onClick={() => { setSelectedProject(p.id); navigate('project-detail', p.id); }}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        {p.code && <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700">{p.code}</span>}
                        <Badge label={p.status || 'Active'} />
                      </div>
                      <h3 className="font-bold text-gray-900 text-lg mt-2 group-hover:text-blue-600 transition-colors">{p.name}</h3>
                      <p className="text-xs font-medium text-gray-500 mt-0.5">{p.client}</p>
                    </div>
                    <div className="flex items-center gap-1.5" title={`Health: ${health}`}>
                      <span className={cn('w-3 h-3 rounded-full shadow-sm', healthBg)} />
                    </div>
                  </div>

                  {p.description && (
                    <p className="text-xs text-gray-600 mt-2.5 line-clamp-2">{p.description}</p>
                  )}

                  {p.location && (
                    <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                      <MapPin size={12} className="text-gray-400 flex-shrink-0" />
                      <span className="truncate">{p.location}</span>
                    </p>
                  )}

                  {/* Progress Bar */}
                  <div className="mt-5">
                    <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
                      <span className="text-gray-600">Completion</span>
                      <span className="text-gray-900">{prog}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                      <div
                        className={cn('h-2.5 rounded-full transition-all duration-500', prog >= 100 ? 'bg-emerald-500' : prog >= 50 ? 'bg-blue-600' : 'bg-amber-500')}
                        style={{ width: `${Math.min(prog, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-gray-400">Budget: </span>
                    <span className="font-semibold text-gray-800">{p.budget ? `${Number(p.budget).toLocaleString()}` : '—'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {isManager && (
                      <>
                        <button onClick={(e) => handleOpenEdit(p, e)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit Project">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={(e) => handleDelete(p.id, p.name, e)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete Project">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                    <span className="text-blue-600 font-semibold flex items-center gap-0.5 ml-1">Open <ChevronRight size={14} /></span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit Project Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingProject ? 'Edit Project' : 'Create New Project'} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="Project Name" required>
            <input type="text" required value={formData.name} onChange={e => setFormData(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Dubai Marina Mall HVAC Replacement" className={inputCls} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Project Code">
              <input type="text" value={formData.code} onChange={e => setFormData(d => ({ ...d, code: e.target.value }))} placeholder="e.g. PRJ-204" className={inputCls} />
            </FormField>
            <FormField label="Status">
              <select value={formData.status} onChange={e => setFormData(d => ({ ...d, status: e.target.value }))} className={selectCls}>
                <option value="Planning">Planning</option>
                <option value="Active">Active</option>
                <option value="Delayed">Delayed</option>
                <option value="Completed">Completed</option>
              </select>
            </FormField>
          </div>
          <FormField label="Client / Employer" required>
            <input type="text" required value={formData.client} onChange={e => setFormData(d => ({ ...d, client: e.target.value }))} placeholder="e.g. Emaar Hospitality Group" className={inputCls} />
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Stage">
              <select value={formData.stage} onChange={e => setFormData(d => ({ ...d, stage: e.target.value }))} className={selectCls}>
                <option value="Mobilization">Mobilization</option>
                <option value="Engineering">Engineering</option>
                <option value="Procurement">Procurement</option>
                <option value="Construction">Construction</option>
                <option value="Testing & Commissioning">Testing & Commissioning</option>
                <option value="Handover">Handover</option>
              </select>
            </FormField>
            <FormField label="Contract Type">
              <select value={formData.contract_type} onChange={e => setFormData(d => ({ ...d, contract_type: e.target.value }))} className={selectCls}>
                <option value="">— Select Contract Type —</option>
                <option value="Lump Sum EPC">Lump Sum EPC</option>
                <option value="Design & Build">Design & Build</option>
                <option value="Cost Plus">Cost Plus</option>
                <option value="Re-measurable Unit Rate">Re-measurable Unit Rate</option>
                <option value="Fixed Price">Fixed Price</option>
                <option value="Framework Agreement">Framework Agreement</option>
              </select>
            </FormField>
            <FormField label="Currency">
              <select value={formData.currency} onChange={e => setFormData(d => ({ ...d, currency: e.target.value }))} className={selectCls}>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="AED">AED (AED)</option>
                <option value="SAR">SAR (SAR)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Main Contractor">
              <input type="text" value={formData.main_contractor} onChange={e => setFormData(d => ({ ...d, main_contractor: e.target.value }))} placeholder="e.g. Arabtec / ASGC JV" className={inputCls} />
            </FormField>
            <FormField label="Lead Consultant">
              <input type="text" value={formData.consultant} onChange={e => setFormData(d => ({ ...d, consultant: e.target.value }))} placeholder="e.g. WSP Middle East" className={inputCls} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Contract Value">
              <input type="number" value={formData.budget} onChange={e => setFormData(d => ({ ...d, budget: e.target.value }))} placeholder="e.g. 2400000" className={inputCls} />
            </FormField>
            <FormField label="Progress (%)">
              <input type="number" min="0" max="100" value={formData.progress} onChange={e => setFormData(d => ({ ...d, progress: e.target.value }))} placeholder="0" className={inputCls} />
            </FormField>
          </div>
          <FormField label="Site Location / Address">
            <input type="text" value={formData.location} onChange={e => setFormData(d => ({ ...d, location: e.target.value }))} placeholder="e.g. Al Sufouh 2, Dubai, UAE" className={inputCls} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Start Date">
              <input type="date" value={formData.start_date} onChange={e => setFormData(d => ({ ...d, start_date: e.target.value }))} className={inputCls} />
            </FormField>
            <FormField label="End Date">
              <input type="date" value={formData.end_date} onChange={e => setFormData(d => ({ ...d, end_date: e.target.value }))} className={inputCls} />
            </FormField>
          </div>
          <FormField label="Scope & Description">
            <textarea rows={3} value={formData.description} onChange={e => setFormData(d => ({ ...d, description: e.target.value }))} placeholder="Comprehensive description of MEP scope..." className={inputCls} />
          </FormField>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
            <button type="button" onClick={() => setShowModal(false)} className={btnSecondary}>Cancel</button>
            <button type="submit" className={btnPrimary}><Check size={14} /> {editingProject ? 'Save Changes' : 'Create Project'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ─── Project Detail Page ──────────────────────────────────────────────────────
function ProjectDetailPage({ projectId, navigate }: { projectId?: string; navigate: (page: Page, param?: string) => void }) {
  const { selectedProject, setSelectedProject, projects, reload: reloadProjects } = useProject();
  const { user } = useAuth();
  const { addToast } = useToast();
  const activeProjectId = projectId || selectedProject || (projects[0]?.id ?? '');

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<any | null>(null);
  const [feed, setFeed] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'master' | 'overview' | 'feed' | 'tasks' | 'actions' | 'decisions' | 'team'>('master');
  const [showRiskMatrix, setShowRiskMatrix] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // New update form state
  const [updateTitle, setUpdateTitle] = useState('');
  const [updateCategory, setUpdateCategory] = useState('Progress Milestone');
  const [updateTrade, setUpdateTrade] = useState('HVAC');
  const [updateContent, setUpdateContent] = useState('');
  const [updateProgress, setUpdateProgress] = useState('');
  const [updateLocation, setUpdateLocation] = useState('');
  const [updateWeather, setUpdateWeather] = useState('Sunny');
  const [updatePinned, setUpdatePinned] = useState(false);
  const [updateAttachment, setUpdateAttachment] = useState<string | null>(null);

  // New task form state
  const [taskTitle, setTaskTitle] = useState('');
  const [taskTrade, setTaskTrade] = useState('HVAC');
  const [taskPriority, setTaskPriority] = useState('Medium');
  const [taskStatus, setTaskStatus] = useState('Not Started');
  const [taskStart, setTaskStart] = useState('');
  const [taskEnd, setTaskEnd] = useState('');

  const loadProjectDetails = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const [projData, feedData, taskData] = await Promise.all([
        projectsApi.overview(activeProjectId).catch(() => projectsApi.get(activeProjectId)),
        projectsApi.feed(activeProjectId).catch(() => []),
        tasksApi.list({ project_id: activeProjectId }).catch(() => [])
      ]);
      setProject(projData);
      setFeed(Array.isArray(feedData) ? feedData : []);
      setTasks(Array.isArray(taskData) ? taskData : []);
    } catch (err: any) {
      addToast('error', 'Failed to load project details');
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, addToast]);

  useEffect(() => {
    loadProjectDetails();
  }, [loadProjectDetails]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUpdateAttachment(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleCreateUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (!updateTitle || !updateContent) {
      addToast('error', 'Title and Content are required');
      return;
    }
    try {
      await updatesApi.create({
        project_id: activeProjectId,
        title: updateTitle,
        category: updateCategory,
        trade: updateTrade,
        content: updateContent,
        progress_percent: updateProgress ? Number(updateProgress) : undefined,
        location: updateLocation || undefined,
        weather: updateWeather || undefined,
        pinned: updatePinned ? 1 : 0,
        attachment_data: updateAttachment || undefined
      });
      addToast('success', 'Site update posted successfully');
      setShowUpdateModal(false);
      setUpdateTitle('');
      setUpdateContent('');
      setUpdateAttachment(null);
      setUpdateProgress('');
      loadProjectDetails();
      reloadProjects();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to post update');
    }
  };

  const handleCreateTask = async (e: FormEvent) => {
    e.preventDefault();
    if (!taskTitle) {
      addToast('error', 'Task Title is required');
      return;
    }
    try {
      await tasksApi.create({
        project_id: activeProjectId,
        title: taskTitle,
        trade: taskTrade,
        priority: taskPriority,
        status: taskStatus,
        start: taskStart || undefined,
        end: taskEnd || undefined,
        progress: 0
      });
      addToast('success', 'Task added');
      setShowTaskModal(false);
      setTaskTitle('');
      loadProjectDetails();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to add task');
    }
  };

  if (loading && !project) {
    return <div className="flex justify-center py-24"><Spinner size={32} /></div>;
  }

  const p = project || {};
  const prog = Number(p.calculated_progress ?? p.progress) || 0;
  const health = p.health || (prog > 70 ? 'GREEN' : prog > 30 ? 'AMBER' : 'BLUE');
  const healthBg = health === 'GREEN' ? 'bg-emerald-500' : health === 'RED' ? 'bg-red-500' : 'bg-amber-500';

  return (
    <div className="space-y-6">
      {/* Top Navigation & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <button onClick={() => navigate('projects')} className={btnSecondary}>
          <ArrowLeft size={14} /> Back to Projects
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={loadProjectDetails} className={btnSecondary}><RefreshCw size={14} />Refresh</button>
          <button onClick={() => setShowRiskMatrix(true)} className={btnSecondary}><AlertTriangle size={14} className="text-amber-600" /> 5x5 Risk Heat Map</button>
          <button onClick={() => setShowUpdateModal(true)} className={btnPrimary}><Plus size={14} />Post Site Update</button>
          <button onClick={() => setShowTaskModal(true)} className={btnSecondary}><CheckSquare size={14} />Add Task</button>
        </div>
      </div>

      {/* Project Banner Header */}
      <Card className="p-6 border border-gray-100 shadow-sm bg-gradient-to-r from-white via-blue-50/20 to-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {p.code && <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">{p.code}</span>}
              <Badge label={p.status || 'Active'} />
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-gray-50 border border-gray-200 text-xs font-medium text-gray-700">
                <span className={cn('w-2.5 h-2.5 rounded-full', healthBg)} />
                Health: {health}
              </div>
            </div>

            <h1 className="text-2xl font-black text-gray-900">{p.name || 'MEP Project'}</h1>
            <p className="text-gray-500 text-sm mt-1">{p.client} • {p.location || 'Location not specified'}</p>

            {p.description && (
              <p className="text-xs text-gray-600 mt-2 max-w-3xl">{p.description}</p>
            )}
          </div>

          <div className="lg:w-72 flex-shrink-0 bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between text-xs font-bold mb-1.5">
              <span className="text-gray-600">Overall Progress</span>
              <span className="text-blue-600 text-sm">{prog}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
              <div
                className={cn('h-3 rounded-full transition-all duration-500', prog >= 100 ? 'bg-emerald-500' : prog >= 50 ? 'bg-blue-600' : 'bg-amber-500')}
                style={{ width: `${Math.min(prog, 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-gray-400 mt-3 pt-2 border-t border-gray-100">
              <span>Budget: <strong className="text-gray-700">{p.budget ? `${Number(p.budget).toLocaleString()}` : '—'}</strong></span>
              <span>Tasks: <strong className="text-gray-700">{tasks.length}</strong></span>
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 space-x-6 overflow-x-auto">
        {[
          { id: 'master', label: 'Project Master & Hierarchy', icon: Layers },
          { id: 'overview', label: 'Overview & KPIs', icon: Briefcase },
          { id: 'feed', label: `Live Feed & Updates (${feed.length})`, icon: TrendingUp },
          { id: 'tasks', label: `Tasks & Programme (${tasks.length})`, icon: CheckSquare },
          { id: 'actions', label: 'Project Actions', icon: AlertCircle },
          { id: 'decisions', label: 'Project Decisions', icon: Shield },
          { id: 'team', label: 'Team & Directory', icon: Users },
        ].map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn('flex items-center gap-2 py-3 border-b-2 font-semibold text-sm transition-colors whitespace-nowrap',
                active ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <Icon size={16} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab: Project Master & Hierarchy */}
      {activeTab === 'master' && (
        <ProjectMasterOverview
          projectId={activeProjectId}
          onNavigateToTask={() => {
            setActiveTab('tasks');
          }}
          onRefreshProject={loadProjectDetails}
        />
      )}

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Contract Value" value={p.budget ? `${(Number(p.budget) / 1000000).toFixed(2)}M` : '—'} icon={DollarSign} color="bg-blue-600" sub="Approved MEP Budget" />
            <StatCard label="Open RFIs" value={p.open_rfis ?? 0} icon={BookOpen} color="bg-indigo-600" sub="Technical queries" />
            <StatCard label="Active Snags / NCRs" value={p.open_snags ?? 0} icon={AlertTriangle} color="bg-amber-600" sub="Quality observations" />
            <StatCard label="Scheduled Tasks" value={tasks.length} icon={CheckSquare} color="bg-emerald-600" sub={`${tasks.filter(t => t.status === 'Completed').length} completed`} />
          </div>

          {/* Trade Progress Breakdown */}
          <Card className="p-6 border border-gray-100">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Layers size={18} className="text-blue-600" /> MEP Trade Progress Breakdown
            </h3>
            <div className="space-y-4">
              {[
                { trade: 'HVAC & Ducting', pct: p.hvac_progress ?? Math.min(prog + 5, 100), color: 'bg-cyan-500' },
                { trade: 'Electrical & Containment', pct: p.electrical_progress ?? Math.max(prog - 8, 0), color: 'bg-yellow-500' },
                { trade: 'Plumbing & Drainage', pct: p.plumbing_progress ?? prog, color: 'bg-blue-500' },
                { trade: 'Fire Protection & Sprinklers', pct: p.fire_progress ?? Math.max(prog - 12, 0), color: 'bg-red-500' },
                { trade: 'ELV & Building Automation (BMS)', pct: p.elv_progress ?? Math.max(prog - 15, 0), color: 'bg-purple-500' },
              ].map(t => (
                <div key={t.trade}>
                  <div className="flex items-center justify-between text-xs font-semibold mb-1">
                    <span className="text-gray-700">{t.trade}</span>
                    <span className="text-gray-900">{t.pct}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div className={cn('h-2 rounded-full transition-all duration-500', t.color)} style={{ width: `${t.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Tab: Feed */}
      {activeTab === 'feed' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900 text-base">Site Timeline & Activity Stream</h3>
            <button onClick={() => setShowUpdateModal(true)} className={btnPrimary}><Plus size={14} />Post Update</button>
          </div>

          {feed.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No site updates posted" subtitle="Post the first update or daily log to start the activity stream" />
          ) : (
            <div className="space-y-4">
              {feed.map((item, idx) => (
                <Card key={item.id || idx} className={cn('p-5 border border-gray-100 transition-shadow hover:shadow-md', item.pinned ? 'border-l-4 border-l-amber-500 bg-amber-50/20' : '')}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        {item.pinned ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold"><Pin size={10} /> PINNED</span> : null}
                        <Badge label={item.category || item.type || 'Update'} color="bg-blue-50 text-blue-700" />
                        {item.trade && <span className="text-xs font-semibold px-2 py-0.5 rounded bg-purple-50 text-purple-700">{item.trade}</span>}
                        {item.progress_percent != null && (
                          <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                            Progress: {item.progress_percent}%
                          </span>
                        )}
                        {item.weather && (
                          <span className="text-xs px-2 py-0.5 rounded bg-sky-50 text-sky-700 flex items-center gap-1">
                            <Sun size={12} /> {item.weather}
                          </span>
                        )}
                      </div>

                      <h4 className="font-bold text-gray-900 text-base">{item.title}</h4>
                      <p className="text-sm text-gray-700 mt-2 whitespace-pre-line">{item.content}</p>

                      <div className="flex items-center gap-3 mt-4 text-xs text-gray-400 pt-2 border-t border-gray-50">
                        <span className="font-medium text-gray-600">{item.created_by_name || 'Site Engineer'}</span>
                        <span>•</span>
                        <span>{fmt(item.created_at)}</span>
                        {item.location && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-0.5"><MapPin size={10} />{item.location}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {item.attachment_data && (
                      <div className="cursor-pointer flex-shrink-0" onClick={() => setSelectedImage(item.attachment_data)}>
                        <img src={item.attachment_data} alt="Site attachment" className="w-24 h-24 rounded-xl object-cover border border-gray-200 hover:opacity-90 transition-opacity" />
                        <span className="text-[10px] text-gray-400 block text-center mt-1">Click to zoom</span>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Tasks */}
      {activeTab === 'tasks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900 text-base">Project Task Programme</h3>
            <button onClick={() => setShowTaskModal(true)} className={btnPrimary}><Plus size={14} />Add Task</button>
          </div>

          {tasks.length === 0 ? (
            <EmptyState icon={CheckSquare} title="No tasks scheduled" subtitle="Create tasks to organize MEP installation and inspections" />
          ) : (
            <Card className="divide-y divide-gray-100 overflow-hidden">
              {tasks.map(t => (
                <div key={t.id} className="p-4 hover:bg-gray-50 transition-colors flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('text-xs px-2 py-0.5 rounded font-bold', PRIORITY_COLORS[t.priority || 'Medium'] || 'bg-gray-100 text-gray-600')}>
                        {t.priority || 'Medium'}
                      </span>
                      {t.trade && <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700 font-semibold">{t.trade}</span>}
                      {t.wbs_code && <span className="text-xs font-mono text-gray-400">{t.wbs_code}</span>}
                    </div>
                    <h4 className="text-sm font-bold text-gray-900">{t.title}</h4>
                    {t.description && <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>}
                    <div className="flex items-center gap-3 text-xs text-gray-400 mt-2">
                      <span>Start: {fmtDate(t.start)}</span>
                      <span>•</span>
                      <span>Due: {fmtDate(t.end)}</span>
                      {t.assignee && <><span>•</span><span>Assigned: {t.assignee}</span></>}
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0 flex items-center gap-4">
                    <div>
                      <Badge label={t.status || 'Not Started'} />
                      <p className="text-xs font-bold text-gray-800 mt-1">{t.progress || 0}% Complete</p>
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* Tab: Project Actions */}
      {activeTab === 'actions' && (
        <ProjectActionsRegister projectId={activeProjectId} />
      )}

      {/* Tab: Project Decisions */}
      {activeTab === 'decisions' && (
        <ProjectDecisionsRegister projectId={activeProjectId} />
      )}

      {/* Tab: Team */}
      {activeTab === 'team' && (
        <Card className="p-6 border border-gray-100">
          <h3 className="font-bold text-gray-900 text-base mb-4">Project Stakeholders & Key Directory</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-400 uppercase font-semibold">Employer / Client</p>
              <p className="text-base font-bold text-gray-900 mt-1">{p.client || '—'}</p>
            </div>
            <div className="p-4 rounded-xl border border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-400 uppercase font-semibold">Lead MEP Contractor</p>
              <p className="text-base font-bold text-gray-900 mt-1">Apex MEP Contracting LLC</p>
            </div>
            <div className="p-4 rounded-xl border border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-400 uppercase font-semibold">Site Location</p>
              <p className="text-base font-bold text-gray-900 mt-1">{p.location || 'Downtown Dubai'}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Modal: Post Site Update */}
      <Modal open={showUpdateModal} onClose={() => setShowUpdateModal(false)} title="Post Site Update" size="lg">
        <form onSubmit={handleCreateUpdate} className="space-y-4">
          <FormField label="Update Title" required>
            <input type="text" required value={updateTitle} onChange={e => setUpdateTitle(e.target.value)} placeholder="e.g. Chilled Water Pipe Hydrostatic Pressure Test Passed" className={inputCls} />
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Category">
              <select value={updateCategory} onChange={e => setUpdateCategory(e.target.value)} className={selectCls}>
                <option value="Progress Milestone">Progress Milestone</option>
                <option value="Daily Site Log">Daily Site Log</option>
                <option value="Safety Notice">Safety Notice</option>
                <option value="Quality Observation">Quality Observation</option>
                <option value="Material Delivery">Material Delivery</option>
                <option value="Weather Impact">Weather Impact</option>
                <option value="General">General Update</option>
              </select>
            </FormField>
            <FormField label="MEP Trade">
              <select value={updateTrade} onChange={e => setUpdateTrade(e.target.value)} className={selectCls}>
                <option value="HVAC">HVAC</option>
                <option value="Electrical">Electrical</option>
                <option value="Plumbing">Plumbing</option>
                <option value="Fire Fighting">Fire Fighting</option>
                <option value="ELV">ELV</option>
                <option value="General">General MEP</option>
              </select>
            </FormField>
            <FormField label="Progress % Impact">
              <input type="number" min="0" max="100" value={updateProgress} onChange={e => setUpdateProgress(e.target.value)} placeholder="e.g. 65" className={inputCls} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Location / Level">
              <input type="text" value={updateLocation} onChange={e => setUpdateLocation(e.target.value)} placeholder="e.g. Podium Level 2 - Plant Room B" className={inputCls} />
            </FormField>
            <FormField label="Weather">
              <select value={updateWeather} onChange={e => setUpdateWeather(e.target.value)} className={selectCls}>
                <option value="Sunny">Sunny (Normal)</option>
                <option value="Cloudy">Cloudy</option>
                <option value="Rainy">Rain / Wet</option>
                <option value="Extreme Heat">Extreme Heat (&gt;45°C)</option>
                <option value="High Winds">High Winds</option>
              </select>
            </FormField>
          </div>
          <FormField label="Content & Observations" required>
            <textarea rows={4} required value={updateContent} onChange={e => setUpdateContent(e.target.value)} placeholder="Detail the works executed today, inspections attended, material received, manpower on task..." className={inputCls} />
          </FormField>
          <FormField label="Attach Site Photo">
            <div className="flex items-center gap-4">
              <input type="file" accept="image/*" onChange={handleImageUpload} className="text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
              {updateAttachment && (
                <div className="relative">
                  <img src={updateAttachment} alt="Preview" className="w-12 h-12 rounded-lg object-cover border border-gray-200" />
                  <button type="button" onClick={() => setUpdateAttachment(null)} className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5"><X size={10} /></button>
                </div>
              )}
            </div>
          </FormField>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="pinned-check" checked={updatePinned} onChange={e => setUpdatePinned(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4" />
            <label htmlFor="pinned-check" className="text-xs font-semibold text-gray-700 flex items-center gap-1"><Pin size={12} /> Pin update to top of project feed</label>
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
            <button type="button" onClick={() => setShowUpdateModal(false)} className={btnSecondary}>Cancel</button>
            <button type="submit" className={btnPrimary}><Send size={14} /> Publish Update</button>
          </div>
        </form>
      </Modal>

      {/* Modal: Add Task (Enterprise) */}
      <TaskDetailModal
        open={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        onSaved={loadProjectDetails}
        projectId={activeProjectId}
      />

      {/* Modal: Image Zoom */}
      <Modal open={!!selectedImage} onClose={() => setSelectedImage(null)} title="Attached Site Photo" size="lg">
        {selectedImage && (
          <div className="flex flex-col items-center justify-center p-2">
            <img src={selectedImage} alt="Site attachment large" className="max-h-[70vh] rounded-xl object-contain shadow-lg" />
          </div>
        )}
      </Modal>

      {/* Modal: 5x5 Risk Heat Map */}
      <RiskMatrixHeatMapModal
        open={showRiskMatrix}
        onClose={() => setShowRiskMatrix(false)}
        projectId={activeProjectId}
      />
    </div>
  );
}

// ─── Project Updates Page (Live Feed) ──────────────────────────────────────────
function ProjectUpdatesPage({ navigate }: { navigate: (page: Page, param?: string) => void }) {
  const { projects, selectedProject, setSelectedProject } = useProject();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [updates, setUpdates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [tradeFilter, setTradeFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // Form State
  const [projectId, setProjectId] = useState(selectedProject || (projects[0]?.id ?? ''));
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Progress Milestone');
  const [trade, setTrade] = useState('HVAC');
  const [content, setContent] = useState('');
  const [progress, setProgress] = useState('');
  const [location, setLocation] = useState('');
  const [weather, setWeather] = useState('Sunny');
  const [pinned, setPinned] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);

  useEffect(() => {
    if (selectedProject) setProjectId(selectedProject);
  }, [selectedProject]);

  const loadUpdates = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (selectedProject) params.project_id = selectedProject;
      if (categoryFilter !== 'All') params.category = categoryFilter;
      if (tradeFilter !== 'All') params.trade = tradeFilter;
      const data = await updatesApi.list(params);
      setUpdates(Array.isArray(data) ? data : []);
    } catch (err: any) {
      addToast('error', 'Failed to load updates');
    } finally {
      setLoading(false);
    }
  }, [selectedProject, categoryFilter, tradeFilter, addToast]);

  useEffect(() => {
    loadUpdates();
  }, [loadUpdates]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setAttachment(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!projectId) {
      addToast('error', 'Please select a project');
      return;
    }
    if (!title || !content) {
      addToast('error', 'Title and Content are required');
      return;
    }
    try {
      await updatesApi.create({
        project_id: projectId,
        title,
        category,
        trade,
        content,
        progress_percent: progress ? Number(progress) : undefined,
        location: location || undefined,
        weather: weather || undefined,
        pinned: pinned ? 1 : 0,
        attachment_data: attachment || undefined
      });
      addToast('success', 'Site update published');
      setShowModal(false);
      setTitle('');
      setContent('');
      setAttachment(null);
      setProgress('');
      loadUpdates();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to post update');
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this update?')) return;
    try {
      await updatesApi.delete(id);
      addToast('success', 'Update deleted');
      loadUpdates();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to delete update');
    }
  };

  const canPost = ['Admin', 'ProjectManager', 'SiteEngineer', 'SiteSupervisor', 'QAQC', 'SafetyOfficer'].includes(user?.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Project Updates & Live Site Feed</h1>
          <p className="text-gray-500 text-sm mt-0.5">Chronological site activity, milestone accomplishments, quality and safety logs</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadUpdates} className={btnSecondary}><RefreshCw size={14} />Refresh</button>
          {canPost && (
            <button onClick={() => setShowModal(true)} className={btnPrimary}><Plus size={14} />Post Site Update</button>
          )}
        </div>
      </div>

      {/* Filter Header */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-500">Project:</label>
          <select
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            className="text-xs font-semibold border border-gray-200 rounded-xl px-2.5 py-1.5 bg-gray-50 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Projects</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Category Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {['All', 'Progress Milestone', 'Safety Notice', 'Quality Observation', 'Material Delivery', 'Daily Site Log'].map(c => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={cn('px-2.5 py-1 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors',
                categoryFilter === c ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Updates Stream */}
      {loading ? (
        <div className="flex justify-center py-20"><Spinner size={32} /></div>
      ) : updates.length === 0 ? (
        <EmptyState icon={TrendingUp} title="No updates found" subtitle="Publish a site update to notify project managers and stakeholders" />
      ) : (
        <div className="space-y-4">
          {updates.map(u => (
            <Card key={u.id} className={cn('p-5 border border-gray-100 transition-all hover:shadow-md', u.pinned ? 'border-l-4 border-l-amber-500 bg-amber-50/10' : '')}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    {u.pinned ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-bold"><Pin size={10} /> PINNED</span> : null}
                    <Badge label={u.category || 'General'} color="bg-blue-50 text-blue-700" />
                    {u.trade && <span className="text-xs font-semibold px-2 py-0.5 rounded bg-purple-50 text-purple-700">{u.trade}</span>}
                    {u.project_name && (
                      <button onClick={() => { setSelectedProject(u.project_id); navigate('project-detail', u.project_id); }} className="text-xs font-semibold text-blue-600 hover:underline">
                        • {u.project_name}
                      </button>
                    )}
                    {u.progress_percent != null && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                        Progress: {u.progress_percent}%
                      </span>
                    )}
                    {u.weather && (
                      <span className="text-xs px-2 py-0.5 rounded bg-sky-50 text-sky-700 flex items-center gap-1">
                        <Sun size={12} /> {u.weather}
                      </span>
                    )}
                  </div>

                  <h3 className="font-bold text-gray-900 text-lg">{u.title}</h3>
                  <p className="text-sm text-gray-700 mt-2 whitespace-pre-line leading-relaxed">{u.content}</p>

                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50 text-xs text-gray-400">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-gray-700">{u.created_by_name || 'Site Team'}</span>
                      <span>•</span>
                      <span>{fmt(u.created_at)}</span>
                      {u.location && <><span>•</span><span className="flex items-center gap-0.5"><MapPin size={10} />{u.location}</span></>}
                    </div>
                    {['Admin', 'ProjectManager'].includes(user?.role) && (
                      <button onClick={e => handleDelete(u.id, e)} className="text-red-500 hover:text-red-700 transition-colors p-1" title="Delete Update">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {u.attachment_data && (
                  <div className="cursor-pointer flex-shrink-0" onClick={() => setSelectedImage(u.attachment_data)}>
                    <img src={u.attachment_data} alt="Site attachment" className="w-28 h-28 rounded-xl object-cover border border-gray-200 hover:opacity-90 transition-opacity shadow-sm" />
                    <span className="text-[10px] text-gray-400 block text-center mt-1">Click to zoom</span>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal: Post Update */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Post Site Update" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <FormField label="Project" required>
            <select required value={projectId} onChange={e => setProjectId(e.target.value)} className={selectCls}>
              <option value="">Select Project...</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.code || 'MEP'})</option>
              ))}
            </select>
          </FormField>
          <FormField label="Update Title" required>
            <input type="text" required value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Fire Fighting Riser Pressure Testing Level 1-10 Passed" className={inputCls} />
          </FormField>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Category">
              <select value={category} onChange={e => setCategory(e.target.value)} className={selectCls}>
                <option value="Progress Milestone">Progress Milestone</option>
                <option value="Daily Site Log">Daily Site Log</option>
                <option value="Safety Notice">Safety Notice</option>
                <option value="Quality Observation">Quality Observation</option>
                <option value="Material Delivery">Material Delivery</option>
                <option value="Weather Impact">Weather Impact</option>
                <option value="General">General Update</option>
              </select>
            </FormField>
            <FormField label="MEP Trade">
              <select value={trade} onChange={e => setTrade(e.target.value)} className={selectCls}>
                <option value="HVAC">HVAC</option>
                <option value="Electrical">Electrical</option>
                <option value="Plumbing">Plumbing</option>
                <option value="Fire Fighting">Fire Fighting</option>
                <option value="ELV">ELV</option>
                <option value="General">General MEP</option>
              </select>
            </FormField>
            <FormField label="Progress % Impact">
              <input type="number" min="0" max="100" value={progress} onChange={e => setProgress(e.target.value)} placeholder="e.g. 70" className={inputCls} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Site Location / Zone">
              <input type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Tower B - Floor 12" className={inputCls} />
            </FormField>
            <FormField label="Weather Condition">
              <select value={weather} onChange={e => setWeather(e.target.value)} className={selectCls}>
                <option value="Sunny">Sunny (Normal)</option>
                <option value="Cloudy">Cloudy</option>
                <option value="Rainy">Rain / Wet</option>
                <option value="Extreme Heat">Extreme Heat (&gt;45°C)</option>
                <option value="High Winds">High Winds</option>
              </select>
            </FormField>
          </div>
          <FormField label="Content & Observations" required>
            <textarea rows={4} required value={content} onChange={e => setContent(e.target.value)} placeholder="Describe site execution, progress status, QA inspections passed, or blockers..." className={inputCls} />
          </FormField>
          <FormField label="Attach Site Photo">
            <div className="flex items-center gap-4">
              <input type="file" accept="image/*" onChange={handleImageUpload} className="text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
              {attachment && (
                <div className="relative">
                  <img src={attachment} alt="Preview" className="w-12 h-12 rounded-lg object-cover border border-gray-200" />
                  <button type="button" onClick={() => setAttachment(null)} className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5"><X size={10} /></button>
                </div>
              )}
            </div>
          </FormField>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="pinned-feed-check" checked={pinned} onChange={e => setPinned(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4" />
            <label htmlFor="pinned-feed-check" className="text-xs font-semibold text-gray-700 flex items-center gap-1"><Pin size={12} /> Pin update to top of project feed</label>
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
            <button type="button" onClick={() => setShowModal(false)} className={btnSecondary}>Cancel</button>
            <button type="submit" className={btnPrimary}><Send size={14} /> Publish Update</button>
          </div>
        </form>
      </Modal>

      {/* Modal: Image Zoom */}
      <Modal open={!!selectedImage} onClose={() => setSelectedImage(null)} title="Site Photo Attachment" size="lg">
        {selectedImage && (
          <div className="flex flex-col items-center justify-center p-2">
            <img src={selectedImage} alt="Site attachment preview" className="max-h-[70vh] rounded-xl object-contain shadow-lg" />
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── Tasks & Schedule Page ────────────────────────────────────────────────────
function TasksPage({ navigate }: { navigate: (page: Page, param?: string) => void }) {
  const { projects, selectedProject, setSelectedProject } = useProject();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [tradeFilter, setTradeFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (selectedProject) params.project_id = selectedProject;
      const data = await tasksApi.list(params);
      setTasks(Array.isArray(data) ? data : []);
    } catch (err: any) {
      addToast('error', 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [selectedProject, addToast]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const filtered = tasks.filter(t => {
    const matchesStatus = statusFilter === 'All' || t.status === statusFilter;
    const matchesTrade = tradeFilter === 'All' || t.trade === tradeFilter;
    const matchesSearch =
      (t.title || '').toLowerCase().includes(search.toLowerCase()) ||
      (t.description || '').toLowerCase().includes(search.toLowerCase()) ||
      (t.wbs_code || '').toLowerCase().includes(search.toLowerCase());
    return matchesStatus && matchesTrade && matchesSearch;
  });

  const handleOpenCreate = () => {
    setEditingTask(null);
    setShowModal(true);
  };

  const handleOpenEdit = (t: any) => {
    setEditingTask(t);
    setShowModal(true);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      await tasksApi.delete(id);
      addToast('success', 'Task deleted');
      loadTasks();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to delete task');
    }
  };

  const handleQuickStatus = async (task: any, newStatus: string) => {
    try {
      const prog = newStatus === 'Completed' ? 100 : newStatus === 'In Progress' ? Math.max(task.progress || 25, 25) : 0;
      await tasksApi.update(task.id, { status: newStatus, progress: prog });
      addToast('success', `Task status updated to ${newStatus}`);
      loadTasks();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to update status');
    }
  };

  const completedCount = tasks.filter(t => t.status === 'Completed').length;
  const inProgressCount = tasks.filter(t => t.status === 'In Progress').length;
  const blockedCount = tasks.filter(t => t.status === 'Blocked').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tasks & Schedule Programme</h1>
          <p className="text-gray-500 text-sm mt-0.5">Track work breakdowns, installation milestones, and trade completion</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadTasks} className={btnSecondary}><RefreshCw size={14} />Refresh</button>
          <button onClick={handleOpenCreate} className={btnPrimary}><Plus size={14} />Add Task</button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Tasks" value={tasks.length} icon={CheckSquare} color="bg-blue-600" sub="across all packages" />
        <StatCard label="Completed" value={completedCount} icon={CheckCircle} color="bg-emerald-600" sub={`${tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0}% done`} />
        <StatCard label="In Progress" value={inProgressCount} icon={Clock} color="bg-indigo-600" sub="currently executing" />
        <StatCard label="Blocked / Overdue" value={blockedCount} icon={AlertTriangle} color="bg-red-600" sub="requires attention" />
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center gap-2 flex-1 max-w-sm bg-gray-50 px-3 py-2 rounded-xl border border-gray-200">
          <Search size={16} className="text-gray-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="Search tasks, WBS, or description..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-sm w-full focus:outline-none text-gray-800 placeholder-gray-400"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedProject}
            onChange={e => setSelectedProject(e.target.value)}
            className="text-xs font-semibold border border-gray-200 rounded-xl px-2.5 py-2 bg-gray-50 text-gray-800 focus:outline-none"
          >
            <option value="">All Projects</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <select
            value={tradeFilter}
            onChange={e => setTradeFilter(e.target.value)}
            className="text-xs font-semibold border border-gray-200 rounded-xl px-2.5 py-2 bg-gray-50 text-gray-800 focus:outline-none"
          >
            <option value="All">All Trades</option>
            <option value="HVAC">HVAC</option>
            <option value="Electrical">Electrical</option>
            <option value="Plumbing">Plumbing</option>
            <option value="Fire Fighting">Fire Fighting</option>
            <option value="ELV">ELV</option>
          </select>

          <div className="flex items-center gap-1">
            {['All', 'Not Started', 'In Progress', 'Completed', 'Blocked'].map(st => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={cn('px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap',
                  statusFilter === st ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                )}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Task List */}
      {loading ? (
        <div className="flex justify-center py-20"><Spinner size={32} /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={CheckSquare} title="No tasks found" subtitle="Add tasks to assign trades and schedule MEP works" />
      ) : (
        <Card className="divide-y divide-gray-100 overflow-hidden">
          {filtered.map(t => (
            <div key={t.id} className="p-4 hover:bg-gray-50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  {t.wbs_code && <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{t.wbs_code}</span>}
                  <span className={cn('text-xs px-2 py-0.5 rounded font-bold', PRIORITY_COLORS[t.priority || 'Medium'] || 'bg-gray-100 text-gray-700')}>
                    {t.priority || 'Medium'}
                  </span>
                  {t.trade && <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700 font-semibold">{t.trade}</span>}
                  {t.project_name && <span className="text-xs text-gray-400 font-medium">• {t.project_name}</span>}
                </div>

                <h3 className="font-bold text-gray-900 text-base">{t.title}</h3>
                {t.description && <p className="text-xs text-gray-600 mt-1 line-clamp-2">{t.description}</p>}

                <div className="flex items-center gap-2 text-xs text-gray-500 mt-2 flex-wrap">
                  {t.site_name && (
                    <span className="text-[11px] text-gray-700 bg-gray-100 px-2 py-0.5 rounded flex items-center gap-1 font-medium">
                      <MapPin size={11} className="text-emerald-600" /> {t.site_name}
                    </span>
                  )}
                  {t.work_package_code && (
                    <span className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded font-mono font-bold">
                      {t.work_package_code}
                    </span>
                  )}
                  {t.company_name && (
                    <span className="text-[11px] text-gray-500">
                      Sub: <strong className="text-gray-700">{t.company_name}</strong>
                    </span>
                  )}
                  {t.supervisor_name && (
                    <span className="text-[11px] text-gray-500">
                      Sup: <strong className="text-gray-700">{t.supervisor_name}</strong>
                    </span>
                  )}
                  {t.drawing_ref && (
                    <span className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded font-mono">
                      DWG: {t.drawing_ref}
                    </span>
                  )}
                  {t.evidence_required === 1 && (
                    <span className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                      <Shield size={10} /> Evidence Req
                    </span>
                  )}
                  {t.start && <span>Start: {fmtDate(t.start)}</span>}
                  {t.end && <><span>•</span><span>Due: {fmtDate(t.end)}</span></>}
                  {t.assignee && !t.worker_name && <><span>•</span><span className="text-gray-600 font-medium">Assigned: {t.assignee}</span></>}
                </div>
              </div>

              {/* Progress & Quick Status */}
              <div className="flex items-center gap-4 flex-shrink-0">
                <div className="w-32">
                  <div className="flex items-center justify-between text-xs font-semibold mb-1">
                    <span className="text-gray-500">Progress</span>
                    <span className="text-gray-900">{t.progress || 0}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={cn('h-2 rounded-full transition-all duration-500', (t.progress || 0) >= 100 ? 'bg-emerald-500' : 'bg-blue-600')}
                      style={{ width: `${Math.min(t.progress || 0, 100)}%` }}
                    />
                  </div>
                </div>

                <select
                  value={t.status || 'Not Started'}
                  onChange={e => handleQuickStatus(t, e.target.value)}
                  className="text-xs font-semibold border border-gray-200 rounded-xl px-2.5 py-1.5 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Not Started">Not Started</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                  <option value="Blocked">Blocked</option>
                </select>

                <div className="flex items-center gap-1">
                  <button onClick={() => handleOpenEdit(t)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit Task">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={e => handleDelete(t.id, e)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete Task">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Modal: Create / Edit Task (Enterprise TaskDetailModal) */}
      <TaskDetailModal
        open={showModal}
        onClose={() => {
          setShowModal(false);
          setEditingTask(null);
        }}
        onSaved={loadTasks}
        task={editingTask}
        projectId={selectedProject || (projects[0]?.id ?? '')}
      />
    </div>
  );
}

// ─── Generic Page (all other existing modules) ────────────────────────────────
function GenericPage({ page }: { page: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-gray-300">
      <Layers size={64} className="mb-4 opacity-30" />
      <h2 className="text-xl font-semibold text-gray-500 capitalize">{page.replace(/-/g, ' ')}</h2>
      <p className="text-sm text-gray-400 mt-2">This module is fully implemented in the server API.</p>
      <p className="text-xs text-gray-300 mt-1">UI screens for legacy modules are accessible via the existing API endpoints.</p>
    </div>
  );
}

// ─── Toast Provider ───────────────────────────────────────────────────────────
function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const addToast = useCallback((type: Toast['type'], message: string) => {
    const id = crypto.randomUUID();
    setToasts(t => [...t, { id, type, message }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);
  const icons = { success: CheckCircle, error: XCircle, info: AlertCircle };
  const colors = { success: 'bg-green-50 border-green-200 text-green-800', error: 'bg-red-50 border-red-200 text-red-800', info: 'bg-blue-50 border-blue-200 text-blue-800' };

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] space-y-3 max-w-sm">
        {toasts.map(t => {
          const Icon = icons[t.type];
          return (
            <div key={t.id} className={cn('flex items-start gap-3 p-4 rounded-2xl border shadow-lg transition-all', colors[t.type])}>
              <Icon size={18} className="flex-shrink-0 mt-0.5" />
              <p className="text-sm font-medium flex-1">{t.message}</p>
              <button onClick={() => setToasts(x => x.filter(y => y.id !== t.id))} className="opacity-50 hover:opacity-100"><X size={16} /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState('');

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  useEffect(() => {
    if (getToken()) {
      authApi.me().then(u => { setUser(u); }).catch(() => clearToken()).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    if (!user) return;
    try {
      const p = await projectsApi.list();
      setProjects(p);
      if (p.length > 0 && !selectedProject) setSelectedProject(p[0].id);
    } catch {}
  }, [user, selectedProject]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <HardHat size={28} className="text-white" />
          </div>
          <Spinner size={28} />
          <p className="text-gray-400 text-sm mt-3">Loading MEP Platform...</p>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <AuthContext.Provider value={{ user, setUser, logout }}>
        <ProjectContext.Provider value={{ projects, selectedProject, setSelectedProject, reload: loadProjects }}>
          {user ? <AppShell /> : <LoginPage />}
        </ProjectContext.Provider>
      </AuthContext.Provider>
    </ToastProvider>
  );
}
