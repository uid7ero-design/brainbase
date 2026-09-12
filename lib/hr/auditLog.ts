import sql from '@/lib/db';

// HR-0.5 §4 — HR audit-helper CONTRACT on top of the existing, ADR-governed
// audit_logs table (docs/architecture/decisions/0003-commercial-audit-
// wiring-standard.md). Modeled directly on lib/commercial/auditLog.ts's
// shape, per ADR-0003 §6: "the two existing, now-proven shapes are the
// pattern to copy per-vertical... not a shared generic utility." Does NOT
// touch organiser_activity (the separate, largely-unwired mechanism HR-0
// found) and does NOT introduce a third audit table.
//
// No hr_* tables exist yet (HR-0.5 is a prerequisites-only phase, per its
// own brief) — nothing calls logHrEvent() yet. This file defines and tests
// the contract HR-1+ mutation routes will call once hr_people/hr_teams/
// hr_documents/hr_administrators are created.

export type HrAuditActor = {
  organisationId: string;
  /** The human actor's id, or null for a genuinely system-initiated event
   *  (rare in HR) — never a placeholder/sentinel user, per ADR-0003 §5. */
  userId: string | null;
  /** Optional request metadata — see requestMeta.ts for how a caller
   *  obtains these safely from a NextRequest without inventing a value. */
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type HrAuditEntry = {
  /** '<resource_type>.<verb>', snake_case verb, past tense — e.g.
   *  'hr_person.created', matching ADR-0003 §12's naming convention. */
  action: string;
  resourceType: string;
  resourceId: string;
  /** The specific fields that changed, never the entire row — ADR-0003 §4. */
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
};

// Fields that must never reach audit_logs even if present on a caller's
// before/after snapshot object — HR-0.5 §4's own exclusion list (passwords,
// secrets, tokens, raw identity documents, full highly-restricted records),
// enforced here rather than trusted to every future call site, matching
// ADR-0003 §7/§8's PII/secrets discipline. Deliberately conservative and
// small: HR-1+ may extend this list as real hr_* columns are defined, but
// this phase creates no HR tables, so no real field names are assumed here
// beyond the generic categories the brief itself names.
//
// work_email/work_phone (HR-1 addition): hr_people's own two 'confidential'-
// tier contact fields (lib/hr/personFieldTiers.ts classifies them
// identically, for read-visibility rather than audit purposes). PATCH
// /api/hr/people/[id] builds before_state/after_state as a field-diff of
// whatever the caller actually changed (Object.keys(updates)), with no
// per-field filtering of its own — so before this addition, editing a
// person's work email or phone wrote the raw old and new value straight
// into audit_logs, unredacted, for the life of that row (this table has no
// retention/purge mechanism — ADR-0003 §13). Redacting here, in the one
// helper every HR mutation route already calls, fixes it for all of them
// at once without touching route-level payload construction, without
// affecting hr_person.created (which never included these fields in its
// own hand-built afterState to begin with), and without altering
// redactState()'s behavior for any other vertical's audit helper (this
// Set is private to this file).
const FORBIDDEN_STATE_KEYS = new Set([
  'password',
  'password_hash',
  'passwordhash',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'ssn',
  'tax_file_number',
  'tfn',
  'bank_account',
  'bank_account_number',
  'bank_bsb',
  'medical',
  'medical_notes',
  'medical_information',
  'work_email',
  'work_phone',
]);

function redactState(state: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!state) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    out[key] = FORBIDDEN_STATE_KEYS.has(key.toLowerCase()) ? '[redacted]' : value;
  }
  return out;
}

/**
 * Writes one HR audit entry to audit_logs. Best-effort / non-transactional,
 * per ADR-0003 §3 & §11: every HR mutation this will eventually cover is
 * human-initiated and already gated by session/role/capability checks
 * before the business-state write runs, so a dropped audit write afterward
 * does not retroactively make the action ambiguous. A write failure is
 * caught, logged via console.error, and MUST NOT propagate to (or fail)
 * the caller's own mutation — this phase does not change that platform-
 * wide failure semantic; a future restricted-HR operation that genuinely
 * needs fail-closed audit semantics is an explicit, separate decision for
 * a later phase (HR-0's own §J risk list), not assumed here.
 */
export async function logHrEvent(actor: HrAuditActor, entry: HrAuditEntry): Promise<void> {
  try {
    const before = redactState(entry.beforeState);
    const after = redactState(entry.afterState);

    await sql`
      INSERT INTO audit_logs (
        id, organisation_id, user_id, action, resource_type, resource_id,
        before_state, after_state, ip_address, user_agent
      )
      VALUES (
        ${crypto.randomUUID()}, ${actor.organisationId}, ${actor.userId},
        ${entry.action}, ${entry.resourceType}, ${entry.resourceId},
        ${before ? JSON.stringify(before) : null}::jsonb,
        ${after ? JSON.stringify(after) : null}::jsonb,
        ${actor.ipAddress ?? null}, ${actor.userAgent ?? null}
      )
    `;
  } catch (err) {
    console.error(
      '[hr audit] audit_logs write failed (ignored, per ADR-0003 §11 — the underlying mutation remains valid)',
      err,
      { action: entry.action, resourceType: entry.resourceType, resourceId: entry.resourceId },
    );
  }
}
