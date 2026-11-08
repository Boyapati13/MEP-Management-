import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  MessageSquare, Plus, Search, Pin, Paperclip, Send, Tag, X, ArrowRight,
  RefreshCw, Trash2, Inbox, Lock, Users, Building2, HardHat, AlertTriangle
} from 'lucide-react';
import { messagesApi, tasksApi } from '../api';

export interface ProjectMessagesPageProps {
  projectId: string;
  navigate?: (module: string, recordId?: string) => void;
  addToast?: (type: 'success' | 'error' | 'info', message: string) => void;
  user?: any;
}

type Channel = 'team' | 'subcontractor' | 'client';

interface Message {
  id: string;
  project_id: string;
  channel: Channel;
  parent_id?: string | null;
  subject: string;
  body: string;
  sender_id?: string;
  sender_name: string;
  sender_role: string;
  priority: 'Normal' | 'Urgent' | 'Info';
  linked_item_type?: string | null;
  linked_item_label?: string | null;
  attachment_name?: string | null;
  is_pinned: number;
  is_unread: number;
  reply_count: number;
  last_reply_at?: string | null;
  created_at: string;
}

interface Participant { id: string; name: string; role: string; company?: string; channels: string[] }

const CHANNEL_META: Record<Channel, { label: string; description: string; icon: any }> = {
  team: { label: 'Internal team', description: 'Visible to internal staff and consultants only', icon: Lock },
  subcontractor: { label: 'Subcontractors', description: 'Visible to internal staff and project subcontractors', icon: HardHat },
  client: { label: 'Client', description: 'Visible to internal staff and the client', icon: Building2 },
};

const ROLE_LABELS: Record<string, string> = {
  Admin: 'Administrator',
  ProjectManager: 'Project Manager',
  SiteEngineer: 'Site Engineer',
  SiteSupervisor: 'Site Supervisor',
  CommercialManager: 'Commercial Manager',
  SafetyOfficer: 'Safety Officer',
  QAQC: 'QA/QC',
  Subcontractor: 'Subcontractor',
  Consultant: 'Consultant',
  Client: 'Client',
};
const roleLabel = (r?: string) => (r ? ROLE_LABELS[r] || r : '');

const initials = (name?: string) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');

