import React, { useState } from 'react';
import { Building2, LogOut, HardHat, CheckSquare, FileText, TrendingUp, DollarSign, Sparkles } from 'lucide-react';

export type SubcontractorTab = 'home' | 'work' | 'technical' | 'progress' | 'commercial';

interface SubcontractorLayoutProps {
  user: any;
  logout: () => void;
  selectedProject: string;
  projects: any[];
  onSelectProject: (id: string) => void;
  onOpenAssistant?: () => void;
  renderContent: (tab: SubcontractorTab) => React.ReactNode;
}

const TABS: { id: SubcontractorTab; label: string; icon: React.ComponentType<any> }[] = [
  { id: 'home', label: 'My Project', icon: HardHat },
  { id: 'work', label: 'My Work Packages', icon: CheckSquare },
  { id: 'technical', label: 'RFIs & Submittals', icon: FileText },
  { id: 'progress', label: 'Site Progress', icon: TrendingUp },
  { id: 'commercial', label: 'Variations & Claims', icon: DollarSign },
];

export function SubcontractorLayout({
  user,
  logout,
  selectedProject,
  projects,
  onSelectProject,
  onOpenAssistant,
  renderContent,
}: SubcontractorLayoutProps) {
  const [activeTab, setActiveTab] = useState<SubcontractorTab>('home');

  return (
    <div className="min-h-screen blueprint-surface flex flex-col text-[#14171f]">
      <header className="bg-[#0f172a] border-b border-slate-800 px-3.5 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-white">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-amber-600 text-white flex items-center justify-center flex-shrink-0">
            <Building2 size={18} />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-white text-sm truncate">MEP FieldHub — Subcontractor Portal</div>
            <div className="text-[11px] text-amber-400 truncate">{user?.trade || 'Trade Partner'} • Work-Package Scoped Access</div>
          </div>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3">
          <select
            value={selectedProject}
            onChange={(e) => onSelectProject(e.target.value)}
            className="text-xs font-semibold border border-slate-700 rounded-xl px-2.5 py-1.5 sm:py-2 bg-slate-800 text-white max-w-[200px] truncate touch-manipulation"
          >
            <option value="">Select Assigned Project</option>
            {projects.map((p: any) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {onOpenAssistant && (
            <button
              onClick={onOpenAssistant}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 shadow-xs transition-colors flex-shrink-0"
              title="Ask MEP AI Copilot about this project"
            >
              <Sparkles size={14} />
              <span className="hidden sm:inline">Copilot</span>
            </button>
          )}
          <span className="text-xs text-slate-300 font-medium truncate max-w-[120px]">{user?.name || user?.username}</span>
          <button
            onClick={logout}
            className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors touch-manipulation flex-shrink-0"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <div className="bg-white/95 border-b border-[#e5e0d5] px-3.5 sm:px-6 py-2 flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar scroll-smooth">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors touch-manipulation flex-shrink-0 ${
                active
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-stone-100'
              }`}
            >
              <Icon size={14} className="flex-shrink-0" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      <main className="flex-1 p-3.5 sm:p-5 md:p-6 max-w-7xl w-full mx-auto">{renderContent(activeTab)}</main>
    </div>
  );
}
