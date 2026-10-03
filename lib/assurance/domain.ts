// BrainBase Assurance — client-safe domain vocabulary.
//
// ZERO imports by design: this module is imported by both server code
// (lib/assurance/*) and client components (app/assurance/**). It must
// never import lib/db.ts or anything server-only — a client component
// importing a runtime value from a server-only module ships lib/db.ts
// to the browser (see the Commercial *Lifecycle.ts precedent).
//
// Every status/type list below mirrors the frozen A0.1C/A0.1D CHECK
// constraints exactly. The database remains the authority; these lists
// exist for labels, filters and input validation only.

export const INCIDENT_STATUSES = [
  'REPORTED', 'UNDER_REVIEW', 'INVESTIGATION_REQUIRED', 'UNDER_INVESTIGATION',
  'ACTION_REQUIRED', 'AWAITING_VERIFICATION', 'CLOSED', 'CANCELLED',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_CATEGORIES = [
  'INJURY_SAFETY', 'ENVIRONMENTAL', 'PROPERTY_EQUIPMENT', 'OPERATIONAL_SERVICE',
  'SECURITY', 'NEAR_MISS', 'OTHER',
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const INCIDENT_PERSON_ROLES = [
  'AFFECTED_PERSON', 'INJURED_PERSON', 'INVOLVED_PERSON', 'WITNESS', 'REPORTER',
  'RESPONDER', 'SUPERVISOR', 'CONTACT', 'OTHER',
] as const;

export const INVESTIGATION_STATUSES = [
  'OPEN', 'PLANNING', 'IN_PROGRESS', 'AWAITING_INFORMATION', 'AWAITING_REVIEW',
  'COMPLETED', 'CANCELLED',
] as const;
export type InvestigationStatus = (typeof INVESTIGATION_STATUSES)[number];

export const INVESTIGATION_INCIDENT_RELATIONSHIPS = ['PRIMARY', 'RELATED', 'TRIGGERING', 'CONTEXT'] as const;
export type InvestigationIncidentRelationship = (typeof INVESTIGATION_INCIDENT_RELATIONSHIPS)[number];

export const INVESTIGATION_PERSON_ROLES = [
  'INVESTIGATOR', 'LEAD_INVESTIGATOR', 'WITNESS', 'SUBJECT', 'TECHNICAL_ADVISER',
  'REVIEWER', 'CONTACT', 'OTHER',
] as const;

export const INSPECTION_TYPES = [
  'SITE', 'VEHICLE', 'CONTRACTOR_SERVICE', 'SAFETY', 'ENVIRONMENTAL', 'FACILITY',
  'OPERATIONAL_COMPLIANCE', 'OTHER',
] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];

export const INSPECTION_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const INSPECTION_RESPONSE_TYPES = [
  'BOOLEAN', 'PASS_FAIL', 'TEXT', 'NUMBER', 'DATE', 'CHOICE', 'MULTI_CHOICE', 'OTHER',
] as const;
export type InspectionResponseType = (typeof INSPECTION_RESPONSE_TYPES)[number];

export const INSPECTION_OUTCOMES = ['PASS', 'FAIL', 'NOT_APPLICABLE', 'OBSERVATION'] as const;
export type InspectionOutcome = (typeof INSPECTION_OUTCOMES)[number];

export const FINDING_TYPES = [
  'OBSERVATION', 'HAZARD', 'DEFECT', 'NON_CONFORMANCE', 'AUDIT_FINDING',
  'SERVICE_FAILURE', 'IMPROVEMENT_OPPORTUNITY', 'OTHER',
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

export const FINDING_STATUSES = [
  'OPEN', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'ACTION_IN_PROGRESS',
  'AWAITING_VERIFICATION', 'CLOSED', 'CANCELLED',
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const ACTION_TYPES = [
  'IMMEDIATE_CONTROL', 'CORRECTIVE', 'PREVENTATIVE', 'REMEDIAL', 'IMPROVEMENT',
  'FOLLOW_UP', 'MONITORING', 'OTHER',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_STATUSES = [
  'OPEN', 'IN_PROGRESS', 'AWAITING_EVIDENCE', 'AWAITING_VERIFICATION', 'CLOSED', 'CANCELLED',
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

// assurance_actions.priority is free text at the DB level (non-blank
// only). The UI offers this fixed vocabulary; the service accepts only
// these values so the register stays filterable.
export const ACTION_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type ActionPriority = (typeof ACTION_PRIORITIES)[number];

export const EVIDENCE_TYPES = [
  'PHOTO', 'VIDEO', 'DOCUMENT', 'EMAIL', 'STATEMENT', 'MEASUREMENT', 'SYSTEM_RECORD', 'OTHER',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const VERIFICATION_RESULTS = [
  'ACCEPTED', 'REJECTED', 'PARTIALLY_ACCEPTED', 'MORE_EVIDENCE_REQUIRED', 'NOT_APPLICABLE',
] as const;
export type VerificationResult = (typeof VERIFICATION_RESULTS)[number];

// ── Audits (A0.1E-1) ──────────────────────────────────────────────────────

export const AUDIT_TYPES = [
  'INTERNAL', 'CONTRACTOR', 'SITE', 'PROCESS', 'FACILITY', 'POLICY', 'COMPLIANCE', 'OTHER',
] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

export const AUDIT_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const AUDIT_RESPONSE_TYPES = ['COMPLIANCE_RATING', 'BOOLEAN', 'TEXT', 'NUMBER', 'CHOICE', 'OTHER'] as const;
export type AuditResponseType = (typeof AUDIT_RESPONSE_TYPES)[number];

export const AUDIT_OUTCOMES = ['COMPLIANT', 'PARTIAL', 'NON_COMPLIANT', 'NOT_APPLICABLE', 'OBSERVATION'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** Outcomes for which the UI OFFERS (never auto-creates) a Finding. */
export const AUDIT_FINDING_OUTCOMES: readonly AuditOutcome[] = ['NON_COMPLIANT', 'PARTIAL', 'OBSERVATION'];

export type AuditCriterion = {
  key: string;
  label: string;
  responseType: AuditResponseType;
  guidance: string | null;
  required: boolean;
  options: string[];
  /** Optional section heading; items of one section are contiguous (A0.1F templates). */
  section: string | null;
};

export type ParsedCriteria = { items: AuditCriterion[]; invalidCount: number };

/** Tolerant reader for assurance_audit_template_versions.criteria (same rules as parseChecklist). */
export function parseCriteria(raw: unknown): ParsedCriteria {
  const items: AuditCriterion[] = [];
  let invalidCount = 0;
  if (!Array.isArray(raw)) return { items, invalidCount: 0 };
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { invalidCount++; continue; }
    const e = entry as Record<string, unknown>;
    const key = typeof e.key === 'string' ? e.key.trim() : '';
    const label = typeof e.label === 'string' ? e.label.trim() : '';
    if (!key || !label || seen.has(key)) { invalidCount++; continue; }
    seen.add(key);
    items.push({
      key,
      label,
      responseType: isOneOf(AUDIT_RESPONSE_TYPES, e.responseType) ? e.responseType : 'COMPLIANCE_RATING',
      guidance: typeof e.guidance === 'string' && e.guidance.trim() ? e.guidance.trim() : null,
      required: e.required !== false,
      options: Array.isArray(e.options) ? e.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '') : [],
      section: readSection(e.section),
    });
  }
  return { items, invalidCount };
}

// The explicit, workflow-specific evidence link tables. Evidence is never
// linked through a generic entity_type/entity_id pair — each target has
// its own table with composite tenant FKs.
export const EVIDENCE_LINK_TARGETS = [
  'incident', 'investigation', 'inspection', 'audit', 'finding', 'action', 'verification',
] as const;
export type EvidenceLinkTarget = (typeof EVIDENCE_LINK_TARGETS)[number];

// ── Labels ────────────────────────────────────────────────────────────────

const SPECIAL_LABELS: Record<string, string> = {
  INJURY_SAFETY: 'Injury / safety',
  PROPERTY_EQUIPMENT: 'Property / equipment',
  OPERATIONAL_SERVICE: 'Operational / service',
  NEAR_MISS: 'Near miss',
  NON_CONFORMANCE: 'Non-conformance',
  NOT_APPLICABLE: 'N/A',
  PASS_FAIL: 'Pass / fail',
  MULTI_CHOICE: 'Multiple choice',
  CONTRACTOR_SERVICE: 'Contractor service',
  OPERATIONAL_COMPLIANCE: 'Operational compliance',
  SYSTEM_RECORD: 'System record',
  IMMEDIATE_CONTROL: 'Immediate control',
  TECHNICAL_ADVISER: 'Technical adviser',
  LEAD_INVESTIGATOR: 'Lead investigator',
  COMPLIANT: 'Compliant',
  PARTIAL: 'Partially compliant',
  NON_COMPLIANT: 'Non-compliant',
  COMPLIANCE_RATING: 'Compliance rating',
};

/** Human label for any UPPER_SNAKE vocabulary value. Pure; never throws. */
export function assuranceLabel(value: string | null | undefined): string {
  if (!value) return '—';
  if (SPECIAL_LABELS[value]) return SPECIAL_LABELS[value];
  const words = value.toLowerCase().split('_').filter(Boolean);
  if (words.length === 0) return value;
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(' ');
}

// ── Tone (badge colour intent) ───────────────────────────────────────────

export type AssuranceTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success' | 'accent';

const TONE_BY_VALUE: Record<string, AssuranceTone> = {
  // generic open/progress
  OPEN: 'info', REPORTED: 'info', PLANNED: 'info', PLANNING: 'info',
  UNDER_REVIEW: 'accent', IN_PROGRESS: 'accent', UNDER_INVESTIGATION: 'accent',
  ACTION_IN_PROGRESS: 'accent',
  // needs someone to do something
  INVESTIGATION_REQUIRED: 'warning', ACTION_REQUIRED: 'warning', AWAITING_EVIDENCE: 'warning',
  AWAITING_INFORMATION: 'warning', AWAITING_REVIEW: 'warning', AWAITING_VERIFICATION: 'warning',
  // terminal
  CLOSED: 'success', COMPLETED: 'success', CANCELLED: 'neutral',
  // outcomes / results
  PASS: 'success', FAIL: 'danger', OBSERVATION: 'warning', NOT_APPLICABLE: 'neutral',
  COMPLIANT: 'success', PARTIAL: 'warning', NON_COMPLIANT: 'danger',
  ACCEPTED: 'success', REJECTED: 'danger', PARTIALLY_ACCEPTED: 'warning',
  MORE_EVIDENCE_REQUIRED: 'warning',
  // template lifecycle
  DRAFT: 'warning', PUBLISHED: 'success', RETIRED: 'neutral',
  // priority
  LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', CRITICAL: 'danger',
};

export function assuranceTone(value: string | null | undefined): AssuranceTone {
  if (!value) return 'neutral';
  return TONE_BY_VALUE[value] ?? 'neutral';
}

// ── Terminal-state helpers (display only; the DB/service enforce rules) ──

export const OPEN_INCIDENT_STATUSES: readonly IncidentStatus[] =
  INCIDENT_STATUSES.filter(s => s !== 'CLOSED' && s !== 'CANCELLED');
export const OPEN_FINDING_STATUSES: readonly FindingStatus[] =
  FINDING_STATUSES.filter(s => s !== 'CLOSED' && s !== 'CANCELLED');
export const OPEN_ACTION_STATUSES: readonly ActionStatus[] =
  ACTION_STATUSES.filter(s => s !== 'CLOSED' && s !== 'CANCELLED');
export const ACTIVE_INVESTIGATION_STATUSES: readonly InvestigationStatus[] =
  INVESTIGATION_STATUSES.filter(s => s !== 'COMPLETED' && s !== 'CANCELLED');

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

// ── Checklist items (template versions) ──────────────────────────────────
//
// assurance_inspection_template_versions.checklist is only constrained to
// be a JSON array at the DB level. This is the governed item shape the UI
// writes and reads. Parsing is tolerant: an item that cannot be read is
// surfaced as `invalid` rather than silently dropped, so a historical
// version is always displayed faithfully even if it predates this shape.

export type ChecklistItem = {
  key: string;
  label: string;
  responseType: InspectionResponseType;
  guidance: string | null;
  required: boolean;
  options: string[];
  /** Optional section heading; items of one section are contiguous (A0.1F templates). */
  section: string | null;
};

export type ParsedChecklist = { items: ChecklistItem[]; invalidCount: number };

export function parseChecklist(raw: unknown): ParsedChecklist {
  const items: ChecklistItem[] = [];
  let invalidCount = 0;
  if (!Array.isArray(raw)) return { items, invalidCount: 0 };
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { invalidCount++; continue; }
    const e = entry as Record<string, unknown>;
    const key = typeof e.key === 'string' ? e.key.trim() : '';
    const label = typeof e.label === 'string' ? e.label.trim() : '';
    if (!key || !label || seen.has(key)) { invalidCount++; continue; }
    seen.add(key);
    const responseType = isOneOf(INSPECTION_RESPONSE_TYPES, e.responseType) ? e.responseType : 'PASS_FAIL';
    items.push({
      key,
      label,
      responseType,
      guidance: typeof e.guidance === 'string' && e.guidance.trim() ? e.guidance.trim() : null,
      required: e.required !== false,
      options: Array.isArray(e.options) ? e.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '') : [],
      section: readSection(e.section),
    });
  }
  return { items, invalidCount };
}

function readSection(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Groups template items into their ordered sections. Items are stored as one
 * ordered list; a section is a run of consecutive items sharing a heading
 * (null = no heading). Rendering a historical version through this keeps its
 * exact order and wording.
 */
export function groupTemplateSections<T extends { section: string | null }>(items: readonly T[]): { title: string | null; items: T[] }[] {
  const groups: { title: string | null; items: T[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.title === item.section) last.items.push(item);
    else groups.push({ title: item.section, items: [item] });
  }
  return groups;
}

// ── Templates (A0.1F lifecycle) ──────────────────────────────────────────

export const TEMPLATE_KINDS = ['inspection', 'audit'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** Mirrors the A0.1F version status CHECK. A template's status is derived from its versions. */
export const TEMPLATE_VERSION_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export type TemplateVersionStatus = (typeof TEMPLATE_VERSION_STATUSES)[number];

/** Builds a stable item key from a label: lowercase, a-z0-9 and dashes. */
export function checklistKeyFromLabel(label: string, index: number): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${String(index + 1).padStart(2, '0')}-${slug || 'item'}`;
}

// ── Dates ────────────────────────────────────────────────────────────────

// `timeZone` (an IANA zone such as the organisation's) renders the instant
// in that zone regardless of where the code runs (the Vercel server is
// UTC). Omitted, the runtime's zone is used — the long-standing behaviour.
export function formatAssuranceDate(value: string | Date | null | undefined, timeZone?: string): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', ...(timeZone ? { timeZone } : {}) });
}

export function formatAssuranceDateTime(value: string | Date | null | undefined, timeZone?: string): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
}

export function isPast(value: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!value) return false;
  const d = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(d.getTime()) && d.getTime() < now.getTime();
}
