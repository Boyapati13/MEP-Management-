/**
 * MEP Management Platform — V1.4.1 Internal Main Contractor Workspace
 * Full 6-Domain Operational Navigation with Role Scoping and Enterprise Consolidation.
 */
import React, { useState } from 'react';
import {
  HardHat,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  LogOut,
  Bell,
  Search,
  SlidersHorizontal,
  FolderOpen
} from 'lucide-react';
import { DOMAINS, ROUTE_ITEMS, NavigationDomain, RouteItem } from '../app/routes';
import { canShowDomain, canShowRoute, UserSession } from '../app/permissions';

interface InternalLayoutProps {
  user: UserSession;
  logout: () => void;
  selectedProject: string;
  projects: any[];
  onSelectProject: (id: string) => void;
  activeDomain: NavigationDomain;
  activeRoute: string;
  onNavigate: (domain: NavigationDomain, routeId: string) => void;
  children: React.ReactNode;
}

export const InternalLayout: React.FC<InternalLayoutProps> = ({
  user,
  logout,
  selectedProject,
  projects,
  onSelectProject,
  activeDomain,
  activeRoute,
  onNavigate,
  children
}) => {
  const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>({
    [activeDomain]: true,
    delivery: true,
    site: true
  });

  const toggleDomain = (domainId: string) => {
    setExpandedDomains(prev => ({
      ...prev,
      [domainId]: !prev[domainId]
    }));
  };

  const visibleDomains = DOMAINS.filter(d => canShowDomain(user, d.id));
  const currentProject = projects.find(p => p.id === selectedProject);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden font-sans">
      {/* Primary Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
        {/* Branding & Version */}
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-sm">
              <HardHat size={20} />
            </div>
            <div>
              <h1 className="font-bold text-sm text-gray-900 leading-tight">MEP Platform</h1>
              <span className="text-[10px] font-semibold text-gray-400">
                v1.4.1 Enterprise
              </span>
            </div>
          </div>
        </div>

        {/* Project Selector Context */}
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
        </div>

        {/* Domain & Route Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleDomains.map(domain => {
            const DomainIcon = domain.icon;
            const isDomainActive = activeDomain === domain.id;
            const isExpanded = expandedDomains[domain.id] ?? false;
            const items = ROUTE_ITEMS.filter(r => r.domain === domain.id && canShowRoute(user, r.id));

            if (items.length === 1 && items[0].id === domain.defaultRoute) {
              // Single-item domain (like Dashboard)
              const singleItem = items[0];
              const isSelected = activeRoute === singleItem.id;
              return (
                <button
                  key={domain.id}
                  onClick={() => onNavigate(domain.id, singleItem.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <DomainIcon size={16} />
                  <span>{domain.label}</span>
                </button>
              );
            }

            return (
              <div key={domain.id} className="pt-1">
                <button
                  onClick={() => toggleDomain(domain.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    isDomainActive
                      ? 'text-blue-600 bg-blue-50/60'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <DomainIcon size={15} />
                    <span>{domain.label}</span>
                  </div>
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {isExpanded && (
                  <div className="pl-6 pr-1 pt-1 space-y-0.5">
                    {items.map(item => {
                      const SubIcon = item.icon;
                      const isSelected = activeRoute === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => onNavigate(domain.id, item.id)}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            isSelected
                              ? 'bg-blue-600 text-white font-semibold shadow-xs'
                              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                          }`}
                        >
                          <SubIcon size={13} />
                          <span className="truncate">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* User Card & Logout */}
        <div className="p-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div className="truncate mr-2">
            <p className="text-xs font-bold text-gray-900 truncate">{user.name || 'User'}</p>
            <p className="text-[10px] text-gray-500 truncate">{user.role}</p>
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

      {/* Main Execution Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Operational Bar */}
        <header className="h-14 bg-white border-b border-gray-200 px-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="font-semibold text-gray-800">{currentProject?.name || 'Project'}</span>
            <ChevronRight size={14} />
            <span className="capitalize font-medium text-gray-600">{activeDomain}</span>
            <ChevronRight size={14} />
            <span className="capitalize font-semibold text-blue-600">
              {ROUTE_ITEMS.find(r => r.id === activeRoute)?.label || activeRoute}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-600">
              Role: {user.role}
            </span>
          </div>
        </header>

        {/* Content Container */}
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </main>
    </div>
  );
};
