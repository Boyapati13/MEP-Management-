import React, { useEffect, useState } from 'react';
import {
  ListChecks, Plus, CheckCircle2, AlertTriangle, Clock,
  Calendar, User, Trash2, Edit3, X, Filter
} from 'lucide-react';
import { projectActionsApi } from '../api';

interface ProjectActionsRegisterProps {
  projectId: string;
}

export const ProjectActionsRegister: React.FC<ProjectActionsRegisterProps> = ({ projectId }) => {
  const [actions, setActions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    assigned_to_name: '',
    priority: 'Medium',
    due_date: '',
    source_type: 'Site Walk'
  });

  useEffect(() => {
    loadActions();
  }, [projectId]);

  const loadActions = async () => {
    try {
      setLoading(true);
      const res = await projectActionsApi.list({ project_id: projectId });
      setActions(res || []);
    } catch (err) {
      console.error('Failed to load project actions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;
    try {
      const actionNo = `ACT-${Date.now().toString().slice(-4)}`;
      await projectActionsApi.create({
        project_id: projectId,
        action_no: actionNo,
        ...formData,
        status: 'Open'
      });
      setShowModal(false);
      setFormData({
        title: '',
        description: '',
        assigned_to_name: '',
        priority: 'Medium',
        due_date: '',
        source_type: 'Site Walk'
      });
      loadActions();
    } catch (err) {
      console.error('Failed to create action:', err);
    }
  };

  const handleToggleComplete = async (action: any) => {
    try {
      const newStatus = action.status === 'Completed' ? 'Open' : 'Completed';
      await projectActionsApi.update(action.id, {
        status: newStatus,
        completed_at: newStatus === 'Completed' ? new Date().toISOString() : null
      });
      loadActions();
    } catch (err) {
      console.error('Failed to toggle action status:', err);
    }
  };

  const filtered = actions.filter(a => {
    if (filterStatus === 'All') return true;
    return a.status === filterStatus;
  });

  const openCount = actions.filter(a => a.status === 'Open' || a.status === 'In Progress').length;
  const overdueCount = actions.filter(a => a.status === 'Overdue').length;
  const completedCount = actions.filter(a => a.status === 'Completed').length;

  return (
    <div className="space-y-6">
      {/* Header & Stats Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center space-x-2">
            <ListChecks className="w-6 h-6 text-indigo-600" />
            <h3 className="text-lg font-bold text-slate-900 tracking-tight">Project Actions Register</h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Track operational deliverables, site walk snags, meeting action items and closeouts.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex space-x-2 text-xs font-semibold">
            <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200/60">
              {openCount} Open
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200/60">
              {overdueCount} Overdue
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/60">
              {completedCount} Completed
            </span>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="flex items-center space-x-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Raise Action</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center space-x-2 border-b border-slate-200 pb-2 text-xs font-medium">
        {['All', 'Open', 'Overdue', 'Completed'].map(st => (
          <button
            key={st}
            onClick={() => setFilterStatus(st)}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              filterStatus === st
                ? 'bg-slate-900 text-white font-bold'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {st} ({st === 'All' ? actions.length : actions.filter(a => a.status === st).length})
          </button>
        ))}
      </div>

      {/* Actions Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-slate-400 text-sm">Loading actions register...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-800">No actions matching filter</p>
            <p className="text-xs text-slate-500 mt-1">All action items are up to date or cleared.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map(action => (
              <div
                key={action.id}
                className="p-4 hover:bg-slate-50/80 transition-colors flex items-center justify-between gap-4"
              >
                <div className="flex items-start space-x-3.5 flex-1">
                  <button
                    onClick={() => handleToggleComplete(action)}
                    className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                      action.status === 'Completed'
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'border-slate-300 hover:border-slate-400 bg-white'
                    }`}
                  >
                    {action.status === 'Completed' && <CheckCircle2 className="w-4 h-4" />}
                  </button>

                  <div className="space-y-1 flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] font-mono font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                        {action.action_no || 'ACT'}
                      </span>
                      <span className={`text-[11px] px-2 py-0.5 rounded font-bold uppercase ${
                        action.status === 'Completed' ? 'bg-emerald-100 text-emerald-800' :
                        action.status === 'Overdue' ? 'bg-rose-100 text-rose-800 animate-pulse' :
                        action.status === 'In Progress' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {action.status}
                      </span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
                        action.priority === 'High' ? 'bg-rose-50 text-rose-700' :
                        action.priority === 'Low' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'
                      }`}>
                        {action.priority} Priority
                      </span>
                      <span className="text-[11px] text-slate-400 font-medium bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                        {action.source_type}
                      </span>
                    </div>

                    <h4 className={`text-sm font-bold text-slate-900 ${action.status === 'Completed' ? 'line-through text-slate-400' : ''}`}>
                      {action.title}
                    </h4>

                    {action.description && (
                      <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">{action.description}</p>
                    )}

                    <div className="flex items-center space-x-4 text-xs text-slate-500 pt-1">
                      <span className="flex items-center space-x-1">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span>{action.assigned_to_name || 'Unassigned'}</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span className={action.status === 'Overdue' ? 'text-rose-600 font-bold' : ''}>
                          Due: {action.due_date || 'No due date'}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Action Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <h3 className="font-bold text-slate-900 text-base">Raise Project Action Item</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateAction} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Action Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Inspect LV Panel termination in Substation 2"
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description / Notes</label>
                <textarea
                  rows={2}
                  placeholder="Details of required resolution..."
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Assignee Name</label>
                  <input
                    type="text"
                    placeholder="e.g. John Smith"
                    value={formData.assigned_to_name}
                    onChange={e => setFormData({ ...formData, assigned_to_name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={formData.due_date}
                    onChange={e => setFormData({ ...formData, due_date: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Priority</label>
                  <select
                    value={formData.priority}
                    onChange={e => setFormData({ ...formData, priority: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Source Type</label>
                  <select
                    value={formData.source_type}
                    onChange={e => setFormData({ ...formData, source_type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value="Site Walk">Site Walk</option>
                    <option value="Progress Meeting">Progress Meeting</option>
                    <option value="Safety Audit">Safety Audit</option>
                    <option value="Quality Inspection">Quality Inspection</option>
                    <option value="General">General</option>
                  </select>
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
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium shadow-sm"
                >
                  Create Action
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
