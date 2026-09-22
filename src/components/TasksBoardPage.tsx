/**
 * TasksBoardPage — Professional MEP Construction Task Board
 * Kanban + List hybrid · BOQ workflow · Unified action controls
 * 15-year senior FE standard: clean, purposeful, zero redundancy
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, RefreshCw, Search, Filter, CheckCircle2, Clock3, AlertOctagon,
  CircleDot, Camera, Edit3, Trash2, X, Upload, Eye, ChevronDown,
  LayoutGrid, List, ArrowRight, Check, Calendar, User, Building2,
  Hash, Shield, Image as ImageIcon, MoreHorizontal, Move, ZoomIn,
  TrendingUp, Target, Activity, Layers, Download
} from 'lucide-react';
import { tasksApi, projectsApi } from '../api';
import { TaskDetailModal } from './TaskDetailModal';
import { CompleteTaskModal } from './CompleteTaskModal';

// ─── Types ────────────────────────────────────────────────────────────────────
type TaskStatus = 'Not Started' | 'In Progress' | 'Completed' | 'Blocked';
type ViewMode = 'kanban' | 'list';

interface Task {
  id: string;
  title: string;
  description?: string;
  trade?: string;
  priority?: string;
  status: TaskStatus;
  progress: number;
  wbs_code?: string;
  boq_ref?: string;
  drawing_ref?: string;
  start?: string;
  end?: string;
  actual_end_date?: string;
  site_name?: string;
  work_package_name?: string;
  company_name?: string;
  supervisor_name?: string;
  evidence_url?: string;
  evidence_notes?: string;
  evidence_required?: number;
  project_id?: string;
}

// ─── Status Config ─────────────────────────────────────────────────────────────
const STATUSES: { id: TaskStatus; label: string; icon: React.ComponentType<any>; accent: string; bg: string; border: string; text: string; dot: string }[] = [
  { id: 'Not Started', label: 'Not Started', icon: CircleDot, accent: 'bg-slate-500', bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', dot: 'bg-slate-400' },
  { id: 'In Progress', label: 'In Progress', icon: Clock3, accent: 'bg-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', dot: 'bg-blue-500' },
  { id: 'Completed', label: 'Completed', icon: CheckCircle2, accent: 'bg-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  { id: 'Blocked', label: 'Blocked', icon: AlertOctagon, accent: 'bg-red-600', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500' },
];

const PRIORITY_PILL: Record<string, string> = {
  Critical: 'bg-red-100 text-red-800 border border-red-200',
  High: 'bg-orange-100 text-orange-800 border border-orange-200',
  Medium: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
  Low: 'bg-gray-100 text-gray-600 border border-gray-200',
};

const TRADE_PILL: Record<string, string> = {
  Electrical: 'bg-amber-100 text-amber-800',
  HVAC: 'bg-sky-100 text-sky-800',
  Plumbing: 'bg-cyan-100 text-cyan-800',
  'Fire Fighting': 'bg-rose-100 text-rose-800',
  ELV: 'bg-violet-100 text-violet-800',
};

function fmtDate(d?: string) {
  if (!d) return null;
  try { return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' }); }
  catch { return d; }
}

function cn(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(' '); }

// ─── Compact KPI Strip ─────────────────────────────────────────────────────────
function KpiStrip({ tasks }: { tasks: Task[] }) {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'Completed').length;
  const wip = tasks.filter(t => t.status === 'In Progress').length;
  const blocked = tasks.filter(t => t.status === 'Blocked').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const withPhoto = tasks.filter(t => t.evidence_url).length;

  return (
    <div className="flex items-center gap-0 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {[
        { label: 'Total', val: total, cls: 'text-gray-900', bar: 'bg-gray-200' },
        { label: 'Done', val: done, cls: 'text-emerald-700', bar: 'bg-emerald-500' },
        { label: 'In Progress', val: wip, cls: 'text-blue-700', bar: 'bg-blue-500' },
        { label: 'Blocked', val: blocked, cls: 'text-red-700', bar: 'bg-red-500' },
        { label: 'With Photo', val: withPhoto, cls: 'text-indigo-700', bar: 'bg-indigo-500' },
      ].map((k, i) => (
        <div key={k.label} className={cn('flex-1 px-4 py-3 border-r border-gray-100 last:border-r-0', i === 0 ? '' : '')}>
          <div className={cn('text-xl font-bold tabular-nums', k.cls)}>{k.val}</div>
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-0.5">{k.label}</div>
        </div>
      ))}
      <div className="flex-1 px-4 py-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Progress</span>
          <span className="text-sm font-bold text-gray-900">{pct}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div className="h-1.5 bg-emerald-500 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

// ─── Task Card (Kanban) ────────────────────────────────────────────────────────
function TaskCard({
  task, onEdit, onDelete, onMoveStatus, onComplete, onViewPhoto
}: {
  task: Task;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  onMoveStatus: (t: Task, s: TaskStatus) => void;
  onComplete: (t: Task) => void;
  onViewPhoto: (t: Task) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const isDone = task.status === 'Completed';
  const statusCfg = STATUSES.find(s => s.id === task.status)!;
  const nextStatuses = STATUSES.filter(s => s.id !== task.status);

  return (
    <div className={cn(
      'bg-white rounded-xl border shadow-xs hover:shadow-sm transition-shadow p-4 group relative',
      isDone ? 'border-emerald-200' : 'border-gray-100'
    )}>
      {/* Top row: WBS + priority + trade */}
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {task.wbs_code && (
            <span className="text-[10px] font-mono font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
              {task.wbs_code}
            </span>
          )}
          {task.trade && (
            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', TRADE_PILL[task.trade] || 'bg-gray-100 text-gray-600')}>
              {task.trade}
            </span>
          )}
          {task.priority && task.priority !== 'Medium' && (
            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', PRIORITY_PILL[task.priority])}>
              {task.priority}
            </span>
          )}
        </div>

        {/* Action Menu */}
        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="p-1 text-gray-300 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-7 z-20 bg-white rounded-xl border border-gray-100 shadow-xl py-1 min-w-[160px]">
              <button
                onClick={() => { setMenuOpen(false); onEdit(task); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Edit3 size={13} className="text-blue-500" /> Edit Details
              </button>

              {!isDone && (
                <button
                  onClick={() => { setMenuOpen(false); onComplete(task); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 hover:bg-emerald-50 transition-colors"
                >
                  <Camera size={13} className="text-emerald-600" /> Mark Done + Photo
                </button>
              )}

              {task.evidence_url && (
                <button
                  onClick={() => { setMenuOpen(false); onViewPhoto(task); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 hover:bg-indigo-50 transition-colors"
                >
                  <ZoomIn size={13} className="text-indigo-500" /> View Evidence
                </button>
              )}

              <div className="border-t border-gray-100 my-1" />
              <div className="px-3 py-1">
                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1">Move to</p>
              </div>
              {nextStatuses.map(s => (
                <button
                  key={s.id}
                  onClick={() => { setMenuOpen(false); onMoveStatus(task, s.id); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <span className={cn('w-2 h-2 rounded-full flex-shrink-0', s.dot)} />
                  {s.label}
                </button>
              ))}

              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={() => { setMenuOpen(false); onDelete(task); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 size={13} /> Delete Task
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Title */}
      <h3 className={cn(
        'text-sm font-semibold leading-snug mb-2 cursor-pointer hover:text-blue-600 transition-colors',
        isDone ? 'text-gray-500 line-through decoration-emerald-400/60 decoration-1' : 'text-gray-900'
      )} onClick={() => onEdit(task)}>
        {task.title}
      </h3>

      {/* Progress bar */}
      {!isDone && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[10px] text-gray-400 font-medium mb-1">
            <span>Progress</span>
            <span className="text-gray-700 font-bold">{task.progress || 0}%</span>
          </div>
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-1 bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(task.progress || 0, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Evidence thumbnail (if done + photo) */}
      {isDone && task.evidence_url && (
        <button
          onClick={() => onViewPhoto(task)}
          className="w-full mb-3 rounded-lg overflow-hidden border border-emerald-200 relative group/thumb h-24 bg-gray-900"
        >
          <img src={task.evidence_url} alt="" className="w-full h-full object-cover group-hover/thumb:scale-105 transition-transform duration-300" />
          <div className="absolute inset-0 bg-emerald-900/40 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity">
            <ZoomIn size={18} className="text-white" />
          </div>
          <span className="absolute bottom-1 left-1 text-[9px] bg-emerald-600 text-white px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5">
            <Check size={9} /> Verified
          </span>
        </button>
      )}

      {/* Footer meta */}
      <div className="flex items-center justify-between text-[10px] text-gray-400 mt-1">
        <div className="flex items-center gap-2 flex-wrap">
          {task.site_name && (
            <span className="flex items-center gap-0.5"><Building2 size={9} className="text-gray-400" />{task.site_name}</span>
          )}
          {task.boq_ref && (
            <span className="flex items-center gap-0.5 font-mono"><Hash size={9} />{task.boq_ref.replace('BOQ-2618-', '')}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {task.end && (
            <span className={cn(
              'flex items-center gap-0.5',
              !isDone && new Date(task.end) < new Date() ? 'text-red-500 font-bold' : ''
            )}>
              <Calendar size={9} />
              {fmtDate(task.end)}
            </span>
          )}
          {isDone && !task.evidence_url && (
            <button
              onClick={() => onComplete(task)}
              className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold hover:bg-amber-200 transition-colors border border-amber-200"
            >
              + Photo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Kanban Column ─────────────────────────────────────────────────────────────
function KanbanColumn({
  status, tasks, onEdit, onDelete, onMoveStatus, onComplete, onViewPhoto, onAddTask
}: {
  status: typeof STATUSES[0];
  tasks: Task[];
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  onMoveStatus: (t: Task, s: TaskStatus) => void;
  onComplete: (t: Task) => void;
  onViewPhoto: (t: Task) => void;
  onAddTask: () => void;
}) {
  const StatusIcon = status.icon;

  return (
    <div className="flex flex-col min-w-[280px] max-w-xs flex-1">
      {/* Column Header */}
      <div className={cn('rounded-t-xl px-4 py-3 flex items-center justify-between', status.accent)}>
        <div className="flex items-center gap-2">
          <StatusIcon size={15} className="text-white" />
          <span className="text-xs font-bold text-white uppercase tracking-wide">{status.label}</span>
        </div>
        <span className="text-xs font-bold bg-white/20 text-white px-2 py-0.5 rounded-full">{tasks.length}</span>
      </div>

      {/* Task Cards */}
      <div className={cn('rounded-b-xl border border-t-0 p-2 space-y-2 flex-1 min-h-[80px] overflow-y-auto max-h-[calc(100vh-320px)]', status.border, status.bg)}>
        {tasks.map(t => (
          <TaskCard
            key={t.id}
            task={t}
            onEdit={onEdit}
            onDelete={onDelete}
            onMoveStatus={onMoveStatus}
            onComplete={onComplete}
            onViewPhoto={onViewPhoto}
          />
        ))}
        {tasks.length === 0 && (
          <div className="py-8 text-center text-xs text-gray-400">
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-2">
              <StatusIcon size={14} className="text-gray-300" />
            </div>
            No tasks
          </div>
        )}
      </div>

      {/* Quick Add */}
      {status.id === 'Not Started' && (
        <button
          onClick={onAddTask}
          className="mt-2 w-full py-2.5 rounded-xl border border-dashed border-gray-200 text-xs font-semibold text-gray-400 hover:text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-all flex items-center justify-center gap-1.5"
        >
          <Plus size={13} /> Add Task
        </button>
      )}
    </div>
  );
}

// ─── List Row ─────────────────────────────────────────────────────────────────
function ListRow({
  task, onEdit, onDelete, onMoveStatus, onComplete, onViewPhoto
}: {
  task: Task;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  onMoveStatus: (t: Task, s: TaskStatus) => void;
  onComplete: (t: Task) => void;
  onViewPhoto: (t: Task) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isDone = task.status === 'Completed';
  const statusCfg = STATUSES.find(s => s.id === task.status)!;
  const isOverdue = !isDone && task.end && new Date(task.end) < new Date();

  useEffect(() => {
    if (!menuOpen) return;
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  return (
    <tr className={cn(
      'group hover:bg-gray-50/80 transition-colors border-b border-gray-50',
      isDone && 'bg-emerald-50/30'
    )}>
      {/* Status indicator */}
      <td className="pl-4 pr-2 py-3 w-2">
        <span className={cn('w-2 h-2 rounded-full inline-block', statusCfg.dot)} />
      </td>

      {/* WBS + Title */}
      <td className="py-3 pr-4 max-w-[280px]">
        <div className="flex items-center gap-2">
          {task.wbs_code && (
            <span className="text-[10px] font-mono font-bold text-gray-400 whitespace-nowrap">{task.wbs_code}</span>
          )}
        </div>
        <button
          onClick={() => onEdit(task)}
          className={cn(
            'text-xs font-semibold text-left hover:text-blue-600 transition-colors leading-snug block',
            isDone ? 'text-gray-400 line-through decoration-emerald-400/60' : 'text-gray-900'
          )}
        >
          {task.title}
        </button>
        {task.description && (
          <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{task.description}</p>
        )}
      </td>

      {/* Trade */}
      <td className="py-3 pr-3 hidden sm:table-cell">
        {task.trade && (
          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded whitespace-nowrap', TRADE_PILL[task.trade] || 'bg-gray-100 text-gray-600')}>
            {task.trade}
          </span>
        )}
      </td>

      {/* Status badge */}
      <td className="py-3 pr-3 hidden md:table-cell">
        <span className={cn('text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap', statusCfg.bg, statusCfg.text, 'border', statusCfg.border)}>
          {task.status}
        </span>
      </td>

      {/* Progress */}
      <td className="py-3 pr-4 w-28 hidden lg:table-cell">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={cn('h-1.5 rounded-full transition-all', isDone ? 'bg-emerald-500' : 'bg-blue-500')}
              style={{ width: `${Math.min(task.progress || 0, 100)}%` }}
            />
          </div>
          <span className="text-[10px] font-bold text-gray-600 w-7 text-right">{task.progress || 0}%</span>
        </div>
      </td>

      {/* Due date */}
      <td className="py-3 pr-3 hidden xl:table-cell">
        {task.end ? (
          <span className={cn('text-[10px] font-medium whitespace-nowrap', isOverdue ? 'text-red-600 font-bold' : 'text-gray-500')}>
            {fmtDate(task.end)}
          </span>
        ) : <span className="text-[10px] text-gray-300">—</span>}
      </td>

      {/* Evidence */}
      <td className="py-3 pr-3 hidden lg:table-cell">
        {task.evidence_url ? (
          <button onClick={() => onViewPhoto(task)} className="group/ev flex items-center gap-1">
            <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold border border-emerald-200 flex items-center gap-1 group-hover/ev:bg-emerald-200 transition-colors">
              <Camera size={9} /> Photo
            </span>
          </button>
        ) : isDone ? (
          <button onClick={() => onComplete(task)} className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold border border-amber-200 hover:bg-amber-200 transition-colors">
            + Add
          </button>
        ) : null}
      </td>

      {/* Actions */}
      <td className="py-3 pr-3 text-right">
        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" ref={menuRef}>
          {!isDone ? (
            <button
              onClick={() => onComplete(task)}
              className="p-1.5 text-gray-300 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
              title="Mark Done + Evidence"
            >
              <Camera size={13} />
            </button>
          ) : task.evidence_url ? (
            <button
              onClick={() => onViewPhoto(task)}
              className="p-1.5 text-emerald-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
              title="View evidence photo"
            >
              <Eye size={13} />
            </button>
          ) : null}
          <button
            onClick={() => onEdit(task)}
            className="p-1.5 text-gray-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="Edit"
          >
            <Edit3 size={13} />
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="p-1.5 text-gray-300 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <MoreHorizontal size={13} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-20 bg-white rounded-xl border border-gray-100 shadow-xl py-1 min-w-[150px]">
                {STATUSES.filter(s => s.id !== task.status).map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setMenuOpen(false); onMoveStatus(task, s.id); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <span className={cn('w-2 h-2 rounded-full', s.dot)} /> {s.label}
                  </button>
                ))}
                <div className="border-t border-gray-100 my-1" />
                <button
                  onClick={() => { setMenuOpen(false); onDelete(task); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Photo Lightbox ────────────────────────────────────────────────────────────
function PhotoLightbox({ task, onClose }: { task: Task | null; onClose: () => void }) {
  if (!task?.evidence_url) return null;
  return (
    <div
      className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-slate-900 rounded-2xl overflow-hidden max-w-4xl w-full shadow-2xl border border-slate-700 flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 bg-slate-950/80 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 bg-emerald-400 rounded-full" />
            <div>
              <p className="text-xs font-bold text-white">{task.title}</p>
              <p className="text-[10px] text-slate-400 font-mono">{task.wbs_code} · Task Completion Evidence</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-black/50 flex items-center justify-center p-4">
          <img src={task.evidence_url} alt="Evidence" className="max-h-[70vh] w-auto max-w-full rounded-xl shadow-lg object-contain" />
        </div>
        {task.evidence_notes && (
          <div className="px-5 py-3 bg-slate-950/90 border-t border-slate-800">
            <p className="text-xs text-slate-300"><span className="text-emerald-400 font-bold">Signoff Notes: </span>{task.evidence_notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
interface TasksBoardPageProps {
  navigate: (page: string, param?: string) => void;
  projects: any[];
  selectedProject: string;
  setSelectedProject: (id: string) => void;
  addToast: (type: 'success' | 'error' | 'info', msg: string) => void;
  user: any;
}

export function TasksBoardPage({
  navigate, projects, selectedProject, setSelectedProject, addToast, user
}: TasksBoardPageProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [search, setSearch] = useState('');
  const [tradeFilter, setTradeFilter] = useState('All');
  const [showFilters, setShowFilters] = useState(false);

  // Modal state
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [completingTask, setCompletingTask] = useState<Task | null>(null);
  const [lightboxTask, setLightboxTask] = useState<Task | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (selectedProject) params.project_id = selectedProject;
      const data = await tasksApi.list(params);
      setTasks(Array.isArray(data) ? data : []);
    } catch {
      addToast('error', 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [selectedProject, addToast]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const filtered = tasks.filter(t => {
    const matchTrade = tradeFilter === 'All' || t.trade === tradeFilter;
    const q = search.toLowerCase();
    const matchSearch = !q ||
      (t.title || '').toLowerCase().includes(q) ||
      (t.wbs_code || '').toLowerCase().includes(q) ||
      (t.boq_ref || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q);
    return matchTrade && matchSearch;
  });

  const handleOpenCreate = () => {
    setEditingTask(null);
    setShowEditModal(true);
  };

  const handleEdit = (t: Task) => {
    setEditingTask(t);
    setShowEditModal(true);
  };

  const handleDelete = async (t: Task) => {
    if (!confirm(`Delete task "${t.title}"? This cannot be undone.`)) return;
    try {
      await tasksApi.delete(t.id);
      addToast('success', 'Task deleted');
      loadTasks();
    } catch (err: any) {
      addToast('error', err.message || 'Delete failed');
    }
  };

  const handleMoveStatus = async (t: Task, newStatus: TaskStatus) => {
    // Route to completion modal when marking complete (requires photo)
    if (newStatus === 'Completed') {
      setCompletingTask(t);
      return;
    }
    try {
      const progress = newStatus === 'In Progress' ? Math.max(t.progress || 25, 25) : (newStatus === 'Not Started' ? 0 : t.progress);
      await tasksApi.update(t.id, { status: newStatus, progress });
      addToast('success', `Moved to ${newStatus}`);
      loadTasks();
    } catch (err: any) {
      addToast('error', err.message || 'Update failed');
    }
  };

  const trades = ['All', ...Array.from(new Set(tasks.map(t => t.trade).filter(Boolean) as string[]))];

  return (
    <div className="flex flex-col gap-5 h-full">
      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 leading-tight">BOQ Work Programme</h1>
          <p className="text-xs text-gray-400 mt-0.5">Construction task board · drag tasks to Done · attach evidence photos</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* View Toggle */}
          <div className="flex items-center bg-gray-100 rounded-xl p-0.5">
            <button
              onClick={() => setViewMode('kanban')}
              className={cn('px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all flex items-center gap-1.5',
                viewMode === 'kanban' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}
            >
              <LayoutGrid size={13} /> Board
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn('px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all flex items-center gap-1.5',
                viewMode === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}
            >
              <List size={13} /> List
            </button>
          </div>
          <button
            onClick={loadTasks}
            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors"
            title="Refresh"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus size={14} /> New Task
          </button>
        </div>
      </div>

      {/* ── KPI Strip ───────────────────────────────────────────────────────── */}
      <KpiStrip tasks={tasks} />

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="flex items-center gap-2 flex-1 max-w-sm bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-xs">
          <Search size={14} className="text-gray-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="Search tasks, WBS, BOQ ref…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-xs w-full focus:outline-none text-gray-800 placeholder-gray-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Project selector */}
        <select
          value={selectedProject}
          onChange={e => setSelectedProject(e.target.value)}
          className="text-xs font-semibold border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-xs"
        >
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        {/* Trade filter pills */}
        <div className="flex items-center gap-1">
          {trades.map(trade => (
            <button
              key={trade}
              onClick={() => setTradeFilter(trade)}
              className={cn(
                'px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors whitespace-nowrap border',
                tradeFilter === trade
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              )}
            >
              {trade}
            </button>
          ))}
        </div>

        <div className="ml-auto text-[11px] text-gray-400 font-medium">
          {filtered.length} of {tasks.length} tasks
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs text-gray-400">Loading tasks…</p>
          </div>
        </div>
      ) : viewMode === 'kanban' ? (
        /* ── Kanban Board ─────────────────────────────────────────────────── */
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STATUSES.map(status => (
            <KanbanColumn
              key={status.id}
              status={status}
              tasks={filtered.filter(t => t.status === status.id)}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onMoveStatus={handleMoveStatus}
              onComplete={t => setCompletingTask(t)}
              onViewPhoto={t => setLightboxTask(t)}
              onAddTask={handleOpenCreate}
            />
          ))}
        </div>
      ) : (
        /* ── List View ────────────────────────────────────────────────────── */
        <div className="bg-white rounded-xl border border-gray-100 shadow-xs overflow-hidden">
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Layers size={36} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm font-medium text-gray-500">No tasks found</p>
              <p className="text-xs text-gray-400 mt-1">Try adjusting your filters or search term</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="w-2 pl-4 py-2" />
                  <th className="py-2 pr-4 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">Task</th>
                  <th className="py-2 pr-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider hidden sm:table-cell">Trade</th>
                  <th className="py-2 pr-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider hidden md:table-cell">Status</th>
                  <th className="py-2 pr-4 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider hidden lg:table-cell w-28">Progress</th>
                  <th className="py-2 pr-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider hidden xl:table-cell">Due</th>
                  <th className="py-2 pr-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Evidence</th>
                  <th className="py-2 pr-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-wider w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <ListRow
                    key={t.id}
                    task={t}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onMoveStatus={handleMoveStatus}
                    onComplete={t => setCompletingTask(t)}
                    onViewPhoto={t => setLightboxTask(t)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      <TaskDetailModal
        open={showEditModal}
        onClose={() => { setShowEditModal(false); setEditingTask(null); }}
        onSaved={loadTasks}
        task={editingTask}
        projectId={selectedProject || (projects[0]?.id ?? '')}
      />

      <CompleteTaskModal
        open={!!completingTask}
        task={completingTask}
        onClose={() => setCompletingTask(null)}
        onCompleted={loadTasks}
        onToast={addToast}
      />

      <PhotoLightbox
        task={lightboxTask}
        onClose={() => setLightboxTask(null)}
      />
    </div>
  );
}
