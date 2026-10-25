import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles, Send, X, Loader2, ShieldCheck, DollarSign, Package,
  AlertTriangle, FileText, Users, Calendar, Copy, Check, RotateCcw,
  Building2, ChevronDown, ArrowRight, CornerDownLeft, Bot, User
} from 'lucide-react';
import { copilotApi } from '../api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  suggestedFollowups?: string[];
  modelUsed?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  projects?: any[];
  onSelectProject?: (id: string) => void;
}

export function MepAssistantDrawer({
  open,
  onClose,
  projectId,
  projects = [],
  onSelectProject,
}: Props) {
  const [activeProjectId, setActiveProjectId] = useState<string>(projectId || '');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [projectFacts, setProjectFacts] = useState<any>(null);
  const [loadingFacts, setLoadingFacts] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sync activeProjectId when prop changes
  useEffect(() => {
    if (projectId) {
      setActiveProjectId(projectId);
    } else if (projects.length > 0 && !activeProjectId) {
      setActiveProjectId(projects[0].id);
    }
  }, [projectId, projects]);

  // Load project facts whenever active project changes
  useEffect(() => {
    if (!open) return;
    async function loadFacts() {
      if (!activeProjectId) {
        setProjectFacts(null);
        return;
      }
      setLoadingFacts(true);
      try {
        const facts = await copilotApi.getContext(activeProjectId);
        setProjectFacts(facts);
      } catch {
        setProjectFacts(null);
      } finally {
        setLoadingFacts(false);
      }
    }
    loadFacts();
  }, [open, activeProjectId]);

  // Initial welcome message or greeting on open if thread is empty
  useEffect(() => {
    if (open && messages.length === 0) {
      const activeProjName = projects.find(p => p.id === activeProjectId)?.name || projectFacts?.name || "your active project";
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          text: `👋 **Welcome to the MEP Project Copilot!**\n\nI have complete, live access to all records for **${activeProjName}**, including:\n- 💰 **Contract value, budget & trade BOQ breakdowns**\n- 📦 **Work packages, disciplines & subcontractor allocations**\n- ⚠️ **Open snags, punch list defects & high-severity risks**\n- 📑 **Uploaded contracts, tender agreements & drawings**\n- 📅 **Programme tasks, milestones & handover schedules**\n- 👷 **Live workforce attendance & on-site presence**\n\nAsk me any specific question below, or select one of the suggested prompts to get started.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          suggestedFollowups: [
            "What is the total budget and trade breakdown?",
            "List all work packages and assigned subcontractors",
            "What open punch list snags require attention?",
            "What documents and BOQs are on file?",
          ]
        }
      ]);
    }
  }, [open, activeProjectId, projectFacts]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, open]);

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  if (!open) return null;

  function handleProjectChange(newId: string) {
    setActiveProjectId(newId);
    if (onSelectProject) {
      onSelectProject(newId);
    }
    const chosen = projects.find(p => p.id === newId);
    // Add a notice in the thread
    setMessages(prev => [
      ...prev,
      {
        id: `switch-${Date.now()}`,
        role: 'assistant',
        text: `Switched project focus to **${chosen?.name || 'Selected Project'}**. Ready to answer questions on this project's budget, work packages, BOQ, snags, documents, and schedule.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedFollowups: [
          "Summarize this project status",
          "What is the budget and trade breakdown?",
          "Show open punch list snags",
        ]
      }
    ]);
  }

  async function handleSend(textToSend?: string) {
    const q = (textToSend || input).trim();
    if (!q || loading) return;

    const userMsgId = `user-${Date.now()}`;
    const userMsg: Message = {
      id: userMsgId,
      role: 'user',
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newThread = [...messages, userMsg];
    setMessages(newThread);
    setInput('');
    setLoading(true);

    try {
      // Build conversation history for the server
      const historyPayload = newThread
        .filter(m => m.id !== 'welcome' && !m.id.startsWith('switch-'))
        .map(m => ({
          role: m.role,
          content: m.text,
        }));

      const res = await copilotApi.chat({
        question: q,
        messages: historyPayload,
        project_id: activeProjectId || undefined,
      });

      const replyText = res?.reply || res?.answer || "No response received from Copilot.";
      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: replyText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedFollowups: res?.suggested_followups,
        modelUsed: res?.model_used,
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          text: `⚠️ **Unable to fetch Copilot response**: ${err?.message || 'Server error'}. Please try again.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleCopy(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function handleClearChat() {
    setMessages([]);
    const activeProjName = projects.find(p => p.id === activeProjectId)?.name || projectFacts?.name || "your active project";
    setMessages([
      {
        id: 'welcome-new',
        role: 'assistant',
        text: `Conversation cleared. Ready for your questions about **${activeProjName}**!`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedFollowups: [
          "What is the total budget and trade breakdown?",
          "List all work packages and assigned subcontractors",
          "What open punch list snags require attention?",
        ]
      }
    ]);
  }

  // Quick prompt chips
  const QUICK_PROMPTS = [
    { label: "📊 Summary", q: "Summarize this project status, budget, schedule, and key metrics." },
    { label: "💰 Budget & BOQ", q: "What is the total project budget, contract value, and trade BOQ breakdown?" },
    { label: "📦 Work Packages", q: "List all work packages, their scopes, budgets, and assigned subcontractors." },
    { label: "⚠️ Open Snags", q: "What open punch list defects require attention? Show urgent and high-priority items." },
    { label: "📑 Documents", q: "What contracts, tender documents, or drawings have been uploaded for this project?" },
    { label: "📅 Schedule", q: "What are the start date, target handover date, and current task milestones?" },
    { label: "👷 Workforce", q: "Who is on site today and what trades are currently active?" },
    { label: "🚚 Procurement", q: "What material requests and procurement items are pending on site?" },
  ];

  // Helper to render basic markdown formatting: headers, bold, bullet points, inline code
  function renderMarkdown(content: string) {
    const lines = content.split('\n');
    return lines.map((line, idx) => {
      // Table formatting row
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        if (cells.every(c => /^:?-+:?$/.test(c))) {
          // divider row
          return null;
        }
        return (
          <div key={idx} className="grid grid-cols-2 gap-2 text-xs py-1 border-b border-slate-200/80 font-mono">
            <span className="font-semibold text-slate-700">{cells[0]}</span>
            <span className="text-slate-900">{cells[1] || ''}</span>
          </div>
        );
      }

      // Headers
      if (line.startsWith('#### ')) {
        return <h4 key={idx} className="font-bold text-slate-900 text-xs uppercase tracking-wider mt-3 mb-1">{line.slice(5)}</h4>;
      }
      if (line.startsWith('### ')) {
        return <h3 key={idx} className="font-bold text-slate-900 text-sm mt-3 mb-1 flex items-center gap-1.5">{line.slice(4)}</h3>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={idx} className="font-bold text-slate-900 text-base mt-4 mb-2">{line.slice(3)}</h2>;
      }

      // Bullet points
      if (line.startsWith('- ') || line.startsWith('* ')) {
        const bulletText = line.slice(2);
        return (
          <div key={idx} className="flex items-start gap-2 text-xs leading-relaxed text-slate-800 my-0.5">
            <span className="text-amber-600 font-bold mt-0.5">•</span>
            <div className="flex-1">{formatInline(bulletText)}</div>
          </div>
        );
      }

      // Numbered items
      if (/^\d+\.\s/.test(line)) {
        const match = line.match(/^(\d+\.)\s(.*)$/);
        if (match) {
          return (
            <div key={idx} className="flex items-start gap-2 text-xs leading-relaxed text-slate-800 my-1">
              <span className="font-bold text-amber-700 font-mono">{match[1]}</span>
              <div className="flex-1">{formatInline(match[2])}</div>
            </div>
          );
        }
      }

      // Empty line
      if (!line.trim()) {
        return <div key={idx} className="h-2" />;
      }

      // Default paragraph
      return (
        <p key={idx} className="text-xs leading-relaxed text-slate-800 my-1">
          {formatInline(line)}
        </p>
      );
    });
  }

  function formatInline(text: string): React.ReactNode {
    // Replace **bold**, `code`, and *italic*
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parts.push(text.substring(lastIdx, match.index));
      }
      const token = match[0];
      if (token.startsWith('**') && token.endsWith('**')) {
        parts.push(<strong key={match.index} className="font-bold text-slate-950">{token.slice(2, -2)}</strong>);
      } else if (token.startsWith('`') && token.endsWith('`')) {
        parts.push(<code key={match.index} className="bg-slate-200 text-slate-800 px-1 py-0.5 rounded text-[11px] font-mono">{token.slice(1, -1)}</code>);
      } else if (token.startsWith('*') && token.endsWith('*')) {
        parts.push(<em key={match.index} className="italic text-slate-700">{token.slice(1, -1)}</em>);
      }
      lastIdx = regex.lastIndex;
    }
    if (lastIdx < text.length) {
      parts.push(text.substring(lastIdx));
    }
    return parts.length ? parts : text;
  }

  const activeProjectObj = projects.find(p => p.id === activeProjectId);

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      {/* Backdrop */}
      <button
        aria-label="Close MEP Copilot"
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Section */}
      <section className="relative h-full w-full max-w-xl bg-white shadow-2xl flex flex-col z-10 border-l border-slate-200">
        {/* Header */}
        <header className="px-5 py-3.5 bg-[#0f172a] text-white border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-500 text-white flex items-center justify-center shadow-md flex-shrink-0">
              <Sparkles size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-white text-sm sm:text-base leading-tight">MEP Project Copilot</h2>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Live Ground Truth
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate">Instant intelligence across all project data & engineering standards</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={handleClearChat}
              title="Start New Conversation"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={onClose}
              title="Close Copilot"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Project Selector & Live Stat Pills Bar */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold min-w-0">
              <Building2 size={14} className="text-amber-600 flex-shrink-0" />
              <span className="text-[11px] uppercase tracking-wider text-slate-400">Context:</span>
              {projects.length > 0 ? (
                <div className="relative inline-block min-w-0">
                  <select
                    value={activeProjectId}
                    onChange={e => handleProjectChange(e.target.value)}
                    className="appearance-none bg-white border border-slate-300 rounded-lg pl-2 pr-6 py-1 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 truncate max-w-[220px]"
                  >
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              ) : (
                <span className="font-bold text-slate-900 truncate">{activeProjectObj?.name || 'Active Project'}</span>
              )}
            </div>

            {projectFacts?.status && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                {projectFacts.status}
              </span>
            )}
          </div>

          {/* Quick Metrics Bar */}
          {projectFacts && (
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 text-[11px]">
              <div className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-md px-2 py-0.5 text-slate-700 flex-shrink-0 shadow-2xs">
                <DollarSign size={12} className="text-emerald-600" />
                <span className="font-semibold">{projectFacts.currency} {Number(projectFacts.budget || 0).toLocaleString()}</span>
              </div>
              <div className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-md px-2 py-0.5 text-slate-700 flex-shrink-0 shadow-2xs">
                <Package size={12} className="text-blue-600" />
                <span>{projectFacts.work_packages_count || 0} Packages</span>
              </div>
              <div className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-md px-2 py-0.5 text-slate-700 flex-shrink-0 shadow-2xs">
                <AlertTriangle size={12} className="text-amber-600" />
                <span>{projectFacts.open_snags_count || 0} Open Snags</span>
              </div>
              <div className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-md px-2 py-0.5 text-slate-700 flex-shrink-0 shadow-2xs">
                <FileText size={12} className="text-purple-600" />
                <span>{projectFacts.documents_count || 0} Files</span>
              </div>
            </div>
          )}
        </div>

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/50">
          {messages.map(msg => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex items-start gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="h-7 w-7 rounded-lg bg-amber-600 text-white flex items-center justify-center flex-shrink-0 mt-0.5 shadow-xs">
                    <Bot size={15} />
                  </div>
                )}

                <div className={`max-w-[85%] rounded-2xl p-3.5 shadow-xs ${
                  isUser
                    ? 'bg-amber-600 text-white rounded-tr-none'
                    : 'bg-white border border-slate-200/90 text-slate-900 rounded-tl-none'
                }`}>
                  <div className="flex items-center justify-between gap-2 mb-1.5 pb-1 border-b border-slate-200/40 text-[10px]">
                    <span className={`font-bold uppercase tracking-wider ${isUser ? 'text-amber-200' : 'text-slate-400'}`}>
                      {isUser ? 'You' : 'MEP Copilot'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className={isUser ? 'text-amber-200' : 'text-slate-400'}>{msg.timestamp}</span>
                      {!isUser && (
                        <button
                          onClick={() => handleCopy(msg.id, msg.text)}
                          className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                          title="Copy message"
                        >
                          {copiedId === msg.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="text-xs leading-relaxed whitespace-pre-wrap">
                    {isUser ? msg.text : renderMarkdown(msg.text)}
                  </div>

                  {/* Context-aware follow-up suggestion chips */}
                  {!isUser && msg.suggestedFollowups && msg.suggestedFollowups.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-100">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Suggested Questions:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.suggestedFollowups.map((sug, sIdx) => (
                          <button
                            key={sIdx}
                            onClick={() => handleSend(sug)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200/80 rounded-lg px-2.5 py-1 text-left transition-colors"
                          >
                            <span>{sug}</span>
                            <ArrowRight size={10} className="text-amber-600" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {isUser && (
                  <div className="h-7 w-7 rounded-lg bg-slate-800 text-white flex items-center justify-center flex-shrink-0 mt-0.5 shadow-xs">
                    <User size={15} />
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="flex items-start gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-amber-600 text-white flex items-center justify-center flex-shrink-0 animate-pulse shadow-xs">
                <Bot size={15} />
              </div>
              <div className="rounded-2xl rounded-tl-none bg-white border border-slate-200 p-3.5 shadow-xs flex items-center gap-2.5">
                <Loader2 size={16} className="animate-spin text-amber-600" />
                <span className="text-xs font-medium text-slate-600 animate-pulse">
                  Analyzing project records, BOQ, work packages & documents…
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestions Drawer Bar */}
        <div className="px-4 py-2 bg-white border-t border-slate-200">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex-shrink-0 mr-1">
              Ask Copilot:
            </span>
            {QUICK_PROMPTS.map((qp, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(qp.q)}
                disabled={loading}
                className="whitespace-nowrap px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 hover:bg-amber-50 hover:text-amber-900 border border-slate-200 text-slate-700 transition-colors flex-shrink-0 disabled:opacity-50"
              >
                {qp.label}
              </button>
            ))}
          </div>
        </div>

        {/* Input Box Footer */}
        <footer className="p-3.5 border-t border-slate-200 bg-white">
          <div className="relative rounded-xl border border-slate-300 focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-100 bg-white shadow-2xs">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={2}
              placeholder={`Ask any question about ${projectFacts?.name || activeProjectObj?.name || 'this project'}…`}
              className="w-full resize-none bg-transparent px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            <div className="px-3 pb-2 pt-1 flex items-center justify-between gap-2 border-t border-slate-100/80">
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                <CornerDownLeft size={10} /> Enter to send · Shift+Enter for new line
              </span>
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-40 transition-all shadow-xs"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                <span>Send</span>
              </button>
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}
