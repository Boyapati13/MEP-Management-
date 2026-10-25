/**
 * Derives the material list and programme from BOQ lines.
 * Ported from gathering-planner-hub/src/lib/boq-plan.ts for unified BOQ -> Execution planning.
 */
export type BoqRow = {
  id: string;
  company_id?: string | null;
  item_number?: string;
  description?: string;
  discipline?: string;
  system?: string;
  area?: string;
  unit?: string;
  tender_quantity?: number;
  revised_quantity?: number;
  tender_rate?: number;
  data?: Record<string, unknown>;
};

export const NON_MATERIAL =
  /\b(labou?r|installation only|testing|commissioning|service fee|service contract|preliminary|preliminaries|provisional sum|daywork|attendance|dismantling|re-installation|retermination|training|as[- ]fitted drawings|operating manuals)\b/i;

const num = (v: unknown) =>
  v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v);

/** One material line per BOQ supply line not already linked to a material request. */
export function boqMaterialList(boq: BoqRow[], linkedBoqIds: Set<string>) {
  return boq
    .filter((r) => {
      const desc = String(r.description ?? r.data?.description ?? '').trim();
      return !linkedBoqIds.has(String(r.id)) && desc && !NON_MATERIAL.test(desc);
    })
    .map((r) => {
      const d = r.data ?? (r as unknown as Record<string, unknown>);
      return {
        company_id: r.company_id ?? null,
        data: {
          material: String(r.description ?? d.description ?? ''),
          quantity: num(r.revised_quantity ?? d.revised_quantity) ?? num(r.tender_quantity ?? d.tender_quantity) ?? 1,
          unit: String(r.unit ?? d.unit ?? 'pcs'),
          location: String(r.area ?? r.system ?? d.area ?? 'Site'),
          discipline: String(r.discipline ?? d.discipline ?? 'General'),
          boq_record_id: r.id,
          boq_item_number: String(r.item_number ?? d.item_number ?? ''),
          rate: num(r.tender_rate ?? d.tender_rate),
          reason: 'Material list from BOQ',
        },
      };
    });
}

const PHASES = [
  { name: 'Procurement & delivery', share: 0.3 },
  { name: 'Installation', share: 0.5 },
  { name: 'Testing & commissioning', share: 0.2 },
] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/**
 * Groups BOQ lines by discipline (then system/area) and schedules each group as
 * procurement → installation → testing.
 */
export function boqProgramme(
  boq: BoqRow[],
  start: string | null,
  end: string | null,
  plannedGroups: Set<string>,
  today = new Date()
) {
  const groups = new Map<string, { label: string; rows: BoqRow[]; value: number }>();
  for (const r of boq) {
    const d = r.data ?? (r as unknown as Record<string, unknown>);
    const disc = String(r.discipline ?? d.discipline ?? 'General MEP').trim();
    const area = String(r.system ?? r.area ?? d.area ?? '').trim();
    const key = `${disc}|${area}`.toLowerCase();
    const g = groups.get(key) ?? { label: area ? `${disc} · ${area}` : disc, rows: [], value: 0 };
    g.rows.push(r);
    const qty = num(r.revised_quantity ?? d.revised_quantity) ?? num(r.tender_quantity ?? d.tender_quantity) ?? 0;
    const rate = num(r.tender_rate ?? d.tender_rate) ?? 0;
    g.value += qty * rate;
    groups.set(key, g);
  }
  const s = start ? new Date(start) : today;
  const e = end && new Date(end) > s ? new Date(end) : addDays(s, 180);
  const span = Math.max(14, Math.round((e.getTime() - s.getTime()) / 86400000));
  const list = [...groups.entries()];
  const total = list.reduce((t, [, g]) => t + (g.value || 1), 0);

  const tasks: { group: string; data: Record<string, unknown>; company_id: string | null }[] = [];
  list.forEach(([key, g], i) => {
    if (plannedGroups.has(key)) return;
    const offset = list.length > 1 ? Math.round((span * 0.4 * i) / (list.length - 1)) : 0;
    const length = Math.max(7, Math.round(span * 0.6 * Math.min(1, 0.5 + (g.value || 1) / total)));
    const length2 = Math.min(length, span - offset);
    let cursor = addDays(s, offset);
    const companies = new Set(g.rows.map((r) => r.company_id ?? null));
    const company = companies.size === 1 ? [...companies][0] : null;
    const firstRow = g.rows[0];
    const firstData = firstRow.data ?? (firstRow as unknown as Record<string, unknown>);
    PHASES.forEach((p, n) => {
      const days = Math.max(2, Math.round(length2 * p.share));
      const finish = addDays(cursor, days);
      tasks.push({
        group: key,
        company_id: company,
        data: {
          title: `${g.label} — ${p.name}`,
          trade: String(firstRow.discipline ?? firstData.discipline ?? 'HVAC'),
          priority: n === 1 ? 'High' : 'Medium',
          start: iso(cursor),
          end: iso(finish),
          baseline_end_date: iso(finish),
          progress: 0,
          boq_group: key,
          boq_record_ids: g.rows.map((r) => r.id),
          description: `${g.rows.length} BOQ line(s): ${g.rows
            .slice(0, 5)
            .map((r) => r.item_number || r.description || r.data?.item_number || r.data?.description)
            .join(', ')}${g.rows.length > 5 ? '…' : ''}`,
        },
      });
      cursor = finish;
    });
  });
  return tasks;
}
