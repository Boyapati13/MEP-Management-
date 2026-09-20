import React, { useState, useEffect, FormEvent } from 'react';
import {
  X, Layers, MapPin, Briefcase, Users, Calendar, FileText,
  DollarSign, ShoppingCart, ShieldCheck, Check, AlertCircle
} from 'lucide-react';
import { sitesApi, workPackagesApi, workersApi, tasksApi, api } from '../api';

interface TaskDetailModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  task?: any | null;
  projectId: string;
}

export function TaskDetailModal({ open, onClose, onSaved, task, projectId }: TaskDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'scope' | 'hierarchy' | 'schedule' | 'refs' | 'evidence'>('scope');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fixtures
  const [sites, setSites] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [supervisors, setSupervisors] = useState<any[]>([]);

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    trade: 'HVAC',
    priority: 'Medium',
    status: 'Not Started',
    progress: 0,
    wbs_code: '',
    site_id: '',
    work_package_id: '',
    company_id: '',
    supervisor_id: '',
    assigned_worker_id: '',
    start: '',
    end: '',
    baseline_start_date: '',
    baseline_end_date: '',
    forecast_start_date: '',
    forecast_end_date: '',
    actual_start_date: '',
    actual_end_date: '',
    drawing_ref: '',
    boq_ref: '',
    procurement_item_id: '',
    evidence_required: 0,
    evidence_type: 'Photo',
    evidence_notes: ''
  });

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (task) {
      setFormData({
        title: task.title || '',
        description: task.description || '',
        trade: task.trade || 'HVAC',
        priority: task.priority || 'Medium',
        status: task.status || 'Not Started',
        progress: task.progress != null ? Number(task.progress) : 0,
        wbs_code: task.wbs_code || '',
        site_id: task.site_id || '',
        work_package_id: task.work_package_id || '',
        company_id: task.company_id || '',
        supervisor_id: task.supervisor_id || '',
        assigned_worker_id: task.assigned_worker_id || '',
        start: task.start || '',
        end: task.end || '',
        baseline_start_date: task.baseline_start_date || task.start || '',
        baseline_end_date: task.baseline_end_date || task.end || '',
        forecast_start_date: task.forecast_start_date || task.start || '',
        forecast_end_date: task.forecast_end_date || task.end || '',
        actual_start_date: task.actual_start_date || '',
        actual_end_date: task.actual_end_date || '',
        drawing_ref: task.drawing_ref || '',
        boq_ref: task.boq_ref || '',
        procurement_item_id: task.procurement_item_id || '',
        evidence_required: task.evidence_required ? 1 : 0,
        evidence_type: task.evidence_type || 'Photo',
        evidence_notes: task.evidence_notes || ''
      });
    } else {
      const today = new Date().toISOString().split('T')[0];
      setFormData({
        title: '',
        description: '',
        trade: 'HVAC',
        priority: 'Medium',
        status: 'Not Started',
        progress: 0,
        wbs_code: `MEP.${Math.floor(10 + Math.random() * 90)}`,
        site_id: '',
        work_package_id: '',
        company_id: '',
        supervisor_id: '',
        assigned_worker_id: '',
        start: today,
        end: '',
        baseline_start_date: today,
        baseline_end_date: '',
        forecast_start_date: today,
        forecast_end_date: '',
        actual_start_date: '',
        actual_end_date: '',
        drawing_ref: '',
        boq_ref: '',
        procurement_item_id: '',
        evidence_required: 1,
        evidence_type: 'Photo',
        evidence_notes: ''
      });
    }

    // Load available fixtures for project
    if (projectId) {
      sitesApi.list(projectId).then(r => setSites(Array.isArray(r) ? r : [])).catch(() => {});
      workPackagesApi.list({ project_id: projectId }).then(r => setPackages(Array.isArray(r) ? r : [])).catch(() => {});
      workersApi.list({ project_id: projectId }).then(r => setWorkers(Array.isArray(r) ? r : [])).catch(() => {});
      api.get<any[]>(`/api/projects/${projectId}/companies`).then(r => setCompanies(Array.isArray(r) ? r : [])).catch(() => {});
      api.get<any[]>(`/api/users?project_id=${projectId}`).then(r => {
        if (Array.isArray(r)) {
          setSupervisors(r.filter(u => ['SiteEngineer', 'SiteSupervisor', 'ProjectManager', 'Admin'].includes(u.role)));
        }
      }).catch(() => {});
    }
  }, [open, task, projectId]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      setError('Task Title is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        project_id: projectId,
        title: formData.title,
        description: formData.description || null,
        trade: formData.trade,
        priority: formData.priority,
        status: formData.status,
        progress: Number(formData.progress),
        wbs_code: formData.wbs_code || null,
        site_id: formData.site_id || null,
        work_package_id: formData.work_package_id || null,
        company_id: formData.company_id || null,
        supervisor_id: formData.supervisor_id || null,
        assigned_worker_id: formData.assigned_worker_id || null,
        start: formData.start || formData.baseline_start_date || null,
        end: formData.end || formData.baseline_end_date || null,
        baseline_start_date: formData.baseline_start_date || formData.start || null,
        baseline_end_date: formData.baseline_end_date || formData.end || null,
        forecast_start_date: formData.forecast_start_date || formData.start || null,
        forecast_end_date: formData.forecast_end_date || formData.end || null,
        actual_start_date: formData.actual_start_date || null,
        actual_end_date: formData.actual_end_date || null,
        drawing_ref: formData.drawing_ref || null,
        boq_ref: formData.boq_ref || null,
        procurement_item_id: formData.procurement_item_id || null,
        evidence_required: formData.evidence_required ? 1 : 0,
        evidence_type: formData.evidence_type || 'None',
        evidence_notes: formData.evidence_notes || null
      };

      if (task?.id) {
        await tasksApi.update(task.id, payload);
      } else {
        await tasksApi.create(payload);
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save task');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all";
  const labelCls = "text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1 block";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-slate-900 text-white">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-blue-400 bg-blue-500/20 px-2 py-0.5 rounded">
                {formData.wbs_code || 'TASK'}
              </span>
              <h2 className="text-base font-bold">{task ? 'Edit Enterprise Task' : 'Create Enterprise Task'}</h2>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">Configure scope, site hierarchy, schedule baselines, and quality gates</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Pillar Tabs */}
        <div className="flex items-center gap-1 px-6 border-b border-gray-100 bg-gray-50/70 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('scope')}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'scope' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <Layers size={14} /> 1. Scope & Trade
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('hierarchy')}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'hierarchy' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <Users size={14} /> 2. Delivery Hierarchy
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('schedule')}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'schedule' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <Calendar size={14} /> 3. Schedule & Baselines
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('refs')}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'refs' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <FileText size={14} /> 4. Engineering & BOQ
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('evidence')}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'evidence' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            <ShieldCheck size={14} /> 5. Quality Gate
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle size={15} /> {error}
          </div>
        )}

        {/* Modal Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-4">
          {/* TAB 1: SCOPE */}
          {activeTab === 'scope' && (
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Task Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Chilled Water Supply Pipe Joint Welding Fl 12"
                  value={formData.title}
                  onChange={e => setFormData(d => ({ ...d, title: e.target.value }))}
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>Scope Description</label>
                <textarea
                  rows={2}
                  placeholder="Detailed specifications, technical constraints, method statement references..."
                  value={formData.description}
                  onChange={e => setFormData(d => ({ ...d, description: e.target.value }))}
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Trade</label>
                  <select
                    value={formData.trade}
                    onChange={e => setFormData(d => ({ ...d, trade: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="HVAC">HVAC</option>
                    <option value="Electrical">Electrical</option>
                    <option value="Plumbing">Plumbing</option>
                    <option value="Fire Fighting">Fire Fighting</option>
                    <option value="ELV">ELV</option>
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Priority</label>
                  <select
                    value={formData.priority}
                    onChange={e => setFormData(d => ({ ...d, priority: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                <div>
                  <label className={labelCls}>WBS Reference Code</label>
                  <input
                    type="text"
                    placeholder="e.g. MEP.02.04"
                    value={formData.wbs_code}
                    onChange={e => setFormData(d => ({ ...d, wbs_code: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className={labelCls}>Task Status</label>
                  <select
                    value={formData.status}
                    onChange={e => setFormData(d => ({ ...d, status: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="Not Started">Not Started</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Blocked">Blocked</option>
                    <option value="Ready for Verification">Ready for Verification</option>
                    <option value="Completed">Completed</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className={labelCls}>Current Progress</label>
                    <span className="text-xs font-bold text-blue-600">{formData.progress}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={formData.progress}
                    onChange={e => setFormData(d => ({ ...d, progress: Number(e.target.value) }))}
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DELIVERY HIERARCHY */}
          {activeTab === 'hierarchy' && (
            <div className="space-y-4">
              <div className="p-3 bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-2xl text-xs">
                <strong>Multi-Level Operational Mapping:</strong> Links the task down from Project Master through Work Package, Site, and Subcontractor to Supervisor and Worker.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Geofenced Site</label>
                  <select
                    value={formData.site_id}
                    onChange={e => setFormData(d => ({ ...d, site_id: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">Select Operational Site...</option>
                    {sites.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.city || 'Site'})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Work Package Contract</label>
                  <select
                    value={formData.work_package_id}
                    onChange={e => setFormData(d => ({ ...d, work_package_id: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">Select Work Package...</option>
                    {packages.map(p => (
                      <option key={p.id} value={p.id}>[{p.code}] {p.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Subcontractor Company</label>
                  <select
                    value={formData.company_id}
                    onChange={e => setFormData(d => ({ ...d, company_id: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">Select Subcontractor...</option>
                    {companies.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Field Supervisor</label>
                  <select
                    value={formData.supervisor_id}
                    onChange={e => setFormData(d => ({ ...d, supervisor_id: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">Select Supervisor...</option>
                    {supervisors.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.role})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Assigned Worker / Lead</label>
                  <select
                    value={formData.assigned_worker_id}
                    onChange={e => setFormData(d => ({ ...d, assigned_worker_id: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">Select Operative...</option>
                    {workers.map(w => (
                      <option key={w.id} value={w.id}>{w.name} [{w.trade || 'Worker'}]</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SCHEDULE & BASELINES */}
          {activeTab === 'schedule' && (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs">
                <strong>Schedule Governance:</strong> Compares original Baseline contractual dates against live Forecast / Actual execution to track trade slippages in the Control Tower.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Baseline Dates */}
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-3">
                  <span className="text-xs font-bold text-gray-900 uppercase tracking-wider block">Contract Baseline</span>
                  <div>
                    <label className={labelCls}>Baseline Start Date</label>
                    <input
                      type="date"
                      value={formData.baseline_start_date}
                      onChange={e => setFormData(d => ({ ...d, baseline_start_date: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Baseline Finish Date</label>
                    <input
                      type="date"
                      value={formData.baseline_end_date}
                      onChange={e => setFormData(d => ({ ...d, baseline_end_date: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                </div>

                {/* Forecast Dates */}
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-3">
                  <span className="text-xs font-bold text-gray-900 uppercase tracking-wider block">Live Forecast</span>
                  <div>
                    <label className={labelCls}>Forecast Start Date</label>
                    <input
                      type="date"
                      value={formData.forecast_start_date}
                      onChange={e => setFormData(d => ({ ...d, forecast_start_date: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Forecast Finish Date</label>
                    <input
                      type="date"
                      value={formData.forecast_end_date}
                      onChange={e => setFormData(d => ({ ...d, forecast_end_date: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>

              {/* Actual Execution Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className={labelCls}>Actual Start Date</label>
                  <input
                    type="date"
                    value={formData.actual_start_date}
                    onChange={e => setFormData(d => ({ ...d, actual_start_date: e.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Actual Finish Date</label>
                  <input
                    type="date"
                    value={formData.actual_end_date}
                    onChange={e => setFormData(d => ({ ...d, actual_end_date: e.target.value }))}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: ENGINEERING & BOQ REFERENCES */}
          {activeTab === 'refs' && (
            <div className="space-y-4">
              <div>
                <label className={labelCls}>Drawing Reference Number</label>
                <input
                  type="text"
                  placeholder="e.g. M-101-HVAC-LVL04-REV3"
                  value={formData.drawing_ref}
                  onChange={e => setFormData(d => ({ ...d, drawing_ref: e.target.value }))}
                  className={inputCls}
                />
                <span className="text-[11px] text-gray-500 mt-1 block">Approved shop drawing or IFC document reference.</span>
              </div>

              <div>
                <label className={labelCls}>BOQ Item Code / Line Item</label>
                <input
                  type="text"
                  placeholder="e.g. BOQ-04-E-12 (Chilled Water Pipe 100mm)"
                  value={formData.boq_ref}
                  onChange={e => setFormData(d => ({ ...d, boq_ref: e.target.value }))}
                  className={inputCls}
                />
                <span className="text-[11px] text-gray-500 mt-1 block">Tender or revised Bill of Quantities pay item code.</span>
              </div>

              <div>
                <label className={labelCls}>Procurement Material Requisition ID</label>
                <input
                  type="text"
                  placeholder="e.g. PR-HVAC-2026-088"
                  value={formData.procurement_item_id}
                  onChange={e => setFormData(d => ({ ...d, procurement_item_id: e.target.value }))}
                  className={inputCls}
                />
                <span className="text-[11px] text-gray-500 mt-1 block">Links task start directly to required material arrival on site.</span>
              </div>
            </div>
          )}

          {/* TAB 5: QUALITY & EVIDENCE GATE */}
          {activeTab === 'evidence' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-3">
                <ShieldCheck size={20} className="text-emerald-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-emerald-900">Quality Gate Enforcement</h4>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    When evidence is required, operatives cannot complete the task from their mobile shell without submitting photographic proof or supervisor inspection signoff.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
                <input
                  type="checkbox"
                  id="evidence_required_check"
                  checked={formData.evidence_required === 1}
                  onChange={e => setFormData(d => ({ ...d, evidence_required: e.target.checked ? 1 : 0 }))}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="evidence_required_check" className="text-xs font-bold text-gray-800 cursor-pointer">
                  Require Photographic / Physical Evidence to Close Task
                </label>
              </div>

              {formData.evidence_required === 1 && (
                <div className="space-y-3 pt-2">
                  <div>
                    <label className={labelCls}>Evidence Type</label>
                    <select
                      value={formData.evidence_type}
                      onChange={e => setFormData(d => ({ ...d, evidence_type: e.target.value }))}
                      className={inputCls}
                    >
                      <option value="Photo">Site Photo (Timestamped Camera Capture)</option>
                      <option value="Document">Signed Checklist / Test Sheet</option>
                      <option value="Inspection">QA/QC Inspection Signoff (WIR/MIR)</option>
                      <option value="Signoff">Consultant Witness Signoff</option>
                    </select>
                  </div>

                  <div>
                    <label className={labelCls}>Evidence Inspection Notes & Acceptance Criteria</label>
                    <textarea
                      rows={2}
                      placeholder="e.g. Ensure pressure gauge is clearly visible reading 12 bar for 24 hours test"
                      value={formData.evidence_notes}
                      onChange={e => setFormData(d => ({ ...d, evidence_notes: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Modal Footer */}
          <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-200 text-gray-700 font-semibold rounded-xl text-xs hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Check size={14} /> {saving ? 'Saving...' : task ? 'Update Task' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
