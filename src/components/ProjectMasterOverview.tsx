import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, Calendar, DollarSign, Layers, MapPin, Users, CheckCircle2,
  Clock, AlertTriangle, ChevronRight, ChevronDown, Plus, Edit2, FileText,
  ExternalLink, ArrowUpRight, Shield, Activity, RefreshCw, Briefcase
} from 'lucide-react';
import { projectsApi, sitesApi, workPackagesApi, tasksApi } from '../api';
import { WorkPackageCommandCenterModal } from './WorkPackageCommandCenterModal';

interface ProjectMasterOverviewProps {
  projectId: string;
  onNavigateToTask?: (taskId: string) => void;
  onRefreshProject?: () => void;
}

export function ProjectMasterOverview({ projectId, onNavigateToTask, onRefreshProject }: ProjectMasterOverviewProps) {
  const [data, setData] = useState<any | null>(null);
  const [wbsTree, setWbsTree] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'hierarchy' | 'trades' | 'sites_packages'>('hierarchy');
  const [expandedWbs, setExpandedWbs] = useState<Record<string, boolean>>({});
  const [expandedPackages, setExpandedPackages] = useState<Record<string, boolean>>({});
  const [selectedWpForCommandCenter, setSelectedWpForCommandCenter] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [masterRes, treeRes] = await Promise.all([
        projectsApi.master(projectId).catch(() => null),
        projectsApi.wbsTree(projectId).catch(() => null),
      ]);
      setData(masterRes);
      setWbsTree(treeRes);
      if (treeRes?.tree?.[0]?.id) {
        setExpandedWbs({ [treeRes.tree[0].id]: true });
        if (treeRes.tree[0].work_packages?.[0]?.id) {
          setExpandedPackages({ [treeRes.tree[0].work_packages[0].id]: true });
        }
      }
    } catch (err) {
      console.error('Failed to load project master data:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl p-8 border border-gray-100 flex items-center justify-center min-h-[300px]">
        <div className="flex items-center gap-3 text-gray-500 font-medium text-sm">
          <RefreshCw size={18} className="animate-spin text-blue-600" />
          Loading Project Master & Delivery Hierarchy...
        </div>
      </div>
    );
  }

  const proj = data?.project || {};
  const stats = data?.stats || {};
  const variance = proj.schedule_variance_days || 0;
  const isSlipped = variance > 0;

  const toggleWbs = (id: string) => {
    setExpandedWbs(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const togglePkg = (id: string) => {
    setExpandedPackages(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-6">
      {/* 1. PROJECT MASTER CONTRACT & GOVERNANCE BANNER */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-8 -translate-y-8 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="px-3 py-1 bg-blue-500/20 text-blue-300 border border-blue-400/30 rounded-lg text-xs font-mono font-bold tracking-wider">
                {proj.project_code || proj.code || 'PRJ-MASTER'}
              </span>
              <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 rounded-lg text-xs font-semibold">
                {proj.stage || 'Construction'}
              </span>
              <span className="px-3 py-1 bg-white/10 text-white/90 rounded-lg text-xs font-semibold">
                {proj.contract_type || 'Lump Sum EPC'}
              </span>
              <span className="px-3 py-1 bg-white/10 text-white/90 rounded-lg text-xs font-semibold">
                {proj.status || 'Active'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{proj.name}</h1>
            <p className="text-sm text-slate-300 mt-1.5 flex items-center gap-2">
              <Building2 size={15} className="text-blue-400" />
              <span>Client: <strong className="text-white">{proj.client_name || proj.client || 'Emaar Properties'}</strong></span>
              {proj.city && (
                <>
                  <span className="text-slate-500">•</span>
                  <span className="flex items-center gap-1 text-slate-300">
                    <MapPin size={13} className="text-rose-400" /> {proj.city}, {proj.country || 'UAE'}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              className="px-4 py-2 bg-white/10 hover:bg-white/15 border border-white/10 rounded-xl text-xs font-semibold transition-all flex items-center gap-2"
            >
              <RefreshCw size={13} /> Sync Hierarchy
            </button>
          </div>
        </div>

        {/* Contract & Schedule Metrics Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-white/10">
          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block">Contract Value</span>
            <span className="text-lg font-bold text-white mt-0.5 block">
              {proj.currency || 'USD'} {Number(proj.contract_value || proj.budget || 0).toLocaleString()}
            </span>
          </div>

          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block">Baseline Period</span>
            <span className="text-xs font-medium text-slate-200 mt-1 block">
              {proj.baseline_start_date || proj.start_date || '—'} → {proj.baseline_end_date || proj.end_date || '—'}
            </span>
          </div>

          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block">Schedule Variance</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              {variance === 0 ? (
                <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={13} /> On Target (0d)
                </span>
              ) : isSlipped ? (
                <span className="text-xs font-semibold text-rose-400 flex items-center gap-1">
                  <AlertTriangle size={13} /> +{variance}d Slippage
                </span>
              ) : (
                <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={13} /> {Math.abs(variance)}d Ahead
                </span>
              )}
            </div>
          </div>

          <div>
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold block">Overall Progress</span>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 bg-white/10 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(proj.calculated_progress || 0, 100)}%` }}
                />
              </div>
              <span className="text-xs font-bold text-white">{proj.calculated_progress || 0}%</span>
            </div>
          </div>
        </div>

        {/* Governance Stakeholders */}
        <div className="flex flex-wrap items-center gap-4 mt-4 text-xs text-slate-300">
          <span>Project Manager: <strong className="text-white">{proj.project_manager_name || 'Assigned Lead'}</strong></span>
          <span className="text-slate-500">•</span>
          <span>Lead Consultant: <strong className="text-white">{proj.consultant || 'Engineering Consultant'}</strong></span>
          <span className="text-slate-500">•</span>
          <span>Main Contractor: <strong className="text-white">{proj.main_contractor || 'General Contracting JV'}</strong></span>
        </div>
      </div>

      {/* 2. STATS ROW */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between text-gray-400 mb-1">
            <span className="text-xs font-semibold uppercase">Total Scope</span>
            <Layers size={16} className="text-blue-600" />
          </div>
          <span className="text-2xl font-bold text-gray-900">{stats.total_tasks || 0}</span>
          <span className="text-xs text-gray-500 block mt-0.5">Assigned Tasks</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between text-gray-400 mb-1">
            <span className="text-xs font-semibold uppercase">Work Packages</span>
            <Briefcase size={16} className="text-indigo-600" />
          </div>
          <span className="text-2xl font-bold text-gray-900">{stats.work_packages_count || 0}</span>
          <span className="text-xs text-gray-500 block mt-0.5">Active Contracts</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between text-gray-400 mb-1">
            <span className="text-xs font-semibold uppercase">Sites & Zones</span>
            <MapPin size={16} className="text-emerald-600" />
          </div>
          <span className="text-2xl font-bold text-gray-900">{stats.sites_count || 0}</span>
          <span className="text-xs text-gray-500 block mt-0.5">Geofenced Sites</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between text-gray-400 mb-1">
            <span className="text-xs font-semibold uppercase">In Progress</span>
            <Clock size={16} className="text-blue-500" />
          </div>
          <span className="text-2xl font-bold text-blue-600">{stats.in_progress_tasks || 0}</span>
          <span className="text-xs text-gray-500 block mt-0.5">Execution Active</span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between text-gray-400 mb-1">
            <span className="text-xs font-semibold uppercase">Blocked</span>
            <AlertTriangle size={16} className="text-rose-500" />
          </div>
          <span className="text-2xl font-bold text-rose-600">{stats.blocked_tasks || 0}</span>
          <span className="text-xs text-gray-500 block mt-0.5">Attention Needed</span>
        </div>
      </div>

      {/* 3. TABS HEADER */}
      <div className="flex items-center gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('hierarchy')}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'hierarchy'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Layers size={16} /> Delivery Hierarchy (WBS → Package → Site → Task)
        </button>
        <button
          onClick={() => setActiveTab('trades')}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'trades'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Activity size={16} /> Trade Distribution
        </button>
        <button
          onClick={() => setActiveTab('sites_packages')}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'sites_packages'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-900'
          }`}
        >
          <Briefcase size={16} /> Sites & Packages Register
        </button>
      </div>

      {/* 4. TAB CONTENT */}
      {activeTab === 'hierarchy' && (
        <div className="space-y-4">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl text-xs text-blue-800 flex items-center justify-between">
            <span>
              <strong>Operational Hierarchy Model:</strong> Project Master → WBS Items → Work Packages → Geofenced Sites → Subcontractors → Supervisors → Assigned Tasks.
            </span>
            <span className="font-mono text-[11px] font-bold text-blue-700 bg-white px-2 py-0.5 rounded shadow-xs">
              {wbsTree?.tree?.length || 0} WBS Nodes
            </span>
          </div>

          <div className="space-y-3">
            {wbsTree?.tree?.map((wbs: any) => {
              const isExpanded = !!expandedWbs[wbs.id];
              return (
                <div key={wbs.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-xs">
                  {/* WBS Item Header */}
                  <div
                    onClick={() => toggleWbs(wbs.id)}
                    className="p-4 bg-gray-50/80 hover:bg-gray-100/80 cursor-pointer flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <button className="text-gray-400 hover:text-gray-700">
                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </button>
                      <span className="font-mono text-xs font-bold px-2.5 py-1 bg-blue-100 text-blue-800 rounded-lg">
                        {wbs.code}
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-gray-900">{wbs.name}</h3>
                        <span className="text-xs text-gray-500">{wbs.discipline || 'Multi-Disciplinary'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-medium">
                      <span className="text-gray-600">
                        <strong>{wbs.completed_tasks}</strong> / {wbs.total_tasks} Tasks
                      </span>
                      <div className="w-24 bg-gray-200 rounded-full h-2 overflow-hidden hidden sm:block">
                        <div
                          className="bg-blue-600 h-full rounded-full"
                          style={{ width: `${wbs.progress_percent || 0}%` }}
                        />
                      </div>
                      <span className="font-bold text-gray-900 w-10 text-right">{wbs.progress_percent || 0}%</span>
                    </div>
                  </div>

                  {/* Work Packages Inside WBS */}
                  {isExpanded && (
                    <div className="p-4 space-y-3 bg-white">
                      {wbs.work_packages?.map((wp: any) => {
                        const isPkgExpanded = !!expandedPackages[wp.id];
                        return (
                          <div key={wp.id} className="border border-gray-200 rounded-xl overflow-hidden">
                            <div
                              onClick={() => togglePkg(wp.id)}
                              className="p-3 bg-slate-50 hover:bg-slate-100 cursor-pointer flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-2.5">
                                <button className="text-gray-400">
                                  {isPkgExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                </button>
                                <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                  {wp.code}
                                </span>
                                <span className="font-bold text-gray-800">{wp.name}</span>
                                {wp.company_name && (
                                  <span className="text-gray-500 flex items-center gap-1 text-[11px]">
                                    • Subcontractor: <strong className="text-gray-700">{wp.company_name}</strong>
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedWpForCommandCenter(wp.id);
                                  }}
                                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-[11px] flex items-center gap-1 shadow-sm transition-all"
                                  title="Open Work Package Command Center"
                                >
                                  <Activity size={12} /> Command Center
                                </button>
                                <span className="text-gray-500">{wp.tasks?.length || 0} Tasks</span>
                                <span className="font-bold text-indigo-600">{wp.progress_percent || 0}%</span>
                              </div>
                            </div>

                            {/* Tasks Under Work Package */}
                            {isPkgExpanded && (
                              <div className="p-3 bg-white divide-y divide-gray-100">
                                {wp.tasks?.length === 0 ? (
                                  <p className="text-xs text-gray-400 py-2 italic text-center">No tasks mapped to this package yet.</p>
                                ) : (
                                  wp.tasks.map((task: any) => (
                                    <div
                                      key={task.id}
                                      onClick={() => onNavigateToTask && onNavigateToTask(task.id)}
                                      className="py-2.5 flex items-center justify-between text-xs hover:bg-gray-50/80 px-2 rounded-lg transition-colors cursor-pointer"
                                    >
                                      <div className="flex items-center gap-3 min-w-0">
                                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                          task.status === 'Completed' ? 'bg-emerald-500' :
                                          task.status === 'Blocked' ? 'bg-rose-500' :
                                          task.status === 'In Progress' ? 'bg-blue-500' : 'bg-gray-300'
                                        }`} />
                                        <div className="truncate">
                                          <span className="font-bold text-gray-900 mr-2">{task.title}</span>
                                          <span className="text-[11px] text-gray-400 font-mono">[{task.trade}]</span>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-3 flex-shrink-0">
                                        {task.site_name && (
                                          <span className="text-[11px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded flex items-center gap-1">
                                            <MapPin size={10} /> {task.site_name}
                                          </span>
                                        )}
                                        {task.supervisor_name && (
                                          <span className="text-[11px] text-gray-500 hidden sm:inline">
                                            Sup: {task.supervisor_name}
                                          </span>
                                        )}
                                        {task.drawing_ref && (
                                          <span className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded font-mono">
                                            {task.drawing_ref}
                                          </span>
                                        )}
                                        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                                          task.status === 'Completed' ? 'bg-emerald-100 text-emerald-800' :
                                          task.status === 'Blocked' ? 'bg-rose-100 text-rose-800 font-bold' :
                                          task.status === 'In Progress' ? 'bg-blue-100 text-blue-800' :
                                          'bg-gray-100 text-gray-700'
                                        }`}>
                                          {task.status}
                                        </span>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. TRADES TAB */}
      {activeTab === 'trades' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(data?.trade_distribution || {}).map(([trade, tr]: [string, any]) => (
            <div key={trade} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-gray-900">{trade}</span>
                <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full">
                  {tr.total} Tasks
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-gray-600">
                  <span>Progress</span>
                  <strong className="text-gray-900">{tr.progress_avg}%</strong>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div className="bg-blue-600 h-full rounded-full" style={{ width: `${tr.progress_avg}%` }} />
                </div>
                <div className="flex justify-between text-[11px] text-gray-500 pt-2 border-t border-gray-100">
                  <span>Completed: <strong className="text-emerald-600">{tr.completed}</strong></span>
                  <span>In Progress: <strong className="text-blue-600">{tr.in_progress}</strong></span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 6. SITES & PACKAGES REGISTER TAB */}
      {activeTab === 'sites_packages' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sites Register */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
              <MapPin size={16} className="text-emerald-600" /> Geofenced Operational Sites ({data?.sites?.length || 0})
            </h3>
            <div className="space-y-3">
              {data?.sites?.map((s: any) => (
                <div key={s.id} className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-gray-900 block">{s.name}</span>
                    <span className="text-gray-500 text-[11px]">{s.city || 'Dubai'}, {s.country || 'UAE'} • Geofence: {s.geofence_radius_m || 100}m</span>
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-semibold rounded text-[10px]">
                    Active GPS
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Work Packages Register */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Briefcase size={16} className="text-indigo-600" /> Work Packages & Subcontractors ({data?.work_packages?.length || 0})
            </h3>
            <div className="space-y-3">
              {data?.work_packages?.map((wp: any) => (
                <div key={wp.id} className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded text-[10px]">
                        {wp.code}
                      </span>
                      <span className="font-bold text-gray-900">{wp.name}</span>
                    </div>
                    <span className="text-gray-500 text-[11px] block mt-0.5">
                      Subcontractor: <strong className="text-gray-700">{wp.company_name || 'Direct Labor'}</strong> • Budget: {proj.currency || 'USD'} {Number(wp.budget_allocated || 0).toLocaleString()}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-800 font-semibold rounded text-[10px]">
                    {wp.status || 'Active'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Work Package Full Command Center Modal */}
      {selectedWpForCommandCenter && (
        <WorkPackageCommandCenterModal
          open={!!selectedWpForCommandCenter}
          workPackageId={selectedWpForCommandCenter}
          onClose={() => setSelectedWpForCommandCenter(null)}
          onNavigateToTask={onNavigateToTask}
        />
      )}
    </div>
  );
}
