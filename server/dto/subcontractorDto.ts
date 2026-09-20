/**
 * Allowlisted DTO projections for Subcontractor role.
 * Strictly redacts main contractor margins, total PO amounts, vendor rates, and other subcontractors' data.
 */

export interface SubcontractorWorkPackageDto {
  id: string;
  project_id: string;
  code: string;
  name: string;
  discipline: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  progress_percentage: number;
}

export function toSubcontractorWorkPackageDto(wp: any): SubcontractorWorkPackageDto {
  return {
    id: wp?.id || '',
    project_id: wp?.project_id || '',
    code: wp?.code || '',
    name: wp?.name || '',
    discipline: wp?.discipline || wp?.trade || '',
    status: wp?.status || 'Active',
    start_date: wp?.start_date || null,
    end_date: wp?.end_date || null,
    progress_percentage: Number(wp?.progress_percentage ?? wp?.progress ?? 0)
  };
}

export interface SubcontractorProcurementDto {
  id: string;
  po_number: string;
  item_name: string;
  quantity: number;
  unit: string;
  status: string;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  work_package_id: string | null;
  task_id: string | null;
}

export function toSubcontractorProcurementDto(po: any): SubcontractorProcurementDto {
  return {
    id: po?.id || '',
    po_number: po?.po_number || po?.reference || '',
    item_name: po?.item_name || po?.description || '',
    quantity: Number(po?.quantity || 0),
    unit: po?.unit || 'ea',
    status: po?.status || 'Ordered',
    expected_delivery_date: po?.expected_delivery_date || null,
    actual_delivery_date: po?.actual_delivery_date || null,
    work_package_id: po?.work_package_id || null,
    task_id: po?.task_id || null
  };
}
