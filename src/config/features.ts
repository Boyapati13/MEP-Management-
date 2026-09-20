/**
 * Release V1.4.1 Feature Flags
 * Controls UX consolidation, role-specific workspaces, and hardening features.
 */

export const FEATURES = {
  V1_4_1_NAVIGATION_ENABLED: true,
  V1_4_1_WORKSPACES_ENABLED: true,
  V1_4_1_OFFLINE_BANNER_ENABLED: true,
  V1_4_1_STRICT_SCOPES_ENABLED: true,
  V1_4_1_READINESS_CHECKS_ENABLED: true,
  V1_4_1_MONOTONIC_SEQUENCES_ENABLED: true
} as const;

export type FeatureFlag = keyof typeof FEATURES;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURES[flag] ?? false;
}
