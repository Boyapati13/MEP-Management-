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
    paperColor: '#f5f9fd',
    gridColor: '#cbddeb',
    accent: '#2563eb',
  },
  {
    id: 'slate',
    name: 'Slate Minimalist',
    desc: 'Clean architectural neutral grey drafting background',
    paperColor: '#f7f8fa',
    gridColor: '#dde2e8',
    accent: '#475569',
  },
  {
    id: 'sage',
    name: 'Sage Eco',
    desc: 'Subtle biophilic green paper for sustainable engineering',
    paperColor: '#f5f9f6',
    gridColor: '#d4e5da',
    accent: '#059669',
  },
  {
    id: 'sand',
    name: 'Warm Parchment',
    desc: 'High-contrast parchment tone for long site drafting sessions',
    paperColor: '#fbf9f5',
    gridColor: '#e8e0d4',
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
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appearance-modal-title"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-2xl overflow-hidden flex flex-col my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-400/30 flex items-center justify-center">
              <Palette size={20} />
            </div>
            <div>
              <h2 id="appearance-modal-title" className="font-bold text-base leading-tight">
                Workspace Appearance &amp; Drafting Theme
              </h2>
              <p className="text-xs text-slate-400">
                Personalize graph paper, background grid, and interface density
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
        <div className="p-5 sm:p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          {/* Section 1: Themes */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Palette size={14} className="text-amber-600" />
                Graph Paper Theme Preset
              </label>
              <span className="text-[11px] font-medium text-slate-500">
                Selected: <strong className="text-slate-800">{selectedThemeMeta.name}</strong>
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {THEME_OPTIONS.map((theme) => {
                const isSelected = draft.theme === theme.id;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, theme: theme.id }))}
                    className={`p-3 rounded-xl border text-left transition-all touch-manipulation relative flex flex-col justify-between h-24 ${
                      isSelected
                        ? 'border-amber-500 bg-amber-50/40 ring-2 ring-amber-500/20 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-4 h-4 rounded-full border border-slate-300 shadow-2xs flex-shrink-0"
                          style={{ backgroundColor: theme.paperColor }}
                        />
                        <span className="text-xs font-bold text-slate-800">{theme.name}</span>
                      </div>
                      {isSelected && (
                        <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center flex-shrink-0">
                          <Check size={12} strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-snug line-clamp-2 mt-1">
                      {theme.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Technical Grid Controls */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Grid size={16} className="text-slate-700" />
                <div>
                  <div className="text-xs font-bold text-slate-800">Engineering Background Grid</div>
                  <div className="text-[11px] text-slate-500">Display 24px × 120px drafting paper lines</div>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.gridEnabled}
                  onChange={(e) => setDraft((prev) => ({ ...prev, gridEnabled: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
              </label>
            </div>

            {draft.gridEnabled && (
              <div className="pt-2 border-t border-slate-200">
                <label className="block text-xs font-medium text-slate-700 mb-2">
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
                      className={`py-2 px-2.5 rounded-lg border text-center transition-colors ${
                        draft.gridStrength === lvl.id
                          ? 'border-amber-600 bg-amber-500 text-white font-bold'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 font-medium'
                      }`}
                    >
                      <div className="text-xs">{lvl.label}</div>
                      <div className={`text-[10px] ${draft.gridStrength === lvl.id ? 'text-amber-100' : 'text-slate-400'}`}>
                        {lvl.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Interface Density */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sliders size={16} className="text-slate-700" />
              <div>
                <div className="text-xs font-bold text-slate-800">Interface Display Density</div>
                <div className="text-[11px] text-slate-500">Choose between spacious layout or dense engineering data</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, density: 'comfortable' }))}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  draft.density === 'comfortable'
                    ? 'border-amber-600 bg-amber-50 text-slate-900 font-bold ring-1 ring-amber-500'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div className="text-xs font-bold">Comfortable</div>
                <div className="text-[11px] text-slate-500 font-normal">Standard padding for tablets and mobile</div>
              </button>
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, density: 'compact' }))}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  draft.density === 'compact'
                    ? 'border-amber-600 bg-amber-50 text-slate-900 font-bold ring-1 ring-amber-500'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                <div className="text-xs font-bold">Compact (Data Heavy)</div>
                <div className="text-[11px] text-slate-500 font-normal">Tighter rows for large BOQs and Gantt charts</div>
              </button>
            </div>
          </div>

          {/* Section 4: Live Interactive Preview */}
          <div className="border border-slate-200 rounded-xl p-3.5 bg-slate-900 text-white">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
                <Eye size={12} /> Live Preview Canvas
              </span>
              <span className="text-[10px] text-slate-400">
                {selectedThemeMeta.name} · {draft.gridEnabled ? draft.gridStrength : 'No Grid'} · {draft.density}
              </span>
            </div>
            <div
              className="rounded-lg p-3 border border-slate-700 text-slate-900 transition-colors min-h-[90px] flex items-center justify-between gap-3 shadow-inner"
              style={{
                backgroundColor: selectedThemeMeta.paperColor,
                backgroundImage: draft.gridEnabled
                  ? `linear-gradient(to right, ${selectedThemeMeta.gridColor} 1px, transparent 1px), linear-gradient(to bottom, ${selectedThemeMeta.gridColor} 1px, transparent 1px)`
                  : 'none',
                backgroundSize: '20px 20px',
              }}
            >
              <div className="bg-white/90 backdrop-blur-xs p-2.5 rounded-lg border border-slate-300 shadow-2xs max-w-[200px]">
                <div className="text-[11px] font-bold text-slate-900">HVAC Ductwork BOQ</div>
                <div className="text-[10px] text-slate-500">6,500 m · $420,000</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-600 text-white">
                  Active Spec
                </span>
                <span className="text-[10px] font-mono text-slate-600">DW144 / Class B</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer with THE APPLY BUTTON and Reset */}
        <div className="bg-slate-100 border-t border-slate-200 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition-colors"
          >
            <RotateCcw size={14} />
            <span>Reset to Defaults</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200 transition-colors"
            >
              Cancel
            </button>

            {/* THE PRIMARY APPLY BUTTON */}
            <button
              type="button"
              onClick={handleApply}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-md transition-all touch-manipulation ${
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
