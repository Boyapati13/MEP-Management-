/**
 * MEP FieldHub v1.5.0 — Unified React Domain Modules
 * Replaces all legacy GenericPage placeholders with full production React workspaces
 * styled in the unified Blueprint Paper (#f6f4ee) + Safety Amber (#d97706) + Slate (#0f172a) design system.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet,
  Plus,
  Upload,
  Search,
  Download,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Truck,
  ShieldAlert,
  ClipboardCheck,
  Building2,
  Users,
  History,
  DollarSign,
  Eye,
  Globe,
  Lock,
  CheckSquare,
  RefreshCw,
  X,
  ArrowUpRight,
  Layers
} from 'lucide-react';
import { api, projectsApi, procurementApi, risksApi } from '../api';
import { ProcurementProgrammeRiskView } from './ProcurementProgrammeRiskView';
import { ContractorDocUploadModal } from './ContractorDocUploadModal';

interface EnterpriseModuleProps {
  page: string;
  selectedProject: string;
  projects?: any[];
  user?: any;
  onProjectUpdated?: () => void;
}

const WORKFLOW_COLORS: Record<string, string> = {
  Draft: 'bg-stone-100 text-stone-700 border-stone-200',
  Submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  UnderReview: 'bg-amber-50 text-amber-800 border-amber-200',
  Approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Rejected: 'bg-red-50 text-red-700 border-red-200',
  Closed: 'bg-slate-100 text-slate-700 border-slate-300',
  Open: 'bg-amber-50 text-amber-800 border-amber-200',
  Pass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Fail: 'bg-red-50 text-red-700 border-red-200',
};

export const EnterpriseModulesView: React.FC<EnterpriseModuleProps> = ({
  page,
  selectedProject,
  projects = [],
  user,
  onProjectUpdated,
}) => {
  const activeProject = projects.find((p: any) => p.id === selectedProject) || null;

  switch (page) {
    case 'boq':
      return (
        <BoqAndJobCostingWorkspace
          selectedProject={selectedProject}
          activeProject={activeProject}
          onProjectUpdated={onProjectUpdated}
        />
      );
    case 'procurement':
      return <ProcurementWorkspace selectedProject={selectedProject} />;
    case 'documents':
      return (
        <DocumentsAndSetupExtractionWorkspace
          selectedProject={selectedProject}
          activeProject={activeProject}
          user={user}
          onProjectUpdated={onProjectUpdated}
        />
      );
    case 'risks':
      return <RisksAndMatrixWorkspace selectedProject={selectedProject} />;
    case 'inspections':
      return <InspectionsAndNcrsWorkspace selectedProject={selectedProject} />;
    case 'companies':
      return <CompaniesDirectoryWorkspace />;
    case 'users':
      return <UsersAndRbacWorkspace projects={projects} />;
    case 'audit':
      return <AuditTrailWorkspace selectedProject={selectedProject} />;
    case 'rfis':
    case 'submittals':
    case 'change_orders':
    default:
      return (
        <WorkflowRegisterWorkspace
          moduleKey={page}
          selectedProject={selectedProject}
          user={user}
        />
      );
  }
};

/* ============================================================================
 * 1. BOQ & BUILDERTREND 6-COLUMN JOB COSTING WORKSPACE
 * ========================================================================== */
