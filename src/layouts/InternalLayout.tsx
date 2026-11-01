import React, { useState, useEffect } from 'react';
import {
  Building2, LogOut, Sparkles, ChevronRight, Calendar, DollarSign, ShieldCheck,
  Menu, X, LayoutDashboard, Truck, HardHat, Receipt, Layers, Palette, Check,
  RotateCcw, Sliders, MessageSquare
} from 'lucide-react';
import {
  DOMAINS, ROUTE_ITEMS, NavigationDomain
} from '../app/routes';
import { AppearanceModal, AppearanceSettings } from '../components/AppearanceModal';

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
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearanceModalOpen, setAppearanceModalOpen] = useState(false);

  // Active Appearance Settings (Persisted in localStorage)
  const [workspaceTheme, setWorkspaceTheme] = useState<AppearanceSettings['theme']>(() => {
    try {
      const saved = localStorage.getItem('mep-workspace-theme');
      return (saved as AppearanceSettings['theme']) || 'blueprint';
    } catch {
      return 'blueprint';
    }
  });

  const [gridEnabled, setGridEnabled] = useState(() => {
    try {
      return localStorage.getItem('mep-workspace-grid') !== 'off';
    } catch {
      return true;
    }
  });

  const [gridStrength, setGridStrength] = useState<AppearanceSettings['gridStrength']>(() => {
    try {
      const saved = localStorage.getItem('mep-workspace-grid-strength');
      return (saved as AppearanceSettings['gridStrength']) || 'subtle';
    } catch {
      return 'subtle';
    }
  });

  const [workspaceDensity, setWorkspaceDensity] = useState<AppearanceSettings['density']>(() => {
    try {
      const saved = localStorage.getItem('mep-workspace-density');
      return (saved as AppearanceSettings['density']) || 'comfortable';
    } catch {
      return 'comfortable';
    }
  });

  // Global document & DOM synchronization for themes, dark class, and grids
  useEffect(() => {
    if (workspaceTheme === 'dark') {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
    }

    document.documentElement.setAttribute('data-workspace-theme', workspaceTheme);
    document.documentElement.setAttribute('data-theme', workspaceTheme);
    document.body.setAttribute('data-workspace-theme', workspaceTheme);
    document.documentElement.setAttribute('data-workspace-grid', gridEnabled ? gridStrength : 'off');
    document.documentElement.setAttribute('data-workspace-density', workspaceDensity);
  }, [workspaceTheme, gridEnabled, gridStrength, workspaceDensity]);

  // Sidebar Inline Draft State (Allows users to change options and explicitly click APPLY)
  const [sidebarDraftTheme, setSidebarDraftTheme] = useState<AppearanceSettings['theme']>(workspaceTheme);
  const [sidebarDraftGrid, setSidebarDraftGrid] = useState(gridEnabled);
  const [sidebarDraftStrength, setSidebarDraftStrength] = useState<AppearanceSettings['gridStrength']>(gridStrength);
  const [sidebarDraftDensity, setSidebarDraftDensity] = useState<AppearanceSettings['density']>(workspaceDensity);
  const [sidebarAppliedFeedback, setSidebarAppliedFeedback] = useState(false);

  // Keep sidebar drafts synced with active settings
  useEffect(() => {
    setSidebarDraftTheme(workspaceTheme);
    setSidebarDraftGrid(gridEnabled);
    setSidebarDraftStrength(gridStrength);
    setSidebarDraftDensity(workspaceDensity);
  }, [workspaceTheme, gridEnabled, gridStrength, workspaceDensity, appearanceOpen]);

  // Handle explicit sidebar Apply button
  const handleSidebarApply = () => {
    setWorkspaceTheme(sidebarDraftTheme);
    setGridEnabled(sidebarDraftGrid);
    setGridStrength(sidebarDraftStrength);
    setWorkspaceDensity(sidebarDraftDensity);

    try {
      localStorage.setItem('mep-workspace-theme', sidebarDraftTheme);
      localStorage.setItem('mep-workspace-grid', sidebarDraftGrid ? 'on' : 'off');
      localStorage.setItem('mep-workspace-grid-strength', sidebarDraftStrength);
      localStorage.setItem('mep-workspace-density', sidebarDraftDensity);
    } catch {
      /* browser storage may be unavailable */
    }

    setSidebarAppliedFeedback(true);
    setTimeout(() => {
      setSidebarAppliedFeedback(false);
    }, 2000);
  };

  // Handle sidebar Reset button
  const handleSidebarReset = () => {
    const defaultTheme: AppearanceSettings['theme'] = 'blueprint';
    const defaultGrid = true;
    const defaultStrength: AppearanceSettings['gridStrength'] = 'subtle';
    const defaultDensity: AppearanceSettings['density'] = 'comfortable';

    setSidebarDraftTheme(defaultTheme);
    setSidebarDraftGrid(defaultGrid);
    setSidebarDraftStrength(defaultStrength);
    setSidebarDraftDensity(defaultDensity);

    setWorkspaceTheme(defaultTheme);
    setGridEnabled(defaultGrid);
    setGridStrength(defaultStrength);
    setWorkspaceDensity(defaultDensity);

    try {
      localStorage.setItem('mep-workspace-theme', defaultTheme);
      localStorage.setItem('mep-workspace-grid', 'on');
      localStorage.setItem('mep-workspace-grid-strength', defaultStrength);
      localStorage.setItem('mep-workspace-density', defaultDensity);
    } catch {
      /* browser storage may be unavailable */
    }

    setSidebarAppliedFeedback(true);
    setTimeout(() => {
      setSidebarAppliedFeedback(false);
    }, 2000);
  };

  // Handle Modal Apply
  const handleModalApply = (newSettings: AppearanceSettings) => {
    setWorkspaceTheme(newSettings.theme);
    setGridEnabled(newSettings.gridEnabled);
    setGridStrength(newSettings.gridStrength);
    setWorkspaceDensity(newSettings.density);

    try {
      localStorage.setItem('mep-workspace-theme', newSettings.theme);
      localStorage.setItem('mep-workspace-grid', newSettings.gridEnabled ? 'on' : 'off');
      localStorage.setItem('mep-workspace-grid-strength', newSettings.gridStrength);
      localStorage.setItem('mep-workspace-density', newSettings.density);
    } catch {
      /* browser storage may be unavailable */
    }
  };

  // Handle Modal Reset
  const handleModalReset = () => {
    handleSidebarReset();
  };

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
    <div
      className={`min-h-screen workspace-surface flex flex-col lg:flex-row text-slate-900 dark:text-slate-100 relative ${
        workspaceTheme === 'dark' ? 'dark dark-mode-cards' : ''
      }`}
      data-workspace-theme={workspaceTheme}
      data-workspace-grid={gridEnabled ? gridStrength : 'off'}
      data-workspace-density={workspaceDensity}
    >
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
        <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            ERP Operational Pillars
          </div>
          {visibleDomains.map((domain: any) => {
            const Icon = domain.icon;
            const isActive = domain.id === activeDomain;
            return (
              <button
                key={domain.id}
                onClick={() => handleDomainSelect(domain.id, domain.defaultRoute)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all touch-manipulation ${
                  isActive
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon size={18} className="flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold leading-tight truncate">{domain.label}</div>
                    <div className={`text-[10px] truncate ${isActive ? 'text-amber-100' : 'text-slate-500'}`}>
                      {domain.pillar || 'Operational Scope'}
                    </div>
                  </div>
                </div>
                <ChevronRight size={14} className={isActive ? 'text-amber-100 flex-shrink-0' : 'text-slate-600 flex-shrink-0'} />
              </button>
            );
          })}
        </nav>

        {/* Appearance Section in Sidebar */}
        <div className="px-3 pb-2 border-t border-slate-800 pt-2">
          <button
            type="button"
            onClick={() => setAppearanceOpen(!appearanceOpen)}
            aria-expanded={appearanceOpen}
            aria-controls="workspace-appearance"
            className="w-full flex items-center justify-between rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <span className="flex items-center gap-2">
              <Palette size={17} className="text-amber-400" />
              <span>Appearance</span>
            </span>
            <ChevronRight
              size={14}
              className={`transition-transform duration-200 ${appearanceOpen ? 'rotate-90' : ''}`}
            />
          </button>

          {appearanceOpen && (
            <div id="workspace-appearance" className="mt-2 p-3 bg-slate-800/90 rounded-xl space-y-3 border border-slate-700/60 shadow-inner">
              <div>
                <label htmlFor="workspace-theme" className="block text-[11px] font-medium text-slate-200 mb-1">
                  Graph paper colour
                </label>
                <select
                  id="workspace-theme"
                  value={sidebarDraftTheme}
                  onChange={(e) => setSidebarDraftTheme(e.target.value as any)}
                  className="w-full rounded-lg bg-slate-900 border border-slate-600 p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="blueprint">Blueprint Blue</option>
                  <option value="slate">Slate Grey</option>
                  <option value="sage">Sage Green</option>
                  <option value="sand">Warm Sand</option>
                  <option value="dark">Dark Obsidian</option>
                </select>
              </div>

              <div className="flex items-center justify-between pt-0.5">
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sidebarDraftGrid}
                    onChange={(e) => setSidebarDraftGrid(e.target.checked)}
                    className="rounded border-slate-600 text-amber-600 focus:ring-0"
                  />
                  <span>Show background grid</span>
                </label>
              </div>

              {sidebarDraftGrid && (
                <div>
                  <label htmlFor="workspace-grid-strength" className="block text-[11px] font-medium text-slate-200 mb-1">
                    Grid intensity
                  </label>
                  <select
                    id="workspace-grid-strength"
                    value={sidebarDraftStrength}
                    onChange={(e) => setSidebarDraftStrength(e.target.value as any)}
                    className="w-full rounded-lg bg-slate-900 border border-slate-600 p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    <option value="subtle">Subtle (25%)</option>
                    <option value="standard">Standard (50%)</option>
                    <option value="high-contrast">High Contrast (80%)</option>
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="workspace-density" className="block text-[11px] font-medium text-slate-200 mb-1">
                  Display Density
                </label>
                <select
                  id="workspace-density"
                  value={sidebarDraftDensity}
                  onChange={(e) => setSidebarDraftDensity(e.target.value as any)}
                  className="w-full rounded-lg bg-slate-900 border border-slate-600 p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="comfortable">Comfortable (Standard)</option>
                  <option value="compact">Compact (Data Heavy)</option>
                </select>
              </div>

              {/* THE APPLY BUTTON IN SIDEBAR */}
              <div className="pt-2 border-t border-slate-700/80 space-y-2">
                <button
                  type="button"
                  onClick={handleSidebarApply}
                  className={`w-full py-2 px-3 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1.5 shadow-md transition-all touch-manipulation ${
                    sidebarAppliedFeedback
                      ? 'bg-emerald-600 ring-2 ring-emerald-400'
                      : 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800'
                  }`}
                >
                  <Check size={14} strokeWidth={2.5} />
                  <span>{sidebarAppliedFeedback ? 'Applied & Saved!' : 'Apply Appearance'}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSidebarReset}
                    className="flex-1 py-1.5 px-2 rounded-lg bg-slate-900 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-medium flex items-center justify-center gap-1 transition-colors"
                    title="Reset to default settings"
                  >
                    <RotateCcw size={12} />
                    <span>Reset</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAppearanceOpen(false);
                      setAppearanceModalOpen(true);
                    }}
                    className="flex-1 py-1.5 px-2 rounded-lg bg-slate-900 hover:bg-slate-700 text-amber-400 hover:text-amber-300 text-[11px] font-medium flex items-center justify-center gap-1 transition-colors"
                    title="Open full customizer dialog"
                  >
                    <Sliders size={12} />
                    <span>Customizer ↗</span>
                  </button>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 text-center">
                Saved on this device.
              </p>
            </div>
          )}
        </div>

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
                    {visibleDomains.find((d) => d.id === activeDomain)?.label || 'Overview'}
                  </span>
                  {activeProject && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-0.5 truncate max-w-[180px] md:max-w-[280px]">
                      <ShieldCheck size={12} className="text-amber-600 flex-shrink-0" />
                      <span className="truncate">{activeProject.name}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Right actions: Project Budget, Appearance Quick Button & AI Copilot */}
              <div className="flex items-center gap-2 sm:gap-2.5 flex-shrink-0">
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

                {/* Quick Messages Button in Header */}
                <button
                  type="button"
                  onClick={() => onNavigate('delivery', 'messages')}
                  className="relative inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl text-xs font-semibold bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-stone-200 dark:border-slate-700 transition-colors touch-manipulation"
                  title="Project Messages & Discussions"
                  aria-label="Project Messages & Discussions"
                >
                  <MessageSquare size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  <span className="hidden md:inline">Messages</span>
                  <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                </button>

                {/* Quick Appearance Customizer Button in Header */}
                <button
                  type="button"
                  onClick={() => setAppearanceModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl text-xs font-semibold bg-stone-100 hover:bg-stone-200 text-slate-700 border border-stone-200 transition-colors touch-manipulation"
                  title="Customize Workspace Appearance & Theme"
                  aria-label="Customize Workspace Appearance & Theme"
                >
                  <Palette size={14} className="text-amber-600 flex-shrink-0" />
                  <span className="hidden md:inline">Appearance</span>
                </button>

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
              <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar scroll-smooth py-0.5 -mx-1 px-1">
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
          onClick={() => handleDomainSelect('delivery', 'workforce')}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg text-[10px] font-medium touch-manipulation ${
            activeDomain === 'delivery' && activeRoute === 'workforce' ? 'text-amber-400 font-bold' : 'text-slate-400'
          }`}
        >
          <HardHat size={18} />
          <span>Site</span>
        </button>

        <button
          onClick={() => handleDomainSelect('commercial', 'boq')}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg text-[10px] font-medium touch-manipulation ${
            activeDomain === 'commercial' ? 'text-amber-400 font-bold' : 'text-slate-400'
          }`}
        >
          <Receipt size={18} />
          <span>Cost/BOQ</span>
        </button>

        <button
          onClick={() => setMobileMenuOpen(true)}
          className="flex flex-col items-center gap-0.5 py-1 px-2 rounded-lg text-[10px] font-medium text-slate-400 touch-manipulation"
        >
          <Menu size={18} />
          <span>More</span>
        </button>
      </nav>

      {/* Full Dedicated Appearance & Drafting Theme Modal */}
      <AppearanceModal
        isOpen={appearanceModalOpen}
        onClose={() => setAppearanceModalOpen(false)}
        settings={{
          theme: workspaceTheme,
          gridEnabled,
          gridStrength,
          density: workspaceDensity,
        }}
        onApply={handleModalApply}
        onReset={handleModalReset}
      />
    </div>
  );
}
