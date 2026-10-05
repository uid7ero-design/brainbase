import 'server-only';

import sql from '@/lib/db';

export type RestrictedContentActor = {
  organisationId: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type ParticipantRow = {
  participant_id: string | null;
  role_in_case: string | null;
  case_exists: boolean;
  person_exists: boolean;
  created: boolean;
  audit_written: boolean;
};

type RemoveParticipantRow = {
  case_exists: boolean;
  removed_id: string | null;
  audit_written: boolean;
};

type NoteRow = {
  note_id: string | null;
  created_at: Date | string | null;
  audit_written: boolean;
};

function contentLockKey(caseId: string, personId: string): string {
  return `hr-restricted-participant:${caseId}:${personId}`;
}

export async function addRestrictedCaseParticipant(params: {
  actor: RestrictedContentActor;
  caseId: string;
  personId: string;
  roleInCase: string;
}): Promise<
  | { outcome: 'created'; participantId: string; roleInCase: string }
  | { outcome: 'already_participant'; participantId: string; roleInCase: string }
  | { outcome: 'case_not_found' }
  | { outcome: 'person_not_found' }
> {
  const auditId = crypto.randomUUID();
  const [, mutationRows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${contentLockKey(params.caseId, params.personId)}, 0)
      ) AS locked
    `,
    txn`
      WITH case_scope AS MATERIALIZED (
        SELECT id, organisation_id
        FROM hr_restricted_cases
        WHERE id = ${params.caseId}::uuid
          AND organisation_id = ${params.actor.organisationId}
      ),
      person_scope AS MATERIALIZED (
        SELECT id
        FROM hr_people
        WHERE id = ${params.personId}::uuid
          AND organisation_id = ${params.actor.organisationId}
      ),
      inserted AS (
        INSERT INTO hr_restricted_case_participants (
          organisation_id, case_id, person_id, role_in_case
        )
        SELECT case_scope.organisation_id, case_scope.id, person_scope.id, ${params.roleInCase}
        FROM case_scope CROSS JOIN person_scope
        WHERE NOT EXISTS (
          SELECT 1 FROM hr_restricted_case_participants p
          WHERE p.organisation_id = case_scope.organisation_id
            AND p.case_id = case_scope.id
            AND p.person_id = person_scope.id
        )
        RETURNING id, role_in_case
      ),
      existing AS (
        SELECT p.id, p.role_in_case
        FROM hr_restricted_case_participants p
        JOIN case_scope c ON c.id = p.case_id AND c.organisation_id = p.organisation_id
        JOIN person_scope hp ON hp.id = p.person_id
        WHERE NOT EXISTS (SELECT 1 FROM inserted)
        LIMIT 1
      ),
      audited AS (
        INSERT INTO audit_logs (
          id, organisation_id, user_id, action, resource_type, resource_id,
          before_state, after_state, ip_address, user_agent
        )
        SELECT
          ${auditId}, ${params.actor.organisationId}, ${params.actor.userId},
          'hr_restricted_case_participant.added',
          'hr_restricted_case_participant',
          inserted.id::text,
          NULL::jsonb,
          jsonb_build_object(
            'case_id', ${params.caseId},
            'person_id', ${params.personId},
            'role_in_case', inserted.role_in_case
          ),
          ${params.actor.ipAddress ?? null}, ${params.actor.userAgent ?? null}
        FROM inserted
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM case_scope) AS case_exists,
        EXISTS (SELECT 1 FROM person_scope) AS person_exists,
        COALESCE(inserted.id, existing.id)::text AS participant_id,
        COALESCE(inserted.role_in_case, existing.role_in_case) AS role_in_case,
        EXISTS (SELECT 1 FROM inserted) AS created,
        EXISTS (SELECT 1 FROM audited) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN inserted ON TRUE
      LEFT JOIN existing ON TRUE
    `,
  ]);

  const row = (mutationRows as ParticipantRow[])[0];
  if (!row) throw new Error('Restricted HR participant mutation returned no state row.');
  if (!row.case_exists) return { outcome: 'case_not_found' };
  if (!row.person_exists) return { outcome: 'person_not_found' };
  if (!row.participant_id || !row.role_in_case) {
    throw new Error('Restricted HR participant mutation returned no participant row.');
  }
  if (row.created && !row.audit_written) {
    throw new Error('Restricted HR participant add audit was not written.');
  }
  return row.created
    ? { outcome: 'created', participantId: row.participant_id, roleInCase: row.role_in_case }
    : { outcome: 'already_participant', participantId: row.participant_id, roleInCase: row.role_in_case };
}

export async function removeRestrictedCaseParticipant(params: {
  actor: RestrictedContentActor;
  caseId: string;
  personId: string;
}): Promise<
  | { outcome: 'removed' }
  | { outcome: 'already_removed' }
  | { outcome: 'case_not_found' }
> {
  const auditId = crypto.randomUUID();
  const [, mutationRows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${contentLockKey(params.caseId, params.personId)}, 0)
      ) AS locked
    `,
    txn`
      WITH case_scope AS MATERIALIZED (
        SELECT id, organisation_id
        FROM hr_restricted_cases
        WHERE id = ${params.caseId}::uuid
          AND organisation_id = ${params.actor.organisationId}
      ),
      removed AS (
        DELETE FROM hr_restricted_case_participants p
        USING case_scope
        WHERE p.organisation_id = case_scope.organisation_id
          AND p.case_id = case_scope.id
          AND p.person_id = ${params.personId}::uuid
        RETURNING p.id, p.role_in_case
      ),
      audited AS (
        INSERT INTO audit_logs (
          id, organisation_id, user_id, action, resource_type, resource_id,
          before_state, after_state, ip_address, user_agent
        )
        SELECT
          ${auditId}, ${params.actor.organisationId}, ${params.actor.userId},
          'hr_restricted_case_participant.removed',
          'hr_restricted_case_participant',
          removed.id::text,
          jsonb_build_object(
            'case_id', ${params.caseId},
            'person_id', ${params.personId},
            'role_in_case', removed.role_in_case
          ),
          NULL::jsonb,
          ${params.actor.ipAddress ?? null}, ${params.actor.userAgent ?? null}
        FROM removed
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM case_scope) AS case_exists,
        removed.id::text AS removed_id,
        EXISTS (SELECT 1 FROM audited) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN removed ON TRUE
    `,
  ]);

  const row = (mutationRows as RemoveParticipantRow[])[0];
  if (!row) throw new Error('Restricted HR participant removal returned no state row.');
  if (!row.case_exists) return { outcome: 'case_not_found' };
  if (!row.removed_id) return { outcome: 'already_removed' };
  if (!row.audit_written) throw new Error('Restricted HR participant removal audit was not written.');
  return { outcome: 'removed' };
}

