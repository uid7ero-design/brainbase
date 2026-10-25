import { validateAvailabilityException, validateAvailabilityExceptionSet, validateAvailabilityRuleForSet, validateAvailabilityRuleSet, type WindowEnd } from './availabilityRules';
import type { TenantContext } from './contracts';
import type { LocalDate } from './types';

// Phase 2B.3b: the persistence port for availability rules and exceptions. Pure types: no SQL, no clock. The existing
// SchedulingConfigRepository keeps its add/list methods for compatibility (they are unguarded by version); this port is what the
// configuration API uses, because it carries the version token (updatedAt) and the refusals the API must report.

export type AvailabilityOwner = { kind: 'resource' | 'offering'; id: string };

export type AvailabilityRuleKind = 'hours' | 'service_period';

/** A stored rule, with its version token. `endTime` may be '24:00' (end of day). */
export interface StoredAvailabilityRule {
  id: string;
  resourceId: string | null;
  offeringId: string | null;
  kind: AvailabilityRuleKind;
  label: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: WindowEnd;
  validFrom: LocalDate | null;
  validTo: LocalDate | null;
  createdAt: string;
  /** Microsecond-precision UTC instant. Pass it back as expectedUpdatedAt. */
  updatedAt: string;
}

export interface StoredAvailabilityException {
  id: string;
  resourceId: string | null;
  offeringId: string | null;
  fromDate: LocalDate;
  toDate: LocalDate;
  kind: 'closed' | 'override';
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewStoredRuleInput {
  kind: AvailabilityRuleKind;
  label: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: WindowEnd;
  validFrom: LocalDate | null;
  validTo: LocalDate | null;
}
/** Absent = unchanged. The owner of a rule never changes. */
export type StoredRulePatch = Partial<NewStoredRuleInput>;

export interface NewStoredExceptionInput {
  fromDate: LocalDate;
  toDate: LocalDate;
  kind: 'closed' | 'override';
  reason: string | null;
}
export type StoredExceptionPatch = Partial<NewStoredExceptionInput>;

export type AvailabilityWriteFailure =
  | 'not_found' // missing, or another organisation's row (indistinguishable on purpose)
  | 'stale_write' // the row changed since expectedUpdatedAt; NOTHING was written
  | 'overlap' // the rule or exception overlaps another of the same owner
  | 'owner_archived' // the offering (or its schedule) is archived
  | 'owner_inactive'; // the resource is inactive

export type AvailabilityWriteResult<T> = { ok: true; value: T } | { ok: false; reason: AvailabilityWriteFailure; detail?: string };

export interface SchedulingAvailabilityRepository {
  listRules(tenant: TenantContext, owner: AvailabilityOwner): Promise<StoredAvailabilityRule[]>;
  getRule(tenant: TenantContext, ruleId: string): Promise<StoredAvailabilityRule | null>;
  createRule(tenant: TenantContext, owner: AvailabilityOwner, input: NewStoredRuleInput): Promise<AvailabilityWriteResult<StoredAvailabilityRule>>;
  updateRule(tenant: TenantContext, ruleId: string, expectedUpdatedAt: string, changes: StoredRulePatch): Promise<AvailabilityWriteResult<StoredAvailabilityRule>>;
  deleteRule(tenant: TenantContext, ruleId: string, expectedUpdatedAt: string): Promise<AvailabilityWriteResult<{ id: string }>>;

  listExceptions(tenant: TenantContext, owner: AvailabilityOwner): Promise<StoredAvailabilityException[]>;
  getException(tenant: TenantContext, exceptionId: string): Promise<StoredAvailabilityException | null>;
  createException(tenant: TenantContext, owner: AvailabilityOwner, input: NewStoredExceptionInput): Promise<AvailabilityWriteResult<StoredAvailabilityException>>;
  updateException(tenant: TenantContext, exceptionId: string, expectedUpdatedAt: string, changes: StoredExceptionPatch): Promise<AvailabilityWriteResult<StoredAvailabilityException>>;
  deleteException(tenant: TenantContext, exceptionId: string, expectedUpdatedAt: string): Promise<AvailabilityWriteResult<{ id: string }>>;
}

/** The availability schema (migration 034) is not applied: the repository reports it rather than guess. Nothing was written. */
export class AvailabilityNotReadyError extends Error {
  readonly code = 'AVAILABILITY_NOT_READY' as const;
  constructor() {
    super('The availability schema is not installed');
    this.name = 'AvailabilityNotReadyError';
  }
}

// ── Advisory checks for a write, before it reaches the repository ────────────
//
// The database (migration 034) is the authority on overlap; these give the caller the plain-language answer first, from the same core
// validators the computation uses. They take no organisation: a rule is checked against ONE owner's rows, which the caller read for its own
// tenant, so the organisation field the validators carry is irrelevant here and is filled with a constant.


const SAME_TENANT = 'same-tenant';
const ownerIds = (owner: AvailabilityOwner) => ({ resourceId: owner.kind === 'resource' ? owner.id : null, offeringId: owner.kind === 'offering' ? owner.id : null });

export interface WriteCheck {
  /** Malformed fields: the request is invalid (400). */
  problems: string[];
  /** The write is well formed but overlaps another entry of the same owner (409). */
  overlaps: boolean;
}

export function checkRuleWrite(owner: AvailabilityOwner, existing: readonly StoredAvailabilityRule[], candidate: NewStoredRuleInput, replacesId?: string): WriteCheck {
  const asRule = (id: string, r: Pick<NewStoredRuleInput, 'dayOfWeek' | 'startTime' | 'endTime' | 'validFrom' | 'validTo'>) => ({
    id, organisationId: SAME_TENANT, ...ownerIds(owner), dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime as string, validFrom: r.validFrom, validTo: r.validTo,
  });
  const me = asRule(replacesId ?? 'candidate', candidate);
  const problems = validateAvailabilityRuleForSet(me);
  if (candidate.kind !== 'hours' && candidate.kind !== 'service_period') problems.push("kind must be 'hours' or 'service_period'");
  if (problems.length > 0) return { problems, overlaps: false };
  const others = existing.filter(r => r.id !== replacesId).map(r => asRule(r.id, r));
  return { problems: [], overlaps: validateAvailabilityRuleSet([...others, me]).some(p => /overlap/.test(p)) };
}

export function checkExceptionWrite(owner: AvailabilityOwner, existing: readonly StoredAvailabilityException[], candidate: NewStoredExceptionInput, replacesId?: string): WriteCheck {
  const asException = (id: string, e: NewStoredExceptionInput) => ({ id, organisationId: SAME_TENANT, ...ownerIds(owner), fromDate: e.fromDate, toDate: e.toDate, kind: e.kind, reason: e.reason });
  const me = asException(replacesId ?? 'candidate', candidate);
  const problems = validateAvailabilityException(me);
  if (problems.length > 0) return { problems, overlaps: false };
  const others = existing.filter(e => e.id !== replacesId).map(e => asException(e.id, e));
  return { problems: [], overlaps: validateAvailabilityExceptionSet([...others, me]).some(p => /common date/.test(p)) };
}
