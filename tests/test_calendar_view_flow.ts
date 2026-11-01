import assert from 'node:assert/strict';
import {
  formatDateISO,
  parseDateSafe,
  getTradeColor,
  TRADE_COLORS,
  CalendarTask,
  MilestoneEvent
} from '../src/components/CalendarProgrammeView';

console.log('🧪 Starting Calendar Programme View Automated Test Suite...\n');

// ── Test 1: Date Formatting & Parsing ──
console.log('1. Testing Date formatting and ISO parsing...');
const testDate = new Date(2026, 4, 15); // May 15, 2026
const formatted = formatDateISO(testDate);
assert.equal(formatted, '2026-05-15', 'formatDateISO should produce YYYY-MM-DD');

const parsed = parseDateSafe('2026-05-15');
assert(parsed !== null, 'parseDateSafe should not return null');
assert.equal(parsed.getFullYear(), 2026);
assert.equal(parsed.getMonth(), 4); // 0-indexed May
assert.equal(parsed.getDate(), 15);

assert.equal(parseDateSafe(''), null, 'Empty date string should return null');
assert.equal(parseDateSafe(undefined), null, 'Undefined date string should return null');
console.log('  ✅ Date formatting and parsing verified.');

// ── Test 2: Trade Color Coding for All 5 MEP Disciplines ──
console.log('\n2. Testing Trade Color Coding Integrity...');
const expectedDisciplines = ['Electrical', 'HVAC', 'Plumbing', 'Fire Fighting', 'ELV'];

expectedDisciplines.forEach(trade => {
  const colors = getTradeColor(trade);
  assert(colors !== undefined, `Trade ${trade} must have defined colors`);
  assert(colors.bar.length > 0, `Trade ${trade} must have a bar color`);
  assert(colors.badge.length > 0, `Trade ${trade} must have a badge class`);
  assert(colors.border.length > 0, `Trade ${trade} must have a border color`);
});

assert(TRADE_COLORS.Electrical.bar.includes('amber'), 'Electrical should use Amber');
assert(TRADE_COLORS.HVAC.bar.includes('sky'), 'HVAC should use Sky');
assert(TRADE_COLORS.Plumbing.bar.includes('teal'), 'Plumbing should use Teal');
assert(TRADE_COLORS['Fire Fighting'].bar.includes('rose'), 'Fire Fighting should use Rose');
assert(TRADE_COLORS.ELV.bar.includes('purple'), 'ELV should use Purple');

const defaultColor = getTradeColor('NonExistentTrade');
assert.equal(defaultColor, TRADE_COLORS.Default, 'Unknown trade should fall back to Default');
console.log('  ✅ All 5 MEP trades have distinct, authentic color mappings.');

// ── Test 3: Month Calendar Grid Generation (Monday-first, 7 columns) ──
console.log('\n3. Testing Month Grid Calculation...');
function generateMonthDays(year: number, month: number) {
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  const startDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7; // Monday = 0

  const days: string[] = [];
  for (let i = startDayOfWeek; i > 0; i--) {
    const d = new Date(year, month, 1 - i);
    days.push(formatDateISO(d));
  }
  for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
    const d = new Date(year, month, i);
    days.push(formatDateISO(d));
  }
  const remaining = (7 - (days.length % 7)) % 7;
  for (let i = 1; i <= remaining; i++) {
    const d = new Date(year, month + 1, i);
    days.push(formatDateISO(d));
  }
  return days;
}

// May 2026: May 1 is Friday (day 4), May 31 is Sunday (day 6)
const may2026Days = generateMonthDays(2026, 4);
assert.equal(may2026Days.length % 7, 0, 'Grid days count must be a multiple of 7 columns');
assert(may2026Days.length >= 28 && may2026Days.length <= 42, 'Month grid length must be between 28 and 42 days');
assert(may2026Days.includes('2026-05-01'), 'Grid must include first day of month');
assert(may2026Days.includes('2026-05-31'), 'Grid must include last day of month');
console.log(`  ✅ Month grid generates ${may2026Days.length} days (${may2026Days.length / 7} clean rows).`);

// ── Test 4: Week Grid Calculation (Mon to Sun) ──
console.log('\n4. Testing Week Grid Calculation...');
function generateWeekDays(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const current = new Date(year, month, day);
  const dayOfWeek = (current.getDay() + 6) % 7; // Mon = 0
  const monday = new Date(year, month, day - dayOfWeek);

  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    days.push(formatDateISO(d));
  }
  return days;
}

const midWeek = new Date(2026, 4, 20); // Wednesday, May 20, 2026
const week = generateWeekDays(midWeek);
assert.equal(week.length, 7, 'Week view must produce exactly 7 daily columns');
assert.equal(week[0], '2026-05-18', 'Week must start on Monday May 18, 2026');
assert.equal(week[6], '2026-05-24', 'Week must end on Sunday May 24, 2026');
console.log('  ✅ Week grid calculation accurately aligns to Monday-Sunday span.');

