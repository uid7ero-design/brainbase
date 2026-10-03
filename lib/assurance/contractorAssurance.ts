import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import type { AssuranceTimestamp } from './sqlHelpers';
import { withFreshReference } from './references';
import { assertSameOrgUsers } from './users';
import { EVIDENCE_TYPES } from './domain';
import {
  REQUIREMENT_CATEGORIES, REQUIREMENT_CODE_PATTERN, RENEWAL_NOTICE_DAYS_MAX, SCOPE_STATUSES, SUBMISSION_DECISIONS,
  assignmentState, isIsoDate, organisationHeadline, todayIn,
  type AssignmentState, type AssignmentStatus, type OrganisationHeadline, type RequirementCategory,
  type RequirementStatus, type ScopeStatus, type SubmissionStatus,
} from './contractorAssuranceRules';
import { getAssuranceTimeZone } from './deadlines';
import { isUuid, optionalBoolean, optionalText, optionalUserId, requiredEnum, requiredText } from './input';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from './errors';

// Contractor assurance (A0.1G).
//
// Assurance state AROUND shared BrainBase records: external organisations
// stay canonical (never copied or redefined as "contractors"); evidence is a
// shared assurance_evidence row; Findings and Actions use the existing
// Finding → Action → Organiser path.
//
// The database enforces the lifecycle (A0.1G triggers): one ACTIVE
// assignment per requirement, assignment preconditions, record-time
// requirement snapshots, immutable submission content, one ACCEPTED
// submission per assignment with atomic supersession, and recorder ≠
// decider. This service adds permissions, tenant scoping, input validation,
// lock-then-guard concurrency and the audit row written in the same
// statement as each change.

const ORG_SCOPE_RESOURCE = 'assurance_external_organisation_scope';
const REQUIREMENT_RESOURCE = 'assurance_requirement';
const ASSIGNMENT_RESOURCE = 'assurance_requirement_assignment';
const EVIDENCE_RESOURCE = 'assurance_contractor_evidence';

// ── Input helpers ────────────────────────────────────────────────────────

function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (!isIsoDate(value)) throw new AssuranceValidationError(`${field} must be a date.`);
  return value;
}
function requiredDate(value: unknown, field: string): string {
  const d = optionalDate(value, field);
  if (!d) throw new AssuranceValidationError(`${field} is required.`);
  return d;
}
function requiredLockVersion(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new AssuranceValidationError('Reload the page and try again.');
  return n;
}
function optionalNoticeDays(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > RENEWAL_NOTICE_DAYS_MAX) {
    throw new AssuranceValidationError(`Renewal notice must be a whole number of days from 1 to ${RENEWAL_NOTICE_DAYS_MAX}, or blank for none.`);
  }
  return n;
}
function optionalOrder(value: unknown): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 9999) throw new AssuranceValidationError('Display order must be a whole number from 0 to 9999.');
  return n;
}
function requireUuid(value: unknown, what: string): string {
  if (!isUuid(value)) throw new AssuranceNotFoundError(what);
  return String(value).toLowerCase();
}

/** Maps A0.1G trigger/constraint errors to user-facing service errors. */
function mapDbError(err: unknown): never {
  const e = err as { code?: string; constraint?: string; message?: string };
  const text = `${e.constraint ?? ''} ${e.message ?? ''}`;
  if (e.code === 'CA002') throw new AssuranceConflictError(`${(e.message ?? 'That change is not allowed now').replace(/\.?$/, '.')}`);
  if (e.code === 'CA003') throw new AssuranceConflictError('Someone else changed this since you opened it. Reload and try again.');
  if (e.code === 'CA001') throw new AssuranceConflictError('This record changed while you were working. Reload and try again.');
  if (e.code === '23505') {
    if (/one_active/.test(text)) throw new AssuranceConflictError('This requirement is already assigned to this organisation.');
    if (/one_accepted/.test(text)) throw new AssuranceConflictError('Another decision was recorded at the same time. Reload and try again.');
    if (/org_code_key/.test(text)) throw new AssuranceConflictError('A requirement with that code already exists.');
    if (/org_external_org_key/.test(text)) throw new AssuranceConflictError('This organisation already has an Assurance scope record.');
  }
  if (e.code === '23514' && /independent_decision/.test(text)) {
    throw new AssuranceForbiddenError('You recorded this evidence, so someone else must accept or reject it.');
  }
  throw err;
}

function lastResult<T>(results: unknown): T[] {
  const all = results as unknown[][];
  return (all[all.length - 1] ?? []) as T[];
}

// ── Requirement library ──────────────────────────────────────────────────

export type RequirementRow = {
  id: string; requirement_code: string; name: string; description: string | null; category: RequirementCategory;
  evidence_guidance: string | null; expiry_required: boolean; renewal_notice_days: number | null;
  status: RequirementStatus; display_order: number; lock_version: number; updated_at: AssuranceTimestamp;
  active_assignment_count: number; assignment_count: number;
};

export async function listRequirements(viewer: AssuranceViewer): Promise<RequirementRow[]> {
  return (await sql`
    SELECT r.id, r.requirement_code, r.name, r.description, r.category, r.evidence_guidance, r.expiry_required,
           r.renewal_notice_days, r.status, r.display_order, r.lock_version, r.updated_at,
           (SELECT count(*) FROM assurance_requirement_assignments a
             WHERE a.organisation_id = r.organisation_id AND a.requirement_id = r.id AND a.status = 'ACTIVE')::int AS active_assignment_count,
           (SELECT count(*) FROM assurance_requirement_assignments a
             WHERE a.organisation_id = r.organisation_id AND a.requirement_id = r.id)::int AS assignment_count
    FROM assurance_requirements r
    WHERE r.organisation_id = ${viewer.organisationId}
    ORDER BY (r.status = 'ACTIVE') DESC, r.display_order, r.name
  `) as RequirementRow[];
}

function requirementInput(raw: Record<string, unknown>) {
  return {
    name: requiredText(raw.name, 'Name', 200),
    description: optionalText(raw.description, 'Description', 2000),
    category: requiredEnum(REQUIREMENT_CATEGORIES, raw.category, 'Category'),
    evidenceGuidance: optionalText(raw.evidenceGuidance, 'Evidence guidance', 2000),
    expiryRequired: optionalBoolean(raw.expiryRequired, false),
    renewalNoticeDays: optionalNoticeDays(raw.renewalNoticeDays),
    displayOrder: optionalOrder(raw.displayOrder),
  };
}

