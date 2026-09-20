import React, { useEffect, useState } from 'react';
import {
  FileCheck2, Plus, Calendar, DollarSign, Clock, User, X, CheckCircle2,
  TrendingDown, TrendingUp, AlertCircle
} from 'lucide-react';
import { projectDecisionsApi } from '../api';

interface ProjectDecisionsRegisterProps {
  projectId: string;
}

export const ProjectDecisionsRegister: React.FC<ProjectDecisionsRegisterProps> = ({ projectId }) => {
  const [decisions, setDecisions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    context: '',
    options_considered: '',
    decision_taken: '',
    decided_by: '',
    decision_date: new Date().toISOString().slice(0, 10),
    cost_impact: 0,
    schedule_impact_days: 0,
    status: 'Approved'
  });

  useEffect(() => {
    loadDecisions();
  }, [projectId]);

  const loadDecisions = async () => {
    try {
      setLoading(true);
      const res = await projectDecisionsApi.list({ project_id: projectId });
      setDecisions(res || []);
    } catch (err) {
      console.error('Failed to load project decisions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;
    try {
      const decisionNo = `DEC-${Date.now().toString().slice(-4)}`;
      await projectDecisionsApi.create({
        project_id: projectId,
        decision_no: decisionNo,
        ...formData
      });
      setShowModal(false);
      setFormData({
        title: '',
        context: '',
        options_considered: '',
        decision_taken: '',
        decided_by: '',
        decision_date: new Date().toISOString().slice(0, 10),
        cost_impact: 0,
        schedule_impact_days: 0,
        status: 'Approved'
      });
      loadDecisions();
    } catch (err) {
      console.error('Failed to create decision:', err);
    }
  };

  const totalCostImpact = decisions.reduce((sum, d) => sum + (Number(d.cost_impact) || 0), 0);
  const totalScheduleImpact = decisions.reduce((sum, d) => sum + (Number(d.schedule_impact_days) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header & Stats Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center space-x-2">
            <FileCheck2 className="w-6 h-6 text-emerald-600" />
            <h3 className="text-lg font-bold text-slate-900 tracking-tight">Project Decisions Register</h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Formal governance log of design resolutions, commercial agreements, and technical decisions.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex space-x-2 text-xs font-semibold">
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200">
              {decisions.length} Decisions Logged
            </span>
            <span className={`px-2.5 py-1 rounded-lg border ${
              totalCostImpact > 0 ? 'bg-rose-50 text-rose-700 border-rose-200/60' : 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
            }`}>
              Cost Impact: ${totalCostImpact.toLocaleString()}
            </span>
            <span className={`px-2.5 py-1 rounded-lg border ${
              totalScheduleImpact > 0 ? 'bg-amber-50 text-amber-700 border-amber-200/60' : 'bg-slate-50 text-slate-700 border-slate-200/60'
            }`}>
              Schedule: {totalScheduleImpact > 0 ? `+${totalScheduleImpact}d` : `${totalScheduleImpact}d`}
            </span>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Record Decision</span>
          </button>
        </div>
      </div>

      {/* Decisions List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-slate-400 text-sm">Loading decisions register...</div>
        ) : decisions.length === 0 ? (
          <div className="text-center py-12">
            <FileCheck2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-800">No decisions recorded yet</p>
            <p className="text-xs text-slate-500 mt-1">Record significant commercial, technical, and client decisions here.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {decisions.map(d => (
              <div key={d.id} className="p-5 hover:bg-slate-50/80 transition-colors space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <span className="text-xs font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded border">
                      {d.decision_no || 'DEC'}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded font-bold uppercase bg-emerald-100 text-emerald-800">
                      {d.status || 'Approved'}
                    </span>
                    <span className="text-xs text-slate-400">Date: {d.decision_date}</span>
                  </div>

                  <div className="flex items-center space-x-3 text-xs">
                    {Number(d.cost_impact) !== 0 && (
                      <span className={`font-semibold flex items-center space-x-1 px-2 py-0.5 rounded ${
                        Number(d.cost_impact) > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        <DollarSign className="w-3.5 h-3.5" />
                        <span>${Number(d.cost_impact).toLocaleString()}</span>
                      </span>
                    )}
                    {Number(d.schedule_impact_days) !== 0 && (
                      <span className={`font-semibold flex items-center space-x-1 px-2 py-0.5 rounded ${
                        Number(d.schedule_impact_days) > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-700'
                      }`}>
                        <Clock className="w-3.5 h-3.5" />
                        <span>{Number(d.schedule_impact_days) > 0 ? `+${d.schedule_impact_days}d delay` : `${d.schedule_impact_days}d`}</span>
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="font-bold text-slate-900 text-base">{d.title}</h4>
                  {d.context && (
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed"><span className="font-semibold text-slate-700">Context:</span> {d.context}</p>
                  )}
                  {d.options_considered && (
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed"><span className="font-semibold text-slate-600">Options Considered:</span> {d.options_considered}</p>
                  )}
                </div>

                <div className="bg-emerald-50/60 p-3 rounded-xl border border-emerald-100 text-xs text-emerald-950">
                  <div className="font-bold text-emerald-900 mb-0.5">Formal Decision Taken:</div>
                  <p className="leading-relaxed">{d.decision_taken || 'Decision recorded without formal text.'}</p>
                  {d.decided_by && (
                    <div className="mt-2 text-[11px] text-emerald-700 font-semibold">
                      Decided by: {d.decided_by}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Decision Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <h3 className="font-bold text-slate-900 text-base">Record Formal Governance Decision</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDecision} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Decision Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Switch from GI to Polypropylene Pipe for Riser 3"
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Context / Problem Statement</label>
                <textarea
                  rows={2}
                  placeholder="Background reason requiring this decision..."
                  value={formData.context}
                  onChange={e => setFormData({ ...formData, context: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Options Considered</label>
                <textarea
                  rows={2}
                  placeholder="Alternatives evaluated..."
                  value={formData.options_considered}
                  onChange={e => setFormData({ ...formData, options_considered: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Decision Taken *</label>
                <textarea
                  rows={2}
                  required
                  placeholder="The binding decision, scope adjustment or directive agreed upon..."
                  value={formData.decision_taken}
                  onChange={e => setFormData({ ...formData, decision_taken: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Decided By (Authority)</label>
                  <input
                    type="text"
                    placeholder="e.g. Consultant & Client PM"
                    value={formData.decided_by}
                    onChange={e => setFormData({ ...formData, decided_by: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Decision Date</label>
                  <input
                    type="date"
                    value={formData.decision_date}
                    onChange={e => setFormData({ ...formData, decision_date: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Cost Impact ($)</label>
                  <input
                    type="number"
                    value={formData.cost_impact}
                    onChange={e => setFormData({ ...formData, cost_impact: Number(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Schedule Impact (Days)</label>
                  <input
                    type="number"
                    value={formData.schedule_impact_days}
                    onChange={e => setFormData({ ...formData, schedule_impact_days: Number(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t mt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border rounded-xl text-slate-600 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium shadow-sm"
                >
                  Record Decision
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