function formatWhen(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

const fullDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

function Avatar({ name, size = 32 }: { name?: string; size?: number }) {
  return (
    <div
      className="rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}

export function ProjectMessagesPage({ projectId: rawProjectId, navigate, addToast }: ProjectMessagesPageProps) {
  const projectId = (rawProjectId && rawProjectId !== 'ALL' && rawProjectId !== 'undefined')
    ? rawProjectId
    : 'bov-st-venera-2618';
  const validProject = Boolean(projectId);

  const [me, setMe] = useState<{ id: string; name: string; role: string } | null>(null);
  const [channels, setChannels] = useState<Channel[]>(['team', 'subcontractor', 'client']);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [threads, setThreads] = useState<Message[]>([]);
  const [stats, setStats] = useState<{ total: number; unread: number; byChannel: Record<string, any> }>({ total: 0, unread: 0, byChannel: {} });
  const [activeChannel, setActiveChannel] = useState<'all' | Channel>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const streamEnd = useRef<HTMLDivElement>(null);

  const isModerator = me?.role === 'Admin' || me?.role === 'ProjectManager';

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset when project changes
  useEffect(() => {
    setThreads([]); setReplies([]); setSelectedId(null); setActiveChannel('all'); setLoadError('');
    if (!validProject) return;
    messagesApi.participants(projectId)
      .then(res => {
        setMe(res.me);
        setChannels(res.channels as Channel[]);
        setParticipants(res.participants);
      })
      .catch((err: any) => setLoadError(err.message || 'Unable to load project messaging'));
  }, [projectId, validProject]);

  const loadThreads = useCallback(async () => {
    if (!validProject) return;
    setLoading(true);
    try {
      const [list, s] = await Promise.all([
        messagesApi.list(projectId, {
          channel: activeChannel !== 'all' ? activeChannel : undefined,
          search: debouncedSearch || undefined,
        }),
        messagesApi.getStats(projectId),
      ]);
      const rows = Array.isArray(list) ? list : [];
      setThreads(rows);
      setStats(s as any);
      setSelectedId(prev => (prev && rows.some(r => r.id === prev) ? prev : rows[0]?.id ?? null));
      setLoadError('');
    } catch (err: any) {
      setLoadError(err.message || 'Unable to load messages');
    } finally {
      setLoading(false);
    }
  }, [projectId, validProject, activeChannel, debouncedSearch]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  // Real-Time SSE synchronization for instant message & reply updates
  useEffect(() => {
    const onRealtime = (e: any) => {
      const detail = e?.detail;
      if (!detail || !validProject) return;
      if (detail.module === 'project_messages' && (!detail.projectId || detail.projectId === projectId)) {
        loadThreads();
        if (selectedId) {
          messagesApi.getReplies(projectId, selectedId)
            .then(res => setReplies(res.replies || []))
            .catch(() => {});
        }
      }
    };
    window.addEventListener('mep-realtime-event', onRealtime as EventListener);
    return () => window.removeEventListener('mep-realtime-event', onRealtime as EventListener);
  }, [projectId, validProject, selectedId, loadThreads]);

  const active = useMemo(() => threads.find(t => t.id === selectedId) || null, [threads, selectedId]);

  useEffect(() => {
    if (!validProject || !selectedId) { setReplies([]); return; }
    let cancelled = false;
    setLoadingReplies(true);
    messagesApi.getReplies(projectId, selectedId)
      .then(res => {
        if (cancelled) return;
        setReplies(res.replies || []);
        const wasUnread = threads.find(t => t.id === selectedId)?.is_unread;
        if (wasUnread) {
          messagesApi.markRead(projectId, selectedId).then(() => {
            setThreads(prev => prev.map(t => (t.id === selectedId ? { ...t, is_unread: 0 } : t)));
            setStats(prev => {
              const ch = threads.find(t => t.id === selectedId)?.channel;
              const byChannel = { ...prev.byChannel };
              if (ch && byChannel[ch] && typeof byChannel[ch] === 'object') {
                byChannel[ch] = { ...byChannel[ch], unread: Math.max(0, (byChannel[ch].unread || 0) - 1) };
              }
              return { ...prev, unread: Math.max(0, prev.unread - 1), byChannel };
            });
          }).catch(() => {});
        }
      })
      .catch((err: any) => { if (!cancelled) addToast?.('error', err.message || 'Unable to load conversation'); })
      .finally(() => { if (!cancelled) setLoadingReplies(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, validProject, selectedId]);

  useEffect(() => { streamEnd.current?.scrollIntoView({ block: 'end' }); }, [replies.length, selectedId]);

  const audience = useMemo(
    () => (active ? participants.filter(p => p.channels.includes(active.channel)) : []),
    [participants, active]
  );

  const sendReply = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!active || !replyText.trim() || sending) return;
    setSending(true);
    try {
      const rep = await messagesApi.reply(projectId, active.id, { body: replyText.trim() });
      setReplies(prev => [...prev, rep]);
      setReplyText('');
      setThreads(prev => prev.map(t => (t.id === active.id ? { ...t, reply_count: t.reply_count + 1, last_reply_at: rep.created_at } : t)));
    } catch (err: any) {
      addToast?.('error', err.message || 'Reply could not be sent');
    } finally {
      setSending(false);
    }
  };

  const togglePin = async () => {
    if (!active) return;
    try {
      const updated = await messagesApi.togglePin(projectId, active.id);
      setThreads(prev => prev.map(t => (t.id === active.id ? { ...t, is_pinned: updated.is_pinned } : t)));
    } catch (err: any) {
      addToast?.('error', err.message || 'Unable to update pin');
    }
  };

  const deleteMessage = async (msg: Message) => {
    const isThread = !msg.parent_id;
    if (!window.confirm(isThread ? 'Delete this conversation and all replies? This cannot be undone.' : 'Delete this reply? This cannot be undone.')) return;
    try {
      await messagesApi.delete(projectId, msg.id);
      if (isThread) {
        setThreads(prev => prev.filter(t => t.id !== msg.id));
        setSelectedId(null);
        loadThreads();
      } else {
        setReplies(prev => prev.filter(r => r.id !== msg.id));
        setThreads(prev => prev.map(t => (t.id === msg.parent_id ? { ...t, reply_count: Math.max(0, t.reply_count - 1) } : t)));
      }
      addToast?.('success', isThread ? 'Conversation deleted' : 'Reply deleted');
    } catch (err: any) {
      addToast?.('error', err.message || 'Unable to delete');
    }
  };

  const canDelete = (m: Message) => isModerator || (me && m.sender_id === me.id);

  if (!validProject) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-10">
        <Inbox size={28} className="mx-auto text-slate-400" />
        <h1 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">Select a project</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Messages are scoped to a single project. Choose a project from the project selector to view its conversations.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full max-w-[1600px] mx-auto">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Messages</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Project correspondence by audience. {stats.unread > 0 ? `${stats.unread} unread.` : 'No unread conversations.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowMembers(v => !v)}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <Users size={15} /> Members ({participants.length})
          </button>
          <button
            type="button"
            onClick={loadThreads}
            aria-label="Refresh"
            className="inline-flex items-center justify-center h-9 w-9 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            disabled={channels.length === 0}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50"
          >
            <Plus size={15} /> New message
          </button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="flex items-start gap-2 p-3 text-sm rounded-md border border-red-200 bg-red-50 text-red-800 dark:bg-red-950/40 dark:border-red-900 dark:text-red-300">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" /> {loadError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(300px,380px)_1fr] border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden min-h-[640px] lg:h-[calc(100vh-230px)]">
        {/* Channels */}
        <nav aria-label="Channels" className="border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 p-2 bg-slate-50/60 dark:bg-slate-950/40">
          <p className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Channels</p>
          {[{ id: 'all' as const, label: 'All messages', icon: Inbox, total: stats.total, unread: stats.unread },
            ...channels.map(c => {
              const chStat = stats.byChannel[c];
              const total = typeof chStat === 'number' ? chStat : (chStat?.total || 0);
              const unread = typeof chStat === 'object' ? (chStat?.unread || 0) : 0;
              return { id: c, label: CHANNEL_META[c].label, icon: CHANNEL_META[c].icon, total, unread };
            })
          ].map(item => {
            const Icon = item.icon;
            const selected = activeChannel === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveChannel(item.id)}
                aria-current={selected ? 'true' : undefined}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm text-left ${
                  selected ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-medium shadow-sm border border-slate-200 dark:border-slate-700'
                           : 'text-slate-600 dark:text-slate-400 hover:bg-white/70 dark:hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <Icon size={15} className="flex-shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {item.unread > 0
                  ? <span className="min-w-[20px] text-center text-[11px] font-semibold px-1.5 rounded-full bg-blue-700 text-white">{item.unread}</span>
                  : <span className="text-[11px] text-slate-400 tabular-nums">{item.total}</span>}
              </button>
            );
          })}
          {activeChannel !== 'all' && (
            <p className="px-2 pt-3 text-xs text-slate-500 leading-relaxed">{CHANNEL_META[activeChannel].description}.</p>
          )}
        </nav>

        {/* Thread list */}
        <section aria-label="Conversations" className="flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 min-h-0">
          <div className="p-2 border-b border-slate-200 dark:border-slate-800">
            <label className="relative block">
              <span className="sr-only">Search messages</span>
              <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search subject, text, sender or linked item"
                className="w-full h-9 pl-8 pr-3 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </label>
          </div>
          <ul className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 min-h-0">
            {loading && threads.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <li key={i} className="p-3 space-y-2 animate-pulse">
                  <div className="h-3 w-2/3 bg-slate-200 dark:bg-slate-800 rounded" />
                  <div className="h-3 w-full bg-slate-100 dark:bg-slate-800/60 rounded" />
                </li>
              ))
            ) : threads.length === 0 ? (
              <li className="p-8 text-center text-sm text-slate-500">
                {debouncedSearch ? 'No conversations match your search.' : 'No conversations yet.'}
              </li>
            ) : threads.map(t => {
              const selected = t.id === selectedId;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    aria-current={selected ? 'true' : undefined}
                    className={`w-full text-left px-3 py-3 border-l-2 ${selected ? 'bg-blue-50 dark:bg-slate-800 border-l-blue-700' : 'border-l-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}
                  >
                    <div className="flex items-center gap-2">
                      {t.is_unread ? <span className="w-2 h-2 rounded-full bg-blue-700 flex-shrink-0" aria-label="Unread" /> : null}
                      <span className={`flex-1 truncate text-sm ${t.is_unread ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}>
                        {t.sender_name}
                      </span>
                      {t.is_pinned ? <Pin size={12} className="text-slate-500 flex-shrink-0" aria-label="Pinned" /> : null}
                      <time className="text-xs text-slate-500 tabular-nums flex-shrink-0" dateTime={t.last_reply_at || t.created_at}>
                        {formatWhen(t.last_reply_at || t.created_at)}
                      </time>
                    </div>
                    <p className={`mt-0.5 text-sm truncate ${t.is_unread ? 'font-medium text-slate-900 dark:text-white' : 'text-slate-800 dark:text-slate-200'}`}>
                      {t.priority === 'Urgent' && <span className="text-red-700 dark:text-red-400 font-semibold">Urgent · </span>}
                      {t.subject}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{t.body}</p>
                    <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-500">
                      <span>{CHANNEL_META[t.channel]?.label}</span>
                      {t.reply_count > 0 && <span>{t.reply_count} {t.reply_count === 1 ? 'reply' : 'replies'}</span>}
                      {t.linked_item_label && <span className="truncate">{t.linked_item_label}</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Conversation */}
        <section aria-label="Conversation" className="flex flex-col min-h-0">
          {showMembers ? (
            <div className="flex-1 overflow-y-auto">
              <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Project members you can message</h2>
                <button type="button" onClick={() => setShowMembers(false)} aria-label="Close members" className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"><X size={16} /></button>
              </div>
              {participants.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No other active members are assigned to this project. An administrator can add members under Users &amp; Access.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50 dark:bg-slate-950/40">
                    <tr><th className="px-5 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Role</th><th className="px-3 py-2 font-medium">Company</th><th className="px-3 py-2 font-medium">Channels</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {participants.map(p => (
                      <tr key={p.id}>
                        <td className="px-5 py-2.5"><div className="flex items-center gap-2"><Avatar name={p.name} size={26} /><span className="text-slate-900 dark:text-white">{p.name}{p.id === me?.id ? ' (you)' : ''}</span></div></td>
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{roleLabel(p.role)}</td>
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{p.company || '—'}</td>
                        <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{p.channels.map(c => CHANNEL_META[c as Channel]?.label).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : !active ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <MessageSquare size={28} className="text-slate-300 dark:text-slate-600" />
              <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">No conversation selected</p>
              <p className="mt-1 text-sm text-slate-500">Choose a conversation from the list, or start a new one.</p>
              <button type="button" onClick={() => setComposeOpen(true)} className="mt-4 inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800">
                <Plus size={15} /> New message
              </button>
            </div>
          ) : (
            <>
              <header className="px-5 py-3 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-slate-900 dark:text-white leading-snug">{active.subject}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {CHANNEL_META[active.channel]?.label} · Visible to {audience.length} {audience.length === 1 ? 'member' : 'members'}
                      {active.priority === 'Urgent' && <span className="ml-2 text-red-700 dark:text-red-400 font-semibold">Urgent</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {isModerator && (
                      <button type="button" onClick={togglePin} title={active.is_pinned ? 'Unpin' : 'Pin to top'} aria-pressed={!!active.is_pinned}
                        className={`p-2 rounded-md border ${active.is_pinned ? 'border-slate-400 text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800' : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}>
                        <Pin size={14} />
                      </button>
                    )}
                    {canDelete(active) && (
                      <button type="button" onClick={() => deleteMessage(active)} title="Delete conversation"
                        className="p-2 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-700 hover:border-red-300">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
                {active.linked_item_label && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <Tag size={12} /> <span className="truncate">{active.linked_item_label}</span>
                    {navigate && active.linked_item_type && (
                      <button type="button" className="inline-flex items-center gap-0.5 text-blue-700 dark:text-blue-400 hover:underline"
                        onClick={() => navigate(active.linked_item_type === 'drawing' ? 'documents' : active.linked_item_type === 'selection' ? 'selections' : 'tasks')}>
                        Open <ArrowRight size={11} />
                      </button>
                    )}
                  </div>
                )}
              </header>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 min-h-0">
                {[active, ...replies].map((m, idx) => (
                  <article key={m.id} className="flex gap-3 group">
                    <Avatar name={m.sender_name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-900 dark:text-white">{m.sender_name}{me && m.sender_id === me.id ? ' (you)' : ''}</span>
                        <span className="text-xs text-slate-500">{roleLabel(m.sender_role)}</span>
                        <time className="text-xs text-slate-400" dateTime={m.created_at}>{fullDate(m.created_at)}</time>
                        {idx > 0 && canDelete(m) && (
                          <button type="button" onClick={() => deleteMessage(m)} className="ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100 text-xs text-slate-500 hover:text-red-700">
                            Delete
                          </button>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words leading-relaxed">{m.body}</p>
                      {m.attachment_name && (
                        <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded px-2 py-1">
                          <Paperclip size={12} /> {m.attachment_name}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
                {loadingReplies && <p className="text-xs text-slate-500">Loading replies…</p>}
                <div ref={streamEnd} />
              </div>

              <form onSubmit={sendReply} className="border-t border-slate-200 dark:border-slate-800 p-3">
                <label htmlFor="reply-box" className="sr-only">Reply</label>
                <textarea
                  id="reply-box"
                  rows={3}
                  maxLength={10000}
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendReply(); }}
                  placeholder={`Reply to ${CHANNEL_META[active.channel]?.label.toLowerCase()} conversation`}
                  className="w-full text-sm p-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-white placeholder:text-slate-400 resize-y focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-500 truncate">
                    Replying as {me?.name} · {audience.length} {audience.length === 1 ? 'member' : 'members'} can see this · Ctrl+Enter to send
                  </p>
                  <button type="submit" disabled={sending || !replyText.trim()}
                    className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50">
                    <Send size={14} /> {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>

      {composeOpen && (
        <ComposeDialog
          projectId={projectId}
          channels={channels}
          defaultChannel={activeChannel !== 'all' ? activeChannel : channels[0]}
          participants={participants}
          me={me}
          onClose={() => setComposeOpen(false)}
          onCreated={(m) => {
            setComposeOpen(false);
            setShowMembers(false);
            setActiveChannel('all');
            setThreads(prev => [m, ...prev.filter(t => t.id !== m.id)]);
            setSelectedId(m.id);
            addToast?.('success', 'Message sent');
            loadThreads();
          }}
          addToast={addToast}
        />
      )}
    </div>
  );
}

function ComposeDialog({ projectId, channels, defaultChannel, participants, me, onClose, onCreated, addToast }: {
  projectId: string;
  channels: Channel[];
  defaultChannel?: Channel;
  participants: Participant[];
  me: { id: string; name: string; role: string } | null;
  onClose: () => void;
  onCreated: (m: Message) => void;
  addToast?: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const [channel, setChannel] = useState<Channel>(defaultChannel || channels[0]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<'Normal' | 'Urgent' | 'Info'>('Normal');
  const [linkedTask, setLinkedTask] = useState('');
  const [tasks, setTasks] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    tasksApi.list({ project_id: projectId }).then((r: any) => Array.isArray(r) && setTasks(r)).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projectId, onClose]);

  const audience = participants.filter(p => p.channels.includes(channel));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) { setError('Subject and message are required.'); return; }
    setSaving(true); setError('');
    try {
      const task = tasks.find(t => t.id === linkedTask);
      const created = await messagesApi.create(projectId, {
        channel, subject: subject.trim(), body: body.trim(), priority,
        linked_item_type: task ? 'task' : undefined,
        linked_item_id: task?.id,
        linked_item_label: task ? `${task.wbs_code ? task.wbs_code + ' · ' : ''}${task.title}` : undefined,
      });
      onCreated(created);
    } catch (err: any) {
      setError(err.message || 'Message could not be sent');
      addToast?.('error', err.message || 'Message could not be sent');
    } finally {
      setSaving(false);
    }
  };

  const field = 'w-full h-9 px-2.5 text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600';
  const label = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="compose-title" className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 id="compose-title" className="text-base font-semibold text-slate-900 dark:text-white">New message</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <span className={label}>Audience</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Audience">
              {channels.map(c => {
                const Icon = CHANNEL_META[c].icon;
                const count = participants.filter(p => p.channels.includes(c)).length;
                return (
                  <button key={c} type="button" role="radio" aria-checked={channel === c} onClick={() => setChannel(c)}
                    className={`text-left p-2.5 rounded-md border ${channel === c ? 'border-blue-700 ring-1 ring-blue-700 bg-blue-50/50 dark:bg-blue-950/30' : 'border-slate-300 dark:border-slate-700 hover:border-slate-400'}`}>
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white"><Icon size={14} /> {CHANNEL_META[c].label}</span>
                    <span className="block mt-0.5 text-xs text-slate-500">{count} {count === 1 ? 'member' : 'members'}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {audience.length > 0
                ? `Recipients: ${audience.filter(p => p.id !== me?.id).slice(0, 6).map(p => p.name).join(', ')}${audience.length > 7 ? ` and ${audience.length - 7} more` : ''}`
                : 'No members are assigned to this audience yet.'}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-3">
            <div>
              <label htmlFor="compose-subject" className={label}>Subject</label>
              <input id="compose-subject" ref={firstField} maxLength={300} value={subject} onChange={e => setSubject(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="compose-priority" className={label}>Priority</label>
              <select id="compose-priority" value={priority} onChange={e => setPriority(e.target.value as any)} className={field}>
                <option value="Normal">Normal</option>
                <option value="Urgent">Urgent</option>
                <option value="Info">For information</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="compose-task" className={label}>Related task <span className="font-normal text-slate-500">(optional)</span></label>
            <select id="compose-task" value={linkedTask} onChange={e => setLinkedTask(e.target.value)} className={field}>
              <option value="">None</option>
              {tasks.map(t => <option key={t.id} value={t.id}>{t.wbs_code ? `${t.wbs_code} · ` : ''}{t.title}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="compose-body" className={label}>Message</label>
            <textarea id="compose-body" rows={6} maxLength={10000} value={body} onChange={e => setBody(e.target.value)}
              className="w-full text-sm p-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-slate-900 dark:text-white resize-y focus:outline-none focus:ring-2 focus:ring-blue-600" />
          </div>

          {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}

          <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
            <p className="text-xs text-slate-500">Sending as {me?.name}</p>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="h-9 px-3.5 text-sm font-medium text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800">Cancel</button>
              <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium text-white bg-blue-700 rounded-md hover:bg-blue-800 disabled:opacity-50">
                <Send size={14} /> {saving ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
