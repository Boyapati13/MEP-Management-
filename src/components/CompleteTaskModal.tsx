import React, { useState, useEffect } from 'react';
import { X, Camera, Check, ShieldCheck, Calendar, FileText, UploadCloud, AlertCircle, Eye, Trash2 } from 'lucide-react';
import { tasksApi } from '../api';

interface CompleteTaskModalProps {
  open: boolean;
  task: any | null;
  onClose: () => void;
  onCompleted: () => void;
  onToast: (type: 'success' | 'error', message: string) => void;
}

export function CompleteTaskModal({ open, task, onClose, onCompleted, onToast }: CompleteTaskModalProps) {
  const [evidenceUrl, setEvidenceUrl] = useState<string>('');
  const [evidenceNotes, setEvidenceNotes] = useState<string>('');
  const [actualEndDate, setActualEndDate] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(false);

  useEffect(() => {
    if (task) {
      setEvidenceUrl(task.evidence_url || '');
      setEvidenceNotes(task.evidence_notes || '');
      setActualEndDate(task.actual_end_date || new Date().toISOString().slice(0, 10));
    }
  }, [task, open]);

  if (!open || !task) return null;

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setEvidenceUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await tasksApi.completeWithEvidence(task.id, {
        evidence_url: evidenceUrl || undefined,
        evidence_notes: evidenceNotes || undefined,
        actual_end_date: actualEndDate || new Date().toISOString().slice(0, 10)
      });
      onToast('success', `Task marked as DONE and evidence photo archived!`);
      onCompleted();
      onClose();
    } catch (err: any) {
      onToast('error', err.message || 'Failed to complete task');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-gray-100 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-emerald-600 to-teal-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center">
              <Camera size={22} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Complete Task &amp; Attach Evidence</h2>
              <p className="text-xs text-emerald-100 font-medium">Verify physical execution with field photographic proof</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Task Info Summary */}
        <div className="p-4 bg-emerald-50/60 border-b border-emerald-100/80 flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {task.wbs_code && (
              <span className="font-mono font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-200">
                {task.wbs_code}
              </span>
            )}
            {task.boq_ref && (
              <span className="font-mono text-gray-700 bg-white px-2 py-0.5 rounded border border-gray-200">
                BOQ Ref: {task.boq_ref}
              </span>
            )}
            {task.trade && (
              <span className="font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                {task.trade}
              </span>
            )}
          </div>
          <h3 className="font-bold text-gray-900 text-sm mt-1">{task.title}</h3>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          
          {/* Evidence Photo Uploader */}
          <div>
            <label className="block text-xs font-bold text-gray-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <ShieldCheck size={16} className="text-emerald-600" />
              Field Evidence Photo <span className="text-emerald-600 font-semibold">(Recommended)</span>
            </label>

            {evidenceUrl ? (
              <div className="relative group rounded-2xl overflow-hidden border-2 border-emerald-400 bg-slate-900 shadow-md">
                <img
                  src={evidenceUrl}
                  alt="Evidence Preview"
                  className="w-full h-52 object-cover cursor-pointer hover:opacity-95 transition-opacity"
                  onClick={() => setPreviewZoom(true)}
                />
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 bg-slate-900/80 backdrop-blur-md p-1.5 rounded-xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => setPreviewZoom(true)}
                    className="p-1.5 text-white hover:text-emerald-300 rounded-lg hover:bg-white/10 transition-colors"
                    title="Zoom Photo"
                  >
                    <Eye size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEvidenceUrl('')}
                    className="p-1.5 text-red-300 hover:text-red-400 rounded-lg hover:bg-white/10 transition-colors"
                    title="Remove Photo"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="absolute bottom-2 left-2 right-2 bg-slate-900/85 backdrop-blur-sm px-3 py-1.5 rounded-xl text-xs text-emerald-400 flex items-center justify-between font-mono">
                  <span className="flex items-center gap-1"><ShieldCheck size={14} /> Evidence Attached</span>
                  <span className="text-gray-400 text-[11px]">Click image to expand</span>
                </div>
              </div>
            ) : (
              <div className="border-2 border-dashed border-gray-300 hover:border-emerald-500 transition-colors rounded-2xl p-6 text-center bg-gray-50/50 hover:bg-emerald-50/20 group">
                <input
                  type="file"
                  id="complete_evidence_photo_input"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoSelect}
                  className="hidden"
                />
                <label htmlFor="complete_evidence_photo_input" className="cursor-pointer flex flex-col items-center justify-center space-y-2">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center group-hover:scale-105 transition-transform shadow-xs">
                    <Camera size={26} />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-emerald-700 group-hover:underline">
                      Snap Photo or Browse File
                    </span>
                    <p className="text-xs text-gray-500 mt-1">
                      Direct camera capture on phone/tablet or upload from device (JPG, PNG, WebP)
                    </p>
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* Actual Completion Date */}
          <div>
            <label className="block text-xs font-bold text-gray-800 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Calendar size={14} className="text-gray-500" />
              Actual Completion Date
            </label>
            <input
              type="date"
              value={actualEndDate}
              onChange={e => setActualEndDate(e.target.value)}
              required
              className="w-full text-xs font-semibold px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-gray-900"
            />
          </div>

          {/* Notes & Acceptance Comments */}
          <div>
            <label className="block text-xs font-bold text-gray-800 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <FileText size={14} className="text-gray-500" />
              Signoff Notes &amp; Verification Details
            </label>
            <textarea
              rows={3}
              value={evidenceNotes}
              onChange={e => setEvidenceNotes(e.target.value)}
              placeholder="e.g. All 130 lighting containment points inspected and verified against IFC revision 3. Installation verified 100% complete."
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-gray-900 resize-none"
            />
          </div>

          {/* Modal Actions */}
          <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <Check size={16} />
              {saving ? 'Completing Task...' : 'Confirm DONE & Save Evidence'}
            </button>
          </div>
        </form>
      </div>

      {/* Full Photo Zoom Modal */}
      {previewZoom && evidenceUrl && (
        <div className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setPreviewZoom(false)}>
          <div className="relative max-w-4xl max-h-[92vh] bg-slate-900 rounded-3xl overflow-hidden border border-slate-700 shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/80 text-white">
              <span className="text-xs font-bold font-mono text-emerald-400">EVIDENCE PHOTO FULLSCREEN</span>
              <button onClick={() => setPreviewZoom(false)} className="p-1.5 text-gray-400 hover:text-white rounded-xl">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 flex items-center justify-center bg-black/50 overflow-auto">
              <img src={evidenceUrl} alt="Zoomed Evidence" className="max-h-[75vh] w-auto max-w-full object-contain rounded-xl" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
