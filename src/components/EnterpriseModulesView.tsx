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
  Layers,
  Package,
  ShieldCheck,
  Zap,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  CalendarCheck,
  Printer,
  MapPin,
  GitBranch,
  Trash2,
  PenTool,
  Highlighter,
  Cloud,
  Square,
  Circle,
  Minus,
  Type,
  MousePointer,
  Undo2,
  Save
} from 'lucide-react';
import { api, projectsApi, procurementApi, risksApi } from '../api';
import { ProcurementProgrammeRiskView } from './ProcurementProgrammeRiskView';
import { ContractorDocUploadModal } from './ContractorDocUploadModal';
import { exportFormalDocumentPdf } from '../utils/printDocument';

interface EnterpriseModuleProps {
  page: string;
  selectedProject: string;
  projects?: any[];
  user?: any;
  onProjectUpdated?: () => void;
}

const WORKFLOW_COLORS: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-700 border-slate-200',
  'Potential Variation': 'bg-slate-100 text-slate-700 border-slate-300',
  'Under Preparation': 'bg-slate-100 text-slate-700 border-slate-300',
  Submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  UnderReview: 'bg-amber-50 text-amber-800 border-amber-200',
  'Under Review': 'bg-amber-50 text-amber-800 border-amber-200',
  'Technical Review': 'bg-amber-50 text-amber-800 border-amber-200',
  'Commercial Review': 'bg-amber-50 text-amber-800 border-amber-200',
  'Under Investigation': 'bg-amber-50 text-amber-800 border-amber-200',
  'Corrective Action': 'bg-blue-50 text-blue-700 border-blue-200',
  Verification: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Answered: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Approved with Comments': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Revise & Resubmit': 'bg-amber-50 text-amber-800 border-amber-300',
  Rectified: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  Verified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Certified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'PO Issued': 'bg-blue-50 text-blue-700 border-blue-200',
  Scheduled: 'bg-slate-100 text-slate-700 border-slate-200',
  Rejected: 'bg-red-50 text-red-700 border-red-200',
  Closed: 'bg-slate-100 text-slate-700 border-slate-300',
  Open: 'bg-amber-50 text-amber-800 border-amber-200',
  'In Progress': 'bg-blue-50 text-blue-700 border-blue-200',
  Pass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Passed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Fail: 'bg-red-50 text-red-700 border-red-200',
  Failed: 'bg-red-50 text-red-700 border-red-200',
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
    case 'inventory':
      return <InventoryWarehouseWorkspace selectedProject={selectedProject} />;
    case 'documents':
    case 'drawings':
      return (
        <DocumentsAndSetupExtractionWorkspace
          selectedProject={selectedProject}
          activeProject={activeProject}
          user={user}
          onProjectUpdated={onProjectUpdated}
          initialCategory={page === 'drawings' ? 'Drawings' : 'All'}
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
    case 'commissioning':
    case 'handover':
      return (
        <CommissioningAndHandoverWorkspace
          initialTab={page === 'handover' ? 'handover' : 'commissioning'}
          selectedProject={selectedProject}
          user={user}
        />
      );
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
  const [convertingBoq, setConvertingBoq] = useState(false);
  const [projectTasks, setProjectTasks] = useState<any[]>([]);
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

  const [inspectorItem, setInspectorItem] = useState<any | null>(null);
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [inspectorDetails, setInspectorDetails] = useState<{
    material_requests: any[];
    purchase_orders: any[];
    inspections: any[];
  }>({
    material_requests: [],
    purchase_orders: [],
    inspections: [],
  });

  const openInspector = async (item: any) => {
    setInspectorItem(item);
    setInspectorLoading(true);
    try {
      const q = selectedProject ? `?project_id=${selectedProject}` : '';
      const [mrRes, poRes, inspRes] = await Promise.all([
        procurementApi.materialRequests(selectedProject ? { project_id: selectedProject } : undefined).catch(() => []),
        procurementApi.listOrders(selectedProject ? { project_id: selectedProject } : undefined).catch(() => []),
        api.get<any[]>(`/api/inspections${q}`).catch(() => []),
      ]);

      const itemCode = String(item.item_code || item.item_number || '').trim().toLowerCase();
      const itemId = String(item.id || '').trim();

      const matchedMrs = Array.isArray(mrRes)
        ? mrRes.filter(
            (mr: any) =>
              (mr.boq_item_id && String(mr.boq_item_id) === itemId) ||
              (mr.boq_reference && String(mr.boq_reference).toLowerCase() === itemCode) ||
              (mr.discipline && item.discipline && mr.discipline === item.discipline)
          )
        : [];

      const matchedPos = Array.isArray(poRes)
        ? poRes.filter(
            (po: any) =>
              (po.boq_item_id && String(po.boq_item_id) === itemId) ||
              (po.discipline && item.discipline && po.discipline === item.discipline) ||
              (item.description && po.description && String(po.description).toLowerCase().includes(itemCode))
          )
        : [];

      const matchedInsps = Array.isArray(inspRes)
        ? inspRes.filter(
            (insp: any) =>
              (insp.discipline && item.discipline && insp.discipline === item.discipline) ||
              (insp.boq_item_id && String(insp.boq_item_id) === itemId)
          )
        : [];

      setInspectorDetails({
        material_requests: matchedMrs,
        purchase_orders: matchedPos,
        inspections: matchedInsps,
      });
    } catch {
      setInspectorDetails({ material_requests: [], purchase_orders: [], inspections: [] });
    } finally {
      setInspectorLoading(false);
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const q = selectedProject ? `?project_id=${selectedProject}` : '';
      const [boqRes, coRes, poRes, tasksRes] = await Promise.all([
        api.get<any[]>(`/api/boq${q}`).catch(() => []),
        api.get<any[]>(`/api/change_orders${q}`).catch(() => []),
        api.get<any[]>(`/api/purchase_orders${q}`).catch(() => []),
        api.get<any[]>(`/api/tasks${q}`).catch(() => []),
      ]);
      setItems(Array.isArray(boqRes) ? boqRes : []);
      setChangeOrders(Array.isArray(coRes) ? coRes : []);
      setPurchaseOrders(Array.isArray(poRes) ? poRes : []);
      setProjectTasks(Array.isArray(tasksRes) ? tasksRes : []);
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-Time SSE sync for BOQ & Job Costing
  useEffect(() => {
    const onRealtime = (e: any) => {
      const detail = e?.detail;
      if (!detail) return;
      if (['budget', 'boq_items', 'change_orders', 'purchase_orders'].includes(detail.module)) {
        loadData();
      }
    };
    window.addEventListener('mep-realtime-event', onRealtime as EventListener);
    return () => window.removeEventListener('mep-realtime-event', onRealtime as EventListener);
  }, [loadData]);

  const handleInlineBoqUpdate = async (item: any, field: 'tender_rate' | 'installed_quantity', rawVal: string) => {
    const numVal = Number(rawVal);
    if (isNaN(numVal) || numVal < 0) return;
    const qty = Number(item.quantity ?? item.tender_quantity ?? 0);
    const nextRate = field === 'tender_rate' ? numVal : Number(item.unit_rate ?? item.tender_rate ?? 0);
    const nextInstalled = field === 'installed_quantity' ? numVal : Number(item.completed_qty ?? item.installed_quantity ?? 0);
    const nextTotal = qty * nextRate;

    setItems(prev =>
      prev.map(row =>
        row.id === item.id
          ? {
              ...row,
              unit_rate: nextRate,
              tender_rate: nextRate,
              total_amount: nextTotal,
              tender_amount: nextTotal,
              completed_qty: nextInstalled,
              installed_quantity: nextInstalled,
            }
          : row
      )
    );

    try {
      await api.put(`/api/boq_items/${item.id}`, {
        tender_rate: nextRate,
        tender_amount: nextTotal,
        installed_quantity: nextInstalled,
      });
    } catch {}
  };

  const exportValuationCertificatePdf = () => {
    exportFormalDocumentPdf({
      documentType: 'Interim Payment Valuation Certificate',
      referenceCode: `IPC-${(activeProject?.code || selectedProject || 'BOV').toUpperCase().slice(0, 10)}-01`,
      title: 'Interim Valuation & BOQ Job Costing Certificate',
      subtitle: 'Measured Works Installed vs. Contract Tender Sum & Approved Variations',
      projectName: activeProject?.name || 'BOV Head Office Renovation — St Venera',
      projectCode: activeProject?.code || selectedProject,
      status: 'CERTIFIED FOR VALUATION',
      metadata: [
        { label: 'Original Contract Sum', value: `€${originalBudget.toLocaleString()}` },
        { label: 'Approved Variations', value: `€${approvedVariations.toLocaleString()}` },
        { label: 'Revised Contract Sum', value: `€${revisedBudget.toLocaleString()}` },
        { label: 'Committed PO Value', value: `€${committedPos.toLocaleString()}` },
        { label: 'Gross Installed Valuation', value: `€${actualEarned.toLocaleString()}` },
        { label: 'Net Budget Variance', value: `€${variance.toLocaleString()}` },
      ],
      columns: [
        { key: 'code', label: 'BOQ Ref' },
        { key: 'description', label: 'Work Item Description & Spec' },
        { key: 'discipline', label: 'Trade' },
        { key: 'unit', label: 'UOM', align: 'center' },
        { key: 'qty', label: 'Contract Qty', align: 'right' },
        { key: 'rate', label: 'Rate (€)', align: 'right' },
        { key: 'total', label: 'Contract Sum (€)', align: 'right' },
        { key: 'installed', label: 'Installed Qty', align: 'right' },
        { key: 'earned', label: 'Earned Value (€)', align: 'right' },
      ],
      rows: filtered.map((i: any) => {
        const q = Number(i.quantity ?? i.tender_quantity ?? 0);
        const r = Number(i.unit_rate ?? i.tender_rate ?? 0);
        const t = Number(i.total_amount ?? i.tender_amount ?? q * r);
        const d = Number(i.completed_qty ?? i.installed_quantity ?? 0);
        return {
          code: i.item_code || i.item_number || i.id?.slice(0, 8),
          description: i.description,
          discipline: i.discipline || 'MEP',
          unit: i.unit || 'Nos',
          qty: q.toLocaleString(),
          rate: r.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          total: t.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          installed: d.toLocaleString(),
          earned: (d * r).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        };
      }),
      summaryTotals: [
        { label: 'Original Contract Tender Total', value: `€${originalBudget.toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
        { label: 'Approved Variations / Change Orders', value: `€${approvedVariations.toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
        { label: 'Revised Contract Sum', value: `€${revisedBudget.toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
        { label: 'Gross Certified Valuation to Date', value: `€${actualEarned.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, highlight: true },
      ],
      notes:
        'Quantities certified above are based on joint site measurement and QA/QC inspection records verified in MEP FieldHub ERP. Subject to standard contract retention provisions.',
    });
  };

  const handleConvertBoqToTasks = async () => {
    const targetProj = selectedProject || activeProject?.id;
    if (!targetProj) {
      setBoqUploadMsg('Please select a project before converting BOQ to tasks.');
      return;
    }
    setConvertingBoq(true);
    try {
      const res = await api.post<any>(`/api/projects/${targetProj}/convert-boq-to-tasks`, {});
      setBoqUploadMsg(`✓ ${res.message || 'Successfully converted all BOQ items into individual WBS schedule tasks!'}`);
      await loadData();
      onProjectUpdated?.();
    } catch (err: any) {
      setBoqUploadMsg(`Conversion error: ${err.message || 'Failed to convert BOQ to tasks'}`);
    } finally {
      setConvertingBoq(false);
    }
  };

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
        `✓ Imported ${res.imported_lines || res.imported || 0} BOQ lines ($${Number(res.tender_amount || 0).toLocaleString()}) & generated ${res.material_requests_created || 0} Material Requests with specifications.`
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
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
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
            disabled={convertingBoq}
            onClick={handleConvertBoqToTasks}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
            title="Convert 100% of BOQ line items into individual WBS schedule tasks with drawings & work packages linked"
          >
            <Zap size={15} />
            {convertingBoq ? 'Converting BOQ to Tasks...' : '⚡ Convert BOQ to Tasks'}
          </button>
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
            {uploadingBoq ? 'Importing Excel / PDF BOQ...' : 'Import BOQ (Excel / PDF / CSV)'}
          </button>
          <button
            onClick={() => setShowDocModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
          >
            <Sparkles size={15} />
            Extract &amp; Review Contract
          </button>
          <button
            onClick={exportValuationCertificatePdf}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold transition-colors cursor-pointer"
            title="Generate formal A4 Interim Payment Valuation Certificate (PDF)"
          >
            <Printer size={14} /> Valuation Certificate (PDF)
          </button>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-200 transition-colors cursor-pointer"
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
            boqUploadMsg.startsWith('Import error') || boqUploadMsg.startsWith('Conversion error') || boqUploadMsg.includes('Please select')
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

      {/* BOQ to Tasks Integration Bar */}
      <div className="bg-gradient-to-r from-blue-50/90 via-indigo-50/90 to-emerald-50/90 rounded-2xl border border-blue-200/80 p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-sm flex-shrink-0">
            <Zap size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 text-sm">WBS Programme Execution Link</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                {projectTasks.length} / {items.length} Tasks Linked ({items.length > 0 ? Math.min(100, Math.round((projectTasks.length / items.length) * 100)) : 0}%)
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              100% of BOQ line items mapped into executable Work Packages (WP-01 to WP-08) with official Enser engineering drawings (2618 series) and field assignees.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            disabled={convertingBoq}
            onClick={handleConvertBoqToTasks}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
          >
            <Zap size={14} />
            {convertingBoq ? 'Converting...' : 'Re-sync / Convert BOQ to Tasks'}
          </button>
          <a
            href="#/tasks"
            onClick={(e) => {
              e.preventDefault();
              window.location.hash = '#/tasks';
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold border border-slate-300 shadow-sm transition-colors cursor-pointer"
          >
            <CalendarCheck size={14} className="text-blue-600" />
            View Gantt &amp; Tasks →
          </a>
        </div>
      </div>

      {/* Buildertrend 6-Column Job Costing Summary Ribbon */}
      {(() => {
        const curr = activeProject?.currency === 'EUR' ? '€' : '$';
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">1. Original Budget</p>
              <p className="text-lg font-bold font-mono text-slate-900 mt-1">{curr}{originalBudget.toLocaleString()}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{items.length} Tender Line Items</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">2. Approved Variations</p>
              <p className="text-lg font-bold font-mono text-amber-700 mt-1">+{curr}{approvedVariations.toLocaleString()}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{changeOrders.length} Change Orders</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">3. Revised Contract Sum</p>
              <p className="text-lg font-bold font-mono text-slate-900 mt-1">{curr}{revisedBudget.toLocaleString()}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Current Ceiling</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">4. Committed POs</p>
              <p className="text-lg font-bold font-mono text-blue-700 mt-1">{curr}{committedPos.toLocaleString()}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{purchaseOrders.length} Active POs</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">5. Earned / Certified</p>
              <p className="text-lg font-bold font-mono text-emerald-700 mt-1">{curr}{actualEarned.toLocaleString()}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Measured Installed Value</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">6. Cost Variance</p>
              <p className={`text-lg font-bold font-mono mt-1 ${variance >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {variance >= 0 ? '+' : ''}{curr}{variance.toLocaleString()}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">{variance >= 0 ? 'Within Revised Budget' : 'Over Budget Alert'}</p>
            </div>
          </div>
        );
      })()}

      {/* Filter & Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search BOQ item code, description, or MEP trade..."
            className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
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
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {d || 'All Trades'}
            </button>
          ))}
        </div>
      </div>

      {/* BOQ Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="py-3.5 px-4">Item Code</th>
                <th className="py-3.5 px-4">BOQ Material &amp; Technical Specification</th>
                <th className="py-3.5 px-4">Discipline</th>
                <th className="py-3.5 px-4">Unit</th>
                <th className="py-3.5 px-4 text-right">Tender Qty</th>
                <th className="py-3.5 px-4 text-right">Unit Rate</th>
                <th className="py-3.5 px-4 text-right">Tender Amount ($)</th>
                <th className="py-3.5 px-4 text-right">Installed Qty</th>
                <th className="py-3.5 px-4 text-right">Earned ($)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
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
                    <tr key={item.id} onClick={() => openInspector(item)} className="hover:bg-amber-50/60 transition-colors cursor-pointer group">
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
                      <td className="py-2 px-3 text-right font-mono" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="number"
                          step="any"
                          defaultValue={rate}
                          key={`rate-${item.id}-${rate}`}
                          onBlur={(e) => {
                            if (Number(e.target.value) !== rate) {
                              handleInlineBoqUpdate(item, 'tender_rate', e.target.value);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          title="Click to edit Tender Unit Rate inline (auto-saves on Enter or blur)"
                          className="w-24 text-right font-mono text-xs px-2 py-1 rounded border border-transparent hover:border-slate-300 focus:border-blue-600 focus:bg-white bg-transparent text-slate-900 focus:outline-none"
                        />
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">€{total.toLocaleString()}</td>
                      <td className="py-2 px-3 text-right font-mono" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <input
                            type="number"
                            step="any"
                            defaultValue={doneQty}
                            key={`done-${item.id}-${doneQty}`}
                            onBlur={(e) => {
                              if (Number(e.target.value) !== doneQty) {
                                handleInlineBoqUpdate(item, 'installed_quantity', e.target.value);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            title="Click to edit Installed Quantity inline (auto-saves on Enter or blur)"
                            className="w-20 text-right font-mono font-semibold text-xs px-2 py-1 rounded border border-slate-200 hover:border-slate-400 focus:border-blue-600 bg-slate-50/70 focus:bg-white text-slate-900 focus:outline-none"
                          />
                          <span className="text-[10px] text-emerald-700 font-bold w-9 text-right">({pct}%)</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-700">€{earned.toLocaleString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>


      {/* Buildertrend Unified Item Master Inspector Slide-Over */}
      {inspectorItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 backdrop-blur-xs p-0 sm:p-4">
          <div className="bg-white h-full sm:h-auto sm:max-h-[92vh] w-full max-w-2xl rounded-none sm:rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                    {inspectorItem.item_code || inspectorItem.item_number || 'ITEM'}
                  </span>
                  <span className="text-xs font-bold uppercase text-slate-500">
                    {inspectorItem.discipline || 'MEP'} Division
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-900 mt-1">{inspectorItem.description}</h3>
              </div>
              <button
                onClick={() => setInspectorItem(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {/* Technical Specifications */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                <p className="font-bold text-[11px] uppercase tracking-wider text-slate-500 mb-1">
                  Technical Specification
                </p>
                <p className="font-mono text-slate-800 leading-relaxed">
                  {inspectorItem.specification || inspectorItem.spec || 'Standard MEP specification section'}
                </p>
              </div>

              {/* Quantities & Financial Anatomy */}
              <div className="grid grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-[10px] text-slate-400 uppercase font-bold">Tender Qty</p>
                  <p className="text-base font-bold font-mono text-slate-900 mt-0.5">
                    {inspectorItem.quantity ?? inspectorItem.tender_quantity} {inspectorItem.unit}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-[10px] text-slate-400 uppercase font-bold">Unit Rate</p>
                  <p className="text-base font-bold font-mono text-slate-900 mt-0.5">
                    ${Number(inspectorItem.unit_rate ?? inspectorItem.tender_rate ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-[10px] text-slate-400 uppercase font-bold">Total Tender</p>
                  <p className="text-base font-bold font-mono text-slate-900 mt-0.5">
                    ${Number(inspectorItem.total_amount ?? inspectorItem.tender_amount ?? 0).toLocaleString()}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <p className="text-[10px] text-emerald-800 uppercase font-bold">Installed</p>
                  <p className="text-base font-bold font-mono text-emerald-900 mt-0.5">
                    {inspectorItem.completed_qty ?? inspectorItem.installed_quantity ?? 0} {inspectorItem.unit}
                  </p>
                </div>
              </div>

              {/* Linked Commercial Lifecycle */}
              <div className="space-y-4">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Package size={16} className="text-amber-600" />
                  Linked Material Requests &amp; Procurement
                </h4>
                {inspectorLoading ? (
                  <p className="text-slate-400 italic">Querying linked commitments...</p>
                ) : !inspectorDetails?.material_requests?.length ? (
                  <p className="text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    No Material Requests raised for this line yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {inspectorDetails.material_requests.map((mr: any) => (
                      <div key={mr.id} className="p-3 rounded-xl border border-blue-100 bg-blue-50/50 flex items-center justify-between">
                        <div>
                          <p className="font-bold text-blue-950">{mr.material || mr.item}</p>
                          <p className="text-[11px] text-blue-700 mt-0.5">
                            Qty: {mr.quantity} {mr.unit} • Status: <span className="font-semibold">{mr.status || 'Pending'}</span>
                          </p>
                        </div>
                        <span className="font-mono text-[11px] px-2.5 py-1 rounded-lg bg-blue-100 text-blue-800 font-bold">
                          {mr.pr_number || 'MR-AUTO'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Linked Purchase Orders */}
              <div className="space-y-4">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <DollarSign size={16} className="text-emerald-600" />
                  Committed Purchase Orders (POs)
                </h4>
                {inspectorLoading ? (
                  <p className="text-slate-400 italic">Querying purchase orders...</p>
                ) : !inspectorDetails?.purchase_orders?.length ? (
                  <p className="text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    No active PO issued against this line yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {inspectorDetails.purchase_orders.map((po: any) => (
                      <div key={po.id} className="p-3 rounded-xl border border-emerald-100 bg-emerald-50/50 flex items-center justify-between">
                        <div>
                          <p className="font-bold text-emerald-950">{po.po_number || 'PO'}: {po.vendor}</p>
                          <p className="text-[11px] text-emerald-700 mt-0.5">
                            Delivery: {po.expected_delivery || po.delivery_date || 'Standard'} • Status: {po.status}
                          </p>
                        </div>
                        <span className="font-mono text-sm font-bold text-emerald-900">
                          ${Number(po.amount || po.total_amount || 0).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Linked QA/QC Inspections */}
              <div className="space-y-4">
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <ShieldCheck size={16} className="text-indigo-600" />
                  Quality &amp; Testing Inspections
                </h4>
                {inspectorLoading ? (
                  <p className="text-slate-400 italic">Checking quality records...</p>
                ) : !inspectorDetails?.inspections?.length ? (
                  <p className="text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    No inspection walk recorded yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {inspectorDetails.inspections.map((insp: any) => (
                      <div key={insp.id} className="p-3 rounded-xl border border-indigo-100 bg-indigo-50/50 flex items-center justify-between">
                        <div>
                          <p className="font-bold text-indigo-950">{insp.title || insp.type}</p>
                          <p className="text-[11px] text-indigo-700 mt-0.5">
                            Result: <span className="font-bold text-emerald-700">{insp.result}</span> • Verified: {insp.verified_progress}%
                          </p>
                        </div>
                        <span className="text-[11px] px-2.5 py-1 rounded bg-indigo-100 text-indigo-800 font-semibold">
                          {insp.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
              <button
                onClick={() => setInspectorItem(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 transition-colors"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add BOQ Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-6 space-y-4">
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
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Discipline</label>
                <select
                  value={form.discipline}
                  onChange={e => setForm(s => ({ ...s, discipline: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
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
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Technical Specification</label>
              <input
                value={form.specification}
                onChange={e => setForm(s => ({ ...s, specification: e.target.value }))}
                placeholder="Eurovent certified double-skin AHU, 50mm rockwool panel, IE4 fan motor"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Unit</label>
                <input
                  value={form.unit}
                  onChange={e => setForm(s => ({ ...s, unit: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Quantity</label>
                <input
                  type="number"
                  step="any"
                  value={form.quantity}
                  onChange={e => setForm(s => ({ ...s, quantity: Number(e.target.value) }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 dark:text-slate-300 mb-1">Unit Rate</label>
                <input
                  type="number"
                  step="any"
                  value={form.unit_rate}
                  onChange={e => setForm(s => ({ ...s, unit_rate: Number(e.target.value) }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
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
  const [mrFilter, setMrFilter] = useState<'all' | 'missing' | 'received' | 'ordered'>('all');
  const [receiptTarget, setReceiptTarget] = useState<{ kind: 'mr' | 'po'; item: any } | null>(null);
  const [receiptForm, setReceiptForm] = useState({
    received_quantity: 0,
    missing_quantity: 0,
    storage_location: 'Site Store',
    delivery_note_ref: '',
    discrepancy_reason: '',
    received_date: new Date().toISOString().slice(0, 10),
  });
  const [receiptNotice, setReceiptNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
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

  useEffect(() => {
    const onRealtime = () => loadProcurement();
    window.addEventListener('mep-realtime-event', onRealtime);
    return () => window.removeEventListener('mep-realtime-event', onRealtime);
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

  const openReceiveModal = (kind: 'mr' | 'po', item: any) => {
    const orderedQty = Number(item.quantity ?? 1);
    const alreadyRec = Number(item.received_quantity ?? 0);
    const defaultRec = alreadyRec > 0 ? alreadyRec : orderedQty;
    setReceiptTarget({ kind, item });
    setReceiptForm({
      received_quantity: defaultRec,
      missing_quantity: Math.max(0, orderedQty - defaultRec),
      storage_location: item.storage_location || 'Site Store',
      delivery_note_ref: item.delivery_note_ref || '',
      discrepancy_reason: item.discrepancy_reason || '',
      received_date: new Date().toISOString().slice(0, 10),
    });
  };

  const handleSubmitReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiptTarget) return;
    try {
      const endpoint =
        receiptTarget.kind === 'mr'
          ? `/api/material_requests/${receiptTarget.item.id}/receive`
          : `/api/purchase_orders/${receiptTarget.item.id}/receive`;
      const res: any = await api.post(endpoint, {
        ...receiptForm,
        ordered_quantity: Number(receiptTarget.item.quantity ?? 1),
      });
      setReceiptTarget(null);
      setReceiptNotice({
        type: 'success',
        text: `Site receipt saved (${res?.status || 'Recorded'}): ${receiptForm.received_quantity} received, ${receiptForm.missing_quantity} missing.`,
      });
      loadProcurement();
    } catch (err: any) {
      setReceiptNotice({ type: 'error', text: err?.message || 'Failed to record site receipt.' });
    }
  };

  const missingRequestsCount = requests.filter(
    (r: any) => Number(r.missing_quantity || 0) > 0 || r.status === 'Partial / Missing' || r.status === 'Missing / Discrepancy'
  ).length;
  const receivedRequestsCount = requests.filter((r: any) => r.status === 'Received').length;
  const orderedRequestsCount = requests.filter((r: any) => r.status === 'Ordered').length;
  const filteredRequests = requests.filter((r: any) => {
    if (mrFilter === 'missing') return Number(r.missing_quantity || 0) > 0 || r.status === 'Partial / Missing' || r.status === 'Missing / Discrepancy';
    if (mrFilter === 'received') return r.status === 'Received';
    if (mrFilter === 'ordered') return r.status === 'Ordered';
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
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

      {receiptNotice && (
        <div
          className={`px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between ${
            receiptNotice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span>{receiptNotice.text}</span>
          <button onClick={() => setReceiptNotice(null)} className="text-[11px] font-bold opacity-70 hover:opacity-100 ml-4">
            Dismiss
          </button>
        </div>
      )}

      {/* Site Material Receipt & Shortage KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => setMrFilter('all')}
          className={`text-left bg-white rounded-2xl border p-4 shadow-sm transition-all ${mrFilter === 'all' ? 'border-slate-900 ring-1 ring-slate-900/10' : 'border-slate-200'}`}
        >
          <div className="text-[11px] font-bold text-slate-500 uppercase">Total Site Requisitions</div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{requests.length}</div>
        </button>
        <button
          type="button"
          onClick={() => setMrFilter('ordered')}
          className={`text-left bg-white rounded-2xl border p-4 shadow-sm transition-all ${mrFilter === 'ordered' ? 'border-blue-600 ring-1 ring-blue-600/20' : 'border-slate-200'}`}
        >
          <div className="text-[11px] font-bold text-slate-500 uppercase">Ordered / In Transit</div>
          <div className="text-2xl font-bold text-blue-600 tabular-nums mt-1">{orderedRequestsCount}</div>
        </button>
        <button
          type="button"
          onClick={() => setMrFilter('received')}
          className={`text-left bg-white rounded-2xl border p-4 shadow-sm transition-all ${mrFilter === 'received' ? 'border-emerald-600 ring-1 ring-emerald-600/20' : 'border-slate-200'}`}
        >
          <div className="text-[11px] font-bold text-slate-500 uppercase">Received on Site</div>
          <div className="text-2xl font-bold text-emerald-600 tabular-nums mt-1">{receivedRequestsCount}</div>
        </button>
        <button
          type="button"
          onClick={() => setMrFilter('missing')}
          className={`text-left bg-white rounded-2xl border p-4 shadow-sm transition-all ${mrFilter === 'missing' ? 'border-red-600 ring-1 ring-red-600/20' : 'border-slate-200'}`}
        >
          <div className="text-[11px] font-bold text-slate-500 uppercase">Missing / Shortages</div>
          <div className="text-2xl font-bold text-red-600 tabular-nums mt-1">{missingRequestsCount}</div>
        </button>
      </div>

      {/* Purchase Orders & Material Requests Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Layers size={16} className="text-blue-600" /> BOQ Material Requests &amp; Site Receipts ({filteredRequests.length})
            </h3>
            <button
              type="button"
              onClick={() =>
                exportFormalDocumentPdf({
                  documentType: 'SITE RECEIPT & SHORTAGE LOG',
                  referenceCode: `GRN-${selectedProject || 'MEP'}-${new Date().toISOString().slice(0, 10)}`,
                  title: 'Site Material Receipt & Missing Items Register',
                  subtitle: `Project: ${selectedProject || 'All Projects'} — Shortages Highlighted`,
                  projectCode: selectedProject || 'MEP',
                  status: `${missingRequestsCount} MISSING`,
                  columns: [
                    { key: 'material', label: 'Material' },
                    { key: 'boq', label: 'BOQ Ref' },
                    { key: 'ordered', label: 'Requested', align: 'right' },
                    { key: 'received', label: 'Received', align: 'right' },
                    { key: 'missing', label: 'Missing', align: 'right' },
                    { key: 'store', label: 'Location / DN' },
                    { key: 'status', label: 'Status' },
                  ],
                  rows: requests.map((r: any) => ({
                    material: r.material || r.description || r.id,
                    boq: r.boq_reference || '—',
                    ordered: `${Number(r.quantity ?? 1)} ${r.unit || ''}`,
                    received: `${Number(r.received_quantity ?? 0)} ${r.unit || ''}`,
                    missing: `${Number(r.missing_quantity ?? 0)} ${r.unit || ''}`,
                    store: `${r.storage_location || '—'}${r.delivery_note_ref ? ` (DN: ${r.delivery_note_ref})` : ''}`,
                    status: r.status || 'Draft',
                  })),
                })
              }
              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold flex items-center gap-1"
            >
              <Download size={12} /> Receipt / Missing PDF
            </button>
          </div>
          <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
            {filteredRequests.length === 0 ? (
              <p className="p-6 text-xs text-slate-500 text-center">
                No Material Requisitions matching this filter. Import a BOQ or click <strong>Request Material from BOQ</strong>.
              </p>
            ) : (
              filteredRequests.map((mr: any) => {
                const matName = mr.material || mr.item || mr.title || mr.description || mr.id.slice(0, 8);
                const specText = mr.specification || mr.spec || mr.description || 'Standard MEP Technical Specification';
                const boqRef = mr.boq_reference || mr.wbs_code;
                const recQty = Number(mr.received_quantity ?? 0);
                const missQty = Number(mr.missing_quantity ?? 0);
                const statusCls =
                  mr.status === 'Received'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : mr.status === 'Partial / Missing'
                    ? 'bg-orange-50 text-orange-700 border-orange-200'
                    : mr.status === 'Missing / Discrepancy'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : mr.status === 'Ordered'
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200';
                return (
                  <div key={mr.id} className="p-4 flex items-start justify-between gap-3 text-xs hover:bg-slate-50">
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
                      <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono">
                        <strong className="text-slate-800">BOQ Specification:</strong> {specText}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 pt-0.5">
                        <span>
                          Req: <strong className="font-mono text-slate-800">{Number(mr.quantity ?? 1).toLocaleString()} {mr.unit || 'Item'}</strong>
                        </span>
                        {(recQty > 0 || missQty > 0) && (
                          <>
                            <span className="text-emerald-700 font-semibold">
                              Received: <strong className="font-mono">{recQty.toLocaleString()}</strong>
                            </span>
                            {missQty > 0 && (
                              <span className="text-red-600 font-bold">
                                Missing: <strong className="font-mono">{missQty.toLocaleString()}</strong>
                              </span>
                            )}
                          </>
                        )}
                        {mr.storage_location && <span>• Store: <strong>{mr.storage_location}</strong></span>}
                        {mr.delivery_note_ref && <span>• DN: <strong>{mr.delivery_note_ref}</strong></span>}
                        <span>• Required: <strong>{mr.required_date || mr.date_required || 'ASAP'}</strong></span>
                        {mr.supplier && <span>• Vendor: <strong>{mr.supplier}</strong></span>}
                      </div>
                      {mr.discrepancy_reason && (
                        <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1">
                          <strong>Missing / Discrepancy Note:</strong> {mr.discrepancy_reason}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${statusCls}`}>
                        {mr.status || 'Draft'}
                      </span>
                      <button
                        type="button"
                        onClick={() => openReceiveModal('mr', mr)}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold shadow-sm transition-colors"
                      >
                        Receive / Missing
                      </button>
                      {mr.status !== 'Ordered' && mr.status !== 'Received' && (
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

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Truck size={16} className="text-amber-600" /> Purchase Orders ({orders.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
            {orders.length === 0 ? (
              <p className="p-6 text-xs text-slate-500 text-center">No Purchase Orders recorded for this project.</p>
            ) : (
              orders.map((po: any) => (
                <div key={po.id} className="p-4 flex items-center justify-between gap-3 text-xs hover:bg-slate-50">
                  <div>
                    <p className="font-bold text-slate-900">{po.po_number || po.title || po.id.slice(0, 8)} — {po.vendor || po.supplier}</p>
                    <p className="text-slate-500 mt-0.5">{po.description || po.items_summary || 'MEP Equipment Supply'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="font-mono font-bold text-slate-900">€{Number(po.amount || po.total_amount || 0).toLocaleString()}</p>
                      <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                        {po.status || 'Ordered'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openReceiveModal('po', po)}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-[10px] font-bold transition-colors"
                      title="Record Site Delivery Receipt / Missing Items"
                    >
                      Site Receipt
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        exportFormalDocumentPdf({
                          documentType: 'Official Purchase Order',
                          referenceCode: po.po_number || `PO-${po.id?.slice(0, 8).toUpperCase()}`,
                          title: `Purchase Order — ${po.vendor || po.supplier || 'Approved MEP Supplier'}`,
                          subtitle: po.description || po.items_summary || 'Supply & Delivery of MEP Plant & Materials',
                          projectCode: selectedProject,
                          status: po.status || 'ISSUED',
                          metadata: [
                            { label: 'Supplier / Vendor', value: po.vendor || po.supplier || 'Approved MEP Supplier' },
                            { label: 'PO Reference', value: po.po_number || po.id?.slice(0, 8) },
                            { label: 'Discipline', value: po.discipline || 'MEP Building Services' },
                            { label: 'Required Delivery Date', value: po.expected_delivery || po.delivery_date || 'As Per Programme' },
                            { label: 'Delivery Location', value: 'Site Stores — BOV Head Office St Venera' },
                            { label: 'Payment Terms', value: '60 Days End of Month (Subject to QA/QC Goods Receipt)' },
                          ],
                          columns: [
                            { key: 'item', label: 'Line #', align: 'center' },
                            { key: 'description', label: 'Material / Plant Description & Technical Spec' },
                            { key: 'qty', label: 'Qty', align: 'right' },
                            { key: 'uom', label: 'UOM', align: 'center' },
                            { key: 'amount', label: 'Net Amount (€)', align: 'right' },
                          ],
                          rows: [
                            {
                              item: '01',
                              description: po.description || po.items_summary || 'MEP Equipment & Material Package as per Approved Submittal',
                              qty: po.quantity || '1',
                              uom: po.unit || 'Lot',
                              amount: Number(po.amount || po.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }),
                            },
                          ],
                          summaryTotals: [
                            {
                              label: 'Total Net Order Value (Excl. VAT)',
                              value: `€${Number(po.amount || po.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
                              highlight: true,
                            },
                          ],
                          notes:
                            'All equipment and materials must be delivered with factory test certificates (FAT), O&M manuals, and delivery notes referencing this Purchase Order number.',
                          signatures: [
                            { role: 'Prepared By (Procurement)', party: 'Enser Ltd Procurement Dept' },
                            { role: 'Commercial Authorization', party: 'Commercial Manager / QS' },
                            { role: 'Vendor Acceptance', party: po.vendor || po.supplier || 'Supplier Representative' },
                          ],
                        })
                      }
                      className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors"
                      title="Print / Export Formal Purchase Order (PDF)"
                    >
                      <Printer size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showAddMr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCreateMr} className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-lg p-6 space-y-4">
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
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
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
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">BOQ Reference &amp; Discipline</label>
                <div className="flex gap-2">
                  <input
                    value={mrForm.boq_reference}
                    onChange={e => setMrForm(s => ({ ...s, boq_reference: e.target.value }))}
                    placeholder="1.01"
                    className="w-1/2 px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono"
                  />
                  <input
                    value={mrForm.discipline}
                    onChange={e => setMrForm(s => ({ ...s, discipline: e.target.value }))}
                    placeholder="HVAC"
                    className="w-1/2 px-3 py-2 text-xs border border-slate-300 rounded-xl"
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
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono"
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
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Unit</label>
                <input
                  value={mrForm.unit}
                  onChange={e => setMrForm(s => ({ ...s, unit: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Required Date</label>
                <input
                  type="date"
                  value={mrForm.required_date}
                  onChange={e => setMrForm(s => ({ ...s, required_date: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
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

      {receiptTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <form onSubmit={handleSubmitReceipt} className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Site Material Receipt &amp; Missing Report</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {receiptTarget.item.material || receiptTarget.item.description || receiptTarget.item.po_number} (Ordered:{' '}
                  <strong>{Number(receiptTarget.item.quantity ?? 1)} {receiptTarget.item.unit || 'Item'}</strong>)
                </p>
              </div>
              <button type="button" onClick={() => setReceiptTarget(null)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Received Qty on Site *</label>
                <input
                  type="number"
                  step="any"
                  min={0}
                  required
                  value={receiptForm.received_quantity}
                  onChange={e => {
                    const recVal = Number(e.target.value || 0);
                    const ordVal = Number(receiptTarget.item.quantity ?? 1);
                    setReceiptForm(s => ({
                      ...s,
                      received_quantity: recVal,
                      missing_quantity: Math.max(0, ordVal - recVal),
                    }));
                  }}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-red-600 mb-1">Missing / Short Qty</label>
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={receiptForm.missing_quantity}
                  onChange={e => setReceiptForm(s => ({ ...s, missing_quantity: Math.max(0, Number(e.target.value || 0)) }))}
                  className="w-full px-3 py-2 text-xs border border-red-300 bg-red-50/40 rounded-xl font-mono text-red-700 font-bold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Site Store / Laydown Location</label>
                <input
                  value={receiptForm.storage_location}
                  onChange={e => setReceiptForm(s => ({ ...s, storage_location: e.target.value }))}
                  placeholder="e.g. Level 2 MEP Store / Container B"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Delivery Note (DN) Ref</label>
                <input
                  value={receiptForm.delivery_note_ref}
                  onChange={e => setReceiptForm(s => ({ ...s, delivery_note_ref: e.target.value }))}
                  placeholder="e.g. DN-88412"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">
                Missing / Damaged / Discrepancy Notes {receiptForm.missing_quantity > 0 ? '(Recommended)' : '(Optional)'}
              </label>
              <textarea
                rows={2}
                value={receiptForm.discrepancy_reason}
                onChange={e => setReceiptForm(s => ({ ...s, discrepancy_reason: e.target.value }))}
                placeholder="e.g. 2 valves missing from pallet / damaged flange reported to supplier..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setReceiptTarget(null)} className="px-4 py-2 text-xs font-semibold text-slate-600">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">
                Save Site Receipt
              </button>
            </div>
          </form>
        </div>
      )}

      {showAddPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCreatePo} className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-6 space-y-4">
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
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Vendor / Supplier</label>
                <input
                  required
                  value={poForm.vendor}
                  onChange={e => setPoForm(s => ({ ...s, vendor: e.target.value }))}
                  placeholder="Daikin Applied / Schneider"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
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
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Order Value ($)</label>
                <input
                  type="number"
                  value={poForm.amount}
                  onChange={e => setPoForm(s => ({ ...s, amount: Number(e.target.value) }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Target Delivery Date</label>
                <input
                  type="date"
                  value={poForm.delivery_date}
                  onChange={e => setPoForm(s => ({ ...s, delivery_date: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
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
 * 2B. SITE INVENTORY & WAREHOUSE MANAGEMENT WORKSPACE
 * ========================================================================== */
const InventoryWarehouseWorkspace: React.FC<{ selectedProject: string }> = ({ selectedProject }) => {
  const [items, setItems] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [txTarget, setTxTarget] = useState<{ mode: 'issue' | 'return'; item: any } | null>(null);
  const [txForm, setTxForm] = useState({ quantity: 1, issued_to: '', reference_no: '', notes: '' });
  const [addForm, setAddForm] = useState({
    sku: '',
    material: '',
    category: 'MEP Material',
    unit: 'Unit',
    storage_location: 'Site Store',
    current_stock: 0,
    min_stock_level: 5,
    unit_cost: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = selectedProject && selectedProject !== 'ALL' ? `?project_id=${selectedProject}` : '';
      const [invRes, mvRes] = await Promise.all([
        api.get<any[]>(`/api/inventory${qs}`).catch(() => []),
        api.get<any[]>(`/api/inventory/movements${qs}`).catch(() => []),
      ]);
      setItems(Array.isArray(invRes) ? invRes : []);
      setMovements(Array.isArray(mvRes) ? mvRes : []);
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onRealtime = (ev: any) => {
      const tbl = ev?.detail?.module || ev?.detail?.table;
      if (!tbl || tbl === 'inventory_items' || tbl === 'stock_movements' || tbl === 'material_requests' || tbl === '*') {
        load();
      }
    };
    window.addEventListener('mep-realtime-event', onRealtime);
    return () => window.removeEventListener('mep-realtime-event', onRealtime);
  }, [load]);

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetProject = selectedProject && selectedProject !== 'ALL' ? selectedProject : 'bov-st-venera-2618';
    try {
      await api.post('/api/inventory', { ...addForm, project_id: targetProject });
      setShowAdd(false);
      setAddForm({ sku: '', material: '', category: 'MEP Material', unit: 'Unit', storage_location: 'Site Store', current_stock: 0, min_stock_level: 5, unit_cost: 0 });
      setNotice({ type: 'success', text: 'Store item added to inventory ledger.' });
      load();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Failed to add inventory item.' });
    }
  };

  const handleStockTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!txTarget) return;
    try {
      const endpoint = `/api/inventory/${txTarget.item.id}/${txTarget.mode}`;
      await api.post(endpoint, txForm);
      setNotice({
        type: 'success',
        text: `${txTarget.mode === 'issue' ? 'Issued' : 'Returned'} ${txForm.quantity} ${txTarget.item.unit} of ${txTarget.item.material}.`,
      });
      setTxTarget(null);
      setTxForm({ quantity: 1, issued_to: '', reference_no: '', notes: '' });
      load();
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Stock movement failed.' });
    }
  };

  const totalUnits = items.reduce((s, r) => s + Number(r.current_stock || 0), 0);
  const lowStockCount = items.filter(r => r.low_stock || Number(r.current_stock || 0) <= Number(r.min_stock_level || 0)).length;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
            Site Stores &amp; Warehouse Control
          </span>
          <h2 className="text-xl font-bold text-slate-900 mt-1">Site Inventory &amp; Stock Movements</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Auto-stocked from Site Material Receipts (GRN), Material Issue Notes (MIN) to crews, returns, and low-stock alerts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              exportFormalDocumentPdf({
                documentType: 'SITE INVENTORY LEDGER',
                referenceCode: `INV-${selectedProject && selectedProject !== 'ALL' ? selectedProject : 'MEP'}-${new Date().toISOString().slice(0, 10)}`,
                title: 'Site Warehouse & Stock Balance Register',
                subtitle: `Project: ${selectedProject && selectedProject !== 'ALL' ? selectedProject : 'All Projects'}`,
                projectCode: selectedProject && selectedProject !== 'ALL' ? selectedProject : 'MEP',
                status: `${lowStockCount} LOW STOCK`,
                columns: [
                  { key: 'sku', label: 'SKU' },
                  { key: 'material', label: 'Material' },
                  { key: 'location', label: 'Store Location' },
                  { key: 'stock', label: 'On Hand', align: 'right' },
                  { key: 'min', label: 'Min Level', align: 'right' },
                  { key: 'status', label: 'Status' },
                ],
                rows: items.map(i => ({
                  sku: i.sku || '—',
                  material: i.material,
                  location: i.storage_location || 'Site Store',
                  stock: `${Number(i.current_stock || 0)} ${i.unit || ''}`,
                  min: `${Number(i.min_stock_level || 0)} ${i.unit || ''}`,
                  status: Number(i.current_stock || 0) <= Number(i.min_stock_level || 0) ? 'LOW STOCK' : 'OK',
                })),
              })
            }
            className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Stock Ledger PDF
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Add Store Item
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between ${
            notice.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-[11px] font-bold opacity-70 hover:opacity-100 ml-4">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="text-[11px] font-bold text-slate-500 uppercase">Catalog SKUs</div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{items.length}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="text-[11px] font-bold text-slate-500 uppercase">Total Units On Hand</div>
          <div className="text-2xl font-bold text-blue-600 tabular-nums mt-1">{totalUnits.toLocaleString()}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="text-[11px] font-bold text-slate-500 uppercase">Low-Stock Alerts</div>
          <div className="text-2xl font-bold text-red-600 tabular-nums mt-1">{lowStockCount}</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <div className="text-[11px] font-bold text-slate-500 uppercase">Stock Movements</div>
          <div className="text-2xl font-bold text-emerald-600 tabular-nums mt-1">{movements.length}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
          <div className="px-5 py-4 border-b border-slate-200 font-bold text-slate-900 text-sm">
            Site Store Stock Register
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
                <th className="py-3 px-4">SKU / Material</th>
                <th className="py-3 px-4">Location</th>
                <th className="py-3 px-4 text-right">On Hand</th>
                <th className="py-3 px-4 text-right">Min</th>
                <th className="py-3 px-4 text-right">Store Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {loading && items.length === 0 ? (
                <tr><td colSpan={5} className="py-10 text-center text-slate-400">Loading site inventory...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={5} className="py-10 text-center text-slate-400">No inventory items yet. Receive materials on site or click Add Store Item.</td></tr>
              ) : (
                items.map(item => {
                  const isLow = Number(item.current_stock || 0) <= Number(item.min_stock_level || 0);
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{item.material}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{item.sku} · {item.category}</div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">{item.storage_location || 'Site Store'}</td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold">
                        <span className={isLow ? 'text-red-600' : 'text-slate-900'}>
                          {Number(item.current_stock || 0).toLocaleString()} {item.unit}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-slate-500">{Number(item.min_stock_level || 0)}</td>
                      <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => { setTxTarget({ mode: 'issue', item }); setTxForm({ quantity: 1, issued_to: '', reference_no: '', notes: '' }); }}
                          className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold text-[11px]"
                        >
                          Issue to Site
                        </button>
                        <button
                          type="button"
                          onClick={() => { setTxTarget({ mode: 'return', item }); setTxForm({ quantity: 1, issued_to: '', reference_no: '', notes: '' }); }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-[11px]"
                        >
                          Return
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 font-bold text-slate-900 text-sm">
            Recent Stock Movements ({movements.length})
          </div>
          <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
            {movements.length === 0 ? (
              <p className="p-6 text-xs text-slate-400 text-center">No stock movements recorded yet.</p>
            ) : (
              movements.map((mv: any) => (
                <div key={mv.id} className="p-3.5 text-xs flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{mv.material}</div>
                    <div className="text-[11px] text-slate-500">
                      {mv.issued_to ? `To: ${mv.issued_to}` : mv.notes || mv.reference_no || mv.created_by}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      mv.movement_type === 'OUT_ISSUE'
                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}>
                      {mv.movement_type === 'OUT_ISSUE' ? `-${mv.quantity}` : `+${mv.quantity}`} {mv.unit}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <form onSubmit={handleAddItem} className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">Add Store Inventory Item</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Material Name *</label>
                <input required value={addForm.material} onChange={e => setAddForm(s => ({ ...s, material: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">SKU / Code</label>
                <input value={addForm.sku} onChange={e => setAddForm(s => ({ ...s, sku: e.target.value }))} placeholder="Auto-generated if blank" className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Initial Stock</label>
                <input type="number" min={0} step="any" value={addForm.current_stock} onChange={e => setAddForm(s => ({ ...s, current_stock: Number(e.target.value || 0) }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Min Reorder Level</label>
                <input type="number" min={0} step="any" value={addForm.min_stock_level} onChange={e => setAddForm(s => ({ ...s, min_stock_level: Number(e.target.value || 0) }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Unit</label>
                <input value={addForm.unit} onChange={e => setAddForm(s => ({ ...s, unit: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Store Location</label>
                <input value={addForm.storage_location} onChange={e => setAddForm(s => ({ ...s, storage_location: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold">Save Store Item</button>
            </div>
          </form>
        </div>
      )}

      {txTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <form onSubmit={handleStockTx} className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">
              {txTarget.mode === 'issue' ? 'Issue Material to Site Crew' : 'Return Unused Material to Store'}
            </h3>
            <p className="text-xs text-slate-500">
              {txTarget.item.material} (Available: <strong>{txTarget.item.current_stock} {txTarget.item.unit}</strong>)
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Quantity *</label>
                <input type="number" min={0.01} step="any" required value={txForm.quantity} onChange={e => setTxForm(s => ({ ...s, quantity: Number(e.target.value || 0) }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl font-mono" />
              </div>
              {txTarget.mode === 'issue' && (
                <div>
                  <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Issued To (Crew / Subcontractor / Zone)</label>
                  <input value={txForm.issued_to} onChange={e => setTxForm(s => ({ ...s, issued_to: e.target.value }))} placeholder="e.g. HVAC Crew B / Level 3" className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" />
                </div>
              )}
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-600 mb-1">Reference / Notes</label>
                <input value={txForm.notes} onChange={e => setTxForm(s => ({ ...s, notes: e.target.value }))} placeholder="MIN ref or work package" className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setTxTarget(null)} className="px-4 py-2 text-xs font-semibold text-slate-600">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">
                {txTarget.mode === 'issue' ? 'Confirm Issue' : 'Confirm Return'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 3. CONTROLLED DOCUMENTS & SETUP EXTRACTION (REVIEW-BEFORE-APPLY) WORKSPACE
 * ========================================================================== */
const DocumentsAndSetupExtractionWorkspace: React.FC<{
  selectedProject: string;
  activeProject: any;
  user: any;
  onProjectUpdated?: () => void;
  initialCategory?: string;
}> = ({ selectedProject, activeProject, user, onProjectUpdated, initialCategory = 'All' }) => {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [setupSuggestions, setSetupSuggestions] = useState<any[] | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, any>>({});
  const [showUploadDoc, setShowUploadDoc] = useState(false);
  const [showContractorModal, setShowContractorModal] = useState(false);
  const [selectedDrawing, setSelectedDrawing] = useState<any | null>(null);
  const [drawingZoom, setDrawingZoom] = useState(1);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>(initialCategory);

  useEffect(() => {
    setActiveCategoryFilter(initialCategory);
  }, [initialCategory]);
  const [linkedTasks, setLinkedTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [docSearch, setDocSearch] = useState('');
  const [docForm, setDocForm] = useState({
    name: '',
    document_number: '',
    category: 'Drawing',
    discipline: 'Electrical',
    version: 'Rev A',
    status: 'Approved',
    client_visible: 1,
    attachment_name: '',
    attachment_data: '',
  });
  const [batchFiles, setBatchFiles] = useState<Array<{
    name: string;
    document_number: string;
    attachment_name: string;
    attachment_data: string;
    discipline: string;
  }>>([]);
  const [uploadingDocs, setUploadingDocs] = useState(false);

  // Drawing Version & Site Markings State
  const [drawingRevisions, setDrawingRevisions] = useState<any[]>([]);
  const [drawingMarkings, setDrawingMarkings] = useState<any[]>([]);
  const [placingMarkingMode, setPlacingMarkingMode] = useState(false);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [pendingPinCoords, setPendingPinCoords] = useState<{ x: number; y: number } | null>(null);
  const [markingForm, setMarkingForm] = useState({
    marking_type: 'Site Progress / Installed',
    title: '',
    description: '',
    trade: 'Electrical',
    status: 'Installed / Verified',
    progress_percent: 100,
  });
  const [savingMarking, setSavingMarking] = useState(false);

  // Freehand Pen & Vector Markup Shapes Studio State
  const [markupTool, setMarkupTool] = useState<'select' | 'pen' | 'highlighter' | 'cloud' | 'rect' | 'ellipse' | 'arrow' | 'line' | 'text' | 'pin'>('select');
  const [markupColor, setMarkupColor] = useState<string>('#ef4444');
  const [markupStrokeWidth, setMarkupStrokeWidth] = useState<number>(3);
  const [markupShapes, setMarkupShapes] = useState<any[]>([]);
  const [draftShape, setDraftShape] = useState<any | null>(null);
  const [isDrawingStroke, setIsDrawingStroke] = useState(false);
  const [showMarkupLayer, setShowMarkupLayer] = useState(true);
  const [savingShapes, setSavingShapes] = useState(false);
  const [shapesSavedFeedback, setShapesSavedFeedback] = useState(false);
  const [pendingTextCoords, setPendingTextCoords] = useState<{ x: number; y: number } | null>(null);
  const [pendingTextValue, setPendingTextValue] = useState('');

  const [versionTargetDoc, setVersionTargetDoc] = useState<any | null>(null);
  const [versionForm, setVersionForm] = useState({
    new_revision: 'Rev 1',
    change_summary: '',
    status: 'Approved',
    carry_over_markings: true,
    attachment_name: '',
    attachment_data: '',
  });
  const [uploadingVersion, setUploadingVersion] = useState(false);

  const canManage = user?.role === 'Admin' || user?.role === 'ProjectManager';

  useEffect(() => {
    const onOpenUpload = () => {
      setBatchFiles([]);
      setShowUploadDoc(true);
    };
    window.addEventListener('open-upload-document', onOpenUpload);
    return () => window.removeEventListener('open-upload-document', onOpenUpload);
  }, []);

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

  useEffect(() => {
    const onRealtime = () => loadDocs();
    window.addEventListener('mep-realtime-event', onRealtime);
    return () => window.removeEventListener('mep-realtime-event', onRealtime);
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

  const inferDisciplineFromSheet = (sheetCode: string, fileName: string, fallback: string) => {
    const upper = `${sheetCode} ${fileName}`.toUpperCase();
    if (upper.includes('-ACO-') || upper.includes('-VEN-') || upper.includes('HVAC') || upper.includes('VENT')) return 'HVAC';
    if (upper.includes('-FAS-') || upper.includes('FIRE')) return 'Fire';
    if (upper.includes('-DTA-') || upper.includes('-SEC-') || upper.includes('-CTV-') || upper.includes('ELV')) return 'ELV / Data & Security';
    if (upper.includes('-ELE-') || upper.includes('-LTG-') || upper.includes('-PWR-') || upper.includes('-CON-') || upper.includes('-DB-')) return 'Electrical';
    return fallback || 'Electrical';
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files: File[] = Array.from(e.target.files || []);
    if (!files.length) return;

    const readOne = (f: File) =>
      new Promise<{
        name: string;
        document_number: string;
        attachment_name: string;
        attachment_data: string;
        discipline: string;
      }>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const baseName = f.name.replace(/\.[^.]+$/, '');
          const codeMatch = baseName.match(/(2618-[A-Z0-9-]+|[A-Z]{2,4}-[A-Z0-9-]+)/i);
          const docNum = codeMatch ? codeMatch[1].toUpperCase() : baseName.slice(0, 24).toUpperCase();
          resolve({
            name: baseName,
            document_number: docNum,
            attachment_name: f.name,
            attachment_data: String(reader.result || ''),
            discipline: inferDisciplineFromSheet(docNum, baseName, docForm.discipline),
          });
        };
        reader.readAsDataURL(f);
      });

    const loaded = await Promise.all(files.map(readOne));
    if (loaded.length === 1) {
      const first = loaded[0];
      setBatchFiles([]);
      setDocForm(s => ({
        ...s,
        name: s.name || first.name,
        document_number: s.document_number || first.document_number,
        discipline: first.discipline,
        attachment_name: first.attachment_name,
        attachment_data: first.attachment_data,
      }));
    } else {
      setBatchFiles(loaded);
      setDocForm(s => ({
        ...s,
        name: `${loaded.length} Engineering Drawings Selected`,
        document_number: loaded[0].document_number,
        attachment_name: `${loaded.length} files`,
        attachment_data: loaded[0].attachment_data,
      }));
    }
  };

  const handleCreateDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    setUploadingDocs(true);
    try {
      const itemsToCreate =
        batchFiles.length > 0
          ? batchFiles.map(bf => ({
              name: bf.name,
              document_number: bf.document_number,
              category: docForm.category || 'Drawing',
              discipline: bf.discipline || docForm.discipline || 'Electrical',
              revision: docForm.version || 'Rev A',
              status: docForm.status || 'Approved',
              attachment_name: bf.attachment_name,
              attachment_data: bf.attachment_data,
            }))
          : [
              {
                name: docForm.name,
                document_number: docForm.document_number || undefined,
                category: docForm.category,
                discipline: docForm.discipline,
                revision: docForm.version || 'Rev A',
                status: docForm.status,
                attachment_name: docForm.attachment_name,
                attachment_data: docForm.attachment_data,
              },
            ];

      for (const item of itemsToCreate) {
        // Check if an existing sheet with the same document_number exists so re-uploading updates it cleanly
        const existingSheet =
          item.document_number &&
          docs.find((d: any) => d.document_number && d.document_number.toUpperCase() === item.document_number.toUpperCase());

        if (existingSheet?.id) {
          await api.put(`/api/documents/${existingSheet.id}`, {
            ...item,
            visibility: docForm.client_visible ? 'Client' : existingSheet.visibility || 'Internal',
          });
        } else {
          const created = await api.post<any>('/api/documents', {
            project_id: selectedProject,
            ...item,
          });
          if (docForm.client_visible && canManage && created?.id) {
            await api.put(`/api/documents/${created.id}`, {
              visibility: 'Client',
              status: 'Approved',
            }).catch(() => {});
          }
        }
      }

      setShowUploadDoc(false);
      setBatchFiles([]);
      setDocForm({
        name: '',
        document_number: '',
        category: 'Drawing',
        discipline: 'Electrical',
        version: 'Rev A',
        status: 'Approved',
        client_visible: 1,
        attachment_name: '',
        attachment_data: '',
      });
      loadDocs();
    } finally {
      setUploadingDocs(false);
    }
  };

  const computeNextRevision = (currentRev?: string) => {
    const rev = (currentRev || 'Rev 0').trim();
    const numMatch = rev.match(/(\d+)$/);
    if (numMatch) {
      const nextNum = parseInt(numMatch[1], 10) + 1;
      return rev.replace(/(\d+)$/, String(nextNum));
    }
    if (/^Rev\s*([A-Y])$/i.test(rev)) {
      const letter = rev.slice(-1).toUpperCase();
      return `Rev ${String.fromCharCode(letter.charCodeAt(0) + 1)}`;
    }
    return 'Rev 1';
  };

  const openDrawingViewer = async (doc: any) => {
    setSelectedDrawing(doc);
    setDrawingZoom(1);
    setPlacingMarkingMode(false);
    setMarkupTool('select');
    setPendingPinCoords(null);
    setPendingTextCoords(null);
    setActivePinId(null);
    setDraftShape(null);
    setIsDrawingStroke(false);
    setLoadingTasks(true);
    try {
      const q = selectedProject ? `?project_id=${selectedProject}` : '';
      const [allTasks, revData] = await Promise.all([
        api.get<any[]>(`/api/tasks${q}`).catch(() => []),
        api.get<any>(`/api/documents/${doc.id}/revisions`).catch(() => ({ revisions: [], markings: [], shapes: [] })),
      ]);
      if (revData?.document) {
        setSelectedDrawing(revData.document);
      }
      setDrawingRevisions(Array.isArray(revData?.revisions) ? revData.revisions : []);
      setDrawingMarkings(Array.isArray(revData?.markings) ? revData.markings : []);
      if (Array.isArray(revData?.shapes)) {
        setMarkupShapes(revData.shapes);
      } else {
        const meta = getDrawingMeta(revData?.document || doc);
        setMarkupShapes(Array.isArray(meta?.shapes) ? meta.shapes : []);
      }

      const docNum = doc.document_number || (doc.name ? (doc.name.match(/2618-[A-Z]-[A-Z]{3}-\d{2}/) || [])[0] : '');
      const matched = Array.isArray(allTasks)
        ? allTasks.filter((t: any) => t.drawing_ref === docNum || (docNum && (t.title?.includes(docNum) || t.description?.includes(docNum))))
        : [];
      setLinkedTasks(matched);
    } catch {
      setLinkedTasks([]);
    } finally {
      setLoadingTasks(false);
    }
  };

  const persistShapesToServer = async (nextShapes: any[], docId?: string) => {
    const targetId = docId || selectedDrawing?.id;
    if (!targetId) return;
    setSavingShapes(true);
    try {
      const res = await api.put<any>(`/api/documents/${targetId}/markup-shapes`, { shapes: nextShapes });
      if (res?.document && selectedDrawing?.id === targetId) {
        setSelectedDrawing(res.document);
      }
      setShapesSavedFeedback(true);
      setTimeout(() => setShapesSavedFeedback(false), 2200);
    } catch {
      // silent fallback
    } finally {
      setSavingShapes(false);
    }
  };

  const getRelativePercentCoords = (e: React.MouseEvent<HTMLElement | SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(1, Math.min(99, Number((((e.clientX - rect.left) / rect.width) * 100).toFixed(2))));
    const y = Math.max(1, Math.min(99, Number((((e.clientY - rect.top) / rect.height) * 100).toFixed(2))));
    return { x, y };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedDrawing) return;
    if (placingMarkingMode || markupTool === 'pin') {
      const { x, y } = getRelativePercentCoords(e);
      setPendingPinCoords({ x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) });
      setMarkingForm({
        marking_type: 'Site Progress / Installed',
        title: '',
        description: '',
        trade: selectedDrawing.discipline || 'Electrical',
        status: 'Installed / Verified',
        progress_percent: 100,
      });
      return;
    }

    if (markupTool === 'text') {
      const { x, y } = getRelativePercentCoords(e);
      setPendingTextCoords({ x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) });
      setPendingTextValue('');
      return;
    }

    if (markupTool === 'select') return;

    e.preventDefault();
    const { x, y } = getRelativePercentCoords(e);
    setIsDrawingStroke(true);

    if (markupTool === 'pen' || markupTool === 'highlighter') {
      setDraftShape({
        id: `shp-${Date.now()}`,
        type: markupTool,
        color: markupColor,
        strokeWidth: markupTool === 'highlighter' ? Math.max(8, markupStrokeWidth * 3) : markupStrokeWidth,
        points: [{ x, y }],
        author: user?.name || user?.username || 'Engineer',
      });
    } else {
      setDraftShape({
        id: `shp-${Date.now()}`,
        type: markupTool,
        color: markupColor,
        strokeWidth: markupStrokeWidth,
        x1: x,
        y1: y,
        x2: x + 0.5,
        y2: y + 0.5,
        author: user?.name || user?.username || 'Engineer',
      });
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawingStroke || !draftShape) return;
    const { x, y } = getRelativePercentCoords(e);
    if (draftShape.type === 'pen' || draftShape.type === 'highlighter') {
      setDraftShape((prev: any) => (prev ? { ...prev, points: [...(prev.points || []), { x, y }] } : null));
    } else {
      setDraftShape((prev: any) => (prev ? { ...prev, x2: x, y2: y } : null));
    }
  };

  const handleCanvasMouseUp = () => {
    if (!isDrawingStroke || !draftShape) return;
    setIsDrawingStroke(false);

    // Ensure minimal size so accidental 0-px clicks don't create invisible shapes
    if (draftShape.type !== 'pen' && draftShape.type !== 'highlighter') {
      const dx = Math.abs((draftShape.x2 ?? 0) - (draftShape.x1 ?? 0));
      const dy = Math.abs((draftShape.y2 ?? 0) - (draftShape.y1 ?? 0));
      if (dx < 1 && dy < 1) {
        // Default a click with a shape tool into a clean visible stamp (8% x 6%) so single clicks also work!
        draftShape.x2 = Math.min(96, (draftShape.x1 ?? 50) + 9);
        draftShape.y2 = Math.min(96, (draftShape.y1 ?? 50) + 6);
      }
    }

    const updated = [...markupShapes, draftShape];
    setMarkupShapes(updated);
    setDraftShape(null);
    persistShapesToServer(updated);
  };

  const handleConfirmTextShape = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingTextCoords || !pendingTextValue.trim()) {
      setPendingTextCoords(null);
      return;
    }
    const newTextShape = {
      id: `shp-txt-${Date.now()}`,
      type: 'text',
      color: markupColor,
      strokeWidth: markupStrokeWidth,
      x1: pendingTextCoords.x,
      y1: pendingTextCoords.y,
      text: pendingTextValue.trim(),
      author: user?.name || user?.username || 'Engineer',
    };
    const updated = [...markupShapes, newTextShape];
    setMarkupShapes(updated);
    setPendingTextCoords(null);
    setPendingTextValue('');
    persistShapesToServer(updated);
  };

  const handleUndoShape = () => {
    if (markupShapes.length === 0) return;
    const updated = markupShapes.slice(0, -1);
    setMarkupShapes(updated);
    persistShapesToServer(updated);
  };

  const handleClearShapes = () => {
    setMarkupShapes([]);
    persistShapesToServer([]);
  };

  const handleDeleteSingleShape = (shapeId: string) => {
    const updated = markupShapes.filter(s => s.id !== shapeId);
    setMarkupShapes(updated);
    persistShapesToServer(updated);
  };

  // Build scalloped SVG path for a Revision Cloud in 0..1000 SVG coordinate space
  const buildRevisionCloudPath = (x1Pct: number, y1Pct: number, x2Pct: number, y2Pct: number) => {
    const minX = Math.min(x1Pct, x2Pct) * 10;
    const maxX = Math.max(x1Pct, x2Pct) * 10;
    const minY = Math.min(y1Pct, y2Pct) * 10;
    const maxY = Math.max(y1Pct, y2Pct) * 10;
    const w = Math.max(20, maxX - minX);
    const h = Math.max(20, maxY - minY);
    const step = 22;
    const nx = Math.max(2, Math.round(w / step));
    const ny = Math.max(2, Math.round(h / step));
    const dx = w / nx;
    const dy = h / ny;
    const rx = dx * 0.65;
    const ry = dy * 0.65;

    let d = `M ${minX.toFixed(1)} ${minY.toFixed(1)}`;
    for (let i = 1; i <= nx; i++) {
      d += ` A ${rx.toFixed(1)} ${rx.toFixed(1)} 0 0 1 ${(minX + i * dx).toFixed(1)} ${minY.toFixed(1)}`;
    }
    for (let i = 1; i <= ny; i++) {
      d += ` A ${ry.toFixed(1)} ${ry.toFixed(1)} 0 0 1 ${maxX.toFixed(1)} ${(minY + i * dy).toFixed(1)}`;
    }
    for (let i = nx - 1; i >= 0; i--) {
      d += ` A ${rx.toFixed(1)} ${rx.toFixed(1)} 0 0 1 ${(minX + i * dx).toFixed(1)} ${maxY.toFixed(1)}`;
    }
    for (let i = ny - 1; i >= 0; i--) {
      d += ` A ${ry.toFixed(1)} ${ry.toFixed(1)} 0 0 1 ${minX.toFixed(1)} ${(minY + i * dy).toFixed(1)}`;
    }
    return d + ' Z';
  };

  const openNewVersionModal = (doc: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setVersionTargetDoc(doc);
    setVersionForm({
      new_revision: computeNextRevision(doc.revision || doc.version || 'Rev 0'),
      change_summary: '',
      status: doc.status || 'Approved',
      carry_over_markings: true,
      attachment_name: '',
      attachment_data: '',
    });
  };

  const handleVersionFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setVersionForm(prev => ({
        ...prev,
        attachment_name: file.name,
        attachment_data: String(reader.result || ''),
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleUploadNewVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!versionTargetDoc) return;
    setUploadingVersion(true);
    try {
      const res = await api.post<any>(`/api/documents/${versionTargetDoc.id}/new-version`, {
        new_revision: versionForm.new_revision,
        change_summary: versionForm.change_summary,
        status: versionForm.status,
        carry_over_markings: versionForm.carry_over_markings,
        attachment_name: versionForm.attachment_name || undefined,
        attachment_data: versionForm.attachment_data || undefined,
      });
      await loadDocs();
      if (selectedDrawing && selectedDrawing.id === versionTargetDoc.id) {
        if (res?.document) setSelectedDrawing(res.document);
        if (Array.isArray(res?.revisions)) setDrawingRevisions(res.revisions);
        if (Array.isArray(res?.markings)) setDrawingMarkings(res.markings);
      }
      setVersionTargetDoc(null);
      onProjectUpdated?.();
    } finally {
      setUploadingVersion(false);
    }
  };

  const handleDrawingCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!placingMarkingMode || !selectedDrawing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(4, Math.min(96, Number((((e.clientX - rect.left) / rect.width) * 100).toFixed(1))));
    const y = Math.max(4, Math.min(96, Number((((e.clientY - rect.top) / rect.height) * 100).toFixed(1))));
    setPendingPinCoords({ x, y });
    setMarkingForm({
      marking_type: 'Site Progress / Installed',
      title: '',
      description: '',
      trade: selectedDrawing.discipline || 'Electrical',
      status: 'Installed / Verified',
      progress_percent: 100,
    });
  };

  const handleSaveSiteMarking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDrawing || !pendingPinCoords) return;
    setSavingMarking(true);
    try {
      const res = await api.post<any>(`/api/documents/${selectedDrawing.id}/markings`, {
        x_percent: pendingPinCoords.x,
        y_percent: pendingPinCoords.y,
        ...markingForm,
      });
      if (Array.isArray(res?.markings)) {
        setDrawingMarkings(res.markings);
      } else if (res?.marking) {
        setDrawingMarkings(prev => [...prev, res.marking]);
      }
      setPendingPinCoords(null);
      setPlacingMarkingMode(false);
    } finally {
      setSavingMarking(false);
    }
  };

  const handleUpdateMarkingStatus = async (marking: any, nextStatus: string) => {
    const nextProg =
      nextStatus === 'Installed / Verified' || nextStatus === 'Closed'
        ? 100
        : nextStatus === 'In Progress'
        ? Math.max(50, Number(marking.progress_percent || 50))
        : Number(marking.progress_percent || 0);
    const updated = await api.put<any>(`/api/drawing-markings/${marking.id}`, {
      status: nextStatus,
      progress_percent: nextProg,
    });
    setDrawingMarkings(prev => prev.map(m => (m.id === marking.id ? updated : m)));
  };

  const handleDeleteMarking = async (markingId: string) => {
    await api.delete(`/api/drawing-markings/${markingId}`);
    setDrawingMarkings(prev => prev.filter(m => m.id !== markingId));
  };

  const drawingDocs = docs.filter(
    (d: any) =>
      (d.document_number?.startsWith('2618-') && !d.document_number?.endsWith('-FULL')) ||
      d.category === 'Plan' ||
      d.category === 'Schematic' ||
      d.category === 'Drawing' ||
      d.category === 'Drawings / BIM' ||
      d.category === 'Schedule' ||
      d.attachment_name?.endsWith('.png') ||
      d.attachment_name?.endsWith('.svg')
  );

  const displayedDocs = docs.filter((d: any) => {
    const isDrawing =
      (d.document_number?.startsWith('2618-') && !d.document_number?.endsWith('-FULL')) ||
      d.category === 'Plan' ||
      d.category === 'Schematic' ||
      d.category === 'Drawing' ||
      d.category === 'Drawings / BIM' ||
      d.category === 'Schedule' ||
      d.attachment_name?.endsWith('.png') ||
      d.attachment_name?.endsWith('.svg');

    if (activeCategoryFilter === 'Drawings' && !isDrawing) return false;
    if (activeCategoryFilter === 'Contracts' && d.category !== 'Contract' && d.category !== 'BOQ' && d.category !== 'Programme') return false;
    if (activeCategoryFilter === 'Specifications' && isDrawing) return false;

    if (docSearch) {
      const q = docSearch.toLowerCase();
      const match =
        (d.name && d.name.toLowerCase().includes(q)) ||
        (d.document_number && d.document_number.toLowerCase().includes(q)) ||
        (d.discipline && d.discipline.toLowerCase().includes(q)) ||
        (d.category && d.category.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  const getDrawingMeta = (doc: any) => {
    if (!doc?.markup_data) return null;
    try {
      return typeof doc.markup_data === 'string' ? JSON.parse(doc.markup_data) : doc.markup_data;
    } catch {
      return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-blue-100 text-blue-800 border border-blue-200">
            CDE &amp; Plans &amp; Drawing Studio
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Controlled Documents &amp; Engineering Drawings</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Common Data Environment for Enser Ltd CAD drawings (2618 series), project contracts, submittals, and client approvals.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {canManage && (
            <>
              <button
                onClick={handleRunReviewOnlyExtraction}
                disabled={extracting}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold border border-slate-300 transition-colors cursor-pointer"
              >
                <Eye size={14} className="text-amber-600" />
                {extracting ? 'Scanning Stored Docs...' : 'Review Setup Suggestions'}
              </button>
              <button
                onClick={() => setShowContractorModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
              >
                <Sparkles size={14} /> Upload &amp; Review Contract/BOQ
              </button>
            </>
          )}
          <button
            onClick={() => {
              setBatchFiles([]);
              setDocForm(s => ({ ...s, category: 'Drawing', version: 'Rev A' }));
              setShowUploadDoc(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
          >
            <Plus size={15} /> Upload Separate Drawings / Docs
          </button>
        </div>
      </div>

      {/* Drawing Category Quick Filter Tabs & Search */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveCategoryFilter('All')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              activeCategoryFilter === 'All'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All Controlled Documents ({docs.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveCategoryFilter('Drawings')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeCategoryFilter === 'Drawings'
                ? 'bg-blue-600 text-white'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
            }`}
          >
            <Eye size={13} />
            Engineering Drawings ({drawingDocs.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveCategoryFilter('Contracts')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              activeCategoryFilter === 'Contracts'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200'
            }`}
          >
            Contracts &amp; Tender Schedule
          </button>
        </div>

        <div className="relative min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={docSearch}
            onChange={e => setDocSearch(e.target.value)}
            placeholder="Search drawings or docs..."
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50"
          />
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
            <button onClick={() => setSetupSuggestions(null)} className="text-amber-700 hover:text-amber-950 cursor-pointer">
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
                    className="w-full px-2.5 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg"
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
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-amber-100 cursor-pointer"
            >
              Discard
            </button>
            <button
              onClick={handleApproveSuggestions}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm cursor-pointer"
            >
              <CheckSquare size={14} /> Approve &amp; Apply to Project
            </button>
          </div>
        </div>
      )}

      {/* Original Enser Ltd CAD Drawing Sheets Visual Grid + Original PDFs */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                ORIGINAL ENSER LTD CAD SHEETS (JOB 2618)
              </span>
              <span className="text-[11px] font-semibold text-slate-500">
                BOV Operations Centre, Level 2 Area K, St. Venera • 1:100 @ A1 &amp; A2
              </span>
            </div>
            <h2 className="text-sm font-bold text-slate-900 mt-1">
              Original Engineering Drawings &amp; Distribution Board Schedules ({drawingDocs.length} Sheets)
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/original_drawings/BOV-St-Venera-2618-Original-Tender-and-Drawings.pdf#page=58"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-xs font-bold transition-colors"
            >
              <FileText size={13} /> Open Original Drawings PDF (Pages 52–67)
            </a>
            <a
              href="/original_drawings/BOV-St-Venera-2618-Original-Master-Programme.pdf"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-bold transition-colors"
            >
              <FileText size={13} /> Open Original Master Programme PDF
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
          {drawingDocs.map((sheet: any) => {
            const meta = getDrawingMeta(sheet);
            return (
              <div
                key={sheet.id}
                onClick={() => openDrawingViewer(sheet)}
                className="group rounded-xl border border-slate-200 hover:border-blue-500 bg-slate-50/60 hover:bg-white shadow-2xs hover:shadow-md transition-all overflow-hidden flex flex-col cursor-pointer"
              >
                <div className="relative h-44 bg-white border-b border-slate-200 overflow-hidden flex items-center justify-center p-1.5">
                  {sheet.attachment_data ? (
                    <img
                      src={sheet.attachment_data}
                      alt={sheet.name}
                      loading="lazy"
                      className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
                    />
                  ) : (
                    <Eye size={28} className="text-slate-300" />
                  )}
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-900/90 text-white shadow-xs">
                    {sheet.document_number}
                  </span>
                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-600/95 text-white">
                      {sheet.revision || 'Rev 0'}
                    </span>
                    {meta?.pdfPage && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-blue-600/90 text-white">
                        PDF p.{meta.pdfPage}
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-slate-900 line-clamp-1" title={sheet.name}>
                      {sheet.name}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {sheet.discipline} • {meta?.scale || '1:100 (A1)'} • Enser Ltd
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/70">
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 group-hover:text-blue-700">
                      <Eye size={12} /> Inspect &amp; Mark Sheet
                    </span>
                    <button
                      type="button"
                      onClick={e => openNewVersionModal(sheet, e)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold cursor-pointer"
                      title="Upload New Revision / Version"
                    >
                      <GitBranch size={10} /> + New Version
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Documents & Drawings Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="py-3.5 px-4">Document / Drawing Sheet</th>
              <th className="py-3.5 px-4">Category</th>
              <th className="py-3.5 px-4">Discipline</th>
              <th className="py-3.5 px-4">Revision</th>
              <th className="py-3.5 px-4">Workflow Status</th>
              <th className="py-3.5 px-4">Interactive Drawing Sheet</th>
              <th className="py-3.5 px-4">Client Portal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">Loading document register...</td>
              </tr>
            ) : displayedDocs.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-500">No documents match the current filter.</td>
              </tr>
            ) : (
              displayedDocs.map((doc: any) => {
                const isClientVisible = doc.visibility === 'Client' || doc.visibility === 'All' || (Number(doc.client_visible) === 1 && doc.status === 'Approved');
                const isDrawing =
                  (doc.document_number?.startsWith('2618-') && !doc.document_number?.endsWith('-FULL')) ||
                  doc.category === 'Plan' ||
                  doc.category === 'Schematic' ||
                  doc.category === 'Drawing' ||
                  doc.category === 'Drawings / BIM' ||
                  doc.category === 'Schedule' ||
                  doc.attachment_name?.endsWith('.png') ||
                  doc.attachment_name?.endsWith('.svg');

                return (
                  <tr
                    key={doc.id}
                    className="hover:bg-blue-50/40 transition-colors"
                  >
                    <td className="py-3.5 px-4 font-semibold text-slate-900 flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isDrawing ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {isDrawing ? <Eye size={16} /> : <FileText size={16} />}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900">{doc.name || doc.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {doc.document_number && (
                            <span className="text-[10px] text-blue-700 font-mono font-bold bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                              {doc.document_number}
                            </span>
                          )}
                          {doc.attachment_name && (
                            <span className="text-[10px] text-slate-400 font-mono truncate max-w-xs">{doc.attachment_name}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                        {doc.category || 'Technical'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 font-medium">{doc.discipline || 'General'}</td>
                    <td className="py-3.5 px-4 font-mono text-slate-700 font-bold">{doc.revision || doc.version || 'Rev A'}</td>
                    <td className="py-3.5 px-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${WORKFLOW_COLORS[doc.status] || WORKFLOW_COLORS.Draft}`}>
                        {doc.status || 'Approved'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {isDrawing ? (
                          <button
                            type="button"
                            onClick={() => openDrawingViewer(doc)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm transition-colors cursor-pointer"
                          >
                            <Eye size={13} /> View &amp; Mark Sheet
                          </button>
                        ) : doc.attachment_data ? (
                          <a
                            href={doc.attachment_data}
                            download={doc.attachment_name || `${doc.name}.pdf`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold transition-colors"
                          >
                            <Download size={12} /> Download
                          </a>
                        ) : null}
                        <button
                          type="button"
                          onClick={e => openNewVersionModal(doc, e)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold text-[11px] transition-colors cursor-pointer"
                          title="Upload New Version / Revision"
                        >
                          <GitBranch size={12} /> + New Version
                        </button>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      {canManage ? (
                        <button
                          onClick={() => toggleClientVisibility(doc)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                            isClientVisible
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                          }`}
                        >
                          {isClientVisible ? <Globe size={12} /> : <Lock size={12} />}
                          {isClientVisible ? 'Published' : 'Internal'}
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          {isClientVisible ? 'Published' : 'Internal'}
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

      {/* Interactive Drawing Sheet Modal */}
      {selectedDrawing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 text-white rounded-2xl shadow-2xl w-full max-w-7xl h-[94vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="bg-slate-950 px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-blue-600/30 text-blue-400 border border-blue-500/30 flex-shrink-0">
                  {selectedDrawing.document_number || '2618 SHEET'}
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white truncate">
                    {selectedDrawing.name || selectedDrawing.title}
                  </h3>
                  <p className="text-xs text-slate-400 flex items-center gap-2 truncate">
                    <span>Enser Ltd Consulting Engineers</span>
                    <span>•</span>
                    <span>Job 2618 (BOV St. Venera)</span>
                    <span>•</span>
                    <span className="text-amber-400">{selectedDrawing.discipline || 'Engineering'}</span>
                    <span>•</span>
                    <span className="text-emerald-400 font-mono font-bold">
                      {selectedDrawing.revision || 'Rev 0'} ({selectedDrawing.status || 'Approved for Construction'})
                    </span>
                  </p>
                </div>
              </div>

              {/* Viewer Controls */}
              <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setPlacingMarkingMode(m => !m);
                    setPendingPinCoords(null);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                    placingMarkingMode
                      ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-lg shadow-amber-500/20'
                      : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/40'
                  }`}
                >
                  <MapPin size={14} />
                  {placingMarkingMode ? 'Click Anywhere on Drawing to Place Pin...' : '+ Place Site Marking on Drawing'}
                </button>

                <button
                  type="button"
                  onClick={() => openNewVersionModal(selectedDrawing)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
                >
                  <GitBranch size={14} /> + Upload New Version (Rev)
                </button>

                <div className="flex items-center bg-slate-800/80 rounded-xl border border-slate-700 p-1">
                  <button
                    type="button"
                    onClick={() => setDrawingZoom(z => Math.max(0.5, z - 0.25))}
                    className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
                    title="Zoom Out"
                  >
                    <ZoomOut size={16} />
                  </button>
                  <span className="px-2.5 text-xs font-mono font-semibold text-slate-300">
                    {Math.round(drawingZoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setDrawingZoom(z => Math.min(3, z + 0.25))}
                    className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer"
                    title="Zoom In"
                  >
                    <ZoomIn size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawingZoom(1)}
                    className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer ml-1 border-l border-slate-700"
                    title="Reset Zoom (100%)"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>

                {getDrawingMeta(selectedDrawing)?.originalPdfUrl && (
                  <a
                    href={getDrawingMeta(selectedDrawing).originalPdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
                  >
                    <FileText size={14} /> Original PDF (p.{getDrawingMeta(selectedDrawing).pdfPage})
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => setSelectedDrawing(null)}
                  className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-colors cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* CAD Redline Pen & Markup Shapes Studio Toolbar */}
            <div className="bg-slate-900/95 px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5 flex-shrink-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400 mr-1 flex items-center gap-1">
                  <PenTool size={12} /> Redline &amp; Markup Tools:
                </span>
                {[
                  { id: 'select', label: 'Select / Pan', icon: MousePointer },
                  { id: 'pen', label: 'Freehand Pen', icon: PenTool },
                  { id: 'highlighter', label: 'Highlighter', icon: Highlighter },
                  { id: 'cloud', label: 'Revision Cloud', icon: Cloud },
                  { id: 'rect', label: 'Box / Rect', icon: Square },
                  { id: 'ellipse', label: 'Circle / Zone', icon: Circle },
                  { id: 'arrow', label: 'Arrow Leader', icon: ArrowUpRight },
                  { id: 'line', label: 'Line', icon: Minus },
                  { id: 'text', label: 'Text Callout', icon: Type },
                  { id: 'pin', label: 'Site Pin (MK)', icon: MapPin },
                ].map(t => {
                  const Icon = t.icon;
                  const active = (t.id === 'pin' && placingMarkingMode) || (!placingMarkingMode && markupTool === t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        if (t.id === 'pin') {
                          setPlacingMarkingMode(true);
                          setMarkupTool('pin');
                        } else {
                          setPlacingMarkingMode(false);
                          setMarkupTool(t.id as any);
                        }
                        setPendingPinCoords(null);
                        setPendingTextCoords(null);
                      }}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                        active
                          ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                          : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700'
                      }`}
                    >
                      <Icon size={12} />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Color Swatches, Stroke Width & Save/Undo Controls */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
                  {[
                    { hex: '#ef4444', name: 'Redline Red' },
                    { hex: '#f59e0b', name: 'Safety Amber' },
                    { hex: '#10b981', name: 'Verified Green' },
                    { hex: '#3b82f6', name: 'Electrical Blue' },
                    { hex: '#a855f7', name: 'ELV Violet' },
                  ].map(c => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setMarkupColor(c.hex)}
                      title={c.name}
                      style={{ backgroundColor: c.hex }}
                      className={`w-4 h-4 rounded-full cursor-pointer transition-transform ${
                        markupColor === c.hex ? 'scale-125 ring-2 ring-white' : 'opacity-75 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-[10px]">
                  {[
                    { w: 2, label: 'Thin' },
                    { w: 4, label: 'Med' },
                    { w: 7, label: 'Thick' },
                  ].map(sw => (
                    <button
                      key={sw.w}
                      type="button"
                      onClick={() => setMarkupStrokeWidth(sw.w)}
                      className={`px-1.5 py-0.5 rounded font-bold cursor-pointer ${
                        markupStrokeWidth === sw.w ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {sw.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setShowMarkupLayer(v => !v)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${
                    showMarkupLayer
                      ? 'bg-slate-800 text-emerald-400 border-emerald-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {showMarkupLayer ? `Markups Visible (${markupShapes.length})` : 'Markups Hidden'}
                </button>

                <button
                  type="button"
                  onClick={handleUndoShape}
                  disabled={markupShapes.length === 0}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-[11px] font-bold cursor-pointer"
                  title="Undo Last Shape / Stroke"
                >
                  <Undo2 size={12} /> Undo
                </button>

                <button
                  type="button"
                  onClick={handleClearShapes}
                  disabled={markupShapes.length === 0}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-red-950/60 disabled:opacity-40 text-red-300 border border-slate-700 text-[11px] font-bold cursor-pointer"
                  title="Clear All Drawn Shapes"
                >
                  <Trash2 size={12} /> Clear
                </button>

                <button
                  type="button"
                  onClick={() => persistShapesToServer(markupShapes)}
                  disabled={savingShapes}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-xs cursor-pointer ${
                    shapesSavedFeedback
                      ? 'bg-emerald-600 text-white'
                      : 'bg-blue-600 hover:bg-blue-500 text-white'
                  }`}
                >
                  <Save size={12} />
                  {savingShapes ? 'Saving...' : shapesSavedFeedback ? 'Markups Saved ✓' : 'Save Markups'}
                </button>
              </div>
            </div>

            {/* Modal Body: Left Canvas + Right WBS Sidebar */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
              {/* Drawing Sheet Canvas (Left 70%) */}
              <div className="flex-1 bg-[#090d16] overflow-auto relative p-4 flex items-center justify-center border-b lg:border-b-0 lg:border-r border-slate-800">
                {(placingMarkingMode || markupTool !== 'select') && (
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 rounded-full bg-amber-500 text-slate-950 font-bold text-xs shadow-lg flex items-center gap-2">
                    <PenTool size={13} />
                    {placingMarkingMode || markupTool === 'pin'
                      ? 'Click anywhere on the CAD drawing below to drop a Site Marking Pin'
                      : markupTool === 'text'
                      ? 'Click anywhere on the CAD drawing below to place a Redline Text Callout'
                      : `Active Tool: ${markupTool.toUpperCase()} — Click and drag (or click) on the drawing to mark changes`}
                    <button
                      type="button"
                      onClick={() => {
                        setPlacingMarkingMode(false);
                        setMarkupTool('select');
                        setPendingPinCoords(null);
                        setPendingTextCoords(null);
                      }}
                      className="ml-2 px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] cursor-pointer"
                    >
                      Done / Select Mode
                    </button>
                  </div>
                )}

                {selectedDrawing.attachment_data ? (
                  selectedDrawing.attachment_data.startsWith('data:application/pdf') ||
                  selectedDrawing.attachment_data.toLowerCase().endsWith('.pdf') ||
                  selectedDrawing.attachment_name?.toLowerCase().endsWith('.pdf') ? (
                    <iframe
                      src={selectedDrawing.attachment_data}
                      title={selectedDrawing.name}
                      className="w-full h-full rounded border border-slate-800 bg-white"
                    />
                  ) : (
                    <div
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={handleCanvasMouseUp}
                      onMouseLeave={handleCanvasMouseUp}
                      className={`relative inline-block transition-transform duration-150 ease-out origin-center select-none ${
                        placingMarkingMode || markupTool !== 'select'
                          ? 'cursor-crosshair ring-2 ring-amber-400 rounded'
                          : ''
                      }`}
                      style={{ transform: `scale(${drawingZoom})`, transformOrigin: 'center center' }}
                    >
                      <img
                        src={selectedDrawing.attachment_data}
                        alt={selectedDrawing.name}
                        draggable={false}
                        className="max-w-[1250px] w-full shadow-2xl rounded border border-slate-800 pointer-events-none select-none"
                      />

                      {/* Interactive SVG Redline Pen & Markup Shapes Overlay (0..1000 coordinate space) */}
                      {showMarkupLayer && (
                        <svg
                          viewBox="0 0 1000 1000"
                          preserveAspectRatio="none"
                          className="absolute inset-0 w-full h-full pointer-events-none z-10"
                        >
                          <defs>
                            {['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#a855f7'].map(col => (
                              <marker
                                key={col}
                                id={`arrow-${col.replace('#', '')}`}
                                viewBox="0 0 10 10"
                                refX="7"
                                refY="5"
                                markerWidth="6"
                                markerHeight="6"
                                orient="auto-start-reverse"
                              >
                                <path d="M 0 0 L 10 5 L 0 10 z" fill={col} />
                              </marker>
                            ))}
                          </defs>

                          {[...markupShapes, ...(draftShape ? [draftShape] : [])].map((shp: any) => {
                            const col = shp.color || '#ef4444';
                            const sw = Number(shp.strokeWidth || 3) * 1.4;

                            if (shp.type === 'pen' || shp.type === 'highlighter') {
                              const pts = Array.isArray(shp.points)
                                ? shp.points.map((p: any) => `${(p.x * 10).toFixed(1)},${(p.y * 10).toFixed(1)}`).join(' ')
                                : '';
                              if (!pts) return null;
                              return (
                                <polyline
                                  key={shp.id}
                                  points={pts}
                                  fill="none"
                                  stroke={col}
                                  strokeWidth={shp.type === 'highlighter' ? sw * 2.8 : sw}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  opacity={shp.type === 'highlighter' ? 0.38 : 0.95}
                                />
                              );
                            }

                            const x1 = Number(shp.x1 ?? 20) * 10;
                            const y1 = Number(shp.y1 ?? 20) * 10;
                            const x2 = Number(shp.x2 ?? 35) * 10;
                            const y2 = Number(shp.y2 ?? 30) * 10;
                            const minX = Math.min(x1, x2);
                            const minY = Math.min(y1, y2);
                            const w = Math.max(8, Math.abs(x2 - x1));
                            const h = Math.max(8, Math.abs(y2 - y1));

                            if (shp.type === 'rect') {
                              return (
                                <g key={shp.id}>
                                  <rect
                                    x={minX}
                                    y={minY}
                                    width={w}
                                    height={h}
                                    fill={col}
                                    fillOpacity={0.08}
                                    stroke={col}
                                    strokeWidth={sw}
                                    rx={4}
                                  />
                                  {shp.label && (
                                    <text
                                      x={minX + 6}
                                      y={Math.max(16, minY - 6)}
                                      fill={col}
                                      fontSize="13"
                                      fontWeight="bold"
                                      fontFamily="monospace"
                                    >
                                      {shp.label}
                                    </text>
                                  )}
                                </g>
                              );
                            }

                            if (shp.type === 'cloud') {
                              return (
                                <g key={shp.id}>
                                  <path
                                    d={buildRevisionCloudPath(shp.x1 ?? 20, shp.y1 ?? 20, shp.x2 ?? 35, shp.y2 ?? 30)}
                                    fill={col}
                                    fillOpacity={0.07}
                                    stroke={col}
                                    strokeWidth={sw}
                                  />
                                  {shp.label && (
                                    <text
                                      x={minX + 6}
                                      y={Math.max(16, minY - 8)}
                                      fill={col}
                                      fontSize="13"
                                      fontWeight="bold"
                                      fontFamily="monospace"
                                    >
                                      {shp.label}
                                    </text>
                                  )}
                                </g>
                              );
                            }

                            if (shp.type === 'ellipse') {
                              return (
                                <ellipse
                                  key={shp.id}
                                  cx={minX + w / 2}
                                  cy={minY + h / 2}
                                  rx={w / 2}
                                  ry={h / 2}
                                  fill={col}
                                  fillOpacity={0.08}
                                  stroke={col}
                                  strokeWidth={sw}
                                />
                              );
                            }

                            if (shp.type === 'arrow') {
                              const markerId = `arrow-${col.replace('#', '')}`;
                              return (
                                <g key={shp.id}>
                                  <line
                                    x1={x1}
                                    y1={y1}
                                    x2={x2}
                                    y2={y2}
                                    stroke={col}
                                    strokeWidth={sw}
                                    markerEnd={`url(#${markerId})`}
                                  />
                                  {shp.label && (
                                    <text
                                      x={x1}
                                      y={Math.max(15, y1 - 8)}
                                      fill={col}
                                      fontSize="13"
                                      fontWeight="bold"
                                      fontFamily="monospace"
                                    >
                                      {shp.label}
                                    </text>
                                  )}
                                </g>
                              );
                            }

                            if (shp.type === 'line') {
                              return (
                                <line
                                  key={shp.id}
                                  x1={x1}
                                  y1={y1}
                                  x2={x2}
                                  y2={y2}
                                  stroke={col}
                                  strokeWidth={sw}
                                  strokeLinecap="round"
                                />
                              );
                            }

                            if (shp.type === 'text') {
                              const labelText = shp.text || shp.label || 'REDLINE NOTE';
                              const boxWidth = Math.max(120, labelText.length * 7.8 + 18);
                              return (
                                <g key={shp.id}>
                                  <rect
                                    x={x1}
                                    y={Math.max(4, y1 - 22)}
                                    width={boxWidth}
                                    height={28}
                                    rx={5}
                                    fill="#0f172a"
                                    fillOpacity={0.92}
                                    stroke={col}
                                    strokeWidth={2.5}
                                  />
                                  <text
                                    x={x1 + 8}
                                    y={Math.max(22, y1 - 4)}
                                    fill={col}
                                    fontSize="13"
                                    fontWeight="bold"
                                    fontFamily="monospace"
                                  >
                                    {labelText}
                                  </text>
                                </g>
                              );
                            }

                            return null;
                          })}
                        </svg>
                      )}

                      {/* Interactive Site Marking Pins Overlaid on Drawing */}
                      {drawingMarkings.map((m: any) => {
                        const isInstalled = m.status === 'Installed / Verified' || m.status === 'Closed';
                        const isInProgress = m.status === 'In Progress';
                        const isSelected = activePinId === m.id;
                        return (
                          <div
                            key={m.id}
                            onClick={ev => {
                              ev.stopPropagation();
                              setActivePinId(isSelected ? null : m.id);
                            }}
                            style={{
                              left: `${m.x_percent ?? 50}%`,
                              top: `${m.y_percent ?? 50}%`,
                            }}
                            className="absolute -translate-x-1/2 -translate-y-1/2 z-20 group/pin cursor-pointer"
                          >
                            <div
                              className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-mono font-bold shadow-lg border-2 transition-transform ${
                                isSelected ? 'scale-125 ring-4 ring-white/40' : 'hover:scale-110'
                              } ${
                                isInstalled
                                  ? 'bg-emerald-600 text-white border-white'
                                  : isInProgress
                                  ? 'bg-blue-600 text-white border-white'
                                  : 'bg-amber-500 text-slate-950 border-white'
                              }`}
                            >
                              <MapPin size={11} />
                              <span>{m.pin_number || 'MK'}</span>
                            </div>

                            {/* Pin Callout Popover */}
                            <div
                              className={`absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 bg-slate-900/95 text-white border border-slate-700 rounded-xl p-2.5 shadow-2xl text-left z-30 ${
                                isSelected ? 'block' : 'hidden group-hover/pin:block'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1 mb-1">
                                <span className="text-[10px] font-mono font-bold text-amber-400">
                                  {m.pin_number} • {m.revision || selectedDrawing.revision || 'Rev 0'}
                                </span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-emerald-400 font-bold">
                                  {m.status} ({m.progress_percent ?? 100}%)
                                </span>
                              </div>
                              <p className="text-xs font-bold text-white leading-snug">{m.title}</p>
                              {m.description && (
                                <p className="text-[10px] text-slate-300 mt-1 leading-relaxed">{m.description}</p>
                              )}
                              <p className="text-[9px] text-slate-400 mt-1.5 border-t border-slate-800 pt-1">
                                Marked by {m.created_by_name || 'Site Supervisor'} • {m.trade || 'MEP'}
                              </p>
                            </div>
                          </div>
                        );
                      })}

                      {/* Pending Pin Marker */}
                      {pendingPinCoords && (
                        <div
                          style={{ left: `${pendingPinCoords.x}%`, top: `${pendingPinCoords.y}%` }}
                          className="absolute -translate-x-1/2 -translate-y-1/2 z-30"
                        >
                          <div className="px-2.5 py-1 rounded-full bg-red-600 text-white border-2 border-white text-[10px] font-mono font-bold shadow-xl animate-bounce">
                            NEW PIN ({pendingPinCoords.x}%, {pendingPinCoords.y}%)
                          </div>
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <div className="text-center p-8 text-slate-400">
                    <FileText size={48} className="mx-auto mb-3 opacity-40 text-blue-400" />
                    <p className="font-semibold text-slate-200 text-base">Engineering Drawing Specification Sheet</p>
                    <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                      Drawing {selectedDrawing.document_number} ({selectedDrawing.name}) is registered in the CDE register.
                    </p>
                  </div>
                )}

                {/* Modal Form when a New Site Marking Pin is Dropped on the Drawing */}
                {pendingPinCoords && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-xs z-40 flex items-center justify-center p-4">
                    <form
                      onSubmit={handleSaveSiteMarking}
                      className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-md shadow-2xl space-y-3 text-white"
                    >
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                        <div>
                          <span className="text-[10px] font-mono font-bold uppercase text-amber-400">
                            Pin Coordinates: X={pendingPinCoords.x}%, Y={pendingPinCoords.y}% • {selectedDrawing.document_number} ({selectedDrawing.revision || 'Rev 0'})
                          </span>
                          <h4 className="text-sm font-bold text-white">Add Site Marking / Redline Update on Drawing</h4>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPendingPinCoords(null)}
                          className="text-slate-400 hover:text-white cursor-pointer"
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Marking Type</label>
                          <select
                            value={markingForm.marking_type}
                            onChange={e => setMarkingForm(s => ({ ...s, marking_type: e.target.value }))}
                            className="w-full px-2.5 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white"
                          >
                            <option value="Site Progress / Installed">Site Progress / Installed</option>
                            <option value="As-Built Redline Change">As-Built Redline Change</option>
                            <option value="Snag / Defect">Snag / Defect</option>
                            <option value="RFI / Clarification">RFI / Clarification</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Status on Site</label>
                          <select
                            value={markingForm.status}
                            onChange={e => setMarkingForm(s => ({ ...s, status: e.target.value }))}
                            className="w-full px-2.5 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white"
                          >
                            <option value="Installed / Verified">Installed / Verified</option>
                            <option value="In Progress">In Progress</option>
                            <option value="Open">Open / Action Required</option>
                            <option value="Closed">Closed</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Site Marking Title *</label>
                        <input
                          required
                          value={markingForm.title}
                          onChange={e => setMarkingForm(s => ({ ...s, title: e.target.value }))}
                          placeholder="e.g. Area K Corridor 600x600 LED Panels Installed & Tested"
                          className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Field Notes / Redline Details</label>
                        <textarea
                          rows={2}
                          value={markingForm.description}
                          onChange={e => setMarkingForm(s => ({ ...s, description: e.target.value }))}
                          placeholder="Describe installed circuit numbers, redline routing change, or site supervisor verification..."
                          className="w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Trade</label>
                          <input
                            value={markingForm.trade}
                            onChange={e => setMarkingForm(s => ({ ...s, trade: e.target.value }))}
                            className="w-full px-2.5 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">Completion %</label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={markingForm.progress_percent}
                            onChange={e => setMarkingForm(s => ({ ...s, progress_percent: Number(e.target.value) }))}
                            className="w-full px-2.5 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setPendingPinCoords(null)}
                          className="px-3 py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={savingMarking}
                          className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer"
                        >
                          {savingMarking ? 'Saving Pin...' : 'Save Site Marking Pin'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Modal Form when a Redline Text Callout is Placed on the Drawing */}
                {pendingTextCoords && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-xs z-40 flex items-center justify-center p-4">
                    <form
                      onSubmit={handleConfirmTextShape}
                      className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-md shadow-2xl space-y-3 text-white"
                    >
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <div>
                          <span className="text-[10px] font-mono font-bold uppercase text-amber-400">
                            Redline Text Callout • X={pendingTextCoords.x}%, Y={pendingTextCoords.y}%
                          </span>
                          <h4 className="text-sm font-bold text-white">Place Text Markup on Drawing</h4>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPendingTextCoords(null)}
                          className="text-slate-400 hover:text-white cursor-pointer"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
                          Redline Change / Annotation Text *
                        </label>
                        <input
                          required
                          autoFocus
                          value={pendingTextValue}
                          onChange={e => setPendingTextValue(e.target.value)}
                          placeholder="e.g. RELOCATE PIR SENSOR 1.5M EAST — CIRCUIT L2/C4"
                          className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white font-mono"
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setPendingTextCoords(null)}
                          className="px-3 py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer"
                        >
                          Place Text on Drawing
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>

              {/* Right Sidebar: Redline Markups, Site Markings, Version History & Linked WBS Tasks (Right 30%) */}
              <div className="w-full lg:w-[420px] bg-slate-950 flex flex-col overflow-y-auto divide-y divide-slate-800 flex-shrink-0">
                {/* Engineering Sheet Metadata */}
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Drawing Metadata</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      {selectedDrawing.status || 'Approved'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold">Sheet Number</span>
                      <p className="font-mono font-bold text-blue-400 mt-0.5">{selectedDrawing.document_number || '2618-S-ELE-01'}</p>
                    </div>
                    <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-slate-500 uppercase font-semibold">Active Revision</span>
                        <p className="font-mono font-bold text-emerald-400 mt-0.5">{selectedDrawing.revision || 'Rev 0'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openNewVersionModal(selectedDrawing)}
                        className="px-2 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold cursor-pointer"
                      >
                        + Update Rev
                      </button>
                    </div>
                  </div>
                </div>

                {/* 0. Redline Pen & Markup Shapes Layer List */}
                <div className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <PenTool size={14} className="text-red-400" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                        Pen &amp; Markup Shapes ({markupShapes.length})
                      </h4>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setMarkupTool(markupTool === 'pen' ? 'cloud' : 'pen')}
                        className="px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 text-[10px] font-bold cursor-pointer"
                      >
                        + Draw Redline
                      </button>
                      <button
                        type="button"
                        onClick={() => persistShapesToServer(markupShapes)}
                        className="px-2 py-0.5 rounded bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 border border-blue-500/30 text-[10px] font-bold cursor-pointer"
                      >
                        {shapesSavedFeedback ? 'Saved ✓' : 'Save'}
                      </button>
                    </div>
                  </div>

                  {markupShapes.length === 0 ? (
                    <div className="py-3 text-center text-[11px] text-slate-500 bg-slate-900/40 rounded-xl border border-slate-800/80 p-2.5">
                      Select <strong>Freehand Pen</strong>, <strong>Revision Cloud</strong>, <strong>Box</strong>, <strong>Circle</strong>, <strong>Arrow</strong>, or <strong>Text Callout</strong> in the toolbar above and draw directly on the sheet.
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {markupShapes.map((shp: any, idx: number) => (
                        <div
                          key={shp.id || idx}
                          className="flex items-center justify-between gap-2 bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px]"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              style={{ backgroundColor: shp.color || '#ef4444' }}
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            />
                            <span className="font-mono font-bold uppercase text-slate-300 text-[10px]">
                              {shp.type}
                            </span>
                            <span className="text-slate-400 truncate">
                              {shp.text || shp.label || `Marked by ${shp.author || 'Engineer'}`}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteSingleShape(shp.id)}
                            className="text-slate-500 hover:text-red-400 p-0.5 cursor-pointer flex-shrink-0"
                            title="Delete Shape"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 1. Interactive Site Markings on Drawing Section */}
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <MapPin size={14} className="text-amber-400" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                        Site Markings on Drawing ({drawingMarkings.length})
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setPlacingMarkingMode(true);
                        setPendingPinCoords({ x: 50, y: 50 });
                        setMarkingForm({
                          marking_type: 'Site Progress / Installed',
                          title: '',
                          description: '',
                          trade: selectedDrawing.discipline || 'Electrical',
                          status: 'Installed / Verified',
                          progress_percent: 100,
                        });
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[10px] cursor-pointer"
                    >
                      <Plus size={11} /> Add Site Marking
                    </button>
                  </div>

                  {drawingMarkings.length === 0 ? (
                    <div className="py-4 text-center text-xs text-slate-500 bg-slate-900/40 rounded-xl border border-slate-800/80 p-3">
                      No site markings placed on this drawing yet. Click <strong>+ Place Site Marking on Drawing</strong> above and click any point on the sheet.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {drawingMarkings.map((m: any) => (
                        <div
                          key={m.id}
                          onClick={() => setActivePinId(activePinId === m.id ? null : m.id)}
                          className={`p-2.5 rounded-xl border transition-colors cursor-pointer ${
                            activePinId === m.id
                              ? 'bg-slate-800 border-amber-400'
                              : 'bg-slate-900/80 hover:bg-slate-900 border-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              <MapPin size={10} /> {m.pin_number} ({m.x_percent}%, {m.y_percent}%)
                            </span>
                            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                              <select
                                value={m.status || 'Installed / Verified'}
                                onChange={e => handleUpdateMarkingStatus(m, e.target.value)}
                                className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] font-bold text-emerald-400"
                              >
                                <option value="Installed / Verified">Installed / Verified</option>
                                <option value="In Progress">In Progress</option>
                                <option value="Open">Open</option>
                                <option value="Closed">Closed</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => handleDeleteMarking(m.id)}
                                className="p-1 text-slate-500 hover:text-red-400 cursor-pointer"
                                title="Delete Site Marking"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                          <p className="text-xs font-bold text-white mt-1.5">{m.title}</p>
                          {m.description && (
                            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{m.description}</p>
                          )}
                          <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1.5">
                            <span>{m.marking_type} • {m.created_by_name || 'Supervisor'}</span>
                            <span className="font-mono text-slate-400">{m.revision || selectedDrawing.revision || 'Rev 0'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 2. Drawing Version & Revision History Section */}
                <div className="p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <History size={14} className="text-emerald-400" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                        Version &amp; Revision History ({drawingRevisions.length + 1})
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => openNewVersionModal(selectedDrawing)}
                      className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 cursor-pointer"
                    >
                      + Upload New Version
                    </button>
                  </div>

                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 text-xs">
                    {/* Active Version */}
                    <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-xl p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-emerald-400">
                          {selectedDrawing.revision || 'Rev 0'} (CURRENT ACTIVE)
                        </span>
                        <span className="text-[10px] text-emerald-300 font-semibold">{selectedDrawing.status || 'Approved'}</span>
                      </div>
                      <p className="text-[11px] text-slate-300 mt-0.5">
                        Active construction drawing sheet synced with AI Copilot &amp; Site Markings.
                      </p>
                    </div>

                    {/* Superseded / Historical Versions */}
                    {drawingRevisions.map((rev: any) => (
                      <div key={rev.id} className="bg-slate-900/70 border border-slate-800 rounded-xl p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-slate-300">{rev.version}</span>
                          <span className="text-[10px] text-slate-500">
                            {rev.uploaded_at ? new Date(rev.uploaded_at).toLocaleDateString() : 'Archived'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">{rev.notes || 'Previous drawing issue'}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Linked WBS Tasks Section */}
                <div className="p-4 flex-1 flex flex-col min-h-0">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Layers size={14} className="text-blue-400" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                        Linked WBS Tasks ({linkedTasks.length})
                      </h4>
                    </div>
                    <a
                      href="#/tasks"
                      onClick={(e) => {
                        e.preventDefault();
                        setSelectedDrawing(null);
                        window.location.hash = '#/tasks';
                        window.dispatchEvent(new HashChangeEvent('hashchange'));
                      }}
                      className="text-[11px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer"
                    >
                      Open Gantt <ArrowUpRight size={12} />
                    </a>
                  </div>

                  {loadingTasks ? (
                    <div className="py-6 text-center text-xs text-slate-500">Loading linked schedule tasks...</div>
                  ) : linkedTasks.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-500">
                      No schedule tasks directly linked to drawing {selectedDrawing.document_number}.
                    </div>
                  ) : (
                    <div className="space-y-2 overflow-y-auto max-h-[240px] pr-1">
                      {linkedTasks.map((t: any) => (
                        <div key={t.id} className="bg-slate-900/80 hover:bg-slate-900 p-2.5 rounded-xl border border-slate-800 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-bold text-slate-200 leading-snug line-clamp-2">
                              {t.title}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 flex-shrink-0">
                              {t.progress}%
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1.5">
                            <span>{t.trade || 'MEP'} • {t.assignee || 'Assigned'}</span>
                            <span className={t.status === 'Completed' ? 'text-emerald-400' : 'text-amber-400'}>
                              {t.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Publication Controls Footer */}
                <div className="p-4 bg-slate-900/60 border-t border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Client Portal:</span>
                  <button
                    type="button"
                    onClick={() => toggleClientVisibility(selectedDrawing)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-colors cursor-pointer"
                  >
                    <Globe size={13} /> Published to Client
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload New Drawing Version / Revision Modal */}
      {versionTargetDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form
            onSubmit={handleUploadNewVersion}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800">
                  DRAWING VERSION CONTROL • {versionTargetDoc.document_number || 'DOC'}
                </span>
                <h3 className="font-bold text-slate-900 text-base mt-1">
                  Upload New Version / Revision ({versionTargetDoc.revision || 'Rev 0'} → {versionForm.new_revision})
                </h3>
                <p className="text-xs text-slate-500">
                  Archives {versionTargetDoc.revision || 'current version'} in Revision History, updates AI Copilot, and carries forward active Site Markings.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setVersionTargetDoc(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">New Revision Code *</label>
                <input
                  required
                  value={versionForm.new_revision}
                  onChange={e => setVersionForm(s => ({ ...s, new_revision: e.target.value }))}
                  placeholder="e.g. Rev 1, Rev 2, Rev B, As-Built"
                  className="w-full px-3 py-2 text-xs font-mono font-bold border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Workflow Status</label>
                <select
                  value={versionForm.status}
                  onChange={e => setVersionForm(s => ({ ...s, status: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                >
                  <option value="Approved">Approved for Construction (AFC)</option>
                  <option value="As-Built">As-Built Verified</option>
                  <option value="Submitted">Submitted for Approval</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                Replacement Drawing / Document File (Optional — PNG, JPG, PDF, SVG)
              </label>
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.pdf,.svg,.webp,.docx,.xlsx"
                onChange={handleVersionFileChange}
                className="w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
              />
              {versionForm.attachment_name && (
                <p className="text-[11px] text-emerald-700 font-mono mt-1">
                  Selected new sheet file: {versionForm.attachment_name}
                </p>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                Revision Change Summary / Site Update Notes *
              </label>
              <textarea
                required
                rows={3}
                value={versionForm.change_summary}
                onChange={e => setVersionForm(s => ({ ...s, change_summary: e.target.value }))}
                placeholder="e.g. Updated Level 2 Area K lighting circuit L2/C4 routing & incorporated site supervisor redline markings..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={versionForm.carry_over_markings}
                onChange={e => setVersionForm(s => ({ ...s, carry_over_markings: e.target.checked }))}
              />
              Carry forward existing Site Markings (MK pins) onto {versionForm.new_revision}
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setVersionTargetDoc(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploadingVersion}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {uploadingVersion ? 'Publishing Revision...' : `Publish ${versionForm.new_revision}`}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Upload Separate Engineering Drawings or Controlled Documents Modal */}
      {showUploadDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCreateDoc} className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Upload Separate Engineering Drawings / Documents</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Select one or multiple separate CAD sheets (PNG, JPG, PDF, SVG) or contract files. Re-uploading an existing Sheet Number updates it automatically.
                </p>
              </div>
              <button type="button" onClick={() => setShowUploadDoc(false)} className="text-slate-400 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                Select Drawing Sheet(s) or Document File(s) (Multi-Select Supported)
              </label>
              <input
                type="file"
                multiple
                accept=".png,.jpg,.jpeg,.pdf,.svg,.webp,.docx,.xlsx,.csv,.txt"
                onChange={handleFileInput}
                className="w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
              />
            </div>

            {batchFiles.length > 1 ? (
              <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3 space-y-1.5 max-h-40 overflow-y-auto">
                <p className="text-[11px] font-bold text-blue-900">
                  Batch Upload Ready ({batchFiles.length} separate sheets selected):
                </p>
                {batchFiles.map((bf, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[11px] bg-white px-2.5 py-1.5 rounded-lg border border-blue-100">
                    <span className="font-mono font-bold text-blue-700">{bf.document_number}</span>
                    <span className="text-slate-700 truncate max-w-[200px]">{bf.name}</span>
                    <span className="text-[10px] font-semibold text-amber-700">{bf.discipline}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Sheet / Doc No.</label>
                  <input
                    value={docForm.document_number}
                    onChange={e => setDocForm(s => ({ ...s, document_number: e.target.value }))}
                    placeholder="2618-L-LTG-01"
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-xl"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Drawing / Document Title</label>
                  <input
                    required
                    value={docForm.name}
                    onChange={e => setDocForm(s => ({ ...s, name: e.target.value }))}
                    placeholder="e.g. Lighting Layout Level 2 Area K"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-4 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Category</label>
                <select
                  value={docForm.category}
                  onChange={e => setDocForm(s => ({ ...s, category: e.target.value }))}
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-xl"
                >
                  <option value="Drawing">Drawing / Layout</option>
                  <option value="Schematic">Schematic</option>
                  <option value="Schedule">DB Schedule</option>
                  <option value="Contract">Contract</option>
                  <option value="Specification">Specification</option>
                  <option value="BOQ">BOQ</option>
                  <option value="Method Statement">Method Statement</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Discipline</label>
                <select
                  value={docForm.discipline}
                  onChange={e => setDocForm(s => ({ ...s, discipline: e.target.value }))}
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-xl"
                >
                  <option value="Electrical">Electrical</option>
                  <option value="HVAC">HVAC</option>
                  <option value="Fire">Fire</option>
                  <option value="ELV / Data & Security">ELV / Data &amp; Security</option>
                  <option value="Plumbing">Plumbing</option>
                  <option value="Multi-Discipline MEP">Multi-Discipline MEP</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Revision</label>
                <input
                  value={docForm.version}
                  onChange={e => setDocForm(s => ({ ...s, version: e.target.value }))}
                  placeholder="Rev A / Rev 1"
                  className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Status</label>
                <select
                  value={docForm.status}
                  onChange={e => setDocForm(s => ({ ...s, status: e.target.value }))}
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-xl"
                >
                  <option value="Approved">Approved (AFC)</option>
                  <option value="Submitted">Submitted</option>
                  <option value="Draft">Draft / WIP</option>
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
              <button type="button" onClick={() => setShowUploadDoc(false)} className="px-4 py-2 text-xs font-semibold text-slate-600 cursor-pointer">
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploadingDocs}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {uploadingDocs
                  ? 'Uploading...'
                  : batchFiles.length > 1
                  ? `Upload ${batchFiles.length} Drawings`
                  : 'Upload Drawing / Document'}
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

  useEffect(() => {
    const onRealtime = () => loadRisks();
    window.addEventListener('mep-realtime-event', onRealtime);
    return () => window.removeEventListener('mep-realtime-event', onRealtime);
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
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex items-center justify-between">
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

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="py-3.5 px-4">Risk Title</th>
              <th className="py-3.5 px-4">Category</th>
              <th className="py-3.5 px-4 text-center">Prob (1-5)</th>
              <th className="py-3.5 px-4 text-center">Impact (1-5)</th>
              <th className="py-3.5 px-4 text-center">Score</th>
              <th className="py-3.5 px-4">Mitigation Plan</th>
              <th className="py-3.5 px-4">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
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
                  <tr key={r.id} className="hover:bg-slate-50">
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
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
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
          <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">Log New Project Risk</h3>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Risk Title</label>
              <input
                required
                value={form.title}
                onChange={e => setForm(s => ({ ...s, title: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
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
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
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
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Mitigation Action Plan</label>
              <textarea
                rows={3}
                value={form.mitigation_plan}
                onChange={e => setForm(s => ({ ...s, mitigation_plan: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
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
            tab === 'inspections' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'
          }`}
        >
          WIR / Quality Inspections
        </button>
        <button
          onClick={() => setTab('ncrs')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            tab === 'ncrs' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'
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
    primaryField: 'description',
  },
  punchlist: {
    title: 'Snagging & Punch List Register',
    subtitle: 'Track field installation snags, trade contractor rectification, and QA/QC sign-off.',
    badge: 'Field Quality & Snagging',
    primaryField: 'item',
  },
  commissioning: {
    title: 'Testing & Commissioning (T&C) Dossiers',
    subtitle: 'Pre-commissioning prerequisites, witness testing protocols, and statutory certificates.',
    badge: 'System Commissioning',
    primaryField: 'equipment',
  },
  handover: {
    title: 'Handover & O&M Closeout Dossiers',
    subtitle: 'As-built drawings, O&M manuals, asset warranties, and client handover certification.',
    badge: 'Project Handover',
    primaryField: 'description',
  },
  equipment: {
    title: 'Site Plant, Tools & Calibration Register',
    subtitle: 'Track calibrated test instruments, lifting plant, and site equipment allocations.',
    badge: 'Plant & Assets',
    primaryField: 'name',
  },
};

const WorkflowRegisterWorkspace: React.FC<{
  moduleKey: string;
  selectedProject: string;
  user?: any;
}> = ({ moduleKey, selectedProject }) => {
  const meta = MODULE_META[moduleKey] || {
    title: moduleKey.replace(/_/g, ' ').toUpperCase(),
    subtitle: 'Controlled project register and workflow management.',
    badge: 'Operations Register',
    primaryField: 'title',
  };

  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [answerModalRec, setAnswerModalRec] = useState<any | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [form, setForm] = useState<Record<string, any>>({
    title: '',
    question: '',
    description: '',
    discipline: 'Electrical',
    priority: 'High',
    amount: 0,
    location: 'Main Building',
    status: moduleKey === 'rfis' ? 'Open' : moduleKey === 'change_orders' ? 'Potential Variation' : 'Draft',
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

  useEffect(() => {
    const onRealtime = () => loadRecords();
    window.addEventListener('mep-realtime-event', onRealtime);
    return () => window.removeEventListener('mep-realtime-event', onRealtime);
  }, [loadRecords]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetProject = (selectedProject && selectedProject !== 'ALL') ? selectedProject : 'bov-st-venera-2618';
    try {
      await api.post(`/api/${moduleKey}`, {
        project_id: targetProject,
        ...form,
        item: form.title,
        name: form.title,
        equipment: form.title,
        system: form.discipline,
        trade: form.discipline,
        cost_impact: Number(form.amount || 0),
        amount: Number(form.amount || 0),
      });
      setShowAdd(false);
      setForm({
        title: '',
        question: '',
        description: '',
        discipline: 'Electrical',
        priority: 'High',
        amount: 0,
        location: 'Main Building',
        status: moduleKey === 'rfis' ? 'Open' : moduleKey === 'change_orders' ? 'Potential Variation' : 'Draft',
      });
      setActionNotice({ type: 'success', text: 'Record created and synced in real time.' });
      loadRecords();
    } catch (err: any) {
      setActionNotice({ type: 'error', text: err?.message || 'Failed to create record' });
    }
  };

  const handleTransition = async (rec: any, payload: Record<string, any>) => {
    setActionNotice(null);
    try {
      await api.put(`/api/${moduleKey}/${rec.id}`, payload);
      setActionNotice({ type: 'success', text: `Updated ${rec.number || rec.code || rec.id?.slice(0, 8)} → ${payload.status}` });
      loadRecords();
    } catch (err: any) {
      setActionNotice({ type: 'error', text: err?.message || 'Status transition not permitted for your role' });
    }
  };

  const handleAnswerRfiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answerModalRec) return;
    await handleTransition(answerModalRec, { status: 'Answered', answer: answerText });
    setAnswerModalRec(null);
    setAnswerText('');
  };

  const filtered = records.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return JSON.stringify(r).toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
            {meta.badge}
          </span>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">{meta.title}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{meta.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              exportFormalDocumentPdf({
                documentType: `${meta.badge} Register`,
                referenceCode: `REG-${moduleKey.toUpperCase().slice(0, 6)}-${new Date().toISOString().slice(0, 10)}`,
                title: `${meta.title} — Official Controlled Register`,
                subtitle: meta.subtitle,
                projectCode: selectedProject,
                status: `${filtered.length} RECORDS`,
                columns: [
                  { key: 'ref', label: 'Ref / ID' },
                  { key: 'title', label: 'Title / Subject / Description' },
                  { key: 'discipline', label: 'Discipline' },
                  ...(moduleKey === 'change_orders' ? [{ key: 'amount', label: 'Amount (€)', align: 'right' as const }] : []),
                  { key: 'status', label: 'Workflow Status', align: 'center' },
                ],
                rows: filtered.map((r: any) => ({
                  ref: r.number || r.code || r.id?.slice(0, 8),
                  title: r.title || r.question || r.description || 'Untitled Record',
                  discipline: r.discipline || r.trade || 'MEP',
                  amount: `€${Number(r.amount || r.cost_impact || 0).toLocaleString()}`,
                  status: r.status || 'Draft',
                })),
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold shadow-sm"
            title="Export Formal A4 Register (PDF)"
          >
            <Printer size={14} /> Export Formal PDF
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-sm"
          >
            <Plus size={15} /> Create Record
          </button>
        </div>
      </div>

      {actionNotice && (
        <div
          className={`px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between ${
            actionNotice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span>{actionNotice.text}</span>
          <button
            onClick={() => setActionNotice(null)}
            className="text-[11px] font-bold opacity-70 hover:opacity-100 ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${meta.title}...`}
            className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-xl"
          />
        </div>
        <span className="text-xs font-mono text-slate-500">{filtered.length} records</span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="py-3.5 px-4">Ref / ID</th>
              <th className="py-3.5 px-4">Title / Subject</th>
              <th className="py-3.5 px-4">Discipline</th>
              {moduleKey === 'change_orders' && <th className="py-3.5 px-4 text-right">Amount ($)</th>}
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4 text-right">Workflow Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
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
                <tr key={rec.id} className="hover:bg-slate-50/80">
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
                  <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                    {moduleKey === 'rfis' && rec.status === 'Open' && (
                      <button
                        onClick={() => {
                          setAnswerModalRec(rec);
                          setAnswerText(rec.answer || '');
                        }}
                        className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-[11px]"
                      >
                        Answer RFI
                      </button>
                    )}
                    {moduleKey === 'rfis' && (rec.status === 'Open' || rec.status === 'Answered') && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'Closed' })}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px]"
                      >
                        Close
                      </button>
                    )}

                    {moduleKey === 'submittals' && (rec.status === 'Draft' || rec.status === 'Under Preparation') && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'Submitted', submitted_date: new Date().toISOString().slice(0, 10) })}
                        className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-[11px]"
                      >
                        Submit
                      </button>
                    )}
                    {moduleKey === 'submittals' && rec.status === 'Submitted' && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'Under Review' })}
                        className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold text-[11px]"
                      >
                        Start Review
                      </button>
                    )}
                    {moduleKey === 'submittals' && (rec.status === 'Under Review' || rec.status === 'UnderReview') && (
                      <>
                        <button
                          onClick={() => handleTransition(rec, { status: 'Approved', approval_status: 'Approved' })}
                          className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-[11px]"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleTransition(rec, { status: 'Approved with Comments', approval_status: 'Approved with Comments' })}
                          className="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold text-[11px]"
                        >
                          Approve w/ Comments
                        </button>
                        <button
                          onClick={() => handleTransition(rec, { status: 'Revise & Resubmit', approval_status: 'Revise & Resubmit' })}
                          className="px-2.5 py-1 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 font-semibold text-[11px]"
                        >
                          Revise &amp; Resubmit
                        </button>
                        <button
                          onClick={() => handleTransition(rec, { status: 'Rejected', approval_status: 'Rejected' })}
                          className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-[11px]"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {moduleKey === 'submittals' && (rec.status === 'Approved' || rec.status === 'Approved with Comments') && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'Closed' })}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px]"
                      >
                        Close
                      </button>
                    )}

                    {moduleKey === 'change_orders' && (rec.status === 'Potential Variation' || rec.status === 'Draft') && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'Submitted' })}
                        className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-[11px]"
                      >
                        Submit
                      </button>
                    )}
                    {moduleKey === 'change_orders' && (rec.status === 'Submitted' || rec.status === 'Technical Review' || rec.status === 'Commercial Review') && (
                      <>
                        <button
                          onClick={() => handleTransition(rec, { status: 'Approved', approved_amount: rec.approved_amount ?? rec.estimated_amount ?? rec.amount ?? 0 })}
                          className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-[11px]"
                        >
                          Approve Variation
                        </button>
                        <button
                          onClick={() => handleTransition(rec, { status: 'Rejected' })}
                          className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-[11px]"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {moduleKey === 'change_orders' && rec.status === 'Approved' && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'PO Issued' })}
                        className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-[11px]"
                      >
                        Issue PO
                      </button>
                    )}
                    {moduleKey === 'change_orders' && rec.status === 'PO Issued' && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'Certified' })}
                        className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-[11px]"
                      >
                        Certify
                      </button>
                    )}
                    {moduleKey === 'change_orders' && rec.status === 'Certified' && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'Closed' })}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px]"
                      >
                        Close
                      </button>
                    )}

                    {moduleKey === 'inspections' && (rec.status === 'Scheduled' || rec.status === 'In Progress' || rec.status === 'Open') && (
                      <>
                        <button
                          onClick={() => handleTransition(rec, { status: 'Passed', result: 'Pass' })}
                          className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-[11px]"
                        >
                          Pass
                        </button>
                        <button
                          onClick={() => handleTransition(rec, { status: 'Failed', result: 'Fail' })}
                          className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-[11px]"
                        >
                          Fail
                        </button>
                      </>
                    )}
                    {moduleKey === 'inspections' && rec.status === 'Passed' && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'Closed' })}
                        className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px]"
                      >
                        Close
                      </button>
                    )}

                    {moduleKey === 'ncrs' && (rec.status === 'Open' || rec.status === 'Under Investigation') && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'Corrective Action' })}
                        className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold text-[11px]"
                      >
                        Corrective Action
                      </button>
                    )}
                    {moduleKey === 'ncrs' && rec.status === 'Corrective Action' && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'Verification' })}
                        className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-[11px]"
                      >
                        Verify
                      </button>
                    )}
                    {moduleKey === 'ncrs' && rec.status === 'Verification' && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'Closed' })}
                        className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-[11px]"
                      >
                        Close
                      </button>
                    )}

                    {moduleKey === 'punchlist' && (rec.status === 'Open' || rec.status === 'In Progress') && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'Rectified' })}
                        className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold text-[11px]"
                      >
                        Rectify
                      </button>
                    )}
                    {moduleKey === 'punchlist' && rec.status === 'Rectified' && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'Verified' })}
                        className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-[11px]"
                      >
                        Verify
                      </button>
                    )}
                    {moduleKey === 'punchlist' && rec.status === 'Verified' && (
                      <button
                        onClick={() => handleTransition(rec, { status: 'Closed' })}
                        className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-[11px]"
                      >
                        Close
                      </button>
                    )}

                    {!['rfis', 'submittals', 'change_orders', 'inspections', 'ncrs', 'punchlist'].includes(moduleKey) && (
                      <>
                        {rec.status !== 'Approved' && rec.status !== 'Closed' && (
                          <button
                            onClick={() => handleTransition(rec, { status: 'Approved' })}
                            className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-[11px]"
                          >
                            Approve
                          </button>
                        )}
                        {rec.status === 'Approved' && (
                          <button
                            onClick={() => handleTransition(rec, { status: 'Closed' })}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-[11px]"
                          >
                            Close
                          </button>
                        )}
                      </>
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
          <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">New {meta.title} Entry</h3>
            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Subject / Question</label>
              <input
                required
                value={form.title}
                onChange={e => setForm(s => ({ ...s, title: e.target.value, question: e.target.value, description: e.target.value }))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Discipline</label>
                <select
                  value={form.discipline}
                  onChange={e => setForm(s => ({ ...s, discipline: e.target.value }))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
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
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
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

      {answerModalRec && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleAnswerRfiSubmit} className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Answer RFI</h3>
            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <span className="font-bold text-slate-800">{answerModalRec.rfi_number || `RFI-${answerModalRec.id}`}:</span>{' '}
              {answerModalRec.subject || answerModalRec.question || answerModalRec.title}
            </p>
            <div>
              <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Official Engineering Response *</label>
              <textarea
                required
                rows={4}
                value={answerText}
                onChange={e => setAnswerText(e.target.value)}
                placeholder="Enter consultant / engineering response..."
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setAnswerModalRec(null); setAnswerText(''); }} className="px-4 py-2 text-xs font-semibold text-slate-600">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold">Submit Answer</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 6B. COMMISSIONING & HANDOVER WORKSPACE (T&C PREREQUISITES + O&M DOSSIERS)
 * ========================================================================== */
const CommissioningAndHandoverWorkspace: React.FC<{
  initialTab?: 'commissioning' | 'handover';
  selectedProject: string;
  user?: any;
}> = ({ initialTab = 'commissioning', selectedProject, user }) => {
  const [activeTab, setActiveTab] = useState<'commissioning' | 'handover'>(initialTab);
  const [tests, setTests] = useState<any[]>([]);
  const [handoverItems, setHandoverItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showAddTest, setShowAddTest] = useState(false);
  const [showAddHandover, setShowAddHandover] = useState(false);
  const [testForm, setTestForm] = useState({
    system: 'HVAC',
    subsystem: 'Chilled Water',
    equipment: '',
    test_type: 'Functional Performance Test (FPT)',
    test_date: new Date().toISOString().slice(0, 10),
    test_engineer: user?.name || '',
    witness: '',
  });
  const [handoverForm, setHandoverForm] = useState({
    contractor: '',
    system: 'HVAC',
    item_type: 'O&M Manual',
    description: '',
    due_date: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = selectedProject && selectedProject !== 'ALL' ? `?project_id=${selectedProject}` : '';
      const [tRes, hRes] = await Promise.all([
        api.get<any[]>(`/api/commissioning_tests${q}`).catch(() => []),
        api.get<any[]>(`/api/handover_items${q}`).catch(() => []),
      ]);
      setTests(Array.isArray(tRes) ? tRes : []);
      setHandoverItems(Array.isArray(hRes) ? hRes : []);
    } finally {
      setLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handler = (ev: any) => {
      const tbl = ev?.detail?.module || ev?.detail?.table;
      if (!tbl || tbl === 'commissioning_tests' || tbl === 'handover_items' || tbl === '*') {
        load();
      }
    };
    window.addEventListener('mep-realtime-event', handler);
    return () => window.removeEventListener('mep-realtime-event', handler);
  }, [load]);

  const togglePrereq = async (rec: any, field: 'power_available' | 'installation_complete' | 'controls_complete' | 'interface_complete' | 'drawings_approved') => {
    try {
      const nextVal = rec[field] ? 0 : 1;
      await api.put(`/api/commissioning_tests/${rec.id}`, { [field]: nextVal });
      setNotice({ type: 'ok', text: `Updated ${field.replace('_', ' ')} for ${rec.equipment || rec.system}.` });
      load();
    } catch (e: any) {
      setNotice({ type: 'err', text: e?.message || 'Failed to update prerequisite.' });
    }
  };

  const updateTestStatus = async (rec: any, payload: Record<string, any>) => {
    try {
      await api.put(`/api/commissioning_tests/${rec.id}`, payload);
      setNotice({ type: 'ok', text: `Test #${rec.id} transitioned to ${payload.status}.` });
      load();
    } catch (e: any) {
      setNotice({ type: 'err', text: e?.message || 'Failed to update commissioning test.' });
    }
  };

  const updateHandoverStatus = async (rec: any, payload: Record<string, any>) => {
    try {
      await api.put(`/api/handover_items/${rec.id}`, payload);
      setNotice({ type: 'ok', text: `Handover item #${rec.id} transitioned to ${payload.status}.` });
      load();
    } catch (e: any) {
      setNotice({ type: 'err', text: e?.message || 'Failed to update handover dossier.' });
    }
  };

  const handleCreateTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetProject = selectedProject && selectedProject !== 'ALL' ? selectedProject : 'bov-st-venera-2618';
    try {
      await api.post('/api/commissioning_tests', {
        ...testForm,
        project_id: targetProject,
        power_available: 0,
        installation_complete: 0,
        controls_complete: 0,
        interface_complete: 0,
        drawings_approved: 0,
        status: 'Scheduled',
      });
      setShowAddTest(false);
      setTestForm({
        system: 'HVAC',
        subsystem: 'Chilled Water',
        equipment: '',
        test_type: 'Functional Performance Test (FPT)',
        test_date: new Date().toISOString().slice(0, 10),
        test_engineer: user?.name || '',
        witness: '',
      });
      setNotice({ type: 'ok', text: 'Commissioning test scheduled.' });
      load();
    } catch (err: any) {
      setNotice({ type: 'err', text: err?.message || 'Failed to create commissioning test.' });
    }
  };

  const handleCreateHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetProject = selectedProject && selectedProject !== 'ALL' ? selectedProject : 'bov-st-venera-2618';
    try {
      await api.post('/api/handover_items', {
        ...handoverForm,
        project_id: targetProject,
        required: 1,
        submitted: 0,
        approved: 0,
        status: 'Pending',
      });
      setShowAddHandover(false);
      setHandoverForm({
        contractor: '',
        system: 'HVAC',
        item_type: 'O&M Manual',
        description: '',
        due_date: new Date().toISOString().slice(0, 10),
        notes: '',
      });
      setNotice({ type: 'ok', text: 'Handover dossier requirement added.' });
      load();
    } catch (err: any) {
      setNotice({ type: 'err', text: err?.message || 'Failed to create handover item.' });
    }
  };

  const prereqCount = (r: any) =>
    [r.power_available, r.installation_complete, r.controls_complete, r.interface_complete, r.drawings_approved].filter(Boolean).length;

  const readyTests = tests.filter(t => prereqCount(t) === 5).length;
  const passedTests = tests.filter(t => t.status === 'Passed' || t.status === 'Closed' || t.result === 'Pass').length;
  const failedTests = tests.filter(t => t.status === 'Failed' || t.result === 'Fail').length;

  const requiredCount = handoverItems.filter(h => h.required !== 0).length;
  const submittedCount = handoverItems.filter(h => h.submitted === 1 || h.status === 'Submitted' || h.status === 'Approved' || h.status === 'Closed').length;
  const approvedCount = handoverItems.filter(h => h.approved === 1 || h.status === 'Approved' || h.status === 'Closed').length;
  const readinessPct = requiredCount > 0 ? Math.round((approvedCount / requiredCount) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Commissioning &amp; Project Handover</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            T&amp;C prerequisite gates, witness sign-offs, O&amp;M manuals, As-Built dossiers, and formal closeout certificates
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setActiveTab('commissioning')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'commissioning' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Testing &amp; Commissioning ({tests.length})
            </button>
            <button
              onClick={() => setActiveTab('handover')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'handover' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Handover &amp; O&amp;M Dossiers ({handoverItems.length})
            </button>
          </div>
          {activeTab === 'commissioning' ? (
            <>
              <button
                onClick={() =>
                  exportFormalDocumentPdf({
                    documentType: 'T&C CERTIFICATE',
                    referenceCode: `TC-${selectedProject && selectedProject !== 'ALL' ? selectedProject : 'MEP'}-${new Date().toISOString().slice(0, 10)}`,
                    title: 'Testing & Commissioning Register',
                    subtitle: `${selectedProject && selectedProject !== 'ALL' ? selectedProject : 'All Projects'} — Witnessed MEP T&C Status`,
                    projectCode: selectedProject && selectedProject !== 'ALL' ? selectedProject : 'MEP',
                    status: `${passedTests}/${tests.length} PASSED`,
                    columns: [
                      { key: 'id', label: 'ID' },
                      { key: 'system', label: 'System' },
                      { key: 'equipment', label: 'Equipment' },
                      { key: 'test_type', label: 'Test Type' },
                      { key: 'prereqs', label: 'Prereqs', align: 'center' },
                      { key: 'witness', label: 'Witness' },
                      { key: 'status', label: 'Status' },
                    ],
                    rows: tests.map(t => ({
                      id: `TC-${t.id}`,
                      system: `${t.system}${t.subsystem ? ` / ${t.subsystem}` : ''}`,
                      equipment: t.equipment || '—',
                      test_type: t.test_type || 'FPT',
                      prereqs: `${prereqCount(t)}/5`,
                      witness: t.witness || t.test_engineer || '—',
                      status: t.status || 'Scheduled',
                    })),
                  })
                }
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> T&amp;C Certificate PDF
              </button>
              <button
                onClick={() => setShowAddTest(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Schedule T&amp;C Test
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() =>
                  exportFormalDocumentPdf({
                    documentType: 'HANDOVER DOSSIER',
                    referenceCode: `HO-${selectedProject && selectedProject !== 'ALL' ? selectedProject : 'MEP'}-${new Date().toISOString().slice(0, 10)}`,
                    title: 'Project Handover & O&M Closeout Dossier',
                    subtitle: `${selectedProject && selectedProject !== 'ALL' ? selectedProject : 'All Projects'} — Readiness ${readinessPct}%`,
                    projectCode: selectedProject && selectedProject !== 'ALL' ? selectedProject : 'MEP',
                    status: `${approvedCount}/${requiredCount} APPROVED`,
                    columns: [
                      { key: 'id', label: 'ID' },
                      { key: 'contractor', label: 'Contractor' },
                      { key: 'system', label: 'System' },
                      { key: 'deliverable', label: 'Deliverable' },
                      { key: 'due_date', label: 'Due Date' },
                      { key: 'status', label: 'Status' },
                    ],
                    rows: handoverItems.map(h => ({
                      id: `HO-${h.id}`,
                      contractor: h.contractor || '—',
                      system: h.system || '—',
                      deliverable: `${h.item_type || 'Dossier'}: ${h.description || ''}`,
                      due_date: h.due_date || '—',
                      status: h.status || 'Pending',
                    })),
                  })
                }
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Handover Closeout PDF
              </button>
              <button
                onClick={() => setShowAddHandover(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Add Handover Item
              </button>
            </>
          )}
        </div>
      </div>

      {notice && (
        <div
          className={`px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between ${
            notice.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-[11px] font-bold opacity-70 hover:opacity-100 ml-4">
            Dismiss
          </button>
        </div>
      )}

      {activeTab === 'commissioning' ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <div className="text-[11px] font-bold text-slate-500 uppercase">Total T&amp;C Tests</div>
              <div className="text-2xl font-bold text-slate-900 tabular-nums mt-1">{tests.length}</div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <div className="text-[11px] font-bold text-slate-500 uppercase">5/5 Prereqs Ready</div>
              <div className="text-2xl font-bold text-blue-600 tabular-nums mt-1">{readyTests}</div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <div className="text-[11px] font-bold text-slate-500 uppercase">Passed / Witnessed</div>
              <div className="text-2xl font-bold text-emerald-600 tabular-nums mt-1">{passedTests}</div>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <div className="text-[11px] font-bold text-slate-500 uppercase">Failed / Retest</div>
              <div className="text-2xl font-bold text-red-600 tabular-nums mt-1">{failedTests}</div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
                  <th className="py-3 px-4">Test / Equipment</th>
                  <th className="py-3 px-4">System</th>
                  <th className="py-3 px-4">5-Gate Pre-Commissioning Readiness</th>
                  <th className="py-3 px-4">Engineer / Witness</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Witness Sign-Off</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading && tests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">Loading commissioning register...</td>
                  </tr>
                ) : tests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">No commissioning tests scheduled for this project.</td>
                  </tr>
                ) : (
                  tests.map(rec => (
                    <tr key={rec.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{rec.equipment || `Test #${rec.id}`}</div>
                        <div className="text-[11px] text-slate-500">{rec.test_type || 'Functional Performance Test'}</div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">
                        {rec.system}{rec.subsystem ? ` / ${rec.subsystem}` : ''}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap gap-1">
                          {(
                            [
                              ['power_available', 'Power'],
                              ['installation_complete', 'Install'],
                              ['controls_complete', 'Controls'],
                              ['interface_complete', 'Interface'],
                              ['drawings_approved', 'Drawings'],
                            ] as const
                          ).map(([field, label]) => {
                            const active = Boolean(rec[field]);
                            return (
                              <button
                                key={field}
                                type="button"
                                onClick={() => togglePrereq(rec, field)}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors ${
                                  active
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                                }`}
                              >
                                {active ? '✓ ' : ''}{label}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        <div>{rec.test_engineer || '—'}</div>
                        <div className="text-[11px] text-slate-400">{rec.witness ? `Witness: ${rec.witness}` : rec.test_date || '—'}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${WORKFLOW_COLORS[rec.status] || WORKFLOW_COLORS.Draft}`}>
                          {rec.status || 'Scheduled'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                        {rec.status !== 'Passed' && rec.status !== 'Closed' && (
                          <>
                            <button
                              onClick={() =>
                                updateTestStatus(rec, {
                                  status: 'Passed',
                                  result: 'Pass',
                                  witness: rec.witness || user?.name || 'QA/QC Witness',
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-[11px]"
                            >
                              Pass &amp; Witness
                            </button>
                            <button
                              onClick={() => updateTestStatus(rec, { status: 'Failed', result: 'Fail' })}
                              className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-[11px]"
                            >
                              Fail / Retest
                            </button>
                          </>
                        )}
                        {rec.status === 'Passed' && (
                          <button
                            onClick={() => updateTestStatus(rec, { status: 'Closed' })}
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
        </>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase">Required Dossiers</div>
                <div className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{requiredCount}</div>
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase">Submitted</div>
                <div className="text-2xl font-bold text-blue-600 tabular-nums mt-0.5">{submittedCount}</div>
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase">Approved / Signed Off</div>
                <div className="text-2xl font-bold text-emerald-600 tabular-nums mt-0.5">{approvedCount}</div>
              </div>
              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase">Handover Readiness</div>
                <div className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{readinessPct}%</div>
              </div>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, readinessPct))}%` }}
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase">
                  <th className="py-3 px-4">Deliverable / Item</th>
                  <th className="py-3 px-4">Contractor</th>
                  <th className="py-3 px-4">System</th>
                  <th className="py-3 px-4">Due Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Dossier Approvals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading && handoverItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">Loading handover dossiers...</td>
                  </tr>
                ) : handoverItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">No handover items recorded for this project.</td>
                  </tr>
                ) : (
                  handoverItems.map(rec => (
                    <tr key={rec.id} className="hover:bg-slate-50/70">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{rec.item_type || 'Handover Dossier'}</div>
                        <div className="text-[11px] text-slate-500">{rec.description || rec.notes || '—'}</div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">{rec.contractor || '—'}</td>
                      <td className="py-3.5 px-4 text-slate-600">{rec.system || '—'}</td>
                      <td className="py-3.5 px-4 text-slate-600 tabular-nums">{rec.due_date || '—'}</td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${WORKFLOW_COLORS[rec.status] || WORKFLOW_COLORS.Draft}`}>
                          {rec.status || 'Pending'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                        {rec.status !== 'Submitted' && rec.status !== 'Approved' && rec.status !== 'Closed' && (
                          <button
                            onClick={() => updateHandoverStatus(rec, { submitted: 1, status: 'Submitted' })}
                            className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-[11px]"
                          >
                            Mark Submitted
                          </button>
                        )}
                        {rec.status !== 'Approved' && rec.status !== 'Closed' && (
                          <button
                            onClick={() => updateHandoverStatus(rec, { submitted: 1, approved: 1, status: 'Approved' })}
                            className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-[11px]"
                          >
                            Approve Handover Dossier
                          </button>
                        )}
                        {rec.status === 'Approved' && (
                          <button
                            onClick={() => updateHandoverStatus(rec, { status: 'Closed' })}
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
        </>
      )}

      {showAddTest && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateTest} className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Schedule Commissioning Test</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">MEP System</label>
                <input value={testForm.system} onChange={e => setTestForm(s => ({ ...s, system: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" required />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Subsystem</label>
                <input value={testForm.subsystem} onChange={e => setTestForm(s => ({ ...s, subsystem: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Equipment / Tag *</label>
                <input value={testForm.equipment} onChange={e => setTestForm(s => ({ ...s, equipment: e.target.value }))} placeholder="e.g. CH-01 / AHU-L02" className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" required />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Test Type</label>
                <input value={testForm.test_type} onChange={e => setTestForm(s => ({ ...s, test_type: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Test Date</label>
                <input type="date" value={testForm.test_date} onChange={e => setTestForm(s => ({ ...s, test_date: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">T&amp;C Engineer</label>
                <input value={testForm.test_engineer} onChange={e => setTestForm(s => ({ ...s, test_engineer: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Witness</label>
                <input value={testForm.witness} onChange={e => setTestForm(s => ({ ...s, witness: e.target.value }))} placeholder="Consultant / Client" className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddTest(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold">Schedule Test</button>
            </div>
          </form>
        </div>
      )}

      {showAddHandover && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreateHandover} className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Add Handover Dossier Requirement</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Contractor *</label>
                <input value={handoverForm.contractor} onChange={e => setHandoverForm(s => ({ ...s, contractor: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" required />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">System</label>
                <input value={handoverForm.system} onChange={e => setHandoverForm(s => ({ ...s, system: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Deliverable Type</label>
                <select value={handoverForm.item_type} onChange={e => setHandoverForm(s => ({ ...s, item_type: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl bg-white">
                  <option>O&amp;M Manual</option>
                  <option>As-Built Drawings</option>
                  <option>Warranty Certificate</option>
                  <option>T&amp;C Report</option>
                  <option>Training Record</option>
                  <option>Spare Parts List</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Due Date</label>
                <input type="date" value={handoverForm.due_date} onChange={e => setHandoverForm(s => ({ ...s, due_date: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" />
              </div>
              <div className="col-span-2">
                <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Description *</label>
                <input value={handoverForm.description} onChange={e => setHandoverForm(s => ({ ...s, description: e.target.value }))} placeholder="e.g. Chilled Water Plant O&M Manual Vol 1" className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl" required />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowAddHandover(false)} className="px-4 py-2 text-xs font-semibold text-slate-600">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold">Add Dossier</button>
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
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex items-center justify-between">
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
          <div key={c.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">{c.type || c.company_type || 'Subcontractor'}</span>
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
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
            />
            <input
              placeholder="Trade (e.g. HVAC, Electrical)"
              value={form.trade}
              onChange={e => setForm(s => ({ ...s, trade: e.target.value }))}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl"
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
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    username: '',
    password: '',
    role: 'SiteEngineer',
    trade: 'Electrical',
    company: 'Enser Ltd',
    email: '',
    project_id: projects[0]?.id || 'bov-st-venera-2618',
  });

  const loadUsers = useCallback(() => {
    api.get<any[]>('/api/users').then(r => setUsers(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/api/users', {
        ...form,
        project_ids: form.project_id ? [form.project_id] : ['ALL'],
      });
      setShowAdd(false);
      setForm({
        name: '',
        username: '',
        password: '',
        role: 'SiteEngineer',
        trade: 'Electrical',
        company: 'Enser Ltd',
        email: '',
        project_id: projects[0]?.id || 'bov-st-venera-2618',
      });
      loadUsers();
    } catch (err: any) {
      setError(err.message || 'Unable to provision user');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (userId: string) => {
    try {
      await api.post(`/api/users/${userId}/toggle-status`, {});
      loadUsers();
    } catch {}
  };

  const filteredUsers = users.filter(u => roleFilter === 'ALL' || u.role === roleFilter);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
            Identity &amp; Tenant Access Control
          </span>
          <h1 className="text-lg font-bold text-slate-900 mt-1">Users &amp; 8-Role RBAC Matrix</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Role-based access control across Admin, ProjectManager, SiteEngineer, CommercialManager, QAQC, SafetyOfficer, Subcontractor, and Client portals.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-3.5 py-2 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold flex items-center gap-1.5 self-start sm:self-auto"
        >
          <Plus size={14} /> Provision User Account
        </button>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto bg-white border border-slate-200 rounded-lg p-2">
        {['ALL', 'Admin', 'ProjectManager', 'SiteEngineer', 'CommercialManager', 'QAQC', 'SafetyOfficer', 'Subcontractor', 'Client'].map(r => (
          <button
            key={r}
            onClick={() => setRoleFilter(r)}
            className={`px-2.5 py-1 rounded text-xs font-semibold whitespace-nowrap ${
              roleFilter === r ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {r === 'ALL' ? `All Roles (${users.length})` : r}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="py-3 px-4">Full Name</th>
              <th className="py-3 px-4">Username</th>
              <th className="py-3 px-4">Security Role</th>
              <th className="py-3 px-4">Company &amp; Trade</th>
              <th className="py-3 px-4">Project Scope</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {filteredUsers.map((u: any) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="py-3 px-4 font-bold text-slate-900">{u.name || u.username}</td>
                <td className="py-3 px-4 font-mono text-slate-600">{u.username}</td>
                <td className="py-3 px-4">
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200">
                    {u.role}
                  </span>
                </td>
                <td className="py-3 px-4 text-slate-600">
                  {u.company ? `${u.company} · ` : ''}{u.trade || 'All Trades'}
                </td>
                <td className="py-3 px-4 text-slate-500 max-w-[240px] truncate" title={u.project_names}>
                  {u.project_names || (u.project_count > 0 ? `${u.project_count} Project(s)` : 'Assigned Scope')}
                </td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    u.status === 'Inactive' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}>
                    {u.status || 'Active'}
                  </span>
                </td>
                <td className="py-3 px-4 text-right">
                  {u.role !== 'Admin' && (
                    <button
                      onClick={() => handleToggleStatus(u.id)}
                      className="px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-[11px]"
                    >
                      {u.status === 'Inactive' ? 'Activate' : 'Suspend'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form onSubmit={handleProvision} className="bg-white rounded-lg border border-slate-200 shadow-xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-bold text-slate-900 text-base">Provision Enterprise User Account</h3>
              <button type="button" onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 p-2.5 rounded">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
                <input required value={form.name} onChange={e => setForm(s => ({ ...s, name: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md" placeholder="e.g. Marcus Vance" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Username *</label>
                <input required value={form.username} onChange={e => setForm(s => ({ ...s, username: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md" placeholder="e.g. mvance" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Initial Password *</label>
                <input required type="password" value={form.password} onChange={e => setForm(s => ({ ...s, password: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md" placeholder="Minimum 6 characters" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">RBAC Security Role *</label>
                <select value={form.role} onChange={e => setForm(s => ({ ...s, role: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md">
                  <option value="ProjectManager">Project Manager</option>
                  <option value="SiteEngineer">Site Engineer</option>
                  <option value="CommercialManager">Commercial Manager / QS</option>
                  <option value="QAQC">QA/QC &amp; Commissioning Lead</option>
                  <option value="SafetyOfficer">HSE Safety Officer</option>
                  <option value="Subcontractor">Trade Subcontractor</option>
                  <option value="Consultant">Supervising Consultant</option>
                  <option value="Client">Client Representative</option>
                  <option value="Admin">System Administrator</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Organization / Company</label>
                <input value={form.company} onChange={e => setForm(s => ({ ...s, company: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Primary MEP Discipline</label>
                <select value={form.trade} onChange={e => setForm(s => ({ ...s, trade: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md">
                  <option value="Electrical">Electrical</option>
                  <option value="HVAC">HVAC &amp; Mechanical</option>
                  <option value="ELV">ELV &amp; Data</option>
                  <option value="Plumbing">Plumbing &amp; Public Health</option>
                  <option value="Fire Fighting">Fire Protection</option>
                  <option value="General MEP">All MEP Trades</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Project Scope</label>
              <select value={form.project_id} onChange={e => setForm(s => ({ ...s, project_id: e.target.value }))} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md">
                <option value="ALL">All Enterprise Projects</option>
                {projects.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.code || p.id})</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button type="button" onClick={() => setShowAdd(false)} className="px-3.5 py-2 text-xs font-semibold text-slate-600 border border-slate-300 rounded-md">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-md bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold disabled:opacity-50">
                {saving ? 'Provisioning...' : 'Provision Account'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 9. IMMUTABLE AUDIT TRAIL WORKSPACE
 * ========================================================================== */
const AuditTrailWorkspace: React.FC<{ selectedProject: string }> = ({ selectedProject }) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadLogs = useCallback(() => {
    setLoading(true);
    const q = selectedProject ? `?project_id=${selectedProject}` : '';
    api.get<any[]>(`/api/audit_logs${q}`)
      .then(r => setLogs(Array.isArray(r) ? r : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedProject]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Real-time SSE stream for Audit Trail
  useEffect(() => {
    const onRealtime = () => loadLogs();
    window.addEventListener('mep-realtime-event', onRealtime);
    return () => window.removeEventListener('mep-realtime-event', onRealtime);
  }, [loadLogs]);

  const filtered = logs.filter(l => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (l.user_name || l.user_id || '').toLowerCase().includes(q) ||
      (l.module || '').toLowerCase().includes(q) ||
      (l.action || '').toLowerCase().includes(q) ||
      (l.record_id || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-300">
            Compliance &amp; Forensics
          </span>
          <h1 className="text-lg font-bold text-slate-900 mt-1">Immutable Enterprise Audit Trail</h1>
          <p className="text-xs text-slate-500 mt-0.5">Chronological ledger of all project mutations, status transitions, and security events ({filtered.length} entries).</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter actor, module, action..."
              className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md w-56"
            />
          </div>
          <button onClick={loadLogs} className="p-2 border border-slate-300 rounded-md hover:bg-slate-50 text-slate-600" title="Refresh Audit Trail">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div className="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="py-3 px-4">UTC Timestamp</th>
              <th className="py-3 px-4">Actor</th>
              <th className="py-3 px-4">Module</th>
              <th className="py-3 px-4">Operation</th>
              <th className="py-3 px-4">Project Scope</th>
              <th className="py-3 px-4">Record Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {loading ? (
              <tr><td colSpan={6} className="py-10 text-center text-slate-400">Loading forensic audit ledger...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-slate-500">No audit entries match the current filter.</td></tr>
            ) : (
              filtered.map((l: any) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono text-slate-500 tabular-nums">{(l.timestamp || l.created_at || '').replace('T', ' ').slice(0, 19)}</td>
                  <td className="py-2.5 px-4 font-semibold text-slate-900">{l.user_name || l.user_id}</td>
                  <td className="py-2.5 px-4"><span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px]">{l.module}</span></td>
                  <td className="py-2.5 px-4 font-bold text-blue-700 uppercase">{l.action}</td>
                  <td className="py-2.5 px-4 text-slate-600">{l.project_name || l.project_id || 'SYSTEM'}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-500">{l.record_id}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
