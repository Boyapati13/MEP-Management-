import { DatabaseSync } from "node:sqlite";

const DAY_MS = 86400000;

function parseIsoDay(val?: string | null): number | null {
  if (!val) return null;
  const m = String(val).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ts) ? null : ts;
}

function formatIsoDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Computes inclusive calendar duration in days between two YYYY-MM-DD dates.
 */
export function computeTaskDurationDays(start?: string | null, end?: string | null): number {
  const s = parseIsoDay(start);
  const e = parseIsoDay(end);
  if (s === null || e === null) return 14;
  return Math.max(1, Math.round((e - s) / DAY_MS) + 1);
}

/**
 * Classifies an MEP task into a standard construction phase (1..5)
 * so Master Schedule dates follow realistic construction sequencing.
 */
export function classifyMepPhase(
  title: string,
  trade?: string | null
): { phaseOrder: number; startFrac: number; endFrac: number } {
  const text = `${title || ""} ${trade || ""}`.toLowerCase();

  if (/(handover|as-built|as built|o&m|certificate|snag|completion|other items|operational installation)/.test(text)) {
    return { phaseOrder: 5, startFrac: 0.85, endFrac: 1.0 };
  }
  if (/(pressure test|testing|balancing|commission|megger|flushing|chlorination|inspection)/.test(text)) {
    return { phaseOrder: 4, startFrac: 0.68, endFrac: 0.92 };
  }
  if (/(panel|board|ups|generator|chiller|ahu|fcu|pump|fixture|tap|bib tap|lighting|luminaire|socket|accessory|access control|cctv|fire alarm|elv|second fix|2nd fix|termination)/.test(text)) {
    return { phaseOrder: 3, startFrac: 0.42, endFrac: 0.78 };
  }
  if (/(buried|underground|containment|tray|trunking|basket|submittal|design|drawing|mobilis|prelim|builders work|sleeve|core)/.test(text)) {
    return { phaseOrder: 1, startFrac: 0.0, endFrac: 0.32 };
  }
  // Default: Phase 2 — First Fix / Main Pipework, Ductwork & Cabling
  return { phaseOrder: 2, startFrac: 0.16, endFrac: 0.58 };
}

/**
 * Resequences all tasks in a project across the project's contract window
 * by MEP construction phase, setting accurate start, end, baseline dates,
 * duration, and clean WBS numbering (1.1, 1.2, ...).
 */
export function resequenceProjectSchedule(
  db: DatabaseSync,
  projectId: string
): { updatedCount: number; tasks: any[] } {
  const project = db.prepare("SELECT id, start_date, end_date FROM projects WHERE id = ?").get(projectId) as any;
  const rawTasks = db.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY rowid ASC").all(projectId) as any[];
  if (!project || rawTasks.length === 0) {
    return { updatedCount: 0, tasks: [] };
  }

  const todayMs = parseIsoDay(new Date().toISOString().slice(0, 10))!;
  const projStartMs = parseIsoDay(project.start_date) ?? todayMs;
  let projEndMs = parseIsoDay(project.end_date) ?? projStartMs + 120 * DAY_MS;
  if (projEndMs <= projStartMs + 14 * DAY_MS) {
    projEndMs = projStartMs + 120 * DAY_MS;
  }
  const totalSpanDays = Math.max(30, Math.round((projEndMs - projStartMs) / DAY_MS));

  const classified = rawTasks.map((t) => ({
    task: t,
    phase: classifyMepPhase(t.title, t.trade),
  }));

  classified.sort((a, b) => {
    if (a.phase.phaseOrder !== b.phase.phaseOrder) {
      return a.phase.phaseOrder - b.phase.phaseOrder;
    }
    return String(a.task.title || "").localeCompare(String(b.task.title || ""), undefined, { numeric: true });
  });

  // Group within each phase so tasks in the same phase stagger cleanly
  const phaseBuckets = new Map<number, typeof classified>();
  for (const item of classified) {
    const arr = phaseBuckets.get(item.phase.phaseOrder) || [];
    arr.push(item);
    phaseBuckets.set(item.phase.phaseOrder, arr);
  }

  const updateStmt = db.prepare(`
    UPDATE tasks
    SET start = ?, end = ?, baseline_start_date = ?, baseline_end_date = ?,
        forecast_start_date = ?, forecast_end_date = ?, duration = ?, wbs_code = ?
    WHERE id = ?
  `);

  const updatedTasks: any[] = [];
  let seq = 1;

  for (const item of classified) {
    const bucket = phaseBuckets.get(item.phase.phaseOrder)!;
    const idxInBucket = bucket.indexOf(item);
    const countInBucket = Math.max(1, bucket.length);

    const phaseStartDay = Math.round(item.phase.startFrac * totalSpanDays);
    const phaseEndDay = Math.max(phaseStartDay + 7, Math.round(item.phase.endFrac * totalSpanDays));
    const phaseSpan = Math.max(7, phaseEndDay - phaseStartDay);

    const slotStep = countInBucket > 1 ? Math.floor((phaseSpan * 0.6) / (countInBucket - 1)) : 0;
    const taskStartOffset = phaseStartDay + idxInBucket * slotStep;
    const taskDur = Math.max(5, Math.min(phaseSpan, Math.round(phaseSpan * 0.55)));
    const taskEndOffset = Math.min(totalSpanDays, taskStartOffset + taskDur - 1);

    const startIso = formatIsoDay(projStartMs + taskStartOffset * DAY_MS);
    const endIso = formatIsoDay(projStartMs + Math.max(taskStartOffset, taskEndOffset) * DAY_MS);
    const dur = computeTaskDurationDays(startIso, endIso);
    const wbs = `1.${seq++}`;

    updateStmt.run(
      startIso,
      endIso,
      startIso,
      endIso,
      startIso,
      endIso,
      dur,
      wbs,
      item.task.id
    );

    updatedTasks.push({
      ...item.task,
      start: startIso,
      end: endIso,
      baseline_start_date: startIso,
      baseline_end_date: endIso,
      duration: dur,
      wbs_code: wbs,
    });
  }

  return { updatedCount: updatedTasks.length, tasks: updatedTasks };
}
