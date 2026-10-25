import {
  AvailabilityNotReadyError,
  AvailabilityZonesNotReadyError,
  END_OF_DAY,
  PartialClosuresNotReadyError,
  checkExceptionWrite,
  checkRuleBatch,
  checkRuleWrite,
  isIanaTimezone,
  isLocalDate,
  isLocalTime,
  splitOvernightRule,
  validateExpectedUpdatedAt,
  type AvailabilityOwner,
  type AvailabilityWriteFailure,
  type AvailabilityWriteResult,
  type IanaTimezone,
  type StoredAvailabilityZone,
  type NewStoredExceptionInput,
  type NewStoredRuleInput,
  type OvernightHalfRef,
  type StoredAvailabilityException,
  type StoredAvailabilityRule,
} from '@scheduling/core';
import { schedulingJson, type SchedulingRouteContext } from '../route';
import { audit, badRequest, changedFields, conflict, guarded, idParam, notFound, readBody, splitExpectedUpdatedAt, unknownFields } from './http';

// Phase 2B.3b — the availability configuration API: weekly rules and closures of an offering or a resource. Runs INSIDE the central
// guard (lib/scheduling/route.ts), so the caller is authenticated, entitled, permitted and the organisation is the session's.
//
// Two layers decide a write, on purpose:
//   1. the CORE validators (validateAvailabilityRuleSet / ExceptionSet) answer first, with plain-language reasons: a malformed field is
//      400 INVALID_INPUT and an overlap with the owner's existing rules is 409 OVERLAP. This is advisory: it reads a snapshot.
//   2. the DATABASE (migration 034's triggers) is authoritative: it takes the owner's lock and re-checks, so two concurrent writers
//      cannot both pass. Its refusal is the same 409 OVERLAP. Until 034 is applied every call here is 503 AVAILABILITY_NOT_READY.
//
// Additional error codes beyond lib/scheduling/config/http.ts:
//   409 OVERLAP             the rule or closure overlaps another of the same owner
//   409 RESOURCE_INACTIVE   the resource is inactive: it takes no new or changed availability (deleting is always allowed)
//   409 ARCHIVED            the offering (or its schedule) is archived: same
//   503 AVAILABILITY_NOT_READY   the availability schema is not installed
//   503 PARTIAL_CLOSURES_NOT_READY   a partial-day closure was asked for and migration 035 is not applied (nothing was written)
//
// Phase 2B.3c additions. ATOMIC CREATES: one POST may create several rules, and they are stored in ONE statement, all or none:
//   - `daysOfWeek: [1,2,3,4,5]` instead of `dayOfWeek`: the same window on several weekdays;
//   - `overnight: true`: the window runs past midnight (endTime before startTime, e.g. 22:00 to 02:00). It is stored as the two single-day
//     rules splitOvernightRule produces (22:00-24:00 on the day, 00:00-02:00 on the next), and the two are written together, so a
//     half of the window can never be committed on its own. Without the flag a window that crosses midnight is still refused.
// PARTIAL-DAY CLOSURES: a closure may carry startTime and endTime (both, or neither = the whole day).
//
// Not accepted yet: kind 'override' (the table has no column for override hours).

const RULE_FIELDS = ['dayOfWeek', 'startTime', 'endTime', 'validFrom', 'validTo', 'kind', 'label'] as const;
const CREATE_RULE_FIELDS = [...RULE_FIELDS, 'daysOfWeek', 'overnight'] as const;
const EXCEPTION_FIELDS = ['fromDate', 'toDate', 'kind', 'reason', 'startTime', 'endTime'] as const;
const MAX_LABEL = 80;
const MAX_REASON = 200;
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

type OwnerKind = 'offering' | 'resource';
const ownerParam = (kind: OwnerKind) => (kind === 'offering' ? 'offeringId' : 'resourceId');