export async function createRequirement(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ id: string }> {
  if (!viewerCan(viewer, 'administer')) throw new AssuranceForbiddenError('Only organisation admins can manage the requirement library.');
  const code = requiredText(raw.requirementCode, 'Code', 40).toUpperCase().replace(/\s+/g, '-');
  if (!REQUIREMENT_CODE_PATTERN.test(code)) {
    throw new AssuranceValidationError('Code must start with a letter or number and use only letters, numbers, - or _ (up to 40).');
  }
  const input = requirementInput(raw);
  const id = crypto.randomUUID();
  try {
    await sql.transaction([
      sql`
        INSERT INTO assurance_requirements (id, organisation_id, requirement_code, name, description, category, evidence_guidance,
                                            expiry_required, renewal_notice_days, display_order, created_by, updated_by)
        VALUES (${id}::uuid, ${viewer.organisationId}, ${code}, ${input.name}, ${input.description}, ${input.category}, ${input.evidenceGuidance},
                ${input.expiryRequired}, ${input.renewalNoticeDays}::int, ${input.displayOrder}::int, ${viewer.userId}, ${viewer.userId})
      `,
      sql`
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        VALUES (${crypto.randomUUID()}, ${viewer.organisationId}, ${viewer.userId}, ${`${REQUIREMENT_RESOURCE}.created`}, ${REQUIREMENT_RESOURCE}, ${id},
                NULL, ${JSON.stringify({ requirement_code: code, category: input.category, expiry_required: input.expiryRequired,
                  renewal_notice_days: input.renewalNoticeDays, status: 'ACTIVE' })}::jsonb)
      `,
    ]);
  } catch (err) {
    mapDbError(err);
  }
  return { id };
}

