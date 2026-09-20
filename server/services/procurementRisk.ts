/**
 * Evaluates procurement lead-time buffer against programme task start dates.
 * Distinguishes analytical risk level (Critical, Warning, On Track, Delivered)
 * from executable blocking state (Blocked when buffer < 0).
 */

export interface ProcurementProgrammeImpact {
  buffer_days: number;
  risk_level: 'Critical' | 'Warning' | 'On Track' | 'Delivered';
  is_blocked: boolean;
  impact_description: string;
}

export function evaluateProcurementImpact(
  taskStartDateStr: string | null | undefined,
  poDeliveryDateStr: string | null | undefined,
  poStatus?: string | null,
  warningThresholdDays = 7
): ProcurementProgrammeImpact {
  if (poStatus === 'Delivered') {
    return {
      buffer_days: 0,
      risk_level: 'Delivered',
      is_blocked: false,
      impact_description: 'Materials delivered to site'
    };
  }

  if (!taskStartDateStr || !poDeliveryDateStr) {
    return {
      buffer_days: 0,
      risk_level: 'On Track',
      is_blocked: false,
      impact_description: 'Dates not specified'
    };
  }

  const taskStart = new Date(taskStartDateStr).getTime();
  const poDelivery = new Date(poDeliveryDateStr).getTime();

  if (isNaN(taskStart) || isNaN(poDelivery)) {
    return {
      buffer_days: 0,
      risk_level: 'On Track',
      is_blocked: false,
      impact_description: 'Invalid date format'
    };
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  const bufferDays = Math.round((taskStart - poDelivery) / msPerDay);

  if (bufferDays < 0) {
    const delay = Math.abs(bufferDays);
    return {
      buffer_days: bufferDays,
      risk_level: 'Critical',
      is_blocked: true,
      impact_description: `Delivery delayed by ${delay} day${delay === 1 ? '' : 's'} past task start date`
    };
  }

  if (bufferDays <= warningThresholdDays) {
    return {
      buffer_days: bufferDays,
      risk_level: 'Warning',
      is_blocked: false,
      impact_description: `Tight buffer (${bufferDays} days) before task installation start`
    };
  }

  return {
    buffer_days: bufferDays,
    risk_level: 'On Track',
    is_blocked: false,
    impact_description: `Healthy lead-time buffer (${bufferDays} days)`
  };
}
