import sql from '@/lib/db';

// HR-0.5 §4 — HR audit-helper CONTRACT on top of the existing, ADR-governed
// audit_logs table (docs/architecture/decisions/0003-commercial-audit-
// wiring-standard.md). Modeled directly on lib/commercial/auditLog.ts's
// shape, per ADR-0003 §6: "the two existing, now-proven shapes are the
// pattern to copy per-vertical... not a shared generic utility." Does NOT
// touch organiser_activity (the separate, largely-unwired mechanism HR-0
// found) and does NOT introduce a third audit table.

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

type AuditFieldPolicy = {
  allowed: ReadonlySet<string>;
  idOnly: ReadonlySet<string>;
  redacted: ReadonlySet<string>;
  omitted: ReadonlySet<string>;
};

const HR_PERSON_AUDIT_POLICY: AuditFieldPolicy = {
  allowed: new Set([
    'job_title',
    'worker_type',
    'employment_status',
    'start_date',
    'end_date',
  ]),
  idOnly: new Set([
    'linked_user_id',
    'team_id',
    'manager_person_id',
  ]),
  redacted: new Set([
    'first_name',
    'last_name',
    'preferred_name',
    'work_email',
    'work_phone',
  ]),
  omitted: new Set([
    'id',
    'organisation_id',
    'created_at',
    'updated_at',
  ]),
};

const HR_TEAM_AUDIT_POLICY: AuditFieldPolicy = {
  allowed: new Set([
    'name',
    'archived_at',
  ]),
  idOnly: new Set([
    'manager_person_id',
  ]),
  redacted: new Set([
    'description',
  ]),
  omitted: new Set([
    'id',
    'organisation_id',
    'created_at',
    'updated_at',
  ]),
};

const HR_RESTRICTED_CASE_AUDIT_POLICY: AuditFieldPolicy = {
  allowed: new Set(['status', 'closed_at']),
  idOnly: new Set(['opened_by']),
  redacted: new Set(['case_type', 'title', 'reference']),
  omitted: new Set(['id', 'organisation_id', 'created_at', 'updated_at']),
};

const HR_RESTRICTED_CASE_PARTICIPANT_AUDIT_POLICY: AuditFieldPolicy = {
  allowed: new Set(['role_in_case']),
  idOnly: new Set(['case_id', 'person_id']),
  redacted: new Set(),
  omitted: new Set(['id', 'organisation_id', 'created_at']),
};

const HR_RESTRICTED_CASE_ACCESS_AUDIT_POLICY: AuditFieldPolicy = {
  allowed: new Set(['granted_at', 'revoked_at']),
  idOnly: new Set(['case_id', 'user_id', 'granted_by', 'revoked_by']),
  redacted: new Set(),
  omitted: new Set(['id', 'organisation_id']),
};

const HR_RESTRICTED_CASE_NOTE_AUDIT_POLICY: AuditFieldPolicy = {
  allowed: new Set(),
  idOnly: new Set(['case_id', 'author_id']),
  redacted: new Set(['body']),
  omitted: new Set(['id', 'organisation_id', 'created_at']),
};

const HR_LIFECYCLE_TEMPLATE_AUDIT_POLICY: AuditFieldPolicy = {
  allowed: new Set([
    'template_key',
    'version_number',
    'lifecycle_type',
    'status',
    'activated_at',
    'retired_at',
  ]),
  idOnly: new Set(['created_by']),
  redacted: new Set(['name', 'description']),
  omitted: new Set(['id', 'organisation_id', 'created_at', 'updated_at']),
};

const HR_LIFECYCLE_WORKFLOW_AUDIT_POLICY: AuditFieldPolicy = {
  allowed: new Set([
    'lifecycle_type',
    'status',
    'anchor_date',
    'started_at',
    'completed_at',
    'cancelled_at',
  ]),
  idOnly: new Set(['person_id', 'template_id', 'started_by']),
  redacted: new Set(),
  omitted: new Set(['id', 'organisation_id', 'created_at', 'updated_at']),
};

