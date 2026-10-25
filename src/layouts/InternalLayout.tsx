import React, { useState } from 'react';
import {
  Building2, LogOut, Sparkles, ChevronRight, Calendar, DollarSign, ShieldCheck, Menu, X, LayoutDashboard
} from 'lucide-react';
import {
  DOMAINS, ROUTE_ITEMS, NavigationDomain
} from '../app/routes';

interface InternalLayoutProps {
  user: any;
  logout: () => void;
  selectedProject: string;
  projects: any[];
  onSelectProject: (projectId: string) => void;
  activeDomain: NavigationDomain;
  activeRoute: string;
  onNavigate: (domain: NavigationDomain, route: string) => void;
  onOpenAssistant?: () => void;
  children: React.ReactNode;
}

export function InternalLayout({
  user,
  logout,
  selectedProject,
  projects,
  onSelectProject,
  activeDomain,
  activeRoute,
  onNavigate,
  onOpenAssistant,
  children,
}: InternalLayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const role = user?.role || 'Worker';
  const visibleDomains = DOMAINS.filter(
    (d) => !d.allowedRoles || d.allowedRoles.includes(role)
  );
  const subRoutes = ROUTE_ITEMS.filter(
    (r) =>
      r.domain === activeDomain &&
      (!r.allowedRoles || r.allowedRoles.includes(role))
  );
  const activeProject = selectedProject ? projects.find((p: any) => p.id === selectedProject) || null : null;

  return (
    <div className="min-h-screen blueprint-surface flex text-[#14171f]">
      {mobileNavOpen && <button type="button" aria-label="Close navigation" className="fixed inset-0 z-30 bg-slate-950/65 lg:hidden" onClick={() => setMobileNavOpen(false)} />}
      {/* Deep Slate Architectural Sidebar */}
      <aside id="mep-primary-navigation" className={`${mobileNavOpen ? "flex" : "hidden"} fixed inset-y-0 left-0 z-40 w-72 flex-col bg-[#0f172a] border-r border-slate-800 text-slate-200 shadow-xl lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0`}>
        <div className="p-4 border-b border-slate-800 flex items-center gap-3">
          <button type="button" aria-label="Close menu" className="rounded-lg p-1 text-slate-300 hover:bg-slate-800 lg:hidden" onClick={() => setMobileNavOpen(false)}><X size={20}/></button>
          <div className="w-10 h-10 rounded-xl bg-amber-600 text-white flex items-center justify-center shadow-md shadow-amber-900/30">
            <Building2 size={20} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <div className="font-bold text-white leading-tight tracking-tight">MEP FieldHub</div>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30">
                v1.5.0
              </span>
            </div>
            <div className="text-[11px] text-slate-400">Construction Operations</div>
          </div>
        </div>

        {/* Project Switcher */}
        <div className="p-3 border-b border-slate-800/80 bg-slate-900/50">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-amber-400/90 mb-1.5">
            Active Job Context
          </label>
          <select
            value={selectedProject}
            onChange={(e) => { onSelectProject(e.target.value); setMobileNavOpen(false); }}
            className="w-full text-xs font-semibold border border-slate-700 rounded-xl px-2.5 py-2 bg-slate-800 text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="">All Assigned Projects</option>
            {projects.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Domain Navigation */}
        <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Operational Domains
          </div>
          {visibleDomains.map((domain) => {
            const Icon = domain.icon;
            const isActive = domain.id === activeDomain;
            return (
              <button
                key={domain.id}
                onClick={() => {
                  const routes = ROUTE_ITEMS.filter(
                    (r) =>
                      r.domain === domain.id &&
                      (!r.allowedRoles || r.allowedRoles.includes(role))
                  );
                  onNavigate(domain.id, routes[0]?.id || domain.defaultRoute);
                  setMobileNavOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  isActive
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon size={17} />
                  <span>{domain.label}</span>
                </span>
                <ChevronRight size={14} className={isActive ? 'text-amber-100' : 'text-slate-600'} />
              </button>
            );
          })}
        </nav>

        {/* User Identity Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-bold text-white truncate">{user?.name || user?.username}</div>
            <div className="text-[11px] text-amber-400 font-medium truncate">{role}</div>
          </div>
          <button
            onClick={logout}
            className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Buildertrend Top Job Context Ribbon */}
        <header className="bg-white/95 backdrop-blur border-b border-[#e5e0d5] px-4 sm:px-6 py-3 sticky top-0 z-20 shadow-xs">
          <div className="mb-3 flex items-center justify-between gap-3 lg:hidden">
            <button type="button" aria-label="Open navigation" aria-controls="mep-primary-navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"><Menu size={18}/> Menu</button>
            <button type="button" onClick={() => onNavigate("dashboard", "dashboard")} className="inline-flex items-center gap-2 text-sm font-bold text-slate-800"><LayoutDashboard size={17}/> Command Center</button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap" aria-label="Workspace sections">
              {subRoutes.map((r) => {
                const active = r.id === activeRoute;
                return (
                  <button
                    key={r.id}
                    onClick={() => onNavigate(activeDomain, r.id)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      active
                        ? 'bg-[#0f172a] text-white shadow-xs'
                        : 'text-slate-600 hover:bg-stone-100 hover:text-slate-900'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-3">
              {activeProject && (
                <div className="hidden xl:flex items-center gap-4 px-3.5 py-1.5 rounded-xl bg-[#f6f4ee] border border-[#e5e0d5] text-xs">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <ShieldCheck size={14} className="text-amber-600" />
                    {activeProject.name}
                  </span>
                  {activeProject.budget !== undefined && (
                    <span className="font-mono font-semibold text-emerald-800 flex items-center gap-0.5">
                      <DollarSign size={12} />
                      {Number(activeProject.budget || 0).toLocaleString()}
                    </span>
                  )}
                  {activeProject.end_date && (
                    <span className="font-mono text-slate-500 flex items-center gap-1">
                      <Calendar size={12} />
                      Target: {activeProject.end_date}
                    </span>
                  )}
                </div>
              )}

              {onOpenAssistant && (
                <button
                  onClick={onOpenAssistant}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 shadow-xs transition-colors"
                >
                  <Sparkles size={14} />
                  MEP AI Copilot
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
