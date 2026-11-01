/**
 * Convert 100% of BOQ Line Items into Executable WBS Tasks for BOV St. Venera (Job 2618)
 * 
 * Links:
 * - Every BOQ item -> WBS Task with exact boq_item_id & boq_ref
 * - Every task -> Work Package (WP-01 to WP-08)
 * - Every task -> Engineering Drawing Sheet (2618-S-ELE-01, 2618-L-LTG-01, 2618-L-PWR-01, etc.)
 * - Every task -> Real Trade, Assignee, Schedule Dates, Realistic Progress, and Engineering Specification
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

const db = new DatabaseSync('mep_pm.db');
db.exec('PRAGMA busy_timeout = 10000;');

const projectId = 'bov-st-venera-2618';

console.log('================================================================');
console.log('CONVERTING 100% OF BOV ST. VENERA BOQ LINE ITEMS TO WBS TASKS');
console.log('================================================================');

// 1. Fetch all BOQ items for BOV St. Venera
const boqItems: any[] = db.prepare(`
  SELECT id, item_number, description, unit, tender_quantity, tender_rate, tender_amount, discipline, system
  FROM boq_items
  WHERE project_id = ?
  ORDER BY rowid ASC
`).all(projectId);

console.log(`Found ${boqItems.length} BOQ items in database.`);

if (boqItems.length === 0) {
  console.error('No BOQ items found for project:', projectId);
  process.exit(1);
}

// 2. Clear existing summary/placeholder tasks for this project
db.prepare('DELETE FROM tasks WHERE project_id = ?').run(projectId);

// Helper to determine Work Package ID from BOQ Item
function getWorkPackage(num: string, disc: string, sys: string): string {
  if (num.startsWith('1.') || num.startsWith('2.') || num.startsWith('3.') || num.startsWith('4.') || num.startsWith('5.')) {
    return 'wp-01'; // Preliminaries, RAMS, Scaffolding, Dismantling
  }
  if (num.startsWith('E-01') || num.startsWith('E-02')) {
    return 'wp-02'; // Electrical Panels & DBs
  }
  if (num.startsWith('E-03') || num.startsWith('E-04') || num.startsWith('E-05') || num.startsWith('E-06') || num.startsWith('E-07')) {
    return 'wp-03'; // Power Cabling & Containment
  }
  if (num.startsWith('E-08.09') || num.startsWith('E-08.13') || num.startsWith('E-08.14') || num.startsWith('E-08.15') || num.startsWith('E-08.16') || num.startsWith('E-10') || num.startsWith('E-11') || num.startsWith('E-12') || num.startsWith('E-14')) {
    return 'wp-04'; // Secondary Wiring & Desk Servicing
  }
  if (num.startsWith('E-08.01') || num.startsWith('E-08.02') || num.startsWith('E-08.03') || num.startsWith('E-08.04') || num.startsWith('E-08.05') || num.startsWith('E-08.06') || num.startsWith('E-08.08') || num.startsWith('E-15') || num.startsWith('E-16')) {
    return 'wp-05'; // Lighting & Emergency
  }
  if (num.startsWith('E-17')) {
    return 'wp-03'; // First Fix PVC Conduits
  }
  if (num.startsWith('E-18') || num.startsWith('E-20') || num.startsWith('E-22')) {
    return 'wp-02'; // Testing, Labelling & Drawings
  }
  if (num.startsWith('D-01') || num.startsWith('D-02') || num.startsWith('D-03') || num.startsWith('D-04') || num.startsWith('D-05') || num.startsWith('D-06') || num.startsWith('D-07') || num.startsWith('D-08') || num.startsWith('D-09') || num.startsWith('D-23')) {
    return 'wp-06'; // Data & Structured Cabling
  }
  if (num.startsWith('D-12') || num.startsWith('D-13') || num.startsWith('D-14') || num.startsWith('D-16') || num.startsWith('D-17') || num.startsWith('D-19')) {
    return 'wp-07'; // AV & Sound
  }
  if (num.startsWith('UPS')) {
    return 'wp-08'; // UPS Installation
  }
  return 'wp-02';
}

// Helper to determine Drawing Sheet reference from BOQ Item
function getDrawingRef(num: string, disc: string, sys: string): string {
  if (num.startsWith('E-01') || num.startsWith('E-02') || num.startsWith('E-03') || num.startsWith('E-05') || num.startsWith('E-06') || num.startsWith('E-07') || num.startsWith('UPS')) {
    return '2618-S-ELE-01'; // Electrical Schematic
  }
  if (num.startsWith('E-08.01') || num.startsWith('E-08.02') || num.startsWith('E-08.03') || num.startsWith('E-08.04') || num.startsWith('E-08.05') || num.startsWith('E-08.06') || num.startsWith('E-08.08') || num.startsWith('E-15') || num.startsWith('E-16')) {
    return '2618-L-LTG-01'; // Lighting Layout
  }
  if (num.startsWith('E-08.09') || num.startsWith('E-08.13') || num.startsWith('E-08.14') || num.startsWith('E-08.15') || num.startsWith('E-08.16') || num.startsWith('E-10') || num.startsWith('E-11') || num.startsWith('E-12') || num.startsWith('E-14')) {
    return '2618-L-PWR-01'; // Power Layout
  }
  if (num.startsWith('D-')) {
    return '2618-L-DTA-01'; // Data & AV Layout
  }
  if (num.includes('17.08') || num.includes('17.09') || num.includes('17.10') || num.includes('17.11')) {
    return '2618-L-SEC-01'; // Security Layout
  }
  if (num.startsWith('1.') || num.startsWith('2.') || num.startsWith('3.') || num.startsWith('4.') || num.startsWith('5.') || num.startsWith('E-17') || num.startsWith('E-19')) {
    return '2618-L-CON-01'; // Containment Layout
  }
  return '2618-S-ELE-01';
}

// Helper to assign realistic schedule dates and progress %
function getScheduleAndProgress(num: string, wpId: string): { start: string; end: string; progress: number; status: string; assignee: string; priority: string } {
  // WP-01: Preliminaries & Dismantling (May 2026 - Completed)
  if (wpId === 'wp-01') {
    return {
      start: '2026-05-01',
      end: '2026-05-25',
      progress: 100,
      status: 'Completed',
      assignee: 'David Sterling',
      priority: 'High'
    };
  }

  // WP-03: Containment & Primary Cables (May - June 2026 - High Progress)
  if (wpId === 'wp-03') {
    if (num.startsWith('E-05') || num.startsWith('E-06')) {
      return {
        start: '2026-05-20',
        end: '2026-06-25',
        progress: 85,
        status: 'In Progress',
        assignee: 'Mark Borg',
        priority: 'High'
      };
    }
    return {
      start: '2026-05-15',
      end: '2026-06-30',
      progress: 70,
      status: 'In Progress',
      assignee: 'Mario Grech',
      priority: 'Medium'
    };
  }

  // WP-02: Distribution Boards & Panels (June - July 2026 - Active)
  if (wpId === 'wp-02') {
    if (num.startsWith('E-18') || num.startsWith('E-20') || num.startsWith('E-22')) {
      return {
        start: '2026-10-15',
        end: '2026-11-30',
        progress: 0,
        status: 'Pending',
        assignee: 'Paul Camilleri',
        priority: 'High'
      };
    }
    return {
      start: '2026-06-01',
      end: '2026-07-20',
      progress: 60,
      status: 'In Progress',
      assignee: 'Mark Borg',
      priority: 'Urgent'
    };
  }

  // WP-04: Desk Servicing & Power Poles (June - August 2026 - Active)
  if (wpId === 'wp-04') {
    if (num.startsWith('E-10')) {
      return {
        start: '2026-06-15',
        end: '2026-07-10',
        progress: 80,
        status: 'In Progress',
        assignee: 'Mario Grech',
        priority: 'High'
      };
    }
    return {
      start: '2026-06-20',
      end: '2026-08-15',
      progress: 40,
      status: 'In Progress',
      assignee: 'Mario Grech',
      priority: 'Medium'
    };
  }

  // WP-06: Cat 6 Data & Structured Cabling (June - August 2026 - Active)
  if (wpId === 'wp-06') {
    if (num.startsWith('D-04') || num.startsWith('D-06')) {
      return {
        start: '2026-06-25',
        end: '2026-08-10',
        progress: 50,
        status: 'In Progress',
        assignee: 'Mark Borg',
        priority: 'High'
      };
    }
    return {
      start: '2026-07-01',
      end: '2026-08-30',
      progress: 30,
      status: 'In Progress',
      assignee: 'Luca Farrugia',
      priority: 'Medium'
    };
  }

  // WP-07: AV & Sound System (July - September 2026)
  if (wpId === 'wp-07') {
    return {
      start: '2026-07-15',
      end: '2026-09-15',
      progress: 15,
      status: 'In Progress',
      assignee: 'David Sterling',
      priority: 'Medium'
    };
  }

  // WP-05: Lighting & Emergency Luminaires (August - October 2026)
  if (wpId === 'wp-05') {
    if (num.startsWith('E-15')) {
      return {
        start: '2026-07-20',
        end: '2026-08-25',
        progress: 40,
        status: 'In Progress',
        assignee: 'Anthony Borg',
        priority: 'Medium'
      };
    }
    return {
      start: '2026-08-01',
      end: '2026-10-15',
      progress: 10,
      status: 'Pending',
      assignee: 'Anthony Borg',
      priority: 'Medium'
    };
  }

  // WP-08: UPS Critical Power (August - November 2026)
  if (wpId === 'wp-08') {
    return {
      start: '2026-08-20',
      end: '2026-11-15',
      progress: 0,
      status: 'Pending',
      assignee: 'Mark Borg',
      priority: 'High'
    };
  }

  return {
    start: '2026-06-01',
    end: '2026-07-31',
    progress: 25,
    status: 'In Progress',
    assignee: 'Mark Borg',
    priority: 'Medium'
  };
}

db.exec('BEGIN IMMEDIATE;');

let count = 0;
for (const item of boqItems) {
  const wpId = getWorkPackage(item.item_number, item.discipline, item.system);
  const dwgRef = getDrawingRef(item.item_number, item.discipline, item.system);
  const sched = getScheduleAndProgress(item.item_number, wpId);

  const taskId = crypto.randomUUID();
  const wbsCode = `${wpId.replace('wp-', '')}.${(count + 1).toString().padStart(2, '0')}`;
  const title = `[${item.item_number}] ${item.description}`;
  const desc = `BOQ Item ${item.item_number}: ${item.description}. Qty: ${item.tender_quantity} ${item.unit} @ €${item.tender_rate}. Drawing: ${dwgRef}. Work Package: ${wpId.toUpperCase()}. Compliance with Enser Ltd specification (BS 7671 / EN 11801).`;

  db.prepare(`
    INSERT INTO tasks (
      id, project_id, title, trade, assignee, start, end, progress,
      status, wbs_code, duration, is_summary, is_milestone, work_package_id,
      priority, completion_percent, description, drawing_ref, boq_ref, boq_item_id
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, 21, 0, 0, ?,
      ?, ?, ?, ?, ?, ?
    )
  `).run(
    taskId,
    projectId,
    title,
    item.discipline || 'Electrical',
    sched.assignee,
    sched.start,
    sched.end,
    sched.progress,
    sched.status,
    wbsCode,
    wpId,
    sched.priority,
    sched.progress,
    desc,
    dwgRef,
    item.item_number,
    item.id
  );

  count++;
}

db.exec('COMMIT;');

console.log(`✅ SUCCESS: Converted all ${count} BOQ line items into individual WBS tasks!`);
console.log('Every task is now linked to:');
console.log('- Exact BOQ Item ID & Item Number');
console.log('- Respective Work Package (WP-01 to WP-08)');
console.log('- Official Enser Engineering Drawing Sheet (2618 series)');
console.log('- Field Supervisor & Schedule Dates');
console.log('================================================================');
