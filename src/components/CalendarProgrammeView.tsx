import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Package,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Filter,
  Layers,
  ArrowRight,
  Sparkles,
  Maximize2,
  CalendarDays,
  CalendarRange,
  Zap,
  RotateCcw,
  Sliders,
  Check,
  X
} from 'lucide-react';
import { api, selectionsApi, tasksApi } from '../api';

export type CalendarViewType = 'month' | 'week' | 'day';

export interface CalendarTask {
  id: string;
  title: string;
  trade?: string;
  wbs_code?: string;
  boq_ref?: string;
  status: string;
  progress: number;
  priority?: string;
  start?: string;
  end?: string;
  site_name?: string;
  work_package_name?: string;
  evidence_url?: string;
  evidence_notes?: string;
  project_id?: string;
}

export interface MilestoneEvent {
  id: string;
  type: 'delivery' | 'inspection' | 'cutoff';
  date: string; // YYYY-MM-DD
  title: string;
  subtitle?: string;
  trade?: string;
  status?: string;
  amount?: number;
  raw: any;
}

interface CalendarProgrammeViewProps {
  tasks: CalendarTask[];
  projectId: string;
  onEditTask: (task: CalendarTask) => void;
  onAddTaskDate?: (dateStr: string) => void;
  onRefreshTasks?: () => void;
  addToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export const TRADE_COLORS: Record<string, { bg: string; text: string; border: string; bar: string; badge: string }> = {
  Electrical: {
    bg: 'bg-amber-500/15 dark:bg-amber-500/25',
    text: 'text-amber-800 dark:text-amber-200',
    border: 'border-amber-400 dark:border-amber-600',
    bar: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
  },
  HVAC: {
    bg: 'bg-sky-500/15 dark:bg-sky-500/25',
    text: 'text-sky-800 dark:text-sky-200',
    border: 'border-sky-400 dark:border-sky-600',
    bar: 'bg-sky-500',
    badge: 'bg-sky-100 text-sky-800 dark:bg-sky-950/80 dark:text-sky-300'
  },
  Plumbing: {
    bg: 'bg-teal-500/15 dark:bg-teal-500/25',
    text: 'text-teal-800 dark:text-teal-200',
    border: 'border-teal-400 dark:border-teal-600',
    bar: 'bg-teal-500',
    badge: 'bg-teal-100 text-teal-800 dark:bg-teal-950/80 dark:text-teal-300'
  },
  'Fire Fighting': {
    bg: 'bg-rose-500/15 dark:bg-rose-500/25',
    text: 'text-rose-800 dark:text-rose-200',
    border: 'border-rose-400 dark:border-rose-600',
    bar: 'bg-rose-500',
    badge: 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300'
  },
  ELV: {
    bg: 'bg-purple-500/15 dark:bg-purple-500/25',
    text: 'text-purple-800 dark:text-purple-200',
    border: 'border-purple-400 dark:border-purple-600',
    bar: 'bg-purple-500',
    badge: 'bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300'
  },
  Default: {
    bg: 'bg-indigo-500/15 dark:bg-indigo-500/25',
    text: 'text-indigo-800 dark:text-indigo-200',
    border: 'border-indigo-400 dark:border-indigo-600',
    bar: 'bg-indigo-500',
    badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300'
  }
};

export function getTradeColor(trade?: string) {
  if (!trade) return TRADE_COLORS.Default;
  return TRADE_COLORS[trade] || TRADE_COLORS.Default;
}

export function formatDateISO(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateSafe(str?: string): Date | null {
  if (!str) return null;
  const parts = str.split('T')[0].split('-');
  if (parts.length < 3) return null;
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

export function CalendarProgrammeView({
  tasks,
  projectId,
  onEditTask,
  onAddTaskDate,
  onRefreshTasks,
  addToast
}: CalendarProgrammeViewProps) {
  // Calendar View Mode: 'month' | 'week' | 'day'
  const [viewMode, setViewMode] = useState<CalendarViewType>('month');

  // Find initial reference date from project tasks
  const projectActiveDate = useMemo(() => {
    const dates = tasks
      .map(t => t.start || t.end)
      .filter(Boolean)
      .sort();
    if (dates.length > 0) {
      const parsed = parseDateSafe(dates[0]);
      if (parsed) return parsed;
    }
    return new Date();
  }, [tasks]);

  const [currentDate, setCurrentDate] = useState<Date>(projectActiveDate);
  const [selectedDay, setSelectedDay] = useState<string>(formatDateISO(projectActiveDate));

  // Trade and Overlay Filters
  const [tradeFilter, setTradeFilter] = useState<string>('All');
  const [showTasks, setShowTasks] = useState(true);
  const [showDeliveries, setShowDeliveries] = useState(true);
  const [showInspections, setShowInspections] = useState(true);
  const [showCutoffs, setShowCutoffs] = useState(true);

  // Milestones State
  const [milestones, setMilestones] = useState<MilestoneEvent[]>([]);
  const [loadingMilestones, setLoadingMilestones] = useState(false);

  // Day Overflow Popover
  const [overflowDate, setOverflowDate] = useState<string | null>(null);

  // Reschedule Modal / Prompt State
  const [reschedulingTask, setReschedulingTask] = useState<CalendarTask | null>(null);
  const [rescheduleStart, setRescheduleStart] = useState('');
  const [rescheduleEnd, setRescheduleEnd] = useState('');
  const [reschedulingLoading, setReschedulingLoading] = useState(false);

  // Fetch Milestones (POs, Inspections, Selections)
  useEffect(() => {
    let isMounted = true;
    async function loadMilestones() {
      setLoadingMilestones(true);
      const events: MilestoneEvent[] = [];

      try {
        // 1. Material Deliveries (POs)
        const poRes = await api.get<any[]>(`/api/purchase_orders${projectId ? `?project_id=${projectId}` : ''}`).catch(() => []);
        if (Array.isArray(poRes)) {
          poRes.forEach(po => {
            const date = po.expected_delivery_date || po.delivery_date;
            if (date) {
              events.push({
                id: `po-${po.id}`,
                type: 'delivery',
                date: date.split('T')[0],
                title: `PO ${po.po_number || po.id.slice(0, 8)} Delivery`,
                subtitle: `${po.vendor_name || 'Vendor'} · €${Number(po.total_amount || 0).toLocaleString()}`,
                status: po.status || 'Pending',
                amount: po.total_amount,
                raw: po
              });
            }
          });
        }

        // 2. QA/QC Inspections
        const inspRes = await api.get<any[]>(`/api/inspections${projectId ? `?project_id=${projectId}` : ''}`).catch(() => []);
        if (Array.isArray(inspRes)) {
          inspRes.forEach(insp => {
            const date = insp.date || insp.inspection_date;
            if (date) {
              events.push({
                id: `insp-${insp.id}`,
                type: 'inspection',
                date: date.split('T')[0],
                title: insp.title || 'QA/QC Inspection',
                subtitle: `${insp.inspection_type || insp.trade || 'MEP'} · ${insp.result || insp.status || 'Scheduled'}`,
                trade: insp.trade || insp.discipline,
                status: insp.result || insp.status,
                raw: insp
              });
            }
          });
        }

        // 3. Selection Cutoff Deadlines
        if (projectId) {
          const selRes = await selectionsApi.getProjectSelections(projectId).catch(() => null);
          if (selRes?.categories && Array.isArray(selRes.categories)) {
            selRes.categories.forEach(cat => {
              if (cat.cutoff_date) {
                events.push({
                  id: `cutoff-${cat.id}`,
                  type: 'cutoff',
                  date: cat.cutoff_date.split('T')[0],
                  title: `Cutoff: ${cat.name}`,
                  subtitle: `${cat.trade || 'Allowance'} · Status: ${cat.status || 'Open'}`,
                  trade: cat.trade,
                  status: cat.status,
                  raw: cat
                });
              }
            });
          }
        }

        if (isMounted) {
          setMilestones(events);
        }
      } catch {
        /* milestones are non-fatal overlays */
      } finally {
        if (isMounted) setLoadingMilestones(false);
      }
    }

    loadMilestones();
    return () => { isMounted = false; };
  }, [projectId]);

  // All distinct trades in current tasks
  const availableTrades = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach(t => { if (t.trade) set.add(t.trade); });
    return ['All', ...Array.from(set)];
  }, [tasks]);

  // Filter tasks by trade and visibility
  const filteredTasks = useMemo(() => {
    if (!showTasks) return [];
    return tasks.filter(t => {
      if (tradeFilter !== 'All' && t.trade !== tradeFilter) return false;
      return true;
    });
  }, [tasks, tradeFilter, showTasks]);

  // Filter milestones by overlay toggles
  const filteredMilestones = useMemo(() => {
    return milestones.filter(m => {
      if (m.type === 'delivery' && !showDeliveries) return false;
      if (m.type === 'inspection' && !showInspections) return false;
      if (m.type === 'cutoff' && !showCutoffs) return false;
      if (tradeFilter !== 'All' && m.trade && m.trade !== tradeFilter) return false;
      return true;
    });
  }, [milestones, showDeliveries, showInspections, showCutoffs, tradeFilter]);

  // Month navigation helpers
  const handlePrev = () => {
    const next = new Date(currentDate);
    if (viewMode === 'month') {
      next.setMonth(next.getMonth() - 1);
    } else if (viewMode === 'week') {
      next.setDate(next.getDate() - 7);
    } else {
      next.setDate(next.getDate() - 1);
    }
    setCurrentDate(next);
  };

  const handleNext = () => {
    const next = new Date(currentDate);
    if (viewMode === 'month') {
      next.setMonth(next.getMonth() + 1);
    } else if (viewMode === 'week') {
      next.setDate(next.getDate() + 7);
    } else {
      next.setDate(next.getDate() + 1);
    }
    setCurrentDate(next);
  };

  const handleJumpToPhase = () => {
    setCurrentDate(projectActiveDate);
    setSelectedDay(formatDateISO(projectActiveDate));
  };

  const handleJumpToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDay(formatDateISO(today));
  };