async function guardedAvailability<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  try {
    return await guarded(run);
  } catch (err) {
    if (err instanceof AvailabilityNotReadyError) {
      return { ok: false, response: schedulingJson({ error: 'Availability is not available yet for this installation.', code: 'AVAILABILITY_NOT_READY' }, { status: 503 }) };
    }
    if (err instanceof AvailabilityZonesNotReadyError) {
      return { ok: false, response: schedulingJson({ error: 'Saving hours is not available yet for this installation (owner-pinned timezones are not set up). Nothing was saved.', code: 'AVAILABILITY_ZONES_NOT_READY' }, { status: 503 }) };
    }
    if (err instanceof PartialClosuresNotReadyError) {
      return { ok: false, response: schedulingJson({ error: 'Partial-day closures are not available yet for this installation. Full-day closures and weekly hours are.', code: 'PARTIAL_CLOSURES_NOT_READY' }, { status: 503 }) };
    }
    throw err;
  }
}

function failure(reason: AvailabilityWriteFailure): Response {
  switch (reason) {
    case 'not_found':
      return notFound();
    case 'stale_write':
      return conflict('STALE_WRITE', 'This record was changed by someone else since you loaded it. Reload it and try again.');
    case 'overlap':
      return conflict('OVERLAP', 'This overlaps other availability of the same offering or resource. Change or remove the overlapping entry first.');
    case 'owner_archived':
      return conflict('ARCHIVED', 'This offering is archived and takes no availability.');
    case 'owner_inactive':
      return conflict('RESOURCE_INACTIVE', 'This resource is inactive and takes no new availability. Reactivate it first.');
    case 'not_overnight_window':
      return conflict('NOT_OVERNIGHT_WINDOW', 'These two entries are no longer the two halves of one overnight window, so nothing was removed. Reload to see the current hours.');
  }
}

async function ownerExists(context: SchedulingRouteContext, owner: AvailabilityOwner): Promise<boolean> {
  if (owner.kind === 'offering') return (await context.persistence.config.getOffering(context.tenant, owner.id)) !== null;
  return (await context.persistence.config.listResources(context.tenant)).some(r => r.id === owner.id);
}

const ownerOf = (r: { resourceId: string | null; offeringId: string | null }): AvailabilityOwner =>
  r.resourceId !== null ? { kind: 'resource', id: r.resourceId } : { kind: 'offering', id: r.offeringId as string };

/**
 * The zone to PIN if this owner has none yet, resolved from the chain the readers used before pinning: an offering's schedule timezone,
 * else the tenant's (the organisation's, or the platform fallback). A resource has no schedule. It is only a default for the first write:
 * an owner that is already pinned keeps its pin whatever this returns, and nothing here reads the browser's timezone.
 */
async function defaultZone(context: SchedulingRouteContext, owner: AvailabilityOwner): Promise<IanaTimezone> {
  if (owner.kind === 'offering') {
    const offering = await context.persistence.config.getOffering(context.tenant, owner.id);
    const schedule = offering ? await context.persistence.config.getSchedule(context.tenant, offering.scheduleId) : null;
    if (schedule?.timezone && isIanaTimezone(schedule.timezone)) return schedule.timezone;
  }
  return context.tenant.timezone;
}

/** What the screens are told about an owner's zone: the pin if there is one, else what the first write WOULD pin (nothing is pinned by a read). */
async function zoneView(context: SchedulingRouteContext, owner: AvailabilityOwner) {
  const pinned = await context.availability.getZone(context.tenant, owner);
  if (pinned) return { timezone: pinned.timezone, pinned: true, source: pinned.source, pinnedAt: pinned.pinnedAt };
  return { timezone: await defaultZone(context, owner), pinned: false, source: null, pinnedAt: null };
}

async function auditPin(context: SchedulingRouteContext, owner: AvailabilityOwner, pin: StoredAvailabilityZone | null | undefined): Promise<void> {
  if (!pin) return;
  await audit(context, 'scheduling.availability_zone.pinned', 'availability_zone', owner.id, { owner_kind: owner.kind, owner_id: owner.id, timezone: pin.timezone, source: pin.source });
}

function optionalText(body: Record<string, unknown>, key: string, max: number, problems: string[]): string | null | undefined {
  if (!has(body, key)) return undefined;
  const v = body[key];
  if (v === null) return null;
  if (typeof v !== 'string') {
    problems.push(`${key} must be text or null`);
    return undefined;
  }
  const t = v.trim();
  if (t.length > max) problems.push(`${key} must be at most ${max} characters`);
  return t === '' ? null : t;
}

