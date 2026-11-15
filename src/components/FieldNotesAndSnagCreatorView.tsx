import React, { useState, useEffect, useCallback } from 'react';
import {
  NotebookPen, CheckSquare, Plus, Trash2, ArrowRightCircle, Search, Mic, MicOff,
  FileDown, Printer, Sparkles, Check, Layers, AlertTriangle, RefreshCw
} from 'lucide-react';
import { api } from '../api';

interface FieldNotesAndSnagCreatorViewProps {
  projectId: string;
  projects: any[];
  user: any;
  addToast: (type: 'success' | 'error' | 'info', msg: string) => void;
  onNavigate?: (route: string) => void;
}

const CATEGORIES = ['Site Walk', 'Snag Draft', 'Coordination', 'Safety Note', 'Client Comment'] as const;
const DISCIPLINES = ['HVAC', 'Electrical', 'Plumbing', 'Fire Protection', 'BMS', 'General'] as const;
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

interface SnagDraftRow {
  tempId: string;
  location: string;
  trade: string;
  item: string;
  priority: string;
  date_raised: string;
}

const emptySnagRow = (): SnagDraftRow => ({
  tempId: Math.random().toString(36).slice(2, 10),
  location: '',
  trade: 'HVAC',
  item: '',
  priority: 'Medium',
  date_raised: new Date().toISOString().slice(0, 10),
});