const BoqAndJobCostingWorkspace: React.FC<{
  selectedProject: string;
  activeProject: any;
  onProjectUpdated?: () => void;
}> = ({ selectedProject, activeProject, onProjectUpdated }) => {
  const [items, setItems] = useState<any[]>([]);
  const [changeOrders, setChangeOrders] = useState<any[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [disciplineFilter, setDisciplineFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDocModal, setShowDocModal] = useState(false);
  const [uploadingBoq, setUploadingBoq] = useState(false);
  const [boqUploadMsg, setBoqUploadMsg] = useState<string | null>(null);
  const boqFileInputRef = React.useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    item_code: '',
    description: '',
    specification: '',
    discipline: 'HVAC',
    unit: 'Nos',
    quantity: 1,
    unit_rate: 0,
    completed_qty: 0,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const q = selectedProject ? `?project_id=${selectedProject}` : '';
      const [boqRes, coRes, poRes] = await Promise.all([
        api.get<any[]>(`/api/boq${q}`).catch(() => []),
        api.get<any[]>(`/api/change_orders${q}`).catch(() => []),
        api.get<any[]>(`/api/purchase_orders${q}`).catch(() => []),
      ]);
      setItems(Array.isArray(boqRes) ? boqRes : []);
      setChangeOrders(Array.isArray(coRes) ? coRes : []);
      setPurchaseOrders(Array.isArray(poRes) ? poRes : []);
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDirectBoqFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    const targetProj = selectedProject || activeProject?.id || '';
    if (!f) return;
    if (!targetProj) {
      setBoqUploadMsg('Please select a project before uploading a BOQ file.');
      return;
    }
    setUploadingBoq(true);
    setBoqUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('project_id', targetProj);
      const res = await api.post<any>('/api/boq/import', fd);
      setBoqUploadMsg(
        `Imported ${res.imported_lines ?? res.imported ?? 0} BOQ lines (${Number(res.tender_amount || 0).toLocaleString()}). ${res.skipped_invalid_quantity ? `${res.skipped_invalid_quantity} rows skipped due to missing/invalid quantities — review source file. ` : ''}Generated ${res.tasks_created ?? 0} programme tasks and ${res.material_requests_created ?? 0} material requests. ${res.requires_review ? 'Import requires review before use.' : ''}`
      );
      await loadData();
      onProjectUpdated?.();
    } catch (err: any) {
      setBoqUploadMsg(`Import error: ${err?.message || 'Failed to import BOQ file'}`);
    } finally {
      setUploadingBoq(false);
      if (boqFileInputRef.current) boqFileInputRef.current.value = '';
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    const total_amount = Number(form.quantity) * Number(form.unit_rate);
    await api.post('/api/boq', {
      project_id: selectedProject,
      ...form,
      quantity: Number(form.quantity),
      unit_rate: Number(form.unit_rate),
      total_amount,
      completed_qty: Number(form.completed_qty),
    });
    setShowAddModal(false);
    setForm({ item_code: '', description: '', specification: '', discipline: 'HVAC', unit: 'Nos', quantity: 1, unit_rate: 0, completed_qty: 0 });
    loadData();
  };

  const filtered = items.filter(it => {
    if (disciplineFilter && it.discipline !== disciplineFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        String(it.item_code || it.item_number || '').toLowerCase().includes(q) ||
        String(it.description || '').toLowerCase().includes(q) ||
        String(it.discipline || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const originalBudget = items.reduce(
    (s, i) => s + Number(i.total_amount || i.tender_amount || Number(i.quantity || 0) * Number(i.unit_rate || 0)),
    0
  ) || Number(activeProject?.budget || 0);

  const approvedVariations = changeOrders
    .filter(c => c.status === 'Approved' || c.status === 'Closed')
    .reduce((s, c) => s + Number(c.amount || c.cost_impact || 0), 0);

  const revisedBudget = originalBudget + approvedVariations;
  const committedPos = purchaseOrders.reduce((s, p) => s + Number(p.amount || p.total_amount || 0), 0);
  const actualEarned = items.reduce(
    (s, i) => s + Number(i.completed_qty || i.installed_quantity || 0) * Number(i.unit_rate || i.tender_rate || 0),
    0
  );
  const variance = revisedBudget - Math.max(committedPos, actualEarned);

  const exportCsv = () => {
    const headers = ['Item Code', 'Description', 'Discipline', 'Unit', 'Quantity', 'Unit Rate', 'Total Amount', 'Completed Qty'];
    const rows = filtered.map(i => [
      i.item_code || i.item_number || '',
      `"${String(i.description || '').replace(/"/g, '""')}"`,
      i.discipline || '',
      i.unit || '',
      i.quantity ?? i.tender_quantity ?? 0,
      i.unit_rate ?? i.tender_rate ?? 0,
      i.total_amount ?? i.tender_amount ?? 0,
      i.completed_qty ?? i.installed_quantity ?? 0,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `boq-job-costing-${selectedProject || 'all'}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
              Commercial &amp; Cost Control
            </span>
            <span className="text-xs font-mono text-slate-500">6-Column Job Costing Ledger</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">BOQ &amp; Job Costing Variance Sheet</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Track tender quantities, installed progress, approved variations, committed POs, and real-time budget variance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            ref={boqFileInputRef}
            type="file"
            accept=".xlsx,.xls,.pdf,.csv,.tsv,.docx,.txt"
            className="hidden"
            onChange={handleDirectBoqFileUpload}
          />
          <button
            type="button"
            disabled={uploadingBoq}
            onClick={() => {
              if (!selectedProject && !activeProject?.id) {
                setBoqUploadMsg('Please select a project before uploading a BOQ file.');
                return;
              }
              boqFileInputRef.current?.click();
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
          >
            <Upload size={15} />
            {uploadingBoq ? 'Importing Excel / PDF BOQ...' : 'Import BOQ (Excel .xlsx / PDF / CSV)'}
          </button>
          <button
            onClick={() => setShowDocModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
          >
            <Sparkles size={15} />
            Extract &amp; Review Contract
          </button>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-slate-700 text-xs font-semibold border border-stone-200 transition-colors cursor-pointer"
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <Plus size={15} /> Add BOQ Line
          </button>
        </div>
      </div>

      {boqUploadMsg && (
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between text-xs font-semibold ${
            boqUploadMsg.startsWith('Import error') || boqUploadMsg.includes('Please select')
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <span>{boqUploadMsg}</span>
          <button
            onClick={() => setBoqUploadMsg(null)}
            className="opacity-70 hover:opacity-100 hover:underline ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Buildertrend 6-Column Job Costing Summary Ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">1. Original Budget</p>
          <p className="text-lg font-bold font-mono text-slate-900 mt-1">${originalBudget.toLocaleString()}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">{items.length} Tender Line Items</p>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">2. Approved Variations</p>
          <p className="text-lg font-bold font-mono text-amber-700 mt-1">+${approvedVariations.toLocaleString()}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">{changeOrders.length} Change Orders</p>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">3. Revised Contract Sum</p>
          <p className="text-lg font-bold font-mono text-slate-900 mt-1">${revisedBudget.toLocaleString()}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Current Ceiling</p>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">4. Committed POs</p>
          <p className="text-lg font-bold font-mono text-blue-700 mt-1">${committedPos.toLocaleString()}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">{purchaseOrders.length} Active POs</p>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">5. Earned / Certified</p>
          <p className="text-lg font-bold font-mono text-emerald-700 mt-1">${actualEarned.toLocaleString()}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Measured Installed Value</p>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">6. Cost Variance</p>
          <p className={`text-lg font-bold font-mono mt-1 ${variance >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {variance >= 0 ? '+' : ''}${variance.toLocaleString()}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">{variance >= 0 ? 'Within Revised Budget' : 'Over Budget Alert'}</p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search BOQ item code, description, or MEP trade..."
            className="w-full pl-9 pr-4 py-2 text-xs border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <div className="flex items-center gap-2">
          {['', 'HVAC', 'Electrical', 'Plumbing', 'Fire Fighting', 'ELV'].map(d => (
            <button
              key={d}
              onClick={() => setDisciplineFilter(d)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                disciplineFilter === d
                  ? 'bg-slate-900 text-white'
                  : 'bg-stone-100 text-slate-600 hover:bg-stone-200'
              }`}
            >
              {d || 'All Trades'}
            </button>
          ))}
        </div>
      </div>

      {/* BOQ Table */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3.5 px-4">Item Code</th>
                <th className="py-3.5 px-4">BOQ Material &amp; Technical Specification</th>
                <th className="py-3.5 px-4">Discipline</th>
                <th className="py-3.5 px-4">Unit</th>
                <th className="py-3.5 px-4 text-right">Tender Qty</th>
                <th className="py-3.5 px-4 text-right">Rate ($)</th>
                <th className="py-3.5 px-4 text-right">Tender Amount ($)</th>
                <th className="py-3.5 px-4 text-right">Installed Qty</th>
                <th className="py-3.5 px-4 text-right">Earned ($)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">Loading BOQ &amp; Job Costing ledger...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    No BOQ line items found for this filter. Click <strong>Import BOQ (Excel .xlsx / PDF / CSV)</strong> or <strong>Add BOQ Line</strong>.
                  </td>
                </tr>
              ) : (
                filtered.map((item: any) => {
                  const qty = Number(item.quantity ?? item.tender_quantity ?? 0);
                  const rate = Number(item.unit_rate ?? item.tender_rate ?? 0);
                  const total = Number(item.total_amount ?? item.tender_amount ?? qty * rate);
                  const doneQty = Number(item.completed_qty ?? item.installed_quantity ?? 0);
                  const earned = doneQty * rate;
                  const pct = qty > 0 ? Math.min(100, Math.round((doneQty / qty) * 100)) : 0;
                  const specText = item.specification || item.spec || `${item.discipline || 'MEP'} — ${item.system || 'Standard Specification'}`;
                  return (
                    <tr key={item.id} className="hover:bg-stone-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                        {item.item_code || item.item_number || item.id?.slice(0, 8)}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-bold text-slate-900">{item.description}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                          Spec: {specText}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 font-semibold text-[11px]">
                          {item.discipline || 'MEP'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono">{item.unit || 'Nos'}</td>
                      <td className="py-3 px-4 text-right font-mono">{qty.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-mono">${rate.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">${total.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-mono">
                        <span className="font-semibold text-slate-800">{doneQty.toLocaleString()}</span>
                        <span className="ml-1.5 text-[10px] text-emerald-700 font-bold">({pct}%)</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-700">${earned.toLocaleString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add BOQ Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-base">Add BOQ Schedule Line</h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Item Code</label>
                <input
                  required
                  value={form.item_code}
                  onChange={e => setForm(s => ({ ...s, item_code: e.target.value }))}
                  placeholder="e.g. M-HVAC-01"
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Discipline</label>
                <select
                  value={form.discipline}
                  onChange={e => setForm(s => ({ ...s, discipline: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                >
                  <option>HVAC</option>
                  <option>Electrical</option>
                  <option>Plumbing</option>
                  <option>Fire Fighting</option>
                  <option>ELV</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Material / Description</label>
              <input
                required
                value={form.description}
                onChange={e => setForm(s => ({ ...s, description: e.target.value }))}
                placeholder="Supply & installation of Chilled Water Air Handling Unit"
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Technical Specification</label>
              <input
                value={form.specification}
                onChange={e => setForm(s => ({ ...s, specification: e.target.value }))}
                placeholder="Eurovent certified double-skin AHU, 50mm rockwool panel, IE4 fan motor"
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Unit</label>
                <input
                  value={form.unit}
                  onChange={e => setForm(s => ({ ...s, unit: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Quantity</label>
                <input
                  type="number"
                  step="any"
                  value={form.quantity}
                  onChange={e => setForm(s => ({ ...s, quantity: Number(e.target.value) }))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Unit Rate ($)</label>
                <input
                  type="number"
                  step="any"
                  value={form.unit_rate}
                  onChange={e => setForm(s => ({ ...s, unit_rate: Number(e.target.value) }))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold">
                Save BOQ Item
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Existing Project Review-Before-Update Document Extraction Modal */}
      <ContractorDocUploadModal
        open={showDocModal}
        onClose={() => setShowDocModal(false)}
        projectId={selectedProject || undefined}
        onSuccess={() => {
          loadData();
          onProjectUpdated?.();
        }}
      />
    </div>
  );
};

/* ============================================================================
 * 2. PROCUREMENT & PROGRAMME IMPACT WORKSPACE
 * ========================================================================== */
const ProcurementWorkspace: React.FC<{ selectedProject: string }> = ({ selectedProject }) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [boqItems, setBoqItems] = useState<any[]>([]);
  const [showAddPo, setShowAddPo] = useState(false);
  const [showAddMr, setShowAddMr] = useState(false);
  const [poForm, setPoForm] = useState({
    po_number: '',
    vendor: '',
    description: '',
    amount: 0,
    delivery_date: '',
    status: 'Submitted',
  });
  const [mrForm, setMrForm] = useState({
    boq_item_id: '',
    boq_reference: '',
    material: '',
    specification: '',
    discipline: 'HVAC',
    system: 'HVAC System',
    quantity: 1,
    unit: 'Set',
    required_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    supplier: 'Approved MEP Vendor',
  });

  const loadProcurement = useCallback(async () => {
    const q = selectedProject ? { project_id: selectedProject } : undefined;
    const qs = selectedProject ? `?project_id=${selectedProject}` : '';
    const [poList, mrList, boqList] = await Promise.all([
      procurementApi.listOrders(q).catch(() => []),
      procurementApi.materialRequests(q).catch(() => []),
      api.get<any[]>(`/api/boq${qs}`).catch(() => []),
    ]);
    setOrders(Array.isArray(poList) ? poList : []);
    setRequests(Array.isArray(mrList) ? mrList : []);
    setBoqItems(Array.isArray(boqList) ? boqList : []);
  }, [selectedProject]);

  useEffect(() => {
    loadProcurement();
  }, [loadProcurement]);

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    await procurementApi.createOrder({
      project_id: selectedProject,
      ...poForm,
      expected_delivery: poForm.delivery_date || undefined,
      expected_delivery_date: poForm.delivery_date || undefined,
      amount: Number(poForm.amount),
    });
    setShowAddPo(false);
    setPoForm({ po_number: '', vendor: '', description: '', amount: 0, delivery_date: '', status: 'Submitted' });
    loadProcurement();
  };

  const handleSelectBoqForMr = (boqId: string) => {
    const found = boqItems.find(b => b.id === boqId);
    if (!found) {
      setMrForm(s => ({ ...s, boq_item_id: '' }));
      return;
    }
    const specText =
      found.specification ||
      found.spec ||
      `${found.discipline || 'MEP'} — ${found.system || 'System'} | ${found.description} (BOQ #${found.item_number || '1.01'}, UOM: ${found.unit || 'Item'})`;
    setMrForm(s => ({
      ...s,
      boq_item_id: found.id,
      boq_reference: found.item_number || found.item_code || '1.01',
      material: found.description || '',
      specification: specText,
      discipline: found.discipline || 'MEP',
      system: found.system || 'MEP System',
      quantity: Number(found.tender_quantity ?? found.quantity ?? 1),
      unit: found.unit || 'Item',
    }));
  };

  const handleCreateMr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    await api.post('/api/material_requests', {
      project_id: selectedProject,
      ...mrForm,
      item: mrForm.material,
      spec: mrForm.specification,
      description: mrForm.specification,
      quantity: Number(mrForm.quantity),
    });
    setShowAddMr(false);
    loadProcurement();
  };

  const handleConvertMrToPo = async (mrId: string) => {
    try {
      await api.post(`/api/material_requests/${mrId}/create-po`, {});
      loadProcurement();
    } catch {}
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
            Supply Chain &amp; Lead-Time Control
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Procurement &amp; Material Requisitions</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            BOQ Material Requests with Technical Specifications, Purchase Orders, and schedule lead-time risk tracking.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setShowAddMr(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-sm transition-colors"
          >
            <Plus size={15} /> Request Material from BOQ
          </button>
          <button
            onClick={() => setShowAddPo(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-sm transition-colors"
          >
            <Plus size={15} /> Issue Purchase Order
          </button>
        </div>
      </div>

      {/* Programme Impact Analysis Component */}
      <ProcurementProgrammeRiskView projectId={selectedProject} />

      {/* Purchase Orders & Material Requests Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Layers size={16} className="text-blue-600" /> BOQ Material Requests &amp; Specifications ({requests.length})
            </h3>
          </div>
          <div className="divide-y divide-stone-100 max-h-[480px] overflow-y-auto">
            {requests.length === 0 ? (
              <p className="p-6 text-xs text-slate-500 text-center">
                No Material Requisitions yet. Import a BOQ or click <strong>Request Material from BOQ</strong>.
              </p>
            ) : (
              requests.map((mr: any) => {
                const matName = mr.material || mr.item || mr.title || mr.description || mr.id.slice(0, 8);
                const specText = mr.specification || mr.spec || mr.description || 'Standard MEP Technical Specification';
                const boqRef = mr.boq_reference || mr.wbs_code;
                return (
                  <div key={mr.id} className="p-4 flex items-start justify-between gap-3 text-xs hover:bg-stone-50">
                    <div className="space-y-1 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {boqRef && (
                          <span className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono text-[10px] font-bold">
                            BOQ #{boqRef}
                          </span>
                        )}
                        {mr.discipline && (
                          <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                            {mr.discipline}
                          </span>
                        )}
                        <span className="font-bold text-slate-900 text-sm">{matName}</span>
                      </div>
                      <p className="text-[11px] text-slate-600 bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 font-mono">
                        <strong className="text-slate-800">BOQ Specification:</strong> {specText}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 pt-0.5">
                        <span>
                          Qty: <strong className="font-mono text-slate-800">{Number(mr.quantity ?? 1).toLocaleString()} {mr.unit || 'Item'}</strong>
                        </span>
                        <span>• Required: <strong>{mr.required_date || mr.date_required || 'ASAP'}</strong></span>
                        {mr.supplier && <span>• Vendor: <strong>{mr.supplier}</strong></span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                        mr.status === 'Ordered'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-blue-50 text-blue-700 border-blue-200'
                      }`}>
                        {mr.status || 'Draft'}
                      </span>
                      {mr.status !== 'Ordered' && (
                        <button
                          type="button"
                          onClick={() => handleConvertMrToPo(mr.id)}
                          className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold shadow-sm transition-colors"
                        >
                          Convert to PO
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Truck size={16} className="text-amber-600" /> Purchase Orders ({orders.length})
            </h3>
          </div>
          <div className="divide-y divide-stone-100 max-h-[480px] overflow-y-auto">
            {orders.length === 0 ? (
              <p className="p-6 text-xs text-slate-500 text-center">No Purchase Orders recorded for this project.</p>
            ) : (
              orders.map((po: any) => (
                <div key={po.id} className="p-4 flex items-center justify-between text-xs hover:bg-stone-50">
                  <div>
                    <p className="font-bold text-slate-900">{po.po_number || po.title || po.id.slice(0, 8)} — {po.vendor || po.supplier}</p>
                    <p className="text-slate-500 mt-0.5">{po.description || po.items_summary || 'MEP Equipment Supply'}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-bold text-slate-900">${Number(po.amount || po.total_amount || 0).toLocaleString()}</p>
                    <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                      {po.status || 'Ordered'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showAddMr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCreateMr} className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-base">New Material Request (with BOQ Specification)</h3>
              <button type="button" onClick={() => setShowAddMr(false)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Link to BOQ Item (Auto-Fills Material &amp; Specification)</label>
              <select
                value={mrForm.boq_item_id}
                onChange={e => handleSelectBoqForMr(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
              >
                <option value="">-- Select a BOQ Item or Enter Custom Material --</option>
                {boqItems.map((b: any) => (
                  <option key={b.id} value={b.id}>
                    [{b.item_number || b.item_code}] {b.description} ({b.tender_quantity || b.quantity} {b.unit})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Material Name (BOQ Item)</label>
                <input
                  required
                  value={mrForm.material}
                  onChange={e => setMrForm(s => ({ ...s, material: e.target.value }))}
                  placeholder="Chilled Water Air Handling Unit"
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">BOQ Reference &amp; Discipline</label>
                <div className="flex gap-2">
                  <input
                    value={mrForm.boq_reference}
                    onChange={e => setMrForm(s => ({ ...s, boq_reference: e.target.value }))}
                    placeholder="1.01"
                    className="w-1/2 px-3 py-2 text-xs border border-stone-300 rounded-xl font-mono"
                  />
                  <input
                    value={mrForm.discipline}
                    onChange={e => setMrForm(s => ({ ...s, discipline: e.target.value }))}
                    placeholder="HVAC"
                    className="w-1/2 px-3 py-2 text-xs border border-stone-300 rounded-xl"
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">BOQ Technical Specification</label>
              <textarea
                required
                rows={2}
                value={mrForm.specification}
                onChange={e => setMrForm(s => ({ ...s, specification: e.target.value }))}
                placeholder="Full technical specification from BOQ / Contract schedule..."
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl font-mono"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Quantity</label>
                <input
                  type="number"
                  step="any"
                  value={mrForm.quantity}
                  onChange={e => setMrForm(s => ({ ...s, quantity: Number(e.target.value) }))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Unit</label>
                <input
                  value={mrForm.unit}
                  onChange={e => setMrForm(s => ({ ...s, unit: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Required Date</label>
                <input
                  type="date"
                  value={mrForm.required_date}
                  onChange={e => setMrForm(s => ({ ...s, required_date: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddMr(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold">
                Submit Material Request
              </button>
            </div>
          </form>
        </div>
      )}

      {showAddPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCreatePo} className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-base">Issue Purchase Order</h3>
              <button type="button" onClick={() => setShowAddPo(false)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">PO Number</label>
                <input
                  required
                  value={poForm.po_number}
                  onChange={e => setPoForm(s => ({ ...s, po_number: e.target.value }))}
                  placeholder="PO-2026-041"
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Vendor / Supplier</label>
                <input
                  required
                  value={poForm.vendor}
                  onChange={e => setPoForm(s => ({ ...s, vendor: e.target.value }))}
                  placeholder="Daikin Applied / Schneider"
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Equipment Description</label>
              <input
                required
                value={poForm.description}
                onChange={e => setFormDescription(poForm, setPoForm, e.target.value)}
                placeholder="Chillers, Main LV Switchgear, Fire Pumps"
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Order Value ($)</label>
                <input
                  type="number"
                  value={poForm.amount}
                  onChange={e => setPoForm(s => ({ ...s, amount: Number(e.target.value) }))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Target Delivery Date</label>
                <input
                  type="date"
                  value={poForm.delivery_date}
                  onChange={e => setPoForm(s => ({ ...s, delivery_date: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddPo(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold">
                Create PO
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

function setFormDescription(state: any, setter: any, description: string) {
  setter({ ...state, description });
}

/* ============================================================================
 * 3. CONTROLLED DOCUMENTS & SETUP EXTRACTION (REVIEW-BEFORE-APPLY) WORKSPACE
 * ========================================================================== */
const DocumentsAndSetupExtractionWorkspace: React.FC<{
  selectedProject: string;
  activeProject: any;
  user: any;
  onProjectUpdated?: () => void;
}> = ({ selectedProject, activeProject, user, onProjectUpdated }) => {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [setupSuggestions, setSetupSuggestions] = useState<any[] | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, any>>({});
  const [showUploadDoc, setShowUploadDoc] = useState(false);
  const [showContractorModal, setShowContractorModal] = useState(false);
  const [docForm, setDocForm] = useState({
    name: '',
    category: 'Contract',
    discipline: 'General',
    version: '1.0',
    status: 'Approved',
    client_visible: 0,
    attachment_name: '',
    attachment_data: '',
  });

  const canManage = user?.role === 'Admin' || user?.role === 'ProjectManager';

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const q = selectedProject ? `?project_id=${selectedProject}` : '';
      const list = await api.get<any[]>(`/api/documents${q}`).catch(() => []);
      setDocs(Array.isArray(list) ? list : []);
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  // Review-only extraction from stored project documents (Action 1 requirement)
  const handleRunReviewOnlyExtraction = async () => {
    if (!selectedProject) return;
    setExtracting(true);
    try {
      const res = await projectsApi.extractSetupData(selectedProject, undefined, false);
      const suggestions = res.suggestions || [];
      setSetupSuggestions(suggestions);
      const map: Record<string, any> = {};
      for (const s of suggestions) {
        map[s.field] = s.value;
      }
      setSelectedSuggestions(map);
    } catch (err: any) {
      console.error(err.message || 'Could not extract project setup suggestions from stored documents');
    } finally {
      setExtracting(false);
    }
  };

  const handleApproveSuggestions = async () => {
    if (!selectedProject) return;
    await projectsApi.update(selectedProject, selectedSuggestions);
    setSetupSuggestions(null);
    onProjectUpdated?.();
  };

  const toggleClientVisibility = async (doc: any) => {
    const currentlyVisible = doc.visibility === 'Client' || doc.visibility === 'All' || Number(doc.client_visible) === 1;
    const nextVis = currentlyVisible ? 'Internal' : 'Client';
    const nextStatus = !currentlyVisible ? 'Approved' : (doc.status || 'Approved');
    await api.put(`/api/documents/${doc.id}`, {
      visibility: nextVis,
      status: nextStatus,
    });
    loadDocs();
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setDocForm(s => ({
        ...s,
        name: s.name || f.name.replace(/\.[^.]+$/, ''),
        attachment_name: f.name,
        attachment_data: String(reader.result || ''),
      }));
    };
    reader.readAsDataURL(f);
  };

  const handleCreateDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    const created = await api.post<any>('/api/documents', {
      project_id: selectedProject,
      ...docForm,
      revision: docForm.version || '1.0',
    });
    if (docForm.client_visible && canManage && created?.id) {
      await api.put(`/api/documents/${created.id}`, {
        visibility: 'Client',
        status: 'Approved',
      }).catch(() => {});
    }
    setShowUploadDoc(false);
    setDocForm({
      name: '',
      category: 'Contract',
      discipline: 'General',
      version: '1.0',
      status: 'Approved',
      client_visible: 0,
      attachment_name: '',
      attachment_data: '',
    });
    loadDocs();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
            CDE &amp; Document Intelligence
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Controlled Documents &amp; Drawings</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Common Data Environment with Client Portal publication controls and review-first project setup extraction.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {canManage && (
            <>
              <button
                onClick={handleRunReviewOnlyExtraction}
                disabled={extracting}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-slate-800 text-xs font-bold border border-stone-300 transition-colors"
              >
                <Eye size={14} className="text-amber-600" />
                {extracting ? 'Scanning Stored Docs...' : 'Review Setup Suggestions'}
              </button>
              <button
                onClick={() => setShowContractorModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-sm transition-colors"
              >
                <Sparkles size={14} /> Upload &amp; Review Contract/BOQ
              </button>
            </>
          )}
          <button
            onClick={() => setShowUploadDoc(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors"
          >
            <Plus size={15} /> Upload Document
          </button>
        </div>
      </div>

      {/* Review-Only Setup Suggestions Approval Banner */}
      {setupSuggestions && (
        <div className="bg-amber-50/90 rounded-2xl border border-amber-300 p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-amber-950 text-sm flex items-center gap-2">
                <Sparkles size={16} className="text-amber-600" />
                Review Extracted Setup Suggestions (Review-Only — Project Not Overwritten Yet)
              </h3>
              <p className="text-xs text-amber-800 mt-0.5">
                Current Project: <strong>{activeProject?.name}</strong>. Approve the extracted fields below to apply them via <code>PUT /api/projects/{selectedProject}</code>.
              </p>
            </div>
            <button onClick={() => setSetupSuggestions(null)} className="text-amber-700 hover:text-amber-950">
              <X size={18} />
            </button>
          </div>
          {setupSuggestions.length === 0 ? (
            <p className="text-xs text-amber-900">No structured setup fields were detected in the stored documents.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {setupSuggestions.map((s: any) => (
                <div key={s.field} className="bg-white rounded-xl p-3 border border-amber-200">
                  <div className="flex items-center justify-between text-[11px] font-bold uppercase text-slate-500 mb-1">
                    <span>{s.field}</span>
                    <span className="text-emerald-700">{s.confidence} Confidence</span>
                  </div>
                  <input
                    value={selectedSuggestions[s.field] ?? ''}
                    onChange={e => setSelectedSuggestions(prev => ({ ...prev, [s.field]: e.target.value }))}
                    className="w-full px-2.5 py-1.5 text-xs font-semibold border border-stone-200 rounded-lg"
                  />
                  <p className="text-[10px] text-slate-400 mt-1 truncate" title={s.source_excerpt}>
                    Source: {s.source_document_name} ({s.source_excerpt})
                  </p>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setSetupSuggestions(null)}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-amber-100"
            >
              Discard
            </button>
            <button
              onClick={handleApproveSuggestions}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm"
            >
              <CheckSquare size={14} /> Approve &amp; Apply to Project
            </button>
          </div>
        </div>
      )}

      {/* Documents Table */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="py-3.5 px-4">Document Title</th>
              <th className="py-3.5 px-4">Category</th>
              <th className="py-3.5 px-4">Discipline</th>
              <th className="py-3.5 px-4">Revision</th>
              <th className="py-3.5 px-4">Workflow Status</th>
              <th className="py-3.5 px-4">Client Portal Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 text-xs">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-400">Loading document register...</td>
              </tr>
            ) : docs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500">No documents uploaded for this project yet.</td>
              </tr>
            ) : (
              docs.map((doc: any) => {
                const isClientVisible = doc.visibility === 'Client' || doc.visibility === 'All' || (Number(doc.client_visible) === 1 && doc.status === 'Approved');
                return (
                  <tr key={doc.id} className="hover:bg-stone-50/80">
                    <td className="py-3.5 px-4 font-semibold text-slate-900 flex items-center gap-2">
                      <FileText size={15} className="text-amber-600 flex-shrink-0" />
                      <div>
                        <p>{doc.name || doc.title}</p>
                        {doc.attachment_name && <p className="text-[10px] text-slate-400 font-mono">{doc.attachment_name}</p>}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">{doc.category || 'Technical'}</td>
                    <td className="py-3.5 px-4 text-slate-600">{doc.discipline || 'General'}</td>
                    <td className="py-3.5 px-4 font-mono text-slate-600">v{doc.version || doc.revision || '1.0'}</td>
                    <td className="py-3.5 px-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${WORKFLOW_COLORS[doc.status] || WORKFLOW_COLORS.Draft}`}>
                        {doc.status || 'Draft'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      {canManage ? (
                        <button
                          onClick={() => toggleClientVisibility(doc)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                            isClientVisible
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-stone-100 text-slate-600 border-stone-200 hover:bg-stone-200'
                          }`}
                        >
                          {isClientVisible ? <Globe size={12} /> : <Lock size={12} />}
                          {isClientVisible ? 'Published to Client' : 'Internal Only'}
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          {isClientVisible ? 'Client Visible' : 'Internal'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Upload Standard Controlled Document Modal */}
      {showUploadDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCreateDoc} className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-base">Upload Controlled Document</h3>
              <button type="button" onClick={() => setShowUploadDoc(false)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Attach File (PDF, DOCX, TXT, CSV)</label>
              <input type="file" onChange={handleFileInput} className="w-full text-xs" />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Document Title</label>
              <input
                required
                value={docForm.name}
                onChange={e => setDocForm(s => ({ ...s, name: e.target.value }))}
                placeholder="Main MEP Subcontract Agreement"
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Category</label>
                <select
                  value={docForm.category}
                  onChange={e => setDocForm(s => ({ ...s, category: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                >
                  <option>Contract</option>
                  <option>Drawing</option>
                  <option>Specification</option>
                  <option>BOQ</option>
                  <option>Method Statement</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Status</label>
                <select
                  value={docForm.status}
                  onChange={e => setDocForm(s => ({ ...s, status: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                >
                  <option value="Draft">Draft</option>
                  <option value="Submitted">Submitted</option>
                  <option value="Approved">Approved</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(docForm.client_visible)}
                onChange={e => setDocForm(s => ({ ...s, client_visible: e.target.checked ? 1 : 0 }))}
              />
              Publish to Client Portal (requires Approved status)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowUploadDoc(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold">
                Upload Document
              </button>
            </div>
          </form>
        </div>
      )}

      <ContractorDocUploadModal
        open={showContractorModal}
        onClose={() => setShowContractorModal(false)}
        projectId={selectedProject || undefined}
        onSuccess={() => {
          loadDocs();
          onProjectUpdated?.();
        }}
      />
    </div>
  );
};

/* ============================================================================
 * 4. RISKS & 5x5 MATRIX WORKSPACE
 * ========================================================================== */
const RisksAndMatrixWorkspace: React.FC<{ selectedProject: string }> = ({ selectedProject }) => {
  const [risks, setRisks] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    title: '',
    category: 'Schedule',
    probability: 3,
    impact: 4,
    mitigation_plan: '',
    status: 'Open',
  });

  const loadRisks = useCallback(async () => {
    const q = selectedProject ? { project_id: selectedProject } : undefined;
    const list = await risksApi.list(q).catch(() => []);
    setRisks(Array.isArray(list) ? list : []);
  }, [selectedProject]);

  useEffect(() => {
    loadRisks();
  }, [loadRisks]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    await risksApi.create({
      project_id: selectedProject,
      ...form,
      mitigation: form.mitigation_plan,
      probability: Number(form.probability),
      impact: Number(form.impact),
      risk_score: Number(form.probability) * Number(form.impact),
    });
    setShowAdd(false);
    setForm({ title: '', category: 'Schedule', probability: 3, impact: 4, mitigation_plan: '', status: 'Open' });
    loadRisks();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm flex items-center justify-between">
        <div>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
            5x5 Risk Governance
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Project Risk Register &amp; Heat Matrix</h1>
          <p className="text-sm text-slate-500 mt-0.5">Proactive identification and mitigation of technical, commercial, and programme risks.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold"
        >
          <Plus size={15} /> Log Risk
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="py-3.5 px-4">Risk Title</th>
              <th className="py-3.5 px-4">Category</th>
              <th className="py-3.5 px-4 text-center">Prob (1-5)</th>
              <th className="py-3.5 px-4 text-center">Impact (1-5)</th>
              <th className="py-3.5 px-4 text-center">Score</th>
              <th className="py-3.5 px-4">Mitigation Plan</th>
              <th className="py-3.5 px-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 text-xs">
            {risks.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-500">No project risks logged yet.</td>
              </tr>
            ) : (
              risks.map((r: any) => {
                const prob = Number(r.probability || 3);
                const imp = Number(r.impact || 3);
                const score = Number(r.risk_score || prob * imp);
                return (
                  <tr key={r.id} className="hover:bg-stone-50">
                    <td className="py-3.5 px-4 font-bold text-slate-900">{r.title || r.description}</td>
                    <td className="py-3.5 px-4 text-slate-600">{r.category || 'Technical'}</td>
                    <td className="py-3.5 px-4 text-center font-mono">{prob}</td>
                    <td className="py-3.5 px-4 text-center font-mono">{imp}</td>
                    <td className="py-3.5 px-4 text-center">
                      <span className={`px-2.5 py-0.5 rounded-full font-mono font-bold text-[11px] ${
                        score >= 15 ? 'bg-red-100 text-red-800' : score >= 8 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {score}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">{r.mitigation_plan || r.mitigation || '—'}</td>
                    <td className="py-3.5 px-4">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-stone-100 text-slate-700 border border-stone-200">
                        {r.status || 'Open'}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">Log New Project Risk</h3>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Risk Title</label>
              <input
                required
                value={form.title}
                onChange={e => setForm(s => ({ ...s, title: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Probability (1-5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={form.probability}
                  onChange={e => setForm(s => ({ ...s, probability: Number(e.target.value) }))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Impact (1-5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={form.impact}
                  onChange={e => setForm(s => ({ ...s, impact: Number(e.target.value) }))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Mitigation Action Plan</label>
              <textarea
                rows={3}
                value={form.mitigation_plan}
                onChange={e => setForm(s => ({ ...s, mitigation_plan: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold">Save Risk</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 5. QUALITY INSPECTIONS & NCRs WORKSPACE
 * ========================================================================== */
const InspectionsAndNcrsWorkspace: React.FC<{ selectedProject: string }> = ({ selectedProject }) => {
  const [tab, setTab] = useState<'inspections' | 'ncrs'>('inspections');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTab('inspections')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            tab === 'inspections' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-stone-200'
          }`}
        >
          WIR / Quality Inspections
        </button>
        <button
          onClick={() => setTab('ncrs')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            tab === 'ncrs' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-stone-200'
          }`}
        >
          Non-Conformance Reports (NCRs)
        </button>
      </div>
      <WorkflowRegisterWorkspace moduleKey={tab} selectedProject={selectedProject} />
    </div>
  );
};

/* ============================================================================
 * 6. WORKFLOW REGISTER WORKSPACE (RFIs, Submittals, Change Orders, Inspections, NCRs)
 * ========================================================================== */
const MODULE_META: Record<string, { title: string; subtitle: string; badge: string; primaryField: string }> = {
  rfis: {
    title: 'Technical RFIs Register',
    subtitle: 'Track Requests for Information, consultant responses, and engineering closure.',
    badge: 'Technical Engineering',
    primaryField: 'question',
  },
  submittals: {
    title: 'Material & Shop Drawing Submittals',
    subtitle: 'Manage equipment submittals, specification compliance, and consultant approval codes.',
    badge: 'Technical Submittals',
    primaryField: 'title',
  },
  change_orders: {
    title: 'Variations & Change Orders',
    subtitle: 'Commercial variation evaluation, cost impact assessment, and client sign-off workflow.',
    badge: 'Commercial Governance',
    primaryField: 'title',
  },
  inspections: {
    title: 'Work Inspection Requests (WIR)',
    subtitle: 'QA/QC field inspections, witness testing sign-off, and consultant verification.',
    badge: 'QA/QC Field Control',
    primaryField: 'title',
  },
  ncrs: {
    title: 'Non-Conformance Reports (NCRs)',
    subtitle: 'Track site quality deviations, root cause corrective actions, and closure verification.',
    badge: 'Quality Assurance',
    primaryField: 'title',
  },
};

const WorkflowRegisterWorkspace: React.FC<{
  moduleKey: string;
  selectedProject: string;
  user?: any;
}> = ({ moduleKey, selectedProject }) => {
  const meta = MODULE_META[moduleKey] || {
    title: moduleKey.toUpperCase(),
    subtitle: 'Controlled project register and workflow management.',
    badge: 'Operations Register',
    primaryField: 'title',
  };

  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({
    title: '',
    question: '',
    description: '',
    discipline: 'HVAC',
    priority: 'High',
    amount: 0,
    status: 'Draft',
  });

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const q = selectedProject ? `?project_id=${selectedProject}` : '';
      const data = await api.get<any[]>(`/api/${moduleKey}${q}`).catch(() => []);
      setRecords(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [moduleKey, selectedProject]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    await api.post(`/api/${moduleKey}`, {
      project_id: selectedProject,
      ...form,
      trade: form.discipline,
      cost_impact: Number(form.amount || 0),
      amount: Number(form.amount || 0),
    });
    setShowAdd(false);
    setForm({ title: '', question: '', description: '', discipline: 'HVAC', priority: 'High', amount: 0, status: 'Draft' });
    loadRecords();
  };

  const handleTransition = async (rec: any, nextStatus: string) => {
    try {
      await api.put(`/api/${moduleKey}/${rec.id}`, { status: nextStatus });
      loadRecords();
    } catch (err: any) {
      console.error(err.message || 'Status transition not permitted');
    }
  };

  const filtered = records.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return JSON.stringify(r).toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
            {meta.badge}
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">{meta.title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{meta.subtitle}</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-sm"
        >
          <Plus size={15} /> Create Record
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm flex items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${meta.title}...`}
            className="w-full pl-9 pr-4 py-2 text-xs border border-stone-200 rounded-xl"
          />
        </div>
        <span className="text-xs font-mono text-slate-500">{filtered.length} records</span>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="py-3.5 px-4">Ref / ID</th>
              <th className="py-3.5 px-4">Title / Subject</th>
              <th className="py-3.5 px-4">Discipline</th>
              {moduleKey === 'change_orders' && <th className="py-3.5 px-4 text-right">Amount ($)</th>}
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4 text-right">Workflow Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 text-xs">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-400">Loading register...</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-500">No records found. Click <strong>Create Record</strong> to add one.</td>
              </tr>
            ) : (
              filtered.map((rec: any) => (
                <tr key={rec.id} className="hover:bg-stone-50/80">
                  <td className="py-3.5 px-4 font-mono font-semibold text-slate-600">{rec.number || rec.code || rec.id?.slice(0, 8)}</td>
                  <td className="py-3.5 px-4 font-semibold text-slate-900">
                    {rec.title || rec.question || rec.description || 'Untitled Record'}
                  </td>
                  <td className="py-3.5 px-4 text-slate-600">{rec.discipline || rec.trade || 'MEP'}</td>
                  {moduleKey === 'change_orders' && (
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                      ${Number(rec.amount || rec.cost_impact || 0).toLocaleString()}
                    </td>
                  )}
                  <td className="py-3.5 px-4">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${WORKFLOW_COLORS[rec.status] || WORKFLOW_COLORS.Draft}`}>
                      {rec.status || 'Draft'}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right space-x-1.5">
                    {rec.status === 'Draft' && (
                      <button
                        onClick={() => handleTransition(rec, 'Submitted')}
                        className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-[11px]"
                      >
                        Submit
                      </button>
                    )}
                    {rec.status === 'Submitted' && (
                      <button
                        onClick={() => handleTransition(rec, 'UnderReview')}
                        className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold text-[11px]"
                      >
                        Start Review
                      </button>
                    )}
                    {rec.status === 'UnderReview' && (
                      <>
                        <button
                          onClick={() => handleTransition(rec, 'Approved')}
                          className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-[11px]"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleTransition(rec, 'Rejected')}
                          className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-[11px]"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {rec.status === 'Approved' && (
                      <button
                        onClick={() => handleTransition(rec, 'Closed')}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px]"
                      >
                        Close
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-stone-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">New {meta.title} Entry</h3>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Subject / Question</label>
              <input
                required
                value={form.title}
                onChange={e => setForm(s => ({ ...s, title: e.target.value, question: e.target.value, description: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Discipline</label>
                <select
                  value={form.discipline}
                  onChange={e => setForm(s => ({ ...s, discipline: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                >
                  <option>HVAC</option>
                  <option>Electrical</option>
                  <option>Plumbing</option>
                  <option>Fire Fighting</option>
                  <option>ELV</option>
                </select>
              </div>
              {moduleKey === 'change_orders' && (
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Variation Amount ($)</label>
                  <input
                    type="number"
                    value={form.amount}
                    onChange={e => setForm(s => ({ ...s, amount: Number(e.target.value) }))}
                    className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold">Save Record</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 7. COMPANIES DIRECTORY WORKSPACE
 * ========================================================================== */
const CompaniesDirectoryWorkspace: React.FC = () => {
  const [companies, setCompanies] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', company_type: 'Subcontractor', trade: 'HVAC', contact_person: '', email: '' });

  const load = useCallback(async () => {
    const res = await api.get<any[]>('/api/companies').catch(() => []);
    setCompanies(Array.isArray(res) ? res : []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/api/companies', form);
    setShowAdd(false);
    setForm({ name: '', company_type: 'Subcontractor', trade: 'HVAC', contact_person: '', email: '' });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm flex items-center justify-between">
        <div>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
            Partner Ecosystem
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Companies &amp; Subcontractor Directory</h1>
        </div>
        <button onClick={() => setShowAdd(true)} className="px-4 py-2.5 rounded-xl bg-amber-600 text-white text-xs font-bold flex items-center gap-1.5">
          <Plus size={15} /> Add Company
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {companies.map(c => (
          <div key={c.id} className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-stone-100 text-slate-700">{c.type || c.company_type || 'Subcontractor'}</span>
              <span className="text-xs font-semibold text-amber-700">{c.trade || 'MEP'}</span>
            </div>
            <h3 className="font-bold text-slate-900 text-base mt-2">{c.name}</h3>
            <p className="text-xs text-slate-500 mt-1">{c.contact_person || c.email || 'Active Partner'}</p>
          </div>
        ))}
      </div>
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCreate} className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-bold text-slate-900">Register Company</h3>
            <input
              required
              placeholder="Company Name"
              value={form.name}
              onChange={e => setForm(s => ({ ...s, name: e.target.value }))}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
            />
            <input
              placeholder="Trade (e.g. HVAC, Electrical)"
              value={form.trade}
              onChange={e => setForm(s => ({ ...s, trade: e.target.value }))}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-xl"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-xs">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 8. USERS & 8-ROLE RBAC WORKSPACE
 * ========================================================================== */
const UsersAndRbacWorkspace: React.FC<{ projects: any[] }> = ({ projects }) => {
  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    api.get<any[]>('/api/users').then(r => setUsers(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm">
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
          Identity &amp; Tenant Access Control
        </span>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Users &amp; 8-Role RBAC Matrix</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Strict role-based isolation across Admin, ProjectManager, SiteEngineer, CommercialManager, QAQC, Safety, Subcontractor, and Client portals.
        </p>
      </div>
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="py-3.5 px-4">Name</th>
              <th className="py-3.5 px-4">Username</th>
              <th className="py-3.5 px-4">Role</th>
              <th className="py-3.5 px-4">Trade / Scope</th>
              <th className="py-3.5 px-4">Assigned Projects</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 text-xs">
            {users.map((u: any) => (
              <tr key={u.id} className="hover:bg-stone-50">
                <td className="py-3.5 px-4 font-bold text-slate-900">{u.name || u.username}</td>
                <td className="py-3.5 px-4 font-mono text-slate-600">{u.username}</td>
                <td className="py-3.5 px-4">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                    {u.role}
                  </span>
                </td>
                <td className="py-3.5 px-4 text-slate-600">{u.trade || 'All Trades'}</td>
                <td className="py-3.5 px-4 text-slate-500 font-mono">
                  {Array.isArray(u.project_ids) && u.project_ids.length > 0 ? `${u.project_ids.length} Project(s)` : 'Global / Assigned'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ============================================================================
 * 9. IMMUTABLE AUDIT TRAIL WORKSPACE
 * ========================================================================== */
const AuditTrailWorkspace: React.FC<{ selectedProject: string }> = ({ selectedProject }) => {
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    const q = selectedProject ? `?project_id=${selectedProject}` : '';
    api.get<any[]>(`/api/audit_logs${q}`).then(r => setLogs(Array.isArray(r) ? r.slice(0, 100) : [])).catch(() => {});
  }, [selectedProject]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm">
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
          Compliance &amp; Forensics
        </span>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Immutable Enterprise Audit Trail</h1>
        <p className="text-sm text-slate-500 mt-0.5">Chronological ledger of all project mutations, status transitions, and security events.</p>
      </div>
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="py-3.5 px-4">Timestamp</th>
              <th className="py-3.5 px-4">Actor</th>
              <th className="py-3.5 px-4">Module</th>
              <th className="py-3.5 px-4">Action</th>
              <th className="py-3.5 px-4">Record ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 text-xs">
            {logs.map((l: any) => (
              <tr key={l.id} className="hover:bg-stone-50">
                <td className="py-3 px-4 font-mono text-slate-500">{l.timestamp || l.created_at}</td>
                <td className="py-3 px-4 font-semibold text-slate-800">{l.user_name || l.user_id}</td>
                <td className="py-3 px-4 font-mono text-amber-700">{l.module}</td>
                <td className="py-3 px-4 font-bold text-slate-900">{l.action}</td>
                <td className="py-3 px-4 font-mono text-slate-500">{l.record_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
