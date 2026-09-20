/**
 * Allowlisted DTO projections for the Client role.
 * Guarantees zero leakage of internal budgets, margins, subcontractor costs, or internal notes.
 */

export interface ClientProjectSummaryDto {
  id: string;
  name: string;
  code: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  client_name: string | null;
  description: string | null;
}

export function toClientProjectSummaryDto(p: any): ClientProjectSummaryDto {
  return {
    id: p?.id || '',
    name: p?.name || '',
    code: p?.code || '',
    status: p?.status || 'Active',
    start_date: p?.start_date || null,
    end_date: p?.end_date || null,
    client_name: p?.client_name || null,
    description: p?.description || null
  };
}

export interface ClientPublishedReportDto {
  id: string;
  project_id: string;
  report_no: string;
  title: string;
  period_start: string | null;
  period_end: string | null;
  published_at: string | null;
  revision_no: number;
  supersedes_report_id: string | null;
  executive_summary: string | null;
  overall_progress_percent: number;
  milestone_summary: string | null;
  snapshot_data: any | null;
}

export function toClientPublishedReportDto(r: any): ClientPublishedReportDto {
  let parsedSnapshot = null;
  if (r?.snapshot_data) {
    try {
      parsedSnapshot = typeof r.snapshot_data === 'string' ? JSON.parse(r.snapshot_data) : r.snapshot_data;
    } catch {}
  }
  return {
    id: r?.id || '',
    project_id: r?.project_id || '',
    report_no: r?.report_no || '',
    title: r?.title || '',
    period_start: r?.period_start || null,
    period_end: r?.period_end || null,
    published_at: r?.published_at || null,
    revision_no: r?.revision_no || 0,
    supersedes_report_id: r?.supersedes_report_id || null,
    executive_summary: r?.executive_summary || r?.description || null,
    overall_progress_percent: Number(r?.overall_progress_percent ?? r?.certified_progress ?? 0),
    milestone_summary: r?.milestone_summary || null,
    snapshot_data: parsedSnapshot
  };
}

export function toClientDocumentDto(d: any) {
  return {
    id: d?.id,
    project_id: d?.project_id,
    title: d?.title,
    document_number: d?.document_number || d?.doc_number,
    category: d?.category,
    status: d?.status,
    revision: d?.revision,
    file_name: d?.file_name || d?.name,
    created_at: d?.created_at
  };
}

export function toClientClarificationDto(c: any) {
  return {
    id: c?.id,
    project_id: c?.project_id,
    clarification_no: c?.clarification_no,
    subject: c?.subject,
    question: c?.question,
    answer: c?.answer,
    status: c?.status,
    priority: c?.priority,
    created_at: c?.created_at,
    answered_at: c?.answered_at
  };
}
