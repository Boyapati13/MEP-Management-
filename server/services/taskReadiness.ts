import { DatabaseSync } from 'node:sqlite';

export type ReadinessStatus = 'passed' | 'failed' | 'pending';

export interface ReadinessCheck {
  status: ReadinessStatus;
  required: boolean;
  details?: string;
  source?: {
    type: string;
    id: string;
  };
}

export interface TaskBlockerSummary {
  id: string;
  type: string;
  description: string;
  impact_days: number;
  source_type?: string;
  source_id?: string;
}

export interface TaskReadinessResult {
  task_id: string;
  status: 'Ready' | 'Pending' | 'Blocked';
  checks: {
    predecessors: ReadinessCheck;
    procurement: ReadinessCheck;
    drawings: ReadinessCheck;
    submittals: ReadinessCheck;
    rfi: ReadinessCheck;
    workforce: ReadinessCheck;
    access: ReadinessCheck;
  };
  blockers: TaskBlockerSummary[];
  calculated_at: string;
}

/**
 * Authoritative single source of truth for task installation readiness.
 * Evaluates predecessors, material procurement, drawings, submittals, RFIs, workforce, and site access.
 */
export function calculateTaskReadiness(db: DatabaseSync, taskId: string): TaskReadinessResult {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
  const now = new Date().toISOString();

  if (!task) {
    return {
      task_id: taskId,
      status: 'Blocked',
      checks: {
        predecessors: { status: 'failed', required: true, details: 'Task not found' },
        procurement: { status: 'failed', required: true, details: 'Task not found' },
        drawings: { status: 'failed', required: true, details: 'Task not found' },
        submittals: { status: 'failed', required: true, details: 'Task not found' },
        rfi: { status: 'failed', required: true, details: 'Task not found' },
        workforce: { status: 'failed', required: true, details: 'Task not found' },
        access: { status: 'failed', required: true, details: 'Task not found' }
      },
      blockers: [],
      calculated_at: now
    };
  }

  // 1. Fetch active blockers
  const blockersRows = db.prepare(`
    SELECT id, blocker_type, description, impact_days, source_type, source_id
    FROM task_blockers
    WHERE task_id = ? AND (status = 'Active' OR resolved = 0)
  `).all(taskId) as any[];

  const blockers: TaskBlockerSummary[] = blockersRows.map(b => ({
    id: b.id,
    type: b.blocker_type,
    description: b.description,
    impact_days: Number(b.impact_days || 0),
    source_type: b.source_type,
    source_id: b.source_id
  }));

  // 2. Predecessor dependencies check
  let predStatus: ReadinessStatus = 'passed';
  let predDetails = 'All predecessor tasks completed or none required';
  const uncompletedPredecessors = db.prepare(`
    SELECT t.id, t.title, t.status
    FROM dependencies d
    JOIN tasks t ON (t.id = d.predecessor_task_id OR t.id = d.predecessor_id)
    WHERE (d.task_id = ? OR d.successor_id = ?) AND t.status NOT IN ('Completed', 'Closed')
  `).all(taskId, taskId) as any[];

  if (uncompletedPredecessors.length > 0) {
    predStatus = 'failed';
    predDetails = `${uncompletedPredecessors.length} predecessor task(s) uncompleted (${uncompletedPredecessors[0].title})`;
  }

  // 3. Procurement check
  let procStatus: ReadinessStatus = 'passed';
  let procDetails = 'Materials available or delivered';
  let procSource: any = undefined;

  const procurementBlocker = blockers.find(b => b.type === 'Procurement');
  if (procurementBlocker) {
    procStatus = 'failed';
    procDetails = procurementBlocker.description;
    procSource = { type: 'purchase_order', id: procurementBlocker.source_id || '' };
  } else {
    // Check if there are open POs for this task that are not yet delivered
    const openPos = db.prepare(`
      SELECT id, po_number, description, status
      FROM purchase_orders
      WHERE task_id = ? AND status NOT IN ('Delivered', 'Cancelled')
    `).all(taskId) as any[];

    if (openPos.length > 0) {
      procStatus = 'pending';
      procDetails = `${openPos.length} purchase order(s) pending delivery`;
      procSource = { type: 'purchase_order', id: openPos[0].id };
    }
  }

  // 4. Drawing check
  let dwgStatus: ReadinessStatus = 'passed';
  let dwgDetails = 'Drawing reference verified';
  if (!task.drawing_ref) {
    dwgStatus = 'pending';
    dwgDetails = 'No IFC drawing reference assigned';
  } else {
    dwgDetails = `Drawing ref: ${task.drawing_ref}`;
  }

  // 5. Submittal check
  let subStatus: ReadinessStatus = 'passed';
  let subDetails = 'Technical submittals approved';
  if (task.work_package_id) {
    const openSubmittals = db.prepare(`
      SELECT id, number, status
      FROM submittals
      WHERE work_package_id = ? AND status NOT IN ('Approved', 'Approved as Noted', 'Closed')
    `).all(task.work_package_id) as any[];

    if (openSubmittals.length > 0) {
      subStatus = 'pending';
      subDetails = `${openSubmittals.length} submittal(s) awaiting approval (${openSubmittals[0].number || 'Pending'})`;
    }
  }

  // 6. RFI check
  let rfiStatus: ReadinessStatus = 'passed';
  let rfiDetails = 'No blocking RFIs';
  const openRfis = db.prepare(`
    SELECT id, number, subject, status
    FROM rfis
    WHERE project_id = ? AND status NOT IN ('Closed', 'Answered')
  `).all(task.project_id) as any[];

  if (openRfis.length > 0 && task.trade) {
    const tradeRfis = openRfis.filter((r: any) => !r.trade || r.trade === task.trade);
    if (tradeRfis.length > 0) {
      rfiStatus = 'failed';
      rfiDetails = `${tradeRfis.length} open technical RFI(s) affecting work (${tradeRfis[0].number || 'RFI'})`;
    }
  }

  // 7. Workforce check
  let wfStatus: ReadinessStatus = 'passed';
  let wfDetails = 'Assigned trade operatives verified';
  if (!task.assignee && !task.trade && !task.work_package_id) {
    wfStatus = 'pending';
    wfDetails = 'No trade or operative assigned';
  } else {
    wfDetails = `Trade: ${task.trade || 'General'} | Assigned: ${task.assignee || 'Package Team'}`;
  }

  // 8. Site Access check
  let accStatus: ReadinessStatus = 'passed';
  let accDetails = 'Site work area clear and accessible';
  const accessBlocker = blockers.find(b => b.type === 'Site' || b.type === 'Access');
  if (accessBlocker) {
    accStatus = 'failed';
    accDetails = accessBlocker.description;
  }

  // Determine overall status
  const checks = {
    predecessors: { status: predStatus, required: true, details: predDetails },
    procurement: { status: procStatus, required: true, details: procDetails, source: procSource },
    drawings: { status: dwgStatus, required: false, details: dwgDetails },
    submittals: { status: subStatus, required: false, details: subDetails },
    rfi: { status: rfiStatus, required: true, details: rfiDetails },
    workforce: { status: wfStatus, required: true, details: wfDetails },
    access: { status: accStatus, required: true, details: accDetails }
  };

  let overallStatus: 'Ready' | 'Pending' | 'Blocked' = 'Ready';

  // Any required check failed or any active blocker -> Blocked
  const hasFailedRequired = Object.values(checks).some(c => c.required && c.status === 'failed') || blockers.length > 0;
  if (hasFailedRequired) {
    overallStatus = 'Blocked';
  } else {
    const hasPendingRequired = Object.values(checks).some(c => c.required && c.status === 'pending');
    if (hasPendingRequired) {
      overallStatus = 'Pending';
    }
  }

  return {
    task_id: taskId,
    status: overallStatus,
    checks,
    blockers,
    calculated_at: now
  };
}
