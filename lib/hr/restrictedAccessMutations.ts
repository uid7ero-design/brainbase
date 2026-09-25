import 'server-only';

import { NeonDbError } from '@neondatabase/serverless';
import sql from '@/lib/db';

const LIVE_GRANT_UNIQUE_INDEX = 'hr_restricted_case_access_one_live_grant';

function restrictedAccessLockKey(caseId: string, targetUserId: string): string {
  return `${caseId}:${targetUserId}`;
}

export type RestrictedAccessMutationActor = {
  organisationId: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type GrantRestrictedCaseAccessParams = {
  actor: RestrictedAccessMutationActor;
  caseId: string;
  targetUserId: string;
};

export type GrantRestrictedCaseAccessResult =
  | {
      outcome: 'granted';
      grantId: string;
      grantedAt: Date | string;
    }
  | { outcome: 'already_granted' }
  | { outcome: 'case_not_found' }
  | { outcome: 'target_not_eligible' };

export type RevokeRestrictedCaseAccessParams = {
  actor: RestrictedAccessMutationActor;
  caseId: string;
  targetUserId: string;
};

export type RevokeRestrictedCaseAccessResult =
  | {
      outcome: 'revoked';
      grantId: string;
      revokedAt: Date | string;
    }
  | { outcome: 'already_revoked' }
  | { outcome: 'case_not_found' };

type GrantMutationRow = {
  case_exists: boolean;
  target_eligible: boolean;
  grant_id: string | null;
  granted_at: Date | string | null;
  audit_written: boolean;
};

type RevokeMutationRow = {
  case_exists: boolean;
  grant_id: string | null;
  revoked_at: Date | string | null;
  audit_written: boolean;
};

/**
 * PostgreSQL reports partial-unique index collisions through the same 23505
 * error shape as ordinary UNIQUE constraints. Match the exact index name so
 * only the expected live-grant race becomes an idempotent success; unrelated
 * uniqueness failures remain real errors.
 */
export function isLiveRestrictedGrantUniqueViolation(err: unknown): boolean {
  return err instanceof NeonDbError
    && err.code === '23505'
    && err.constraint === LIVE_GRANT_UNIQUE_INDEX;
}

/**
 * Creates one new live per-case restricted-HR grant under a deterministic
 * per-(case,user) advisory transaction lock. Statement 1 acquires the lock;
 * statement 2 gets a fresh READ COMMITTED snapshot and performs the mutation
 * plus audit in one writable CTE, so either both persist or neither does.
 *
 * A pre-existing live row makes `inserted` empty, producing an idempotent
 * already_granted outcome and no audit row. Two concurrent callers can both
 * observe no live row before insertion, so the partial unique index remains
 * the final authority; the losing request's exact named 23505 is collapsed to
 * already_granted. Historical revoked rows are never updated or resurrected,
 * therefore granting after revoke always creates a fresh row.
 *
 * The SQL independently re-checks active-org case scope and ACTIVE same-org
 * target eligibility at the write boundary, so a stale route-level validation
 * cannot create a cross-org or newly-inactive grant.
 */
export async function grantRestrictedCaseAccess(
  params: GrantRestrictedCaseAccessParams,
): Promise<GrantRestrictedCaseAccessResult> {
  const auditId = crypto.randomUUID();

  let rows: GrantMutationRow[];
  try {
    const [, mutationRows] = await sql.transaction(txn => [
      txn`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${restrictedAccessLockKey(params.caseId, params.targetUserId)}, 0)
        ) AS locked
      `,
      txn`
      WITH case_scope AS MATERIALIZED (
        SELECT id, organisation_id
        FROM hr_restricted_cases
        WHERE id = ${params.caseId}::uuid
          AND organisation_id = ${params.actor.organisationId}
        FOR SHARE
      ),
      target_scope AS MATERIALIZED (
        SELECT id
        FROM users
        WHERE id = ${params.targetUserId}
          AND organisation_id = ${params.actor.organisationId}
          AND status = 'ACTIVE'
        FOR SHARE
      ),
      inserted AS (
        INSERT INTO hr_restricted_case_access (
          organisation_id,
          case_id,
          user_id,
          granted_by
        )
        SELECT
          case_scope.organisation_id,
          case_scope.id,
          target_scope.id,
          ${params.actor.userId}
        FROM case_scope
        CROSS JOIN target_scope
        WHERE NOT EXISTS (
          SELECT 1
          FROM hr_restricted_case_access existing
          WHERE existing.organisation_id = case_scope.organisation_id
            AND existing.case_id = case_scope.id
            AND existing.user_id = target_scope.id
            AND existing.revoked_at IS NULL
        )
        RETURNING id, case_id, user_id, granted_by, granted_at
      ),
      audited AS (
        INSERT INTO audit_logs (
          id,
          organisation_id,
          user_id,
          action,
          resource_type,
          resource_id,
          before_state,
          after_state,
          ip_address,
          user_agent
        )
        SELECT
          ${auditId},
          ${params.actor.organisationId},
          ${params.actor.userId},
          'hr_restricted_case_access.granted',
          'hr_restricted_case_access',
          inserted.id::text,
          NULL::jsonb,
          jsonb_build_object(
            'case_id', inserted.case_id::text,
            'user_id', inserted.user_id,
            'granted_by', inserted.granted_by,
            'granted_at', inserted.granted_at
          ),
          ${params.actor.ipAddress ?? null},
          ${params.actor.userAgent ?? null}
        FROM inserted
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM case_scope) AS case_exists,
        EXISTS (SELECT 1 FROM target_scope) AS target_eligible,
        inserted.id::text AS grant_id,
        inserted.granted_at,
        EXISTS (SELECT 1 FROM audited) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN inserted ON TRUE
      `,
    ]);
    rows = mutationRows as GrantMutationRow[];
  } catch (err) {
    if (isLiveRestrictedGrantUniqueViolation(err)) {
      return { outcome: 'already_granted' };
    }
    throw err;
  }

  const row = rows[0];
  if (!row) throw new Error('Restricted HR grant mutation returned no state row.');
  if (!row.case_exists) return { outcome: 'case_not_found' };
  if (!row.target_eligible) return { outcome: 'target_not_eligible' };
  if (!row.grant_id) return { outcome: 'already_granted' };
  if (!row.audit_written || row.granted_at === null) {
    throw new Error('Restricted HR grant audit was not written.');
  }

  return {
    outcome: 'granted',
    grantId: row.grant_id,
    grantedAt: row.granted_at,
  };
}

/**
 * Revokes the one current live grant by UPDATE (never DELETE) under the same
 * deterministic per-(case,user) advisory transaction lock used by grant. The
 * second statement receives a fresh READ COMMITTED snapshot after any lock
 * wait, then writes revoke + audit in one writable CTE. Grant-vs-revoke and
 * revoke-vs-revoke therefore serialize on the exact same logical key.
 *
 * The target user's current ACTIVE status is intentionally irrelevant here:
 * access must remain revocable after the account becomes inactive. Historical
 * revoked rows are never touched.
 */
export async function revokeRestrictedCaseAccess(
  params: RevokeRestrictedCaseAccessParams,
): Promise<RevokeRestrictedCaseAccessResult> {
  const auditId = crypto.randomUUID();

  const [, mutationRows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${restrictedAccessLockKey(params.caseId, params.targetUserId)}, 0)
      ) AS locked
    `,
    txn`
    WITH case_scope AS MATERIALIZED (
      SELECT id, organisation_id
      FROM hr_restricted_cases
      WHERE id = ${params.caseId}::uuid
        AND organisation_id = ${params.actor.organisationId}
      FOR SHARE
    ),
    revoked AS (
      UPDATE hr_restricted_case_access access
      SET
        revoked_at = NOW(),
        revoked_by = ${params.actor.userId}
      FROM case_scope
      WHERE access.organisation_id = case_scope.organisation_id
        AND access.case_id = case_scope.id
        AND access.user_id = ${params.targetUserId}
        AND access.revoked_at IS NULL
      RETURNING access.id, access.case_id, access.user_id, access.revoked_by, access.revoked_at
    ),
    audited AS (
      INSERT INTO audit_logs (
        id,
        organisation_id,
        user_id,
        action,
        resource_type,
        resource_id,
        before_state,
        after_state,
        ip_address,
        user_agent
      )
      SELECT
        ${auditId},
        ${params.actor.organisationId},
        ${params.actor.userId},
        'hr_restricted_case_access.revoked',
        'hr_restricted_case_access',
        revoked.id::text,
        NULL::jsonb,
        jsonb_build_object(
          'case_id', revoked.case_id::text,
          'user_id', revoked.user_id,
          'revoked_by', revoked.revoked_by,
          'revoked_at', revoked.revoked_at
        ),
        ${params.actor.ipAddress ?? null},
        ${params.actor.userAgent ?? null}
      FROM revoked
      RETURNING id
    )
    SELECT
      EXISTS (SELECT 1 FROM case_scope) AS case_exists,
      revoked.id::text AS grant_id,
      revoked.revoked_at,
      EXISTS (SELECT 1 FROM audited) AS audit_written
    FROM (SELECT 1) sentinel
    LEFT JOIN revoked ON TRUE
    `,
  ]);
  const rows = mutationRows as RevokeMutationRow[];

  const row = rows[0];
  if (!row) throw new Error('Restricted HR revoke mutation returned no state row.');
  if (!row.case_exists) return { outcome: 'case_not_found' };
  if (!row.grant_id) return { outcome: 'already_revoked' };
  if (!row.audit_written || row.revoked_at === null) {
    throw new Error('Restricted HR revoke audit was not written.');
  }

  return {
    outcome: 'revoked',
    grantId: row.grant_id,
    revokedAt: row.revoked_at,
  };
}
