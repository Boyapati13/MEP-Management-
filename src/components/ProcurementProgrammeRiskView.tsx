/**
 * MEP Management Platform — V1.4.1 Procurement & Programme Impact View
 * Connects procurement orders with construction schedule, lead times, and automated task blockers.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Package,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Search,
  Filter,
  RefreshCw,
  Calendar,
  Layers,
  ArrowRight,
  ShieldAlert,
  HelpCircle,
  Truck
} from 'lucide-react';
import { api } from '../api';

interface ProcurementProgrammeRiskViewProps {
  projectId: string;
  onSelectTask?: (taskId: string) => void;
}

export const ProcurementProgrammeRiskView: React.FC<ProcurementProgrammeRiskViewProps> = ({
  projectId,
  onSelectTask
}) => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterCriticalOnly, setFilterCriticalOnly] = useState(false);
  const [filterNegativeBufferOnly, setFilterNegativeBufferOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const loadData = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.get(`/api/procurement/programme-impact?project_id=${projectId}`);
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load procurement programme impact analysis');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm font-medium text-gray-700">Analyzing Procurement Lead Times & Schedule Risk...</p>
        <p className="text-xs text-gray-400 mt-1">Cross-referencing purchase orders against critical path tasks</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-red-800 text-center">
        <AlertTriangle size={32} className="mx-auto mb-2 text-red-600" />
        <p className="font-semibold text-sm">Failed to Load Procurement Risk Data</p>
        <p className="text-xs mt-1 text-red-600">{error}</p>
        <button
          onClick={loadData}
          className="mt-4 px-4 py-1.5 bg-red-600 text-white rounded-xl text-xs font-semibold hover:bg-red-700 transition-colors inline-flex items-center gap-1.5"
        >
          <RefreshCw size={12} /> Retry Analysis
        </button>
      </div>
    );
  }

  const items = (data?.items || []).filter((item: any) => {
    if (filterCriticalOnly && !item.is_critical_path) return false;
    if (filterNegativeBufferOnly && item.buffer_days >= 0) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const matchPo = item.po_number?.toLowerCase().includes(q);
      const matchVendor = item.vendor?.toLowerCase().includes(q);
      const matchTask = item.task_title?.toLowerCase().includes(q);
      const matchDesc = item.description?.toLowerCase().includes(q);
      if (!matchPo && !matchVendor && !matchTask && !matchDesc) return false;
    }
    return true;
  });

  const summary = data?.summary || {
    total_orders: 0,
    critical_path_orders: 0,
    negative_buffer_count: 0,
    blocked_tasks_count: 0
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Truck className="text-blue-600" size={24} />
            Procurement Programme Risk & Critical Lead Times
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Real-time synchronization between equipment delivery dates and task construction start milestones
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 shadow-sm"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* KPI Highlights */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <span className="text-xs font-medium text-gray-500">Tracked POs</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">{summary.total_orders}</p>
          <span className="text-xs text-gray-400">active material orders</span>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <span className="text-xs font-medium text-gray-500">Critical Path Items</span>
          <p className="text-2xl font-bold text-amber-600 mt-1">{summary.critical_path_orders}</p>
          <span className="text-xs text-gray-400">linked to milestone dates</span>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <span className="text-xs font-medium text-gray-500">Negative Buffer Deficit</span>
          <p className="text-2xl font-bold text-red-600 mt-1">{summary.negative_buffer_count}</p>
          <span className="text-xs text-red-500 font-medium">delivery after start date</span>
        </div>

        <div className="p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
          <span className="text-xs font-medium text-gray-500">Automated Task Blockers</span>
          <p className="text-2xl font-bold text-indigo-600 mt-1">{summary.blocked_tasks_count}</p>
          <span className="text-xs text-gray-400">synchronized system blockers</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <Search size={16} className="text-gray-400 ml-2" />
          <input
            type="text"
            placeholder="Search PO #, supplier, description, or task..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full text-xs bg-transparent border-none focus:outline-none placeholder-gray-400 text-gray-800"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterCriticalOnly(!filterCriticalOnly)}
            className={`px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors ${
              filterCriticalOnly
                ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
            }`}
          >
            Critical Path Only
          </button>
          <button
            onClick={() => setFilterNegativeBufferOnly(!filterNegativeBufferOnly)}
            className={`px-3 py-1.5 text-xs font-medium rounded-xl border transition-colors ${
              filterNegativeBufferOnly
                ? 'bg-red-600 text-white border-red-700 shadow-sm'
                : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
            }`}
          >
            Negative Buffer Only
          </button>
        </div>
      </div>

      {/* Table of Orders & Buffer Risk */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3.5 px-4">PO & Supplier</th>
                <th className="py-3.5 px-4">Description / Discipline</th>
                <th className="py-3.5 px-4">Lead Time</th>
                <th className="py-3.5 px-4">Delivery vs Required</th>
                <th className="py-3.5 px-4 text-center">Buffer Days</th>
                <th className="py-3.5 px-4">Analytical Risk</th>
                <th className="py-3.5 px-4">Linked Task</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">
                    <Package size={36} className="mx-auto mb-2 opacity-30" />
                    <p className="font-medium text-gray-500">No matching procurement records found</p>
                    <p className="text-xs text-gray-400 mt-0.5">Adjust search criteria or create linked procurement orders</p>
                  </td>
                </tr>
              ) : (
                items.map((item: any) => {
                  const isNegative = item.buffer_days < 0;
                  const isDelivered = item.status === 'Delivered';

                  return (
                    <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-gray-900">{item.po_number || 'PO-DRAFT'}</div>
                        <div className="text-gray-500">{item.vendor || 'Unassigned Supplier'}</div>
                        {item.status && (
                          <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            isDelivered ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {item.status}
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-medium text-gray-800 line-clamp-1">{item.description || 'MEP Equipment'}</div>
                        <div className="text-gray-400 text-[11px]">{item.discipline || 'General MEP'}</div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-gray-800">{item.lead_time_days || 0} days</div>
                        <div className="text-gray-400 text-[11px]">Est. factory to site</div>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="space-y-0.5 text-[11px]">
                          <div><span className="text-gray-400">Expected:</span> <span className="font-medium text-gray-700">{item.expected_delivery_date || '—'}</span></div>
                          <div><span className="text-gray-400">Required:</span> <span className="font-medium text-gray-700">{item.required_on_site_date || item.task_start_date || '—'}</span></div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full font-mono font-bold text-xs ${
                            isDelivered
                              ? 'bg-emerald-100 text-emerald-800'
                              : isNegative
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : item.buffer_days <= 5
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {isDelivered ? 'Delivered' : `${item.buffer_days > 0 ? '+' : ''}${item.buffer_days}d`}
                        </span>
                        {item.is_task_blocked ? (
                          <div className="mt-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-red-600">
                            <ShieldAlert size={11} /> Task Blocked
                          </div>
                        ) : null}
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                          item.risk_level === 'Critical' ? 'bg-red-500 text-white' :
                          item.risk_level === 'High' ? 'bg-amber-500 text-white' :
                          item.risk_level === 'Medium' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {item.risk_level}
                        </span>
                        {item.is_critical_path ? (
                          <div className="text-[10px] font-semibold text-amber-700 mt-1">Critical Path</div>
                        ) : null}
                      </td>

                      <td className="py-3.5 px-4">
                        {item.task_id ? (
                          <button
                            onClick={() => onSelectTask?.(item.task_id)}
                            className="text-left group hover:underline block"
                          >
                            <div className="font-medium text-blue-600 group-hover:text-blue-800 flex items-center gap-1">
                              {item.task_title || 'View Task'}
                              <ArrowRight size={12} />
                            </div>
                            <div className="text-gray-400 text-[10px]">Start: {item.task_start_date || '—'}</div>
                          </button>
                        ) : (
                          <span className="text-gray-400 text-[11px]">Unlinked Task</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
