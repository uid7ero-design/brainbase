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

// Display copy only — the stored/API value (e.g. 'in_progress') is never
// changed. Known values use the same labels as the status picker; any
// other value is humanised rather than shown raw.
export const LEAD_STATUS_LABEL: Record<string, string> = {
  new:         'New',
  contacted:   'Contacted',
  in_progress: 'In Progress',
  booked:      'Booked',
  closed:      'Closed',
  cancelled:   'Cancelled',
};

export function leadStatusLabel(status: string): string {
  const known = LEAD_STATUS_LABEL[status];
  if (known) return known;
  const words = String(status ?? '').replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}
