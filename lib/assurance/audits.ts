import 'server-only';
import sql from '@/lib/db';
import { viewerCan, type AssuranceViewer } from './policy';
import { findingVisibleSql, evidenceVisibleSql } from './access';
import { auditInsert, listAssuranceHistory, type AssuranceHistoryEntry } from './audit';
import { auditFromCte, type AssuranceTimestamp } from './sqlHelpers';
import { assertSameOrgUsers } from './users';
import { assertContextRefsInOrg } from './lookups';
import { withFreshReference } from './references';
import { rejectUnpublishedTemplate } from './templateLifecycle';
import type { EvidenceLinkRow } from './incidents';
import {
  AUDIT_OUTCOMES, AUDIT_RESPONSE_TYPES, AUDIT_STATUSES, AUDIT_TYPES, parseCriteria,
  type AuditCriterion, type AuditOutcome, type AuditResponseType, type AuditStatus, type AuditType,
} from './domain';
import {
  isUuid, optionalDateTime, optionalEnum, optionalText, optionalUserId, optionalUuid, requiredEnum, requiredText,
  requiredUuid, searchPattern,
} from './input';
import { AssuranceConflictError, AssuranceForbiddenError, AssuranceNotFoundError, AssuranceValidationError } from './errors';

// Audits (A0.1E-1): a structured review against a standard or requirement.
//
//   * Template-based (bound forever to one immutable template version) or
//     ad hoc — an ad hoc Audit MUST carry a standard_reference (DB check
//     assurance_audits_basis_check; enforced here first for a clear error).
//   * A criterion outcome NEVER creates a Finding. Findings are raised
//     explicitly through the shared Finding service (findings.ts, auditId
//     source) and linked via assurance_audit_findings.
//   * There is no Audit -> Action shortcut: corrective work flows
//     Audit -> Finding -> Action -> Evidence -> Verification -> Closure.
//   * Completing an Audit never creates, changes or closes Findings/Actions.
//   * Audits carry no `restricted` flag. Restriction still applies to what
//     an Audit SHOWS: linked findings/evidence are filtered by the shared
//     visibility predicates (a finding may also belong to a restricted
//     incident or investigation).

export type AuditListFilters = {
  q?: string;
  status?: string;
  view?: 'due' | 'planned' | 'in_progress' | 'completed' | 'all';
  auditType?: string;
  source?: 'template' | 'adhoc';
  auditorUserId?: string;
  locationId?: string;
  externalOrganisationId?: string;
};

export type AuditListRow = {
  id: string; audit_reference: string; title: string; audit_type: AuditType; status: AuditStatus;
  standard_reference: string | null; scheduled_at: AssuranceTimestamp | null; started_at: AssuranceTimestamp | null;
  completed_at: AssuranceTimestamp | null; auditor_name: string | null; location_name: string | null;
  external_organisation_name: string | null; template_name: string | null; template_version_number: number | null;
  response_count: number; non_compliant_count: number; partial_count: number; finding_count: number;
};