function optionalDate(body: Record<string, unknown>, key: string, problems: string[]): string | null | undefined {
  if (!has(body, key)) return undefined;
  const v = body[key];
  if (v === null) return null;
  if (!isLocalDate(v)) {
    problems.push(`${key} must be a valid date (YYYY-MM-DD) or null`);
    return undefined;
  }
  return v;
}

// ── reads ───────────────────────────────────────────────────────────────────

export const listAvailabilityFor = (kind: OwnerKind) =>
  async function listAvailability(context: SchedulingRouteContext): Promise<Response> {
    const id = idParam(context, ownerParam(kind));
    if (!id) return notFound();
    const owner: AvailabilityOwner = { kind, id };
    if (!(await ownerExists(context, owner))) return notFound();
    const read = await guardedAvailability(async () => ({
      rules: await context.availability.listRules(context.tenant, owner),
      exceptions: await context.availability.listExceptions(context.tenant, owner),
      capabilities: await context.availability.capabilities(context.tenant),
      zone: await zoneView(context, owner),
    }));
    if (!read.ok) return read.response;
    return schedulingJson({ owner, ...read.value });
  };

// ── rules ───────────────────────────────────────────────────────────────────

export const createRuleFor = (kind: OwnerKind) =>
  async function createRule(context: SchedulingRouteContext): Promise<Response> {
    const id = idParam(context, ownerParam(kind));
    if (!id) return notFound();
    const owner: AvailabilityOwner = { kind, id };
    const parsed = await readBody(context.request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const problems = unknownFields(body, CREATE_RULE_FIELDS);
    for (const required of ['startTime', 'endTime']) if (!has(body, required)) problems.push(`${required} is required`);
    if (!has(body, 'dayOfWeek') && !has(body, 'daysOfWeek')) problems.push('dayOfWeek is required (or daysOfWeek, for the same hours on several days)');
    else if (has(body, 'dayOfWeek') && has(body, 'daysOfWeek')) problems.push('give either dayOfWeek or daysOfWeek, not both');
    const days = daysFrom(body, problems);
    const label = optionalText(body, 'label', MAX_LABEL, problems);
    const validFrom = optionalDate(body, 'validFrom', problems);
    const validTo = optionalDate(body, 'validTo', problems);
    const ruleKind = has(body, 'kind') ? body.kind : 'hours';
    if (ruleKind !== 'hours' && ruleKind !== 'service_period') problems.push("kind must be 'hours' or 'service_period'");
    const overnight = has(body, 'overnight') ? body.overnight : false;
    if (typeof overnight !== 'boolean') problems.push('overnight must be true or false');
    if (problems.length > 0) return badRequest(problems);

    const window = { startTime: body.startTime as string, endTime: body.endTime as string, validFrom: validFrom ?? null, validTo: validTo ?? null };
    let inputs: NewStoredRuleInput[];
    if (overnight === true) {
      // Only a window that really runs past midnight: it ends before it starts, and not at 00:00 (that is "until midnight": write 24:00).
      if (!isLocalTime(window.startTime) || !isLocalTime(window.endTime) || window.endTime >= window.startTime || window.endTime === '00:00') {
        return badRequest(['overnight hours must end after midnight and before they start (for example 22:00 to 02:00); for hours that end at midnight use 24:00']);
      }
      inputs = days.flatMap(day =>
        splitOvernightRule({ dayOfWeek: day, startTime: window.startTime, endTime: window.endTime, validFrom: window.validFrom, validTo: window.validTo }).map(part => ({
          kind: ruleKind as 'hours' | 'service_period', label: label ?? null, dayOfWeek: part.dayOfWeek, startTime: part.startTime, endTime: part.endTime, validFrom: part.validFrom, validTo: part.validTo,
        })),
      );
    } else {
      inputs = days.map(day => ({ kind: ruleKind as 'hours' | 'service_period', label: label ?? null, dayOfWeek: day, ...window }));
    }
    const own = checkRuleBatch(owner, [], inputs).problems;
    if (own.length > 0) return badRequest(crossMidnightHint(own, inputs[0]));
    if (!(await ownerExists(context, owner))) return notFound();

    const result = await guardedAvailability(async () => {
      const existing = await context.availability.listRules(context.tenant, owner);
      if (checkRuleBatch(owner, existing, inputs).overlaps) return { ok: false, reason: 'overlap' } as AvailabilityWriteResult<StoredAvailabilityRule[]>;
      // The zone is pinned in the same statement as the first rule (the repository's CTE); an owner that already has a pin ignores this default.
      return context.availability.createRules(context.tenant, owner, inputs, await defaultZone(context, owner));
    });
    if (!result.ok) return result.response;
    if (!result.value.ok) return failure(result.value.reason);
    const rules = result.value.value;
    await auditPin(context, owner, result.value.pinned);
    for (const rule of rules) {
      await audit(context, 'scheduling.availability_rule.created', 'availability_rule', rule.id, { ...ruleSummary(owner, rule), ...(rules.length > 1 ? { batch_size: rules.length } : {}) });
    }
    const zone = await guardedAvailability(() => zoneView(context, owner));
    return schedulingJson({ rule: rules[0], rules, ...(zone.ok ? { zone: zone.value } : {}) }, { status: 201 });
  };

/** `dayOfWeek` (one weekday) or `daysOfWeek` (a list of distinct weekdays, 0 = Sunday), as a list. Problems are appended. */
function daysFrom(body: Record<string, unknown>, problems: string[]): number[] {
  const isDay = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6;
  if (has(body, 'dayOfWeek')) {
    if (!isDay(body.dayOfWeek)) problems.push('dayOfWeek must be a whole number from 0 (Sunday) to 6 (Saturday)');
    return isDay(body.dayOfWeek) ? [body.dayOfWeek] : [];
  }
  if (!has(body, 'daysOfWeek')) return [];
  const list = body.daysOfWeek;
  if (!Array.isArray(list) || list.length === 0 || list.length > 7 || !list.every(isDay) || new Set(list).size !== list.length) {
    problems.push('daysOfWeek must be a list of 1 to 7 distinct whole numbers from 0 (Sunday) to 6 (Saturday)');
    return [];
  }
  return [...(list as number[])].sort((a, b) => a - b);
}

function crossMidnightHint(problems: string[], input: NewStoredRuleInput): string[] {
  const crosses = typeof input.startTime === 'string' && typeof input.endTime === 'string' && input.endTime !== END_OF_DAY && input.endTime <= input.startTime;
  return crosses ? [...problems, 'for hours that run past midnight set overnight to true: they are then stored as two rules, together'] : problems;
}

export async function updateRule(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'ruleId');
  if (!id) return notFound();
  const parsed = await readBody(context.request);
  if (!parsed.ok) return parsed.response;
  const { expectedUpdatedAt, changes } = splitExpectedUpdatedAt(parsed.body);
  const problems = [...validateExpectedUpdatedAt(expectedUpdatedAt), ...unknownFields(changes, RULE_FIELDS)];
  const label = optionalText(changes, 'label', MAX_LABEL, problems);
  const validFrom = optionalDate(changes, 'validFrom', problems);
  const validTo = optionalDate(changes, 'validTo', problems);
  if (has(changes, 'kind') && changes.kind !== 'hours' && changes.kind !== 'service_period') problems.push("kind must be 'hours' or 'service_period'");
  if (Object.keys(changes).length === 0) problems.push('nothing to change');
  if (problems.length > 0) return badRequest([...new Set(problems)]);

  const current = await guardedAvailability(() => context.availability.getRule(context.tenant, id));
  if (!current.ok) return current.response;
  if (current.value === null) return notFound();
  const before = current.value;
  const patch = {
    ...(has(changes, 'kind') ? { kind: changes.kind as 'hours' | 'service_period' } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(has(changes, 'dayOfWeek') ? { dayOfWeek: changes.dayOfWeek as number } : {}),
    ...(has(changes, 'startTime') ? { startTime: changes.startTime as string } : {}),
    ...(has(changes, 'endTime') ? { endTime: changes.endTime as string } : {}),
    ...(validFrom !== undefined ? { validFrom } : {}),
    ...(validTo !== undefined ? { validTo } : {}),
  };
  const owner = ownerOf(before);
  const merged: NewStoredRuleInput = { ...before, ...patch };
  const own = checkRuleWrite(owner, [], merged, id).problems;
  if (own.length > 0) return badRequest(crossMidnightHint(own, merged));

  const result = await guardedAvailability(async () => {
    const existing = await context.availability.listRules(context.tenant, owner);
    if (checkRuleWrite(owner, existing, merged, id).overlaps) return { ok: false, reason: 'overlap' } as AvailabilityWriteResult<StoredAvailabilityRule>;
    return context.availability.updateRule(context.tenant, id, expectedUpdatedAt as string, patch);
  });
  if (!result.ok) return result.response;
  if (!result.value.ok) return failure(result.value.reason);
  await audit(context, 'scheduling.availability_rule.updated', 'availability_rule', id, { ...ruleSummary(owner, result.value.value), fields: changedFields(changes) });
  return schedulingJson({ rule: result.value.value });
}

export async function deleteRule(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'ruleId');
  if (!id) return notFound();
  const parsed = await readBody(context.request);
  if (!parsed.ok) return parsed.response;
  const { expectedUpdatedAt, changes } = splitExpectedUpdatedAt(parsed.body);
  const problems = [...validateExpectedUpdatedAt(expectedUpdatedAt), ...unknownFields(changes, [])];
  if (problems.length > 0) return badRequest(problems);

  const current = await guardedAvailability(() => context.availability.getRule(context.tenant, id));
  if (!current.ok) return current.response;
  if (current.value === null) return notFound();
  const result = await guardedAvailability(() => context.availability.deleteRule(context.tenant, id, expectedUpdatedAt as string));
  if (!result.ok) return result.response;
  if (!result.value.ok) return failure(result.value.reason);
  await audit(context, 'scheduling.availability_rule.deleted', 'availability_rule', id, ruleSummary(ownerOf(current.value), current.value));
  return schedulingJson({ deleted: true, id });
}

