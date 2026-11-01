import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  MessageSquare, Plus, Search, Filter, Pin, Paperclip, Send, CheckCircle2,
  AlertCircle, Clock, User, Building2, ChevronRight, Hash, Tag, FileText,
  Sliders, ShieldAlert, Check, X, ArrowRight, CornerDownRight, ExternalLink,
  Layers, RefreshCw, Calendar, MoreVertical, Trash2
} from 'lucide-react';
import { messagesApi, tasksApi, api } from '../api';

export interface ProjectMessagesPageProps {
  projectId: string;
  navigate?: (module: string, recordId?: string) => void;
  addToast?: (type: 'success' | 'error' | 'info', message: string) => void;
  user?: any;
}

interface MessageThread {
  id: string;
  project_id: string;
  channel: 'team' | 'subcontractor' | 'client';
  parent_id?: string | null;
  subject: string;
  body: string;
  sender_id?: string;
  sender_name: string;
  sender_role: string;
  priority: 'Normal' | 'Urgent' | 'Info';
  linked_item_type?: 'task' | 'selection' | 'drawing' | 'rfi' | 'change_order' | 'po';
  linked_item_id?: string;
  linked_item_label?: string;
  attachment_name?: string;
  attachment_url?: string;
  attachment_type?: string;
  is_pinned: number;
  is_unread: number;
  reply_count: number;
  last_reply_at?: string;
  created_at: string;
}

