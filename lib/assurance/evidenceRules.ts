// BrainBase Assurance — evidence verification rules (A0.1H). Pure and
// client-safe (no imports): the vocabulary mirrors the A0.1H CHECK
// constraints, and evidenceState() is the ONE place that decides which
// workflow is authoritative for a piece of evidence.
//
//   * Generic evidence: the lifecycle on assurance_evidence.
//   * Contractor evidence (referenced by a Contractor Assurance submission):
//     the submission's own decision is authoritative. The generic lifecycle
//     never applies to it, so its generic status is never shown.

export const EVIDENCE_VERIFICATION_STATUSES = ['UNVERIFIED', 'AWAITING_VERIFICATION', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'] as const;
export type EvidenceVerificationStatus = (typeof EVIDENCE_VERIFICATION_STATUSES)[number];

export const EVIDENCE_DECISIONS = ['ACCEPT', 'REJECT'] as const;
export type EvidenceDecision = (typeof EVIDENCE_DECISIONS)[number];

/** Register filters (and the state every row resolves to). */
export const EVIDENCE_STATES = ['AWAITING_VERIFICATION', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'UNVERIFIED', 'WITHDRAWN'] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

export type EvidenceAuthority = 'evidence' | 'contractor';

/** Contractor submission statuses (A0.1G). */
export type ContractorSubmissionStatus = 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' | 'WITHDRAWN' | 'SUPERSEDED';

const CONTRACTOR_STATE: Record<ContractorSubmissionStatus, EvidenceState> = {
  SUBMITTED: 'AWAITING_VERIFICATION',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
  SUPERSEDED: 'SUPERSEDED',
};

/**
 * The single state shown for a piece of evidence, and which workflow owns it.
 * Contractor submission evidence always takes the submission's status.
 */
export function evidenceState(input: {
  verificationStatus: EvidenceVerificationStatus;
  contractorStatus: ContractorSubmissionStatus | null;
}): { state: EvidenceState; authority: EvidenceAuthority } {
  if (input.contractorStatus) return { state: CONTRACTOR_STATE[input.contractorStatus], authority: 'contractor' };
  return { state: input.verificationStatus, authority: 'evidence' };
}

export const EVIDENCE_STATE_LABEL: Record<EvidenceState, string> = {
  AWAITING_VERIFICATION: 'Awaiting verification',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  SUPERSEDED: 'Superseded',
  UNVERIFIED: 'Unverified',
  WITHDRAWN: 'Withdrawn',
};

export const EVIDENCE_STATE_TONE: Record<EvidenceState, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  AWAITING_VERIFICATION: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  SUPERSEDED: 'neutral',
  UNVERIFIED: 'neutral',
  WITHDRAWN: 'neutral',
};

/** Content may be corrected only before a decision (D5). */
export function canCorrect(status: EvidenceVerificationStatus): boolean {
  return status === 'UNVERIFIED' || status === 'AWAITING_VERIFICATION';
}

/** Only a terminal decision can be replaced (refinement 1); the server also checks the chain head. */
export function isReplaceableStatus(status: EvidenceVerificationStatus): boolean {
  return status === 'ACCEPTED' || status === 'REJECTED';
}

/**
 * Who may NOT decide a piece of evidence (D2). The database proves the first
 * two; the service adds the Action roles for every actively linked Action.
 * Nothing is claimed about an external supplier, which has no individual
 * identity here.
 */
export function decisionConflicts(input: {
  viewerId: string;
  recordedBy: string | null;
  capturedBy: string | null;
  linkedActions: { ownerUserId: string | null; workCompletedBy: string | null; everCompletedBy: string[] }[];
}): string[] {
  const reasons: string[] = [];
  if (input.recordedBy === input.viewerId) reasons.push('You recorded this evidence.');
  if (input.capturedBy === input.viewerId) reasons.push('You captured this evidence.');
  for (const a of input.linkedActions) {
    if (a.ownerUserId === input.viewerId) { reasons.push('You own an action this evidence supports.'); break; }
  }
  for (const a of input.linkedActions) {
    if (a.workCompletedBy === input.viewerId || a.everCompletedBy.includes(input.viewerId)) {
      reasons.push('You completed the work this evidence supports.');
      break;
    }
  }
  return reasons;
}