const REMOVE_OVERNIGHT_FIELDS = ['rules'] as const;
const HALF_FIELDS = ['id', 'expectedUpdatedAt'] as const;

/**
 * POST availability-rules/remove-overnight  { rules: [{ id, expectedUpdatedAt }, { id, expectedUpdatedAt }] }
 * Removes BOTH halves of an overnight window in one statement (Phase 2B.3d prerequisite): both rules are deleted or neither is. Either
 * half missing (or another organisation's) is 404; either half changed since it was loaded is 409 STALE_WRITE; two rules that are not the
 * halves of one window of one owner are 409 NOT_OVERNIGHT_WINDOW. Nothing is deleted in any of those cases. One audit entry per deleted
 * rule is written after the commit, from the rows the statement actually deleted. Removing is allowed on an archived offering or an
 * inactive resource, as for a single rule.
 */
export async function removeOvernightWindow(context: SchedulingRouteContext): Promise<Response> {
  const parsed = await readBody(context.request);
  if (!parsed.ok) return parsed.response;
  const problems = unknownFields(parsed.body, REMOVE_OVERNIGHT_FIELDS);
  const list = parsed.body.rules;
  if (!Array.isArray(list) || list.length !== 2) problems.push('rules must be a list of exactly two rules: the evening half and the morning half of one overnight window');
  const halves: OvernightHalfRef[] = [];
  if (Array.isArray(list) && list.length === 2) {
    list.forEach((raw, i) => {
      const half = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
      if (!half) {
        problems.push(`rules[${i}] must be an object with id and expectedUpdatedAt`);
        return;
      }
      problems.push(...unknownFields(half, HALF_FIELDS).map(p => `rules[${i}].${p}`));
      if (typeof half.id !== 'string' || half.id.length === 0 || half.id.length > 100) problems.push(`rules[${i}].id is required`);
      problems.push(...validateExpectedUpdatedAt(half.expectedUpdatedAt).map(p => `rules[${i}]: ${p}`));
      if (typeof half.id === 'string' && typeof half.expectedUpdatedAt === 'string') halves.push({ id: half.id, expectedUpdatedAt: half.expectedUpdatedAt });
    });
    if (halves.length === 2 && halves[0].id === halves[1].id) problems.push('the two rules must be different rules');
  }
  if (problems.length > 0) return badRequest([...new Set(problems)]);

  const result = await guardedAvailability(() => context.availability.deleteOvernightWindow(context.tenant, [halves[0], halves[1]]));
  if (!result.ok) return result.response;
  if (!result.value.ok) return failure(result.value.reason);
  const deleted = result.value.value;
  for (const rule of deleted) {
    await audit(context, 'scheduling.availability_rule.deleted', 'availability_rule', rule.id, { ...ruleSummary(ownerOf(rule), rule), batch_size: deleted.length, window: 'overnight' });
  }
  return schedulingJson({ deleted: true, ids: deleted.map(r => r.id) });
}

