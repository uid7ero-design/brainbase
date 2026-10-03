// BrainBase Assurance — Contractor assurance rules (A0.1G). ZERO imports:
// shared by the server service and client components.
//
// The lists mirror the A0.1G CHECK constraints exactly; the database is the
// authority. Status derivation is deterministic and factual — it is NOT a
// risk or compliance score.

export const REQUIREMENT_CATEGORIES = [
  'INSURANCE', 'LICENCE', 'REGISTRATION', 'CERTIFICATION', 'ACCREDITATION', 'COMPETENCY', 'POLICY_DOCUMENT', 'OTHER',
] as const;
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

export const REQUIREMENT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const SCOPE_STATUSES = ['IN_SCOPE', 'OUT_OF_SCOPE'] as const;
export type ScopeStatus = (typeof SCOPE_STATUSES)[number];

export const ASSIGNMENT_STATUSES = ['ACTIVE', 'CANCELLED'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const SUBMISSION_STATUSES = ['SUBMITTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SUBMISSION_DECISIONS = ['ACCEPT', 'REJECT'] as const;
export type SubmissionDecision = (typeof SUBMISSION_DECISIONS)[number];

export const REQUIREMENT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,39}$/;
export const RENEWAL_NOTICE_DAYS_MAX = 365;

/** Per-assignment state, derived from its current ACCEPTED evidence. */
export type AssignmentState = 'EXPIRED' | 'EXPIRING_SOON' | 'CURRENT' | 'MISSING';

/** Organisation headline, by fixed precedence over its active assignments. */
export type OrganisationHeadline = AssignmentState | 'AWAITING_REVIEW' | 'NO_REQUIREMENTS';

export const ASSIGNMENT_STATE_LABEL: Record<AssignmentState, string> = {
  EXPIRED: 'Expired',
  EXPIRING_SOON: 'Expiring soon',
  CURRENT: 'Current',
  MISSING: 'Missing',
};

export const HEADLINE_LABEL: Record<OrganisationHeadline, string> = {
  EXPIRED: 'Expired evidence',
  MISSING: 'Missing evidence',
  AWAITING_REVIEW: 'Evidence awaiting review',
  EXPIRING_SOON: 'Evidence expiring soon',
  CURRENT: 'All requirements current',
  NO_REQUIREMENTS: 'No requirements assigned',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Adds whole days to a YYYY-MM-DD date (calendar arithmetic, no time zone). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's calendar date in an IANA time zone (the Assurance date convention). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Assignment state (documented rule):
 *   MISSING        no current ACCEPTED evidence
 *   EXPIRED        current evidence has expires_on < today
 *   EXPIRING_SOON  the requirement has renewal_notice_days N (admin set) and
 *                  today ≤ expires_on ≤ today + N
 *   CURRENT        otherwise (accepted, not expired, not inside the window)
 * Evidence without an expiry date can only be CURRENT once accepted.
 */
export function assignmentState(input: {
  hasAccepted: boolean;
  acceptedExpiresOn: string | null;
  renewalNoticeDays: number | null;
  today: string;
}): AssignmentState {
  if (!input.hasAccepted) return 'MISSING';
  const exp = input.acceptedExpiresOn;
  if (!exp) return 'CURRENT';
  if (exp < input.today) return 'EXPIRED';
  if (input.renewalNoticeDays !== null && input.renewalNoticeDays > 0 && exp <= addDays(input.today, input.renewalNoticeDays)) {
    return 'EXPIRING_SOON';
  }
  return 'CURRENT';
}

/**
 * Organisation headline (documented rule), over ACTIVE assignments only:
 *   no assignments → NO_REQUIREMENTS
 *   else the first that applies: EXPIRED > MISSING > AWAITING_REVIEW >
 *   EXPIRING_SOON > CURRENT
 * The register also shows the count behind every state, so the headline
 * never hides a fact.
 */
export function organisationHeadline(states: readonly AssignmentState[], awaitingReview: number): OrganisationHeadline {
  if (states.length === 0) return 'NO_REQUIREMENTS';
  if (states.includes('EXPIRED')) return 'EXPIRED';
  if (states.includes('MISSING')) return 'MISSING';
  if (awaitingReview > 0) return 'AWAITING_REVIEW';
  if (states.includes('EXPIRING_SOON')) return 'EXPIRING_SOON';
  return 'CURRENT';
}

export const HEADLINE_TONE: Record<OrganisationHeadline, 'danger' | 'warning' | 'info' | 'success' | 'neutral'> = {
  EXPIRED: 'danger',
  MISSING: 'warning',
  AWAITING_REVIEW: 'info',
  EXPIRING_SOON: 'warning',
  CURRENT: 'success',
  NO_REQUIREMENTS: 'neutral',
};
