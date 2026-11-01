import React, { useState, useEffect } from 'react';
import {
  Sliders,
  DollarSign,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Plus,
  Trash2,
  Edit3,
  FileText,
  Sparkles,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Search,
  Filter,
  Check,
  ShieldCheck,
  Package,
  Layers,
  ArrowRight,
  TrendingUp,
  RefreshCw,
  X,
  FileCheck2
} from 'lucide-react';
import { selectionsApi, api } from '../api';

interface Choice {
  id: string;
  category_id: string;
  title: string;
  manufacturer?: string;
  model_number?: string;
  unit_price: number;
  quantity: number;
  total_price: number;
  lead_time_weeks: number;
  is_baseline: number;
  image_url?: string;
  spec_sheet_url?: string;
  description?: string;
  technical_specs?: string;
}

interface Category {
  id: string;
  project_id: string;
  name: string;
  trade: string;
  allowance_amount: number;
  cutoff_date?: string;
  status: 'Pending Client Choice' | 'Approved' | 'Draft' | 'Selected';
  selected_choice_id?: string;
  approved_by?: string;
  approved_at?: string;
  approval_notes?: string;
  signature_token?: string;
  boq_ref?: string;
  task_id?: string;
  change_order_id?: string;
  choices: Choice[];
  selected_choice?: Choice;
  selected_amount: number;
  variance: number;
  is_over_allowance: boolean;
  is_under_allowance: boolean;
  days_until_cutoff?: number;
  is_overdue: boolean;
}

interface Metrics {
  total_allowance: number;
  total_selected: number;
  net_variance: number;
  categories_count: number;
  approved_count: number;
  pending_count: number;
  overdue_count: number;
}

interface Props {
  projectId: string;
  addToast: (type: 'success' | 'error' | 'info', msg: string) => void;
  user?: any;
}

