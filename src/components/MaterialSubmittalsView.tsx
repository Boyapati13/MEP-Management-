import React, { useState, useEffect, useCallback } from 'react';
import {
  FileCheck2, Plus, Search, Sparkles, CheckCircle2, AlertTriangle, Clock,
  FileText, Building2, Layers, Upload, ExternalLink, ShieldCheck, X, Printer, RefreshCw
} from 'lucide-react';
import { api } from '../api';
import { exportFormalDocumentPdf } from '../utils/printDocument';

interface MaterialSubmittalsViewProps {
  projectId: string;
  projects?: any[];
  user?: any;
  onSubmittalsChanged?: () => void;
}

const APPROVAL_BADGE_STYLES: Record<string, string> = {
  'Code A - Approved': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Approved': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Code B - Approved as Noted': 'bg-teal-50 text-teal-700 border-teal-200',
  'Approved with Comments': 'bg-teal-50 text-teal-700 border-teal-200',
  'Approved With Comments': 'bg-teal-50 text-teal-700 border-teal-200',
  'Under Review': 'bg-amber-50 text-amber-800 border-amber-200',
  'Submitted': 'bg-blue-50 text-blue-700 border-blue-200',
  'Pending': 'bg-blue-50 text-blue-700 border-blue-200',
  'Code C - Revise & Resubmit': 'bg-orange-50 text-orange-800 border-orange-200',
  'Revise & Resubmit': 'bg-orange-50 text-orange-800 border-orange-200',
  'Revise and Resubmit': 'bg-orange-50 text-orange-800 border-orange-200',
  'Code D - Rejected': 'bg-rose-50 text-rose-700 border-rose-200',
  'Rejected': 'bg-rose-50 text-rose-700 border-rose-200',
  'Draft': 'bg-slate-100 text-slate-700 border-slate-200',
  'Closed': 'bg-slate-100 text-slate-600 border-slate-200',
};

