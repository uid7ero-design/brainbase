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
  /** A partial-day closure removes only [startTime, endTime) on its dates (migration 035); both null = the whole day. */
  startTime: string | null;
  endTime: WindowEnd | null;
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
  /** Both given = a partial-day closure; both absent or null = a full-day closure. Needs migration 035. */
  startTime?: string | null;
  endTime?: string | null;
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
  /**
   * Several rules of ONE owner in ONE statement: all are stored or none is (an overnight window is two rules; "the same hours on five
   * weekdays" is five). The owner's overlap guard sees the rows an earlier tuple of the same statement inserted, so a batch that overlaps
   * itself is refused whole. At most MAX_RULE_BATCH rules.
   */
  createRules(tenant: TenantContext, owner: AvailabilityOwner, inputs: readonly NewStoredRuleInput[]): Promise<AvailabilityWriteResult<StoredAvailabilityRule[]>>;
  updateRule(tenant: TenantContext, ruleId: string, expectedUpdatedAt: string, changes: StoredRulePatch): Promise<AvailabilityWriteResult<StoredAvailabilityRule>>;
  deleteRule(tenant: TenantContext, ruleId: string, expectedUpdatedAt: string): Promise<AvailabilityWriteResult<{ id: string }>>;

  listExceptions(tenant: TenantContext, owner: AvailabilityOwner): Promise<StoredAvailabilityException[]>;
  getException(tenant: TenantContext, exceptionId: string): Promise<StoredAvailabilityException | null>;
  createException(tenant: TenantContext, owner: AvailabilityOwner, input: NewStoredExceptionInput): Promise<AvailabilityWriteResult<StoredAvailabilityException>>;
  updateException(tenant: TenantContext, exceptionId: string, expectedUpdatedAt: string, changes: StoredExceptionPatch): Promise<AvailabilityWriteResult<StoredAvailabilityException>>;
  deleteException(tenant: TenantContext, exceptionId: string, expectedUpdatedAt: string): Promise<AvailabilityWriteResult<{ id: string }>>;

  /** Which optional parts of the availability schema are installed (read-only). Partial-day closures need migration 035. */
  capabilities(tenant: TenantContext): Promise<AvailabilityCapabilities>;
}

export interface AvailabilityCapabilities {
  partialClosures: boolean;
}

/** The most rules one request may create: seven weekdays, each possibly an overnight pair. */
export const MAX_RULE_BATCH = 14;

/** The availability schema (migration 034) is not applied: the repository reports it rather than guess. Nothing was written. */
export class AvailabilityNotReadyError extends Error {
  readonly code = 'AVAILABILITY_NOT_READY' as const;
  constructor() {
    super('The availability schema is not installed');
    this.name = 'AvailabilityNotReadyError';
  }
}

/** A partial-day closure was asked for but migration 035 is not applied. Nothing was written; full-day closures and rules still work. */
export class PartialClosuresNotReadyError extends Error {
  readonly code = 'PARTIAL_CLOSURES_NOT_READY' as const;
  constructor() {
    super('Partial-day closures are not installed');
    this.name = 'PartialClosuresNotReadyError';
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

/**
 * Several rules of one owner written together (see SchedulingAvailabilityRepository.createRules): every rule must be valid on its own,
 * and none may overlap an existing rule or another rule of the batch. `overlaps` is true when any pair does.
 */
export function checkRuleBatch(owner: AvailabilityOwner, existing: readonly StoredAvailabilityRule[], candidates: readonly NewStoredRuleInput[]): WriteCheck {
  const asRule = (id: string, r: Pick<NewStoredRuleInput, 'dayOfWeek' | 'startTime' | 'endTime' | 'validFrom' | 'validTo'>) => ({
    id, organisationId: SAME_TENANT, ...ownerIds(owner), dayOfWeek: r.dayOfWeek, startTime: r.startTime, endTime: r.endTime as string, validFrom: r.validFrom, validTo: r.validTo,
  });
  const problems: string[] = [];
  if (candidates.length === 0) problems.push('at least one rule is required');
  if (candidates.length > MAX_RULE_BATCH) problems.push(`at most ${MAX_RULE_BATCH} rules can be created together`);
  candidates.forEach((c, i) => {
    problems.push(...validateAvailabilityRuleForSet(asRule(`candidate-${i + 1}`, c)).map(p => (candidates.length > 1 ? `rule ${i + 1}: ${p}` : p)));
    if (c.kind !== 'hours' && c.kind !== 'service_period') problems.push("kind must be 'hours' or 'service_period'");
  });
  if (problems.length > 0) return { problems, overlaps: false };
  const all = [...existing.map(r => asRule(r.id, r)), ...candidates.map((c, i) => asRule(`candidate-${i + 1}`, c))];
  return { problems: [], overlaps: validateAvailabilityRuleSet(all).some(p => /overlap/.test(p)) };
}

export function checkExceptionWrite(owner: AvailabilityOwner, existing: readonly StoredAvailabilityException[], candidate: NewStoredExceptionInput, replacesId?: string): WriteCheck {
  const asException = (id: string, e: NewStoredExceptionInput | StoredAvailabilityException) => ({
    id, organisationId: SAME_TENANT, ...ownerIds(owner), fromDate: e.fromDate, toDate: e.toDate, kind: e.kind, reason: e.reason,
    windows: e.startTime != null && e.endTime != null ? [{ startTime: e.startTime, endTime: e.endTime }] : [],
  });
  const me = asException(replacesId ?? 'candidate', candidate);
  const problems = validateAvailabilityException(me as never);
  if ((candidate.startTime == null) !== (candidate.endTime == null)) problems.push('startTime and endTime must be given together (a partial-day closure), or both left out (a full-day closure)');
  if (problems.length > 0) return { problems, overlaps: false };
  const others = existing.filter(e => e.id !== replacesId).map(e => asException(e.id, e));
  return { problems: [], overlaps: validateAvailabilityExceptionSet([...others, me]).some(p => /common date/.test(p)) };
}
