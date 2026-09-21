import React, { useEffect, useState } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, FileText, Loader2, Milestone, RefreshCw, TrendingUp } from 'lucide-react';
import { api } from '../api';

type ClientTab = 'overview' | 'programme' | 'progress' | 'documents' | 'clarifications';

interface Props {
  tab: ClientTab;
  projectId: string;
}

export function ClientPortalContent({ tab, projectId }: Props) {
  const [summary, setSummary] = useState<any>(null);
  const [clarifications, setClarifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const s = await api.get(`/api/projects/${projectId}/client-summary`);
      setSummary(s);
      if (tab === 'clarifications') {
        const c = await api.get(`/api/clarifications?project_id=${projectId}`).catch(() => []);
        setClarifications(Array.isArray(c) ? c : []);
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to load the client portal.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [projectId, tab]);

  if (!projectId) {
    return <Empty message="Select a project to open the client portal." />;
  }

  if (loading && !summary) {
    return (
      <div className="min-h-[360px] flex items-center justify-center text-slate-500">
        <Loader2 size={24} className="animate-spin mr-2" /> Loading published project information…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <AlertCircle size={28} className="mx-auto text-red-600 mb-2" />
        <p className="font-semibold text-red-900">Client portal unavailable</p>
        <p className="text-sm text-red-700 mt-1">{error}</p>
        <button onClick={load} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  const project = summary?.project || {};
  const progress = summary?.overall_progress_percent ?? summary?.overall_progress;
  const documents = Array.isArray(summary?.published_documents) ? summary.published_documents : [];
  const changes = Array.isArray(summary?.published_change_orders) ? summary.published_change_orders : [];

  if (tab === 'overview') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{project.name || 'Project Overview'}</h1>
          <p className="text-sm text-slate-500 mt-1">Published project information for client review</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Metric label="Published Progress" value={progress == null ? 'Not published' : `${progress}%`} icon={TrendingUp} />
          <Metric label="Project Status" value={project.status || '—'} icon={CheckCircle2} />
          <Metric label="Published Documents" value={documents.length} icon={FileText} />
          <Metric label="Client Items" value={summary?.open_client_items?.decisions_required ?? 0} icon={AlertCircle} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Panel title="Next Milestone">
            {summary?.next_milestone ? (
              <div className="flex items-start gap-3">
                <Milestone size={20} className="text-blue-600 mt-0.5" />
                <div>
                  <p className="font-semibold text-slate-900">{summary.next_milestone.title}</p>
                  <p className="text-sm text-slate-500 mt-1">{summary.next_milestone.date || 'Date not configured'}</p>
                </div>
              </div>
            ) : <p className="text-sm text-slate-500">No upcoming published milestone.</p>}
          </Panel>
          <Panel title="Project Dates">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-slate-400">Start</p><p className="font-semibold text-slate-800 mt-1">{project.start_date || '—'}</p></div>
              <div><p className="text-slate-400">End</p><p className="font-semibold text-slate-800 mt-1">{project.end_date || '—'}</p></div>
            </div>
          </Panel>
        </div>
      </div>
    );
  }

  if (tab === 'programme') {
    return (
      <Panel title="Programme">
        <div className="flex items-start gap-3">
          <CalendarDays size={20} className="text-blue-600 mt-0.5" />
          <div>
            <p className="font-semibold text-slate-900">Current published milestone</p>
            <p className="text-sm text-slate-600 mt-1">
              {summary?.next_milestone
                ? `${summary.next_milestone.title} — ${summary.next_milestone.date || 'date not configured'}`
                : 'No upcoming published milestone.'}
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  if (tab === 'progress') {
    return (
      <div className="space-y-5">
        <Panel title="Published Progress">
          <div className="flex items-end gap-3">
            <span className="text-4xl font-black text-slate-900">{progress == null ? '—' : `${progress}%`}</span>
            <span className="text-sm text-slate-500 pb-1">{summary?.progress_status || 'Published information only'}</span>
          </div>
          <p className="text-xs text-slate-400 mt-3">Draft and unverified internal progress is intentionally not shown in the client portal.</p>
        </Panel>
        <Panel title="Published Changes">
          {changes.length === 0 ? <p className="text-sm text-slate-500">No published client changes.</p> : (
            <div className="divide-y divide-slate-100">
              {changes.map((item: any) => (
                <div key={item.id} className="py-3 flex items-start justify-between gap-4">
                  <div><p className="font-semibold text-sm text-slate-900">{item.number || 'Change'} · {item.title}</p><p className="text-xs text-slate-500 mt-1">{item.status || '—'}</p></div>
                  {item.schedule_impact_days != null && <span className="text-xs rounded-full bg-slate-100 px-2 py-1 text-slate-600">{item.schedule_impact_days} days</span>}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    );
  }

  if (tab === 'documents') {
    return (
      <Panel title="Published Documents">
        {documents.length === 0 ? <p className="text-sm text-slate-500">No documents have been published to the client portal.</p> : (
          <div className="divide-y divide-slate-100">
            {documents.map((doc: any) => (
              <div key={doc.id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{doc.name}</p>
                  <p className="text-xs text-slate-500 mt-1">{doc.category || 'Document'}{doc.revision ? ` · Rev ${doc.revision}` : ''}</p>
                </div>
                <FileText size={18} className="text-slate-400" />
              </div>
            ))}
          </div>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Clarifications">
      {clarifications.length === 0 ? <p className="text-sm text-slate-500">No client-visible clarifications.</p> : (
        <div className="divide-y divide-slate-100">
          {clarifications.map((item: any) => (
            <div key={item.id} className="py-3">
              <p className="text-sm font-semibold text-slate-900">{item.title || item.subject || item.reference || 'Clarification'}</p>
              <p className="text-xs text-slate-500 mt-1">{item.status || 'Open'}</p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon: any }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{label}</p>
        <Icon size={18} className="text-blue-600" />
      </div>
      <p className="mt-2 text-xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="font-bold text-slate-900 mb-4">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ message }: { message: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">{message}</div>;
}