export async function listAudits(viewer: AssuranceViewer, filters: AuditListFilters = {}): Promise<AuditListRow[]> {
  const pattern = searchPattern(filters.q);
  const status = AUDIT_STATUSES.includes(filters.status as AuditStatus) ? filters.status! : null;
  const type = AUDIT_TYPES.includes(filters.auditType as AuditType) ? filters.auditType! : null;
  const view = filters.view && ['due', 'planned', 'in_progress', 'completed'].includes(filters.view) ? filters.view : 'all';
  const source = filters.source === 'template' || filters.source === 'adhoc' ? filters.source : null;
  const auditor = typeof filters.auditorUserId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(filters.auditorUserId) ? filters.auditorUserId : null;
  const locationId = isUuid(filters.locationId) ? filters.locationId : null;
  const externalOrganisationId = isUuid(filters.externalOrganisationId) ? filters.externalOrganisationId : null;

  return (await sql`
    SELECT au.id, au.audit_reference, au.title, au.audit_type, au.status, au.standard_reference,
           au.scheduled_at, au.started_at, au.completed_at,
           uu.name AS auditor_name, loc.name AS location_name, xo.name AS external_organisation_name,
           t.name AS template_name, v.version_number AS template_version_number,
           (SELECT count(*) FROM assurance_audit_responses r
             WHERE r.organisation_id = au.organisation_id AND r.audit_id = au.id)::int AS response_count,
           (SELECT count(*) FROM assurance_audit_responses r
             WHERE r.organisation_id = au.organisation_id AND r.audit_id = au.id AND r.outcome = 'NON_COMPLIANT')::int AS non_compliant_count,
           (SELECT count(*) FROM assurance_audit_responses r
             WHERE r.organisation_id = au.organisation_id AND r.audit_id = au.id AND r.outcome = 'PARTIAL')::int AS partial_count,
           (SELECT count(*) FROM assurance_audit_findings xf
             JOIN assurance_findings f ON f.organisation_id = xf.organisation_id AND f.id = xf.finding_id
             WHERE xf.organisation_id = au.organisation_id AND xf.audit_id = au.id AND ${findingVisibleSql(viewer)})::int AS finding_count
    FROM assurance_audits au
    LEFT JOIN users uu ON uu.id = au.auditor_user_id AND uu.organisation_id = au.organisation_id
    LEFT JOIN locations loc ON loc.organisation_id = au.organisation_id AND loc.id = au.location_id
    LEFT JOIN external_organisations xo ON xo.organisation_id = au.organisation_id AND xo.id = au.external_organisation_id
    LEFT JOIN assurance_audit_template_versions v ON v.organisation_id = au.organisation_id AND v.id = au.template_version_id
    LEFT JOIN assurance_audit_templates t ON t.organisation_id = v.organisation_id AND t.id = v.template_id
    WHERE au.organisation_id = ${viewer.organisationId}
      AND (${status}::text IS NULL OR au.status = ${status})
      AND (${type}::text IS NULL OR au.audit_type = ${type})
      AND (${view}::text <> 'due' OR (au.status = 'PLANNED' AND au.scheduled_at IS NOT NULL AND au.scheduled_at < now() + interval '14 days'))
      AND (${view}::text <> 'planned' OR au.status = 'PLANNED')
      AND (${view}::text <> 'in_progress' OR au.status = 'IN_PROGRESS')
      AND (${view}::text <> 'completed' OR au.status = 'COMPLETED')
      AND (${source}::text IS NULL OR (${source}::text = 'template') = (au.template_version_id IS NOT NULL))
      AND (${auditor}::text IS NULL OR au.auditor_user_id = ${auditor})
      AND (${locationId}::uuid IS NULL OR au.location_id = ${locationId}::uuid)
      AND (${externalOrganisationId}::uuid IS NULL OR au.external_organisation_id = ${externalOrganisationId}::uuid)
      AND (${pattern}::text IS NULL OR au.audit_reference ILIKE ${pattern} OR au.title ILIKE ${pattern} OR au.standard_reference ILIKE ${pattern})
    ORDER BY
      CASE au.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'PLANNED' THEN 1 WHEN 'COMPLETED' THEN 2 ELSE 3 END,
      COALESCE(au.scheduled_at, au.started_at, au.created_at) DESC
    LIMIT 200
  `) as AuditListRow[];
}

export type AuditResponseRow = {
  id: string; criterion_key: string; criterion_label: string; response_type: AuditResponseType; response_value: unknown;
  outcome: AuditOutcome | null; notes: string | null; responded_at: AssuranceTimestamp; responded_by_name: string | null;
};

export type AuditDetail = {
  audit: {
    id: string; audit_reference: string; title: string; audit_type: AuditType; status: AuditStatus; scope: string;
    standard_reference: string | null; scheduled_at: AssuranceTimestamp | null; started_at: AssuranceTimestamp | null;
    completed_at: AssuranceTimestamp | null; summary: string | null; recommendations: string | null;
    auditor_user_id: string | null; auditor_name: string | null; location_name: string | null; asset_name: string | null;
    external_organisation_name: string | null;
    template_id: string | null; template_name: string | null; template_version_id: string | null;
    template_version_number: number | null; template_version_title: string | null;
    template_version_standard_reference: string | null; template_instructions: string | null;
    latest_template_version_number: number | null; created_at: AssuranceTimestamp; created_by_name: string | null;
  };
  /** Criteria from the exact template version this Audit used (empty for ad hoc). */
  criteria: AuditCriterion[];
  invalidCriteria: number;
  responses: AuditResponseRow[];
  findings: {
    id: string; finding_reference: string; title: string; finding_type: string; status: string;
    identified_at: AssuranceTimestamp; source_criterion_key: string | null;
  }[];
  hiddenFindingCount: number;
  evidence: EvidenceLinkRow[];
  history: AssuranceHistoryEntry[];
};

