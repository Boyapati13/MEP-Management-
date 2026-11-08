import React, { useState, useEffect, useMemo } from 'react';
import {
  Building2, LogOut, Sparkles, ChevronRight, ChevronDown, Calendar, DollarSign, ShieldCheck,
  Menu, X, LayoutDashboard, Truck, HardHat, Receipt, Layers, Palette, Check,
  RotateCcw, Sliders, MessageSquare, Search, Command, ArrowUpRight
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
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>({
    [activeDomain]: true,
    dashboard: true,
    delivery: true,
    commercial: true,
  });

  // Active Appearance Settings — defaults to clean neutral enterprise Slate with grid OFF
  const [workspaceTheme, setWorkspaceTheme] = useState<AppearanceSettings['theme']>(() => {
    try {
      const saved = localStorage.getItem('mep-workspace-theme');
      return (saved as AppearanceSettings['theme']) || 'slate';
    } catch {
      return 'slate';
    }
  });

  const [gridEnabled, setGridEnabled] = useState(() => {
    try {
      return localStorage.getItem('mep-workspace-grid') === 'on';
    } catch {
      return false;
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

  useEffect(() => {
    setExpandedDomains(prev => ({ ...prev, [activeDomain]: true }));
  }, [activeDomain]);

  // Global Ctrl+K shortcut for Enterprise Command Palette
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen(prev => !prev);
      } else if (e.key === 'Escape') {
        setCommandOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const [sidebarDraftTheme, setSidebarDraftTheme] = useState<AppearanceSettings['theme']>(workspaceTheme);
  const [sidebarDraftGrid, setSidebarDraftGrid] = useState(gridEnabled);
  const [sidebarDraftStrength, setSidebarDraftStrength] = useState<AppearanceSettings['gridStrength']>(gridStrength);
  const [sidebarDraftDensity, setSidebarDraftDensity] = useState<AppearanceSettings['density']>(workspaceDensity);
  const [sidebarAppliedFeedback, setSidebarAppliedFeedback] = useState(false);

  useEffect(() => {
    setSidebarDraftTheme(workspaceTheme);
    setSidebarDraftGrid(gridEnabled);
    setSidebarDraftStrength(gridStrength);
    setSidebarDraftDensity(workspaceDensity);
  }, [workspaceTheme, gridEnabled, gridStrength, workspaceDensity, appearanceOpen]);

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
    } catch {}

    setSidebarAppliedFeedback(true);
    setTimeout(() => setSidebarAppliedFeedback(false), 2000);
  };

  const handleSidebarReset = () => {
    const defaultTheme: AppearanceSettings['theme'] = 'slate';
    const defaultGrid = false;
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
      localStorage.setItem('mep-workspace-grid', 'off');
      localStorage.setItem('mep-workspace-grid-strength', defaultStrength);
      localStorage.setItem('mep-workspace-density', defaultDensity);
    } catch {}

    setSidebarAppliedFeedback(true);
    setTimeout(() => setSidebarAppliedFeedback(false), 2000);
  };

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
    } catch {}
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
  const allAccessibleRoutes = useMemo(() => {
    return ROUTE_ITEMS.filter(r => !r.allowedRoles || r.allowedRoles.includes(role)).map(r => {
      const dom = DOMAINS.find(d => d.id === r.domain);
      return { ...r, domainLabel: dom?.label || r.domain };
    });
  }, [role]);

  const filteredCommandRoutes = useMemo(() => {
    if (!commandQuery.trim()) return allAccessibleRoutes;
    const q = commandQuery.toLowerCase();
    return allAccessibleRoutes.filter(
      r => r.label.toLowerCase().includes(q) || r.domainLabel.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)
    );
  }, [allAccessibleRoutes, commandQuery]);

  const activeProject = selectedProject ? projects.find((p: any) => p.id === selectedProject) || null : null;
  const activeDomainObj = visibleDomains.find((d) => d.id === activeDomain);
  const activeRouteObj = ROUTE_ITEMS.find((r) => r.id === activeRoute);

  const handleDomainSelect = (domainId: NavigationDomain, defaultRoute: string) => {
    const routes = ROUTE_ITEMS.filter(
      (r) =>
        r.domain === domainId &&
        (!r.allowedRoles || r.allowedRoles.includes(role))
    );
    setExpandedDomains(prev => ({ ...prev, [domainId]: !prev[domainId] }));
    onNavigate(domainId, routes[0]?.id || defaultRoute);
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
      {/* Mobile Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-950/60 z-40 lg:hidden transition-opacity"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Enterprise Left Navigation Rail */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] bg-[#0b1120] border-r border-slate-800/90 flex flex-col text-slate-300 transition-transform duration-200 ease-out lg:static lg:w-64 lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Identity Header */}
        <div className="h-14 px-4 border-b border-slate-800/90 flex items-center justify-between gap-2 bg-[#090d16]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded bg-blue-600 text-white flex items-center justify-center flex-shrink-0 font-bold shadow-xs">
              <Building2 size={17} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-sm text-white tracking-tight truncate">MEP FieldHub</span>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  ERP
                </span>
              </div>
              <div className="text-[10px] text-slate-400 truncate">Engineering &amp; Construction</div>
            </div>
          </div>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Close sidebar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Active Project Selector */}
        <div className="p-3 border-b border-slate-800/80 bg-slate-900/40">
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="sidebar-project-select" className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Project Context
            </label>
            {activeProject?.code && (
              <span className="text-[10px] font-mono text-blue-400">{activeProject.code}</span>
            )}
          </div>
          <select
            id="sidebar-project-select"
            value={selectedProject}
            onChange={(e) => onSelectProject(e.target.value)}
            className="w-full text-xs font-medium border border-slate-700/90 rounded px-2.5 py-2 bg-[#090d16] text-slate-100 focus:outline-none focus:border-blue-500"
          >
            <option value="">All Assigned Projects (Portfolio)</option>
            {projects.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Hierarchical Module Tree Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto" aria-label="Primary Navigation">
          {visibleDomains.map((domain: any) => {
            const Icon = domain.icon;
            const isDomainActive = domain.id === activeDomain;
            const isExpanded = Boolean(expandedDomains[domain.id]);
            const domainRoutes = ROUTE_ITEMS.filter(
              (r) => r.domain === domain.id && (!r.allowedRoles || r.allowedRoles.includes(role))
            );

            return (
              <div key={domain.id} className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => handleDomainSelect(domain.id, domain.defaultRoute)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded text-left text-xs font-semibold transition-colors ${
                    isDomainActive
                      ? 'bg-slate-800/90 text-white'
                      : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon size={15} className={isDomainActive ? 'text-blue-400 flex-shrink-0' : 'text-slate-500 flex-shrink-0'} />
                    <span className="truncate">{domain.label}</span>
                  </div>
                  {isExpanded ? (
                    <ChevronDown size={13} className="text-slate-500 flex-shrink-0" />
                  ) : (
                    <ChevronRight size={13} className="text-slate-500 flex-shrink-0" />
                  )}
                </button>

                {isExpanded && domainRoutes.length > 0 && (
                  <div className="ml-3 pl-2.5 border-l border-slate-800 space-y-0.5 py-0.5">
                    {domainRoutes.map((route) => {
                      const RIcon = route.icon;
                      const isRouteActive = activeRoute === route.id;
                      return (
                        <button
                          key={route.id}
                          type="button"
                          onClick={() => {
                            onNavigate(domain.id, route.id);
                            setMobileMenuOpen(false);
                          }}
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-xs transition-colors ${
                            isRouteActive
                              ? 'bg-blue-600/15 text-blue-300 font-semibold border-l-2 border-blue-500 -ml-[1px]'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                          }`}
                        >
                          <RIcon size={13} className={isRouteActive ? 'text-blue-400 flex-shrink-0' : 'text-slate-500 flex-shrink-0'} />
                          <span className="truncate">{route.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Workspace Display Preferences */}
        <div className="px-2 py-2 border-t border-slate-800/90">
          <button
            type="button"
            onClick={() => setAppearanceOpen(!appearanceOpen)}
            aria-expanded={appearanceOpen}
            aria-controls="workspace-appearance"
            className="w-full flex items-center justify-between rounded px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Sliders size={14} className="text-slate-400" />
              <span>Display &amp; Density</span>
            </span>
            <ChevronRight
              size={13}
              className={`transition-transform duration-150 ${appearanceOpen ? 'rotate-90' : ''}`}
            />
          </button>

          {appearanceOpen && (
            <div id="workspace-appearance" className="mt-1.5 p-2.5 bg-[#090d16] rounded border border-slate-800 space-y-2.5">
              <div>
                <label htmlFor="workspace-theme" className="block text-[11px] font-medium text-slate-300 mb-1">
                  Color Theme
                </label>
                <select
                  id="workspace-theme"
                  value={sidebarDraftTheme}
                  onChange={(e) => setSidebarDraftTheme(e.target.value as any)}
                  className="w-full rounded bg-slate-900 border border-slate-700 p-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="slate">Enterprise Neutral (Light)</option>
                  <option value="dark">Obsidian Slate (Dark)</option>
                  <option value="blueprint">Technical Blueprint</option>
                  <option value="sage">Architectural Sage</option>
                  <option value="sand">Warm Stone</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sidebarDraftGrid}
                    onChange={(e) => setSidebarDraftGrid(e.target.checked)}
                    className="rounded border-slate-600 text-blue-600 focus:ring-0"
                  />
                  <span>CAD Engineering Grid</span>
                </label>
              </div>

              {sidebarDraftGrid && (
                <div>
                  <label htmlFor="workspace-grid-strength" className="block text-[11px] font-medium text-slate-300 mb-1">
                    Grid Opacity
                  </label>
                  <select
                    id="workspace-grid-strength"
                    value={sidebarDraftStrength}
                    onChange={(e) => setSidebarDraftStrength(e.target.value as any)}
                    className="w-full rounded bg-slate-900 border border-slate-700 p-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="subtle">Subtle (25%)</option>
                    <option value="standard">Standard (50%)</option>
                    <option value="high-contrast">High Contrast (80%)</option>
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="workspace-density" className="block text-[11px] font-medium text-slate-300 mb-1">
                  Table &amp; Layout Density
                </label>
                <select
                  id="workspace-density"
                  value={sidebarDraftDensity}
                  onChange={(e) => setSidebarDraftDensity(e.target.value as any)}
                  className="w-full rounded bg-slate-900 border border-slate-700 p-1.5 text-xs text-white focus:outline-none"
                >
                  <option value="comfortable">Standard Density</option>
                  <option value="compact">Compact (High-Density Tables)</option>
                </select>
              </div>

              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <button
                  type="button"
                  onClick={handleSidebarApply}
                  className={`w-full py-1.5 px-3 rounded text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-colors ${
                    sidebarAppliedFeedback ? 'bg-emerald-600' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  <Check size={13} />
                  <span>{sidebarAppliedFeedback ? 'Preferences Applied' : 'Apply Preferences'}</span>
                </button>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleSidebarReset}
                    className="flex-1 py-1 px-2 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white text-[11px] flex items-center justify-center gap-1"
                  >
                    <RotateCcw size={11} />
                    <span>Reset</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAppearanceOpen(false);
                      setAppearanceModalOpen(true);
                    }}
                    className="flex-1 py-1 px-2 rounded bg-slate-900 hover:bg-slate-800 text-blue-400 hover:text-blue-300 text-[11px] flex items-center justify-center gap-1"
                  >
                    <Sliders size={11} />
                    <span>Advanced</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User Identity & Session Footer */}
        <div className="p-3 border-t border-slate-800/90 bg-[#090d16] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded bg-slate-800 border border-slate-700 text-slate-200 flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {(user?.name || user?.username || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-100 truncate">{user?.name || user?.username}</div>
              <div className="text-[10px] text-slate-400 truncate">{role}</div>
            </div>
          </div>
          <button
            onClick={logout}
            className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Enterprise Top Header & Telemetry Bar */}
        <header className="bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-800 px-3 sm:px-5 py-2 sticky top-0 z-20">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              {/* Left: Hamburger + Breadcrumb + Active Project Pill */}
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  onClick={() => setMobileMenuOpen(true)}
                  className="lg:hidden p-1.5 rounded text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 flex-shrink-0"
                  aria-label="Open navigation menu"
                >
                  <Menu size={18} />
                </button>

                <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs min-w-0">
                  <span className="text-slate-500 dark:text-slate-400 font-medium hidden sm:inline">
                    {activeDomainObj?.label || 'Operations'}
                  </span>
                  <ChevronRight size={13} className="text-slate-400 hidden sm:inline flex-shrink-0" />
                  <span className="font-semibold text-slate-900 dark:text-white text-sm truncate">
                    {activeRouteObj?.label || 'Dashboard'}
                  </span>
                </nav>

                {activeProject && (
                  <div className="hidden md:flex items-center gap-2 ml-2 pl-2.5 border-l border-slate-200 dark:border-slate-700 text-xs">
                    <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-0.5 truncate max-w-[260px]">
                      <ShieldCheck size={12} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                      <span className="truncate">{activeProject.name}</span>
                    </span>
                    {activeProject.budget !== undefined && Number(activeProject.budget) > 0 && (
                      <span className="hidden xl:inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded px-2 py-0.5">
                        €{Number(activeProject.budget).toLocaleString()}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Right: Quick Module Jump (Ctrl+K), Correspondence, Display, Copilot */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setCommandOpen(true)}
                  className="hidden sm:inline-flex items-center gap-2 h-8 px-2.5 rounded text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
                  title="Jump to module (Ctrl+K)"
                >
                  <Search size={13} />
                  <span>Go to module...</span>
                  <kbd className="text-[10px] font-mono px-1.5 py-0.2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-slate-500">
                    Ctrl K
                  </kbd>
                </button>

                <button
                  type="button"
                  onClick={() => onNavigate('delivery', 'messages')}
                  className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded text-xs font-medium border transition-colors ${
                    activeRoute === 'messages'
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                      : 'bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                  }`}
                  title="Project Messages & Correspondence"
                  aria-label="Project Messages & Correspondence"
                >
                  <MessageSquare size={13} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  <span className="hidden md:inline">Correspondence</span>
                </button>

                <button
                  type="button"
                  onClick={() => setAppearanceModalOpen(true)}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded text-xs font-medium bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
                  title="Display & Theme Preferences"
                  aria-label="Display & Theme Preferences"
                >
                  <Palette size={13} className="text-slate-500 flex-shrink-0" />
                  <span className="hidden md:inline">Display</span>
                </button>

                {onOpenAssistant && (
                  <button
                    onClick={onOpenAssistant}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-xs font-semibold bg-slate-900 dark:bg-blue-600 text-white hover:bg-slate-800 dark:hover:bg-blue-700 transition-colors"
                    title="Open MEP Engineering Copilot"
                  >
                    <Sparkles size={13} className="flex-shrink-0" />
                    <span className="hidden sm:inline">Engineering AI</span>
                  </button>
                )}
              </div>
            </div>

            {/* Domain Sub-Module Tab Strip */}
            {subRoutes.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-1 border-t border-slate-100 dark:border-slate-800/80">
                {subRoutes.map((r) => {
                  const active = r.id === activeRoute;
                  return (
                    <button
                      key={r.id}
                      onClick={() => onNavigate(activeDomain, r.id)}
                      className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                        active
                          ? 'bg-slate-900 dark:bg-blue-600 text-white font-semibold'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
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

        {/* Main Workspace Container */}
        <main className="flex-1 p-3 sm:p-5 pb-20 sm:pb-6 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#090d16] border-t border-slate-800 text-slate-300 flex items-center justify-around py-1.5 px-2">
        <button
          onClick={() => onNavigate('dashboard', 'dashboard')}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded text-[10px] font-medium ${
            activeDomain === 'dashboard' ? 'text-blue-400 font-semibold' : 'text-slate-400'
          }`}
        >
          <LayoutDashboard size={17} />
          <span>Overview</span>
        </button>

        <button
          onClick={() => onNavigate('delivery', 'tasks')}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded text-[10px] font-medium ${
            activeDomain === 'delivery' ? 'text-blue-400 font-semibold' : 'text-slate-400'
          }`}
        >
          <Truck size={17} />
          <span>Delivery</span>
        </button>

        <button
          onClick={() => onNavigate('commercial', 'boq')}
          className={`flex flex-col items-center gap-0.5 py-1 px-2 rounded text-[10px] font-medium ${
            activeDomain === 'commercial' ? 'text-blue-400 font-semibold' : 'text-slate-400'
          }`}
        >
          <Receipt size={17} />
          <span>Commercial</span>
        </button>

        <button
          onClick={() => setMobileMenuOpen(true)}
          className="flex flex-col items-center gap-0.5 py-1 px-2 rounded text-[10px] font-medium text-slate-400"
        >
          <Menu size={17} />
          <span>Modules</span>
        </button>
      </nav>

      {/* Enterprise Command Palette Modal (Ctrl+K) */}
      {commandOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[1px] flex items-start justify-center pt-20 p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setCommandOpen(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Module Command Palette"
            className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xl overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800">
              <Search size={15} className="text-slate-400" />
              <input
                type="text"
                autoFocus
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                placeholder="Jump to module (e.g. BOQ, Gantt, Submittals, Messages, Payroll)..."
                className="w-full text-sm bg-transparent text-slate-900 dark:text-white focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setCommandOpen(false)}
                className="text-xs text-slate-400 hover:text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700"
              >
                ESC
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {filteredCommandRoutes.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onNavigate(item.domain, item.id);
                      setCommandOpen(false);
                      setCommandQuery('');
                    }}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon size={15} className="text-slate-500 dark:text-slate-400" />
                      <div>
                        <p className="text-xs font-semibold text-slate-900 dark:text-white">{item.label}</p>
                        <p className="text-[10px] text-slate-500">{item.domainLabel}</p>
                      </div>
                    </div>
                    <ArrowUpRight size={13} className="text-slate-400" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Display & Theme Preferences Modal */}
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
        onReset={handleSidebarReset}
      />
    </div>
  );
}
