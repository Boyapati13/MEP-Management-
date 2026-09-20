/**
 * Risk normalization and score evaluation engine.
 * Ensures compound labels ("very low", "very high") match before single tokens.
 * Evaluates probability (1-5) * impact (1-5) -> score (1-25) and severity levels.
 */

export function normalizeRiskScale(val: any): number {
  if (val === null || val === undefined) return 3; // Default Medium

  // Direct numeric
  const num = parseInt(String(val).trim(), 10);
  if (!isNaN(num) && num >= 1 && num <= 5) return num;

  const str = String(val).toLowerCase().trim();

  // Evaluate compound labels FIRST before simple tokens
  if (str.includes('very low') || str.includes('negligible') || str.includes('trivial')) return 1;
  if (str.includes('very high') || str.includes('catastrophic') || str.includes('critical')) return 5;
  if (str.includes('low') || str.includes('minor')) return 2;
  if (str.includes('medium') || str.includes('moderate')) return 3;
  if (str.includes('high') || str.includes('major')) return 4;

  return 3;
}

export function calculateRiskScore(probabilityVal: any, impactVal: any): {
  score: number;
  level: 'Low' | 'Medium' | 'High' | 'Critical';
  probability_numeric: number;
  impact_numeric: number;
} {
  const p = normalizeRiskScale(probabilityVal);
  const i = normalizeRiskScale(impactVal);
  const score = p * i;

  let level: 'Low' | 'Medium' | 'High' | 'Critical' = 'Medium';
  if (score <= 4) level = 'Low';
  else if (score <= 9) level = 'Medium';
  else if (score <= 14) level = 'High';
  else level = 'Critical';

  return {
    score,
    level,
    probability_numeric: p,
    impact_numeric: i
  };
}