export async function getAuditDetail(viewer: AssuranceViewer, id: string): Promise<AuditDetail | null> {
  if (!isUuid(id)) return null;
  id = id.toLowerCase(); // canonical form: audit_logs/resource ids are stored lowercase
  const org = viewer.organisationId;
  const rows = (await sql`
    SELECT au.id, au.audit_reference, au.title, au.audit_type, au.status, au.scope, au.standard_reference,
           au.scheduled_at, au.started_at, au.completed_at, au.summary, au.recommendations,
           au.auditor_user_id, uu.name AS auditor_name, loc.name AS location_name, ast.name AS asset_name,
           xo.name AS external_organisation_name,
           t.id AS template_id, t.name AS template_name, v.id AS template_version_id, v.version_number AS template_version_number,
           v.title AS template_version_title, v.standard_reference AS template_version_standard_reference,
           v.instructions AS template_instructions, v.criteria AS template_criteria,
           (SELECT max(v2.version_number) FROM assurance_audit_template_versions v2
             WHERE v2.organisation_id = v.organisation_id AND v2.template_id = v.template_id AND v2.status <> 'DRAFT') AS latest_template_version_number,
           au.created_at, cu.name AS created_by_name
    FROM assurance_audits au
    LEFT JOIN users uu ON uu.id = au.auditor_user_id AND uu.organisation_id = au.organisation_id
    LEFT JOIN users cu ON cu.id = au.created_by AND cu.organisation_id = au.organisation_id
    LEFT JOIN locations loc ON loc.organisation_id = au.organisation_id AND loc.id = au.location_id
    LEFT JOIN assets ast ON ast.organisation_id = au.organisation_id AND ast.id = au.asset_id
    LEFT JOIN external_organisations xo ON xo.organisation_id = au.organisation_id AND xo.id = au.external_organisation_id
    LEFT JOIN assurance_audit_template_versions v ON v.organisation_id = au.organisation_id AND v.id = au.template_version_id
    LEFT JOIN assurance_audit_templates t ON t.organisation_id = v.organisation_id AND t.id = v.template_id
    WHERE au.organisation_id = ${org} AND au.id = ${id}::uuid
  `) as (AuditDetail['audit'] & { template_criteria: unknown })[];
  const row = rows[0];
  if (!row) return null;
  const { template_criteria, ...audit } = row;
  const parsed = parseCriteria(template_criteria);

  const [responses, findings, hidden, evidence, history] = await Promise.all([
    sql`
      SELECT r.id, r.criterion_key, r.criterion_label, r.response_type, r.response_value, r.outcome, r.notes, r.responded_at,
             u.name AS responded_by_name
      FROM assurance_audit_responses r
      LEFT JOIN users u ON u.id = r.responded_by AND u.organisation_id = r.organisation_id
      WHERE r.organisation_id = ${org} AND r.audit_id = ${id}::uuid
      ORDER BY r.criterion_key ASC
    `,
    // source_criterion_key is display metadata recorded in the finding's
    // creation audit row (A0.1E-1 has no criterion-level link column); the
    // authoritative link is assurance_audit_findings.
    sql`
      SELECT f.id, f.finding_reference, f.title, f.finding_type, f.status, f.identified_at,
             (SELECT l.after_state->>'audit_criterion_key' FROM audit_logs l
               WHERE l.organisation_id = f.organisation_id AND l.resource_type = 'assurance_finding'
                 AND l.resource_id = f.id::text AND l.action = 'assurance_finding.created'
                 AND lower(l.after_state->>'audit_id') = lower(${id})
               ORDER BY l.created_at ASC LIMIT 1) AS source_criterion_key
      FROM assurance_audit_findings lx
      JOIN assurance_findings f ON f.organisation_id = lx.organisation_id AND f.id = lx.finding_id
      WHERE lx.organisation_id = ${org} AND lx.audit_id = ${id}::uuid
        AND ${findingVisibleSql(viewer)}
      ORDER BY f.identified_at DESC
    `,
    sql`
      SELECT count(*)::int AS n
      FROM assurance_audit_findings lx
      JOIN assurance_findings f ON f.organisation_id = lx.organisation_id AND f.id = lx.finding_id
      WHERE lx.organisation_id = ${org} AND lx.audit_id = ${id}::uuid
        AND NOT ${findingVisibleSql(viewer)}
    `,
    sql`
      SELECT l.id AS link_id, e.id AS evidence_id, e.evidence_reference, e.evidence_type, e.title,
             e.verification_status,
             (SELECT s.status FROM assurance_requirement_submissions s WHERE s.organisation_id = e.organisation_id AND s.evidence_id = e.id) AS contractor_status,
             l.criterion_key AS item_key,
             (SELECT r.criterion_label FROM assurance_audit_responses r WHERE r.organisation_id = l.organisation_id AND r.audit_id = l.audit_id AND r.criterion_key = l.criterion_key) AS item_label,
             l.purpose, l.created_at AS linked_at, l.removed_at, l.removal_reason,
             cu.name AS linked_by_name, ru.name AS removed_by_name
      FROM assurance_evidence_audits l
      JOIN assurance_evidence e ON e.organisation_id = l.organisation_id AND e.id = l.evidence_id
      LEFT JOIN users cu ON cu.id = l.created_by AND cu.organisation_id = l.organisation_id
      LEFT JOIN users ru ON ru.id = l.removed_by AND ru.organisation_id = l.organisation_id
      WHERE l.organisation_id = ${org} AND l.audit_id = ${id}::uuid
        AND ${evidenceVisibleSql(viewer)}
      ORDER BY l.removed_at NULLS FIRST, l.created_at DESC
    `,
    listAssuranceHistory(org, 'assurance_audit', id),
  ]);

  return {
    audit,
    criteria: parsed.items,
    invalidCriteria: parsed.invalidCount,
    responses: responses as AuditResponseRow[],
    findings: findings as AuditDetail['findings'],
    hiddenFindingCount: ((hidden as { n: number }[])[0]?.n) ?? 0,
    evidence: evidence as EvidenceLinkRow[],
    history,
  };
}