export function SelectionsManagerView({ projectId, addToast, user }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tradeFilter, setTradeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');

  // Modals
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isChoiceModalOpen, setIsChoiceModalOpen] = useState(false);
  const [activeCategoryIdForChoice, setActiveCategoryIdForChoice] = useState<string | null>(null);
  const [isSignModalOpen, setIsSignModalOpen] = useState(false);
  const [signCategory, setSignCategory] = useState<Category | null>(null);
  const [signChoiceId, setSignChoiceId] = useState<string>('');
  const [signerName, setSignerName] = useState(user?.name || '');
  const [approvalNotes, setApprovalNotes] = useState('');

  // Form states
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    trade: 'Electrical',
    allowance_amount: 10000,
    cutoff_date: '',
    boq_ref: '',
  });

  const [choiceForm, setChoiceForm] = useState({
    title: '',
    manufacturer: '',
    model_number: '',
    unit_price: 100,
    quantity: 1,
    lead_time_weeks: 3,
    is_baseline: false,
    image_url: '',
    description: '',
    technical_specs: '',
  });

  async function loadData() {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const data = await selectionsApi.getProjectSelections(projectId);
      setCategories(data.categories || []);
      setMetrics(data.metrics || null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load project selections');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [projectId]);

  async function handleSeedDefaults() {
    try {
      setLoading(true);
      await selectionsApi.seedDefaults(projectId, true);
      addToast('success', 'Buildertrend-style MEP selection categories seeded successfully');
      await loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to seed selections');
      setLoading(false);
    }
  }

  async function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    try {
      await selectionsApi.createCategory(projectId, categoryForm);
      addToast('success', `Created category: ${categoryForm.name}`);
      setIsCategoryModalOpen(false);
      setCategoryForm({ name: '', trade: 'Electrical', allowance_amount: 10000, cutoff_date: '', boq_ref: '' });
      await loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create category');
    }
  }

  async function handleCreateChoice(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCategoryIdForChoice) return;
    try {
      await selectionsApi.addChoice(activeCategoryIdForChoice, choiceForm);
      addToast('success', `Added option: ${choiceForm.title}`);
      setIsChoiceModalOpen(false);
      setChoiceForm({
        title: '',
        manufacturer: '',
        model_number: '',
        unit_price: 100,
        quantity: 1,
        lead_time_weeks: 3,
        is_baseline: false,
        image_url: '',
        description: '',
        technical_specs: '',
      });
      await loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to add option');
    }
  }

  async function handleSelectChoiceDirect(categoryId: string, choiceId: string) {
    try {
      await selectionsApi.selectChoice(categoryId, { choice_id: choiceId, lock_approval: false });
      addToast('info', 'Choice updated for category');
      await loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to select choice');
    }
  }

  function openSignModal(category: Category, choiceId: string) {
    setSignCategory(category);
    setSignChoiceId(choiceId);
    setSignerName(user?.name || 'Client Representative');
    setApprovalNotes('');
    setIsSignModalOpen(true);
  }

  async function handleExecuteApproval(e: React.FormEvent) {
    e.preventDefault();
    if (!signCategory || !signChoiceId) return;
    try {
      await selectionsApi.selectChoice(signCategory.id, {
        choice_id: signChoiceId,
        approved_by: signerName,
        approval_notes: approvalNotes,
        lock_approval: true,
      });
      addToast('success', `Selection formally approved and locked for ${signCategory.name}`);
      setIsSignModalOpen(false);
      await loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to approve selection');
    }
  }

  async function handleCreateVariation(categoryId: string) {
    try {
      const res = await selectionsApi.createVariation(categoryId);
      addToast('success', `Generated Change Order ${res.change_order?.number} for €${res.variance.toLocaleString()}`);
      await loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to generate variation');
    }
  }

  async function handleDeleteCategory(categoryId: string, name: string) {
    if (!confirm(`Delete allowance category "${name}" and all its choice options?`)) return;
    try {
      await selectionsApi.deleteCategory(categoryId);
      addToast('success', 'Category deleted');
      await loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to delete category');
    }
  }

  // Filtered categories
  const filtered = categories.filter((cat) => {
    if (tradeFilter !== 'All' && cat.trade !== tradeFilter) return false;
    if (statusFilter === 'Pending' && cat.status === 'Approved') return false;
    if (statusFilter === 'Approved' && cat.status !== 'Approved') return false;
    if (statusFilter === 'Overdue' && !cat.is_overdue) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchCat = cat.name.toLowerCase().includes(q) || (cat.boq_ref && cat.boq_ref.toLowerCase().includes(q));
      const matchChoice = cat.choices.some(
        (c) => c.title.toLowerCase().includes(q) || (c.manufacturer && c.manufacturer.toLowerCase().includes(q))
      );
      if (!matchCat && !matchChoice) return false;
    }
    return true;
  });

  const trades = ['All', 'Electrical', 'Critical Power', 'Lighting', 'HVAC', 'ELV', 'Fire Fighting', 'Plumbing'];

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* ─── Header & Title ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              <Sliders size={20} />
            </span>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Selections &amp; Allowances Manager
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Buildertrend-grade allowance budgets, client choice catalogs, cutoff deadline management &amp; variation sync
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleSeedDefaults}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors border border-slate-200 dark:border-slate-700"
            title="Populate demo MEP allowances & options"
          >
            <Sparkles size={14} className="text-amber-500" /> Demo Selections
          </button>
          <button
            onClick={loadData}
            className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            title="Refresh"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => setIsCategoryModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
          >
            <Plus size={15} /> Add Allowance Category
          </button>
        </div>
      </div>

      {/* ─── Buildertrend Allowance Cockpit (Financial Rollup Strip) ─────────────── */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {/* Total Allowances */}
          <div className="bg-white dark:bg-slate-850 dark:bg-slate-900/90 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400 block mb-1">
              Total Allowances Budget
            </span>
            <div className="text-xl sm:text-2xl font-bold font-mono text-slate-900 dark:text-slate-100">
              €{metrics.total_allowance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <span className="text-[10px] text-slate-500 mt-1 block">Contract baseline limit</span>
          </div>

          {/* Total Selected */}
          <div className="bg-white dark:bg-slate-850 dark:bg-slate-900/90 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400 block mb-1">
              Total Selected Cost
            </span>
            <div className="text-xl sm:text-2xl font-bold font-mono text-blue-600 dark:text-blue-400">
              €{metrics.total_selected.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <span className="text-[10px] text-slate-500 mt-1 block">Active selections total</span>
          </div>

          {/* Net Variance Over / Under */}
          <div className="bg-white dark:bg-slate-850 dark:bg-slate-900/90 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400 block mb-1">
              Net Allowance Variance
            </span>
            <div
              className={`text-xl sm:text-2xl font-bold font-mono ${
                metrics.net_variance > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : metrics.net_variance < 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {metrics.net_variance > 0 ? '+' : ''}€
              {metrics.net_variance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <span className="text-[10px] font-semibold mt-1 block">
              {metrics.net_variance > 0 ? (
                <span className="text-amber-600 dark:text-amber-400">⚠️ Over Allowance (Upgrades)</span>
              ) : metrics.net_variance < 0 ? (
                <span className="text-emerald-600 dark:text-emerald-400">✓ Under Allowance (Savings)</span>
              ) : (
                'Balanced at Baseline'
              )}
            </span>
          </div>

          {/* Decisions Progress */}
          <div className="bg-white dark:bg-slate-850 dark:bg-slate-900/90 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">
                Approvals Gate
              </span>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {metrics.approved_count}/{metrics.categories_count}
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
              {metrics.categories_count ? Math.round((metrics.approved_count / metrics.categories_count) * 100) : 0}%
            </div>
            <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 mt-2 overflow-hidden">
              <div
                className="h-1.5 bg-emerald-500 rounded-full transition-all duration-500"
                style={{
                  width: `${metrics.categories_count ? (metrics.approved_count / metrics.categories_count) * 100 : 0}%`,
                }}
              />
            </div>
          </div>

          {/* Cutoff Health Alert */}
          <div className="col-span-2 sm:col-span-1 bg-white dark:bg-slate-850 dark:bg-slate-900/90 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400 block mb-1">
              Cutoff Schedule Health
            </span>
            <div className="flex items-center gap-2">
              <div
                className={`text-xl sm:text-2xl font-bold font-mono ${
                  metrics.overdue_count > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {metrics.overdue_count} Overdue
              </div>
            </div>
            <span className="text-[10px] text-slate-500 mt-1 block">
              {metrics.pending_count} awaiting client choice
            </span>
          </div>
        </div>
      )}

      {/* ─── Toolbar Filters ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-850 dark:bg-slate-900/80 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 flex-1 max-w-sm">
            <Search size={14} className="text-slate-400 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search category, BOQ ref, or product…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-xs w-full focus:outline-none text-slate-800 dark:text-slate-100 placeholder-slate-400"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
                <X size={12} />
              </button>
            )}
          </div>

          {/* Trade Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
            {trades.map((t) => (
              <button
                key={t}
                onClick={() => setTradeFilter(t)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors whitespace-nowrap border ${
                  tradeFilter === t
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs font-semibold border border-slate-200 dark:border-slate-700 rounded-xl px-2 py-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 outline-none"
          >
            <option value="All">All Categories</option>
            <option value="Pending">Pending Choice</option>
            <option value="Approved">Approved</option>
            <option value="Overdue">Overdue Cutoffs</option>
          </select>
        </div>
      </div>

      {/* ─── Content List of Allowance Categories ─────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-slate-400">Loading allowance categories &amp; choices…</p>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-12 text-center">
          <Sliders size={36} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">No Selections Categories Found</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mt-1 mb-4">
            Create your first allowance category or click "Demo Selections" to populate real commercial MEP equipment options.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleSeedDefaults}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-colors"
            >
              Populate Demo Selections
            </button>
            <button
              onClick={() => setIsCategoryModalOpen(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors"
            >
              Add New Category
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {filtered.map((category) => (
            <div
              key={category.id}
              className={`bg-white dark:bg-slate-850 dark:bg-slate-900/95 rounded-2xl border shadow-xs overflow-hidden transition-all ${
                category.is_overdue
                  ? 'border-rose-300 dark:border-rose-900/50'
                  : category.status === 'Approved'
                  ? 'border-emerald-300 dark:border-emerald-900/40'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              {/* Category Header */}
              <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-900/50">
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                      {category.trade}
                    </span>
                    {category.boq_ref && (
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {category.boq_ref}
                      </span>
                    )}
                    {category.status === 'Approved' ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 flex items-center gap-1">
                        <CheckCircle2 size={12} /> Approved &amp; Locked
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 flex items-center gap-1">
                        <Clock size={12} /> Pending Client Choice
                      </span>
                    )}

                    {category.cutoff_date && (
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 ${
                          category.is_overdue
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200 animate-pulse'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        <Calendar size={11} /> Cutoff:{' '}
                        {new Date(category.cutoff_date + 'T00:00:00').toLocaleDateString(undefined, {
                          day: '2-digit',
                          month: 'short',
                        })}
                        {category.days_until_cutoff != null && (
                          <span className="opacity-80">
                            ({category.is_overdue ? `${Math.abs(category.days_until_cutoff)}d overdue` : `${category.days_until_cutoff}d left`})
                          </span>
                        )}
                      </span>
                    )}
                  </div>

                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">{category.name}</h2>
                </div>

                {/* Allowance vs Selected Pill Strip */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="text-right">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Baseline Allowance</span>
                    <span className="text-sm font-bold font-mono text-slate-700 dark:text-slate-300">
                      €{category.allowance_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Selected Option</span>
                    <span className="text-sm font-bold font-mono text-blue-600 dark:text-blue-400">
                      €{category.selected_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="text-right pl-2 border-l border-slate-200 dark:border-slate-800">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Variance</span>
                    <span
                      className={`text-sm font-bold font-mono ${
                        category.variance > 0
                          ? 'text-amber-600 dark:text-amber-400'
                          : category.variance < 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-500'
                      }`}
                    >
                      {category.variance > 0 ? '+' : ''}€
                      {category.variance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 pl-2">
                    <button
                      onClick={() => {
                        setActiveCategoryIdForChoice(category.id);
                        setIsChoiceModalOpen(true);
                      }}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                      title="Add Choice Option"
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      onClick={() => handleDeleteCategory(category.id, category.name)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 rounded-lg transition-colors"
                      title="Delete Category"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Buildertrend Variation Claim Banner (when variance > 0) */}
              {category.variance > 0 && (
                <div className="px-5 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300 font-medium">
                    <AlertTriangle size={15} className="text-amber-500 flex-shrink-0" />
                    <span>
                      Selected specification exceeds allowance by{' '}
                      <strong className="font-bold font-mono">€{category.variance.toLocaleString()}</strong>.
                    </span>
                  </div>
                  {!category.change_order_id ? (
                    <button
                      onClick={() => handleCreateVariation(category.id)}
                      className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors whitespace-nowrap self-start sm:self-auto flex items-center gap-1"
                    >
                      <FileCheck2 size={13} /> ⚡ Convert to Change Order Variation
                    </button>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <Check size={13} /> Linked to Variation Claim (VoR)
                    </span>
                  )}
                </div>
              )}

              {/* Approval Seal (if already approved) */}
              {category.status === 'Approved' && (
                <div className="px-5 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-emerald-900 dark:text-emerald-200">
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                    <span>
                      <strong>Formally Approved by:</strong> {category.approved_by || 'Client Representative'} on{' '}
                      {category.approved_at ? new Date(category.approved_at).toLocaleDateString() : 'N/A'}{' '}
                      {category.signature_token && (
                        <span className="font-mono text-[10px] bg-emerald-600/20 px-1.5 py-0.5 rounded ml-1">
                          {category.signature_token}
                        </span>
                      )}
                    </span>
                  </div>
                  {category.approval_notes && (
                    <span className="text-[11px] italic text-slate-600 dark:text-slate-300">
                      "{category.approval_notes}"
                    </span>
                  )}
                </div>
              )}

              {/* Choices Comparison Grid (Buildertrend Showroom Cards) */}
              <div className="p-4 sm:p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {category.choices.map((choice) => {
                    const isSelected = category.selected_choice_id === choice.id;
                    const choiceVariance = choice.total_price - category.allowance_amount;

                    return (
                      <div
                        key={choice.id}
                        className={`relative rounded-xl border p-4 flex flex-col justify-between transition-all ${
                          isSelected
                            ? 'bg-blue-50/40 dark:bg-blue-950/20 border-blue-500 ring-2 ring-blue-500/20 shadow-md'
                            : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700/80 hover:border-slate-300'
                        }`}
                      >
                        {/* Selected Radio Indicator Badge */}
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {choice.is_baseline === 1 && (
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                                Tender Baseline
                              </span>
                            )}
                            {choice.lead_time_weeks && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 flex items-center gap-0.5">
                                <Clock size={10} /> {choice.lead_time_weeks}w Lead
                              </span>
                            )}
                          </div>

                          {isSelected ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-600 text-white flex items-center gap-1">
                              <Check size={11} /> Selected
                            </span>
                          ) : (
                            <button
                              onClick={() => handleSelectChoiceDirect(category.id, choice.id)}
                              className="text-[10px] font-bold text-slate-400 hover:text-blue-600 px-2 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                            >
                              Choose Option
                            </button>
                          )}
                        </div>

                        {/* Image Thumbnail */}
                        {choice.image_url && (
                          <div className="h-32 w-full rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-900 mb-3 border border-slate-200 dark:border-slate-700">
                            <img
                              src={choice.image_url}
                              alt={choice.title}
                              className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                            />
                          </div>
                        )}

                        {/* Title & Manufacturer */}
                        <div>
                          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug mb-1">
                            {choice.title}
                          </h4>
                          {(choice.manufacturer || choice.model_number) && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mb-2">
                              {choice.manufacturer} {choice.model_number && `· ${choice.model_number}`}
                            </p>
                          )}

                          {choice.description && (
                            <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 mb-3">
                              {choice.description}
                            </p>
                          )}

                          {choice.technical_specs && (
                            <div className="bg-slate-50 dark:bg-slate-900/60 p-2 rounded-lg text-[10px] text-slate-600 dark:text-slate-300 font-mono mb-3">
                              {choice.technical_specs}
                            </div>
                          )}
                        </div>

                        {/* Pricing & Difference from Allowance */}
                        <div className="pt-3 border-t border-slate-100 dark:border-slate-700/60 mt-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-slate-400 font-medium">
                              {choice.quantity} {choice.quantity > 1 ? `x €${choice.unit_price}` : ''} Total Price:
                            </span>
                            <span className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100">
                              €{choice.total_price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-xs font-semibold">
                            <span className="text-[10px] text-slate-400">Allowance Diff:</span>
                            <span
                              className={`font-mono ${
                                choiceVariance > 0
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : choiceVariance < 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-slate-500'
                              }`}
                            >
                              {choiceVariance > 0 ? '+' : ''}€
                              {choiceVariance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                          </div>

                          {/* Approval / Selection Button */}
                          <div className="mt-3">
                            {category.status !== 'Approved' && (
                              <button
                                onClick={() => openSignModal(category, choice.id)}
                                className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                                  isSelected
                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                                    : 'bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                                }`}
                              >
                                <CheckCircle2 size={13} /> {isSelected ? 'Sign & Lock Approval' : 'Select & Sign Option'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Modal: Create Allowance Category ────────────────────────────────────── */}
      {isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-900 text-white">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Sliders size={16} className="text-amber-400" /> Add Allowance Category
              </h3>
              <button
                onClick={() => setIsCategoryModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateCategory} className="p-6 space-y-4">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                  Category Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Architectural Office Linear LED Fixtures"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                    Trade Discipline
                  </label>
                  <select
                    value={categoryForm.trade}
                    onChange={(e) => setCategoryForm({ ...categoryForm, trade: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                  >
                    <option value="Electrical">Electrical</option>
                    <option value="Critical Power">Critical Power</option>
                    <option value="Lighting">Lighting</option>
                    <option value="HVAC">HVAC</option>
                    <option value="ELV">ELV</option>
                    <option value="Fire Fighting">Fire Fighting</option>
                    <option value="Plumbing">Plumbing</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                    Allowance Budget (€) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={categoryForm.allowance_amount}
                    onChange={(e) => setCategoryForm({ ...categoryForm, allowance_amount: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                    Selection Cutoff Date
                  </label>
                  <input
                    type="date"
                    value={categoryForm.cutoff_date}
                    onChange={(e) => setCategoryForm({ ...categoryForm, cutoff_date: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                    Linked BOQ Item Ref
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. BOQ-2618-3.0"
                    value={categoryForm.boq_ref}
                    onChange={(e) => setCategoryForm({ ...categoryForm, boq_ref: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCategoryModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold"
                >
                  Create Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Modal: Add Choice Option ────────────────────────────────────────────── */}
      {isChoiceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-900 text-white">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <Package size={16} className="text-blue-400" /> Add Choice Option
              </h3>
              <button
                onClick={() => setIsChoiceModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateChoice} className="p-6 space-y-4">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                  Option Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Zumtobel MIREL Evolution High CRI90"
                  value={choiceForm.title}
                  onChange={(e) => setChoiceForm({ ...choiceForm, title: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                    Manufacturer
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Zumtobel / Philips"
                    value={choiceForm.manufacturer}
                    onChange={(e) => setChoiceForm({ ...choiceForm, manufacturer: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                    Model / SKU
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. EVO-600-3400-940"
                    value={choiceForm.model_number}
                    onChange={(e) => setChoiceForm({ ...choiceForm, model_number: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                    Unit Price (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={choiceForm.unit_price}
                    onChange={(e) => setChoiceForm({ ...choiceForm, unit_price: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                    Quantity
                  </label>
                  <input
                    type="number"
                    required
                    value={choiceForm.quantity}
                    onChange={(e) => setChoiceForm({ ...choiceForm, quantity: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                    Lead Time (Wks)
                  </label>
                  <input
                    type="number"
                    value={choiceForm.lead_time_weeks}
                    onChange={(e) => setChoiceForm({ ...choiceForm, lead_time_weeks: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                  Product Image URL
                </label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={choiceForm.image_url}
                  onChange={(e) => setChoiceForm({ ...choiceForm, image_url: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                  Technical Specifications Summary
                </label>
                <input
                  type="text"
                  placeholder="e.g. Lumens: 3800lm | CCT: 4000K | CRI: 92 | DALI"
                  value={choiceForm.technical_specs}
                  onChange={(e) => setChoiceForm({ ...choiceForm, technical_specs: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="baselineCheck"
                  checked={choiceForm.is_baseline}
                  onChange={(e) => setChoiceForm({ ...choiceForm, is_baseline: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="baselineCheck" className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                  Set as default Contract Tender Baseline option
                </label>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsChoiceModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold"
                >
                  Add Option
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Modal: Digital E-Signature & Formal Approval ─────────────────────────── */}
      {isSignModalOpen && signCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-emerald-950 text-white">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <ShieldCheck size={18} className="text-emerald-400" /> Digital Selection Approval &amp; E-Sign
              </h3>
              <button
                onClick={() => setIsSignModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleExecuteApproval} className="p-6 space-y-4">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200">
                <p className="font-bold">You are formally approving the specification for:</p>
                <p className="text-sm font-semibold mt-0.5">{signCategory.name}</p>
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                  Approving Officer / Client Representative *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe, Lead Project Manager"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1 block">
                  Signoff Notes &amp; Technical Conditions (Optional)
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Approved provided sample finish matches architectural mood board."
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 outline-none"
                />
              </div>

              <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-[11px] text-slate-500 font-mono">
                Verification Token: SIG-BOV-{Math.random().toString(16).substring(2, 8).toUpperCase()} (Timestamped in Audit Trail)
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsSignModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
                >
                  <CheckCircle2 size={14} /> Execute Digital Approval
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
