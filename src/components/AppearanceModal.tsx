import React, { useState, useEffect } from 'react';
import {
  Palette, Check, RotateCcw, X, Grid, Sliders, Eye, Sparkles, Monitor
} from 'lucide-react';

export interface AppearanceSettings {
  theme: 'blueprint' | 'slate' | 'sage' | 'sand' | 'dark';
  gridEnabled: boolean;
  gridStrength: 'subtle' | 'standard' | 'high-contrast';
  density: 'comfortable' | 'compact';
}

export const THEME_OPTIONS: Array<{
  id: AppearanceSettings['theme'];
  name: string;
  desc: string;
  paperColor: string;
  gridColor: string;
  accent: string;
  isDark?: boolean;
}> = [
  {
    id: 'blueprint',
    name: 'Blueprint Blue',
    desc: 'Classic technical MEP engineering graph paper with cyan grid',
    paperColor: '#f0f6fc',
    gridColor: '#bfdbfe',
    accent: '#2563eb',
  },
  {
    id: 'slate',
    name: 'Slate Minimalist',
    desc: 'Clean architectural neutral grey drafting background',
    paperColor: '#f1f5f9',
    gridColor: '#cbd5e1',
    accent: '#475569',
  },
  {
    id: 'sage',
    name: 'Sage Eco',
    desc: 'Subtle biophilic green paper for sustainable engineering',
    paperColor: '#ecfdf5',
    gridColor: '#a7f3d0',
    accent: '#059669',
  },
  {
    id: 'sand',
    name: 'Warm Parchment',
    desc: 'High-contrast parchment tone for long site drafting sessions',
    paperColor: '#fefce8',
    gridColor: '#fde68a',
    accent: '#d97706',
  },
  {
    id: 'dark',
    name: 'Dark Obsidian',
    desc: 'Low-glare night field mode with dark technical blueprint grid',
    paperColor: '#0b1329',
    gridColor: '#1e293b',
    accent: '#38bdf8',
    isDark: true,
  },
];

interface AppearanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppearanceSettings;
  onApply: (newSettings: AppearanceSettings) => void;
  onReset: () => void;
}