const HR_LIFECYCLE_TASK_AUDIT_POLICY: AuditFieldPolicy = {
  allowed: new Set([
    'sequence',
    'responsibility_type',
    'due_at',
    'requires_approval',
    'approval_type',
    'employee_visible',
    'manager_visible',
    'internal_only',
    'status',
    'completed_at',
    'waived_at',
  ]),
  idOnly: new Set([
    'workflow_id',
    'person_id',
    'template_id',
    'template_task_id',
    'assigned_user_id',
    'completed_by',
    'waived_by',
  ]),
  redacted: new Set(['title', 'description', 'waiver_reason']),
  omitted: new Set(['id', 'organisation_id', 'created_at', 'updated_at']),
};

const HR_LIFECYCLE_TASK_APPROVAL_AUDIT_POLICY: AuditFieldPolicy = {
  allowed: new Set(['decision', 'decided_at']),
  idOnly: new Set(['task_id', 'workflow_id', 'person_id', 'approver_user_id']),
  redacted: new Set(['comment']),
  omitted: new Set(['id', 'organisation_id', 'created_at']),
};

const HR_EMPLOYEE_DOCUMENT_AUDIT_POLICY: AuditFieldPolicy = {
  allowed: new Set(['document_type', 'deleted_at']),
  idOnly: new Set(['person_id', 'lifecycle_task_id']),
  redacted: new Set(['title']),
  omitted: new Set(['id', 'organisation_id', 'created_at']),
};

const HR_EMPLOYEE_DOCUMENT_VERSION_AUDIT_POLICY: AuditFieldPolicy = {
  allowed: new Set([
    'version_number',
    'content_type',
    'byte_size',
    'expires_at',
    'is_current',
  ]),
  idOnly: new Set(['document_id', 'uploaded_by']),
  redacted: new Set(['original_filename']),
  omitted: new Set(['id', 'organisation_id', 'storage_key', 'created_at']),
};

const RESTRICTED_HR_READ_EVENTS = new Set([
  'hr_restricted_case:hr_restricted_case.read',
  'hr_restricted_case_participant:hr_restricted_case_participant.read',
  'hr_restricted_case_note:hr_restricted_case_note.read',
  'hr_restricted_case_document:hr_restricted_case_document.read',
]);

const HR_RESTRICTED_CASE_DOCUMENT_AUDIT_POLICY: AuditFieldPolicy = {
  allowed: new Set(['content_type', 'byte_size', 'deleted_at']),
  idOnly: new Set(['case_id', 'uploaded_by']),
  redacted: new Set(['original_filename', 'storage_key']),
  omitted: new Set(['id', 'organisation_id', 'created_at']),
};

function redactAllState(
  state: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!state) return null;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(state)) out[key] = '[redacted]';
  return Object.keys(out).length > 0 ? out : null;
}

// Generic guard retained for HR resource types that do not yet have a
// field-by-field projection (for example a future hr_document event).
// People and Teams do NOT use this blacklist; their explicit policies
// below are fail-closed, with every unclassified key redacted by default.
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

function legacyRedactState(
  state: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!state) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    out[key] = FORBIDDEN_STATE_KEYS.has(key.toLowerCase()) ? '[redacted]' : value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function policyForResource(resourceType: string): AuditFieldPolicy | null {
  if (resourceType === 'hr_person') return HR_PERSON_AUDIT_POLICY;
  if (resourceType === 'hr_team') return HR_TEAM_AUDIT_POLICY;
  if (resourceType === 'hr_restricted_case') return HR_RESTRICTED_CASE_AUDIT_POLICY;
  if (resourceType === 'hr_restricted_case_access') return HR_RESTRICTED_CASE_ACCESS_AUDIT_POLICY;
  if (resourceType === 'hr_restricted_case_participant') return HR_RESTRICTED_CASE_PARTICIPANT_AUDIT_POLICY;
  if (resourceType === 'hr_restricted_case_note') return HR_RESTRICTED_CASE_NOTE_AUDIT_POLICY;
  if (resourceType === 'hr_restricted_case_document') return HR_RESTRICTED_CASE_DOCUMENT_AUDIT_POLICY;
  if (resourceType === 'hr_lifecycle_template') return HR_LIFECYCLE_TEMPLATE_AUDIT_POLICY;
  if (resourceType === 'hr_lifecycle_workflow') return HR_LIFECYCLE_WORKFLOW_AUDIT_POLICY;
  if (resourceType === 'hr_lifecycle_task') return HR_LIFECYCLE_TASK_AUDIT_POLICY;
  if (resourceType === 'hr_lifecycle_task_approval') return HR_LIFECYCLE_TASK_APPROVAL_AUDIT_POLICY;
  if (resourceType === 'hr_employee_document') return HR_EMPLOYEE_DOCUMENT_AUDIT_POLICY;
  if (resourceType === 'hr_employee_document_version') return HR_EMPLOYEE_DOCUMENT_VERSION_AUDIT_POLICY;
  return null;
}

