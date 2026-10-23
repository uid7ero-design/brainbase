import type { TenantContext } from '@scheduling/core';

// Phase 2B.0 — the typed wrapper around the CRM find-or-create host function
// (scripts/scheduling/130_brainbase_crm_link.sql). Nothing imports it yet: the reservation workflow that uses it is
// Phase 2B.6, and the function it calls is not applied anywhere until a separately approved handoff.
//
// Customer-name policy (Phase 2B plan, section 5, decision 5):
//   * The reservation's display name is the record and is never passed here, split, or rewritten. This module has no
//     display-name parameter at all.
//   * A CRM contact is created only from separately supplied first and last names; nothing is derived, defaulted or
//     substituted (no placeholder, no guess at which word is a surname). The database function enforces it and
//     raises when either is blank at creation time; this module never papers over that.
//   * Matching is by the organisation and the normalised email, never by name. An existing contact is returned as it
//     is, so no email-matched booking needs names at all.
//   * If no CRM contact can be linked (no usable email, or no match and no structured names), the answer is
//     `unlinked`, which is a normal outcome: the booking is saved without a CRM link, it is never blocked.
//
// The organisation and the acting user come from the TenantContext (the authenticated session). They are not inputs.

/** Structurally the same as the SqlExecutor of the Postgres adapter package, which application code must not import. */
export interface ContactSqlExecutor {
  query<Row = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<Row[]>;
}

export interface CrmLinkInput {
  email?: string | null;
  /** Structured, entered separately from the display name. Both are required to CREATE a contact; neither to match. */
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
}

export type CrmLinkResult =
  | { kind: 'linked'; contactId: string; outcome: 'matched' | 'created' }
  | { kind: 'unlinked'; reason: 'email_required' | 'names_required' };

export type CrmLinkErrorReason =
  | 'forbidden'
  | 'organisation_required'
  | 'unsafe_isolation'
  | 'contention_timeout'
  | 'unknown_organisation'
  | 'unknown_user';

/** A failure that is not an ordinary "unlinked" outcome. `retryable` is true only for a lock wait that timed out. */
export class CrmLinkError extends Error {
  readonly reason: CrmLinkErrorReason;
  constructor(reason: CrmLinkErrorReason, message?: string) {
    super(message ?? reason);
    this.name = 'CrmLinkError';
    this.reason = reason;
  }
  get retryable(): boolean {
    return this.reason === 'contention_timeout';
  }
}

/** The host function's custom SQLSTATEs (130_brainbase_crm_link.sql). */
export const CRM_LINK_SQLSTATE = {
  organisationRequired: 'SCCOR',
  emailRequired: 'SCCEM',
  namesRequired: 'SCCNM',
  isolation: 'SCISO',
} as const;

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/;

/** Same rule as the SQL function: lower(btrim(email)), one @, no whitespace, at most 254 characters. */
export function normaliseEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  return e.length > 0 && e.length <= 254 && EMAIL_SHAPE.test(e) ? e : null;
}

interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
  message?: unknown;
}

export function resolveCrmLinkError(err: unknown): CrmLinkError | null {
  const e = (typeof err === 'object' && err !== null ? err : null) as PgErrorLike | null;
  const code = typeof e?.code === 'string' ? e.code : null;
  const constraint = typeof e?.constraint === 'string' ? e.constraint : '';
  const message = typeof e?.message === 'string' ? e.message : '';
  switch (code) {
    case CRM_LINK_SQLSTATE.organisationRequired:
      return new CrmLinkError('organisation_required', message);
    case CRM_LINK_SQLSTATE.isolation:
      return new CrmLinkError('unsafe_isolation', message);
    case '55P03':
      return /lock timeout/i.test(message) ? new CrmLinkError('contention_timeout', message) : null;
    case '23503':
      if (/organisation_id_fkey/.test(constraint)) return new CrmLinkError('unknown_organisation', message);
      if (/created_by_fkey/.test(constraint)) return new CrmLinkError('unknown_user', message);
      return null;
    default:
      return null;
  }
}

/**
 * Finds the organisation's CRM contact for this email, or creates one (classification LEAD) from structured names.
 * Requires a staff tenant with `scheduling.reserve`; any other tenant is refused before the database is reached.
 */
export async function findOrCreateCrmContact(db: ContactSqlExecutor, tenant: TenantContext, input: CrmLinkInput): Promise<CrmLinkResult> {
  if (tenant.actor.kind !== 'staff' || !tenant.can('scheduling.reserve')) {
    throw new CrmLinkError('forbidden', 'only staff who may reserve can link a CRM contact');
  }
  if (!tenant.organisationId) throw new CrmLinkError('organisation_required');

  // Without a usable email there is nothing to match on and creating would only mint duplicates: save unlinked.
  if (normaliseEmail(input.email) === null) return { kind: 'unlinked', reason: 'email_required' };

  let rows: { contact_id: string; outcome: string }[];
  try {
    rows = await db.query<{ contact_id: string; outcome: string }>(
      'SELECT contact_id, outcome FROM brainbase_scheduling_find_or_create_contact($1, $2, $3, $4, $5, $6)',
      [tenant.organisationId, input.email, input.firstName ?? null, input.lastName ?? null, input.phone ?? null, tenant.actor.userId],
    );
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === CRM_LINK_SQLSTATE.namesRequired) return { kind: 'unlinked', reason: 'names_required' };
    if (code === CRM_LINK_SQLSTATE.emailRequired) return { kind: 'unlinked', reason: 'email_required' };
    throw resolveCrmLinkError(err) ?? err;
  }

  const row = rows[0];
  if (!row || (row.outcome !== 'matched' && row.outcome !== 'created')) {
    throw new Error('brainbase_scheduling_find_or_create_contact returned no usable row');
  }
  return { kind: 'linked', contactId: row.contact_id, outcome: row.outcome };
}