function ruleSummary(owner: AvailabilityOwner, r: StoredAvailabilityRule) {
  return { owner_kind: owner.kind, owner_id: owner.id, rule_kind: r.kind, day_of_week: r.dayOfWeek, start_time: r.startTime, end_time: r.endTime, valid_from: r.validFrom, valid_to: r.validTo };
}

// ── exceptions (closures) ───────────────────────────────────────────────────

export const createExceptionFor = (kind: OwnerKind) =>
  async function createException(context: SchedulingRouteContext): Promise<Response> {
    const id = idParam(context, ownerParam(kind));
    if (!id) return notFound();
    const owner: AvailabilityOwner = { kind, id };
    const parsed = await readBody(context.request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const problems = unknownFields(body, EXCEPTION_FIELDS);
    for (const required of ['fromDate', 'toDate']) if (!has(body, required)) problems.push(`${required} is required`);
    const reason = optionalText(body, 'reason', MAX_REASON, problems);
    const exceptionKind = has(body, 'kind') ? body.kind : 'closed';
    if (exceptionKind === 'override') problems.push('override exceptions are not available yet: only closures can be created');
    else if (exceptionKind !== 'closed') problems.push("kind must be 'closed'");
    if (problems.length > 0) return badRequest(problems);

    const window = windowFrom(body, problems);
    if (problems.length > 0) return badRequest(problems);

    const input: NewStoredExceptionInput = { fromDate: body.fromDate as string, toDate: body.toDate as string, kind: 'closed', reason: reason ?? null, ...window };
    const own = checkExceptionWrite(owner, [], input).problems;
    if (own.length > 0) return badRequest(own.map(p => p.replace(/^exception candidate: /, '').replace(/^window 1: /, '')));
    if (!(await ownerExists(context, owner))) return notFound();

    const result = await guardedAvailability(async () => {
      const existing = await context.availability.listExceptions(context.tenant, owner);
      if (checkExceptionWrite(owner, existing, input).overlaps) return { ok: false, reason: 'overlap' } as AvailabilityWriteResult<StoredAvailabilityException>;
      return context.availability.createException(context.tenant, owner, input, await defaultZone(context, owner));
    });
    if (!result.ok) return result.response;
    if (!result.value.ok) return failure(result.value.reason);
    const exception = result.value.value;
    await auditPin(context, owner, result.value.pinned);
    await audit(context, 'scheduling.availability_exception.created', 'availability_exception', exception.id, exceptionSummary(owner, exception));
    const zone = await guardedAvailability(() => zoneView(context, owner));
    return schedulingJson({ exception, ...(zone.ok ? { zone: zone.value } : {}) }, { status: 201 });
  };

export async function updateException(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'exceptionId');
  if (!id) return notFound();
  const parsed = await readBody(context.request);
  if (!parsed.ok) return parsed.response;
  const { expectedUpdatedAt, changes } = splitExpectedUpdatedAt(parsed.body);
  const problems = [...validateExpectedUpdatedAt(expectedUpdatedAt), ...unknownFields(changes, EXCEPTION_FIELDS)];
  const reason = optionalText(changes, 'reason', MAX_REASON, problems);
  const fromDate = optionalDate(changes, 'fromDate', problems);
  const toDate = optionalDate(changes, 'toDate', problems);
  if (fromDate === null) problems.push('fromDate cannot be null');
  if (toDate === null) problems.push('toDate cannot be null');
  if (has(changes, 'kind') && changes.kind !== 'closed') problems.push(changes.kind === 'override' ? 'override exceptions are not available yet: only closures are supported' : "kind must be 'closed'");
  if (Object.keys(changes).length === 0) problems.push('nothing to change');
  if (problems.length > 0) return badRequest([...new Set(problems)]);

  const current = await guardedAvailability(() => context.availability.getException(context.tenant, id));
  if (!current.ok) return current.response;
  if (current.value === null) return notFound();
  const before = current.value;
  const window = has(changes, 'startTime') || has(changes, 'endTime') ? windowFrom(changes, problems) : null;
  if (problems.length > 0) return badRequest([...new Set(problems)]);
  const patch = {
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
    ...(has(changes, 'kind') ? { kind: 'closed' as const } : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(window ? { startTime: window.startTime, endTime: window.endTime } : {}),
  };
  const owner = ownerOf(before);
  const merged: NewStoredExceptionInput = { ...before, ...patch };
  const own = checkExceptionWrite(owner, [], merged, id).problems;
  if (own.length > 0) return badRequest(own.map(p => p.replace(/^exception [^:]+: /, '').replace(/^window 1: /, '')));

  const result = await guardedAvailability(async () => {
    const existing = await context.availability.listExceptions(context.tenant, owner);
    if (checkExceptionWrite(owner, existing, merged, id).overlaps) return { ok: false, reason: 'overlap' } as AvailabilityWriteResult<StoredAvailabilityException>;
    return context.availability.updateException(context.tenant, id, expectedUpdatedAt as string, patch);
  });
  if (!result.ok) return result.response;
  if (!result.value.ok) return failure(result.value.reason);
  await audit(context, 'scheduling.availability_exception.updated', 'availability_exception', id, { ...exceptionSummary(owner, result.value.value), fields: changedFields(changes) });
  return schedulingJson({ exception: result.value.value });
}

export async function deleteException(context: SchedulingRouteContext): Promise<Response> {
  const id = idParam(context, 'exceptionId');
  if (!id) return notFound();
  const parsed = await readBody(context.request);
  if (!parsed.ok) return parsed.response;
  const { expectedUpdatedAt, changes } = splitExpectedUpdatedAt(parsed.body);
  const problems = [...validateExpectedUpdatedAt(expectedUpdatedAt), ...unknownFields(changes, [])];
  if (problems.length > 0) return badRequest(problems);

  const current = await guardedAvailability(() => context.availability.getException(context.tenant, id));
  if (!current.ok) return current.response;
  if (current.value === null) return notFound();
  const result = await guardedAvailability(() => context.availability.deleteException(context.tenant, id, expectedUpdatedAt as string));
  if (!result.ok) return result.response;
  if (!result.value.ok) return failure(result.value.reason);
  await audit(context, 'scheduling.availability_exception.deleted', 'availability_exception', id, exceptionSummary(ownerOf(current.value), current.value));
  return schedulingJson({ deleted: true, id });
}

function exceptionSummary(owner: AvailabilityOwner, e: StoredAvailabilityException) {
  // The reason is free text and is never copied into the audit trail: only whether there is one.
  return {
    owner_kind: owner.kind, owner_id: owner.id, exception_kind: e.kind, from_date: e.fromDate, to_date: e.toDate, has_reason: e.reason !== null,
    ...(e.startTime !== null && e.endTime !== null ? { start_time: e.startTime, end_time: e.endTime } : {}),
  };
}

/** The partial-day window of a closure body: both times, or neither (the whole day). Null for neither; problems are appended. */
function windowFrom(body: Record<string, unknown>, problems: string[]): { startTime: string | null; endTime: string | null } {
  const start = has(body, 'startTime') ? body.startTime : null;
  const end = has(body, 'endTime') ? body.endTime : null;
  if ((start === null) !== (end === null)) {
    problems.push('startTime and endTime must be given together (a partial-day closure), or both left out (a full-day closure)');
    return { startTime: null, endTime: null };
  }
  if (start !== null && (typeof start !== 'string' || !isLocalTime(start))) problems.push('startTime must be HH:MM');
  if (end !== null && (typeof end !== 'string' || (end !== END_OF_DAY && !isLocalTime(end)))) problems.push('endTime must be HH:MM or 24:00');
  return { startTime: typeof start === 'string' ? start : null, endTime: typeof end === 'string' ? end : null };
}
