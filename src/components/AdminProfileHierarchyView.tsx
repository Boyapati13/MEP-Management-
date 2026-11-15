import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, Users, Building2, MapPin, HardHat, UserCheck, Plus,
  Phone, Mail, Briefcase, Layers, CheckCircle2, RefreshCw, X, FolderPlus, Edit3
} from 'lucide-react';
import { api } from '../api';

interface AdminProfileHierarchyViewProps {
  selectedProject?: string;
  user?: any;
  onNavigate?: (routeId: string, param?: string) => void;
  onOpenCreateProject?: () => void;
}

export const AdminProfileHierarchyView: React.FC<AdminProfileHierarchyViewProps> = ({
  selectedProject,
  user,
  onNavigate,
  onOpenCreateProject,
}) => {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modals
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [showAddSite, setShowAddSite] = useState(false);
  const [showAddWorker, setShowAddWorker] = useState(false);
  const [assignProjModal, setAssignProjModal] = useState<any | null>(null);
  const [showAuthorizeMainAdmin, setShowAuthorizeMainAdmin] = useState(false);
  const [showProvisionStakeholder, setShowProvisionStakeholder] = useState(false);
  const [stakeholderFilter, setStakeholderFilter] = useState<string>('ALL');

  const [mainAdminForm, setMainAdminForm] = useState({
    email: '',
    admin_name: '',
    company_name: '',
    username: '',
    password: '',
    plan: 'Enterprise',
    provision_now: true,
    notes: 'Granted Main Admin permission by Our Company via Email ID — authorized to create Employee, Client/Employer & Subcontractor accounts.',
  });

  const [stakeholderForm, setStakeholderForm] = useState({
    stakeholder_type: 'Employee (Internal)',
    role: 'ProjectManager',
    name: '',
    email: '',
    username: '',
    password: '',
    phone: '',
    company: user?.company || '',
    trade: 'Electrical & ELV',
    project_id: selectedProject || '',
    work_package_id: '',
  });

  const [staffForm, setStaffForm] = useState({
    name: '',
    username: '',
    role: 'ProjectManager',
    email: '',
    phone: '',
    company: user?.company || '',
    trade: 'Multi-Discipline MEP',
    project_id: selectedProject || '',
  });

  const [siteForm, setSiteForm] = useState({
    project_id: selectedProject || '',
    name: '',
    address: '',
    city: '',
    supervisor_id: '',
    supervisor_name: '',
  });

  const [workerForm, setWorkerForm] = useState({
    id: '',
    name: '',
    employee_id: '',
    trade: 'Electrical',
    phone: '',
    email: '',
    project_id: selectedProject || '',
    site_id: '',
    supervisor_id: '',
    supervisor_name: '',
    role_on_site: 'MEP Site Technician & Installer',
  });

  const [projLeadershipForm, setProjLeadershipForm] = useState({
    project_id: '',
    project_name: '',
    project_manager_id: '',
    project_manager_name: '',
    site_supervisor_id: '',
    site_supervisor_name: '',
  });

  const loadHierarchy = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<any>('/api/admin/command-hierarchy');
      setData(res);
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to load command hierarchy' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHierarchy();
  }, [loadHierarchy]);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/admin/assign-hierarchy', {
        action: 'create_staff',
        ...staffForm,
      });
      setShowAddStaff(false);
      setNotice({
        type: 'success',
        text: `${staffForm.role === 'ProjectManager' ? 'Project Manager' : 'Site Supervisor'} "${staffForm.name}" added and assigned!`,
      });
      setStaffForm({
        name: '',
        username: '',
        role: 'ProjectManager',
        email: '',
        phone: '',
        company: user?.company || '',
        trade: 'Multi-Discipline MEP',
        project_id: selectedProject || '',
      });
      loadHierarchy();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to create staff member' });
    }
  };

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/admin/assign-hierarchy', {
        action: 'create_site',
        ...siteForm,
      });
      setShowAddSite(false);
      setNotice({ type: 'success', text: `Site "${siteForm.name}" created under supervisor ${siteForm.supervisor_name}!` });
      loadHierarchy();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to create site' });
    }
  };

  const handleSaveWorker = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/admin/assign-hierarchy', {
        action: 'create_or_assign_worker',
        ...workerForm,
      });
      setShowAddWorker(false);
      setNotice({
        type: 'success',
        text: `Worker "${workerForm.name}" assigned to supervisor ${workerForm.supervisor_name}!`,
      });
      loadHierarchy();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to save worker assignment' });
    }
  };

  const handleSaveProjectLeadership = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/admin/assign-hierarchy', {
        action: 'assign_project_leadership',
        ...projLeadershipForm,
      });
      setAssignProjModal(null);
      setNotice({
        type: 'success',
        text: `Updated Project Manager (${projLeadershipForm.project_manager_name}) & Site Supervisor (${projLeadershipForm.site_supervisor_name}) for ${projLeadershipForm.project_name}!`,
      });
      loadHierarchy();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to update project leadership' });
    }
  };

  const handleAuthorizeMainAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res: any = await api.post('/api/admin/assign-hierarchy', {
        action: 'authorize_main_admin',
        ...mainAdminForm,
      });
      setShowAuthorizeMainAdmin(false);
      setNotice({
        type: 'success',
        text: `Our Company granted Main Admin permission to Email ID "${res.email || mainAdminForm.email}" (${mainAdminForm.admin_name} · ${mainAdminForm.company_name})! They can now sign in with their Email ID and create Employee, Client/Employer & Subcontractor accounts.`,
      });
      setMainAdminForm({
        email: '',
        admin_name: '',
        company_name: '',
        username: '',
        password: '',
        plan: 'Enterprise',
        provision_now: true,
        notes: 'Granted Main Admin permission by Our Company via Email ID — authorized to create Employee, Client/Employer & Subcontractor accounts.',
      });
      loadHierarchy();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to authorize Main Admin Email ID' });
    }
  };

  const handleProvisionStakeholder = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res: any = await api.post('/api/admin/assign-hierarchy', {
        action: 'provision_stakeholder',
        ...stakeholderForm,
      });
      setShowProvisionStakeholder(false);
      setNotice({
        type: 'success',
        text: `Created ${stakeholderForm.stakeholder_type} account for "${stakeholderForm.name}" (Login Email ID: ${res.email || stakeholderForm.email} / Username: ${res.username || stakeholderForm.username})!`,
      });
      setStakeholderForm({
        stakeholder_type: 'Employee (Internal)',
        role: 'ProjectManager',
        name: '',
        email: '',
        username: '',
        password: '',
        phone: '',
        company: user?.company || '',
        trade: 'Electrical & ELV',
        project_id: selectedProject || '',
        work_package_id: '',
      });
      loadHierarchy();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to create user account' });
    }
  };

  const handleToggleMainAdminStatus = async (adm: any) => {
    const nextStatus = adm.status === 'Revoked' ? 'Authorized' : 'Revoked';
    try {
      await api.post('/api/admin/assign-hierarchy', {
        action: 'toggle_main_admin_status',
        email: adm.email,
        status: nextStatus,
      });
      setNotice({
        type: 'success',
        text: `Main Admin Email ID "${adm.email}" status updated to ${nextStatus}.`,
      });
      loadHierarchy();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to update Main Admin status' });
    }
  };

  const handleToggleUserStatus = async (u: any) => {
    try {
      await api.put(`/api/users/${u.id}/toggle-status`, {});
      setNotice({
        type: 'success',
        text: `Updated status for "${u.name}" (${u.email || u.username}).`,
      });
      loadHierarchy();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to toggle user status' });
    }
  };

  const openStakeholderModal = (category: 'Employee (Internal)' | 'Client / Employer' | 'Subcontractor' | 'Consultant') => {
    const defaultRole =
      category === 'Client / Employer'
        ? 'Client'
        : category === 'Subcontractor'
        ? 'Subcontractor'
        : category === 'Consultant'
        ? 'Consultant'
        : 'ProjectManager';
    const defaultCompany =
      category === 'Client / Employer'
        ? 'Bank of Valletta (BOV plc)'
        : category === 'Subcontractor'
        ? 'ElectroData Installations Ltd'
        : category === 'Consultant'
        ? 'Enser Ltd Consulting Engineers'
        : 'Enser / BOV MEP Delivery';
    setStakeholderForm({
      stakeholder_type: category,
      role: defaultRole,
      name: '',
      email: '',
      username: '',
      password: '',
      phone: '',
      company: defaultCompany,
      trade: category === 'Client / Employer' ? 'Client / Employer Representative' : 'Electrical & ELV',
      project_id: selectedProject || allProjects[0]?.id || 'bov-st-venera-2618',
      work_package_id: '',
    });
    setShowProvisionStakeholder(true);
  };

  const adminProfile = data?.adminProfile || {
    name: user?.name || 'Executive Administrator',
    username: user?.username || 'admin',
    role: 'Admin',
    email: 'admin@mep.com',
    company: 'MEP FieldHub Enterprise',
    total_project_managers: 0,
    total_projects: 0,
    total_sites: 0,
    total_supervisors: 0,
    total_workers: 0,
  };

  const projectManagers: any[] = data?.projectManagers || [];
  const allSupervisors: any[] = data?.supervisors || [];
  const allProjects: any[] = data?.projects || [];
  const allSites: any[] = data?.sites || [];
  const authorizedMainAdmins: any[] = data?.authorizedMainAdmins || [];
  const allUsers: any[] = data?.users || [];
  const allWorkPackages: any[] = data?.workPackages || [];

  const filteredStakeholders = allUsers.filter((u: any) => {
    if (stakeholderFilter === 'ALL') return true;
    const cat =
      u.stakeholder_type ||
      (u.role === 'Admin'
        ? 'Main Admin'
        : u.role === 'Client'
        ? 'Client / Employer'
        : u.role === 'Subcontractor'
        ? 'Subcontractor'
        : u.role === 'Consultant'
        ? 'Consultant'
        : 'Employee (Internal)');
    return cat === stakeholderFilter;
  });

  return (
    <div className="space-y-6">
      {/* Top Admin Executive Profile & Command Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-blue-950 rounded-2xl border border-slate-800 p-6 text-white shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-300 font-bold text-xl flex-shrink-0">
              <ShieldCheck size={28} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-400/30">
                  ADMIN PROFILE &amp; ORGANIZATIONAL COMMAND TREE
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  Active Session: {adminProfile.username}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white mt-1.5">
                {adminProfile.name} — System Administrator
              </h1>
              <p className="text-xs text-slate-300 mt-1">
                Direct Line-of-Command: <strong>Admin</strong> → <strong>Project Managers</strong> → <strong>Projects &amp; Geofenced Sites</strong> → <strong>Site Supervisors</strong> → <strong>Field Workers &amp; Trades</strong>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenCreateProject && (
              <button
                type="button"
                onClick={onOpenCreateProject}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
              >
                <FolderPlus size={14} /> + New Project
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setStaffForm(s => ({ ...s, role: 'ProjectManager' }));
                setShowAddStaff(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              <Plus size={14} /> + Add PM / Supervisor
            </button>
            <button
              type="button"
              onClick={() => setShowAddSite(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold transition-colors cursor-pointer"
            >
              <MapPin size={14} /> + Add Site
            </button>
            <button
              type="button"
              onClick={() => {
                setWorkerForm({
                  id: '',
                  name: '',
                  employee_id: '',
                  trade: 'Electrical',
                  phone: '',
                  email: '',
                  project_id: selectedProject || allProjects[0]?.id || 'bov-st-venera-2618',
                  site_id: allSites[0]?.id || 'site-2618-l1',
                  supervisor_id: 'usr-sup-elec',
                  supervisor_name: 'Carmelo Vella',
                  role_on_site: 'MEP Site Technician',
                });
                setShowAddWorker(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              <HardHat size={14} /> + Assign Worker
            </button>
            <button
              type="button"
              onClick={loadHierarchy}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
              title="Refresh Hierarchy"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* 5 Command KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-5 pt-5 border-t border-slate-800/90">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Admin Authority</span>
            <p className="text-lg font-bold text-white mt-0.5">{adminProfile.name}</p>
            <span className="text-[11px] text-emerald-400">Full Enterprise RBAC</span>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Project Managers</span>
            <p className="text-xl font-bold text-blue-400 mt-0.5">{adminProfile.total_project_managers}</p>
            <span className="text-[11px] text-slate-400">Reporting to Admin</span>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Projects</span>
            <p className="text-xl font-bold text-white mt-0.5">{adminProfile.total_projects}</p>
            <span className="text-[11px] text-slate-400">Under PM Command</span>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sites &amp; Supervisors</span>
            <p className="text-xl font-bold text-amber-400 mt-0.5">
              {adminProfile.total_sites} Sites · {adminProfile.total_supervisors} Sup.
            </p>
            <span className="text-[11px] text-slate-400">Field Supervision</span>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Assigned Workers</span>
            <p className="text-xl font-bold text-emerald-400 mt-0.5">{adminProfile.total_workers}</p>
            <span className="text-[11px] text-slate-400">Active Trade Roster</span>
          </div>
        </div>
      </div>

      {notice && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs font-semibold flex items-center justify-between ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-[11px] font-bold underline ml-4">
            Dismiss
          </button>
        </div>
      )}

      {/* ======================================================================
          3-TIER ENTERPRISE ERP ACCESS & ACCOUNT PROVISIONING HUB
          Tier 1: Platform Owner (Our Company) -> Grants Permission to Main Admin (by Email ID)
          Tier 2: Organization Main Admin -> Creates Accounts for Employees, Clients/Employers & Subcontractors
          Tier 3: Project Delivery & External Portals -> PMs, Supervisors, Clients, Subcontractors & Workers
          ====================================================================== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-blue-950 px-6 py-4 text-white flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-500/30 text-indigo-200 border border-indigo-400/40">
                3-Tier Enterprise ERP Access Architecture
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                Email ID Based Authorization
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-bold text-white mt-1">
              Tier 1: Our Company (Platform Owner) → Tier 2: Organization Main Admin (Email ID) → Tier 3: Employees, Clients &amp; Subcontractors
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              <strong>Tier 1 (Our Company)</strong> grants Main Admin permission to an Email ID. <strong>Tier 2 (Main Admin)</strong> signs in with their Email ID and creates accounts for <strong>Tier 3 (Employees/PMs/Supervisors, Clients/Employers, Consultants &amp; Subcontractors)</strong> scoped to their Project &amp; Work Package portals.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAuthorizeMainAdmin(true)}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <ShieldCheck size={14} /> + Tier 1→2: Authorize Main Admin (Email ID)
            </button>
            <button
              type="button"
              onClick={() => openStakeholderModal('Employee (Internal)')}
              className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Plus size={14} /> + Tier 2→3: Create Employee / Client / Subcontractor
            </button>
          </div>
        </div>

        {/* 3-Tier Visual Architecture Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-5 pt-4 bg-slate-50/50">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-600 text-white">
                Tier 1 · Platform Super Admin
              </span>
              <span className="text-[10px] font-mono font-bold text-indigo-800">Our Company</span>
            </div>
            <p className="text-xs font-bold text-slate-900 mt-1.5">Platform Owner &amp; Tenant Licensing</p>
            <p className="text-[11px] text-slate-600 mt-0.5">
              Whitelists &amp; grants <strong>Main Admin</strong> permission by <strong>Email ID</strong>, assigns Enterprise plans, and can activate or revoke tenant Main Admins.
            </p>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-600 text-white">
                Tier 2 · Organization Main Admin
              </span>
              <span className="text-[10px] font-mono font-bold text-blue-800">Email ID Verified</span>
            </div>
            <p className="text-xs font-bold text-slate-900 mt-1.5">Company / Tenant Main Administrator</p>
            <p className="text-[11px] text-slate-600 mt-0.5">
              Activates account via authorized <strong>Email ID</strong>, creates Projects &amp; Sites, and provisions accounts for <strong>Employees, Clients &amp; Subcontractors</strong>.
            </p>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-600 text-white">
                Tier 3 · Scoped Role Portals
              </span>
              <span className="text-[10px] font-mono font-bold text-emerald-800">Project &amp; WBS Scoped</span>
            </div>
            <p className="text-xs font-bold text-slate-900 mt-1.5">Employees, Clients &amp; Subcontractors</p>
            <p className="text-[11px] text-slate-600 mt-0.5">
              Routes on login to <strong>Internal ERP</strong> (PMs/Supervisors), <strong>Client Portal</strong> (Employers), <strong>Subcontractor Portal</strong> (WBS Package), or <strong>Worker Mobile App</strong>.
            </p>
          </div>
        </div>

        <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 bg-slate-50/50">
          {/* Tier 1 Card: Our Company -> Main Admin Email ID Permissions */}
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-4 flex flex-col justify-between space-y-3 shadow-2xs">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-50 text-indigo-800 border border-indigo-200">
                    Tier 1 → Tier 2 · Platform Owner (Our Company)
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 mt-1">
                    Authorized Main Admin Accounts (by Email ID)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Main Admin Email IDs granted permission by Our Company to manage their organization and provision Tier 3 accounts.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAuthorizeMainAdmin(true)}
                  className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold flex items-center gap-1 flex-shrink-0 cursor-pointer"
                >
                  <Plus size={12} /> Grant Email ID
                </button>
              </div>

              <div className="space-y-2 max-h-[270px] overflow-y-auto pr-1">
                {authorizedMainAdmins.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-4 text-center">No Main Admin Email IDs authorized yet.</p>
                ) : (
                  authorizedMainAdmins.map((adm: any) => (
                    <div
                      key={adm.id || adm.email}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 flex items-start justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-slate-900">{adm.admin_name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                            {adm.plan || 'Enterprise'}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-indigo-700 font-semibold mt-0.5 flex items-center gap-1">
                          <Mail size={11} /> {adm.email}
                          {adm.username ? <span className="text-slate-400">(@{adm.username})</span> : null}
                        </div>
                        <div className="text-[11px] text-slate-600 mt-0.5">
                          Company: <strong>{adm.company_name}</strong> · By: {adm.authorized_by || 'Our Company'}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            adm.status === 'Activated'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : adm.status === 'Revoked'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {adm.status || 'Authorized'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleToggleMainAdminStatus(adm)}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded border cursor-pointer transition-colors ${
                            adm.status === 'Revoked'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                          }`}
                        >
                          {adm.status === 'Revoked' ? 'Restore Permission' : 'Revoke'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl bg-indigo-50/70 border border-indigo-200/80 p-2.5 text-[11px] text-indigo-950">
              <strong>How Main Admin Signs In:</strong> The Main Admin can sign in on the Login screen using their <strong>Email ID</strong> (e.g. <code className="font-mono bg-white px-1 py-0.5 rounded border border-indigo-200">admin.bov@enser.com.mt</code>) or click <em>"Activate Main Admin (Email ID)"</em> on the Login page.
            </div>
          </div>

          {/* Tier 2 Card: Main Admin -> Provision Employees, Clients/Employers & Subcontractors */}
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
              <div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-50 text-blue-800 border border-blue-200">
                  Tier 2 → Tier 3 · Main Admin Account Provisioning
                </span>
                <h3 className="text-sm font-bold text-slate-900 mt-1">
                  Create Tier 3 Accounts for Employees, Clients/Employers &amp; Subcontractors
                </h3>
                <p className="text-[11px] text-slate-500">
                  Once logged in, the Main Admin creates role-scoped Tier 3 accounts with Email ID &amp; Password for internal staff and external partners.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openStakeholderModal('Employee (Internal)')}
                  className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold cursor-pointer"
                >
                  + Employee
                </button>
                <button
                  type="button"
                  onClick={() => openStakeholderModal('Client / Employer')}
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer"
                >
                  + Client / Employer
                </button>
                <button
                  type="button"
                  onClick={() => openStakeholderModal('Subcontractor')}
                  className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold cursor-pointer"
                >
                  + Subcontractor
                </button>
                <button
                  type="button"
                  onClick={() => openStakeholderModal('Consultant')}
                  className="px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-bold cursor-pointer"
                >
                  + Consultant
                </button>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {['ALL', 'Main Admin', 'Employee (Internal)', 'Client / Employer', 'Subcontractor', 'Consultant'].map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setStakeholderFilter(cat)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap cursor-pointer transition-colors ${
                    stakeholderFilter === cat
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat === 'ALL' ? `All Accounts (${allUsers.length})` : cat}
                </button>
              ))}
            </div>

            {/* Provisioned Accounts Table */}
            <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[260px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-500">
                    <th className="py-2 px-3">Name &amp; Company</th>
                    <th className="py-2 px-3">Login Email ID / Username</th>
                    <th className="py-2 px-3">Account Category &amp; Role</th>
                    <th className="py-2 px-3">Portal &amp; Project Scope</th>
                    <th className="py-2 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStakeholders.map((u: any) => {
                    const cat =
                      u.stakeholder_type ||
                      (u.role === 'Admin'
                        ? 'Main Admin'
                        : u.role === 'Client'
                        ? 'Client / Employer'
                        : u.role === 'Subcontractor'
                        ? 'Subcontractor'
                        : u.role === 'Consultant'
                        ? 'Consultant'
                        : 'Employee (Internal)');
                    const badgeCls =
                      cat === 'Main Admin'
                        ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                        : cat === 'Client / Employer'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : cat === 'Subcontractor'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : cat === 'Consultant'
                        ? 'bg-purple-50 text-purple-800 border-purple-200'
                        : 'bg-blue-50 text-blue-800 border-blue-200';
                    const portalName =
                      u.role === 'Client'
                        ? 'Client / Employer Portal'
                        : u.role === 'Subcontractor'
                        ? 'Subcontractor Portal'
                        : u.role === 'Worker'
                        ? 'Worker Field Mobile App'
                        : u.role === 'Admin'
                        ? 'Full Main Admin Console'
                        : 'Internal Engineering ERP';
                    const isSuspended = u.status === 'Suspended' || u.status === 'Inactive';
                    return (
                      <tr key={u.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3">
                          <div className="font-bold text-slate-900">{u.name}</div>
                          <div className="text-[11px] text-slate-500">{u.company || 'MEP Delivery'} · {u.trade || 'All Trades'}</div>
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px]">
                          <div className="text-blue-700 font-semibold">{u.email || `${u.username}@mepfieldhub.com`}</div>
                          <div className="text-slate-400">@{u.username}</div>
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badgeCls}`}>
                            {cat} ({u.role})
                          </span>
                          {u.created_by_admin && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              By: {u.created_by_admin}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-[11px]">
                          <div className="font-semibold text-slate-800">{portalName}</div>
                          <div className="text-[10px] text-slate-500 truncate max-w-[180px]">
                            {u.project_names || (u.role === 'Admin' ? 'All Enterprise Projects' : 'BOV St. Venera (Job 2618)')}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                isSuspended
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              }`}
                            >
                              {u.status || 'Active'}
                            </span>
                            {u.username !== 'admin' && (
                              <button
                                type="button"
                                onClick={() => handleToggleUserStatus(u)}
                                className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"
                              >
                                {isSuspended ? 'Activate' : 'Suspend'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Command Tree: Project Managers -> Projects -> Sites & Site Supervisors -> Workers */}
      <div className="space-y-6">
        {loading && !data ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-sm text-slate-500">
            Loading Admin Command Hierarchy (Project Managers, Sites, Site Supervisors &amp; Workers)...
          </div>
        ) : (
          projectManagers.map((pm: any) => (
            <div key={pm.id} className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              {/* Project Manager Header */}
              <div className="bg-slate-900 text-white px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-sm flex-shrink-0 shadow-xs">
                    PM
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-500/20 text-blue-300 border border-blue-400/30">
                        Project Manager (Reports to Admin)
                      </span>
                      <span className="text-xs text-slate-400 font-mono">@{pm.username}</span>
                    </div>
                    <h2 className="text-base sm:text-lg font-bold text-white mt-0.5">{pm.name}</h2>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 mt-0.5">
                      {pm.company && <span className="flex items-center gap-1"><Building2 size={12} className="text-blue-400" /> {pm.company}</span>}
                      {pm.trade && <span className="flex items-center gap-1"><Layers size={12} className="text-amber-400" /> {pm.trade}</span>}
                      {pm.email && <span className="flex items-center gap-1"><Mail size={12} className="text-slate-400" /> {pm.email}</span>}
                      {pm.phone && <span className="flex items-center gap-1"><Phone size={12} className="text-emerald-400" /> {pm.phone}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-center">
                  <span className="px-3 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200">
                    {pm.total_projects} Project(s) · {pm.total_sites} Site(s) · {pm.total_workers} Worker(s)
                  </span>
                </div>
              </div>

              {/* Projects under this Project Manager */}
              <div className="p-5 space-y-6 bg-slate-50/50">
                {pm.projects.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No active projects currently assigned to {pm.name}.</p>
                ) : (
                  pm.projects.map((proj: any) => (
                    <div key={proj.id} className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                      {/* Project Bar */}
                      <div className="px-5 py-3.5 bg-slate-100/80 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-600 text-white">
                              {proj.code || 'JOB-2618'}
                            </span>
                            <span className="text-sm font-bold text-slate-900">{proj.name}</span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              {proj.status || 'Active'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5">
                            Client: <strong>{proj.client || 'Bank of Valletta'}</strong> · Location: <strong>{proj.location || 'Santa Venera, Malta'}</strong> · Lead Site Supervisor: <strong className="text-amber-800">{proj.site_supervisor_name || 'Carmelo Vella'}</strong>
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setProjLeadershipForm({
                                project_id: proj.id,
                                project_name: proj.name,
                                project_manager_id: proj.project_manager_id || pm.id,
                                project_manager_name: proj.project_manager_name || pm.name,
                                site_supervisor_id: proj.site_supervisor_id || 'usr-sup-elec',
                                site_supervisor_name: proj.site_supervisor_name || 'Carmelo Vella',
                              });
                              setAssignProjModal(proj);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-semibold cursor-pointer"
                          >
                            <Edit3 size={12} /> Change PM / Site Supervisor
                          </button>
                          {onNavigate && (
                            <button
                              type="button"
                              onClick={() => onNavigate('project-detail', proj.id)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
                            >
                              Open Project
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Sites -> Site Supervisors -> Workers under this Project */}
                      <div className="p-5 space-y-5">
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                            <MapPin size={14} className="text-blue-600" />
                            Sites &amp; Assigned Site Supervisors ({proj.sites.length} Active Sites)
                          </h4>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {proj.sites.map((site: any) => (
                              <div key={site.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                                <div className="flex items-start justify-between gap-2 border-b border-slate-200/80 pb-2.5">
                                  <div>
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-100 text-blue-800 border border-blue-200">
                                      Geofenced Site ({site.geofence_radius_m || 120}m)
                                    </span>
                                    <h5 className="font-bold text-slate-900 text-sm mt-1">{site.name}</h5>
                                    <p className="text-[11px] text-slate-500">{site.address}, {site.city}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setWorkerForm({
                                        id: '',
                                        name: '',
                                        employee_id: '',
                                        trade: 'Electrical',
                                        phone: '',
                                        email: '',
                                        project_id: proj.id,
                                        site_id: site.id,
                                        supervisor_id: site.supervisor?.id || 'usr-sup-elec',
                                        supervisor_name: site.supervisor?.name || site.supervisor_name || 'Carmelo Vella',
                                        role_on_site: 'MEP Site Technician',
                                      });
                                      setShowAddWorker(true);
                                    }}
                                    className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold flex items-center gap-1 flex-shrink-0 cursor-pointer"
                                  >
                                    <Plus size={12} /> Add Worker
                                  </button>
                                </div>

                                {/* Site Supervisor Card */}
                                <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-3 flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
                                      SUP
                                    </div>
                                    <div>
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                                        Site Supervisor (Reports to {pm.name})
                                      </span>
                                      <p className="text-xs font-bold text-slate-900">
                                        {site.supervisor?.name || site.supervisor_name || 'Carmelo Vella'}
                                      </p>
                                      <p className="text-[11px] text-slate-600">
                                        {site.supervisor?.trade || 'MEP Field Supervision'} {site.supervisor?.phone ? `· ${site.supervisor.phone}` : ''}
                                      </p>
                                    </div>
                                  </div>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white text-amber-900 border border-amber-300">
                                    {site.workers?.length || 0} Workers
                                  </span>
                                </div>

                                {/* Workers under this Site & Site Supervisor */}
                                <div className="space-y-1.5">
                                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                    Workers on {site.name} ({site.workers?.length || 0}):
                                  </div>
                                  {(!site.workers || site.workers.length === 0) ? (
                                    <p className="text-xs text-slate-400 italic py-2">No workers assigned to this site yet.</p>
                                  ) : (
                                    site.workers.map((w: any) => (
                                      <div
                                        key={w.id}
                                        className="bg-white rounded-lg border border-slate-200 px-3 py-2 flex items-center justify-between gap-2 text-xs"
                                      >
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-1.5 flex-wrap">
                                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700">
                                              {w.employee_id || 'EMP'}
                                            </span>
                                            <span className="font-bold text-slate-900">{w.name}</span>
                                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                              {w.trade || 'MEP'}
                                            </span>
                                          </div>
                                          <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                            {w.role_on_site || 'Site Technician'} · Supervisor: <strong className="text-slate-700">{w.supervisor_name || site.supervisor_name || 'Carmelo Vella'}</strong>
                                          </p>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setWorkerForm({
                                              id: w.id,
                                              name: w.name,
                                              employee_id: w.employee_id || '',
                                              trade: w.trade || 'Electrical',
                                              phone: w.phone || '',
                                              email: w.email || '',
                                              project_id: w.project_id || proj.id,
                                              site_id: w.site_id || site.id,
                                              supervisor_id: w.supervisor_id || 'usr-sup-elec',
                                              supervisor_name: w.supervisor_name || 'Carmelo Vella',
                                              role_on_site: w.role_on_site || 'Site Technician',
                                            });
                                            setShowAddWorker(true);
                                          }}
                                          className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 flex-shrink-0 cursor-pointer"
                                        >
                                          Edit
                                        </button>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal: Add Project Manager or Site Supervisor */}
      {showAddStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCreateStaff} className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-base">Add Project Manager or Site Supervisor</h3>
              <button type="button" onClick={() => setShowAddStaff(false)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Role in Hierarchy *</label>
                <select
                  value={staffForm.role}
                  onChange={e => setStaffForm(s => ({ ...s, role: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                >
                  <option value="ProjectManager">Project Manager</option>
                  <option value="SiteEngineer">Site Supervisor / Site Engineer</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Primary Trade</label>
                <input
                  value={staffForm.trade}
                  onChange={e => setStaffForm(s => ({ ...s, trade: e.target.value }))}
                  placeholder="Electrical / HVAC"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Full Name *</label>
                <input
                  required
                  value={staffForm.name}
                  onChange={e => setStaffForm(s => ({ ...s, name: e.target.value }))}
                  placeholder="e.g. Ing. Paul Borg"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Login Username</label>
                <input
                  value={staffForm.username}
                  onChange={e => setStaffForm(s => ({ ...s, username: e.target.value }))}
                  placeholder="pborg"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Email</label>
                <input
                  value={staffForm.email}
                  onChange={e => setStaffForm(s => ({ ...s, email: e.target.value }))}
                  placeholder="p.borg@enser.com.mt"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Phone</label>
                <input
                  value={staffForm.phone}
                  onChange={e => setStaffForm(s => ({ ...s, phone: e.target.value }))}
                  placeholder="+356 7900 0000"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Assign to Project</label>
              <select
                value={staffForm.project_id}
                onChange={e => setStaffForm(s => ({ ...s, project_id: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              >
                {allProjects.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddStaff(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold">
                Save &amp; Assign
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Add Site */}
      {showAddSite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCreateSite} className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-base">Add Project Site &amp; Assign Supervisor</h3>
              <button type="button" onClick={() => setShowAddSite(false)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Project *</label>
              <select
                value={siteForm.project_id}
                onChange={e => setSiteForm(s => ({ ...s, project_id: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              >
                {allProjects.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Site / Zone Name *</label>
              <input
                required
                value={siteForm.name}
                onChange={e => setSiteForm(s => ({ ...s, name: e.target.value }))}
                placeholder="e.g. BOV Rooftop Chiller & VRF Deck"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Site Supervisor *</label>
              <select
                value={siteForm.supervisor_id}
                onChange={e => {
                  const sup = allSupervisors.find((u: any) => u.id === e.target.value);
                  setSiteForm(s => ({
                    ...s,
                    supervisor_id: e.target.value,
                    supervisor_name: sup ? `${sup.name} (${sup.trade || 'Supervisor'})` : s.supervisor_name,
                  }));
                }}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              >
                {allSupervisors.map((sup: any) => (
                  <option key={sup.id} value={sup.id}>
                    {sup.name} — {sup.trade || sup.role}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddSite(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold">
                Create Site
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Add or Edit Worker Assignment */}
      {showAddWorker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleSaveWorker} className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-base">
                {workerForm.id ? 'Update Worker Assignment' : 'Assign Worker to Site & Supervisor'}
              </h3>
              <button type="button" onClick={() => setShowAddWorker(false)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Worker Full Name *</label>
                <input
                  required
                  value={workerForm.name}
                  onChange={e => setWorkerForm(s => ({ ...s, name: e.target.value }))}
                  placeholder="e.g. Jean-Paul Vella"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Employee ID</label>
                <input
                  value={workerForm.employee_id}
                  onChange={e => setWorkerForm(s => ({ ...s, employee_id: e.target.value }))}
                  placeholder="EMP-2618-09"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">MEP Trade</label>
                <select
                  value={workerForm.trade}
                  onChange={e => setWorkerForm(s => ({ ...s, trade: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                >
                  <option value="Electrical">Electrical</option>
                  <option value="HVAC">HVAC &amp; Mechanical</option>
                  <option value="ELV / Data">ELV / Data</option>
                  <option value="Fire">Fire Alarm &amp; Protection</option>
                  <option value="Plumbing">Plumbing</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Role on Site</label>
                <input
                  value={workerForm.role_on_site}
                  onChange={e => setWorkerForm(s => ({ ...s, role_on_site: e.target.value }))}
                  placeholder="Lead Electrician / Fitter"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Assigned Site *</label>
              <select
                value={workerForm.site_id}
                onChange={e => setWorkerForm(s => ({ ...s, site_id: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              >
                {allSites.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Reporting Site Supervisor *</label>
              <select
                value={workerForm.supervisor_id}
                onChange={e => {
                  const sup = allSupervisors.find((u: any) => u.id === e.target.value);
                  setWorkerForm(s => ({
                    ...s,
                    supervisor_id: e.target.value,
                    supervisor_name: sup ? sup.name : s.supervisor_name,
                  }));
                }}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              >
                {allSupervisors.map((sup: any) => (
                  <option key={sup.id} value={sup.id}>
                    {sup.name} ({sup.trade || sup.role})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddWorker(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold">
                Save Worker Assignment
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Reassign Project Manager & Site Supervisor on Project */}
      {assignProjModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleSaveProjectLeadership} className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-base">Assign Project Manager &amp; Lead Site Supervisor</h3>
              <button type="button" onClick={() => setAssignProjModal(null)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Project: <strong className="text-slate-800">{projLeadershipForm.project_name}</strong>
            </p>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Project Manager</label>
              <select
                value={projLeadershipForm.project_manager_id}
                onChange={e => {
                  const pm = projectManagers.find((u: any) => u.id === e.target.value);
                  setProjLeadershipForm(s => ({
                    ...s,
                    project_manager_id: e.target.value,
                    project_manager_name: pm ? pm.name : s.project_manager_name,
                  }));
                }}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              >
                {projectManagers.map((pm: any) => (
                  <option key={pm.id} value={pm.id}>{pm.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Lead Site Supervisor</label>
              <select
                value={projLeadershipForm.site_supervisor_id}
                onChange={e => {
                  const sup = allSupervisors.find((u: any) => u.id === e.target.value);
                  setProjLeadershipForm(s => ({
                    ...s,
                    site_supervisor_id: e.target.value,
                    site_supervisor_name: sup ? `${sup.name} (${sup.trade || 'Supervisor'})` : s.site_supervisor_name,
                  }));
                }}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              >
                {allSupervisors.map((sup: any) => (
                  <option key={sup.id} value={sup.id}>{sup.name} ({sup.trade || sup.role})</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setAssignProjModal(null)} className="px-4 py-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold">
                Save Leadership
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Step 1 — Our Company Grants Permission to Main Admin by Email ID */}
      {showAuthorizeMainAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleAuthorizeMainAdmin} className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-50 text-indigo-800 border border-indigo-200">
                  Step 1 · Our Company (Platform Owner)
                </span>
                <h3 className="font-bold text-slate-900 text-base mt-1">
                  Grant Main Admin Permission by Email ID
                </h3>
              </div>
              <button type="button" onClick={() => setShowAuthorizeMainAdmin(false)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
              Enter the <strong>Main Admin&apos;s Email ID</strong> below to grant them Main Admin authority. Once authorized, they can sign in with their Email ID and create user accounts for their <strong>Employees</strong>, <strong>Employers / Clients</strong>, and <strong>Subcontractors</strong>.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                  Main Admin Email ID (Login Identifier) *
                </label>
                <input
                  required
                  type="email"
                  value={mainAdminForm.email}
                  onChange={e => setMainAdminForm(s => ({ ...s, email: e.target.value }))}
                  placeholder="e.g. admin@company.com or director@bov.com"
                  className="w-full px-3 py-2.5 text-xs border border-slate-300 rounded-xl font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Main Admin Full Name *</label>
                <input
                  required
                  value={mainAdminForm.admin_name}
                  onChange={e => setMainAdminForm(s => ({ ...s, admin_name: e.target.value }))}
                  placeholder="e.g. Ing. Christian Borg"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Organization / Company *</label>
                <input
                  required
                  value={mainAdminForm.company_name}
                  onChange={e => setMainAdminForm(s => ({ ...s, company_name: e.target.value }))}
                  placeholder="e.g. Enser / BOV MEP Delivery"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Optional Username</label>
                <input
                  value={mainAdminForm.username}
                  onChange={e => setMainAdminForm(s => ({ ...s, username: e.target.value }))}
                  placeholder="Auto-derived from Email ID if blank"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Initial Password</label>
                <input
                  type="password"
                  value={mainAdminForm.password}
                  onChange={e => setMainAdminForm(s => ({ ...s, password: e.target.value }))}
                  placeholder="Default: admin123 (or set custom)"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <label className="flex items-center gap-2 text-xs text-slate-700 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={mainAdminForm.provision_now}
                  onChange={e => setMainAdminForm(s => ({ ...s, provision_now: e.target.checked }))}
                  className="rounded border-slate-300 text-indigo-600"
                />
                Activate Main Admin login immediately (or let them self-activate on Login page)
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAuthorizeMainAdmin(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold">
                Grant Main Admin Permission
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Step 2 — Main Admin Creates Account for Employee, Client/Employer, or Subcontractor */}
      {showProvisionStakeholder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleProvisionStakeholder} className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-50 text-blue-800 border border-blue-200">
                  Step 2 · Main Admin Account Provisioning
                </span>
                <h3 className="font-bold text-slate-900 text-base mt-1">
                  Create Account for Employee, Client/Employer or Subcontractor
                </h3>
              </div>
              <button type="button" onClick={() => setShowProvisionStakeholder(false)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            {/* Category Selector Tabs */}
            <div className="grid grid-cols-4 gap-1.5 bg-slate-100 p-1.5 rounded-xl">
              {(
                [
                  ['Employee (Internal)', 'ProjectManager', 'Employee / Staff'],
                  ['Client / Employer', 'Client', 'Client / Employer'],
                  ['Subcontractor', 'Subcontractor', 'Subcontractor'],
                  ['Consultant', 'Consultant', 'Consultant'],
                ] as const
              ).map(([cat, defRole, label]) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() =>
                    setStakeholderForm(s => ({
                      ...s,
                      stakeholder_type: cat,
                      role: defRole,
                      company:
                        cat === 'Client / Employer'
                          ? 'Bank of Valletta (BOV plc)'
                          : cat === 'Subcontractor'
                          ? 'ElectroData Installations Ltd'
                          : cat === 'Consultant'
                          ? 'Enser Ltd Consulting Engineers'
                          : 'Enser / BOV MEP Delivery',
                    }))
                  }
                  className={`py-2 px-2 rounded-lg text-[11px] font-bold text-center transition-colors cursor-pointer ${
                    stakeholderForm.stakeholder_type === cat
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'text-slate-600 hover:bg-white/60'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Full Name *</label>
                <input
                  required
                  value={stakeholderForm.name}
                  onChange={e => setStakeholderForm(s => ({ ...s, name: e.target.value }))}
                  placeholder="e.g. Mr. Sandro Mallia / Ing. Simon Pace"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Email ID (Login) *</label>
                <input
                  required
                  type="email"
                  value={stakeholderForm.email}
                  onChange={e => setStakeholderForm(s => ({ ...s, email: e.target.value }))}
                  placeholder="user@company.com"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Username</label>
                <input
                  value={stakeholderForm.username}
                  onChange={e => setStakeholderForm(s => ({ ...s, username: e.target.value }))}
                  placeholder="Auto-filled from Email if blank"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Password *</label>
                <input
                  type="password"
                  value={stakeholderForm.password}
                  onChange={e => setStakeholderForm(s => ({ ...s, password: e.target.value }))}
                  placeholder="Default: admin123"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Security Role / Portal *</label>
                <select
                  value={stakeholderForm.role}
                  onChange={e => setStakeholderForm(s => ({ ...s, role: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl bg-white"
                >
                  {stakeholderForm.stakeholder_type === 'Employee (Internal)' ? (
                    <>
                      <option value="ProjectManager">Project Manager</option>
                      <option value="SiteEngineer">Site Supervisor / Site Engineer</option>
                      <option value="CommercialManager">Commercial Manager / QS</option>
                      <option value="QAQC">QA/QC &amp; Commissioning Engineer</option>
                      <option value="SafetyOfficer">HSE Safety Officer</option>
                      <option value="Worker">Field Worker (Mobile App)</option>
                    </>
                  ) : stakeholderForm.stakeholder_type === 'Client / Employer' ? (
                    <option value="Client">Client / Employer Representative (Client Portal)</option>
                  ) : stakeholderForm.stakeholder_type === 'Subcontractor' ? (
                    <option value="Subcontractor">Subcontractor (Subcontractor Portal)</option>
                  ) : (
                    <option value="Consultant">Supervising Consultant (Approval Authority)</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Company / Organization *</label>
                <input
                  required
                  value={stakeholderForm.company}
                  onChange={e => setStakeholderForm(s => ({ ...s, company: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Trade / Department</label>
                <input
                  value={stakeholderForm.trade}
                  onChange={e => setStakeholderForm(s => ({ ...s, trade: e.target.value }))}
                  placeholder="Electrical / HVAC / Client Rep"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Assigned Project Scope *</label>
                <select
                  value={stakeholderForm.project_id}
                  onChange={e => setStakeholderForm(s => ({ ...s, project_id: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl bg-white"
                >
                  <option value="ALL">All Enterprise Projects</option>
                  {allProjects.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {stakeholderForm.role === 'Subcontractor' && allWorkPackages.length > 0 && (
                <div className="col-span-2">
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                    Assigned Subcontractor Work Package (WBS Scope)
                  </label>
                  <select
                    value={stakeholderForm.work_package_id}
                    onChange={e => setStakeholderForm(s => ({ ...s, work_package_id: e.target.value }))}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl bg-white"
                  >
                    <option value="">Auto-Match by Trade ({stakeholderForm.trade || 'Electrical / HVAC'})</option>
                    {allWorkPackages
                      .filter((wp: any) => stakeholderForm.project_id === 'ALL' || wp.project_id === stakeholderForm.project_id)
                      .map((wp: any) => (
                        <option key={wp.id} value={wp.id}>
                          [{wp.code || wp.id}] {wp.name} ({wp.discipline || wp.trade || 'MEP'})
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowProvisionStakeholder(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold">
                Create {stakeholderForm.stakeholder_type} Account
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
