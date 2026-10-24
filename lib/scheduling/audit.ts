import 'server-only';
import sql from '@/lib/db';
import type { TenantContext } from '@scheduling/core';

// Phase 2B.1 — Scheduling audit trail on the existing, generic audit_logs table (ADR-0003; same shape and posture as
// lib/admin/auditLog.ts). No schema change.
//
// WRITE side
//  * Action names are '<scheduling>.<resource>.<verb>' from the closed list below. An unknown action is refused, so a
//    typo cannot create an unreviewed event type.
//  * The organisation and the actor come from the TenantContext (the session), never from a caller-supplied value.
//  * The SUMMARY holds only non-sensitive facts: ids, counts, outcome codes, field names, dates. Every entry is checked;
//    a key that names a person or contact detail, or a value that looks like an email address or phone number, is
//    dropped and counted (`redacted`), not stored.
//  * Customer-identifying detail (a name, an email, a phone number) is stored ONLY under `identity`, a separate field of
//    the entry, and only when the caller passes it explicitly.
//  * Best-effort, called AFTER the operation has committed (ADR-0003 section 3): a failure here is logged without the
//    payload and reported as `false`; it never throws and so can never turn a committed booking into an error or undo it.
//
// READ side
//  * Scoped by the tenant's organisation and by the 'scheduling.' action prefix in SQL.
//  * The `identity` field is removed on the server unless the caller holds 'scheduling.audit.identity' (manager, admin,
//    super_admin). A viewer sees that something happened, with ids, and never who the customer was. The check is made at
//    READ time, so a later change of role can never reveal older entries to a lower role.
//  * The raw after_state is never returned: only the fields below, rebuilt from the validated shape.

export const SCHEDULING_AUDIT_ACTIONS = [
  'scheduling.settings.created',
  'scheduling.settings.updated',
  'scheduling.schedule.created',
  'scheduling.schedule.updated',
  'scheduling.schedule.archived',
  'scheduling.resource.created',
  'scheduling.resource.updated',
  'scheduling.offering.created',
  'scheduling.offering.updated',
  'scheduling.offering.archived',
  'scheduling.resource.deactivated',
  'scheduling.resource.reactivated',
  'scheduling.resource.linked',
  'scheduling.resource.unlinked',
  'scheduling.availability.updated',
  'scheduling.occurrence.created',
  'scheduling.occurrence.cancelled',
  'scheduling.reservation.created',
  'scheduling.reservation.cancelled',
  'scheduling.reservation.attendance_recorded',
  'scheduling.customer.linked',
] as const;
export type SchedulingAuditAction = (typeof SCHEDULING_AUDIT_ACTIONS)[number];

const ACTION_SET: ReadonlySet<string> = new Set(SCHEDULING_AUDIT_ACTIONS);
const AUDIT_SCHEMA_VERSION = 1;

export type AuditSummaryValue = string | number | boolean | null | ReadonlyArray<string | number | boolean | null>;
export type AuditSummary = Readonly<Record<string, AuditSummaryValue>>;

/** Customer-identifying detail. Stored apart from the summary and shown only to callers allowed to see it. */
export interface AuditIdentity {
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}

export interface SchedulingAuditInput {
  tenant: TenantContext;
  action: SchedulingAuditAction;
  resourceType: string;
  resourceId: string;
  summary?: AuditSummary;
  identity?: AuditIdentity;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// ── Summary sanitising ──────────────────────────────────────────────────────

const KEY_OK = /^[a-z][a-z0-9_]{0,40}$/;
// Keys that name a person or a way to reach them never belong in the summary.
const KEY_FORBIDDEN = /(e_?mail|phone|mobile|first_?name|last_?name|full_?name|display_?name|customer_?name|contact_?name|^name$|_name$|notes?|address|birth|dob)/;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const PHONE_LIKE = /^\+?[\d\s().-]{8,}$/;
const MAX_STRING = 120;
const MAX_ARRAY = 25;

function scalarOk(v: unknown): v is string | number | boolean | null {
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'string') return false;
  if (v.length > MAX_STRING) return false;
  if (UUID.test(v) || ISO_DATE.test(v)) return true;
  if (EMAIL_LIKE.test(v)) return false;
  if (PHONE_LIKE.test(v) && (v.match(/\d/g) ?? []).length >= 8) return false;
  return true;
}

export function sanitiseAuditSummary(summary: unknown): { summary: Record<string, AuditSummaryValue>; redacted: number } {
  const out: Record<string, AuditSummaryValue> = {};
  let redacted = 0;
  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) return { summary: out, redacted: summary === undefined ? 0 : 1 };
  for (const [key, value] of Object.entries(summary as Record<string, unknown>)) {
    if (!KEY_OK.test(key) || KEY_FORBIDDEN.test(key)) {
      redacted++;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length <= MAX_ARRAY && value.every(scalarOk)) out[key] = value as AuditSummaryValue;
      else redacted++;
    } else if (scalarOk(value)) {
      out[key] = value as AuditSummaryValue;
    } else {
      redacted++;
    }
  }
  return { summary: out, redacted };
}

