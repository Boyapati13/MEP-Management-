/**
 * MEP Management Platform — V1.4.1 Subcontractor Isolated Workspace Layout
 * Strict isolation to assigned work packages, zero leakage of commercial margins or competitor data.
 */
import React, { useState, useEffect } from 'react';
import {
  Layers,
  CalendarCheck,
  FileCheck,
  HelpCircle,
  Coins,
  LogOut,
  HardHat,
  Briefcase,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  Shield,
  FileText
} from 'lucide-react';
import { api } from '../api';
import { WorkPackageCommandCenterModal } from '../components/WorkPackageCommandCenterModal';

interface SubcontractorLayoutProps {
  user: any;
  logout: () => void;
  selectedProject: string;
  projects: any[];
  onSelectProject: (id: string) => void;
  renderContent: (currentTab: string, workPackageId?: string) => React.ReactNode;
}

export const SubcontractorLayout: React.FC<SubcontractorLayoutProps> = ({
  user,
  logout,
  selectedProject,
  projects,
  onSelectProject,
  renderContent
}) => {
  const [activeTab, setActiveTab] = useState<'home' | 'work' | 'technical' | 'progress' | 'commercial'>('home');
  const [myPackages, setMyPackages] = useState<any[]>([]);
  const [selectedWpId, setSelectedWpId] = useState<string>('');
  const [loadingPackages, setLoadingPackages] = useState(true);
  const [commandCenterWpId, setCommandCenterWpId] = useState<string | null>(null);

  useEffect(() => {
    async function loadWorkPackages() {
      if (!selectedProject) return;
      try {
        setLoadingPackages(true);
        const res = await api.get(`/api/work_packages?project_id=${selectedProject}`);
        const packages = Array.isArray(res) ? res : [];
        setMyPackages(packages);
        if (packages.length > 0 && !selectedWpId) {
          setSelectedWpId(packages[0].id);
        }
      } catch {
        setMyPackages([]);
      } finally {
        setLoadingPackages(false);
      }
    }
    loadWorkPackages();
  }, [selectedProject]);

  const navItems = [
    { id: 'home', label: 'Home', icon: HardHat },
    { id: 'work', label: 'My Work', icon: CalendarCheck },
    { id: 'technical', label: 'Technical', icon: FileCheck },
    { id: 'progress', label: 'Progress', icon: Layers },
    { id: 'commercial', label: 'Commercial', icon: Coins }
  ] as const;

  const currentProject = projects.find(p => p.id === selectedProject);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
        {/* Branding */}
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-sm">
            <HardHat size={20} />
          </div>
          <div>
            <h1 className="font-bold text-sm text-gray-900 leading-tight">MEP Platform</h1>
            <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
              Subcontractor Portal
            </span>
          </div>
        </div>

        {/* Project & Scope Context */}
        <div className="p-3 border-b border-gray-100 bg-gray-50/50">
          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
            Active Project
          </label>
          <select
            value={selectedProject}
            onChange={e => onSelectProject(e.target.value)}
            className="w-full text-xs font-semibold bg-white border border-gray-200 rounded-lg p-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {myPackages.length > 0 && (
            <div className="mt-2.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">
                Active Package
              </label>
              <select
                value={selectedWpId}
                onChange={e => setSelectedWpId(e.target.value)}
                className="w-full text-xs bg-white border border-gray-200 rounded-lg p-2 text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {myPackages.map(wp => (
                  <option key={wp.id} value={wp.id}>
                    {wp.code ? `[${wp.code}] ` : ''}{wp.name}
                  </option>
                ))}
              </select>
            </div>
          )}
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
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User Card & Logout */}
        <div className="p-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div className="truncate mr-2">
            <p className="text-xs font-bold text-gray-900 truncate">{user.name || 'Subcontractor'}</p>
            <p className="text-[10px] text-gray-500 truncate">{user.email}</p>
            <span className="inline-block mt-0.5 text-[9px] font-mono text-gray-400 bg-gray-200/60 px-1 rounded">
              Scope: {user.access_scope || 'work_package'}
            </span>
          </div>
          <button
            onClick={logout}
            className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
            title="Sign Out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-14 bg-white border-b border-gray-200 px-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="font-semibold text-gray-800">{currentProject?.name || 'Project'}</span>
            <ChevronRight size={14} />
            <span className="capitalize">{activeTab.replace('-', ' ')}</span>
          </div>

          {selectedWpId && (
            <button
              onClick={() => setCommandCenterWpId(selectedWpId)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
            >
              <ExternalLink size={13} />
              Open Work Package
            </button>
          )}
        </header>

        {/* Dynamic content view */}
        <div className="flex-1 overflow-y-auto p-6">
          {renderContent(activeTab, selectedWpId)}
        </div>
      </main>

      {/* Work Package Command Center Modal */}
      {commandCenterWpId && (
        <WorkPackageCommandCenterModal
          open={Boolean(commandCenterWpId)}
          workPackageId={commandCenterWpId}
          onClose={() => setCommandCenterWpId(null)}
        />
      )}
    </div>
  );
};
