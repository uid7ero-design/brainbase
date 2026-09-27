import type { SemanticState } from '@/components/ui/semantic';

// Tenant lead status → shared semantic state (colour + shape + visible text),
// replacing the dark-only Tailwind -400 palette. Every status keeps its own
// meaning; an unrecognised status falls back to "new" exactly as before.
export const LEAD_STATUS_STATE: Record<string, SemanticState> = {
  new:         'info',
  contacted:   'warning',
  in_progress: 'warning',
  booked:      'success',
  closed:      'inactive',
  cancelled:   'error',
};

export function leadStatusState(status: string): SemanticState {
  return LEAD_STATUS_STATE[status] ?? LEAD_STATUS_STATE.new;
}
