// Findings & corrective Actions — pure, client-safe rules (no DB access).
//
// Concepts stay distinct:
//   Finding      = the issue. Its persisted status changes only by explicit
//                  user transitions (plus the explicit reopen). Nothing here
//                  writes a status; operational progress is DERIVED.
//   Action       = corrective work. Work complete, verified and closed are
//                  three separate facts.
//   Task         = execution aid (Organiser) — never read here.
//   Evidence     = proof (A0.1H) — its own decision, not an Action verification.
//   Verification = independent decision about an Action's corrective work.
//
// Derived progress considers EVERY linked Action (including ones the viewer
// cannot see, because closure is guarded on all of them) but callers only
// ever name or count the visible ones.

import type { ActionStatus, FindingStatus, VerificationResult } from './domain';

export const FINDING_TRANSITIONS: Record<FindingStatus, readonly FindingStatus[]> = {
  OPEN: ['UNDER_REVIEW', 'ACTION_REQUIRED', 'CANCELLED'],
  UNDER_REVIEW: ['ACTION_REQUIRED', 'CLOSED', 'CANCELLED'],
  ACTION_REQUIRED: ['ACTION_IN_PROGRESS', 'UNDER_REVIEW', 'CANCELLED'],
  ACTION_IN_PROGRESS: ['AWAITING_VERIFICATION', 'ACTION_REQUIRED'],
  AWAITING_VERIFICATION: ['CLOSED', 'ACTION_IN_PROGRESS'],
  // Reopen (CLOSED -> UNDER_REVIEW) is NOT an ordinary transition: it is a
  // separate, reasoned operation with immutable history (reopenFinding()).
  CLOSED: [],
  CANCELLED: [],
};

/** The only reopen path (A0.1I). */
export const FINDING_REOPEN_TO: FindingStatus = 'UNDER_REVIEW';

export const FINDING_TERMINAL: readonly FindingStatus[] = ['CLOSED', 'CANCELLED'];

export function isFindingTerminal(status: FindingStatus): boolean {
  return status === 'CLOSED' || status === 'CANCELLED';
}

export function isActionFinished(status: ActionStatus): boolean {
  return status === 'CLOSED' || status === 'CANCELLED';
}

/** A terminal transition records a closure reason (A0.1I, enforced in the DB too). */
export function transitionNeedsReason(to: FindingStatus): boolean {
  return to === 'CLOSED' || to === 'CANCELLED';
}

// ── Derived operational progress ─────────────────────────────────────────

export const FINDING_PROGRESS = ['NEEDS_ACTION', 'ACTIONS_UNDERWAY', 'READY_FOR_CLOSURE', 'CLOSED', 'CANCELLED'] as const;
export type FindingProgress = (typeof FINDING_PROGRESS)[number];