function projectHrAuditState(
  resourceType: string,
  state: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!state) return null;

  const policy = policyForResource(resourceType);
  if (!policy) {
    if (
      resourceType.startsWith('hr_restricted_')
      || resourceType.startsWith('hr_lifecycle_')
      || resourceType.startsWith('hr_employee_document')
    ) {
      return redactAllState(state);
    }
    return legacyRedactState(state);
  }

  const projected: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(state)) {
    if (policy.omitted.has(key)) {
      continue;
    }

    if (policy.allowed.has(key)) {
      projected[key] = value;
      continue;
    }

    if (policy.idOnly.has(key)) {
      projected[key] = typeof value === 'string' || value === null
        ? value
        : '[redacted]';
      continue;
    }

    if (policy.redacted.has(key)) {
      projected[key] = '[redacted]';
      continue;
    }

    // FAIL CLOSED: a newly-added HR People/Teams field must never start
    // writing its raw value to audit_logs merely because a route includes
    // it in beforeState/afterState. It stays visible as "changed", but its
    // value remains protected until explicitly classified above.
    projected[key] = '[redacted]';
  }

  return Object.keys(projected).length > 0 ? projected : null;
}

/**
 * Writes one HR audit entry to audit_logs. Best-effort / non-transactional,
 * per ADR-0003 §3 & §11: every current HR mutation covered here is
 * human-initiated and already gated by session/role/capability checks
 * before the business-state write runs, so a dropped audit write afterward
 * does not retroactively make the action ambiguous. A write failure is
 * caught, logged via console.error, and MUST NOT propagate to (or fail)
 * the caller's own mutation.
 *
 * hr_person and hr_team payloads are projected through explicit,
 * resource-specific allowlists. Unknown future fields fail closed to
 * "[redacted]" rather than passing through raw.
 */
async function writeHrAuditEvent(actor: HrAuditActor, entry: HrAuditEntry): Promise<void> {
  const before = projectHrAuditState(entry.resourceType, entry.beforeState);
  const after = projectHrAuditState(entry.resourceType, entry.afterState);

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
}

export async function logHrEvent(actor: HrAuditActor, entry: HrAuditEntry): Promise<void> {
  try {
    await writeHrAuditEvent(actor, entry);
  } catch (err) {
    console.error(
      '[hr audit] audit_logs write failed (ignored, per ADR-0003 §11 — the underlying mutation remains valid)',
      err,
      { action: entry.action, resourceType: entry.resourceType, resourceId: entry.resourceId },
    );
  }
}

/**
 * Restricted-HR reads fail closed: sensitive case data must not be returned
 * unless its audit row is durably written. Unlike logHrEvent(), this helper
 * deliberately propagates audit storage failures to the route.
 */
export async function logRestrictedHrReadEvent(
  actor: HrAuditActor,
  entry: HrAuditEntry,
): Promise<void> {
  if (!RESTRICTED_HR_READ_EVENTS.has(`${entry.resourceType}:${entry.action}`)) {
    throw new Error('logRestrictedHrReadEvent only accepts approved restricted-HR read events.');
  }
  await writeHrAuditEvent(actor, entry);
}
