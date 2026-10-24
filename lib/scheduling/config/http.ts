import { SchedulingError, type ConfigWriteResult } from '@scheduling/core';
import { schedulingJson, type SchedulingRouteContext } from '../route';
import { recordSchedulingAudit, type AuditSummary, type SchedulingAuditAction } from '../audit';

// Phase 2B.2b — the shared HTTP vocabulary of the Scheduling configuration API. Everything here runs INSIDE the central
// guard (lib/scheduling/route.ts): the caller is already authenticated, the organisation is already the session's, and
// the tenant context already carries the role's permissions. Nothing here reads a session, an organisation from a request,
// or the database.
//
// Error contract (every body is { error, code, ... }; nothing internal is ever included):
//   400 INVALID_INPUT       malformed body or a rule failure; `problems` lists plain-language reasons
//   404 NOT_FOUND           missing, or another organisation's row (indistinguishable on purpose)
//   409 STALE_WRITE         the row changed since `expectedUpdatedAt` was read: re-read and retry. NOTHING was written.
//   409 ARCHIVED            the row (or its schedule) is archived; archiving is one-way
//   409 PRESET_LOCKED       the preset of a schedule cannot change once it has any offering
//   409 RESOURCE_IN_USE     the resource is booked/linked (kind change, deactivation, capacity)
//   409 ALLOCATION_IN_USE   a live reservation holds the resource for the offering (unlink)
//   409 CONFLICT            any other refusal of the booking rules
//   413 / 415               body too large / not JSON
//   503 TRY_AGAIN           a lock wait timed out; nothing was written
// 401/403/503 for access and configuration come from the guard.

const MAX_BODY_BYTES = 32 * 1024;

export type ParsedBody = { ok: true; body: Record<string, unknown> } | { ok: false; response: Response };

export function badRequest(problems: string[]): Response {
  return schedulingJson({ error: 'The request is not valid.', code: 'INVALID_INPUT', problems }, { status: 400 });
}
export const notFound = (): Response => schedulingJson({ error: 'Not found.', code: 'NOT_FOUND' }, { status: 404 });
export const conflict = (code: string, error: string, extra: Record<string, unknown> = {}): Response => schedulingJson({ error, code, ...extra }, { status: 409 });

/** A JSON object body, size-limited. Never parses a body that is not application/json. */
export async function readBody(request: Request): Promise<ParsedBody> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) return { ok: false, response: schedulingJson({ error: 'The request body must be JSON.', code: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 }) };
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return { ok: false, response: schedulingJson({ error: 'The request body is too large.', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 }) };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: badRequest(['the request body could not be read']) };
  }
  if (text.length > MAX_BODY_BYTES) return { ok: false, response: schedulingJson({ error: 'The request body is too large.', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 }) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, response: badRequest(['the request body is not valid JSON']) };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, response: badRequest(['the request body must be a JSON object']) };
  return { ok: true, body: parsed as Record<string, unknown> };
}

/** Fields of `body` outside `allowed`, as problems. The API accepts only what it documents. */
export function unknownFields(body: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(body).filter(k => !allowed.includes(k)).map(k => `${k} is not a field of this request`);
}

/** Splits the version token off a PATCH-style body. The token is required: an edit without it is refused, never applied blind. */
export function splitExpectedUpdatedAt(body: Record<string, unknown>): { expectedUpdatedAt: unknown; changes: Record<string, unknown> } {
  const { expectedUpdatedAt, ...changes } = body;
  return { expectedUpdatedAt, changes };
}

/** A route parameter is an opaque id minted by the repository; anything else cannot exist, so it is a plain 404. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
export function idParam(context: SchedulingRouteContext, name: string): string | null {
  const v = context.params[name];
  return v !== undefined && ID.test(v) ? v : null;
}

/** Turns an expected refusal of the repository into its HTTP response. */
export function failureResponse(reason: Exclude<ConfigWriteResult<never>, { ok: true }>['reason'], detail?: string): Response {
  switch (reason) {
    case 'not_found':
      return notFound();
    case 'stale_write':
      return conflict('STALE_WRITE', 'This record was changed by someone else since you loaded it. Reload it and try again.');
    case 'archived':
      return conflict('ARCHIVED', 'This record is archived and cannot be changed.');
    case 'preset_locked':
      return conflict('PRESET_LOCKED', 'The type of a schedule cannot change once it has offerings.');
    case 'resource_in_use':
      return conflict('RESOURCE_IN_USE', detail ?? 'This resource is in use and cannot be changed that way.');
    case 'allocation_in_use':
      return conflict('ALLOCATION_IN_USE', detail ?? 'A live reservation holds this resource for the offering.');
  }
}

/** Maps a thrown SchedulingError to a response, or null when it is not one this API answers (the guard then returns a generic 500). */
export function schedulingErrorResponse(err: unknown): Response | null {
  if (!(err instanceof SchedulingError)) return null;
  switch (err.code) {
    case 'invalid_input':
      return badRequest([err.message]);
    case 'not_found':
      return notFound();
    case 'lifecycle_violation':
      return conflict('CONFLICT', 'The change is not allowed in the current state.');
    case 'contention_timeout':
      return schedulingJson({ error: 'The system is busy. Nothing was changed; please try again.', code: 'TRY_AGAIN' }, { status: 503 });
    default:
      return null;
  }
}

/** Runs a repository call, answering an expected SchedulingError itself and rethrowing anything else. */
export async function guarded<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    const response = schedulingErrorResponse(err);
    if (response) return { ok: false, response };
    throw err;
  }
}

/** The body for an HTTP 200/201 that carries a stored row. The organisation is never part of a response. */
export function omitOrganisation<T extends { organisationId?: unknown }>(row: T): Omit<T, 'organisationId'> {
  const copy: Record<string, unknown> = { ...row };
  delete copy.organisationId;
  return copy as Omit<T, 'organisationId'>;
}

/** Audit AFTER a successful mutation, best effort (a failure to audit never undoes the committed change). */
export async function audit(context: SchedulingRouteContext, action: SchedulingAuditAction, resourceType: string, resourceId: string, summary: AuditSummary = {}): Promise<void> {
  await recordSchedulingAudit({
    tenant: context.tenant,
    action,
    resourceType,
    resourceId,
    summary,
    ipAddress: context.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    userAgent: context.request.headers.get('user-agent'),
  });
}

/** The names of the fields a change touches, for the audit summary: the fields, never their values. */
export const changedFields = (changes: Record<string, unknown>): string[] => Object.keys(changes).sort();