export const FINDING_PROGRESS_LABELS: Record<FindingProgress, string> = {
  NEEDS_ACTION: 'No corrective action yet',
  ACTIONS_UNDERWAY: 'Actions underway',
  READY_FOR_CLOSURE: 'Ready for closure decision',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

/**
 * - terminal Finding        -> its status
 * - any open Action         -> ACTIONS_UNDERWAY
 * - >=1 CLOSED Action and none open -> READY_FOR_CLOSURE (every linked
 *   Action is finished, so the closure guard would pass)
 * - otherwise (no Actions, or only cancelled ones) -> NEEDS_ACTION
 * A Finding with no Actions may still be closed directly (an observation
 * needing no corrective work); it is just never presented as "ready".
 */
export function findingProgress(f: { status: FindingStatus; open_action_count: number; closed_action_count: number }): FindingProgress {
  if (f.status === 'CLOSED') return 'CLOSED';
  if (f.status === 'CANCELLED') return 'CANCELLED';
  if (f.open_action_count > 0) return 'ACTIONS_UNDERWAY';
  if (f.closed_action_count > 0) return 'READY_FOR_CLOSURE';
  return 'NEEDS_ACTION';
}

export const FINDING_REGISTER_VIEWS = ['all', 'open', 'needs_action', 'underway', 'overdue', 'ready', 'closed'] as const;
export type FindingRegisterView = (typeof FINDING_REGISTER_VIEWS)[number];

export const FINDING_REGISTER_VIEW_LABELS: Record<FindingRegisterView, string> = {
  all: 'All',
  open: 'Open',
  needs_action: 'Needs action',
  underway: 'Actions underway',
  overdue: 'Overdue',
  ready: 'Ready for closure',
  closed: 'Closed',
};

export function parseFindingView(value: unknown): FindingRegisterView {
  return typeof value === 'string' && (FINDING_REGISTER_VIEWS as readonly string[]).includes(value) ? value as FindingRegisterView : 'all';
}

// ── Closure readiness ────────────────────────────────────────────────────

/** Shortest route of ordinary transitions from `status` to CLOSED, or null. */
export function pathToClosed(status: FindingStatus): FindingStatus[] | null {
  const seen = new Set<FindingStatus>([status]);
  let frontier: FindingStatus[][] = [[status]];
  while (frontier.length > 0) {
    const next: FindingStatus[][] = [];
    for (const path of frontier) {
      for (const to of FINDING_TRANSITIONS[path[path.length - 1]]) {
        if (to === 'CLOSED') return [...path.slice(1), to];
        if (to === 'CANCELLED' || seen.has(to)) continue;
        seen.add(to);
        next.push([...path, to]);
      }
    }
    frontier = next;
  }
  return null;
}

export type ClosureReadiness = { canCloseNow: boolean; blockers: string[]; notes: string[] };

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

/**
 * "What still prevents this Finding from being closed?" — factual blockers
 * only (things the closure guard actually refuses on), plus notes that are
 * true but do not block closure.
 */
export function findingClosureReadiness(input: {
  status: FindingStatus;
  openVisibleActions: { reference: string }[];
  /** Open Actions the viewer cannot see (count never shown). */
  openHiddenActions: number;
  viewerCanClose: boolean;
  closureOverdue?: boolean;
}): ClosureReadiness {
  const blockers: string[] = [];
  const notes: string[] = [];
  if (isFindingTerminal(input.status)) {
    return { canCloseNow: false, blockers: [`This finding is already ${label(input.status)}.`], notes };
  }
  if (!FINDING_TRANSITIONS[input.status].includes('CLOSED')) {
    const path = pathToClosed(input.status);
    const via = path ? path.slice(0, -1).map(label).join(', then ') : null;
    blockers.push(via
      ? `A finding that is ${label(input.status)} cannot move straight to closed — move it to ${via} first.`
      : `A finding that is ${label(input.status)} cannot be closed.`);
  }
  const open = input.openVisibleActions;
  if (open.length > 0) {
    blockers.push(`${open.length === 1 ? 'Linked action' : `${open.length} linked actions`} still open: ${open.map(a => a.reference).join(', ')}. Every linked action must be closed or cancelled.`);
  }
  if (input.openHiddenActions > 0) {
    blockers.push('One or more linked actions you cannot see are still open.');
  }
  if (!input.viewerCanClose) notes.push('Only managers and admins can close or cancel a finding.');
  notes.push('Closing requires a closure reason. Closing never closes actions or source records.');
  if (input.closureOverdue) notes.push('The closure deadline has passed. That does not block closure; request an extension through the Deadline section if more time is needed.');
  return { canCloseNow: blockers.length === 0, blockers, notes };
}

// ── Action: work complete / verified / closed ────────────────────────────

export type ActionWorkState = 'NOT_COMPLETE' | 'COMPLETE' | 'REWORK_REQUIRED';
export type ActionVerificationState = 'NOT_REQUIRED' | 'NOT_YET' | 'VERIFIED' | 'NOT_ACCEPTED' | 'MORE_EVIDENCE';
export type ActionClosureState = 'OPEN' | 'CLOSED' | 'CANCELLED';

export type ActionFacts = { work: ActionWorkState; verification: ActionVerificationState; closure: ActionClosureState };

/**
 * Three separate facts. `work` is REWORK_REQUIRED when the latest
 * verification (recorded after the latest completion) sent the work back.
 */
export function actionFacts(a: {
  status: ActionStatus;
  work_completed_at: string | Date | null;
  verification_required: boolean;
  latest_verification_result: VerificationResult | null;
  latest_verified_at?: string | Date | null;
}): ActionFacts {
  const r = a.latest_verification_result;
  const after = a.latest_verified_at != null && a.work_completed_at != null
    && new Date(a.latest_verified_at).getTime() >= new Date(a.work_completed_at).getTime();
  const sentBack = (r === 'REJECTED' || r === 'PARTIALLY_ACCEPTED') && after;
  const work: ActionWorkState = a.work_completed_at == null ? 'NOT_COMPLETE' : sentBack ? 'REWORK_REQUIRED' : 'COMPLETE';
  const verification: ActionVerificationState = !a.verification_required && r == null ? 'NOT_REQUIRED'
    : r == null ? 'NOT_YET'
      : r === 'ACCEPTED' || r === 'NOT_APPLICABLE' ? 'VERIFIED'
        : r === 'MORE_EVIDENCE_REQUIRED' ? 'MORE_EVIDENCE' : 'NOT_ACCEPTED';
  const closure: ActionClosureState = a.status === 'CLOSED' ? 'CLOSED' : a.status === 'CANCELLED' ? 'CANCELLED' : 'OPEN';
  return { work, verification, closure };
}

export const ACTION_WORK_LABELS: Record<ActionWorkState, string> = {
  NOT_COMPLETE: 'Not complete',
  COMPLETE: 'Work complete',
  REWORK_REQUIRED: 'Rework required',
};
export const ACTION_VERIFICATION_LABELS: Record<ActionVerificationState, string> = {
  NOT_REQUIRED: 'Not required',
  NOT_YET: 'Not yet verified',
  VERIFIED: 'Action verified',
  NOT_ACCEPTED: 'Not accepted',
  MORE_EVIDENCE: 'More evidence required',
};
export const ACTION_CLOSURE_LABELS: Record<ActionClosureState, string> = {
  OPEN: 'Not closed',
  CLOSED: 'Action closed',
  CANCELLED: 'Cancelled',
};

// ── Badge tones (match AssuranceTone in domain.ts) ───────────────────────

type Tone = 'neutral' | 'info' | 'warning' | 'danger' | 'success' | 'accent';

export const FINDING_PROGRESS_TONES: Record<FindingProgress, Tone> = {
  NEEDS_ACTION: 'warning',
  ACTIONS_UNDERWAY: 'info',
  READY_FOR_CLOSURE: 'success',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
};
export const ACTION_WORK_TONES: Record<ActionWorkState, Tone> = { NOT_COMPLETE: 'neutral', COMPLETE: 'success', REWORK_REQUIRED: 'warning' };
export const ACTION_VERIFICATION_TONES: Record<ActionVerificationState, Tone> = {
  NOT_REQUIRED: 'neutral', NOT_YET: 'neutral', VERIFIED: 'success', NOT_ACCEPTED: 'danger', MORE_EVIDENCE: 'warning',
};
export const ACTION_CLOSURE_TONES: Record<ActionClosureState, Tone> = { OPEN: 'neutral', CLOSED: 'success', CANCELLED: 'neutral' };