function cleanIdentity(identity: AuditIdentity | undefined): Record<string, string> | null {
  if (!identity) return null;
  const out: Record<string, string> = {};
  for (const [src, dest] of [['customerName', 'customer_name'], ['customerEmail', 'customer_email'], ['customerPhone', 'customer_phone']] as const) {
    const v = identity[src];
    if (typeof v === 'string' && v.trim() !== '') out[dest] = v.trim().slice(0, 200);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Stored as 'scheduling.<type>' so no other vertical's resource_type filter can ever match a Scheduling entry. */
function storedResourceType(type: string): string {
  const t = type.trim().toLowerCase().replace(/^scheduling\./, '');
  return `scheduling.${t}`.slice(0, 60);
}

// ── Write ───────────────────────────────────────────────────────────────────

/** Records one audit entry. Never throws. Returns whether the entry was written. Call it AFTER the operation committed. */
export async function recordSchedulingAudit(input: SchedulingAuditInput): Promise<boolean> {
  try {
    if (!ACTION_SET.has(input.action)) return false;
    if (input.tenant.actor.kind !== 'staff') return false;
    if (!input.tenant.organisationId || !input.resourceType || !input.resourceId) return false;
    const { summary, redacted } = sanitiseAuditSummary(input.summary ?? {});
    const identity = cleanIdentity(input.identity);
    const afterState = { v: AUDIT_SCHEMA_VERSION, summary, ...(redacted > 0 ? { redacted } : {}), ...(identity ? { identity } : {}) };
    await sql`
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state, ip_address, user_agent)
      VALUES (
        ${crypto.randomUUID()}, ${input.tenant.organisationId}, ${input.tenant.actor.userId}, ${input.action},
        ${storedResourceType(input.resourceType)}, ${input.resourceId.slice(0, 120)}, ${null}::jsonb, ${JSON.stringify(afterState)}::jsonb,
        ${input.ipAddress ?? null}, ${input.userAgent ?? null}
      )
    `;
    return true;
  } catch (err) {
    // The payload (summary, identity) is deliberately not logged here.
    console.error('[scheduling audit] audit_logs write failed (ignored: the committed operation remains valid)', { action: input.action, resourceId: input.resourceId, code: (err as { code?: string })?.code });
    return false;
  }
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface SchedulingAuditEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actorUserId: string | null;
  at: string;
  summary: Record<string, AuditSummaryValue>;
  /** Present ONLY for a caller holding 'scheduling.audit.identity'. Absent (not null) otherwise. */
  identity?: Record<string, string>;
}

type AuditRow = {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  after_state: unknown;
  at: string;
};

function toEntry(row: AuditRow, canSeeIdentity: boolean): SchedulingAuditEntry {
  const state = row.after_state !== null && typeof row.after_state === 'object' ? (row.after_state as Record<string, unknown>) : {};
  const entry: SchedulingAuditEntry = {
    id: row.id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    actorUserId: row.user_id,
    at: row.at,
    // Rebuilt through the same sanitiser, so a row written by anything else cannot leak a contact detail via the summary.
    summary: sanitiseAuditSummary(state.summary).summary,
  };
  if (canSeeIdentity && state.identity !== null && typeof state.identity === 'object') {
    const identity: Record<string, string> = {};
    for (const k of ['customer_name', 'customer_email', 'customer_phone']) {
      const v = (state.identity as Record<string, unknown>)[k];
      if (typeof v === 'string') identity[k] = v;
    }
    if (Object.keys(identity).length > 0) entry.identity = identity;
  }
  return entry;
}

/** The organisation's scheduling audit entries, newest first. Needs 'scheduling.view'; identity needs 'scheduling.audit.identity'. */
export async function listSchedulingAudit(tenant: TenantContext, options: { limit?: number; before?: string } = {}): Promise<SchedulingAuditEntry[]> {
  if (!tenant.can('scheduling.view')) throw new Error('scheduling.view is required to read the audit trail');
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);
  const canSeeIdentity = tenant.can('scheduling.audit.identity');
  const rows = (options.before
    ? await sql`
        SELECT id, user_id, action, resource_type, resource_id, after_state, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
        FROM audit_logs
        WHERE organisation_id = ${tenant.organisationId} AND action LIKE 'scheduling.%' AND created_at < ${options.before}::timestamp
        ORDER BY created_at DESC, id DESC LIMIT ${limit}`
    : await sql`
        SELECT id, user_id, action, resource_type, resource_id, after_state, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
        FROM audit_logs
        WHERE organisation_id = ${tenant.organisationId} AND action LIKE 'scheduling.%'
        ORDER BY created_at DESC, id DESC LIMIT ${limit}`) as AuditRow[];
  return rows.map(r => toEntry(r, canSeeIdentity));
}
