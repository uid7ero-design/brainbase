// Incidents & Investigations — pure, client-safe rules (no DB access).
//
// Concepts stay distinct:
//   Incident      = the event / occurrence (manual triage lifecycle).
//   Investigation = the structured process to understand it.
//   Finding       = an identified issue; Action = corrective work.
// Nothing here writes a status. Triage facts, register views and closure
// readiness are DERIVED from existing fields and the existing closure rules
// (lib/assurance/incidents.ts, investigations.ts) — no new policy gates.
// Hidden (restricted) records are counted only to say "one or more"; they
// are never named.

import type { IncidentStatus, InvestigationStatus } from './domain';

export const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  REPORTED: ['UNDER_REVIEW', 'CANCELLED'],
  UNDER_REVIEW: ['INVESTIGATION_REQUIRED', 'ACTION_REQUIRED', 'AWAITING_VERIFICATION', 'CLOSED', 'CANCELLED'],
  INVESTIGATION_REQUIRED: ['UNDER_INVESTIGATION', 'UNDER_REVIEW', 'CANCELLED'],
  UNDER_INVESTIGATION: ['ACTION_REQUIRED', 'AWAITING_VERIFICATION', 'UNDER_REVIEW'],
  ACTION_REQUIRED: ['AWAITING_VERIFICATION', 'UNDER_REVIEW'],
  AWAITING_VERIFICATION: ['CLOSED', 'ACTION_REQUIRED'],
  CLOSED: [],
  CANCELLED: [],
};