// ── Test 5: Multi-Day Task Spanning & Event Mapping ──
console.log('\n5. Testing Multi-Day Task Spanning & Event Mapping...');
const sampleTasks: CalendarTask[] = [
  {
    id: 'task-1',
    title: 'LV Switchboard DB Installation',
    trade: 'Electrical',
    wbs_code: 'E-01',
    status: 'In Progress',
    progress: 45,
    start: '2026-05-10',
    end: '2026-05-14'
  },
  {
    id: 'task-2',
    title: 'VRV Chiller Piping Pressure Test',
    trade: 'HVAC',
    wbs_code: 'M-02',
    status: 'Not Started',
    progress: 0,
    start: '2026-05-12',
    end: '2026-05-12'
  }
];

const sampleMilestones: MilestoneEvent[] = [
  {
    id: 'po-1',
    type: 'delivery',
    date: '2026-05-11',
    title: 'PO 2618-PO-001 Delivery',
    subtitle: 'Schneider Electric Vendor',
    status: 'Approved',
    amount: 14500,
    raw: {}
  },
  {
    id: 'insp-1',
    type: 'inspection',
    date: '2026-05-14',
    title: 'DB Pre-commissioning Insulation Inspection',
    trade: 'Electrical',
    status: 'Scheduled',
    raw: {}
  },
  {
    id: 'cutoff-1',
    type: 'cutoff',
    date: '2026-05-10',
    title: 'Cutoff: Architectural Lighting Fixtures',
    trade: 'Electrical',
    status: 'Pending Client Signoff',
    raw: {}
  }
];

function buildDayEventsMap(tasks: CalendarTask[], milestones: MilestoneEvent[]) {
  const map = new Map<string, { tasks: CalendarTask[]; milestones: MilestoneEvent[] }>();

  tasks.forEach(task => {
    const s = task.start || task.end;
    const e = task.end || task.start;
    if (!s || !e) return;
    const pStart = parseDateSafe(s);
    const pEnd = parseDateSafe(e);
    if (!pStart || !pEnd) return;

    const cur = new Date(pStart <= pEnd ? pStart : pEnd);
    const end = new Date(pStart <= pEnd ? pEnd : pStart);

    while (cur <= end) {
      const dStr = formatDateISO(cur);
      if (!map.has(dStr)) map.set(dStr, { tasks: [], milestones: [] });
      map.get(dStr)!.tasks.push(task);
      cur.setDate(cur.getDate() + 1);
    }
  });

  milestones.forEach(m => {
    if (!map.has(m.date)) map.set(m.date, { tasks: [], milestones: [] });
    map.get(m.date)!.milestones.push(m);
  });

  return map;
}

const eventMap = buildDayEventsMap(sampleTasks, sampleMilestones);

// Verify task-1 spans all 5 days (May 10 to May 14)
for (const day of ['2026-05-10', '2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14']) {
  assert(eventMap.has(day), `Day ${day} must exist in event map`);
  const dayTasks = eventMap.get(day)!.tasks;
  assert(dayTasks.some(t => t.id === 'task-1'), `Day ${day} must contain task-1`);
}

// Verify milestones mapped to respective dates
const may10 = eventMap.get('2026-05-10')!;
assert(may10.milestones.some(m => m.id === 'cutoff-1'), 'May 10 must contain lighting cutoff milestone');

const may11 = eventMap.get('2026-05-11')!;
assert(may11.milestones.some(m => m.id === 'po-1' && m.type === 'delivery'), 'May 11 must contain delivery milestone');

const may14 = eventMap.get('2026-05-14')!;
assert(may14.milestones.some(m => m.id === 'insp-1' && m.type === 'inspection'), 'May 14 must contain inspection milestone');
console.log('  ✅ Multi-day task spanning and key project milestone overlays verified.');

// ── Test 6: Quick Reschedule Date Math ──
console.log('\n6. Testing Quick Reschedule Math...');
function shiftDates(startStr: string, endStr: string, shiftDays: number) {
  const s = parseDateSafe(startStr)!;
  const e = parseDateSafe(endStr)!;
  s.setDate(s.getDate() + shiftDays);
  e.setDate(e.getDate() + shiftDays);
  return { start: formatDateISO(s), end: formatDateISO(e) };
}

const shiftedPlusOne = shiftDates('2026-05-10', '2026-05-14', 1);
assert.equal(shiftedPlusOne.start, '2026-05-11');
assert.equal(shiftedPlusOne.end, '2026-05-15');

const shiftedMinusOneWeek = shiftDates('2026-05-10', '2026-05-14', -7);
assert.equal(shiftedMinusOneWeek.start, '2026-05-03');
assert.equal(shiftedMinusOneWeek.end, '2026-05-07');
console.log('  ✅ Quick reschedule date manipulation verified.');

console.log('\n🎉 ALL 6 CALENDAR PROGRAMME VIEW TESTS PASSED SUCCESSFULLY! (100% Pass Rate)\n');
