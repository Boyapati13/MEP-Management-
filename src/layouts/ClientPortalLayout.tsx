/**
 * MEP Management Platform — V1.4.1 Client Executive Portal Layout
 * Curated, high-fidelity project oversight with zero leakage of internal disputes or commercial margins.
 */
import React, { useState } from 'react';
import {
  LayoutDashboard,
  FileText,
  FileSpreadsheet,
  CalendarDays,
  MessageSquare,
  LogOut,
  Building2,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';

interface ClientPortalLayoutProps {
  user: any;
  logout: () => void;
  selectedProject: string;
  projects: any[];
  onSelectProject: (id: string) => void;
  renderContent: (currentTab: string) => React.ReactNode;
}

export const ClientPortalLayout: React.FC<ClientPortalLayoutProps> = ({
  user,
  logout,
  selectedProject,
  projects,
  onSelectProject,
  renderContent
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'programme' | 'progress' | 'documents' | 'clarifications'>('overview');

  const navItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'programme', label: 'Programme', icon: CalendarDays },
    { id: 'progress', label: 'Progress', icon: FileSpreadsheet },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'clarifications', label: 'Clarifications', icon: MessageSquare }
  ] as const;

  const currentProject = projects.find(p => p.id === selectedProject);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col flex-shrink-0">
        {/* Branding */}
        <div className="p-4 border-b border-slate-800 flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-500 rounded-xl flex items-center justify-center text-white shadow-sm">
            <Building2 size={20} />
          </div>
          <div>
            <h1 className="font-bold text-sm text-white leading-tight">Client Portal</h1>
            <span className="text-[10px] font-semibold text-blue-400 bg-blue-900/50 px-1.5 py-0.5 rounded border border-blue-700/50">
              Project Portal
            </span>
          </div>
        </div>

        {/* Project Selector */}
        <div className="p-3 border-b border-slate-800 bg-slate-950/40">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
            Project
          </label>
          <select
            value={selectedProject}
            onChange={e => onSelectProject(e.target.value)}
            className="w-full text-xs font-semibold bg-slate-800 border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Navigation items */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User Card & Logout */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between">
          <div className="truncate mr-2">
            <p className="text-xs font-bold text-white truncate">{user.name || 'Client Representative'}</p>
            <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
          </div>
          <button
            onClick={logout}
            className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition-colors"
            title="Sign Out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-14 bg-white border-b border-gray-200 px-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="font-semibold text-gray-800">{currentProject?.name || 'Project'}</span>
            <ChevronRight size={14} />
            <span className="capitalize">{activeTab.replace('-', ' ')}</span>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
            <ShieldCheck size={14} className="text-blue-600" />
            <span>Published client information</span>
          </div>
        </header>

        {/* Dynamic content */}
        <div className="flex-1 overflow-y-auto p-6">
          {renderContent(activeTab)}
        </div>
      </main>
    </div>
  );
};