/** Ad hoc audits define criteria as they go; bound the row set. */
const MAX_AD_HOC_CRITERIA = 200;

type AuditState = { id: string; status: AuditStatus; template_version_id: string | null; criteria: unknown };

async function getAuditState(viewer: AssuranceViewer, id: string): Promise<AuditState> {
  if (!isUuid(id)) throw new AssuranceNotFoundError('Audit');
  const rows = (await sql`
    SELECT au.id, au.status, au.template_version_id, v.criteria
    FROM assurance_audits au
    LEFT JOIN assurance_audit_template_versions v ON v.organisation_id = au.organisation_id AND v.id = au.template_version_id
    WHERE au.organisation_id = ${viewer.organisationId} AND au.id = ${id}::uuid
  `) as AuditState[];
  if (!rows[0]) throw new AssuranceNotFoundError('Audit');
  return rows[0];
}

export async function assertAuditExists(viewer: AssuranceViewer, id: string): Promise<{ id: string; status: AuditStatus }> {
  const s = await getAuditState(viewer, id);
  return { id: s.id, status: s.status };
}

export async function createAudit(viewer: AssuranceViewer, raw: Record<string, unknown>): Promise<{ id: string; audit_reference: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const templateVersionId = optionalUuid(raw.templateVersionId, 'Template');
  const input = {
    title: requiredText(raw.title, 'Title', 200),
    scope: requiredText(raw.scope, 'Scope', 8000),
    auditType: optionalEnum(AUDIT_TYPES, raw.auditType, 'Audit type'),
    standardReference: optionalText(raw.standardReference, 'Standard / reference', 300),
    auditorUserId: optionalUserId(raw.auditorUserId, 'Auditor'),
    scheduledAt: optionalDateTime(raw.scheduledAt, 'Scheduled for'),
    locationId: optionalUuid(raw.locationId, 'Location'),
    assetId: optionalUuid(raw.assetId, 'Asset'),
    externalOrganisationId: optionalUuid(raw.externalOrganisationId, 'External organisation'),
  };

  let auditType = input.auditType;
  let standardReference = input.standardReference;
  if (templateVersionId) {
    // Must be the PUBLISHED version of an active template in THIS
    // organisation (A0.1F also enforces this in the database, race-safely).
    // The Audit binds to this exact version forever.
    const v = (await sql`
      SELECT t.audit_type, v.standard_reference
      FROM assurance_audit_template_versions v
      JOIN assurance_audit_templates t ON t.organisation_id = v.organisation_id AND t.id = v.template_id
      WHERE v.organisation_id = ${viewer.organisationId} AND v.id = ${templateVersionId}::uuid AND t.is_active = true AND v.status = 'PUBLISHED'
    `) as { audit_type: AuditType; standard_reference: string | null }[];
    if (!v[0]) throw new AssuranceValidationError('Template was not found in your organisation, or is not published.');
    auditType = auditType ?? v[0].audit_type;
    standardReference = standardReference ?? v[0].standard_reference;
  } else if (!standardReference) {
    throw new AssuranceValidationError('An ad hoc audit needs the standard or reference it is audited against.');
  }
  if (!auditType) throw new AssuranceValidationError('Audit type is required for an ad hoc audit.');

  await Promise.all([
    assertSameOrgUsers(viewer.organisationId, [{ field: 'Auditor', userId: input.auditorUserId }]),
    assertContextRefsInOrg(viewer.organisationId, {
      locationId: input.locationId, assetId: input.assetId, externalOrganisationId: input.externalOrganisationId,
    }),
  ]);

  const id = crypto.randomUUID();
  return withFreshReference('audit', async reference => {
    await rejectUnpublishedTemplate(sql.transaction([
      sql`
        INSERT INTO assurance_audits (
          id, organisation_id, audit_reference, template_version_id, audit_type, title, scope, standard_reference, status,
          auditor_user_id, scheduled_at, location_id, asset_id, external_organisation_id, created_by
        ) VALUES (
          ${id}::uuid, ${viewer.organisationId}, ${reference}, ${templateVersionId}::uuid, ${auditType}, ${input.title}, ${input.scope},
          ${standardReference}, 'PLANNED', ${input.auditorUserId}, ${input.scheduledAt}::timestamptz, ${input.locationId}::uuid,
          ${input.assetId}::uuid, ${input.externalOrganisationId}::uuid, ${viewer.userId}
        )
      `,
      auditInsert({
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_audit',
        resourceId: id, verb: 'created',
        after: { audit_reference: reference, status: 'PLANNED', template_version_id: templateVersionId, audit_type: auditType },
      }),
    ]));
    return { id, audit_reference: reference };
  });
}

