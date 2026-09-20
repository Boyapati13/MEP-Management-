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
    try {
      const [tower, lookahead, blockers, tasks] = await Promise.all([
        controlTowerApi.get(projectId).catch(() => null),
        lookaheadApi.get(projectId, lookaheadDays).catch(() => null),
        blockersApi.list(projectId ? { project_id: projectId } : undefined).catch(() => []),
        tasksApi.list(projectId ? { project_id: projectId } : undefined).catch(() => []),
      ]);
      setTowerData(tower);
      setLookaheadData(lookahead);
      setActiveBlockers(Array.isArray(blockers) ? blockers : []);
      setAllTasks(Array.isArray(tasks) ? tasks : []);
      if (Array.isArray(tasks) && tasks.length > 0 && !selectedTaskForBlocker) {
        setSelectedTaskForBlocker(tasks[0].id);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to load control tower data', 'error');
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
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium text-slate-500 mt-3">Synthesizing Project Control Tower...</p>
      </div>
    );
  }

  const radar = towerData?.radar || { present_count: 0, expected_count: 0, present_by_trade: {}, expected_by_trade: {}, present_workers: [] };
  const attentionItems = (towerData?.attention_items || []).filter((item: any) => {
    if (activeTab === 'all') return true;
    return item.severity.toLowerCase() === activeTab;
  });
  const lookaheadTasks = lookaheadData?.tasks || [];
  const lookaheadMetrics = lookaheadData?.metrics || { total_lookahead_tasks: 0, blocked_tasks: 0, predecessor_risk_tasks: 0 };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMsg && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg border text-sm font-medium flex items-center gap-2 ${
          toastMsg.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          {toastMsg.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          {toastMsg.text}
        </div>
      )}

      {/* Control Tower Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-slate-900 to-indigo-950 p-6 rounded-3xl text-white shadow-xl border border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <span className="text-xs uppercase tracking-widest font-extrabold text-emerald-400">Live Control Tower</span>
            <span className="text-xs bg-slate-800/80 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">Phase 7 &bull; v1.3</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            Project Operations & Lookahead Command
          </h1>
          <p className="text-xs text-slate-400">
            Deterministic priority queue, live manpower radar, and 14-day trade lookahead
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => loadData()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            onClick={() => setShowRaiseBlockerModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-colors"
          >
            <ShieldAlert size={15} /> Raise Blocker
          </button>
        </div>
      </div>

      {/* ── SECTION A: LIVE MANPOWER RADAR ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <Users size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Live Site Manpower Radar</h2>
              <p className="text-xs text-slate-500">Real-time GPS attendance punches vs. scheduled roster today</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRosterModal(true)}
              className="text-xs text-blue-600 hover:text-blue-700 font-semibold px-2.5 py-1 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-1"
            >
              View Active Roster ({radar.present_count}) <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Present Count */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Present on Site</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-black text-slate-900">{radar.present_count}</span>
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  Live Clocked In
                </span>
              </div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
              <HardHat size={24} />
            </div>
          </div>

          {/* Expected Count */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Scheduled Today</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-black text-slate-900">{radar.expected_count}</span>
                <span className="text-xs font-bold text-slate-600 bg-slate-200 px-2 py-0.5 rounded-full">
                  Planned Crew
                </span>
              </div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
              <Calendar size={24} />
            </div>
          </div>

          {/* Attendance Variance */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Staffing Variance</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className={`text-3xl font-black ${
                  radar.variance_percent >= 0 ? 'text-emerald-700' : 'text-amber-600'
                }`}>
                  {radar.variance_percent > 0 ? `+${radar.variance_percent}%` : `${radar.variance_percent}%`}
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  {radar.variance_percent >= 0 ? 'Adequate Coverage' : 'Understaffed'}
                </span>
              </div>
            </div>
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold ${
              radar.variance_percent >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}>
              <Activity size={24} />
            </div>
          </div>
        </div>

        {/* Trade Distribution Chips */}
        <div>
          <p className="text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">Live Headcount by Trade</p>
          <div className="flex flex-wrap gap-2">
            {Object.keys(radar.present_by_trade).length === 0 ? (
              <span className="text-xs text-slate-400 italic">No workers currently clocked in.</span>
            ) : (
              Object.entries(radar.present_by_trade).map(([trade, count]) => {
                const expected = radar.expected_by_trade[trade] || 0;
                return (
                  <div
                    key={trade}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-800"
                  >
                    <span className="w-2 h-2 rounded-full bg-blue-600" />
                    <span>{trade}</span>
                    <span className="bg-white px-2 py-0.5 rounded-md border border-slate-200 font-black text-slate-900">
                      {count as number} / {expected}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── SECTION B: DETERMINISTIC ATTENTION ENGINE ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
              <Zap size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Deterministic Attention Stream</h2>
              <p className="text-xs text-slate-500">Prioritized operational blockers requiring immediate engineering action</p>
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {(['all', 'critical', 'high', 'medium'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1 text-xs font-bold rounded-lg capitalize transition-all ${
                  activeTab === tab
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {attentionItems.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto">
              <Check size={24} />
            </div>
            <p className="text-sm font-bold text-slate-800">Clear Skies in Attention Engine</p>
            <p className="text-xs text-slate-400">No active blockers, urgent instructions, or overdue approvals in this filter</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {attentionItems.map((item: any) => {
              const isCritical = item.severity === 'CRITICAL';
              const isHigh = item.severity === 'HIGH';

              return (
                <div
                  key={item.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border transition-all ${
                    isCritical
                      ? 'bg-rose-50/60 border-rose-200 hover:bg-rose-50'
                      : isHigh
                      ? 'bg-amber-50/60 border-amber-200 hover:bg-amber-50'
                      : 'bg-slate-50 border-slate-200 hover:bg-slate-100/60'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-xl mt-0.5 ${
                      isCritical ? 'bg-rose-600 text-white' : isHigh ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white'
                    }`}>
                      {isCritical ? <ShieldAlert size={16} /> : isHigh ? <AlertTriangle size={16} /> : <AlertCircle size={16} />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                          isCritical ? 'bg-rose-200 text-rose-900' : isHigh ? 'bg-amber-200 text-amber-900' : 'bg-blue-100 text-blue-900'
                        }`}>
                          {item.severity}
                        </span>
                        <h4 className="text-sm font-bold text-slate-900">{item.title}</h4>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">{item.subtitle}</p>
                      {item.project_name && (
                        <p className="text-[11px] text-slate-400 mt-0.5 font-medium">Project: {item.project_name}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <button
                      onClick={() => navigate(item.target_module, item.target_id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1 ${
                        isCritical
                          ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm'
                          : 'bg-slate-900 hover:bg-slate-800 text-white shadow-sm'
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
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Calendar size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Rolling Lookahead Schedule</h2>
              <p className="text-xs text-slate-500">Tasks active within next {lookaheadDays} days with cascading dependency warnings</p>
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
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-[11px] text-slate-500 font-semibold uppercase">Lookahead Tasks</p>
            <p className="text-xl font-black text-slate-900 mt-0.5">{lookaheadMetrics.total_lookahead_tasks}</p>
          </div>
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
            <p className="text-[11px] text-rose-700 font-semibold uppercase">Blocked</p>
            <p className="text-xl font-black text-rose-800 mt-0.5">{lookaheadMetrics.blocked_tasks}</p>
          </div>
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-[11px] text-amber-700 font-semibold uppercase">Predecessor Risk</p>
            <p className="text-xl font-black text-amber-800 mt-0.5">{lookaheadMetrics.predecessor_risk_tasks}</p>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <p className="text-[11px] text-emerald-700 font-semibold uppercase">In Progress</p>
            <p className="text-xl font-black text-emerald-800 mt-0.5">{lookaheadMetrics.in_progress_tasks}</p>
          </div>
        </div>

        {/* Lookahead Tasks Table / List */}
        {lookaheadTasks.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center italic">No tasks scheduled in this lookahead window.</p>
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
                      ? 'border-rose-300 bg-rose-50/40'
                      : hasPredecessorRisk
                      ? 'border-amber-300 bg-amber-50/40'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                          {task.trade || 'General'}
                        </span>
                        <h4 className="text-sm font-bold text-slate-900">{task.title}</h4>
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
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-rose-50 text-rose-600 rounded-xl">
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