export const INVESTIGATION_TRANSITIONS: Record<InvestigationStatus, readonly InvestigationStatus[]> = {
  OPEN: ['PLANNING', 'IN_PROGRESS', 'CANCELLED'],
  PLANNING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['AWAITING_INFORMATION', 'AWAITING_REVIEW', 'CANCELLED'],
  AWAITING_INFORMATION: ['IN_PROGRESS', 'CANCELLED'],
  AWAITING_REVIEW: ['IN_PROGRESS', 'COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function isIncidentFinished(status: IncidentStatus): boolean {
  return status === 'CLOSED' || status === 'CANCELLED';
}

export function isInvestigationFinished(status: InvestigationStatus | string | null | undefined): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

/** Shortest route of ordinary transitions from `from` to `target` (excluding the start), or null. */
export function transitionPath<S extends string>(transitions: Record<S, readonly S[]>, from: S, target: S, avoid: readonly S[] = []): S[] | null {
  const seen = new Set<S>([from]);
  let frontier: S[][] = [[from]];
  while (frontier.length > 0) {
    const next: S[][] = [];
    for (const path of frontier) {
      for (const to of transitions[path[path.length - 1]]) {
        if (to === target) return [...path.slice(1), to];
        if (avoid.includes(to) || seen.has(to)) continue;
        seen.add(to);
        next.push([...path, to]);
      }
    }
    frontier = next;
  }
  return null;
}

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

// ── Incident register views ───────────────────────────────────────────────

export const INCIDENT_REGISTER_VIEWS = [
  'all', 'open', 'needs_triage', 'investigation_required', 'under_investigation', 'findings_open', 'ready', 'closed',
] as const;
export type IncidentRegisterView = (typeof INCIDENT_REGISTER_VIEWS)[number];

export const INCIDENT_REGISTER_VIEW_LABELS: Record<IncidentRegisterView, string> = {
  all: 'All',
  open: 'Open',
  needs_triage: 'Needs triage',
  investigation_required: 'Investigation required',
  under_investigation: 'Under investigation',
  findings_open: 'Findings open',
  ready: 'Ready for closure',
  closed: 'Closed',
};

/**
 * - needs_triage           status REPORTED or UNDER_REVIEW
 * - investigation_required status INVESTIGATION_REQUIRED
 * - under_investigation    status UNDER_INVESTIGATION
 * - findings_open          open incident with at least one open linked Finding
 * - ready                  AWAITING_VERIFICATION and the closure guard would
 *                          pass (no open Finding, no active Investigation)
 */
export function parseIncidentView(value: unknown): IncidentRegisterView {
  return typeof value === 'string' && (INCIDENT_REGISTER_VIEWS as readonly string[]).includes(value) ? value as IncidentRegisterView : 'all';
}

// ── Investigation register views ──────────────────────────────────────────

export const INVESTIGATION_REGISTER_VIEWS = [
  'all', 'active', 'planning', 'in_progress', 'awaiting_information', 'awaiting_review', 'findings_recorded', 'finished',
] as const;
export type InvestigationRegisterView = (typeof INVESTIGATION_REGISTER_VIEWS)[number];

export const INVESTIGATION_REGISTER_VIEW_LABELS: Record<InvestigationRegisterView, string> = {
  all: 'All',
  active: 'Active',
  planning: 'Open / planning',
  in_progress: 'In progress',
  awaiting_information: 'Awaiting information',
  awaiting_review: 'Ready for completion',
  findings_recorded: 'Findings recorded',
  finished: 'Completed / cancelled',
};

export function parseInvestigationView(value: unknown): InvestigationRegisterView {
  return typeof value === 'string' && (INVESTIGATION_REGISTER_VIEWS as readonly string[]).includes(value) ? value as InvestigationRegisterView : 'all';
}

// ── Incident triage facts ─────────────────────────────────────────────────

export type TriageFact = { key: string; label: string; done: boolean; detail: string };

/** Factual questions only. No score, no risk algorithm, no automatic decision. */
export function incidentTriageFacts(i: {
  status: IncidentStatus; risk_name: string | null; owner_name: string | null; immediate_response: string | null;
  investigation_count: number; finding_count: number;
}): TriageFact[] {
  const investigationDecided = i.status === 'INVESTIGATION_REQUIRED' || i.status === 'UNDER_INVESTIGATION' || i.investigation_count > 0;
  return [
    { key: 'risk', label: 'Risk level set', done: i.risk_name != null, detail: i.risk_name ?? 'Not set' },
    { key: 'owner', label: 'Owner assigned', done: i.owner_name != null, detail: i.owner_name ?? 'Unassigned' },
    { key: 'immediate', label: 'Immediate response recorded', done: i.immediate_response != null, detail: i.immediate_response ? 'Recorded' : 'None recorded' },
    {
      key: 'investigation', label: 'Investigation', done: investigationDecided,
      detail: i.investigation_count > 0 ? `${i.investigation_count} linked` : i.status === 'INVESTIGATION_REQUIRED' ? 'Marked required — not yet started' : 'No investigation linked',
    },
    { key: 'findings', label: 'Findings raised', done: i.finding_count > 0, detail: i.finding_count > 0 ? `${i.finding_count}` : 'None' },
  ];
}

// ── Closure readiness ─────────────────────────────────────────────────────

export type Readiness = { canFinishNow: boolean; blockers: string[]; notes: string[] };

/**
 * "What still prevents this incident from being closed?" — exactly the
 * existing closure guard (transition path, open Findings, active
 * Investigations), plus true-but-non-blocking notes.
 */
export function incidentClosureReadiness(input: {
  status: IncidentStatus;
  openVisibleFindings: { reference: string }[];
  openHiddenFindings: number;
  activeVisibleInvestigations: { reference: string }[];
  activeHiddenInvestigations: number;
  openActionCount: number;
  viewerCanClose: boolean;
}): Readiness {
  const blockers: string[] = [];
  const notes: string[] = [];
  if (isIncidentFinished(input.status)) {
    return { canFinishNow: false, blockers: [`This incident is already ${label(input.status)}.`], notes };
  }
  if (!INCIDENT_TRANSITIONS[input.status].includes('CLOSED')) {
    const path = transitionPath(INCIDENT_TRANSITIONS, input.status, 'CLOSED', ['CANCELLED']);
    const via = path ? path.slice(0, -1).map(label).join(', then ') : null;
    blockers.push(via
      ? `An incident that is ${label(input.status)} cannot move straight to closed — move it to ${via} first.`
      : `An incident that is ${label(input.status)} cannot be closed.`);
  }
  const f = input.openVisibleFindings;
  if (f.length > 0) blockers.push(`${f.length === 1 ? 'Linked finding' : `${f.length} linked findings`} still open: ${f.map(x => x.reference).join(', ')}.`);
  if (input.openHiddenFindings > 0) blockers.push('One or more linked findings you cannot see are still open.');
  const v = input.activeVisibleInvestigations;
  if (v.length > 0) blockers.push(`${v.length === 1 ? 'Investigation' : `${v.length} investigations`} not completed: ${v.map(x => x.reference).join(', ')}.`);
  if (input.activeHiddenInvestigations > 0) blockers.push('One or more linked investigations you cannot see are not completed.');
  if (input.openActionCount > 0) notes.push(`${input.openActionCount} corrective action${input.openActionCount === 1 ? ' is' : 's are'} still open on this incident's findings (each finding closes only after its actions).`);
  if (!input.viewerCanClose) notes.push('Only managers and admins can close or cancel an incident.');
  notes.push('Closing requires a closure summary. Closing never closes investigations, findings or actions.');
  return { canFinishNow: blockers.length === 0, blockers, notes };
}

/**
 * "What still prevents this investigation from being completed?" — the
 * existing rule is the transition path plus a recorded conclusion. Open
 * Findings do NOT block completion (they are closed on their own).
 */
export function investigationCompletionReadiness(input: {
  status: InvestigationStatus;
  openFindingCount: number;
  targetPassed: boolean;
  viewerCanClose: boolean;
}): Readiness {
  const blockers: string[] = [];
  const notes: string[] = [];
  if (isInvestigationFinished(input.status)) {
    return { canFinishNow: false, blockers: [`This investigation is already ${label(input.status)}.`], notes };
  }
  if (!INVESTIGATION_TRANSITIONS[input.status].includes('COMPLETED')) {
    const path = transitionPath(INVESTIGATION_TRANSITIONS, input.status, 'COMPLETED', ['CANCELLED']);
    const via = path ? path.slice(0, -1).map(label).join(', then ') : null;
    blockers.push(via
      ? `An investigation that is ${label(input.status)} cannot be completed directly — move it to ${via} first.`
      : `An investigation that is ${label(input.status)} cannot be completed.`);
  }
  notes.push('Completing requires a conclusion: the factual outcome, written by you.');
  if (input.openFindingCount > 0) notes.push(`${input.openFindingCount} finding${input.openFindingCount === 1 ? '' : 's'} raised here ${input.openFindingCount === 1 ? 'is' : 'are'} still open. That does not block completion — findings are closed on their own.`);
  if (input.targetPassed) notes.push('The target completion date has passed. It is a planning date only and does not block completion.');
  if (!input.viewerCanClose) notes.push('Only managers and admins can complete or cancel an investigation.');
  notes.push('Completing never closes incidents, findings or actions.');
  return { canFinishNow: blockers.length === 0, blockers, notes };
}
