// Shared semantic-state vocabulary for StatusDot, Badge, Banner and Alert.
//
// Each state is a distinct meaning, not just a colour:
//   - active   ≠ success  (something is on / selected, not that it went well)
//   - syncing  ≠ info     (both are cyan, but syncing is an in-progress
//                          operation and always carries its own icon shape)
// Colour never carries meaning alone — every rendered state pairs its
// colour with visible text and a state-specific shape.

export const SEMANTIC_STATES = [
  'success',
  'warning',
  'error',
  'info',
  'active',
  'inactive',
  'syncing',
] as const;

export type SemanticState = (typeof SEMANTIC_STATES)[number];

/** Default visible wording when a caller does not supply its own label. */
export const SEMANTIC_STATE_LABELS: Record<SemanticState, string> = {
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
  info: 'Information',
  active: 'Active',
  inactive: 'Inactive',
  syncing: 'Syncing',
};

/**
 * Meaningful transition announcements. Announce these — never a rapidly
 * changing progress percentage.
 */
export const TRANSITION_ANNOUNCEMENTS = {
  syncStarted: 'Sync started',
  syncComplete: 'Sync complete',
  connectionLost: 'Connection lost',
  connectionRestored: 'Connection restored',
} as const;

export type Politeness = 'polite' | 'assertive';
