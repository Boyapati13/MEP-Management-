import React, { useState } from 'react';
import {
  Building2, LogOut, Sparkles, ChevronRight, Calendar, DollarSign, ShieldCheck,
  Menu, X, LayoutDashboard, Truck, HardHat, Receipt, Layers
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const role = user?.role || 'Worker';
  const visibleDomains = DOMAINS.filter(
    (d) => (!d.allowedRoles || d.allowedRoles.includes(role)) &&
      ROUTE_ITEMS.some(r => r.domain === d.id && (!r.allowedRoles || r.allowedRoles.includes(role)))
  );
  const subRoutes = ROUTE_ITEMS.filter(
    (r) =>
      r.domain === activeDomain &&
      (!r.allowedRoles || r.allowedRoles.includes(role))
  );
  const activeProject = selectedProject ? projects.find((p: any) => p.id === selectedProject) || null : null;

  const handleDomainSelect = (domainId: NavigationDomain, defaultRoute: string) => {
    const routes = ROUTE_ITEMS.filter(
      (r) =>
        r.domain === domainId &&
        (!r.allowedRoles || r.allowedRoles.includes(role))
    );
    onNavigate(domainId, routes[0]?.id || defaultRoute);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen blueprint-surface flex flex-col lg:flex-row text-[#14171f] relative">
      {/* Mobile Backdrop Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 lg:hidden transition-opacity"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Deep Slate Architectural Sidebar (Slide-over drawer on mobile/tablet, permanent on laptop/desktop) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-[#0f172a] border-r border-slate-800 flex flex-col text-slate-200 shadow-2xl transition-transform duration-300 ease-in-out lg:static lg:w-64 xl:w-72 lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-600 text-white flex items-center justify-center shadow-md shadow-amber-900/30 flex-shrink-0">
              <Building2 size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <div className="font-bold text-white leading-tight tracking-tight truncate">MEP FieldHub</div>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30 flex-shrink-0">
                  v1.5.0
                </span>
              </div>
              <div className="text-[11px] text-slate-400 truncate">Construction Operations</div>
            </div>
          </div>
          {/* Close button on mobile/tablet */}
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Project Switcher */}
        <div className="p-3 border-b border-slate-800/80 bg-slate-900/50">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-amber-400/90 mb-1.5">
            Active Job Context
          </label>
          <select
            value={selectedProject}
            onChange={(e) => onSelectProject(e.target.value)}
            className="w-full text-xs font-semibold border border-slate-700 rounded-xl px-2.5 py-2.5 bg-slate-800 text-white focus:outline-none focus:ring-2 focus:ring-amber-500 touch-manipulation"
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
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Operational Domains
          </div>
          {visibleDomains.map((domain) => {
            const Icon = domain.icon;
            const isActive = domain.id === activeDomain;
            return (
              <button
                key={domain.id}
                onClick={() => handleDomainSelect(domain.id, domain.defaultRoute)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all touch-manipulation ${
                  isActive
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon size={18} className="flex-shrink-0" />
                  <span className="truncate">{domain.label}</span>
                </span>
                <ChevronRight size={14} className={isActive ? 'text-amber-100 flex-shrink-0' : 'text-slate-600 flex-shrink-0'} />
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
            className="p-2.5 rounded-xl text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors touch-manipulation"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header / Job Context Ribbon */}
        <header className="bg-white/95 backdrop-blur border-b border-[#e5e0d5] px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 sticky top-0 z-20 shadow-xs">
          <div className="flex flex-col gap-2.5">
            {/* Top row: Hamburger (mobile/tablet), Title, Project & Assistant */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {/* Mobile / Tablet Menu Button */}
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className="lg:hidden p-2 rounded-xl text-slate-700 hover:bg-stone-100 active:bg-stone-200 border border-stone-200 transition-colors touch-manipulation flex-shrink-0"
                  aria-label="Open navigation menu"
                >
                  <Menu size={20} />
                </button>

                {/* Domain & Project Title */}
                <div className="min-w-0 flex items-center gap-2">
                  <span className="font-bold text-slate-900 text-sm sm:text-base truncate">
                    {visibleDomains.find(d => d.id === activeDomain)?.label || 'Overview'}
                  </span>
                  {activeProject && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-0.5 truncate max-w-[180px] md:max-w-[280px]">
                      <ShieldCheck size={12} className="text-amber-600 flex-shrink-0" />
                      <span className="truncate">{activeProject.name}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Right actions: Project Budget / Details & AI Copilot */}
              <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                {activeProject && (
                  <div className="hidden xl:flex items-center gap-3 px-3 py-1 rounded-xl bg-[#f6f4ee] border border-[#e5e0d5] text-xs">
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 active:bg-amber-800 shadow-xs transition-colors touch-manipulation"
                    title="Open MEP AI Copilot"
                  >
                    <Sparkles size={14} className="flex-shrink-0" />
                    <span className="hidden sm:inline">MEP AI Copilot</span>
                    <span className="sm:hidden">Copilot</span>
                  </button>
                )}
              </div>
            </div>

            {/* Subroute Navigation Tabs - Horizontal Scroll on small screens */}
            {subRoutes.length > 0 && (
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap py-0.5 -mx-1 px-1">
                {subRoutes.map((r) => {
                  const active = r.id === activeRoute;
                  return (
                    <button
                      key={r.id}
                      onClick={() => onNavigate(activeDomain, r.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all touch-manipulation flex-shrink-0 ${
                        active
                          ? 'bg-[#0f172a] text-white shadow-xs'
                          : 'text-slate-600 hover:bg-stone-100 hover:text-slate-900 bg-stone-50/50'
                      }`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </header>

        {/* Content Container with responsive padding and mobile bottom-bar buffer */}
        <main className="flex-1 p-3 sm:p-4 md:p-6 pb-20 sm:pb-6 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation Dock (Phones < 640px) */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#0f172a]/95 backdrop-blur-md border-t border-slate-800 text-slate-300 flex items-center justify-around py-1.5 px-2 shadow-2xl">
        <button
          onClick={() => handleDomainSelect('dashboard', 'dashboard')}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg text-[10px] font-medium touch-manipulation ${
            activeDomain === 'dashboard' ? 'text-amber-400 font-bold' : 'text-slate-400'
          }`}
        >
          <LayoutDashboard size={18} />
          <span>Dashboard</span>
        </button>

        <button
          onClick={() => handleDomainSelect('delivery', 'tasks')}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg text-[10px] font-medium touch-manipulation ${
            activeDomain === 'delivery' ? 'text-amber-400 font-bold' : 'text-slate-400'
          }`}
        >
          <Truck size={18} />
          <span>Delivery</span>
        </button>

        <button
          onClick={() => handleDomainSelect('site', 'workforce')}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg text-[10px] font-medium touch-manipulation ${
            activeDomain === 'site' ? 'text-amber-400 font-bold' : 'text-slate-400'
          }`}
        >
          <HardHat size={18} />
          <span>Site</span>
        </button>

        {visibleDomains.some(d => d.id === 'commercial') && <button
          onClick={() => handleDomainSelect('commercial', 'boq')}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg text-[10px] font-medium touch-manipulation ${
            activeDomain === 'commercial' ? 'text-amber-400 font-bold' : 'text-slate-400'
          }`}
        >
          <Receipt size={18} />
          <span>Cost/BOQ</span>
        </button>}

        <button
          onClick={() => setMobileMenuOpen(true)}
          className="flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg text-[10px] font-medium text-slate-400 touch-manipulation"
        >
          <Menu size={18} />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}
