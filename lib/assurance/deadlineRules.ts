// BrainBase Assurance — deadline (timeframe) rules. ZERO imports
// (client-safe): shared by the Deadlines pages and lib/assurance/deadlines.ts.
//
// A0.1C model (record-specific, NOT organisation-wide SLA configuration):
//   * assurance_timeframes — a due date attached to ONE finding / action / case.
//     original_due_at is immutable at DB level (trigger); current_due_at is
//     the effective deadline and only changes when an extension is APPROVED.
//   * assurance_timeframe_extensions — append-only request history
//     (PENDING → APPROVED | REJECTED | CANCELLED). Never deleted.
//   * assurance_escalations — manual escalation instances on a timeframe
//     (OPEN → ACKNOWLEDGED → RESOLVED; OPEN/ACKNOWLEDGED → CANCELLED).
//
// No code writes timeframe status today: "overdue" is DERIVED (an open
// timeframe whose current_due_at has passed), exactly as the dashboard does,
// so it reads correctly without any background job.

/** Persisted timeframe statuses that count as "still running" (the dashboard's rule). */
export const OPEN_TIMEFRAME_STATUSES = ['ACTIVE', 'OVERDUE'] as const;

/**
 * "Due soon" window, shared with the dashboard's Needs-attention panel
 * (SQL: current_due_at < now() + interval '3 days'). Keep the two in step
 * through lib/assurance/deadlineSql.ts — never redefine it elsewhere.
 */
export const DUE_SOON_DAYS = 3;

/** BrainBase's display timezone convention (also the default user profile timezone). */
export const DEFAULT_ASSURANCE_TIME_ZONE = 'Australia/Adelaide';

export const EXTENSION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ExtensionStatus = (typeof EXTENSION_STATUSES)[number];

export const ESCALATION_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED'] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

/**
 * Escalation levels are neutral numbers (the schema only requires level >= 1).
 * No organisation-defined tier meaning exists; the cap only keeps input sane.
 */
export const ESCALATION_LEVEL_MAX = 5;

export const DEADLINE_REASON_MAX = 2000;

export type EscalationTransition = 'acknowledge' | 'resolve' | 'cancel';

/** The only allowed escalation transitions. Resolving or cancelling never touches the timeframe or its record. */
export const ESCALATION_TRANSITIONS: Record<EscalationTransition, { from: readonly EscalationStatus[]; to: EscalationStatus }> = {
  acknowledge: { from: ['OPEN'], to: 'ACKNOWLEDGED' },
  resolve: { from: ['ACKNOWLEDGED'], to: 'RESOLVED' },
  cancel: { from: ['OPEN', 'ACKNOWLEDGED'], to: 'CANCELLED' },
};

export type DeadlineUrgency = 'OVERDUE' | 'DUE_SOON' | 'ON_TRACK' | 'CLOSED';

/**
 * Urgency of a timeframe at `now`. `open` = the timeframe is still running
 * (ACTIVE/OVERDUE) AND its finding/action is not closed or cancelled.
 */
export function deadlineUrgency(currentDueAt: string | Date | null | undefined, open: boolean, now: Date = new Date()): DeadlineUrgency {
  if (!open || !currentDueAt) return 'CLOSED';
  const due = (currentDueAt instanceof Date ? currentDueAt : new Date(currentDueAt)).getTime();
  if (Number.isNaN(due)) return 'CLOSED';
  if (due < now.getTime()) return 'OVERDUE';
  if (due < now.getTime() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000) return 'DUE_SOON';
  return 'ON_TRACK';
}

export const URGENCY_LABEL: Record<DeadlineUrgency, string> = {
  OVERDUE: 'Overdue',
  DUE_SOON: 'Due soon',
  ON_TRACK: 'On track',
  CLOSED: 'Closed',
};

/** True when the effective deadline differs from the original (an extension was approved). */
export function isExtended(originalDueAt: string | Date, currentDueAt: string | Date): boolean {
  return new Date(originalDueAt).getTime() !== new Date(currentDueAt).getTime();
}

/** A usable IANA zone, or the default. Never throws. */
export function safeTimeZone(zone: string | null | undefined): string {
  if (!zone) return DEFAULT_ASSURANCE_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_ASSURANCE_TIME_ZONE;
  }
}