export function FieldNotesAndSnagCreatorView({
  projectId,
  projects,
  addToast,
  onNavigate,
}: FieldNotesAndSnagCreatorViewProps) {
  const [activeTab, setActiveTab] = useState<'notes' | 'snag-creator'>('notes');
  const [notes, setNotes] = useState<any[]>([]);
  const [punchItems, setPunchItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Note filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);

  // Quick Note Form
  const [noteForm, setNoteForm] = useState({
    title: '',
    body: '',
    category: 'Site Walk',
    discipline: 'HVAC',
    zone_location: '',
    priority: 'Medium',
  });
  const [savingNote, setSavingNote] = useState(false);
  const [listening, setListening] = useState(false);

  // Rapid Snag List Creator state
  const [listTitle, setListTitle] = useState(`Site Walk Snag List — ${new Date().toISOString().slice(0, 10)}`);
  const [snagRows, setSnagRows] = useState<SnagDraftRow[]>([emptySnagRow(), emptySnagRow(), emptySnagRow()]);
  const [bulkPasteOpen, setBulkPasteOpen] = useState(false);
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [bulkDefaultZone, setBulkDefaultZone] = useState('Level 1');
  const [bulkDefaultTrade, setBulkDefaultTrade] = useState('HVAC');
  const [submittingBatch, setSubmittingBatch] = useState(false);

  const activeProject = projects.find((p: any) => p.id === projectId);

  const loadAll = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [notesRes, punchRes] = await Promise.all([
        api.get(`/api/field_notes?project_id=${encodeURIComponent(projectId)}`).catch(() => []),
        api.get(`/api/punchlist?project_id=${encodeURIComponent(projectId)}`).catch(() => []),
      ]);
      setNotes(Array.isArray(notesRes) ? notesRes : []);
      setPunchItems(Array.isArray(punchRes) ? punchRes : []);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const onRealtime = (ev: any) => {
      const mod = ev?.detail?.module || ev?.detail?.table;
      if (mod === 'field_notes' || mod === 'punchlist') {
        loadAll();
      }
    };
    window.addEventListener('mep-realtime-event', onRealtime);
    return () => window.removeEventListener('mep-realtime-event', onRealtime);
  }, [loadAll]);

  const handleVoiceDictation = () => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      addToast('info', 'Voice dictation is not supported in this browser. Type or paste notes directly.');
      return;
    }
    const recognition = new SpeechRec();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event?.results?.[0]?.[0]?.transcript || '';
      if (transcript) {
        setNoteForm(prev => ({
          ...prev,
          body: prev.body ? `${prev.body} ${transcript}` : transcript,
          title: prev.title || transcript.slice(0, 60),
        }));
      }
    };
    recognition.start();
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    if (!noteForm.title.trim() && !noteForm.body.trim()) {
      addToast('error', 'Enter a note title or observation.');
      return;
    }
    setSavingNote(true);
    try {
      await api.post('/api/field_notes', { project_id: projectId, ...noteForm });
      setNoteForm({
        title: '',
        body: '',
        category: noteForm.category,
        discipline: noteForm.discipline,
        zone_location: noteForm.zone_location,
        priority: 'Medium',
      });
      addToast('success', 'Field note saved.');
      loadAll();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to save field note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleConvertSingleNote = async (noteId: string) => {
    try {
      const res: any = await api.post(`/api/field_notes/${noteId}/convert-to-snag`, {});
      addToast('success', res.already_converted ? 'Note already linked to snag item.' : 'Converted note into official Snag / Punch item.');
      loadAll();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to convert note');
    }
  };

  const handleBatchConvertSelectedNotes = async () => {
    const selected = notes.filter(n => selectedNoteIds.includes(n.id) && !n.linked_punch_id);
    if (selected.length === 0) {
      addToast('info', 'Select unconverted draft notes first.');
      return;
    }
    try {
      const res: any = await api.post('/api/punchlist/batch', {
        project_id: projectId,
        list_title: 'Converted Field Notes Snag List',
        items: selected.map(n => ({
          note_id: n.id,
          item: `${n.title}${n.body && n.body !== n.title ? ` — ${n.body}` : ''}`,
          trade: n.discipline || 'General',
          location: n.zone_location || 'Site Wide',
          priority: n.priority || 'Medium',
        })),
      });
      setSelectedNoteIds([]);
      addToast('success', `Created ${res.count} snag item(s) from selected notes.`);
      loadAll();
    } catch (err: any) {
      addToast('error', err.message || 'Batch conversion failed');
    }
  };

  const handleUpdateNoteStatus = async (noteId: string, status: string) => {
    try {
      await api.put(`/api/field_notes/${noteId}`, { status });
      loadAll();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to update note status');
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    try {
      await api.delete(`/api/field_notes/${noteId}`);
      setSelectedNoteIds(prev => prev.filter(id => id !== noteId));
      addToast('info', 'Field note deleted.');
      loadAll();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to delete note');
    }
  };

  const handleParseBulkLines = () => {
    const lines = bulkPasteText
      .split(/\r?\n/)
      .map(l => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const parsed: SnagDraftRow[] = lines.map(line => ({
      tempId: Math.random().toString(36).slice(2, 10),
      location: bulkDefaultZone,
      trade: bulkDefaultTrade,
      item: line,
      priority: /urgent|critical|leak|hazard|fail/i.test(line) ? 'Critical' : 'Medium',
      date_raised: today,
    }));
    setSnagRows(prev => [...prev.filter(r => r.item.trim() !== ''), ...parsed]);
    setBulkPasteText('');
    setBulkPasteOpen(false);
    addToast('success', `Added ${parsed.length} snag row(s) from pasted text.`);
  };

  const handleSubmitBatchSnagList = async (e: React.FormEvent) => {
    e.preventDefault();
    const valid = snagRows.filter(r => r.item.trim().length > 0);
    if (valid.length === 0) {
      addToast('error', 'Enter at least one snag description before creating the list.');
      return;
    }
    setSubmittingBatch(true);
    try {
      const res: any = await api.post('/api/punchlist/batch', {
        project_id: projectId,
        list_title: listTitle,
        items: valid.map(({ location, trade, item, priority, date_raised }) => ({
          location: location || 'Site Wide',
          trade: trade || 'General',
          item: item.trim(),
          priority: priority || 'Medium',
          date_raised,
        })),
      });
      setSnagRows([emptySnagRow(), emptySnagRow(), emptySnagRow()]);
      addToast('success', `Snag list created: ${res.count} item(s) added to Snagging & Punch List.`);
      loadAll();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to create snag list');
    } finally {
      setSubmittingBatch(false);
    }
  };

  const exportSnagCsv = () => {
    const headers = ['Location', 'Discipline', 'Snag Description', 'Priority', 'Date Raised', 'Status'];
    const rows = punchItems.map(p => [
      p.location || '',
      p.trade || '',
      p.item || '',
      p.priority || 'Medium',
      p.date_raised || '',
      p.status || 'Open',
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snag-list-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredNotes = notes.filter(n => {
    if (categoryFilter !== 'All' && n.category !== categoryFilter) return false;
    if (statusFilter !== 'All' && n.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        String(n.title || '').toLowerCase().includes(q) ||
        String(n.body || '').toLowerCase().includes(q) ||
        String(n.zone_location || '').toLowerCase().includes(q) ||
        String(n.discipline || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  if (!projectId) {
    return (
      <div className="max-w-xl mx-auto mt-12 p-8 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 text-center">
        <NotebookPen size={28} className="mx-auto text-blue-600 mb-3" />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Select a Project</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">Choose a project from the selector to record field notes and create snag lists.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <NotebookPen size={20} className="text-blue-600 dark:text-blue-400" />
            Field Note Taker &amp; Snag List Creator
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
            {activeProject?.name || 'Active Project'} · Capture site walk notes, dictate observations, and batch-generate official MEP snag lists.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            type="button"
            onClick={loadAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <Printer size={13} /> Print / PDF
          </button>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('punchlist')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700"
            >
              <CheckSquare size={13} /> Open Full Punch Register ({punchItems.length})
            </button>
          )}
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 pb-2 no-print">
        <button
          type="button"
          onClick={() => setActiveTab('notes')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
            activeTab === 'notes'
              ? 'bg-slate-900 dark:bg-blue-600 text-white'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50'
          }`}
        >
          <NotebookPen size={14} /> Site Note Taker ({notes.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('snag-creator')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
            activeTab === 'snag-creator'
              ? 'bg-slate-900 dark:bg-blue-600 text-white'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50'
          }`}
        >
          <CheckSquare size={14} /> Rapid Snag List Creator ({snagRows.filter(r => r.item.trim()).length} drafted)
        </button>
      </div>

      {activeTab === 'notes' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Quick Note Capture Card */}
          <form
            onSubmit={handleCreateNote}
            className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3 h-fit no-print"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Quick Field Note</h2>
              <button
                type="button"
                onClick={handleVoiceDictation}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
                  listening
                    ? 'bg-rose-600 text-white border-rose-600 animate-pulse'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                }`}
                title="Dictate observation using microphone"
              >
                {listening ? <MicOff size={12} /> : <Mic size={12} />}
                {listening ? 'Listening...' : 'Dictate'}
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">Note Title / Summary</label>
              <input
                type="text"
                value={noteForm.title}
                onChange={e => setNoteForm(p => ({ ...p, title: e.target.value }))}
                placeholder="e.g., Chilled water riser insulation gap"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">Detailed Observation</label>
              <textarea
                rows={4}
                value={noteForm.body}
                onChange={e => setNoteForm(p => ({ ...p, body: e.target.value }))}
                placeholder="Record measurements, defect details, drawing ref, or coordination action..."
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">Category</label>
                <select
                  value={noteForm.category}
                  onChange={e => setNoteForm(p => ({ ...p, category: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs text-slate-900 dark:text-white"
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">Discipline</label>
                <select
                  value={noteForm.discipline}
                  onChange={e => setNoteForm(p => ({ ...p, discipline: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs text-slate-900 dark:text-white"
                >
                  {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">Zone / Floor / Room</label>
                <input
                  type="text"
                  value={noteForm.zone_location}
                  onChange={e => setNoteForm(p => ({ ...p, zone_location: e.target.value }))}
                  placeholder="e.g., Level 2 Plantroom"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">Severity</label>
                <select
                  value={noteForm.priority}
                  onChange={e => setNoteForm(p => ({ ...p, priority: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs text-slate-900 dark:text-white"
                >
                  {PRIORITIES.map(pr => <option key={pr} value={pr}>{pr}</option>)}
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={savingNote}
              className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-60"
            >
              <Plus size={14} /> {savingNote ? 'Saving Note...' : 'Save Field Note'}
            </button>
          </form>

          {/* Right: Saved Notes + Batch Convert */}
          <div className="lg:col-span-8 space-y-3">
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex flex-wrap items-center justify-between gap-2 no-print">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <Search size={14} className="text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search notes by keyword, zone, or discipline..."
                  className="w-full text-xs bg-transparent text-slate-900 dark:text-white focus:outline-none"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100"
                >
                  <option value="All">All Categories</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100"
                >
                  <option value="All">All Statuses</option>
                  <option value="Draft">Draft</option>
                  <option value="Converted to Snag">Converted to Snag</option>
                  <option value="Resolved">Resolved</option>
                </select>
                {selectedNoteIds.length > 0 && (
                  <button
                    type="button"
                    onClick={handleBatchConvertSelectedNotes}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                  >
                    <ArrowRightCircle size={13} /> Convert Selected ({selectedNoteIds.length}) to Snags
                  </button>
                )}
              </div>
            </div>

            {filteredNotes.length === 0 ? (
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-10 text-center">
                <NotebookPen size={28} className="mx-auto text-slate-400 mb-2" />
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">No field notes yet</p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Record observations on the left, then convert any note into an official snag item with one click.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredNotes.map(n => {
                  const isConverted = Boolean(n.linked_punch_id) || n.status === 'Converted to Snag';
                  const checked = selectedNoteIds.includes(n.id);
                  return (
                    <div
                      key={n.id}
                      className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 flex items-start gap-3"
                    >
                      {!isConverted && (
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedNoteIds(prev =>
                              prev.includes(n.id) ? prev.filter(id => id !== n.id) : [...prev, n.id]
                            )
                          }
                          aria-label={`Select note ${n.title}`}
                          className="mt-1 rounded border-slate-300 dark:border-slate-600"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-900 dark:text-white">{n.title}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                              {n.category}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                              {n.discipline}
                            </span>
                            {n.zone_location && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                📍 {n.zone_location}
                              </span>
                            )}
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              isConverted
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                : n.status === 'Resolved'
                                ? 'bg-blue-100 text-blue-800 border-blue-200'
                                : 'bg-amber-100 text-amber-800 border-amber-200'
                            }`}
                          >
                            {n.status}
                          </span>
                        </div>
                        {n.body && n.body !== n.title && (
                          <p className="text-xs text-slate-700 dark:text-slate-300 mt-1.5 whitespace-pre-wrap">{n.body}</p>
                        )}
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                          <span>
                            {n.created_by_name || 'Engineer'} · {n.priority} Priority · {String(n.created_at || '').slice(0, 10)}
                          </span>
                          <div className="flex items-center gap-2 no-print">
                            {!isConverted && (
                              <button
                                type="button"
                                onClick={() => handleConvertSingleNote(n.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                              >
                                <ArrowRightCircle size={12} /> Convert to Snag
                              </button>
                            )}
                            {n.status === 'Draft' && (
                              <button
                                type="button"
                                onClick={() => handleUpdateNoteStatus(n.id, 'Resolved')}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                              >
                                <Check size={12} /> Resolve
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteNote(n.id)}
                              className="p-1 rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                              aria-label="Delete note"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Tab 2: Rapid Snag List Creator */
        <div className="space-y-5">
          <form
            onSubmit={handleSubmitBatchSnagList}
            className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-4 no-print"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex-1 min-w-[220px]">
                <label className="block text-[11px] font-bold uppercase text-slate-600 dark:text-slate-300 mb-1">
                  Snag List Batch Title
                </label>
                <input
                  type="text"
                  value={listTitle}
                  onChange={e => setListTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setBulkPasteOpen(v => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100"
                >
                  <Sparkles size={13} /> Paste Bulk Lines
                </button>
                <button
                  type="button"
                  onClick={() => setSnagRows(prev => [...prev, emptySnagRow()])}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 hover:bg-slate-200"
                >
                  <Plus size={13} /> Add Row
                </button>
                <button
                  type="submit"
                  disabled={submittingBatch}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
                >
                  <Layers size={13} /> {submittingBatch ? 'Creating...' : `Create Snag List (${snagRows.filter(r => r.item.trim()).length})`}
                </button>
              </div>
            </div>

            {bulkPasteOpen && (
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">Paste multi-line site walk notes (one snag per line):</span>
                  <input
                    type="text"
                    value={bulkDefaultZone}
                    onChange={e => setBulkDefaultZone(e.target.value)}
                    placeholder="Default Zone"
                    className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs text-slate-900 dark:text-white"
                  />
                  <select
                    value={bulkDefaultTrade}
                    onChange={e => setBulkDefaultTrade(e.target.value)}
                    className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-xs text-slate-900 dark:text-white"
                  >
                    {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <textarea
                  rows={4}
                  value={bulkPasteText}
                  onChange={e => setBulkPasteText(e.target.value)}
                  placeholder={"- Missing fire damper actuator wiring in L2 Corridor\n- Chilled water pipe lagging torn near AHU-03\n- DB-2A circuit directory chart missing"}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs text-slate-900 dark:text-white"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setBulkPasteOpen(false)}
                    className="px-3 py-1.5 rounded text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleParseBulkLines}
                    className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold"
                  >
                    Split into Snag Rows
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-2 px-2 text-left w-8">#</th>
                    <th className="py-2 px-2 text-left min-w-[140px]">Zone / Room</th>
                    <th className="py-2 px-2 text-left w-36">Discipline</th>
                    <th className="py-2 px-2 text-left min-w-[260px]">Snag Description</th>
                    <th className="py-2 px-2 text-left w-28">Severity</th>
                    <th className="py-2 px-2 text-left w-32">Date</th>
                    <th className="py-2 px-2 text-center w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {snagRows.map((row, idx) => (
                    <tr key={row.tempId}>
                      <td className="py-1.5 px-2 font-mono text-slate-500">{idx + 1}</td>
                      <td className="py-1.5 px-2">
                        <input
                          type="text"
                          value={row.location}
                          onChange={e =>
                            setSnagRows(prev => prev.map(r => (r.tempId === row.tempId ? { ...r, location: e.target.value } : r)))
                          }
                          placeholder="e.g., L2 Plantroom"
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs text-slate-900 dark:text-white"
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <select
                          value={row.trade}
                          onChange={e =>
                            setSnagRows(prev => prev.map(r => (r.tempId === row.tempId ? { ...r, trade: e.target.value } : r)))
                          }
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs text-slate-900 dark:text-white"
                        >
                          {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5 px-2">
                        <input
                          type="text"
                          value={row.item}
                          onChange={e =>
                            setSnagRows(prev => prev.map(r => (r.tempId === row.tempId ? { ...r, item: e.target.value } : r)))
                          }
                          placeholder="Describe defect / incomplete MEP work..."
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs text-slate-900 dark:text-white"
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <select
                          value={row.priority}
                          onChange={e =>
                            setSnagRows(prev => prev.map(r => (r.tempId === row.tempId ? { ...r, priority: e.target.value } : r)))
                          }
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs text-slate-900 dark:text-white"
                        >
                          {PRIORITIES.map(pr => <option key={pr} value={pr}>{pr}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5 px-2">
                        <input
                          type="date"
                          value={row.date_raised}
                          onChange={e =>
                            setSnagRows(prev => prev.map(r => (r.tempId === row.tempId ? { ...r, date_raised: e.target.value } : r)))
                          }
                          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-xs text-slate-900 dark:text-white"
                        />
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => setSnagRows(prev => (prev.length > 1 ? prev.filter(r => r.tempId !== row.tempId) : prev))}
                          className="p-1 text-slate-400 hover:text-rose-600"
                          aria-label="Remove row"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </form>

          {/* Live Project Snag List Register */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className="text-amber-500" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Active Project Snag List ({punchItems.length})</h2>
              </div>
              <button
                type="button"
                onClick={exportSnagCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 no-print"
              >
                <FileDown size={13} /> Export CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-2.5 px-3 text-left">Location</th>
                    <th className="py-2.5 px-3 text-left">Discipline</th>
                    <th className="py-2.5 px-3 text-left">Snag Description</th>
                    <th className="py-2.5 px-3 text-left">Priority</th>
                    <th className="py-2.5 px-3 text-left">Date</th>
                    <th className="py-2.5 px-3 text-left">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {punchItems.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400">
                        No snag items logged yet. Use the Rapid Snag List Creator above or convert Field Notes.
                      </td>
                    </tr>
                  ) : (
                    punchItems.slice(0, 50).map(item => (
                      <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-white">{item.location || 'Site Wide'}</td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">{item.trade || 'General'}</td>
                        <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200">{item.item}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            {item.priority || 'Medium'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">{item.date_raised || '—'}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                            {item.status || 'Open'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