export async function startAudit(viewer: AssuranceViewer, id: string): Promise<void> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const state = await getAuditState(viewer, id);
  if (state.status !== 'PLANNED') throw new AssuranceConflictError('Only a planned audit can be started.');
  const rows = (await sql`
    WITH upd AS (
      UPDATE assurance_audits SET status = 'IN_PROGRESS', started_at = now(), updated_at = now()
      WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid AND status = 'PLANNED'
      RETURNING id
    ), aud AS (
      ${auditFromCte('upd', {
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_audit',
        verb: 'started', before: { status: 'PLANNED' }, after: { status: 'IN_PROGRESS' },
      })}
    )
    SELECT id FROM upd
  `) as unknown[];
  if (rows.length === 0) throw new AssuranceConflictError('This audit was changed by someone else. Refresh and try again.');
}

function normaliseValue(type: AuditResponseType, value: unknown, criterion: AuditCriterion | null): unknown {
  if (value === undefined || value === null || value === '') return null;
  switch (type) {
    case 'NUMBER': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) throw new AssuranceValidationError('Enter a valid number.');
      return n;
    }
    case 'BOOLEAN':
      if (value === true || value === 'true' || value === 'yes') return true;
      if (value === false || value === 'false' || value === 'no') return false;
      throw new AssuranceValidationError('Choose yes or no.');
    case 'CHOICE':
      if (typeof value !== 'string' || (criterion && criterion.options.length > 0 && !criterion.options.includes(value))) {
        throw new AssuranceValidationError('Choose one of the listed options.');
      }
      return value;
    case 'COMPLIANCE_RATING':
      // The rating IS the outcome; no separate value is stored.
      return null;
    default:
      if (typeof value !== 'string') throw new AssuranceValidationError('Enter a text response.');
      return value.trim().slice(0, 2000);
  }
}