export async function createRestrictedCaseNote(params: {
  actor: RestrictedContentActor;
  caseId: string;
  body: string;
}): Promise<{ noteId: string; createdAt: Date | string }> {
  const auditId = crypto.randomUUID();
  const rows = await sql`
    WITH inserted AS (
      INSERT INTO hr_restricted_case_notes (
        organisation_id, case_id, author_id, body
      )
      SELECT c.organisation_id, c.id, ${params.actor.userId}, ${params.body}
      FROM hr_restricted_cases c
      WHERE c.id = ${params.caseId}::uuid
        AND c.organisation_id = ${params.actor.organisationId}
      RETURNING id, case_id, author_id, created_at
    ),
    audited AS (
      INSERT INTO audit_logs (
        id, organisation_id, user_id, action, resource_type, resource_id,
        before_state, after_state, ip_address, user_agent
      )
      SELECT
        ${auditId}, ${params.actor.organisationId}, ${params.actor.userId},
        'hr_restricted_case_note.created',
        'hr_restricted_case_note',
        inserted.id::text,
        NULL::jsonb,
        jsonb_build_object(
          'case_id', inserted.case_id::text,
          'author_id', inserted.author_id
        ),
        ${params.actor.ipAddress ?? null}, ${params.actor.userAgent ?? null}
      FROM inserted
      RETURNING id
    )
    SELECT
      inserted.id::text AS note_id,
      inserted.created_at,
      EXISTS (SELECT 1 FROM audited) AS audit_written
    FROM inserted
  ` as NoteRow[];

  const row = rows[0];
  if (!row?.note_id || row.created_at === null) {
    throw new Error('Restricted HR note insert returned no row.');
  }
  if (!row.audit_written) throw new Error('Restricted HR note create audit was not written.');
  return { noteId: row.note_id, createdAt: row.created_at };
}