export function ProjectMessagesPage({ projectId, navigate, addToast, user }: ProjectMessagesPageProps) {
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [replies, setReplies] = useState<any[]>([]);
  const [activeChannel, setActiveChannel] = useState<'all' | 'client' | 'subcontractor' | 'team'>('all');
  const [search, setSearch] = useState('');
  const [itemTypeFilter, setItemTypeFilter] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [stats, setStats] = useState<{ total: number; unread: number; byChannel: any }>({
    total: 0,
    unread: 0,
    byChannel: { client: 0, subcontractor: 0, team: 0 }
  });

  // Reply state
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);

  // New Thread Modal
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newChannel, setNewChannel] = useState<'client' | 'subcontractor' | 'team'>('team');
  const [newSubject, setNewSubject] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newPriority, setNewPriority] = useState<'Normal' | 'Urgent' | 'Info'>('Normal');
  const [newLinkedType, setNewLinkedType] = useState<string>('');
  const [newLinkedLabel, setNewLinkedLabel] = useState<string>('');
  const [newAttachmentName, setNewAttachmentName] = useState('');
  const [projectTasks, setProjectTasks] = useState<any[]>([]);

  // Load project tasks for quick linking
  useEffect(() => {
    if (projectId) {
      tasksApi.list({ project_id: projectId })
        .then((res: any) => { if (Array.isArray(res)) setProjectTasks(res); })
        .catch(() => {});
    }
  }, [projectId]);

  // Load threads and stats
  const loadThreads = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [threadList, threadStats] = await Promise.all([
        messagesApi.list(projectId, {
          channel: activeChannel !== 'all' ? activeChannel : undefined,
          search: search || undefined,
          linked_item_type: itemTypeFilter !== 'all' ? itemTypeFilter : undefined
        }),
        messagesApi.getStats(projectId)
      ]);
      setThreads(Array.isArray(threadList) ? threadList : []);
      if (threadStats) setStats(threadStats);

      // Auto-select first thread if none selected or current invalid
      if (Array.isArray(threadList) && threadList.length > 0) {
        setSelectedThreadId(prev => {
          if (!prev || !threadList.find(t => t.id === prev)) {
            return threadList[0].id;
          }
          return prev;
        });
      } else {
        setSelectedThreadId(null);
      }
    } catch (err: any) {
      if (addToast) addToast('error', err.message || 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [projectId, activeChannel, search, itemTypeFilter, addToast]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Load replies whenever selected thread changes
  useEffect(() => {
    if (!projectId || !selectedThreadId) {
      setReplies([]);
      return;
    }
    setLoadingReplies(true);
    messagesApi.getReplies(projectId, selectedThreadId)
      .then(res => {
        setReplies(res.replies || []);
        // Mark thread as read
        messagesApi.markRead(projectId, selectedThreadId).then(() => {
          setThreads(prev => prev.map(t => t.id === selectedThreadId ? { ...t, is_unread: 0 } : t));
          setStats(prev => ({
            ...prev,
            unread: Math.max(0, prev.unread - 1)
          }));
        }).catch(() => {});
      })
      .catch(err => {
        if (addToast) addToast('error', err.message || 'Failed to load replies');
      })
      .finally(() => setLoadingReplies(false));
  }, [projectId, selectedThreadId, addToast]);

  const activeThread = useMemo(() => {
    return threads.find(t => t.id === selectedThreadId) || null;
  }, [threads, selectedThreadId]);

  // Handle post reply
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedThreadId) return;

    setReplySending(true);
    try {
      const rep = await messagesApi.reply(projectId, selectedThreadId, {
        body: replyText.trim()
      });
      setReplies(prev => [...prev, rep]);
      setReplyText('');
      setThreads(prev => prev.map(t => {
        if (t.id === selectedThreadId) {
          return {
            ...t,
            reply_count: t.reply_count + 1,
            last_reply_at: rep.created_at
          };
        }
        return t;
      }));
      if (addToast) addToast('success', 'Reply posted');
    } catch (err: any) {
      if (addToast) addToast('error', err.message || 'Failed to post reply');
    } finally {
      setReplySending(false);
    }
  };

  // Handle create new thread
  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubject.trim() || !newBody.trim()) {
      if (addToast) addToast('error', 'Subject and message body are required');
      return;
    }

    try {
      const created = await messagesApi.create(projectId, {
        channel: newChannel,
        subject: newSubject.trim(),
        body: newBody.trim(),
        priority: newPriority,
        linked_item_type: newLinkedType || undefined,
        linked_item_label: newLinkedLabel || undefined,
        attachment_name: newAttachmentName || undefined
      });

      setThreads(prev => [created, ...prev]);
      setSelectedThreadId(created.id);
      setNewModalOpen(false);
      setNewSubject('');
      setNewBody('');
      setNewPriority('Normal');
      setNewLinkedType('');
      setNewLinkedLabel('');
      setNewAttachmentName('');
      if (addToast) addToast('success', 'New conversation started');
      loadThreads();
    } catch (err: any) {
      if (addToast) addToast('error', err.message || 'Failed to create message thread');
    }
  };

  // Handle pin toggle
  const handleTogglePin = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    try {
      const updated = await messagesApi.togglePin(projectId, threadId);
      setThreads(prev => prev.map(t => t.id === threadId ? { ...t, is_pinned: updated.is_pinned } : t));
      if (addToast) addToast('info', updated.is_pinned ? 'Thread pinned to top' : 'Thread unpinned');
    } catch (err: any) {
      if (addToast) addToast('error', err.message || 'Failed to toggle pin');
    }
  };

  // Channel Pills styling
  const channelBadge = (channel: string) => {
    switch (channel) {
      case 'client':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">Client / Owner</span>;
      case 'subcontractor':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">Subcontractor</span>;
      default:
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800">Internal Team</span>;
    }
  };

  return (
    <div className="flex flex-col gap-5 h-full max-w-[1600px] mx-auto">
      {/* ── Top Header Bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-600 text-white rounded-xl shadow-xs">
              <MessageSquare size={18} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">Project Messages &amp; Discussions</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Buildertrend-standard communication hub · Client, Subcontractor &amp; Team channels</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadThreads}
            className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors border border-slate-200 dark:border-slate-800"
            title="Refresh messages"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => setNewModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 shadow-sm transition-all"
          >
            <Plus size={14} /> New Conversation
          </button>
        </div>
      </div>

      {/* ── Metrics Cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">All Discussions</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">{stats.total}</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center">
            <MessageSquare size={18} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Client / Owner</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">
              {threads.filter(t => t.channel === 'client').length}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center">
            <Building2 size={18} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">Subcontractor Coordination</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">
              {threads.filter(t => t.channel === 'subcontractor').length}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 flex items-center justify-center">
            <User size={18} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-blue-700 dark:text-blue-400">Internal Team</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">
              {threads.filter(t => t.channel === 'team').length}
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 flex items-center justify-center">
            <Layers size={18} />
          </div>
        </div>
      </div>

      {/* ── Channel Tabs & Search Filter ─────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-900 p-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3">
        {/* Channel Selector */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
          {[
            { id: 'all', label: 'All Channels', count: stats.total },
            { id: 'client', label: 'Client / Owner', count: threads.filter(t => t.channel === 'client').length },
            { id: 'subcontractor', label: 'Subcontractors', count: threads.filter(t => t.channel === 'subcontractor').length },
            { id: 'team', label: 'Internal Team', count: threads.filter(t => t.channel === 'team').length },
          ].map(ch => (
            <button
              key={ch.id}
              onClick={() => setActiveChannel(ch.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeChannel === ch.id
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>{ch.label}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                activeChannel === ch.id ? 'bg-slate-200 dark:bg-slate-600 text-slate-800 dark:text-slate-200' : 'bg-slate-200/60 dark:bg-slate-800 text-slate-500'
              }`}>{ch.count}</span>
            </button>
          ))}
        </div>

        {/* Search & Tag filter */}
        <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-md">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search discussions, subjects, or linked tags..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600">
                <X size={12} />
              </button>
            )}
          </div>

          <select
            value={itemTypeFilter}
            onChange={e => setItemTypeFilter(e.target.value)}
            className="text-xs font-semibold px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-300 focus:outline-none"
          >
            <option value="all">All Linked Types</option>
            <option value="task">Linked to Task</option>
            <option value="drawing">Linked to Drawing</option>
            <option value="selection">Linked to Selection</option>
          </select>
        </div>
      </div>

      {/* ── Master-Detail Workspace ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-[580px]">
        {/* Left Column: Thread List (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col overflow-hidden max-h-[750px]">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/40">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Conversations ({threads.length})
            </h2>
            <span className="text-[11px] text-slate-400 font-medium">Sorted by latest activity</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
            {loading ? (
              <div className="py-20 text-center space-y-2">
                <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs text-slate-400">Loading conversation threads...</p>
              </div>
            ) : threads.length === 0 ? (
              <div className="py-20 text-center px-4 space-y-2">
                <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-2xl flex items-center justify-center mx-auto">
                  <MessageSquare size={20} />
                </div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">No discussions found</p>
                <p className="text-xs text-slate-400 max-w-xs mx-auto">Try clearing your search query or start a new conversation using the button above.</p>
              </div>
            ) : (
              threads.map(thread => {
                const isSelected = thread.id === selectedThreadId;
                const isUrgent = thread.priority === 'Urgent';

                return (
                  <div
                    key={thread.id}
                    onClick={() => setSelectedThreadId(thread.id)}
                    className={`p-4 cursor-pointer transition-all border-l-4 ${
                      isSelected
                        ? 'bg-blue-50/70 dark:bg-slate-800/90 border-l-blue-600'
                        : isUrgent
                        ? 'border-l-rose-500 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        : thread.is_pinned
                        ? 'border-l-amber-500 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        : 'border-l-transparent hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {channelBadge(thread.channel)}
                        {isUrgent && (
                          <span className="text-[10px] font-black uppercase px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300">
                            Urgent
                          </span>
                        )}
                        {thread.is_pinned === 1 && (
                          <span className="text-[10px] font-bold text-amber-600 flex items-center gap-0.5" title="Pinned Announcement">
                            <Pin size={10} className="fill-amber-600" />
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {thread.is_unread === 1 && (
                          <span className="w-2 h-2 rounded-full bg-blue-600" title="Unread" />
                        )}
                        <span className="text-[11px] text-slate-400 font-mono">
                          {new Date(thread.last_reply_at || thread.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                    </div>

                    <h3 className="text-xs font-bold text-slate-900 dark:text-white mt-1.5 line-clamp-1 leading-snug">
                      {thread.subject}
                    </h3>

                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                      {thread.body}
                    </p>

                    {/* Linked Record Tag */}
                    {thread.linked_item_label && (
                      <div className="mt-2 flex items-center gap-1 text-[10px] font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md w-fit max-w-full truncate">
                        <Tag size={10} className="text-blue-500 flex-shrink-0" />
                        <span className="truncate">{thread.linked_item_label}</span>
                      </div>
                    )}

                    <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-100/60 dark:border-slate-800/60">
                      <div className="flex items-center gap-1.5 truncate">
                        <div className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center text-[9px] font-bold">
                          {thread.sender_name.charAt(0)}
                        </div>
                        <span className="truncate font-medium text-slate-700 dark:text-slate-300">{thread.sender_name}</span>
                      </div>

                      <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400 font-mono font-semibold">
                        <MessageSquare size={11} />
                        <span>{thread.reply_count}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Active Thread Stream & Reply (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col overflow-hidden max-h-[750px]">
          {activeThread ? (
            <>
              {/* Thread Header */}
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {channelBadge(activeThread.channel)}
                    {activeThread.priority === 'Urgent' && (
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-200 border border-rose-300 dark:border-rose-800">
                        Urgent Action
                      </span>
                    )}
                    <span className="text-xs text-slate-400">
                      Started {new Date(activeThread.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  </div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
                    {activeThread.subject}
                  </h2>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={(e) => handleTogglePin(e, activeThread.id)}
                    className={`p-2 rounded-xl border transition-colors ${
                      activeThread.is_pinned
                        ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 border-amber-300 dark:border-amber-800'
                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 border-slate-200 dark:border-slate-700'
                    }`}
                    title={activeThread.is_pinned ? 'Unpin thread' : 'Pin thread to top'}
                  >
                    <Pin size={14} className={activeThread.is_pinned ? 'fill-amber-500' : ''} />
                  </button>
                </div>
              </div>

              {/* Linked Record Banner */}
              {activeThread.linked_item_label && (
                <div className="px-4 py-2 bg-blue-50/70 dark:bg-slate-800/60 border-b border-blue-100 dark:border-slate-800 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-blue-900 dark:text-blue-300 font-medium">
                    <Tag size={13} className="text-blue-600 dark:text-blue-400" />
                    <span>Linked to: <strong>{activeThread.linked_item_label}</strong></span>
                  </div>
                  {navigate && (
                    <button
                      onClick={() => {
                        if (activeThread.linked_item_type === 'task') navigate('tasks');
                        else if (activeThread.linked_item_type === 'drawing') navigate('documents');
                        else if (activeThread.linked_item_type === 'selection') navigate('selections');
                        else navigate('tasks');
                      }}
                      className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                    >
                      Open Record <ArrowRight size={11} />
                    </button>
                  )}
                </div>
              )}

              {/* Messages Timeline Stream */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4">
                {/* Root Message Bubble */}
                <div className="bg-slate-50 dark:bg-slate-800/80 rounded-2xl p-4 border border-slate-200 dark:border-slate-700/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-xs shadow-xs">
                        {activeThread.sender_name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">{activeThread.sender_name}</span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">({activeThread.sender_role})</span>
                        </div>
                        <p className="text-[10px] text-slate-400">{new Date(activeThread.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed font-normal">
                    {activeThread.body}
                  </p>

                  {/* Attachment */}
                  {activeThread.attachment_name && (
                    <div className="mt-2 p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between max-w-sm">
                      <div className="flex items-center gap-2 truncate">
                        <Paperclip size={14} className="text-blue-600 flex-shrink-0" />
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">{activeThread.attachment_name}</span>
                      </div>
                      <span className="text-[10px] font-bold text-blue-600 uppercase">Attached</span>
                    </div>
                  )}
                </div>

                {/* Replies Divider */}
                {replies.length > 0 && (
                  <div className="relative text-center my-4">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200 dark:border-slate-800" /></div>
                    <span className="relative bg-white dark:bg-slate-900 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {replies.length} {replies.length === 1 ? 'Response' : 'Responses'}
                    </span>
                  </div>
                )}

                {/* Replies */}
                {loadingReplies ? (
                  <div className="py-6 text-center text-xs text-slate-400">Loading replies...</div>
                ) : (
                  replies.map(rep => (
                    <div
                      key={rep.id}
                      className="ml-4 sm:ml-8 bg-slate-50/70 dark:bg-slate-800/50 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/60 space-y-2 relative"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold flex items-center justify-center text-xs">
                            {rep.sender_name.charAt(0)}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-900 dark:text-white">{rep.sender_name}</span>
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">({rep.sender_role})</span>
                            </div>
                            <span className="text-[10px] text-slate-400">{new Date(rep.created_at).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>

                      <p className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                        {rep.body}
                      </p>
                    </div>
                  ))
                )}
              </div>

              {/* Reply Composer */}
              <div className="p-3 sm:p-4 bg-slate-50/80 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800">
                <form onSubmit={handleSendReply} className="space-y-2">
                  <div className="relative">
                    <textarea
                      rows={3}
                      placeholder="Type your response to this project discussion..."
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      className="w-full text-xs p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-white placeholder-slate-400 resize-none shadow-xs"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-slate-400">
                      Replies notify participants in the <strong>{activeThread.channel}</strong> channel.
                    </p>

                    <button
                      type="submit"
                      disabled={replySending || !replyText.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
                    >
                      <Send size={13} />
                      <span>{replySending ? 'Posting...' : 'Post Reply'}</span>
                    </button>
                  </div>
                </form>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-3">
              <div className="w-14 h-14 bg-slate-100 dark:bg-slate-800 text-slate-400 rounded-3xl flex items-center justify-center shadow-xs">
                <MessageSquare size={26} />
              </div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">No conversation selected</h3>
              <p className="text-xs text-slate-400 max-w-sm">
                Select a message thread from the left list to review communication, or start a new project conversation.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── New Conversation Modal ───────────────────────────────────────────── */}
      {newModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-2xl w-full overflow-hidden animate-fadeIn">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <MessageSquare size={18} className="text-amber-400" />
                <h2 className="text-base font-bold">New Project Conversation</h2>
              </div>
              <button onClick={() => setNewModalOpen(false)} className="text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateThread} className="p-6 space-y-4">
              {/* Channel Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Audience Channel
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'client', label: 'Client / Owner', desc: 'Customer facing' },
                    { id: 'subcontractor', label: 'Subcontractor', desc: 'Trades & field' },
                    { id: 'team', label: 'Internal Team', desc: 'Private management' },
                  ].map(ch => (
                    <button
                      type="button"
                      key={ch.id}
                      onClick={() => setNewChannel(ch.id as any)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        newChannel === ch.id
                          ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 font-bold'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <p className="text-xs">{ch.label}</p>
                      <p className="text-[10px] text-slate-400 font-normal">{ch.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject & Priority */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-3">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Subject Topic *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Level 1 Cable Tray Coordination & Clearances"
                    value={newSubject}
                    onChange={e => setNewSubject(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Priority
                  </label>
                  <select
                    value={newPriority}
                    onChange={e => setNewPriority(e.target.value as any)}
                    className="w-full text-xs p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                  >
                    <option value="Normal">Normal</option>
                    <option value="Urgent">Urgent</option>
                    <option value="Info">Info Only</option>
                  </select>
                </div>
              </div>

              {/* Contextual Link to Record (Task, Drawing, Selection) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Link to Project Record (Optional)
                  </label>
                  <select
                    value={newLinkedType}
                    onChange={e => {
                      setNewLinkedType(e.target.value);
                      if (!e.target.value) setNewLinkedLabel('');
                    }}
                    className="w-full text-xs p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                  >
                    <option value="">No linked record</option>
                    <option value="task">WBS Schedule Task</option>
                    <option value="drawing">Engineering Drawing</option>
                    <option value="selection">Client Selection / Allowance</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Select Record
                  </label>
                  {newLinkedType === 'task' ? (
                    <select
                      value={newLinkedLabel}
                      onChange={e => setNewLinkedLabel(e.target.value)}
                      className="w-full text-xs p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                    >
                      <option value="">Choose a task...</option>
                      {projectTasks.map(t => (
                        <option key={t.id} value={`${t.wbs_code || ''} ${t.title}`}>
                          {t.wbs_code ? `[${t.wbs_code}] ` : ''}{t.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      placeholder="e.g. Drawing 2618-S-ELE-01 or SEL-001"
                      value={newLinkedLabel}
                      onChange={e => setNewLinkedLabel(e.target.value)}
                      className="w-full text-xs p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                    />
                  )}
                </div>
              </div>

              {/* Message Body */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Message Content *
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Describe the issue, question, or update..."
                  value={newBody}
                  onChange={e => setNewBody(e.target.value)}
                  className="w-full text-xs p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Attachment name */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Attachment Reference (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Site_Coordination_Sketch_Rev1.pdf"
                  value={newAttachmentName}
                  onChange={e => setNewAttachmentName(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setNewModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors"
                >
                  Post Message
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