/**
 * Records (or revises, while IN_PROGRESS) one criterion response. For a
 * template-based Audit the criterion label/type come from the bound
 * template VERSION, never the request. Each save is audited with the
 * previous outcome/value/notes; a criterion that has had a Finding raised
 * from it is frozen. An outcome NEVER creates a Finding by itself.
 */
export async function recordAuditResponse(viewer: AssuranceViewer, auditId: string, raw: Record<string, unknown>): Promise<{ id: string }> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const state = await getAuditState(viewer, auditId);
  auditId = state.id; // canonical (lowercase) id from the database — never the raw request form
  if (state.status !== 'IN_PROGRESS') throw new AssuranceConflictError('Responses can only be recorded while the audit is in progress.');

  const criterionKey = requiredText(raw.criterionKey, 'Criterion', 120);
  const previous = (await sql`
    SELECT criterion_label, response_type FROM assurance_audit_responses
    WHERE organisation_id = ${viewer.organisationId} AND audit_id = ${auditId}::uuid AND criterion_key = ${criterionKey}
  `) as { criterion_label: string; response_type: AuditResponseType }[];

  let criterion: AuditCriterion | null = null;
  let label: string;
  let responseType: AuditResponseType;
  if (state.template_version_id) {
    criterion = parseCriteria(state.criteria).items.find(c => c.key === criterionKey) ?? null;
    if (!criterion) throw new AssuranceValidationError('That criterion is not part of this audit\'s template version.');
    label = criterion.label;
    responseType = criterion.responseType;
  } else if (previous[0]) {
    // An ad hoc criterion's label and type are fixed by its first save;
    // a revision is validated against them, never re-typed by the request.
    label = previous[0].criterion_label;
    responseType = previous[0].response_type;
  } else {
    if (!/^adhoc-[a-z0-9-]{1,80}$/.test(criterionKey)) throw new AssuranceValidationError('Invalid ad hoc criterion key.');
    label = requiredText(raw.criterionLabel, 'Criterion', 500);
    responseType = requiredEnum(AUDIT_RESPONSE_TYPES, raw.responseType ?? 'COMPLIANCE_RATING', 'Response type');
    const count = (await sql`
      SELECT count(*)::int AS n FROM assurance_audit_responses WHERE organisation_id = ${viewer.organisationId} AND audit_id = ${auditId}::uuid
    `) as { n: number }[];
    if (count[0].n >= MAX_AD_HOC_CRITERIA) throw new AssuranceValidationError(`An audit can have at most ${MAX_AD_HOC_CRITERIA} criteria.`);
  }
  const outcome = optionalEnum(AUDIT_OUTCOMES, raw.outcome, 'Outcome');
  const value = normaliseValue(responseType, raw.value, criterion);
  const notes = optionalText(raw.notes, 'Notes', 2000);
  if (responseType === 'COMPLIANCE_RATING' && !outcome) throw new AssuranceValidationError('Choose a compliance rating.');
  if (!outcome && value === null) throw new AssuranceValidationError('Choose an outcome or enter a response.');
  if ((outcome === 'NON_COMPLIANT' || outcome === 'PARTIAL') && !notes) {
    throw new AssuranceValidationError('Add a note explaining the gap against the requirement.');
  }

  // "A finding was raised from this criterion" — the freeze predicate. Ids
  // are compared case-insensitively (as text, so an unrelated audit_logs row
  // can never make a uuid cast fail) — no textual form of the id dodges it.
  const raisedFromSql = sql`EXISTS (
    SELECT 1 FROM audit_logs l
    WHERE l.organisation_id = ${viewer.organisationId} AND l.resource_type = 'assurance_finding'
      AND l.action = 'assurance_finding.created'
      AND lower(l.after_state->>'audit_id') = lower(${auditId})
      AND l.after_state->>'audit_criterion_key' = ${criterionKey}
  )`;
  if (((await sql`SELECT ${raisedFromSql} AS frozen`) as { frozen: boolean }[])[0].frozen) {
    throw new AssuranceConflictError('A finding has been raised from this criterion, so its response can no longer be changed.');
  }

  const responseId = crypto.randomUUID();
  // Lock the audit row FOR UPDATE (raising a finding from a criterion takes
  // the same lock), then re-check "in progress" and "not frozen" inside the
  // write with a fresh snapshot. The previous value for the audit trail is
  // read inside the same statement, so it is never stale.
  const results = await sql.transaction([
    sql`SELECT id FROM assurance_audits WHERE organisation_id = ${viewer.organisationId} AND id = ${auditId}::uuid FOR UPDATE`,
    sql`
    WITH prev AS (
      SELECT outcome, response_value, notes FROM assurance_audit_responses
      WHERE organisation_id = ${viewer.organisationId} AND audit_id = ${auditId}::uuid AND criterion_key = ${criterionKey}
    ), ins AS (
      INSERT INTO assurance_audit_responses (
        id, organisation_id, audit_id, criterion_key, criterion_label, response_type, response_value, outcome, notes, responded_by, responded_at
      )
      SELECT ${responseId}::uuid, au.organisation_id, au.id, ${criterionKey}, ${label}, ${responseType},
             ${value === null ? null : JSON.stringify(value)}::jsonb, ${outcome}, ${notes}, ${viewer.userId}, now()
      FROM assurance_audits au
      WHERE au.organisation_id = ${viewer.organisationId} AND au.id = ${auditId}::uuid AND au.status = 'IN_PROGRESS'
        AND NOT ${raisedFromSql}
      ON CONFLICT (organisation_id, audit_id, criterion_key) DO UPDATE
        SET response_value = EXCLUDED.response_value,
            outcome = EXCLUDED.outcome,
            notes = EXCLUDED.notes,
            responded_by = EXCLUDED.responded_by,
            responded_at = EXCLUDED.responded_at
      RETURNING id, audit_id
    ), aud AS (
      INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
      SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_audit.response_recorded',
             'assurance_audit', ins.audit_id::text,
             (SELECT jsonb_build_object('outcome', prev.outcome, 'value', prev.response_value, 'notes', prev.notes) FROM prev),
             jsonb_build_object('criterion_key', ${criterionKey}::text, 'outcome', ${outcome}::text, 'response_id', ins.id,
                                'value', ${value === null ? null : JSON.stringify(value)}::jsonb, 'notes', ${notes}::text)
      FROM ins
    )
    SELECT id FROM ins
  `,
  ]);
  const rows = results[1] as { id: string }[];
  if (!rows[0]) {
    throw new AssuranceConflictError('This response could not be saved: the audit is no longer in progress, or a finding has just been raised from this criterion.');
  }
  return rows[0];
}

