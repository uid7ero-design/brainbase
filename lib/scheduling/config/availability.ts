import {
  AvailabilityNotReadyError,
  END_OF_DAY,
  checkExceptionWrite,
  checkRuleWrite,
  isLocalDate,
  validateExpectedUpdatedAt,
  type AvailabilityOwner,
  type AvailabilityWriteFailure,
  type AvailabilityWriteResult,
  type NewStoredExceptionInput,
  type NewStoredRuleInput,
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
//
// Not accepted yet: kind 'override' (the table has no column for override hours) and rules that cross midnight in one request (a
// cross-midnight window is two rules, see splitOvernightRule, and one request must not half-succeed).

const RULE_FIELDS = ['dayOfWeek', 'startTime', 'endTime', 'validFrom', 'validTo', 'kind', 'label'] as const;
const EXCEPTION_FIELDS = ['fromDate', 'toDate', 'kind', 'reason'] as const;
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
  }
}

async function ownerExists(context: SchedulingRouteContext, owner: AvailabilityOwner): Promise<boolean> {
  if (owner.kind === 'offering') return (await context.persistence.config.getOffering(context.tenant, owner.id)) !== null;
  return (await context.persistence.config.listResources(context.tenant)).some(r => r.id === owner.id);
}

const ownerOf = (r: { resourceId: string | null; offeringId: string | null }): AvailabilityOwner =>
  r.resourceId !== null ? { kind: 'resource', id: r.resourceId } : { kind: 'offering', id: r.offeringId as string };

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
    const problems = unknownFields(body, RULE_FIELDS);
    for (const required of ['dayOfWeek', 'startTime', 'endTime']) if (!has(body, required)) problems.push(`${required} is required`);
    const label = optionalText(body, 'label', MAX_LABEL, problems);
    const validFrom = optionalDate(body, 'validFrom', problems);
    const validTo = optionalDate(body, 'validTo', problems);
    const ruleKind = has(body, 'kind') ? body.kind : 'hours';
    if (ruleKind !== 'hours' && ruleKind !== 'service_period') problems.push("kind must be 'hours' or 'service_period'");
    if (problems.length > 0) return badRequest(problems);

    const input: NewStoredRuleInput = {
      kind: ruleKind as 'hours' | 'service_period',
      label: label ?? null,
      dayOfWeek: body.dayOfWeek as number,
      startTime: body.startTime as string,
      endTime: body.endTime as string,
      validFrom: validFrom ?? null,
      validTo: validTo ?? null,
    };
    const own = checkRuleWrite(owner, [], input).problems;
    if (own.length > 0) return badRequest(crossMidnightHint(own, input));
    if (!(await ownerExists(context, owner))) return notFound();

    const result = await guardedAvailability(async () => {
      const existing = await context.availability.listRules(context.tenant, owner);
      if (checkRuleWrite(owner, existing, input).overlaps) return { ok: false, reason: 'overlap' } as AvailabilityWriteResult<StoredAvailabilityRule>;
      return context.availability.createRule(context.tenant, owner, input);
    });
    if (!result.ok) return result.response;
    if (!result.value.ok) return failure(result.value.reason);
    const rule = result.value.value;
    await audit(context, 'scheduling.availability_rule.created', 'availability_rule', rule.id, ruleSummary(owner, rule));
    return schedulingJson({ rule }, { status: 201 });
  };

function crossMidnightHint(problems: string[], input: NewStoredRuleInput): string[] {
  const crosses = typeof input.startTime === 'string' && typeof input.endTime === 'string' && input.endTime !== END_OF_DAY && input.endTime <= input.startTime;
  return crosses ? [...problems, 'for hours that run past midnight create two rules: start to 24:00 on one day, and 00:00 to the end on the next'] : problems;
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

    const input: NewStoredExceptionInput = { fromDate: body.fromDate as string, toDate: body.toDate as string, kind: 'closed', reason: reason ?? null };
    const own = checkExceptionWrite(owner, [], input).problems;
    if (own.length > 0) return badRequest(own.map(p => p.replace(/^exception candidate: /, '')));
    if (!(await ownerExists(context, owner))) return notFound();

    const result = await guardedAvailability(async () => {
      const existing = await context.availability.listExceptions(context.tenant, owner);
      if (checkExceptionWrite(owner, existing, input).overlaps) return { ok: false, reason: 'overlap' } as AvailabilityWriteResult<StoredAvailabilityException>;
      return context.availability.createException(context.tenant, owner, input);
    });
    if (!result.ok) return result.response;
    if (!result.value.ok) return failure(result.value.reason);
    const exception = result.value.value;
    await audit(context, 'scheduling.availability_exception.created', 'availability_exception', exception.id, exceptionSummary(owner, exception));
    return schedulingJson({ exception }, { status: 201 });
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
  const patch = {
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
    ...(has(changes, 'kind') ? { kind: 'closed' as const } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
  const owner = ownerOf(before);
  const merged: NewStoredExceptionInput = { ...before, ...patch };
  const own = checkExceptionWrite(owner, [], merged, id).problems;
  if (own.length > 0) return badRequest(own.map(p => p.replace(/^exception [^:]+: /, '')));

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
  return { owner_kind: owner.kind, owner_id: owner.id, exception_kind: e.kind, from_date: e.fromDate, to_date: e.toDate, has_reason: e.reason !== null };
}
