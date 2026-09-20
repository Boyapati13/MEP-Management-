import React, { useEffect, useState } from 'react';
import {
  X, Briefcase, CheckCircle2, Clock, AlertTriangle, Users,
  FileText, DollarSign, Layers, ChevronRight, AlertCircle, ShoppingBag, ShieldAlert
} from 'lucide-react';
import { workPackagesApi } from '../api';

interface WorkPackageCommandCenterModalProps {
  open?: boolean;
  workPackageId: string;
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
  onNavigateToTask?: (taskId: string) => void;
}

export const WorkPackageCommandCenterModal: React.FC<WorkPackageCommandCenterModalProps> = ({
  open = true,
  workPackageId,
  onClose,
  onOpenTask,
  onNavigateToTask,
}) => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'claims' | 'blockers' | 'procurement'>('overview');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [workPackageId, open]);

  if (!open) return null;

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await workPackagesApi.commandCenter(workPackageId);
      setData(res);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load Work Package Command Center');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl text-center">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h3 className="text-lg font-bold text-slate-900">Loading Work Package Command Center</h3>
          <p className="text-sm text-slate-500 mt-1">Aggregating tasks, claims, blockers & procurement...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
        <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl text-center">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-slate-900">Unable to load command center</h3>
          <p className="text-sm text-slate-600 mt-2 mb-6">{error || 'Unknown error occurred'}</p>
          <button onClick={onClose} className="px-5 py-2.5 bg-slate-800 text-white font-medium rounded-xl text-sm">
            Close
          </button>
        </div>
      </div>
    );
  }

  const { work_package: wp, metrics, tasks, claims, blockers, workers, clarifications, purchase_orders } = data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-5xl w-full my-8 flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-200 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-11 h-11 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <Briefcase className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold bg-indigo-500/30 text-indigo-200 px-2.5 py-0.5 rounded border border-indigo-400/30">
                  {wp.code || 'WP'}
                </span>
                <span className="text-xs text-slate-300 bg-slate-800 px-2 py-0.5 rounded">
                  {wp.discipline || 'General'}
                </span>
                {wp.status && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    wp.status === 'Active' || wp.status === 'In Progress' ? 'bg-emerald-500/20 text-emerald-300' :
                    wp.status === 'Completed' ? 'bg-blue-500/20 text-blue-300' : 'bg-slate-700 text-slate-300'
                  }`}>
                    {wp.status}
                  </span>
                )}
              </div>
              <h2 className="text-xl font-bold mt-1 text-white tracking-tight">{wp.name}</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Executive Metrics Bar */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-slate-50 border-b border-slate-200 text-sm">
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs text-slate-500 font-medium">Weighted Progress</span>
            <div className="flex items-baseline space-x-2 mt-1">
              <span className="text-2xl font-bold text-indigo-600">{metrics.avg_progress}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden">
              <div className="bg-indigo-600 h-full rounded-full" style={{ width: `${metrics.avg_progress}%` }} />
            </div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs text-slate-500 font-medium">Task Health</span>
            <div className="flex items-center space-x-2 mt-1">
              <span className="text-xl font-bold text-slate-800">{metrics.completed_tasks}/{metrics.total_tasks}</span>
              <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-1.5 py-0.5 rounded">Done</span>
            </div>
            <div className="text-xs text-amber-600 font-medium mt-1">
              {metrics.blocked_tasks > 0 ? `${metrics.blocked_tasks} Blocked` : 'Zero Blockers'}
            </div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs text-slate-500 font-medium">Subcontractor</span>
            <div className="text-sm font-bold text-slate-800 truncate mt-1">{wp.company_name || 'In-House Crew'}</div>
            <div className="text-xs text-slate-500 truncate">{wp.lead_contact || 'No lead specified'}</div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs text-slate-500 font-medium">Allocated Budget</span>
            <div className="text-lg font-bold text-slate-900 mt-1">
              ${(wp.budget_allocated || 0).toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 truncate">
              Claimed: ${(metrics.total_claimed_amount || 0).toLocaleString()}
            </div>
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs text-slate-500 font-medium">Active Manpower</span>
            <div className="flex items-center space-x-2 mt-1">
              <span className="text-2xl font-bold text-slate-800">{metrics.manpower_count}</span>
              <span className="text-xs text-slate-500">workers assigned</span>
            </div>
            <div className="text-xs text-indigo-600 font-medium mt-1">
              {metrics.active_blockers_count} active alerts
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 px-6 bg-white space-x-6 text-sm font-medium">
          {[
            { key: 'overview', label: 'Overview & Hierarchy', icon: Layers },
            { key: 'tasks', label: `Tasks (${metrics.total_tasks})`, icon: CheckCircle2 },
            { key: 'claims', label: `Progress Claims (${claims.length})`, icon: DollarSign },
            { key: 'blockers', label: `Active Blockers (${metrics.active_blockers_count})`, icon: ShieldAlert },
            { key: 'procurement', label: `Procurement (${purchase_orders?.length || 0})`, icon: ShoppingBag }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`py-3.5 flex items-center space-x-2 border-b-2 font-medium transition-colors ${
                  isActive
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Tab Content */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-base font-bold text-slate-900 border-b pb-2">Hierarchical Context</h3>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-xs text-slate-500 font-medium block">Assigned Site</span>
                    <span className="font-semibold text-slate-800">{wp.site_name || 'All Project Sites'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 font-medium block">Parent WBS Node</span>
                    <span className="font-semibold text-slate-800">
                      {wp.wbs_code ? `${wp.wbs_code} — ${wp.wbs_name}` : 'Not linked to WBS'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 font-medium block">Target Programme Window</span>
                    <span className="font-semibold text-slate-800">
                      {wp.start_date || 'TBD'} &rarr; {wp.target_date || 'TBD'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 font-medium block">Scope Description</span>
                    <p className="text-slate-600 text-xs mt-1 bg-slate-50 p-2.5 rounded-lg border border-slate-100 leading-relaxed">
                      {wp.description || 'No detailed scope notes provided for this work package.'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-base font-bold text-slate-900 border-b pb-2">Assigned Operatives & Crew</h3>
                {workers && workers.length > 0 ? (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {workers.map((w: any) => (
                      <div key={w.id} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-200/60">
                        <div className="flex items-center space-x-2.5">
                          <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs">
                            {w.name?.charAt(0) || 'W'}
                          </div>
                          <div>
                            <div className="text-xs font-bold text-slate-800">{w.name}</div>
                            <div className="text-[11px] text-slate-500">{w.trade || 'Operative'} &bull; {w.company_name || 'Subcontractor'}</div>
                          </div>
                        </div>
                        <span className="text-[11px] font-mono bg-white px-2 py-0.5 rounded border text-slate-600">
                          {w.employee_id || 'OP-ID'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic py-4">No dedicated workers directly mapped to this package.</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="space-y-3">
              {tasks && tasks.length > 0 ? (
                tasks.map((t: any) => (
                  <div
                    key={t.id}
                    onClick={() => (onNavigateToTask || onOpenTask)?.(t.id)}
                    className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer flex items-center justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                          t.status === 'Completed' ? 'bg-emerald-100 text-emerald-800' :
                          t.status === 'In Progress' ? 'bg-blue-100 text-blue-800' :
                          t.status === 'Blocked' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {t.status || 'Not Started'}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">{t.trade}</span>
                        {t.drawing_ref && (
                          <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-mono">
                            {t.drawing_ref}
                          </span>
                        )}
                      </div>
                      <h4 className="font-semibold text-slate-900 text-sm">{t.title}</h4>
                      <div className="text-xs text-slate-500 flex items-center space-x-4">
                        <span>Dates: {t.start} &rarr; {t.end}</span>
                        {t.supervisor_name && <span>Sup: {t.supervisor_name}</span>}
                        {t.worker_name && <span>Assigned: {t.worker_name}</span>}
                      </div>
                    </div>

                    <div className="flex items-center space-x-4">
                      <div className="text-right">
                        <span className="text-sm font-bold text-slate-800">{t.progress || 0}%</span>
                        <div className="w-20 bg-slate-100 rounded-full h-1.5 mt-1 overflow-hidden">
                          <div className="bg-indigo-600 h-full rounded-full" style={{ width: `${t.progress || 0}%` }} />
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-400" />
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                  <CheckCircle2 className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No tasks currently mapped to this work package.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'claims' && (
            <div className="space-y-3">
              {claims && claims.length > 0 ? (
                claims.map((c: any) => (
                  <div key={c.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                          c.status === 'Approved' ? 'bg-emerald-100 text-emerald-800' :
                          c.status === 'Submitted' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {c.status}
                        </span>
                        <span className="text-xs text-slate-500">Period: {c.period_date}</span>
                      </div>
                      <h4 className="font-semibold text-slate-900 text-sm mt-1">Claimed: {c.claimed_percentage}%</h4>
                      <p className="text-xs text-slate-500 mt-0.5">{c.notes || 'No claim remarks'}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-slate-500 block">Claim Amount</span>
                      <span className="text-base font-bold text-slate-800">${(c.claimed_amount || 0).toLocaleString()}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                  <DollarSign className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No subcontractor claims submitted for this package.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'blockers' && (
            <div className="space-y-3">
              {blockers && blockers.length > 0 ? (
                blockers.map((b: any) => (
                  <div key={b.id} className="bg-rose-50 border border-rose-200 p-4 rounded-xl shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-rose-800 uppercase tracking-wider bg-rose-200/60 px-2 py-0.5 rounded">
                        {b.blocker_type} Blocker &bull; {b.severity} Severity
                      </span>
                      <span className="text-xs text-rose-600">{b.created_at?.slice(0, 10)}</span>
                    </div>
                    <h4 className="font-bold text-slate-900 text-sm mt-2">{b.description}</h4>
                    <p className="text-xs text-slate-600 mt-1">Affecting Task: <span className="font-semibold">{b.task_title}</span></p>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                  <ShieldAlert className="w-12 h-12 text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-600 font-semibold">Zero active blockers on this package!</p>
                  <p className="text-xs text-slate-400 mt-1">Work is progressing smoothly without impediments.</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'procurement' && (
            <div className="space-y-3">
              {purchase_orders && purchase_orders.length > 0 ? (
                purchase_orders.map((po: any) => (
                  <div key={po.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                          {po.po_number}
                        </span>
                        <span className="text-xs text-slate-500">Vendor: {po.vendor || 'Supplier'}</span>
                      </div>
                      <h4 className="font-semibold text-slate-900 text-sm mt-1">{po.description}</h4>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Expected Delivery: {po.expected_delivery_date || po.expected_delivery || 'Not confirmed'}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-slate-500 block">Value</span>
                      <span className="text-base font-bold text-slate-900">${(po.amount || 0).toLocaleString()}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
                  <ShoppingBag className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No purchase orders linked to this work package.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-white flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Work Package ID: <span className="font-mono">{wp.id}</span>
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium text-sm rounded-xl transition-colors shadow-sm"
          >
            Close Command Center
          </button>
        </div>
      </div>
    </div>
  );
};
