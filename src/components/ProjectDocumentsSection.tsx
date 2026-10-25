import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Folder,
  Upload,
  FileText,
  Search,
  Download,
  Trash2,
  Sparkles,
  CheckCircle2,
  Eye,
  RefreshCw,
  Plus,
  Filter,
  Check,
  AlertCircle,
  FileSpreadsheet,
  Image as ImageIcon
} from 'lucide-react';
import { api, documentsApi, projectsApi } from '../api';

interface ProjectDocumentsSectionProps {
  projectId: string;
  projectName?: string;
  onProjectUpdated?: () => void;
  canManage?: boolean;
}

export const ProjectDocumentsSection: React.FC<ProjectDocumentsSectionProps> = ({
  projectId,
  projectName,
  onProjectUpdated,
  canManage = true,
}) => {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedDocForPreview, setSelectedDocForPreview] = useState<any | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadCategory, setUploadCategory] = useState('Contract / Tender');
  const [docDiscipline, setDocDiscipline] = useState('General');

  const loadDocuments = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const list = await documentsApi.list(projectId).catch(() => []);
      setDocs(Array.isArray(list) ? list : []);
    } catch (err: any) {
      console.error('Failed to load documents:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !projectId) return;

    setUploading(true);
    setStatusMsg(null);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const attData = String(reader.result || '');
        await documentsApi.create({
          project_id: projectId,
          name: file.name.replace(/\.[^.]+$/, ''),
          category: uploadCategory,
          discipline: docDiscipline,
          revision: 'Rev 0',
          date_added: new Date().toISOString().split('T')[0],
          attachment_name: file.name,
          attachment_data: attData,
          status: 'Approved',
          visibility: 'All',
        });

        setStatusMsg({
          type: 'success',
          text: `Document "${file.name}" uploaded successfully into project repository!`,
        });
        await loadDocuments();
      } catch (err: any) {
        setStatusMsg({
          type: 'error',
          text: `Upload failed: ${err?.message || 'Error saving document'}`,
        });
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      setStatusMsg({ type: 'error', text: 'Failed to read file from disk' });
      setUploading(false);
    };

    reader.readAsDataURL(file);
  };

  const handleSyncDocumentWithProject = async (doc: any) => {
    if (!doc?.id || !projectId) return;
    setSyncing(true);
    setStatusMsg(null);

    try {
      const res = await projectsApi.extractSetupData(projectId, [doc.id], true);
      setStatusMsg({
        type: 'success',
        text: `✓ Project Master, Budget & Work Packages synchronized from "${doc.name || doc.attachment_name}"!`,
      });
      onProjectUpdated?.();
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: `Sync error: ${err?.message || 'Failed to extract info from document'}`,
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async (docId: string, name: string) => {
    if (!confirm(`Are you sure you want to delete document "${name}"?`)) return;
    try {
      await documentsApi.delete(docId);
      setStatusMsg({ type: 'success', text: `Document "${name}" deleted` });
      loadDocuments();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Failed to delete document' });
    }
  };

  const categories = [
    'All',
    'Contract / Tender',
    'BOQ',
    'Drawings / BIM',
    'Specification',
    'Method Statement',
    'Inspection / NCR',
    'Site Photo',
  ];

  const filtered = docs.filter(d => {
    const matchesCat = categoryFilter === 'All' || d.category === categoryFilter;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      String(d.name || '').toLowerCase().includes(q) ||
      String(d.attachment_name || '').toLowerCase().includes(q) ||
      String(d.category || '').toLowerCase().includes(q) ||
      String(d.discipline || '').toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Status banner */}
      {statusMsg && (
        <div
          className={`p-4 rounded-2xl border flex items-center justify-between text-xs font-semibold ${
            statusMsg.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <span>{statusMsg.text}</span>
          <button
            onClick={() => setStatusMsg(null)}
            className="opacity-70 hover:opacity-100 hover:underline ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top Banner & Quick Upload Card */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-blue-100 text-blue-800 border border-blue-200">
              Project Documents Store
            </span>
            <span className="text-xs text-slate-500 font-mono">
              {docs.length} Document{docs.length === 1 ? '' : 's'} on record
            </span>
          </div>
          <h2 className="text-xl font-bold text-slate-900 mt-1">
            Contract, Drawings &amp; Specifications Repository
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
            Upload and access project agreements, BIM models, BOQs, shop drawings, submittals, and specifications for {projectName || 'this project'}.
          </p>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={uploadCategory}
              onChange={e => setUploadCategory(e.target.value)}
              className="px-3 py-2 text-xs border border-stone-200 rounded-xl bg-stone-50 font-medium text-slate-700"
            >
              <option value="Contract / Tender">Contract / Tender</option>
              <option value="BOQ">BOQ / Tender Schedule</option>
              <option value="Drawings / BIM">Drawings / BIM</option>
              <option value="Specification">Specification</option>
              <option value="Method Statement">Method Statement</option>
              <option value="Site Photo">Site Photo</option>
            </select>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.docx,.csv,.tsv,.txt,.png,.jpg,.jpeg"
              className="hidden"
              onChange={handleFileUpload}
            />

            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <Upload size={14} />
              {uploading ? 'Uploading Document...' : 'Upload Document'}
            </button>
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search documents by title, file name, trade, category..."
            className="w-full pl-9 pr-4 py-2 text-xs border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                categoryFilter === cat
                  ? 'bg-slate-900 text-white'
                  : 'bg-stone-100 text-slate-600 hover:bg-stone-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Documents Grid / Table */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-blue-600" />
            Loading project documents...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            <Folder size={36} className="mx-auto mb-2 text-slate-300" />
            <p className="font-semibold text-slate-700">No documents found</p>
            <p className="text-slate-400 mt-0.5">Upload a contract, drawing, or BOQ to get started.</p>
            {canManage && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                Upload First Document
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {filtered.map(doc => {
              const filename = doc.attachment_name || `${doc.name}.pdf`;
              const isPdf = filename.toLowerCase().endsWith('.pdf');
              const isXlsx = filename.toLowerCase().endsWith('.xlsx') || filename.toLowerCase().endsWith('.xls');
              const isImage = filename.toLowerCase().match(/\.(png|jpe?g|webp)$/);

              return (
                <div
                  key={doc.id}
                  className="p-4 hover:bg-stone-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center flex-shrink-0 text-blue-600">
                      {isXlsx ? <FileSpreadsheet size={20} /> : isImage ? <ImageIcon size={20} /> : <FileText size={20} />}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{doc.name || filename}</span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          {doc.category || 'General'}
                        </span>
                        {doc.revision && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                            {doc.revision}
                          </span>
                        )}
                        {doc.discipline && doc.discipline !== 'General' && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            {doc.discipline}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                        <span>File: <strong className="text-slate-600">{filename}</strong></span>
                        <span>•</span>
                        <span>Added: {doc.date_added || 'Recently'}</span>
                        {doc.uploaded_by && (
                          <>
                            <span>•</span>
                            <span>By: {doc.uploaded_by}</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {canManage && (
                      <button
                        type="button"
                        disabled={syncing}
                        onClick={() => handleSyncDocumentWithProject(doc)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-semibold transition-colors cursor-pointer"
                        title="Extract & sync document info to Project Master"
                      >
                        <Sparkles size={12} className="text-amber-600" />
                        Sync Project Info
                      </button>
                    )}

                    {doc.attachment_data && (
                      <a
                        href={doc.attachment_data}
                        download={filename}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <Download size={13} />
                        Download
                      </a>
                    )}

                    {canManage && (
                      <button
                        type="button"
                        onClick={() => handleDelete(doc.id, doc.name || filename)}
                        className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        title="Delete Document"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