export function MaterialSubmittalsView({
  projectId,
  projects = [],
  user,
  onSubmittalsChanged,
}: MaterialSubmittalsViewProps) {
  const activeProjectId = projectId && projectId !== 'ALL' ? projectId : (projects[0]?.id || 'bov-st-venera-2618');
  const activeProject = projects.find(p => p.id === activeProjectId);

  const [submittals, setSubmittals] = useState<any[]>([]);
  const [drawings, setDrawings] = useState<any[]>([]);
  const [boqItems, setBoqItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tradeFilter, setTradeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<any | null>(null);
  const [reviewForm, setReviewForm] = useState({
    status: 'Approved',
    approval_code: 'Code A - Approved',
    consultant_comments: '',
    reviewed_by: user?.name || 'Lead MEP Consultant',
  });

  const [form, setForm] = useState({
    title: '',
    trade: 'Electrical',
    manufacturer: '',
    model_no: '',
    supplier: '',
    subcontractor: 'ElectroData Installations Ltd',
    spec_section: '',
    drawing_ref: '',
    boq_ref: '',
    revision: 'Rev 0',
    country_of_origin: 'EU',
    lead_time_weeks: 3,
    sample_submitted: 1,
    status: 'Submitted',
    description: '',
    attachment_name: '',
    attachment_data: '',
  });

  const loadData = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const [subRes, docRes, boqRes] = await Promise.all([
        api.get<any[]>(`/api/submittals?project_id=${activeProjectId}`).catch(() => []),
        api.get<any[]>(`/api/documents?project_id=${activeProjectId}`).catch(() => []),
        api.get<any[]>(`/api/boq_items?project_id=${activeProjectId}`).catch(() => []),
      ]);
      setSubmittals(Array.isArray(subRes) ? subRes : []);
      setDrawings(Array.isArray(docRes) ? docRes : []);
      setBoqItems(Array.isArray(boqRes) ? boqRes : []);
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setForm(prev => ({
        ...prev,
        attachment_name: file.name,
        attachment_data: String(reader.result || ''),
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleCreateSubmittal = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    try {
      await api.post('/api/submittals', {
        project_id: activeProjectId,
        ...form,
        item: form.title,
        lead_time_weeks: Number(form.lead_time_weeks || 3),
        sample_submitted: form.sample_submitted ? 1 : 0,
      });
      setShowCreateModal(false);
      setForm({
        title: '',
        trade: 'Electrical',
        manufacturer: '',
        model_no: '',
        supplier: '',
        subcontractor: 'ElectroData Installations Ltd',
        spec_section: '',
        drawing_ref: '',
        boq_ref: '',
        revision: 'Rev 0',
        country_of_origin: 'EU',
        lead_time_weeks: 3,
        sample_submitted: 1,
        status: 'Submitted',
        description: '',
        attachment_name: '',
        attachment_data: '',
      });
      setNotice({ type: 'success', text: 'Material submittal registered and indexed for Copilot intelligence.' });
      await loadData();
      onSubmittalsChanged?.();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to submit material record' });
    }
  };

  const handleQuickReview = async (rec: any, status: string, approvalCode: string, defaultComment?: string) => {
    setNotice(null);
    try {
      await api.put(`/api/submittals/${rec.id}`, {
        status,
        approval_code: approvalCode,
        consultant_comments: defaultComment || rec.consultant_comments || `Reviewed and stamped ${approvalCode}.`,
        reviewed_by: user?.name || 'Ing. Christian Borg (Enser Ltd)',
        reviewed_date: new Date().toISOString().slice(0, 10),
      });
      setNotice({ type: 'success', text: `Submittal ${rec.number || rec.id?.slice(0, 8)} updated to ${approvalCode}.` });
      await loadData();
      onSubmittalsChanged?.();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to update submittal status' });
    }
  };

  const handleSubmitReviewModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewTarget) return;
    await handleQuickReview(
      reviewTarget,
      reviewForm.status,
      reviewForm.approval_code,
      reviewForm.consultant_comments
    );
    setReviewTarget(null);
  };

  const openCopilotWithPrompt = (prompt: string) => {
    window.dispatchEvent(
      new CustomEvent('open-copilot', {
        detail: {
          projectId: activeProjectId,
          prompt,
        },
      })
    );
  };

  const filtered = submittals.filter(s => {
    if (tradeFilter !== 'All' && (s.trade || 'MEP') !== tradeFilter) return false;
    if (statusFilter !== 'All') {
      const st = String(s.status || '');
      const ac = String(s.approval_code || '');
      if (!st.includes(statusFilter) && !ac.includes(statusFilter)) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = `${s.number || ''} ${s.title || ''} ${s.item || ''} ${s.manufacturer || ''} ${s.model_no || ''} ${s.spec_section || ''} ${s.drawing_ref || ''} ${s.boq_ref || ''} ${s.approval_code || ''} ${s.consultant_comments || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const approvedCount = submittals.filter(s =>
    String(s.status || '').toLowerCase().includes('approved') ||
    String(s.approval_code || '').includes('Code A') ||
    String(s.approval_code || '').includes('Code B')
  ).length;
  const underReviewCount = submittals.filter(s => s.status === 'Submitted' || s.status === 'Under Review').length;
  const reviseCount = submittals.filter(s =>
    String(s.status || '').toLowerCase().includes('revise') ||
    s.status === 'Rejected' ||
    String(s.approval_code || '').includes('Code C') ||
    String(s.approval_code || '').includes('Code D')
  ).length;

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
              Technical Material Submittals (MAR)
            </span>
            {activeProject?.code && (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-slate-100 text-slate-700">
                {activeProject.code}
              </span>
            )}
          </div>
          <h2 className="text-xl font-bold text-slate-900 mt-1">Material &amp; Equipment Submittals Register</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Track submitted MEP materials, manufacturer data sheets, linked CAD drawings, BOQ references, and Consultant approval codes (Code A / B / C / D).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              openCopilotWithPrompt(
                'List all submitted material submittals, their approval codes, manufacturers, and linked drawings/specifications.'
              )
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition-colors cursor-pointer"
          >
            <Sparkles size={14} className="text-indigo-600" /> Ask Copilot on Submittals
          </button>

          <button
            type="button"
            onClick={() =>
              exportFormalDocumentPdf({
                documentType: 'Material Approval Register (MAR)',
                referenceCode: `MAR-${activeProject?.code || 'MEP'}-${new Date().toISOString().slice(0, 10)}`,
                title: 'Material & Equipment Submittals — Official Register',
                subtitle: `Project: ${activeProject?.name || activeProjectId}`,
                projectCode: activeProject?.code || activeProjectId,
                status: `${filtered.length} SUBMITTALS`,
                columns: [
                  { key: 'number', label: 'Submittal No.' },
                  { key: 'title', label: 'Material / Equipment' },
                  { key: 'manufacturer', label: 'Manufacturer & Model' },
                  { key: 'refs', label: 'Spec / Drawing / BOQ' },
                  { key: 'approval', label: 'Approval Code', align: 'center' },
                ],
                rows: filtered.map(s => ({
                  number: `${s.number || 'SUB'} (${s.revision || 'Rev 0'})`,
                  title: s.title || s.item || 'Material Submittal',
                  manufacturer: `${s.manufacturer || 'TBD'} — ${s.model_no || ''}`,
                  refs: `Dwg: ${s.drawing_ref || 'N/A'} | BOQ: ${s.boq_ref || 'N/A'}`,
                  approval: s.approval_code || s.status || 'Submitted',
                })),
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold transition-colors cursor-pointer"
          >
            <Printer size={14} /> Export PDF
          </button>

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus size={15} /> Submit Material
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Submitted</span>
            <FileCheck2 size={16} className="text-blue-600" />
          </div>
          <span className="text-2xl font-bold text-slate-900">{submittals.length}</span>
          <span className="text-[11px] text-slate-500 block mt-0.5">Technical Material Dossiers</span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Code A / B Approved</span>
            <CheckCircle2 size={16} className="text-emerald-600" />
          </div>
          <span className="text-2xl font-bold text-emerald-600">{approvedCount}</span>
          <span className="text-[11px] text-slate-500 block mt-0.5">Cleared for Procurement</span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Under Review</span>
            <Clock size={16} className="text-amber-600" />
          </div>
          <span className="text-2xl font-bold text-amber-600">{underReviewCount}</span>
          <span className="text-[11px] text-slate-500 block mt-0.5">Awaiting Consultant Stamp</span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Code C / D Action</span>
            <AlertTriangle size={16} className="text-orange-600" />
          </div>
          <span className="text-2xl font-bold text-orange-600">{reviseCount}</span>
          <span className="text-[11px] text-slate-500 block mt-0.5">Revise &amp; Resubmit Required</span>
        </div>
      </div>

      {notice && (
        <div
          className={`px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-[11px] font-bold ml-4 opacity-75 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="bg-white rounded-xl border border-slate-200/90 p-3.5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search material, manufacturer, model, spec section, drawing ref (e.g. 2618-L-LTG-01)..."
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={tradeFilter}
            onChange={e => setTradeFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 font-medium text-slate-700"
          >
            <option value="All">All Disciplines</option>
            <option value="Electrical">Electrical</option>
            <option value="HVAC">HVAC</option>
            <option value="ELV / Data & Security">ELV / Data &amp; Security</option>
            <option value="Fire Protection">Fire Protection</option>
            <option value="Plumbing">Plumbing</option>
          </select>

          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 font-medium text-slate-700"
          >
            <option value="All">All Approval Codes</option>
            <option value="Code A">Code A - Approved</option>
            <option value="Code B">Code B - Approved as Noted</option>
            <option value="Under Review">Under Review / Submitted</option>
            <option value="Code C">Code C - Revise &amp; Resubmit</option>
            <option value="Code D">Code D - Rejected</option>
          </select>

          <button
            type="button"
            onClick={loadData}
            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            title="Refresh Submittals"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Submittals Table */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4">Submittal Ref</th>
                <th className="py-3 px-4">Material / Equipment &amp; Manufacturer</th>
                <th className="py-3 px-4">Spec Clause, Drawing &amp; BOQ Ref</th>
                <th className="py-3 px-4">Approval Code &amp; Consultant Remarks</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    Loading Material Submittals Register...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-500">
                    No material submittals match the current filter. Click <strong>+ Submit Material</strong> to register a new submittal.
                  </td>
                </tr>
              ) : (
                filtered.map(rec => {
                  const codeBadge = rec.approval_code || rec.status || 'Submitted';
                  const badgeStyle = APPROVAL_BADGE_STYLES[codeBadge] || APPROVAL_BADGE_STYLES[rec.status] || APPROVAL_BADGE_STYLES.Submitted;
                  return (
                    <tr key={rec.id} className="hover:bg-slate-50/70 align-top transition-colors">
                      {/* 1. Ref & Rev */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-mono font-bold text-slate-900">{rec.number || rec.id?.slice(0, 8)}</div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px] font-semibold">
                            {rec.revision || 'Rev 0'}
                          </span>
                          <span className="text-[11px] text-slate-400">{rec.date_submitted || '—'}</span>
                        </div>
                        <span className="inline-block mt-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50/80 text-blue-700">
                          {rec.trade || 'MEP'}
                        </span>
                      </td>

                      {/* 2. Material & Manufacturer */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <div className="font-bold text-slate-900 text-xs leading-snug">
                          {rec.title || rec.item || 'MEP Material Submittal'}
                        </div>
                        <div className="text-[11px] text-slate-600 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span>
                            Mfr: <strong className="text-slate-800">{rec.manufacturer || 'Specified Vendor'}</strong>
                          </span>
                          {rec.model_no && (
                            <span>
                              • Model: <code className="text-[10px] bg-slate-100 px-1 py-0.5 rounded">{rec.model_no}</code>
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                          {rec.supplier && <span>Supplier: {rec.supplier}</span>}
                          {rec.country_of_origin && <span>• Origin: {rec.country_of_origin}</span>}
                          {rec.lead_time_weeks != null && <span>• Lead time: {rec.lead_time_weeks}w</span>}
                          {Number(rec.sample_submitted) === 1 && (
                            <span className="px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                              Physical Sample Provided
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 3. Spec, Drawing & BOQ Ref */}
                      <td className="py-3.5 px-4">
                        <div className="text-[11px] font-medium text-slate-700">
                          {rec.spec_section || 'Standard MEP Specification'}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {rec.drawing_ref && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono text-[10px] font-bold">
                              <Layers size={10} /> Dwg: {rec.drawing_ref}
                            </span>
                          )}
                          {rec.boq_ref && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-mono text-[10px] font-bold">
                              BOQ: {rec.boq_ref}
                            </span>
                          )}
                        </div>
                        {rec.attachment_data && (
                          <div className="mt-1.5">
                            <a
                              href={rec.attachment_data}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              <FileText size={11} /> {rec.attachment_name || 'Open Technical Data Sheet / Drawing'}
                              <ExternalLink size={10} />
                            </a>
                          </div>
                        )}
                      </td>

                      {/* 4. Approval Code & Consultant Comments */}
                      <td className="py-3.5 px-4 max-w-xs">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${badgeStyle}`}>
                          {codeBadge}
                        </span>
                        {rec.consultant_comments && (
                          <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed line-clamp-2" title={rec.consultant_comments}>
                            "{rec.consultant_comments}"
                          </p>
                        )}
                        {rec.reviewed_by && (
                          <span className="block text-[10px] text-slate-400 mt-1">
                            Reviewed by: {rec.reviewed_by} {rec.reviewed_date ? `(${rec.reviewed_date})` : ''}
                          </span>
                        )}
                      </td>

                      {/* 5. Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap space-y-1.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setReviewTarget(rec);
                              setReviewForm({
                                status: rec.status || 'Approved',
                                approval_code: rec.approval_code || 'Code A - Approved',
                                consultant_comments: rec.consultant_comments || '',
                                reviewed_by: rec.reviewed_by || user?.name || 'Ing. Christian Borg (Enser Ltd)',
                              });
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-[11px] cursor-pointer"
                          >
                            Review / Stamp
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openCopilotWithPrompt(
                                `Explain material submittal ${rec.number} (${rec.title}), its compliance with drawing ${rec.drawing_ref || 'the project drawings'} and spec ${rec.spec_section || ''}, and any consultant review conditions.`
                              )
                            }
                            className="px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                            title="Ask Copilot about this Submittal & linked Drawing"
                          >
                            <Sparkles size={11} /> Ask AI
                          </button>
                        </div>
                        {(rec.status === 'Submitted' || rec.status === 'Under Review' || rec.status === 'Revise & Resubmit' || rec.status === 'Draft') && (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleQuickReview(rec, 'Approved', 'Code A - Approved')}
                              className="px-2 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold border border-emerald-200 cursor-pointer"
                            >
                              Code A
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickReview(rec, 'Approved with Comments', 'Code B - Approved as Noted')}
                              className="px-2 py-0.5 rounded bg-teal-50 hover:bg-teal-100 text-teal-700 text-[10px] font-bold border border-teal-200 cursor-pointer"
                            >
                              Code B
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickReview(rec, 'Revise & Resubmit', 'Code C - Revise & Resubmit')}
                              className="px-2 py-0.5 rounded bg-orange-50 hover:bg-orange-100 text-orange-800 text-[10px] font-bold border border-orange-200 cursor-pointer"
                            >
                              Code C
                            </button>
                          </div>
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

      {/* Create Material Submittal Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">New Technical Submittal</span>
                <h3 className="text-lg font-bold text-slate-900">Submit Material / Equipment for Approval</h3>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmittal} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">Material / Equipment Description *</label>
                  <input
                    required
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. 600x600mm Back-Lit Modular LED Luminaires (36W, 4000K, UGR<19)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Discipline / Trade</label>
                  <select
                    value={form.trade}
                    onChange={e => setForm(f => ({ ...f, trade: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Electrical">Electrical</option>
                    <option value="HVAC">HVAC</option>
                    <option value="ELV / Data & Security">ELV / Data &amp; Security</option>
                    <option value="Fire Protection">Fire Protection</option>
                    <option value="Plumbing">Plumbing</option>
                    <option value="Containment">Containment</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Manufacturer / Brand *</label>
                  <input
                    required
                    value={form.manufacturer}
                    onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))}
                    placeholder="e.g. Schneider Electric / Daikin"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Model / Catalogue No. *</label>
                  <input
                    required
                    value={form.model_no}
                    onChange={e => setForm(f => ({ ...f, model_no: e.target.value }))}
                    placeholder="e.g. Acti9 iC60H RCBO 30mA"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Local Supplier / Agent</label>
                  <input
                    value={form.supplier}
                    onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))}
                    placeholder="e.g. ESS Ltd / Elektra Malta"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Specification Section / Clause</label>
                  <input
                    value={form.spec_section}
                    onChange={e => setForm(f => ({ ...f, spec_section: e.target.value }))}
                    placeholder="e.g. Enser Spec Sec 4.8"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Linked Drawing Sheet Ref</label>
                  <input
                    list="project-drawings-datalist"
                    value={form.drawing_ref}
                    onChange={e => setForm(f => ({ ...f, drawing_ref: e.target.value }))}
                    placeholder="e.g. 2618-L-LTG-01"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                  <datalist id="project-drawings-datalist">
                    {drawings.map(d => (
                      <option key={d.id} value={d.document_number || d.name}>
                        {d.name}
                      </option>
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Linked BOQ Item Ref</label>
                  <input
                    list="project-boq-datalist"
                    value={form.boq_ref}
                    onChange={e => setForm(f => ({ ...f, boq_ref: e.target.value }))}
                    placeholder="e.g. E-12.01"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                  <datalist id="project-boq-datalist">
                    {boqItems.slice(0, 40).map(b => (
                      <option key={b.id} value={b.item_number}>
                        {b.description}
                      </option>
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Revision</label>
                  <input
                    value={form.revision}
                    onChange={e => setForm(f => ({ ...f, revision: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Country of Origin</label>
                  <input
                    value={form.country_of_origin}
                    onChange={e => setForm(f => ({ ...f, country_of_origin: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Lead Time (Weeks)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.lead_time_weeks}
                    onChange={e => setForm(f => ({ ...f, lead_time_weeks: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(form.sample_submitted)}
                      onChange={e => setForm(f => ({ ...f, sample_submitted: e.target.checked ? 1 : 0 }))}
                    />
                    Physical Sample Included
                  </label>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Attach Technical Data Sheet / Catalogue (PDF, Word, Excel, or Image)
                </label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.xlsx,.csv,.txt,image/*"
                  onChange={handleFileChange}
                  className="w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {form.attachment_name && (
                  <p className="text-[11px] text-emerald-700 font-semibold mt-1">
                    Attached: {form.attachment_name} (Will be automatically indexed for Copilot Q&amp;A)
                  </p>
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Technical Compliance &amp; Application Notes</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Describe compliance with Enser Ltd specification clauses, ratings, IP class, and installation location..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-xs cursor-pointer"
                >
                  Submit Material Dossier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Consultant Review / Approval Code Modal */}
      {reviewTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase text-indigo-600">
                  Consultant Technical Review • {reviewTarget.number}
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">{reviewTarget.title}</h3>
              </div>
              <button onClick={() => setReviewTarget(null)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitReviewModal} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Consultant Approval Code</label>
                <select
                  value={reviewForm.approval_code}
                  onChange={e => {
                    const code = e.target.value;
                    let st = 'Approved';
                    if (code.startsWith('Code B')) st = 'Approved with Comments';
                    else if (code.startsWith('Code C')) st = 'Revise & Resubmit';
                    else if (code.startsWith('Code D')) st = 'Rejected';
                    else if (code === 'Under Review') st = 'Under Review';
                    setReviewForm(prev => ({ ...prev, approval_code: code, status: st }));
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-semibold"
                >
                  <option value="Code A - Approved">Code A — Approved (Unrestricted)</option>
                  <option value="Code B - Approved as Noted">Code B — Approved as Noted (Proceed Subject to Comments)</option>
                  <option value="Code C - Revise & Resubmit">Code C — Revise &amp; Resubmit (Do Not Proceed)</option>
                  <option value="Code D - Rejected">Code D — Rejected (Non-Compliant)</option>
                  <option value="Under Review">Under Technical Review</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Reviewing Engineer / Consultant</label>
                <input
                  value={reviewForm.reviewed_by}
                  onChange={e => setReviewForm(prev => ({ ...prev, reviewed_by: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Consultant Technical Remarks &amp; Conditions</label>
                <textarea
                  rows={3}
                  required
                  value={reviewForm.consultant_comments}
                  onChange={e => setReviewForm(prev => ({ ...prev, consultant_comments: e.target.value }))}
                  placeholder="Enter technical review comments, BS 7671 / CIBSE / Enser specification compliance notes..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setReviewTarget(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                >
                  Save Review Stamp
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
