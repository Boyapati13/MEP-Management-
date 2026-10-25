import React, { useState, useRef, type FormEvent } from 'react';
import {
  X,
  Upload,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Building2,
  Calendar,
  DollarSign,
  MapPin,
  Layers,
  HardHat,
  Shield,
  Loader2,
  RotateCcw,
  Check
} from 'lucide-react';
import { projectsApi, documentsApi } from '../api';

interface CreateProjectModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (project: any) => void;
  initialData?: any;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  open,
  onClose,
  onSuccess,
  initialData
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [extractSuccess, setExtractSuccess] = useState(false);
  const [extractedMeta, setExtractedMeta] = useState<any | null>(null);
  const [autoFilledFields, setAutoFilledFields] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    code: initialData?.code || `PRJ-${Math.floor(100 + Math.random() * 900)}`,
    client: initialData?.client || '',
    status: initialData?.status || 'Active',
    stage: initialData?.stage || 'Construction',
    contract_type: initialData?.contract_type || 'Lump Sum EPC',
    currency: initialData?.currency || 'USD',
    budget: initialData?.budget ? String(initialData.budget) : '',
    main_contractor: initialData?.main_contractor || '',
    consultant: initialData?.consultant || '',
    location: initialData?.location || '',
    start_date: initialData?.start_date || new Date().toISOString().split('T')[0],
    end_date: initialData?.end_date || '',
    description: initialData?.description || '',
    apply_work_packages: true,
    archive_document: true,
  });

  if (!open) return null;

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processDocument(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processDocument(e.target.files[0]);
    }
  };

  const processDocument = async (selectedFile: File) => {
    setFile(selectedFile);
    setError(null);
    setExtracting(true);
    setExtractSuccess(false);

    try {
      const res = await projectsApi.parseDocument(selectedFile);
      const ext = res?.extracted || {};
      const filled = new Set<string>();

      setExtractedMeta({
        ...ext,
        documentCategory: res?.document_category || 'Contract Agreement',
        boqSummary: res?.boq_summary,
        boqItemsCount: res?.boq_items?.length || 0,
        filename: selectedFile.name,
        filesize: (selectedFile.size / 1024).toFixed(1) + ' KB'
      });

      setFormData(prev => {
        const next = { ...prev };
        if (ext.projectName) { next.name = ext.projectName; filled.add('name'); }
        if (ext.projectCode) { next.code = ext.projectCode; filled.add('code'); }
        if (ext.client) { next.client = ext.client; filled.add('client'); }
        if (ext.budget && ext.budget > 0) { next.budget = String(ext.budget); filled.add('budget'); }
        if (ext.currency) { next.currency = ext.currency; filled.add('currency'); }
        if (ext.contractType) { next.contract_type = ext.contractType; filled.add('contract_type'); }
        if (ext.stage) { next.stage = ext.stage; filled.add('stage'); }
        if (ext.mainContractor) { next.main_contractor = ext.mainContractor; filled.add('main_contractor'); }
        if (ext.consultant) { next.consultant = ext.consultant; filled.add('consultant'); }
        if (ext.location) { next.location = ext.location; filled.add('location'); }
        if (ext.startDate) { next.start_date = ext.startDate; filled.add('start_date'); }
        if (ext.endDate) { next.end_date = ext.endDate; filled.add('end_date'); }
        if (ext.scopeDescription) { next.description = ext.scopeDescription; filled.add('description'); }
        return next;
      });

      setAutoFilledFields(filled);
      setExtractSuccess(true);
    } catch (err: any) {
      console.warn('Document parse warning, falling back to manual entry:', err);
      setError(`Notice: Could not auto-extract all fields (${err.message || 'unsupported text format'}). You can continue and fill manually.`);
    } finally {
      setExtracting(false);
    }
  };

  const handleClearDocument = () => {
    setFile(null);
    setExtractedMeta(null);
    setExtractSuccess(false);
    setAutoFilledFields(new Set());
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.client.trim()) {
      setError('Project Name and Client / Employer are required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let createdProject: any = null;

      if (file && formData.apply_work_packages) {
        // Full Contractor Doc Ingestion Pipeline:
        // Automatically creates project, decomposes work packages, schedules tasks, links contractors
        const result = await projectsApi.uploadContractorDoc(file, undefined);
        createdProject = result?.project;

        // Also ensure user adjustments to form fields are persisted
        if (createdProject?.id) {
          const updated = await projectsApi.update(createdProject.id, {
            name: formData.name,
            code: formData.code,
            project_code: formData.code,
            client: formData.client,
            client_name: formData.client,
            status: formData.status,
            stage: formData.stage,
            contract_type: formData.contract_type,
            currency: formData.currency,
            budget: formData.budget ? Number(formData.budget) : createdProject.budget,
            contract_value: formData.budget ? Number(formData.budget) : createdProject.budget,
            location: formData.location || createdProject.location,
            main_contractor: formData.main_contractor || createdProject.main_contractor,
            consultant: formData.consultant || createdProject.consultant,
            start_date: formData.start_date || createdProject.start_date,
            end_date: formData.end_date || createdProject.end_date,
            description: formData.description || createdProject.description,
          });
          createdProject = { ...createdProject, ...updated };
        }
      } else {
        // Standard Project Creation
        const payload = {
          name: formData.name,
          code: formData.code,
          project_code: formData.code,
          client: formData.client,
          client_name: formData.client,
          status: formData.status,
          stage: formData.stage,
          contract_type: formData.contract_type,
          currency: formData.currency,
          budget: formData.budget ? Number(formData.budget) : 0,
          contract_value: formData.budget ? Number(formData.budget) : 0,
          location: formData.location || undefined,
          main_contractor: formData.main_contractor || undefined,
          consultant: formData.consultant || undefined,
          start_date: formData.start_date || undefined,
          end_date: formData.end_date || undefined,
          description: formData.description || undefined,
        };
        createdProject = await projectsApi.create(payload);

        // Archive document if requested
        if (file && createdProject?.id && formData.archive_document) {
          try {
            const reader = new FileReader();
            reader.onload = async () => {
              await documentsApi.create({
                project_id: createdProject.id,
                name: file.name.replace(/\.[^.]+$/, ''),
                category: 'Contract / Tender',
                revision: 'Rev 0',
                date_added: new Date().toISOString().split('T')[0],
                attachment_name: file.name,
                attachment_data: String(reader.result || ''),
                status: 'Approved',
                visibility: 'All'
              }).catch(() => null);
            };
            reader.readAsDataURL(file);
          } catch {}
        }
      }

      onSuccess(createdProject);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = "w-full px-3.5 py-2.5 text-xs bg-white border border-stone-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all";
  const selectCls = "w-full px-3.5 py-2.5 text-xs bg-white border border-stone-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl border border-stone-200 shadow-2xl w-full max-w-3xl my-auto overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-5 border-b border-stone-100 flex items-center justify-between bg-gradient-to-r from-stone-50 via-blue-50/30 to-indigo-50/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Building2 size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Create New MEP Project</h2>
              <p className="text-xs text-slate-500">
                Upload your project contract or tender document to auto-fill complete info, or enter manually.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl border border-stone-200 hover:bg-stone-100 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-800">
              <AlertCircle size={16} className="text-rose-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {/* 1. DOCUMENT UPLOAD & AUTO-FILL DROPZONE */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5 uppercase tracking-wider">
                <Sparkles size={14} className="text-blue-600" />
                Project Document Upload &amp; Complete Info Auto-Fill
              </label>
              <span className="text-[11px] text-blue-600 font-semibold">Supports .pdf, .xlsx, .docx, .csv, .txt</span>
            </div>

            {!file ? (
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer ${
                  dragActive
                    ? 'border-blue-500 bg-blue-50/60'
                    : 'border-blue-200 bg-blue-50/20 hover:border-blue-400 hover:bg-blue-50/40'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.xlsx,.xls,.docx,.csv,.tsv,.txt"
                  className="hidden"
                  onChange={handleFileInput}
                />
                <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 mx-auto flex items-center justify-center mb-3 shadow-inner">
                  {extracting ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
                </div>
                <p className="text-sm font-bold text-slate-800">
                  {extracting ? 'Analyzing document & auto-filling fields...' : 'Drag & drop contract, subcontract, or BOQ file here'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  or <span className="text-blue-600 font-semibold underline">browse file from your computer</span>
                </p>
                <div className="flex items-center justify-center gap-2 mt-3">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white border border-stone-200 text-slate-600">Contract / Agreement</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white border border-stone-200 text-slate-600">BOQ / Tender</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white border border-stone-200 text-slate-600">Scope of Work</span>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center flex-shrink-0">
                      <FileText size={20} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900 truncate max-w-sm">{file.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {extractedMeta?.filesize} • {extractedMeta?.documentCategory || 'Contract'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-white border border-blue-200 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      onClick={handleClearDocument}
                      className="px-2.5 py-1 text-xs font-semibold text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {extractSuccess && extractedMeta && (
                  <div className="pt-2 border-t border-blue-200/60 flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                      <CheckCircle2 size={13} /> Complete Info Auto-Filled ({autoFilledFields.size} fields)
                    </span>
                    {extractedMeta.trades?.map((t: string) => (
                      <span key={t} className="px-2 py-0.5 rounded-md font-semibold text-[10px] bg-indigo-100 text-indigo-800 border border-indigo-200">
                        {t}
                      </span>
                    ))}
                    {extractedMeta.boqItemsCount > 0 && (
                      <span className="px-2 py-0.5 rounded-md font-semibold text-[10px] bg-amber-100 text-amber-800 border border-amber-200">
                        {extractedMeta.boqItemsCount} BOQ Items Extracted
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. PROJECT MASTER DETAILS */}
          <div className="space-y-4 pt-1">
            <div className="flex items-center justify-between border-b border-stone-100 pb-2">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 size={14} className="text-slate-600" />
                Project Master &amp; Commercial Info
              </h3>
              <span className="text-[11px] text-slate-400">* Required fields</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Project Name * {autoFilledFields.has('name') && <span className="text-emerald-600 lowercase font-normal">(auto-filled)</span>}
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData(d => ({ ...d, name: e.target.value }))}
                  placeholder="e.g. Burj Crown Commercial Tower MEP Package"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Project Code {autoFilledFields.has('code') && <span className="text-emerald-600 lowercase font-normal">(auto-filled)</span>}
                </label>
                <input
                  type="text"
                  value={formData.code}
                  onChange={e => setFormData(d => ({ ...d, code: e.target.value }))}
                  placeholder="e.g. PRJ-BC-892"
                  className={inputCls}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Client / Employer * {autoFilledFields.has('client') && <span className="text-emerald-600 lowercase font-normal">(auto-filled)</span>}
                </label>
                <input
                  type="text"
                  required
                  value={formData.client}
                  onChange={e => setFormData(d => ({ ...d, client: e.target.value }))}
                  placeholder="e.g. Emaar Development PJSC"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Contract Value / Budget {autoFilledFields.has('budget') && <span className="text-emerald-600 lowercase font-normal">(auto-filled)</span>}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={formData.budget}
                    onChange={e => setFormData(d => ({ ...d, budget: e.target.value }))}
                    placeholder="e.g. 4850000"
                    className={inputCls}
                  />
                  <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-400">{formData.currency}</span>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Currency</label>
                <select
                  value={formData.currency}
                  onChange={e => setFormData(d => ({ ...d, currency: e.target.value }))}
                  className={selectCls}
                >
                  <option value="USD">USD ($)</option>
                  <option value="AED">AED (AED)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="SAR">SAR (SAR)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="QAR">QAR (QAR)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Status</label>
                <select
                  value={formData.status}
                  onChange={e => setFormData(d => ({ ...d, status: e.target.value }))}
                  className={selectCls}
                >
                  <option value="Active">Active</option>
                  <option value="Planning">Planning</option>
                  <option value="Delayed">Delayed</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Contract Type</label>
                <select
                  value={formData.contract_type}
                  onChange={e => setFormData(d => ({ ...d, contract_type: e.target.value }))}
                  className={selectCls}
                >
                  <option value="Lump Sum EPC">Lump Sum EPC</option>
                  <option value="Design & Build">Design &amp; Build</option>
                  <option value="Cost Plus">Cost Plus</option>
                  <option value="Re-measurable Unit Rate">Re-measurable Unit Rate</option>
                  <option value="Fixed Price">Fixed Price</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Current Stage</label>
                <select
                  value={formData.stage}
                  onChange={e => setFormData(d => ({ ...d, stage: e.target.value }))}
                  className={selectCls}
                >
                  <option value="Mobilization">Mobilization</option>
                  <option value="Engineering">Engineering</option>
                  <option value="Procurement">Procurement</option>
                  <option value="Construction">Construction</option>
                  <option value="Testing & Commissioning">Testing &amp; Commissioning</option>
                  <option value="Handover">Handover</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Main Contractor / JV Partner {autoFilledFields.has('main_contractor') && <span className="text-emerald-600 lowercase font-normal">(auto-filled)</span>}
                </label>
                <input
                  type="text"
                  value={formData.main_contractor}
                  onChange={e => setFormData(d => ({ ...d, main_contractor: e.target.value }))}
                  placeholder="e.g. Arabtec / BK Gulf MEP JV"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Lead Consultant / Supervising Engineer {autoFilledFields.has('consultant') && <span className="text-emerald-600 lowercase font-normal">(auto-filled)</span>}
                </label>
                <input
                  type="text"
                  value={formData.consultant}
                  onChange={e => setFormData(d => ({ ...d, consultant: e.target.value }))}
                  placeholder="e.g. WSP Middle East"
                  className={inputCls}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-1">
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Site Location / Plot {autoFilledFields.has('location') && <span className="text-emerald-600 lowercase font-normal">(auto-filled)</span>}
                </label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={e => setFormData(d => ({ ...d, location: e.target.value }))}
                  placeholder="e.g. Plot 42, Downtown Dubai, UAE"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Start Date {autoFilledFields.has('start_date') && <span className="text-emerald-600 lowercase font-normal">(auto-filled)</span>}
                </label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={e => setFormData(d => ({ ...d, start_date: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Target Completion Date {autoFilledFields.has('end_date') && <span className="text-emerald-600 lowercase font-normal">(auto-filled)</span>}
                </label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={e => setFormData(d => ({ ...d, end_date: e.target.value }))}
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                Project Scope &amp; Engineering Specifications {autoFilledFields.has('description') && <span className="text-emerald-600 lowercase font-normal">(auto-filled)</span>}
              </label>
              <textarea
                rows={2}
                value={formData.description}
                onChange={e => setFormData(d => ({ ...d, description: e.target.value }))}
                placeholder="Comprehensive description of MEP scope (HVAC, Electrical, Plumbing, Fire Fighting, ELV, Testing & Commissioning)..."
                className={inputCls}
              />
            </div>

            {/* Ingestion Options if file uploaded */}
            {file && (
              <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
                  <input
                    type="checkbox"
                    checked={formData.apply_work_packages}
                    onChange={e => setFormData(d => ({ ...d, apply_work_packages: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 rounded border-stone-300 focus:ring-blue-500"
                  />
                  <span>Decompose Trade Work Packages (HVAC, Electrical, Plumbing, Fire) and Milestones from document</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
                  <input
                    type="checkbox"
                    checked={formData.archive_document}
                    onChange={e => setFormData(d => ({ ...d, archive_document: e.target.checked }))}
                    className="w-4 h-4 text-blue-600 rounded border-stone-300 focus:ring-blue-500"
                  />
                  <span>Archive &amp; store uploaded document in project documents repository as Contract / Tender</span>
                </label>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-stone-100">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-stone-100 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || extracting}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 transition-all cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Creating Project &amp; Initializing Modules...
                </>
              ) : (
                <>
                  <Check size={15} />
                  Create Project &amp; Save Complete Info
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