/** Completion records summary/recommendations only — it never creates or closes Findings or Actions. */
export async function completeAudit(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<void> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const state = await getAuditState(viewer, id);
  if (state.status !== 'IN_PROGRESS') throw new AssuranceConflictError('Only an in-progress audit can be completed.');
  const summary = optionalText(raw.summary, 'Summary', 4000);
  const recommendations = optionalText(raw.recommendations, 'Recommendations', 8000);

  const answered = (await sql`
    SELECT criterion_key FROM assurance_audit_responses
    WHERE organisation_id = ${viewer.organisationId} AND audit_id = ${id}::uuid
  `) as { criterion_key: string }[];
  const answeredKeys = new Set(answered.map(r => r.criterion_key));
  if (state.template_version_id) {
    const missing = parseCriteria(state.criteria).items.filter(c => c.required && !answeredKeys.has(c.key));
    if (missing.length > 0) {
      throw new AssuranceConflictError(`${missing.length} required criteri${missing.length === 1 ? 'on has' : 'a have'} no response yet.`);
    }
  } else if (answeredKeys.size === 0) {
    throw new AssuranceConflictError('Record at least one criterion before completing an ad hoc audit.');
  }

  const rows = (await sql`
    WITH upd AS (
      UPDATE assurance_audits
      SET status = 'COMPLETED', completed_at = now(), updated_at = now(),
          summary = COALESCE(${summary}, summary), recommendations = COALESCE(${recommendations}, recommendations)
      WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid AND status = 'IN_PROGRESS'
      RETURNING id
    ), aud AS (
      ${auditFromCte('upd', {
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_audit',
        verb: 'completed', before: { status: 'IN_PROGRESS' }, after: { status: 'COMPLETED', response_count: answeredKeys.size },
      })}
    )
    SELECT id FROM upd
  `) as unknown[];
  if (rows.length === 0) throw new AssuranceConflictError('This audit was changed by someone else. Refresh and try again.');
}

