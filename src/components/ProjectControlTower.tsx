import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, CheckCircle, Clock, ShieldAlert, Users, HardHat,
  ChevronRight, ArrowRight, RefreshCw, Plus, Filter, Calendar,
  Activity, Zap, AlertCircle, Wrench, Check, X, Shield, Layers,
  ExternalLink, ChevronDown, MessageSquare
} from 'lucide-react';
import { controlTowerApi, lookaheadApi, blockersApi, tasksApi } from '../api';

interface ProjectControlTowerProps {
  projectId?: string;
  navigate: (page: any, param?: string) => void;
}

export function ProjectControlTower({ projectId, navigate }: ProjectControlTowerProps) {
  const [loading, setLoading] = useState(true);
  const [towerData, setTowerData] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lookaheadData, setLookaheadData] = useState<any>(null);
  const [activeBlockers, setActiveBlockers] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'critical' | 'high' | 'medium'>('all');
  const [lookaheadDays, setLookaheadDays] = useState<number>(14);

  // Modals
  const [showRosterModal, setShowRosterModal] = useState(false);
  const [showRaiseBlockerModal, setShowRaiseBlockerModal] = useState(false);
  const [showResolveBlockerModal, setShowResolveBlockerModal] = useState<any | null>(null);
  const [selectedTaskForBlocker, setSelectedTaskForBlocker] = useState<string>('');
  const [allTasks, setAllTasks] = useState<any[]>([]);

  // Form states
  const [blockerForm, setBlockerForm] = useState({
    blocker_type: 'Trade Interface',
    description: '',
    blocking_trade: 'Electrical',
    impact_days: 2,
  });
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setTowerData(null);
    setLookaheadData(null);
    setActiveBlockers([]);
    setAllTasks([]);
    setSelectedTaskForBlocker('');
    try {
      const [tower, lookahead, blockers, tasks] = await Promise.all([
        controlTowerApi.get(projectId).catch(() => null),
        lookaheadApi.get(projectId, lookaheadDays).catch(() => null),
        blockersApi.list(projectId ? { project_id: projectId } : undefined).catch(() => []),
        tasksApi.list(projectId ? { project_id: projectId } : undefined).catch(() => []),
      ]);
      if (!tower) setLoadError('Command Center data is unavailable. Retry to load project metrics.');
      setTowerData(tower);
      setLookaheadData(lookahead);
      setActiveBlockers(Array.isArray(blockers) ? blockers : []);
      setAllTasks(Array.isArray(tasks) ? tasks : []);
      if (Array.isArray(tasks) && tasks.length > 0) {
        setSelectedTaskForBlocker(tasks[0].id);
      }
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load control tower data');
    } finally {
      setLoading(false);
    }
  }, [projectId, lookaheadDays]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRaiseBlocker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTaskForBlocker || !blockerForm.description) {
      showToast('Please select a task and provide description', 'error');
      return;
    }
    setActionLoading(true);
    try {
      await blockersApi.create(selectedTaskForBlocker, blockerForm);
      showToast('Blocker raised successfully! Task marked Blocked.', 'success');
      setShowRaiseBlockerModal(false);
      setBlockerForm({
        blocker_type: 'Trade Interface',
        description: '',
        blocking_trade: 'Electrical',
        impact_days: 2,
      });
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to raise blocker', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResolveBlocker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showResolveBlockerModal) return;
    setActionLoading(true);
    try {
      await blockersApi.resolve(showResolveBlockerModal.task_id, showResolveBlockerModal.id, resolutionNotes);
      showToast('Blocker resolved! Task status updated.', 'success');
      setShowResolveBlockerModal(null);
      setResolutionNotes('');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to resolve blocker', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !towerData) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-medium text-slate-500 mt-3 uppercase tracking-wider">Loading Executive Telemetry...</p>
      </div>
    );
  }

  if (loadError && !towerData) return <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-rose-900"><p className="font-semibold">Executive Control Tower Unavailable</p><p className="text-sm mt-1">{loadError}</p><button className="mt-3 rounded-md bg-rose-900 px-4 py-2 text-sm text-white" onClick={loadData}>Retry</button></div>;

  const radar = towerData?.radar || { present_count: 0, expected_count: 0, variance_percent: 0, present_by_trade: {}, expected_by_trade: {}, present_workers: [] };
  const attentionItems = (towerData?.attention_items || []).filter((item: any) => {
    if (activeTab === 'all') return true;
    return item.severity.toLowerCase() === activeTab;
  });
  const lookaheadTasks = lookaheadData?.tasks || [];
  const lookaheadMetrics = lookaheadData?.metrics || { total_lookahead_tasks: 0, blocked_tasks: 0, predecessor_risk_tasks: 0, in_progress_tasks: 0 };
  const activeBlockerCount = activeBlockers.filter(b => b.status === 'Active').length;

  return (
    <div className="space-y-4">
      {/* Toast Notification */}
      {toastMsg && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-md shadow-lg border text-xs font-semibold flex items-center gap-2 ${
          toastMsg.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          {toastMsg.type === 'success' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {toastMsg.text}
        </div>
      )}

      {/* Enterprise Executive Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 px-5 py-4 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60 px-2 py-0.5 rounded">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Operational Telemetry Active
            </span>
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {projectId ? `SCOPE: ${projectId.toUpperCase()}` : 'SCOPE: ENTERPRISE PORTFOLIO'}
            </span>
          </div>
          <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white mt-1">
            Executive Operations &amp; Lookahead Control Tower
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Real-time field attendance verification, exception queue, critical-path lookahead schedule, and trade constraint register
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('messages')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold border border-slate-300 dark:border-slate-700 transition-colors"
          >
            <MessageSquare size={13} /> Correspondence
          </button>
          <button
            onClick={() => loadData()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold border border-slate-300 dark:border-slate-700 transition-colors"
          >
            <RefreshCw size={13} /> Refresh
          </button>
          <button
            onClick={() => setShowRaiseBlockerModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors"
          >
            <ShieldAlert size={14} /> Log Site Constraint
          </button>
        </div>
      </div>

      {/* 6-Column Enterprise KPI Telemetry Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <span>Site Headcount</span>
            <HardHat size={14} className="text-emerald-600" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{radar.present_count}</span>
            <button onClick={() => setShowRosterModal(true)} className="text-[11px] font-semibold text-blue-600 hover:underline">
              Roster &rarr;
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Active GPS clock-ins</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <span>Planned Allocation</span>
            <Users size={14} className="text-blue-600" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{radar.expected_count}</span>
            <span className={`text-[11px] font-semibold tabular-nums ${radar.variance_percent >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
              {radar.variance_percent > 0 ? `+${radar.variance_percent}%` : `${radar.variance_percent}%`}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Scheduled crew today</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <span>{lookaheadDays}d Lookahead</span>
            <Calendar size={14} className="text-indigo-600" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{lookaheadMetrics.total_lookahead_tasks}</span>
            <span className="text-[11px] font-semibold text-emerald-600 tabular-nums">{lookaheadMetrics.in_progress_tasks || 0} active</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Scheduled WBS activities</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <span>Blocked Tasks</span>
            <ShieldAlert size={14} className="text-rose-600" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className={`text-2xl font-bold tabular-nums ${lookaheadMetrics.blocked_tasks > 0 ? 'text-rose-600' : 'text-slate-900 dark:text-white'}`}>
              {lookaheadMetrics.blocked_tasks}
            </span>
            <span className="text-[11px] font-semibold text-slate-500 tabular-nums">{activeBlockerCount} open</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Work-stoppage constraints</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <span>Predecessor Risk</span>
            <AlertTriangle size={14} className="text-amber-600" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className={`text-2xl font-bold tabular-nums ${lookaheadMetrics.predecessor_risk_tasks > 0 ? 'text-amber-600' : 'text-slate-900 dark:text-white'}`}>
              {lookaheadMetrics.predecessor_risk_tasks}
            </span>
            <button onClick={() => navigate('tasks')} className="text-[11px] font-semibold text-blue-600 hover:underline">
              WBS &rarr;
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Cascading logic warnings</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <span>Action Queue</span>
            <Activity size={14} className="text-blue-600" />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{(towerData?.attention_items || []).length}</span>
            <span className="text-[11px] font-semibold text-rose-600 tabular-nums">
              {(towerData?.attention_items || []).filter((i: any) => i.severity === 'CRITICAL').length} critical
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Pending engineering review</p>
        </div>
      </div>

      {/* Trade Headcount Allocation Strip */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Trade Allocation (Actual / Planned):</span>
          {Object.keys(radar.present_by_trade).length === 0 ? (
            <span className="text-xs text-slate-500">No active trade attendance punches recorded for current shift.</span>
          ) : (
            Object.entries(radar.present_by_trade).map(([trade, count]) => {
              const expected = radar.expected_by_trade[trade] || 0;
              return (
                <div
                  key={trade}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                  <span>{trade}</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white tabular-nums">
                    {count as number}/{expected}
                  </span>
                </div>
              );
            })
          )}
        </div>
        <button
          onClick={() => setShowRosterModal(true)}
          className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          Inspect Shift Roster ({radar.present_count}) <ChevronRight size={13} />
        </button>
      </div>

      {/* ── SECTION B: EXCEPTION & ACTION REGISTER ── */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">Engineering Exception &amp; Action Queue</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Prioritized operational constraints, overdue approvals, and site directives requiring disposition</p>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-md">
            {(['all', 'critical', 'high', 'medium'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-2.5 py-1 text-xs font-semibold rounded capitalize transition-all ${
                  activeTab === tab
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {attentionItems.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">No Open Exceptions in Selected Filter</p>
            <p className="text-xs text-slate-500 mt-0.5">All tracked blockers, site instructions, and approvals are within normal operating thresholds.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {attentionItems.map((item: any) => {
              const isCritical = item.severity === 'CRITICAL';
              const isHigh = item.severity === 'HIGH';

              return (
                <div
                  key={item.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-l-4 transition-all shadow-xs ${
                    isCritical
                      ? 'bg-rose-50/90 dark:bg-slate-900 border-rose-200 dark:border-slate-800 border-l-rose-600 dark:border-l-rose-500 hover:bg-rose-100/70 dark:hover:bg-slate-850'
                      : isHigh
                      ? 'bg-amber-50/90 dark:bg-slate-900 border-amber-200 dark:border-slate-800 border-l-amber-500 dark:border-l-amber-500 hover:bg-amber-100/70 dark:hover:bg-slate-850'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 border-l-blue-500 dark:border-l-blue-400 hover:bg-slate-100/80 dark:hover:bg-slate-850'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2.5 rounded-xl mt-0.5 shadow-xs ${
                      isCritical ? 'bg-rose-600 text-white' : isHigh ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white'
                    }`}>
                      {isCritical ? <ShieldAlert size={16} /> : isHigh ? <AlertTriangle size={16} /> : <AlertCircle size={16} />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                          isCritical
                            ? 'bg-rose-200 dark:bg-rose-950/80 text-rose-900 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                            : isHigh
                            ? 'bg-amber-200 dark:bg-amber-950/80 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                            : 'bg-blue-100 dark:bg-blue-950/80 text-blue-900 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                        }`}>
                          {item.severity}
                        </span>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">{item.title}</h4>
                      </div>
                      <p className={`text-xs mt-1 font-medium ${
                        isCritical
                          ? 'text-rose-950 dark:text-rose-200'
                          : isHigh
                          ? 'text-amber-950 dark:text-amber-200'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}>{item.subtitle}</p>
                      {item.project_name && (
                        <p className={`text-[11px] mt-0.5 font-medium ${
                          isCritical
                            ? 'text-rose-800 dark:text-slate-400'
                            : isHigh
                            ? 'text-amber-800 dark:text-slate-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}>Project: {item.project_name}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <button
                      onClick={() => navigate(item.target_module, item.target_id)}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm ${
                        isCritical
                          ? 'bg-rose-600 hover:bg-rose-700 text-white'
                          : isHigh
                          ? 'bg-amber-600 hover:bg-amber-700 text-white'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      {item.action_label} <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── SECTION C: 2-WEEK ROLLING LOOKAHEAD SCHEDULE ── */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Calendar size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Rolling Lookahead Schedule</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Tasks active within next {lookaheadDays} days with cascading dependency warnings</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              {[7, 14, 21].map(days => (
                <button
                  key={days}
                  onClick={() => setLookaheadDays(days)}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                    lookaheadDays === days
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {days} Days
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Lookahead Metrics Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold uppercase">Lookahead Tasks</p>
            <p className="text-xl font-black text-slate-900 dark:text-slate-100 mt-0.5">{lookaheadMetrics.total_lookahead_tasks}</p>
          </div>
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50">
            <p className="text-[11px] text-rose-700 dark:text-rose-400 font-semibold uppercase">Blocked</p>
            <p className="text-xl font-black text-rose-800 dark:text-rose-200 mt-0.5">{lookaheadMetrics.blocked_tasks}</p>
          </div>
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50">
            <p className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold uppercase">Predecessor Risk</p>
            <p className="text-xl font-black text-amber-800 dark:text-amber-200 mt-0.5">{lookaheadMetrics.predecessor_risk_tasks}</p>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold uppercase">In Progress</p>
            <p className="text-xl font-black text-emerald-800 dark:text-emerald-200 mt-0.5">{lookaheadMetrics.in_progress_tasks}</p>
          </div>
        </div>

        {/* Lookahead Tasks Table / List */}
        {lookaheadTasks.length === 0 ? (
          <p className="text-xs text-slate-400 dark:text-slate-500 py-6 text-center italic">No tasks scheduled in this lookahead window.</p>
        ) : (
          <div className="space-y-3">
            {lookaheadTasks.map((task: any) => {
              const hasPredecessorRisk = task.predecessor_risk;
              const isBlocked = task.status === 'Blocked' || task.active_blocker_count > 0;

              return (
                <div
                  key={task.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isBlocked
                      ? 'border-rose-300 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20'
                      : hasPredecessorRisk
                      ? 'border-amber-300 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200/50 dark:border-slate-700">
                          {task.trade || 'General'}
                        </span>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">{task.title}</h4>
                        {isBlocked && (
                          <span className="text-[10px] font-black bg-rose-600 text-white px-2 py-0.5 rounded-full">
                            BLOCKED
                          </span>
                        )}
                        {hasPredecessorRisk && !isBlocked && (
                          <span className="text-[10px] font-black bg-amber-500 text-white px-2 py-0.5 rounded-full">
                            PREDECESSOR RISK
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">
                        Dates: <strong className="text-slate-700">{task.start}</strong> &rarr; <strong className="text-slate-700">{task.end}</strong> &bull; Assigned: {task.assigned_worker_name || 'Unassigned'}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* Progress Bar */}
                      <div className="w-24 text-right">
                        <span className="text-xs font-bold text-slate-700">{task.progress || 0}%</span>
                        <div className="w-full bg-slate-100 h-2 rounded-full mt-1 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              isBlocked ? 'bg-rose-500' : hasPredecessorRisk ? 'bg-amber-500' : 'bg-blue-600'
                            }`}
                            style={{ width: `${task.progress || 0}%` }}
                          />
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setSelectedTaskForBlocker(task.id);
                          setShowRaiseBlockerModal(true);
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold"
                        title="Raise Blocker on this task"
                      >
                        Raise Blocker
                      </button>
                    </div>
                  </div>

                  {/* Predecessor Risk Details */}
                  {hasPredecessorRisk && task.risky_predecessors?.length > 0 && (
                    <div className="mt-3 p-2.5 rounded-lg bg-amber-100/70 border border-amber-200/80 text-xs text-amber-900 flex items-start gap-2">
                      <AlertTriangle size={15} className="flex-shrink-0 mt-0.5 text-amber-700" />
                      <div>
                        <span className="font-bold">Trade Conflict Warning:</span> Predecessor task{' '}
                        <strong>&quot;{task.risky_predecessors[0].title}&quot;</strong> is currently{' '}
                        <span className="font-semibold text-rose-700">{task.risky_predecessors[0].status}</span>. Resolving this predecessor is necessary to avoid jobsite work stoppage.
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── SECTION D: ACTIVE PROJECT BLOCKERS REGISTER ── */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-xl">
              <ShieldAlert size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Active Blockers Register</h2>
              <p className="text-xs text-slate-500">Cross-trade bottlenecks, information stops, and material delays</p>
            </div>
          </div>
          <span className="text-xs font-bold text-slate-500">
            {activeBlockers.filter(b => b.status === 'Active').length} Active Blockers
          </span>
        </div>

        {activeBlockers.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center italic">No blockers logged on this project.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {activeBlockers.map((blocker: any) => {
              const isActive = blocker.status === 'Active';

              return (
                <div key={blocker.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                        isActive ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {blocker.status}
                      </span>
                      <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                        {blocker.blocker_type}
                      </span>
                      <span className="text-xs text-slate-500 font-medium">
                        Task: <strong className="text-slate-800">{blocker.task_title || blocker.task_id}</strong>
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-slate-900">{blocker.description}</p>
                    <p className="text-xs text-slate-400">
                      Reported by: <span className="text-slate-600">{blocker.reported_by_name || 'User'}</span> &bull; Impact: {blocker.impact_days || 1} day(s) &bull; Trade: {blocker.blocking_trade || 'All'}
                    </p>
                    {blocker.resolution_notes && (
                      <p className="text-xs text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-100 font-medium mt-1">
                        Resolution: {blocker.resolution_notes}
                      </p>
                    )}
                  </div>

                  {isActive && (
                    <button
                      onClick={() => setShowResolveBlockerModal(blocker)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors flex-shrink-0"
                    >
                      Resolve Blocker
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── MODAL: ACTIVE ROSTER ── */}
      {showRosterModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-bold text-slate-900">Clocked-In Workers Today ({radar.present_count})</h3>
              <button onClick={() => setShowRosterModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            {radar.present_workers?.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center italic">No workers currently clocked in.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {radar.present_workers.map((w: any) => (
                  <div key={w.id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{w.worker_name || 'Worker'}</p>
                      <p className="text-xs text-slate-500">
                        {w.worker_trade || 'General'} &bull; {w.company_name || 'Direct'} &bull; {w.site_name || 'Site'}
                      </p>
                    </div>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg">
                      {w.punch_in ? new Date(w.punch_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Clocked In'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="pt-2 border-t flex justify-end">
              <button
                onClick={() => setShowRosterModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: RAISE BLOCKER ── */}
      {showRaiseBlockerModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2 text-rose-600">
                <ShieldAlert size={20} />
                <h3 className="text-base font-bold text-slate-900">Raise Task Blocker</h3>
              </div>
              <button onClick={() => setShowRaiseBlockerModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleRaiseBlocker} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Select Affected Task *</label>
                <select
                  value={selectedTaskForBlocker}
                  onChange={e => setSelectedTaskForBlocker(e.target.value)}
                  className="w-full text-xs font-medium border border-slate-200 rounded-xl p-2.5 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  required
                >
                  {allTasks.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.title} ({t.trade || 'General'} - {t.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Blocker Category</label>
                  <select
                    value={blockerForm.blocker_type}
                    onChange={e => setBlockerForm({ ...blockerForm, blocker_type: e.target.value })}
                    className="w-full text-xs font-medium border border-slate-200 rounded-xl p-2.5 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  >
                    <option value="Trade Interface">Trade Interface</option>
                    <option value="Material Delay">Material Delay</option>
                    <option value="Information / RFI">Information / RFI</option>
                    <option value="Access / Permitting">Access / Permitting</option>
                    <option value="Safety / Quality">Safety / Quality</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Blocking Trade</label>
                  <select
                    value={blockerForm.blocking_trade}
                    onChange={e => setBlockerForm({ ...blockerForm, blocking_trade: e.target.value })}
                    className="w-full text-xs font-medium border border-slate-200 rounded-xl p-2.5 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  >
                    <option value="Civil / Structure">Civil / Structure</option>
                    <option value="HVAC">HVAC</option>
                    <option value="Electrical">Electrical</option>
                    <option value="Plumbing">Plumbing</option>
                    <option value="Fire Fighting">Fire Fighting</option>
                    <option value="ELV">ELV</option>
                    <option value="General">General</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Impact (Estimated Days)</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={blockerForm.impact_days}
                  onChange={e => setBlockerForm({ ...blockerForm, impact_days: parseInt(e.target.value) || 1 })}
                  className="w-full text-xs font-medium border border-slate-200 rounded-xl p-2.5 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Description of Bottleneck *</label>
                <textarea
                  rows={3}
                  value={blockerForm.description}
                  onChange={e => setBlockerForm({ ...blockerForm, description: e.target.value })}
                  placeholder="Detail the impediment preventing progress on site..."
                  className="w-full text-xs font-medium border border-slate-200 rounded-xl p-2.5 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  required
                />
              </div>

              <div className="pt-3 border-t flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRaiseBlockerModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/30 flex items-center gap-1.5"
                >
                  {actionLoading ? 'Logging...' : 'Confirm Blocker'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: RESOLVE BLOCKER ── */}
      {showResolveBlockerModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2 text-emerald-600">
                <CheckCircle size={20} />
                <h3 className="text-base font-bold text-slate-900">Resolve Task Blocker</h3>
              </div>
              <button onClick={() => setShowResolveBlockerModal(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleResolveBlocker} className="space-y-4">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                <p className="font-bold text-slate-800">{showResolveBlockerModal.description}</p>
                <p className="text-slate-500">Category: {showResolveBlockerModal.blocker_type} &bull; Trade: {showResolveBlockerModal.blocking_trade || 'All'}</p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Resolution Notes *</label>
                <textarea
                  rows={3}
                  value={resolutionNotes}
                  onChange={e => setResolutionNotes(e.target.value)}
                  placeholder="Explain how the obstruction was cleared on site..."
                  className="w-full text-xs font-medium border border-slate-200 rounded-xl p-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
              </div>

              <div className="pt-3 border-t flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowResolveBlockerModal(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/30 flex items-center gap-1.5"
                >
                  {actionLoading ? 'Resolving...' : 'Confirm Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