export async function updateRequirement(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<{ lock_version: number }> {
  if (!viewerCan(viewer, 'administer')) throw new AssuranceForbiddenError('Only organisation admins can manage the requirement library.');
  id = requireUuid(id, 'Requirement');
  const lockVersion = requiredLockVersion(raw.lockVersion);
  const input = requirementInput(raw);
  let results: unknown;
  try {
    results = await sql.transaction([
      sql`
        WITH prev AS (
          SELECT name, description, category, evidence_guidance, expiry_required, renewal_notice_days, display_order
          FROM assurance_requirements WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid
        ), upd AS (
          UPDATE assurance_requirements r
             SET name = ${input.name}, description = ${input.description}, category = ${input.category},
                 evidence_guidance = ${input.evidenceGuidance}, expiry_required = ${input.expiryRequired},
                 renewal_notice_days = ${input.renewalNoticeDays}::int, display_order = ${input.displayOrder}::int,
                 updated_by = ${viewer.userId}, lock_version = r.lock_version + 1
           WHERE r.organisation_id = ${viewer.organisationId} AND r.id = ${id}::uuid AND r.lock_version = ${lockVersion}::int
          RETURNING r.id, r.lock_version, r.requirement_code
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, ${`${REQUIREMENT_RESOURCE}.updated`}, ${REQUIREMENT_RESOURCE},
                 upd.id::text, NULL,
                 jsonb_build_object('requirement_code', upd.requirement_code, 'lock_version', upd.lock_version,
                   'changed', (SELECT jsonb_agg(f) FROM (VALUES
                     ('name', prev.name IS DISTINCT FROM ${input.name}),
                     ('description', prev.description IS DISTINCT FROM ${input.description}::text),
                     ('category', prev.category IS DISTINCT FROM ${input.category}),
                     ('evidence_guidance', prev.evidence_guidance IS DISTINCT FROM ${input.evidenceGuidance}::text),
                     ('expiry_required', prev.expiry_required IS DISTINCT FROM ${input.expiryRequired}),
                     ('renewal_notice_days', prev.renewal_notice_days IS DISTINCT FROM ${input.renewalNoticeDays}::int),
                     ('display_order', prev.display_order IS DISTINCT FROM ${input.displayOrder}::int)) AS c(f, changed) WHERE changed),
                   'renewal_notice_days', ${input.renewalNoticeDays}::int, 'expiry_required', ${input.expiryRequired}::boolean)
          FROM upd, prev
        )
        SELECT id, lock_version FROM upd
      `,
    ]);
  } catch (err) {
    mapDbError(err);
  }
  const row = lastResult<{ id: string; lock_version: number }>(results)[0];
  if (!row) await explainRequirement(viewer, id);
  return { lock_version: row.lock_version };
}

async function explainRequirement(viewer: AssuranceViewer, id: string): Promise<never> {
  const r = (await sql`SELECT 1 FROM assurance_requirements WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid`) as unknown[];
  if (r.length === 0) throw new AssuranceNotFoundError('Requirement');
  throw new AssuranceConflictError('Someone else changed this requirement since you opened it. Reload and try again.');
}

/** ACTIVE ↔ INACTIVE. Deactivation stops NEW assignments only; existing assignments and history are untouched. */
export async function setRequirementStatus(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<{ status: RequirementStatus }> {
  if (!viewerCan(viewer, 'administer')) throw new AssuranceForbiddenError('Only organisation admins can manage the requirement library.');
  id = requireUuid(id, 'Requirement');
  const status = requiredEnum(['ACTIVE', 'INACTIVE'] as const, raw.status, 'Status');
  const lockVersion = requiredLockVersion(raw.lockVersion);
  const verb = status === 'INACTIVE' ? 'deactivated' : 'reactivated';
  let results: unknown;
  try {
    results = await sql.transaction([
      sql`
        WITH upd AS (
          UPDATE assurance_requirements r
             SET status = ${status},
                 deactivated_at = CASE WHEN ${status} = 'INACTIVE' THEN now() ELSE NULL END,
                 deactivated_by = CASE WHEN ${status} = 'INACTIVE' THEN ${viewer.userId} ELSE NULL END,
                 updated_by = ${viewer.userId}, lock_version = r.lock_version + 1
           WHERE r.organisation_id = ${viewer.organisationId} AND r.id = ${id}::uuid
             AND r.lock_version = ${lockVersion}::int AND r.status <> ${status}
          RETURNING r.id, r.requirement_code, r.lock_version
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, ${`${REQUIREMENT_RESOURCE}.${verb}`}, ${REQUIREMENT_RESOURCE},
                 upd.id::text, NULL, jsonb_build_object('requirement_code', upd.requirement_code, 'status', ${status}::text)
          FROM upd
        )
        SELECT id FROM upd
      `,
    ]);
  } catch (err) {
    mapDbError(err);
  }
  if (!lastResult(results)[0]) await explainRequirement(viewer, id);
  return { status };
}

// ── Scope ────────────────────────────────────────────────────────────────

/**
 * Adds a shared external organisation to Assurance scope, or changes an
 * existing scope record (IN_SCOPE ↔ OUT_OF_SCOPE, responsible person,
 * notes). Moving out of scope never cancels assignments or touches history.
 */
export async function setOrganisationScope(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ external_organisation_id: string; lock_version: number }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const externalOrganisationId = requireUuid(raw.externalOrganisationId, 'External organisation');
  const status = raw.status === undefined ? 'IN_SCOPE' : requiredEnum(SCOPE_STATUSES, raw.status, 'Scope');
  const responsibleUserId = optionalUserId(raw.responsibleUserId, 'Responsible person');
  const notes = optionalText(raw.notes, 'Notes', 2000);
  await assertSameOrgUsers(viewer.organisationId, [{ field: 'Responsible person', userId: responsibleUserId }]);

  const existing = (await sql`
    SELECT s.id, s.lock_version FROM assurance_external_organisation_scopes s
    WHERE s.organisation_id = ${viewer.organisationId} AND s.external_organisation_id = ${externalOrganisationId}::uuid
  `) as { id: string; lock_version: number }[];

  if (!existing[0]) {
    const org = (await sql`
      SELECT status FROM external_organisations WHERE organisation_id = ${viewer.organisationId} AND id = ${externalOrganisationId}::uuid
    `) as { status: string }[];
    if (!org[0]) throw new AssuranceNotFoundError('External organisation');
    if (org[0].status !== 'ACTIVE') throw new AssuranceConflictError('Only an active external organisation can be brought into Assurance scope.');
    const id = crypto.randomUUID();
    try {
      await sql.transaction([
        sql`
          INSERT INTO assurance_external_organisation_scopes (id, organisation_id, external_organisation_id, status, responsible_user_id, notes,
                                                              status_changed_by, created_by, updated_by)
          VALUES (${id}::uuid, ${viewer.organisationId}, ${externalOrganisationId}::uuid, ${status}, ${responsibleUserId}, ${notes},
                  ${viewer.userId}, ${viewer.userId}, ${viewer.userId})
        `,
        sql`
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          VALUES (${crypto.randomUUID()}, ${viewer.organisationId}, ${viewer.userId}, ${`${ORG_SCOPE_RESOURCE}.created`}, ${ORG_SCOPE_RESOURCE}, ${id},
                  NULL, ${JSON.stringify({ external_organisation_id: externalOrganisationId, status, responsible_user_id: responsibleUserId })}::jsonb)
        `,
      ]);
    } catch (err) {
      mapDbError(err);
    }
    return { external_organisation_id: externalOrganisationId, lock_version: 1 };
  }

  const lockVersion = requiredLockVersion(raw.lockVersion);
  let results: unknown;
  try {
    results = await sql.transaction([
      sql`
        WITH prev AS (
          SELECT status FROM assurance_external_organisation_scopes WHERE organisation_id = ${viewer.organisationId} AND id = ${existing[0].id}::uuid
        ), upd AS (
          UPDATE assurance_external_organisation_scopes s
             SET status = ${status}, responsible_user_id = ${responsibleUserId}, notes = ${notes},
                 status_changed_at = CASE WHEN s.status <> ${status} THEN now() ELSE s.status_changed_at END,
                 status_changed_by = CASE WHEN s.status <> ${status} THEN ${viewer.userId} ELSE s.status_changed_by END,
                 updated_by = ${viewer.userId}, lock_version = s.lock_version + 1
           WHERE s.organisation_id = ${viewer.organisationId} AND s.id = ${existing[0].id}::uuid AND s.lock_version = ${lockVersion}::int
          RETURNING s.id, s.lock_version
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId},
                 CASE WHEN prev.status = ${status} THEN ${`${ORG_SCOPE_RESOURCE}.updated`}
                      WHEN ${status} = 'IN_SCOPE' THEN ${`${ORG_SCOPE_RESOURCE}.brought_into_scope`}
                      ELSE ${`${ORG_SCOPE_RESOURCE}.removed_from_scope`} END,
                 ${ORG_SCOPE_RESOURCE}, upd.id::text,
                 jsonb_build_object('status', prev.status), jsonb_build_object('status', ${status}::text,
                   'external_organisation_id', ${externalOrganisationId}::text, 'responsible_user_id', ${responsibleUserId}::text)
          FROM upd, prev
        )
        SELECT id, lock_version FROM upd
      `,
    ]);
  } catch (err) {
    mapDbError(err);
  }
  const row = lastResult<{ id: string; lock_version: number }>(results)[0];
  if (!row) throw new AssuranceConflictError('Someone else changed this organisation\'s scope since you opened it. Reload and try again.');
  return { external_organisation_id: externalOrganisationId, lock_version: row.lock_version };
}

// ── Assignments ──────────────────────────────────────────────────────────

export async function createAssignment(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ id: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const externalOrganisationId = requireUuid(raw.externalOrganisationId, 'External organisation');
  const requirementId = requireUuid(raw.requirementId, 'Requirement');
  const input = {
    requiredFrom: optionalDate(raw.requiredFrom, 'Required from'),
    dueDate: optionalDate(raw.dueDate, 'Due date'),
    reviewerUserId: optionalUserId(raw.reviewerUserId, 'Reviewer'),
    notes: optionalText(raw.notes, 'Notes', 2000),
  };
  if (input.requiredFrom && input.dueDate && input.dueDate < input.requiredFrom) {
    throw new AssuranceValidationError('Due date cannot be before the required-from date.');
  }
  await assertSameOrgUsers(viewer.organisationId, [{ field: 'Reviewer', userId: input.reviewerUserId }]);
  // Non-disclosing existence checks (another organisation's ids look missing).
  const refs = (await sql`
    SELECT (SELECT 1 FROM external_organisations WHERE organisation_id = ${viewer.organisationId} AND id = ${externalOrganisationId}::uuid) AS org_ok,
           (SELECT 1 FROM assurance_requirements WHERE organisation_id = ${viewer.organisationId} AND id = ${requirementId}::uuid) AS req_ok
  `) as { org_ok: number | null; req_ok: number | null }[];
  if (!refs[0].org_ok) throw new AssuranceNotFoundError('External organisation');
  if (!refs[0].req_ok) throw new AssuranceNotFoundError('Requirement');

  const id = crypto.randomUUID();
  try {
    await sql.transaction([
      sql`
        INSERT INTO assurance_requirement_assignments (id, organisation_id, external_organisation_id, requirement_id, required_from, due_date,
                                                       reviewer_user_id, notes, created_by, updated_by)
        VALUES (${id}::uuid, ${viewer.organisationId}, ${externalOrganisationId}::uuid, ${requirementId}::uuid, ${input.requiredFrom}::date,
                ${input.dueDate}::date, ${input.reviewerUserId}, ${input.notes}, ${viewer.userId}, ${viewer.userId})
      `,
      sql`
        INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
        SELECT ${crypto.randomUUID()}, ${viewer.organisationId}, ${viewer.userId}, ${`${ASSIGNMENT_RESOURCE}.created`}, ${ASSIGNMENT_RESOURCE}, ${id},
               NULL, jsonb_build_object('external_organisation_id', ${externalOrganisationId}::text, 'requirement_id', ${requirementId}::text,
                 'requirement_code', r.requirement_code, 'status', 'ACTIVE', 'due_date', ${input.dueDate}::text)
        FROM assurance_requirements r WHERE r.organisation_id = ${viewer.organisationId} AND r.id = ${requirementId}::uuid
      `,
    ]);
  } catch (err) {
    mapDbError(err);
  }
  return { id };
}

type AssignmentRef = { id: string; external_organisation_id: string; status: AssignmentStatus; lock_version: number };

async function loadAssignment(viewer: AssuranceViewer, id: string): Promise<AssignmentRef> {
  const rows = (await sql`
    SELECT id, external_organisation_id, status, lock_version FROM assurance_requirement_assignments
    WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid
  `) as AssignmentRef[];
  if (!rows[0]) throw new AssuranceNotFoundError('Requirement assignment');
  return rows[0];
}

function lockAssignment(viewer: AssuranceViewer, id: string) {
  return sql`SELECT id FROM assurance_requirement_assignments WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid FOR UPDATE`;
}

export async function updateAssignment(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<{ lock_version: number }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  id = requireUuid(id, 'Requirement assignment');
  const lockVersion = requiredLockVersion(raw.lockVersion);
  const input = {
    requiredFrom: optionalDate(raw.requiredFrom, 'Required from'),
    dueDate: optionalDate(raw.dueDate, 'Due date'),
    reviewerUserId: optionalUserId(raw.reviewerUserId, 'Reviewer'),
    notes: optionalText(raw.notes, 'Notes', 2000),
  };
  if (input.requiredFrom && input.dueDate && input.dueDate < input.requiredFrom) {
    throw new AssuranceValidationError('Due date cannot be before the required-from date.');
  }
  await assertSameOrgUsers(viewer.organisationId, [{ field: 'Reviewer', userId: input.reviewerUserId }]);
  const current = await loadAssignment(viewer, id);
  if (current.status !== 'ACTIVE') throw new AssuranceConflictError('A cancelled assignment cannot change.');
  let results: unknown;
  try {
    results = await sql.transaction([
      lockAssignment(viewer, id),
      sql`
        WITH upd AS (
          UPDATE assurance_requirement_assignments a
             SET required_from = ${input.requiredFrom}::date, due_date = ${input.dueDate}::date,
                 reviewer_user_id = ${input.reviewerUserId}, notes = ${input.notes},
                 updated_by = ${viewer.userId}, lock_version = a.lock_version + 1
           WHERE a.organisation_id = ${viewer.organisationId} AND a.id = ${id}::uuid
             AND a.status = 'ACTIVE' AND a.lock_version = ${lockVersion}::int
          RETURNING a.id, a.lock_version
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, ${`${ASSIGNMENT_RESOURCE}.updated`}, ${ASSIGNMENT_RESOURCE},
                 upd.id::text, NULL, jsonb_build_object('lock_version', upd.lock_version, 'due_date', ${input.dueDate}::text,
                   'required_from', ${input.requiredFrom}::text, 'reviewer_user_id', ${input.reviewerUserId}::text)
          FROM upd
        )
        SELECT id, lock_version FROM upd
      `,
    ]);
  } catch (err) {
    mapDbError(err);
  }
  const row = lastResult<{ id: string; lock_version: number }>(results)[0];
  if (!row) throw new AssuranceConflictError('Someone else changed this assignment since you opened it. Reload and try again.');
  return { lock_version: row.lock_version };
}

/** Cancels an assignment (with a reason). Its evidence and decisions stay as history. */
export async function cancelAssignment(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<void> {
  if (!viewerCan(viewer, 'close')) throw new AssuranceForbiddenError();
  id = requireUuid(id, 'Requirement assignment');
  const reason = requiredText(raw.reason, 'Reason', 2000);
  const lockVersion = requiredLockVersion(raw.lockVersion);
  await loadAssignment(viewer, id);
  let results: unknown;
  try {
    results = await sql.transaction([
      lockAssignment(viewer, id),
      sql`
        WITH upd AS (
          UPDATE assurance_requirement_assignments a
             SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = ${viewer.userId}, cancel_reason = ${reason},
                 updated_by = ${viewer.userId}, lock_version = a.lock_version + 1
           WHERE a.organisation_id = ${viewer.organisationId} AND a.id = ${id}::uuid
             AND a.status = 'ACTIVE' AND a.lock_version = ${lockVersion}::int
          RETURNING a.id
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, ${`${ASSIGNMENT_RESOURCE}.cancelled`}, ${ASSIGNMENT_RESOURCE},
                 upd.id::text, jsonb_build_object('status', 'ACTIVE'), jsonb_build_object('status', 'CANCELLED')
          FROM upd
        )
        SELECT id FROM upd
      `,
    ]);
  } catch (err) {
    mapDbError(err);
  }
  if (!lastResult(results)[0]) throw new AssuranceConflictError('This assignment was already cancelled or changed. Reload and try again.');
}

// ── Evidence submissions ─────────────────────────────────────────────────

/**
 * Records evidence supplied for an assignment: a shared assurance_evidence
 * row (reference, title, description, where the document is held) plus a
 * SUBMITTED submission. The requirement snapshot is taken by the database.
 */
export async function recordSubmission(viewer: AssuranceViewer, assignmentId: string, raw: Record<string, unknown>): Promise<{ id: string; evidence_id: string; evidence_reference: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  assignmentId = requireUuid(assignmentId, 'Requirement assignment');
  const input = {
    evidenceType: raw.evidenceType === undefined || raw.evidenceType === null || raw.evidenceType === ''
      ? 'DOCUMENT' : requiredEnum(EVIDENCE_TYPES, raw.evidenceType, 'Evidence type'),
    title: requiredText(raw.title, 'Title', 200),
    description: optionalText(raw.description, 'Description', 4000),
    heldAt: optionalText(raw.heldAt, 'Document location or link', 500),
    suppliedOn: requiredDate(raw.suppliedOn, 'Supplied on'),
    effectiveFrom: optionalDate(raw.effectiveFrom, 'Effective from'),
    expiresOn: optionalDate(raw.expiresOn, 'Expires on'),
    notes: optionalText(raw.notes, 'Notes', 2000),
  };
  if (input.effectiveFrom && input.expiresOn && input.expiresOn < input.effectiveFrom) {
    throw new AssuranceValidationError('Expiry cannot be before the effective date.');
  }
  await loadAssignment(viewer, assignmentId);
  const metadata: Record<string, string> = { source: 'contractor_assurance' };
  if (input.heldAt) metadata.held_at = input.heldAt;
  const evidenceId = crypto.randomUUID();
  const submissionId = crypto.randomUUID();
  try {
    return await withFreshReference('evidence', async reference => {
      await sql.transaction([
        lockAssignment(viewer, assignmentId),
        sql`
          INSERT INTO assurance_evidence (id, organisation_id, evidence_reference, evidence_type, title, description, captured_by, captured_at, metadata, created_by)
          VALUES (${evidenceId}::uuid, ${viewer.organisationId}, ${reference}, ${input.evidenceType}, ${input.title}, ${input.description},
                  ${viewer.userId}, now(), ${JSON.stringify(metadata)}::jsonb, ${viewer.userId})
        `,
        sql`
          INSERT INTO assurance_requirement_submissions (id, organisation_id, assignment_id, evidence_id, supplied_on, effective_from, expires_on, notes, recorded_by)
          VALUES (${submissionId}::uuid, ${viewer.organisationId}, ${assignmentId}::uuid, ${evidenceId}::uuid, ${input.suppliedOn}::date,
                  ${input.effectiveFrom}::date, ${input.expiresOn}::date, ${input.notes}, ${viewer.userId})
        `,
        sql`
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          VALUES (${crypto.randomUUID()}, ${viewer.organisationId}, ${viewer.userId}, 'assurance_evidence.created', 'assurance_evidence', ${evidenceId},
                  NULL, ${JSON.stringify({ evidence_reference: reference, evidence_type: input.evidenceType, link_target: 'requirement_submission', link_target_id: submissionId })}::jsonb)
        `,
        sql`
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT ${crypto.randomUUID()}, ${viewer.organisationId}, ${viewer.userId}, ${`${EVIDENCE_RESOURCE}.recorded`}, ${EVIDENCE_RESOURCE}, ${submissionId},
                 NULL, jsonb_build_object('assignment_id', s.assignment_id, 'evidence_id', s.evidence_id, 'evidence_reference', ${reference}::text,
                   'requirement_code', s.requirement_code_snapshot, 'status', s.status, 'supplied_on', s.supplied_on, 'expires_on', s.expires_on)
          FROM assurance_requirement_submissions s WHERE s.organisation_id = ${viewer.organisationId} AND s.id = ${submissionId}::uuid
        `,
      ]);
      return { id: submissionId, evidence_id: evidenceId, evidence_reference: reference };
    });
  } catch (err) {
    mapDbError(err);
  }
}

type SubmissionRef = { id: string; assignment_id: string; status: SubmissionStatus; recorded_by: string; lock_version: number };

async function loadSubmission(viewer: AssuranceViewer, id: string): Promise<SubmissionRef> {
  const rows = (await sql`
    SELECT id, assignment_id, status, recorded_by, lock_version FROM assurance_requirement_submissions
    WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid
  `) as SubmissionRef[];
  if (!rows[0]) throw new AssuranceNotFoundError('Evidence submission');
  return rows[0];
}

/**
 * Accept or reject a SUBMITTED submission ('verify' permission). The person
 * who recorded it cannot decide on it (also enforced by the database).
 * Accepting supersedes the previous current evidence in the same statement;
 * rejecting leaves it current.
 */
export async function decideSubmission(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<{ status: SubmissionStatus; superseded_submission_id: string | null }> {
  if (!viewerCan(viewer, 'verify')) throw new AssuranceForbiddenError();
  id = requireUuid(id, 'Evidence submission');
  const decision = requiredEnum(SUBMISSION_DECISIONS, raw.decision, 'Decision');
  const reason = decision === 'REJECT' ? requiredText(raw.reason, 'Reason', 2000) : optionalText(raw.reason, 'Reason', 2000);
  const lockVersion = requiredLockVersion(raw.lockVersion);
  const sub = await loadSubmission(viewer, id);
  if (sub.recorded_by === viewer.userId) {
    throw new AssuranceForbiddenError('You recorded this evidence, so someone else must accept or reject it.');
  }
  if (sub.status !== 'SUBMITTED') throw new AssuranceConflictError(`This evidence was already ${sub.status.toLowerCase()}.`);
  const status: SubmissionStatus = decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
  let results: unknown;
  try {
    results = await sql.transaction([
      lockAssignment(viewer, sub.assignment_id),
      sql`
        WITH prev AS (
          SELECT id FROM assurance_requirement_submissions
          WHERE organisation_id = ${viewer.organisationId} AND assignment_id = ${sub.assignment_id}::uuid AND status = 'ACCEPTED'
        ), upd AS (
          UPDATE assurance_requirement_submissions s
             SET status = ${status}, decided_by = ${viewer.userId}, decided_at = now(), decision_reason = ${reason},
                 lock_version = s.lock_version + 1
           WHERE s.organisation_id = ${viewer.organisationId} AND s.id = ${id}::uuid
             AND s.status = 'SUBMITTED' AND s.lock_version = ${lockVersion}::int
          RETURNING s.id, s.assignment_id, s.requirement_code_snapshot, s.expires_on
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId},
                 ${`${EVIDENCE_RESOURCE}.${decision === 'ACCEPT' ? 'accepted' : 'rejected'}`}, ${EVIDENCE_RESOURCE}, upd.id::text,
                 jsonb_build_object('status', 'SUBMITTED'),
                 jsonb_build_object('status', ${status}::text, 'assignment_id', upd.assignment_id, 'requirement_code', upd.requirement_code_snapshot,
                   'expires_on', upd.expires_on, 'superseded_submission_id', CASE WHEN ${status} = 'ACCEPTED' THEN (SELECT id FROM prev) END)
          FROM upd
        ), sup AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, ${`${EVIDENCE_RESOURCE}.superseded`}, ${EVIDENCE_RESOURCE}, prev.id::text,
                 jsonb_build_object('status', 'ACCEPTED'), jsonb_build_object('status', 'SUPERSEDED', 'superseded_by_submission_id', upd.id)
          FROM upd, prev WHERE ${status} = 'ACCEPTED'
        )
        SELECT upd.id, (SELECT id FROM prev) AS prev_id FROM upd
      `,
    ]);
  } catch (err) {
    mapDbError(err);
  }
  const row = lastResult<{ id: string; prev_id: string | null }>(results)[0];
  if (!row) throw new AssuranceConflictError('Someone else decided on or changed this evidence since you opened it. Reload and try again.');
  return { status, superseded_submission_id: status === 'ACCEPTED' ? row.prev_id : null };
}

/** Withdraws a SUBMITTED submission (e.g. sent in error). Not a decision; the recorder may withdraw. */
export async function withdrawSubmission(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<void> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  id = requireUuid(id, 'Evidence submission');
  const reason = optionalText(raw.reason, 'Reason', 2000);
  const lockVersion = requiredLockVersion(raw.lockVersion);
  const sub = await loadSubmission(viewer, id);
  let results: unknown;
  try {
    results = await sql.transaction([
      lockAssignment(viewer, sub.assignment_id),
      sql`
        WITH upd AS (
          UPDATE assurance_requirement_submissions s
             SET status = 'WITHDRAWN', decided_by = ${viewer.userId}, decided_at = now(), decision_reason = ${reason},
                 lock_version = s.lock_version + 1
           WHERE s.organisation_id = ${viewer.organisationId} AND s.id = ${id}::uuid
             AND s.status = 'SUBMITTED' AND s.lock_version = ${lockVersion}::int
          RETURNING s.id, s.assignment_id
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, ${`${EVIDENCE_RESOURCE}.withdrawn`}, ${EVIDENCE_RESOURCE},
                 upd.id::text, jsonb_build_object('status', 'SUBMITTED'), jsonb_build_object('status', 'WITHDRAWN', 'assignment_id', upd.assignment_id)
          FROM upd
        )
        SELECT id FROM upd
      `,
    ]);
  } catch (err) {
    mapDbError(err);
  }
  if (!lastResult(results)[0]) throw new AssuranceConflictError('This evidence was already decided or changed. Reload and try again.');
}

// ── Reads: register and organisation detail ──────────────────────────────

type RawAssignmentFact = {
  id: string; external_organisation_id: string; renewal_notice_days: number | null;
  accepted_id: string | null; accepted_expires_on: string | null; pending_count: number;
};

async function assignmentFacts(viewer: AssuranceViewer, externalOrganisationId: string | null) {
  return (await sql`
    SELECT a.id, a.external_organisation_id, r.renewal_notice_days,
           acc.id AS accepted_id, acc.expires_on::text AS accepted_expires_on,
           (SELECT count(*) FROM assurance_requirement_submissions p
             WHERE p.organisation_id = a.organisation_id AND p.assignment_id = a.id AND p.status = 'SUBMITTED')::int AS pending_count
    FROM assurance_requirement_assignments a
    JOIN assurance_requirements r ON r.organisation_id = a.organisation_id AND r.id = a.requirement_id
    LEFT JOIN assurance_requirement_submissions acc
      ON acc.organisation_id = a.organisation_id AND acc.assignment_id = a.id AND acc.status = 'ACCEPTED'
    WHERE a.organisation_id = ${viewer.organisationId} AND a.status = 'ACTIVE'
      AND (${externalOrganisationId}::uuid IS NULL OR a.external_organisation_id = ${externalOrganisationId}::uuid)
  `) as RawAssignmentFact[];
}

export type StateCounts = Record<AssignmentState, number>;
const emptyCounts = (): StateCounts => ({ EXPIRED: 0, EXPIRING_SOON: 0, CURRENT: 0, MISSING: 0 });

export type RegisterView = 'attention' | 'expired' | 'expiring' | 'review' | 'missing' | 'current' | 'all' | 'out_of_scope';

export type RegisterRow = {
  external_organisation_id: string; reference: string; name: string; organisation_status: string; roles: string[];
  scope_status: ScopeStatus; responsible_name: string | null; scope_changed_at: AssuranceTimestamp;
  assignment_count: number; counts: StateCounts; awaiting_review: number; headline: OrganisationHeadline;
  last_reviewed_at: AssuranceTimestamp | null;
};

export async function listContractorRegister(viewer: AssuranceViewer, opts: { view?: RegisterView; q?: string | null } = {}): Promise<{ rows: RegisterRow[]; today: string; timeZone: string; totals: { inScope: number; outOfScope: number; externalOrganisations: number } }> {
  const view = opts.view ?? 'attention';
  const q = opts.q && opts.q.trim() ? `%${opts.q.trim().replace(/[\\%_]/g, m => `\\${m}`)}%` : null;
  const timeZone = await getAssuranceTimeZone(viewer.organisationId);
  const today = todayIn(timeZone);
  const [orgs, facts, totals] = await Promise.all([
    sql`
      SELECT eo.id AS external_organisation_id, eo.reference, eo.name, eo.status AS organisation_status,
             COALESCE((SELECT array_agg(r.role ORDER BY r.role) FROM external_organisation_roles r
                        WHERE r.organisation_id = eo.organisation_id AND r.external_organisation_id = eo.id AND r.active), ARRAY[]::text[]) AS roles,
             s.status AS scope_status, u.name AS responsible_name, s.status_changed_at AS scope_changed_at,
             (SELECT max(sub.decided_at) FROM assurance_requirement_submissions sub
               JOIN assurance_requirement_assignments a ON a.organisation_id = sub.organisation_id AND a.id = sub.assignment_id
              WHERE sub.organisation_id = eo.organisation_id AND a.external_organisation_id = eo.id
                AND sub.status IN ('ACCEPTED','REJECTED','SUPERSEDED')) AS last_reviewed_at
      FROM assurance_external_organisation_scopes s
      JOIN external_organisations eo ON eo.organisation_id = s.organisation_id AND eo.id = s.external_organisation_id
      LEFT JOIN users u ON u.id = s.responsible_user_id AND u.organisation_id = s.organisation_id
      WHERE s.organisation_id = ${viewer.organisationId}
        AND (${q}::text IS NULL OR eo.name ILIKE ${q} OR eo.reference ILIKE ${q})
      ORDER BY eo.name
    `,
    assignmentFacts(viewer, null),
    sql`
      SELECT (SELECT count(*) FROM assurance_external_organisation_scopes WHERE organisation_id = ${viewer.organisationId} AND status = 'IN_SCOPE')::int AS in_scope,
             (SELECT count(*) FROM assurance_external_organisation_scopes WHERE organisation_id = ${viewer.organisationId} AND status = 'OUT_OF_SCOPE')::int AS out_of_scope,
             (SELECT count(*) FROM external_organisations WHERE organisation_id = ${viewer.organisationId})::int AS external_organisations
    `,
  ]);
  const byOrg = new Map<string, RawAssignmentFact[]>();
  for (const f of facts) byOrg.set(f.external_organisation_id, [...(byOrg.get(f.external_organisation_id) ?? []), f]);

  const rows = (orgs as Omit<RegisterRow, 'assignment_count' | 'counts' | 'awaiting_review' | 'headline'>[]).map(o => {
    const list = byOrg.get(o.external_organisation_id) ?? [];
    const counts = emptyCounts();
    const states = list.map(f => assignmentState({
      hasAccepted: f.accepted_id !== null, acceptedExpiresOn: f.accepted_expires_on, renewalNoticeDays: f.renewal_notice_days, today,
    }));
    for (const s of states) counts[s] += 1;
    const awaiting = list.reduce((n, f) => n + f.pending_count, 0);
    return { ...o, assignment_count: list.length, counts, awaiting_review: awaiting, headline: organisationHeadline(states, awaiting) };
  });
  const t = (totals as { in_scope: number; out_of_scope: number; external_organisations: number }[])[0];
  const filtered = rows.filter(r => {
    if (view === 'out_of_scope') return r.scope_status === 'OUT_OF_SCOPE';
    if (r.scope_status !== 'IN_SCOPE') return false;
    switch (view) {
      case 'attention': return r.counts.EXPIRED + r.counts.MISSING + r.counts.EXPIRING_SOON + r.awaiting_review > 0;
      case 'expired': return r.counts.EXPIRED > 0;
      case 'expiring': return r.counts.EXPIRING_SOON > 0;
      case 'review': return r.awaiting_review > 0;
      case 'missing': return r.counts.MISSING > 0;
      case 'current': return r.headline === 'CURRENT';
      default: return true;
    }
  });
  return { rows: filtered, today, timeZone, totals: { inScope: t.in_scope, outOfScope: t.out_of_scope, externalOrganisations: t.external_organisations } };
}

/** Active external organisations not yet in the Assurance scope list (for "Add organisation"). */
export async function listScopeCandidates(viewer: AssuranceViewer): Promise<{ id: string; reference: string; name: string; roles: string[] }[]> {
  return (await sql`
    SELECT eo.id, eo.reference, eo.name,
           COALESCE((SELECT array_agg(r.role ORDER BY r.role) FROM external_organisation_roles r
                      WHERE r.organisation_id = eo.organisation_id AND r.external_organisation_id = eo.id AND r.active), ARRAY[]::text[]) AS roles
    FROM external_organisations eo
    WHERE eo.organisation_id = ${viewer.organisationId} AND eo.status = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM assurance_external_organisation_scopes s
                      WHERE s.organisation_id = eo.organisation_id AND s.external_organisation_id = eo.id)
    ORDER BY eo.name
  `) as { id: string; reference: string; name: string; roles: string[] }[];
}

export async function listActiveRequirementOptions(viewer: AssuranceViewer): Promise<{ id: string; requirement_code: string; name: string; category: RequirementCategory }[]> {
  return (await sql`
    SELECT id, requirement_code, name, category FROM assurance_requirements
    WHERE organisation_id = ${viewer.organisationId} AND status = 'ACTIVE'
    ORDER BY display_order, name
  `) as { id: string; requirement_code: string; name: string; category: RequirementCategory }[];
}

export type SubmissionView = {
  id: string; status: SubmissionStatus; lock_version: number;
  evidence_id: string; evidence_reference: string; evidence_type: string; title: string | null; description: string | null; held_at: string | null;
  supplied_on: string; effective_from: string | null; expires_on: string | null; notes: string | null;
  recorded_by: string; recorded_by_name: string | null; recorded_at: AssuranceTimestamp;
  decided_by_name: string | null; decided_at: AssuranceTimestamp | null; decision_reason: string | null;
  superseded_at: AssuranceTimestamp | null; superseded_by_submission_id: string | null;
  snapshot: {
    code: string; name: string; category: string; description: string | null; evidence_guidance: string | null;
    expiry_required: boolean; renewal_notice_days: number | null;
  };
  /** True when the live requirement's assessed fields differ from this submission's snapshot. */
  requirement_changed_since: boolean;
};

export type AssignmentView = {
  id: string; status: AssignmentStatus; lock_version: number; required_from: string | null; due_date: string | null;
  reviewer_user_id: string | null; reviewer_name: string | null; notes: string | null; created_at: AssuranceTimestamp;
  cancelled_at: AssuranceTimestamp | null; cancel_reason: string | null;
  requirement: {
    id: string; requirement_code: string; name: string; description: string | null; category: RequirementCategory;
    evidence_guidance: string | null; expiry_required: boolean; renewal_notice_days: number | null; status: RequirementStatus;
  };
  state: AssignmentState | null;
  current: SubmissionView | null;
  pending: SubmissionView[];
  history: SubmissionView[];
  findings: { id: string; finding_reference: string; title: string; status: string }[];
};

export type ContractorDetail = {
  organisation: { id: string; reference: string; name: string; legal_name: string | null; status: string; roles: string[] };
  scope: { id: string; status: ScopeStatus; responsible_user_id: string | null; responsible_name: string | null; notes: string | null;
    status_changed_at: AssuranceTimestamp; lock_version: number } | null;
  assignments: AssignmentView[];
  counts: StateCounts; awaiting_review: number; headline: OrganisationHeadline;
  today: string; timeZone: string;
  history: { id: string; action: string; created_at: string; user_name: string | null; after_state: Record<string, unknown> | null }[];
};

export async function getContractorDetail(viewer: AssuranceViewer, externalOrganisationId: string): Promise<ContractorDetail | null> {
  if (!isUuid(externalOrganisationId)) return null;
  externalOrganisationId = externalOrganisationId.toLowerCase();
  const org = viewer.organisationId;
  const orgRows = (await sql`
    SELECT eo.id, eo.reference, eo.name, eo.legal_name, eo.status,
           COALESCE((SELECT array_agg(r.role ORDER BY r.role) FROM external_organisation_roles r
                      WHERE r.organisation_id = eo.organisation_id AND r.external_organisation_id = eo.id AND r.active), ARRAY[]::text[]) AS roles
    FROM external_organisations eo WHERE eo.organisation_id = ${org} AND eo.id = ${externalOrganisationId}::uuid
  `) as ContractorDetail['organisation'][];
  if (!orgRows[0]) return null;
  const timeZone = await getAssuranceTimeZone(org);
  const today = todayIn(timeZone);

  const [scopeRows, assignmentRows, submissionRows, findingRows] = await Promise.all([
    sql`
      SELECT s.id, s.status, s.responsible_user_id, u.name AS responsible_name, s.notes, s.status_changed_at, s.lock_version
      FROM assurance_external_organisation_scopes s
      LEFT JOIN users u ON u.id = s.responsible_user_id AND u.organisation_id = s.organisation_id
      WHERE s.organisation_id = ${org} AND s.external_organisation_id = ${externalOrganisationId}::uuid
    `,
    sql`
      SELECT a.id, a.status, a.lock_version, a.required_from::text AS required_from, a.due_date::text AS due_date,
             a.reviewer_user_id, ru.name AS reviewer_name, a.notes, a.created_at, a.cancelled_at, a.cancel_reason,
             r.id AS requirement_id, r.requirement_code, r.name AS requirement_name, r.description AS requirement_description,
             r.category, r.evidence_guidance, r.expiry_required, r.renewal_notice_days, r.status AS requirement_status
      FROM assurance_requirement_assignments a
      JOIN assurance_requirements r ON r.organisation_id = a.organisation_id AND r.id = a.requirement_id
      LEFT JOIN users ru ON ru.id = a.reviewer_user_id AND ru.organisation_id = a.organisation_id
      WHERE a.organisation_id = ${org} AND a.external_organisation_id = ${externalOrganisationId}::uuid
      ORDER BY (a.status = 'ACTIVE') DESC, r.display_order, r.name, a.created_at DESC
    `,
    sql`
      SELECT s.id, s.assignment_id, s.status, s.lock_version, s.evidence_id, e.evidence_reference, e.evidence_type, e.title, e.description,
             e.metadata->>'held_at' AS held_at,
             s.supplied_on::text AS supplied_on, s.effective_from::text AS effective_from, s.expires_on::text AS expires_on, s.notes,
             s.recorded_by, rb.name AS recorded_by_name, s.recorded_at, db.name AS decided_by_name, s.decided_at, s.decision_reason,
             s.superseded_at, s.superseded_by_submission_id,
             s.requirement_code_snapshot, s.requirement_name_snapshot, s.requirement_category_snapshot, s.requirement_description_snapshot,
             s.evidence_guidance_snapshot, s.expiry_required_snapshot, s.renewal_notice_days_snapshot
      FROM assurance_requirement_submissions s
      JOIN assurance_requirement_assignments a ON a.organisation_id = s.organisation_id AND a.id = s.assignment_id
      JOIN assurance_evidence e ON e.organisation_id = s.organisation_id AND e.id = s.evidence_id
      LEFT JOIN users rb ON rb.id = s.recorded_by AND rb.organisation_id = s.organisation_id
      LEFT JOIN users db ON db.id = s.decided_by AND db.organisation_id = s.organisation_id
      WHERE s.organisation_id = ${org} AND a.external_organisation_id = ${externalOrganisationId}::uuid
      ORDER BY s.recorded_at DESC
    `,
    sql`
      SELECT l.assignment_id, f.id, f.finding_reference, f.title, f.status
      FROM assurance_requirement_assignment_findings l
      JOIN assurance_requirement_assignments a ON a.organisation_id = l.organisation_id AND a.id = l.assignment_id
      JOIN assurance_findings f ON f.organisation_id = l.organisation_id AND f.id = l.finding_id
      WHERE l.organisation_id = ${org} AND a.external_organisation_id = ${externalOrganisationId}::uuid
      ORDER BY l.created_at DESC
    `,
  ]);

  type RawAssignment = Omit<AssignmentView, 'requirement' | 'state' | 'current' | 'pending' | 'history' | 'findings'> & {
    requirement_id: string; requirement_code: string; requirement_name: string; requirement_description: string | null;
    category: RequirementCategory; evidence_guidance: string | null; expiry_required: boolean; renewal_notice_days: number | null;
    requirement_status: RequirementStatus;
  };
  type RawSubmission = Omit<SubmissionView, 'snapshot' | 'requirement_changed_since'> & {
    assignment_id: string; requirement_code_snapshot: string; requirement_name_snapshot: string; requirement_category_snapshot: string;
    requirement_description_snapshot: string | null; evidence_guidance_snapshot: string | null; expiry_required_snapshot: boolean;
    renewal_notice_days_snapshot: number | null;
  };

  const assignments: AssignmentView[] = (assignmentRows as RawAssignment[]).map(a => {
    const requirement = {
      id: a.requirement_id, requirement_code: a.requirement_code, name: a.requirement_name, description: a.requirement_description,
      category: a.category, evidence_guidance: a.evidence_guidance, expiry_required: a.expiry_required,
      renewal_notice_days: a.renewal_notice_days, status: a.requirement_status,
    };
    const subs: SubmissionView[] = (submissionRows as RawSubmission[]).filter(s => s.assignment_id === a.id).map(s => {
      const snapshot = {
        code: s.requirement_code_snapshot, name: s.requirement_name_snapshot, category: s.requirement_category_snapshot,
        description: s.requirement_description_snapshot, evidence_guidance: s.evidence_guidance_snapshot,
        expiry_required: s.expiry_required_snapshot, renewal_notice_days: s.renewal_notice_days_snapshot,
      };
      const changed = snapshot.name !== requirement.name || snapshot.category !== requirement.category
        || snapshot.description !== requirement.description || snapshot.evidence_guidance !== requirement.evidence_guidance
        || snapshot.expiry_required !== requirement.expiry_required || snapshot.renewal_notice_days !== requirement.renewal_notice_days;
      const { assignment_id: _a, requirement_code_snapshot: _1, requirement_name_snapshot: _2, requirement_category_snapshot: _3,
        requirement_description_snapshot: _4, evidence_guidance_snapshot: _5, expiry_required_snapshot: _6, renewal_notice_days_snapshot: _7, ...rest } = s;
      void _a; void _1; void _2; void _3; void _4; void _5; void _6; void _7;
      return { ...rest, snapshot, requirement_changed_since: changed };
    });
    const current = subs.find(s => s.status === 'ACCEPTED') ?? null;
    const state = a.status === 'ACTIVE'
      ? assignmentState({ hasAccepted: current !== null, acceptedExpiresOn: current?.expires_on ?? null, renewalNoticeDays: requirement.renewal_notice_days, today })
      : null;
    const {
      requirement_id: _r1, requirement_code: _r2, requirement_name: _r3, requirement_description: _r4, category: _r5,
      evidence_guidance: _r6, expiry_required: _r7, renewal_notice_days: _r8, requirement_status: _r9, ...base
    } = a;
    void _r1; void _r2; void _r3; void _r4; void _r5; void _r6; void _r7; void _r8; void _r9;
    return {
      ...base, requirement, state, current,
      pending: subs.filter(s => s.status === 'SUBMITTED'),
      history: subs,
      findings: (findingRows as { assignment_id: string; id: string; finding_reference: string; title: string; status: string }[])
        .filter(f => f.assignment_id === a.id).map(({ assignment_id: _f, ...f }) => { void _f; return f; }),
    };
  });

  const active = assignments.filter(a => a.status === 'ACTIVE');
  const counts = emptyCounts();
  for (const a of active) if (a.state) counts[a.state] += 1;
  const awaiting = active.reduce((n, a) => n + a.pending.length, 0);
  const scope = (scopeRows as NonNullable<ContractorDetail['scope']>[])[0] ?? null;

  const ids = [scope?.id, ...assignments.map(a => a.id), ...assignments.flatMap(a => a.history.map(s => s.id))].filter((x): x is string => !!x);
  const history = ids.length === 0 ? [] : (await sql`
    SELECT l.id, l.action, l.created_at, u.name AS user_name, l.after_state
    FROM audit_logs l
    LEFT JOIN users u ON u.id = l.user_id AND u.organisation_id = l.organisation_id
    WHERE l.organisation_id = ${org}
      AND l.resource_type IN (${ORG_SCOPE_RESOURCE}, ${ASSIGNMENT_RESOURCE}, ${EVIDENCE_RESOURCE})
      AND l.resource_id = ANY(${ids}::text[])
    ORDER BY l.created_at DESC
    LIMIT 200
  `) as ContractorDetail['history'];

  return {
    organisation: orgRows[0], scope, assignments, counts, awaiting_review: awaiting,
    headline: organisationHeadline(active.map(a => a.state as AssignmentState), awaiting),
    today, timeZone, history,
  };
}
