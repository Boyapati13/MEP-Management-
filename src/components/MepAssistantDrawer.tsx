import React, { useState } from 'react';
import { Sparkles, Send, X, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  projectId?: string;
}

export function MepAssistantDrawer({ open, onClose, projectId }: Props) {
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  async function ask() {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.post<{ reply?: string; answer?: string }>('/api/ai/chat', {
        question: q,
        context: projectId ? { project_id: projectId } : {}
      });
      setReply(res?.reply || res?.answer || 'No response was returned.');
    } catch (err: any) {
      setError(err?.message || 'MEP Assistant is currently unavailable.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex justify-end">
      <button
        aria-label="Close MEP Assistant"
        className="absolute inset-0 bg-slate-950/30"
        onClick={onClose}
      />
      <section className="relative h-full w-full max-w-lg bg-white shadow-2xl flex flex-col">
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-600 text-white flex items-center justify-center">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="font-bold text-slate-900">MEP Assistant</h2>
              <p className="text-xs text-slate-500">Engineering guidance in project context</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!reply && !error && (
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="text-blue-600 mt-0.5" size={18} />
                <div>
                  <p className="text-sm font-semibold text-slate-900">Use for technical support, not approvals</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Ask about MEP sequencing, installation methods, standards, defects, testing or coordination.
                    Formal project decisions remain in the controlled project workflows.
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
          )}

          {reply && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wider font-bold text-slate-400 mb-2">Response</p>
              <div className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{reply}</div>
            </div>
          )}
        </div>

        <footer className="p-4 border-t border-slate-200 bg-white">
          <textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            rows={3}
            placeholder="Ask a technical MEP question..."
            className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-400">Enter to send · Shift+Enter for a new line</p>
            <button
              onClick={ask}
              disabled={!question.trim() || loading}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              Ask
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