export function AppearanceModal({
  isOpen,
  onClose,
  settings,
  onApply,
  onReset,
}: AppearanceModalProps) {
  const [draft, setDraft] = useState<AppearanceSettings>(settings);
  const [appliedFeedback, setAppliedFeedback] = useState(false);

  // Sync draft whenever modal opens or settings change
  useEffect(() => {
    if (isOpen) {
      setDraft(settings);
      setAppliedFeedback(false);
    }
  }, [isOpen, settings]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleApply = () => {
    onApply(draft);
    setAppliedFeedback(true);
    setTimeout(() => {
      setAppliedFeedback(false);
      onClose();
    }, 900);
  };

  const handleReset = () => {
    const defaults: AppearanceSettings = {
      theme: 'blueprint',
      gridEnabled: true,
      gridStrength: 'subtle',
      density: 'comfortable',
    };
    setDraft(defaults);
    onReset();
    setAppliedFeedback(true);
    setTimeout(() => {
      setAppliedFeedback(false);
    }, 1200);
  };

  const selectedThemeMeta = THEME_OPTIONS.find((t) => t.id === draft.theme) || THEME_OPTIONS[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs overflow-y-auto animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appearance-modal-title"
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-3xl overflow-hidden flex flex-col my-auto transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-slate-900 dark:bg-slate-950 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-400/30 flex items-center justify-center shadow-xs">
              <Palette size={20} />
            </div>
            <div>
              <h2 id="appearance-modal-title" className="font-bold text-base leading-tight">
                Workspace Appearance &amp; Drafting Theme
              </h2>
              <p className="text-xs text-slate-400">
                Personalize technical graph paper, background grid, and interface density
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close appearance modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto [scrollbar-width:thin]">
          {/* Section 1: Themes */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Palette size={14} className="text-amber-500" />
                Technical Graph Paper Preset
              </label>
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Active Selection: <strong className="text-slate-900 dark:text-slate-100">{selectedThemeMeta.name}</strong>
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {THEME_OPTIONS.map((theme) => {
                const isSelected = draft.theme === theme.id;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, theme: theme.id }))}
                    className={`p-3 rounded-2xl border text-left transition-all touch-manipulation relative flex flex-col justify-between min-h-[92px] ${
                      isSelected
                        ? 'border-amber-500 bg-amber-50/60 dark:bg-amber-950/40 ring-2 ring-amber-500/30 shadow-xs'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span
                        className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 shadow-xs flex-shrink-0"
                        style={{ backgroundColor: theme.paperColor }}
                      />
                      {isSelected ? (
                        <span className="w-4 h-4 rounded-full bg-amber-600 text-white flex items-center justify-center flex-shrink-0">
                          <Check size={10} strokeWidth={3} />
                        </span>
                      ) : (
                        <span className="w-3 h-3 rounded-full border border-slate-300 dark:border-slate-600" />
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-tight">
                        {theme.name}
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight mt-1 line-clamp-2">
                        {theme.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2 & 3: Technical Grid Controls & Interface Density Side-by-Side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Grid Controls */}
            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Grid size={16} className="text-amber-500 flex-shrink-0" />
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">Engineering Background Grid</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Display drafting paper lines</div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.gridEnabled}
                    onChange={(e) => setDraft((prev) => ({ ...prev, gridEnabled: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
                </label>
              </div>

              {draft.gridEnabled ? (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
                    Grid Line Intensity
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'subtle', label: 'Subtle', desc: 'Low opacity' },
                      { id: 'standard', label: 'Standard', desc: 'Balanced' },
                      { id: 'high-contrast', label: 'High Contrast', desc: 'Crisp drafting' },
                    ].map((lvl) => (
                      <button
                        key={lvl.id}
                        type="button"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            gridStrength: lvl.id as AppearanceSettings['gridStrength'],
                          }))
                        }
                        className={`py-2 px-1.5 rounded-xl border text-center transition-all ${
                          draft.gridStrength === lvl.id
                            ? 'border-amber-600 bg-amber-500 text-white font-bold shadow-xs'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium'
                        }`}
                      >
                        <div className="text-xs">{lvl.label}</div>
                        <div className={`text-[9px] ${draft.gridStrength === lvl.id ? 'text-amber-100' : 'text-slate-400 dark:text-slate-500'}`}>
                          {lvl.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-400 dark:text-slate-500 italic">
                  Background grid turned off. Plain drafting paper active.
                </div>
              )}
            </div>

            {/* Interface Density */}
            <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex flex-col justify-between space-y-3">
              <div className="flex items-center gap-2">
                <Sliders size={16} className="text-amber-500 flex-shrink-0" />
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">Interface Display Density</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Adjust row padding &amp; data compression</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, density: 'comfortable' }))}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    draft.density === 'comfortable'
                      ? 'border-amber-600 bg-amber-50 dark:bg-amber-950/40 text-slate-900 dark:text-slate-100 font-bold ring-1 ring-amber-500'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  <div className="text-xs font-bold">Comfortable</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-normal mt-0.5">Spacious touch layout</div>
                </button>
                <button
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, density: 'compact' }))}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    draft.density === 'compact'
                      ? 'border-amber-600 bg-amber-50 dark:bg-amber-950/40 text-slate-900 dark:text-slate-100 font-bold ring-1 ring-amber-500'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  <div className="text-xs font-bold">Compact</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-normal mt-0.5">Tighter rows for BOQ</div>
                </button>
              </div>
            </div>
          </div>

          {/* Section 4: Live Interactive Preview */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 bg-slate-900 text-white shadow-inner">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Eye size={13} /> Live Interactive Canvas Preview
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {selectedThemeMeta.name} · {draft.gridEnabled ? draft.gridStrength : 'No Grid'} · {draft.density}
              </span>
            </div>
            <div
              className="rounded-xl p-3.5 border border-slate-700 text-slate-900 transition-colors min-h-[96px] flex items-center justify-between gap-3 shadow-inner"
              style={{
                backgroundColor: selectedThemeMeta.paperColor,
                backgroundImage: draft.gridEnabled
                  ? `linear-gradient(to right, ${selectedThemeMeta.gridColor} 1px, transparent 1px), linear-gradient(to bottom, ${selectedThemeMeta.gridColor} 1px, transparent 1px)`
                  : 'none',
                backgroundSize: draft.gridStrength === 'high-contrast' ? '20px 20px' : '24px 24px',
              }}
            >
              <div className={`bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs rounded-xl border border-slate-300 dark:border-slate-700 shadow-sm max-w-[220px] ${
                draft.density === 'compact' ? 'p-2' : 'p-3'
              }`}>
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">HVAC Ductwork BOQ</div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">6,500 m · €420,000</div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-600 text-white shadow-xs">
                  Active Spec
                </span>
                <span className="text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300 bg-white/80 dark:bg-slate-800/80 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                  DW144 / Class B
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer with Apply & Reset Buttons */}
        <div className="bg-slate-100 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <RotateCcw size={14} />
            <span>Reset to Defaults</span>
          </button>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleApply}
              className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold text-white shadow-md transition-all touch-manipulation ${
                appliedFeedback
                  ? 'bg-emerald-600 hover:bg-emerald-700 ring-2 ring-emerald-400'
                  : 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800 ring-2 ring-amber-500/20'
              }`}
            >
              <Check size={16} strokeWidth={2.5} />
              <span>{appliedFeedback ? 'Applied & Saved!' : 'Apply Appearance'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