  // Month Grid Calculation (Monday-first, 7 cols)
  const monthDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // Monday is 0, Sunday is 6
    const startDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7;

    const days: { date: Date; dateStr: string; isCurrentMonth: boolean; isToday: boolean }[] = [];
    const todayStr = formatDateISO(new Date());

    // Leading days from previous month
    for (let i = startDayOfWeek; i > 0; i--) {
      const d = new Date(year, month, 1 - i);
      const str = formatDateISO(d);
      days.push({ date: d, dateStr: str, isCurrentMonth: false, isToday: str === todayStr });
    }

    // Days of current month
    for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
      const d = new Date(year, month, i);
      const str = formatDateISO(d);
      days.push({ date: d, dateStr: str, isCurrentMonth: true, isToday: str === todayStr });
    }

    // Trailing days to fill standard 5 or 6 rows (multiple of 7)
    const remaining = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      const str = formatDateISO(d);
      days.push({ date: d, dateStr: str, isCurrentMonth: false, isToday: str === todayStr });
    }

    return days;
  }, [currentDate]);

  // Week Grid Calculation (Monday to Sunday)
  const weekDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const day = currentDate.getDate();

    const current = new Date(year, month, day);
    const dayOfWeek = (current.getDay() + 6) % 7; // Mon = 0
    const monday = new Date(year, month, day - dayOfWeek);

    const days: { date: Date; dateStr: string; isToday: boolean }[] = [];
    const todayStr = formatDateISO(new Date());

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const str = formatDateISO(d);
      days.push({ date: d, dateStr: str, isToday: str === todayStr });
    }
    return days;
  }, [currentDate]);

  // Map tasks and milestones to date strings for instantaneous lookups
  const dayEventsMap = useMemo(() => {
    const map = new Map<string, { tasks: CalendarTask[]; milestones: MilestoneEvent[] }>();

    filteredTasks.forEach(task => {
      const s = task.start || task.end;
      const e = task.end || task.start;
      if (!s || !e) return;

      const pStart = parseDateSafe(s);
      const pEnd = parseDateSafe(e);
      if (!pStart || !pEnd) return;

      // Ensure chronological
      const actualStart = pStart <= pEnd ? pStart : pEnd;
      const actualEnd = pStart <= pEnd ? pEnd : pStart;

      // Add to each spanned day (cap at 60 days to prevent runaway loops)
      const cur = new Date(actualStart);
      let count = 0;
      while (cur <= actualEnd && count < 60) {
        const dStr = formatDateISO(cur);
        if (!map.has(dStr)) map.set(dStr, { tasks: [], milestones: [] });
        map.get(dStr)!.tasks.push(task);
        cur.setDate(cur.getDate() + 1);
        count++;
      }
    });

    filteredMilestones.forEach(m => {
      if (!map.has(m.date)) map.set(m.date, { tasks: [], milestones: [] });
      map.get(m.date)!.milestones.push(m);
    });

    return map;
  }, [filteredTasks, filteredMilestones]);

  // Quick Reschedule Handler
  const handleOpenReschedule = (task: CalendarTask, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setReschedulingTask(task);
    setRescheduleStart(task.start || formatDateISO(new Date()));
    setRescheduleEnd(task.end || task.start || formatDateISO(new Date()));
  };

  const handleSaveReschedule = async () => {
    if (!reschedulingTask) return;
    setReschedulingLoading(true);
    try {
      await tasksApi.update(reschedulingTask.id, {
        start: rescheduleStart,
        end: rescheduleEnd
      });
      if (addToast) addToast('success', `Rescheduled "${reschedulingTask.title}"`);
      if (onRefreshTasks) onRefreshTasks();
      setReschedulingTask(null);
    } catch (err: any) {
      if (addToast) addToast('error', err.message || 'Failed to reschedule task');
    } finally {
      setReschedulingLoading(false);
    }
  };

  // Quick Shift Reschedule by N Days
  const handleShiftTaskDays = async (task: CalendarTask, days: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const s = parseDateSafe(task.start || task.end);
    const end = parseDateSafe(task.end || task.start);
    if (!s || !end) return;

    s.setDate(s.getDate() + days);
    end.setDate(end.getDate() + days);

    const newStart = formatDateISO(s);
    const newEnd = formatDateISO(end);

    try {
      await tasksApi.update(task.id, { start: newStart, end: newEnd });
      if (addToast) addToast('success', `Shifted "${task.title}" by ${days > 0 ? `+${days}` : days}d`);
      if (onRefreshTasks) onRefreshTasks();
    } catch (err: any) {
      if (addToast) addToast('error', err.message || 'Failed to shift task');
    }
  };

  const monthName = currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* ── Top Calendar Control Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Navigation Controls */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-1 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={handlePrev}
              className="p-1.5 hover:bg-white dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-200 transition-colors"
              title="Previous"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={handleJumpToToday}
              className="px-2.5 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              Today
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="p-1.5 hover:bg-white dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-200 transition-colors"
              title="Next"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-2">
            <CalendarIcon size={18} className="text-amber-500 flex-shrink-0" />
            <span>{monthName}</span>
          </h2>

          <button
            type="button"
            onClick={handleJumpToPhase}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-100 transition-colors"
            title="Jump to the active BOV St. Venera construction phase"
          >
            <Zap size={12} /> Jump to Active Phase
          </button>
        </div>

        {/* View Mode Switcher: Month | Week | Day */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                viewMode === 'month'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <CalendarDays size={13} /> Month
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                viewMode === 'week'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <CalendarRange size={13} /> Week
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode('day');
                setSelectedDay(formatDateISO(currentDate));
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                viewMode === 'day'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Clock size={13} /> Day
            </button>
          </div>
        </div>
      </div>

      {/* ── Filter & Layer Overlays Strip ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white/70 dark:bg-slate-900/80 p-2.5 sm:p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs text-xs">
        {/* Trade Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
          <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mr-1 hidden sm:inline">
            Trade:
          </span>
          {availableTrades.map(trade => {
            const isSelected = tradeFilter === trade;
            const colors = trade !== 'All' ? getTradeColor(trade) : null;
            return (
              <button
                key={trade}
                type="button"
                onClick={() => setTradeFilter(trade)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all border ${
                  isSelected
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-transparent shadow-xs'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                {trade !== 'All' && colors && (
                  <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${colors.bar}`} />
                )}
                {trade}
              </button>
            );
          })}
        </div>

        {/* Milestone Overlay Toggles */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300 font-semibold">
            <input
              type="checkbox"
              checked={showTasks}
              onChange={e => setShowTasks(e.target.checked)}
              className="rounded text-blue-600 focus:ring-0 w-3.5 h-3.5"
            />
            <span className="text-[11px]">Tasks ({filteredTasks.length})</span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300 font-semibold">
            <input
              type="checkbox"
              checked={showDeliveries}
              onChange={e => setShowDeliveries(e.target.checked)}
              className="rounded text-amber-500 focus:ring-0 w-3.5 h-3.5"
            />
            <span className="text-[11px] flex items-center gap-1">
              <Package size={12} className="text-amber-500" /> Deliveries
            </span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300 font-semibold">
            <input
              type="checkbox"
              checked={showInspections}
              onChange={e => setShowInspections(e.target.checked)}
              className="rounded text-emerald-500 focus:ring-0 w-3.5 h-3.5"
            />
            <span className="text-[11px] flex items-center gap-1">
              <ShieldCheck size={12} className="text-emerald-500" /> QA/QC
            </span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300 font-semibold">
            <input
              type="checkbox"
              checked={showCutoffs}
              onChange={e => setShowCutoffs(e.target.checked)}
              className="rounded text-rose-500 focus:ring-0 w-3.5 h-3.5"
            />
            <span className="text-[11px] flex items-center gap-1">
              <Clock size={12} className="text-rose-500" /> Cutoffs
            </span>
          </label>
        </div>
      </div>

      {/* ── VIEW RENDERING ── */}

      {/* 1. MONTH VIEW */}
      {viewMode === 'month' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col">
          {/* Day of week header (Mon - Sun) */}
          <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 text-xs font-bold py-2.5 text-center">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
              <div key={day}>{day}</div>
            ))}
          </div>

          {/* 7-column month grid */}
          <div className="grid grid-cols-7 divide-x divide-y divide-slate-100 dark:divide-slate-800">
            {monthDays.map(item => {
              const events = dayEventsMap.get(item.dateStr) || { tasks: [], milestones: [] };
              const allDayItems = [
                ...events.milestones.map(m => ({ isMilestone: true, data: m })),
                ...events.tasks.map(t => ({ isMilestone: false, data: t }))
              ];
              const maxDisplay = 3;
              const hasMore = allDayItems.length > maxDisplay;
              const visibleItems = allDayItems.slice(0, maxDisplay);

              return (
                <div
                  key={item.dateStr}
                  onClick={() => {
                    setSelectedDay(item.dateStr);
                    setViewMode('day');
                  }}
                  className={`min-h-[115px] sm:min-h-[135px] p-1.5 sm:p-2 flex flex-col justify-between transition-colors cursor-pointer group ${
                    !item.isCurrentMonth
                      ? 'bg-slate-50/50 dark:bg-slate-950/40 text-slate-400 dark:text-slate-600'
                      : 'bg-white dark:bg-slate-900 hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                  } ${item.isToday ? 'ring-2 ring-blue-500 ring-inset bg-blue-50/20' : ''}`}
                >
                  {/* Date number & Quick Add */}
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                        item.isToday
                          ? 'bg-blue-600 text-white'
                          : item.isCurrentMonth
                          ? 'text-slate-700 dark:text-slate-300'
                          : 'text-slate-400 dark:text-slate-600'
                      }`}
                    >
                      {item.date.getDate()}
                    </span>

                    {onAddTaskDate && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          onAddTaskDate(item.dateStr);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-800 transition-all"
                        title={`Add task on ${item.dateStr}`}
                      >
                        <Plus size={11} />
                      </button>
                    )}
                  </div>

                  {/* Day Pills Stack */}
                  <div className="flex-1 space-y-1 overflow-hidden">
                    {visibleItems.map((entry, idx) => {
                      if (entry.isMilestone) {
                        const m = entry.data as MilestoneEvent;
                        const isDelivery = m.type === 'delivery';
                        const isInsp = m.type === 'inspection';
                        const badgeColor = isDelivery
                          ? 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/80 dark:text-amber-200 dark:border-amber-700'
                          : isInsp
                          ? 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-200 dark:border-emerald-700'
                          : 'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/80 dark:text-rose-200 dark:border-rose-700';

                        return (
                          <div
                            key={m.id || idx}
                            onClick={e => {
                              e.stopPropagation();
                              setSelectedDay(item.dateStr);
                              setViewMode('day');
                            }}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold border truncate flex items-center gap-1 shadow-2xs ${badgeColor}`}
                            title={`${m.title} - ${m.subtitle || ''}`}
                          >
                            {isDelivery && <Package size={10} className="flex-shrink-0" />}
                            {isInsp && <ShieldCheck size={10} className="flex-shrink-0" />}
                            {!isDelivery && !isInsp && <Clock size={10} className="flex-shrink-0" />}
                            <span className="truncate">{m.title}</span>
                          </div>
                        );
                      } else {
                        const t = entry.data as CalendarTask;
                        const colors = getTradeColor(t.trade);

                        return (
                          <div
                            key={t.id}
                            onClick={e => {
                              e.stopPropagation();
                              onEditTask(t);
                            }}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border truncate flex items-center justify-between gap-1 shadow-2xs transition-all hover:brightness-95 ${colors.bg} ${colors.text} ${colors.border}`}
                            title={`[${t.wbs_code || 'TASK'}] ${t.title} (${t.progress || 0}%)`}
                          >
                            <span className="truncate font-medium">
                              {t.wbs_code ? `${t.wbs_code} ` : ''}
                              {t.title}
                            </span>
                            <span className="text-[9px] font-mono opacity-80 flex-shrink-0">
                              {t.progress || 0}%
                            </span>
                          </div>
                        );
                      }
                    })}

                    {hasMore && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          setOverflowDate(item.dateStr);
                        }}
                        className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline block text-left pt-0.5 px-1"
                      >
                        +{allDayItems.length - maxDisplay} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. WEEK VIEW */}
      {viewMode === 'week' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-7 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800 min-h-[500px]">
            {weekDays.map(item => {
              const events = dayEventsMap.get(item.dateStr) || { tasks: [], milestones: [] };
              const dayName = item.date.toLocaleDateString(undefined, { weekday: 'short' });
              const dateFormatted = item.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

              return (
                <div
                  key={item.dateStr}
                  className={`flex flex-col p-3 transition-colors ${
                    item.isToday
                      ? 'bg-blue-50/20 dark:bg-blue-950/10'
                      : 'bg-white dark:bg-slate-900'
                  }`}
                >
                  {/* Column Header */}
                  <div className="border-b border-slate-100 dark:border-slate-800 pb-2 mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        {dayName}
                      </div>
                      <div className={`text-sm font-black ${item.isToday ? 'text-blue-600 dark:text-blue-400' : 'text-slate-900 dark:text-slate-100'}`}>
                        {dateFormatted}
                      </div>
                    </div>
                    {onAddTaskDate && (
                      <button
                        type="button"
                        onClick={() => onAddTaskDate(item.dateStr)}
                        className="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title="Add task on this date"
                      >
                        <Plus size={13} />
                      </button>
                    )}
                  </div>

                  {/* Milestones in Week View */}
                  {events.milestones.length > 0 && (
                    <div className="mb-3 space-y-1.5">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Milestones ({events.milestones.length})
                      </div>
                      {events.milestones.map(m => {
                        const isDelivery = m.type === 'delivery';
                        const isInsp = m.type === 'inspection';
                        const badgeCls = isDelivery
                          ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                          : isInsp
                          ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-900 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
                          : 'bg-rose-100 dark:bg-rose-950/80 text-rose-900 dark:text-rose-200 border-rose-300 dark:border-rose-700';

                        return (
                          <div
                            key={m.id}
                            className={`p-2 rounded-xl border text-xs shadow-2xs ${badgeCls}`}
                          >
                            <div className="flex items-center gap-1.5 font-bold">
                              {isDelivery && <Package size={12} className="flex-shrink-0" />}
                              {isInsp && <ShieldCheck size={12} className="flex-shrink-0" />}
                              {!isDelivery && !isInsp && <Clock size={12} className="flex-shrink-0" />}
                              <span className="truncate">{m.title}</span>
                            </div>
                            {m.subtitle && (
                              <div className="text-[10px] opacity-80 mt-0.5 truncate">
                                {m.subtitle}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Tasks in Week View */}
                  <div className="flex-1 space-y-2 overflow-y-auto">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                      <span>Tasks ({events.tasks.length})</span>
                    </div>

                    {events.tasks.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-500 italic">
                        No active tasks
                      </div>
                    ) : (
                      events.tasks.map(t => {
                        const colors = getTradeColor(t.trade);
                        const isDone = t.status === 'Completed';

                        return (
                          <div
                            key={t.id}
                            onClick={() => onEditTask(t)}
                            className={`p-2.5 rounded-xl border shadow-2xs hover:shadow-md transition-all cursor-pointer bg-white dark:bg-slate-800/90 ${colors.border}`}
                          >
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${colors.badge}`}>
                                {t.trade || 'MEP'}
                              </span>
                              {t.wbs_code && (
                                <span className="font-mono text-[9px] text-slate-400">
                                  {t.wbs_code}
                                </span>
                              )}
                            </div>

                            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug line-clamp-2">
                              {t.title}
                            </h4>

                            {/* Progress bar */}
                            <div className="mt-2">
                              <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
                                <span>Progress</span>
                                <span className="font-bold text-slate-700 dark:text-slate-300">{t.progress || 0}%</span>
                              </div>
                              <div className="h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${isDone ? 'bg-emerald-500' : colors.bar}`}
                                  style={{ width: `${Math.min(t.progress || 0, 100)}%` }}
                                />
                              </div>
                            </div>

                            {/* Quick Reschedule Shift Pills */}
                            <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-1 text-[10px]">
                              <button
                                type="button"
                                onClick={e => handleShiftTaskDays(t, -1, e)}
                                className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                                title="Shift 1 day earlier"
                              >
                                ◀ -1d
                              </button>
                              <button
                                type="button"
                                onClick={e => handleOpenReschedule(t, e)}
                                className="text-blue-600 dark:text-blue-400 hover:underline font-semibold"
                              >
                                Edit Dates
                              </button>
                              <button
                                type="button"
                                onClick={e => handleShiftTaskDays(t, 1, e)}
                                className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                                title="Shift 1 day later"
                              >
                                +1d ▶
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. DAY VIEW */}
      {viewMode === 'day' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-sm space-y-6">
          {/* Day Header with Date Picker */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 rounded-2xl">
                <CalendarIcon size={24} />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">
                  {parseDateSafe(selectedDay)?.toLocaleDateString(undefined, {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  }) || selectedDay}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Daily construction agenda, active site scopes, and scheduled delivery/QA gates
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="date"
                value={selectedDay}
                onChange={e => {
                  setSelectedDay(e.target.value);
                  const p = parseDateSafe(e.target.value);
                  if (p) setCurrentDate(p);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
              {onAddTaskDate && (
                <button
                  type="button"
                  onClick={() => onAddTaskDate(selectedDay)}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <Plus size={14} /> Add Task
                </button>
              )}
            </div>
          </div>

          {/* Day Summary Metrics */}
          {(() => {
            const dayEvents = dayEventsMap.get(selectedDay) || { tasks: [], milestones: [] };
            const deliveries = dayEvents.milestones.filter(m => m.type === 'delivery');
            const inspections = dayEvents.milestones.filter(m => m.type === 'inspection');
            const cutoffs = dayEvents.milestones.filter(m => m.type === 'cutoff');

            return (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase">Active Tasks</p>
                    <p className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">{dayEvents.tasks.length}</p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50">
                    <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 uppercase">Deliveries (POs)</p>
                    <p className="text-2xl font-black text-amber-800 dark:text-amber-200 mt-1">{deliveries.length}</p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
                    <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase">Inspections</p>
                    <p className="text-2xl font-black text-emerald-800 dark:text-emerald-200 mt-1">{inspections.length}</p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50">
                    <p className="text-[11px] font-bold text-rose-700 dark:text-rose-400 uppercase">Selection Cutoffs</p>
                    <p className="text-2xl font-black text-rose-800 dark:text-rose-200 mt-1">{cutoffs.length}</p>
                  </div>
                </div>

                {/* Key Milestones on this Day */}
                {dayEvents.milestones.length > 0 && (
                  <div className="space-y-2.5">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles size={13} className="text-amber-500" />
                      Critical Project Milestones ({dayEvents.milestones.length})
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {dayEvents.milestones.map(m => {
                        const isDelivery = m.type === 'delivery';
                        const isInsp = m.type === 'inspection';
                        const badgeColor = isDelivery
                          ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
                          : isInsp
                          ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200'
                          : 'border-rose-300 bg-rose-50 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200';

                        return (
                          <div key={m.id} className={`p-4 rounded-xl border flex items-start gap-3 shadow-2xs ${badgeColor}`}>
                            <div className="p-2 rounded-xl bg-white dark:bg-slate-800 shadow-2xs flex-shrink-0">
                              {isDelivery && <Package size={18} className="text-amber-600" />}
                              {isInsp && <ShieldCheck size={18} className="text-emerald-600" />}
                              {!isDelivery && !isInsp && <Clock size={18} className="text-rose-600" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <h5 className="text-sm font-bold truncate">{m.title}</h5>
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/60 dark:bg-slate-800 font-bold">
                                  {m.status || 'Active'}
                                </span>
                              </div>
                              <p className="text-xs opacity-85 mt-1">{m.subtitle}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Active Tasks on this Day */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Layers size={13} className="text-blue-500" />
                    Active Construction Scopes ({dayEvents.tasks.length})
                  </h4>

                  {dayEvents.tasks.length === 0 ? (
                    <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No tasks active on this day</p>
                      <p className="text-xs text-slate-400 mt-1">Use the navigation controls to view other dates or add a new task</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {dayEvents.tasks.map(t => {
                        const colors = getTradeColor(t.trade);
                        const isDone = t.status === 'Completed';

                        return (
                          <div
                            key={t.id}
                            className={`p-4 rounded-xl border bg-white dark:bg-slate-800/80 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:border-blue-400 ${colors.border}`}
                          >
                            <div className="flex-1 min-w-0" onClick={() => onEditTask(t)}>
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                {t.wbs_code && (
                                  <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                                    {t.wbs_code}
                                  </span>
                                )}
                                <span className={`text-xs font-bold px-2 py-0.5 rounded ${colors.badge}`}>
                                  {t.trade || 'MEP'}
                                </span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isDone
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                    : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                }`}>
                                  {t.status}
                                </span>
                              </div>

                              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 cursor-pointer hover:text-blue-600 transition-colors">
                                {t.title}
                              </h4>

                              <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1 flex-wrap">
                                <span>Schedule: {t.start || '—'} → {t.end || '—'}</span>
                                {t.site_name && <span>· {t.site_name}</span>}
                                {t.boq_ref && <span className="font-mono">· Ref: {t.boq_ref}</span>}
                              </div>
                            </div>

                            {/* Reschedule Controls */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => handleShiftTaskDays(t, -1)}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs font-bold transition-colors"
                                title="Shift 1 day earlier"
                              >
                                ◀ -1d
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenReschedule(t)}
                                className="px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 text-blue-700 dark:text-blue-300 text-xs font-bold border border-blue-200 dark:border-blue-800 transition-colors"
                              >
                                Reschedule
                              </button>
                              <button
                                type="button"
                                onClick={() => handleShiftTaskDays(t, 1)}
                                className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 text-xs font-bold transition-colors"
                                title="Shift 1 day later"
                              >
                                +1d ▶
                              </button>
                              <button
                                type="button"
                                onClick={() => onEditTask(t)}
                                className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors shadow-xs"
                              >
                                Edit Scope
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── OVERFLOW POPOVER MODAL (For "+X more" in Month View) ── */}
      {overflowDate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          onClick={() => setOverflowDate(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Events on {overflowDate}
                </h3>
                <p className="text-xs text-slate-500">All registered tasks, deliveries, and inspections</p>
              </div>
              <button
                type="button"
                onClick={() => setOverflowDate(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {(() => {
              const events = dayEventsMap.get(overflowDate) || { tasks: [], milestones: [] };
              return (
                <div className="space-y-3">
                  {events.milestones.map(m => (
                    <div key={m.id} className="p-2.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200">
                      <div className="font-bold flex items-center gap-1.5">
                        <Package size={13} /> {m.title}
                      </div>
                      <div className="text-[11px] opacity-80 mt-0.5">{m.subtitle}</div>
                    </div>
                  ))}

                  {events.tasks.map(t => {
                    const colors = getTradeColor(t.trade);
                    return (
                      <div
                        key={t.id}
                        onClick={() => {
                          setOverflowDate(null);
                          onEditTask(t);
                        }}
                        className={`p-3 rounded-xl border cursor-pointer hover:shadow-sm transition-all ${colors.bg} ${colors.border}`}
                      >
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${colors.badge}`}>
                            {t.trade || 'MEP'}
                          </span>
                          <span className="text-[10px] font-mono">{t.wbs_code}</span>
                        </div>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">{t.title}</h4>
                        <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
                          <span>{t.start} → {t.end}</span>
                          <span className="font-bold">{t.progress || 0}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── QUICK RESCHEDULE DATE MODAL ── */}
      {reschedulingTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          onClick={() => setReschedulingTask(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-sm w-full p-5 border border-slate-200 dark:border-slate-800 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Reschedule Scope Dates
                </h3>
                <p className="text-xs text-slate-500 font-mono truncate max-w-[220px]">
                  {reschedulingTask.wbs_code || 'TASK'}: {reschedulingTask.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReschedulingTask(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={rescheduleStart}
                  onChange={e => setRescheduleStart(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block mb-1">
                  Target Finish Date
                </label>
                <input
                  type="date"
                  value={rescheduleEnd}
                  onChange={e => setRescheduleEnd(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setReschedulingTask(null)}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveReschedule}
                disabled={reschedulingLoading}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-sm flex items-center gap-1.5 disabled:opacity-50"
              >
                <Check size={14} /> {reschedulingLoading ? 'Updating...' : 'Save Dates'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