export async function cancelAudit(viewer: AssuranceViewer, id: string, raw: Record<string, unknown>): Promise<void> {
  if (!viewerCan(viewer, 'close')) throw new AssuranceForbiddenError();
  const reason = requiredText(raw.reason, 'Reason', 2000);
  const state = await getAuditState(viewer, id);
  if (state.status !== 'PLANNED' && state.status !== 'IN_PROGRESS') {
    throw new AssuranceConflictError('Only a planned or in-progress audit can be cancelled.');
  }
  const rows = (await sql`
    WITH upd AS (
      UPDATE assurance_audits SET status = 'CANCELLED', updated_at = now()
      WHERE organisation_id = ${viewer.organisationId} AND id = ${id}::uuid AND status = ${state.status}
      RETURNING id
    ), aud AS (
      ${auditFromCte('upd', {
        organisationId: viewer.organisationId, userId: viewer.userId, resourceType: 'assurance_audit',
        verb: 'cancelled', before: { status: state.status }, after: { status: 'CANCELLED', reason },
      })}
    )
    SELECT id FROM upd
  `) as unknown[];
  if (rows.length === 0) throw new AssuranceConflictError('This audit was changed by someone else. Refresh and try again.');
}

/**
 * Links an EXISTING, visible, open Finding to an Audit (e.g. a repeat
 * issue). New findings are raised through createFinding({ auditId }).
 * The link table is the only relationship; nothing else changes.
 */
export async function linkFindingToAudit(viewer: AssuranceViewer, auditId: string, raw: Record<string, unknown>): Promise<void> {
  if (!viewerCan(viewer, 'record')) throw new AssuranceForbiddenError();
  const findingId = requiredUuid(raw.findingId, 'Finding');
  const state = await getAuditState(viewer, auditId);
  auditId = state.id;
  if (state.status === 'CANCELLED') throw new AssuranceConflictError('Findings cannot be linked to a cancelled audit.');
  const f = (await sql`
    SELECT f.id, f.status FROM assurance_findings f
    WHERE f.organisation_id = ${viewer.organisationId} AND f.id = ${findingId}::uuid AND ${findingVisibleSql(viewer)}
  `) as { id: string; status: string }[];
  if (!f[0]) throw new AssuranceNotFoundError('Finding');
  if (f[0].status === 'CLOSED' || f[0].status === 'CANCELLED') {
    throw new AssuranceConflictError('A closed or cancelled finding cannot be linked.');
  }
  try {
    const results = await sql.transaction([
      sql`SELECT id FROM assurance_audits WHERE organisation_id = ${viewer.organisationId} AND id = ${auditId}::uuid FOR SHARE`,
      sql`SELECT id FROM assurance_findings WHERE organisation_id = ${viewer.organisationId} AND id = ${findingId}::uuid FOR SHARE`,
      sql`
        WITH ins AS (
          INSERT INTO assurance_audit_findings (organisation_id, audit_id, finding_id, created_by)
          SELECT ${viewer.organisationId}, ${auditId}::uuid, ${findingId}::uuid, ${viewer.userId}
          WHERE EXISTS (SELECT 1 FROM assurance_audits a WHERE a.organisation_id = ${viewer.organisationId}
                          AND a.id = ${auditId}::uuid AND a.status <> 'CANCELLED')
            AND EXISTS (SELECT 1 FROM assurance_findings f WHERE f.organisation_id = ${viewer.organisationId}
                          AND f.id = ${findingId}::uuid AND f.status NOT IN ('CLOSED', 'CANCELLED'))
          RETURNING audit_id AS id
        ), aud AS (
          INSERT INTO audit_logs (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state)
          SELECT gen_random_uuid()::text, ${viewer.organisationId}, ${viewer.userId}, 'assurance_audit.finding_linked',
                 'assurance_audit', ins.id::text, NULL, jsonb_build_object('finding_id', ${findingId}::text)
          FROM ins
        )
        SELECT id FROM ins
      `,
    ]);
    if ((results[2] as unknown[]).length === 0) throw new AssuranceConflictError('This audit has been cancelled, or the finding has just been closed.');
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new AssuranceConflictError('That finding is already linked to this audit.');
    throw err;
  }
}
