import sql from '@/lib/db';

export type EmployeeDocumentAssuranceActor = {
  organisationId: string;
  userId: string;
  isSuperAdmin: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type EmployeeDocumentVerificationDecision = 'VERIFIED' | 'REJECTED';

export type EmployeeDocumentAcknowledgement = {
  id: string;
  documentVersionId: string;
  acknowledgedBy: string;
  acknowledgedAt: Date | string;
};

export type EmployeeDocumentVerification = {
  id: string;
  documentVersionId: string;
  verifiedBy: string;
  decision: EmployeeDocumentVerificationDecision;
  comment: string | null;
  verifiedAt: Date | string;
};

type AcknowledgementMutationRow = {
  version_exists: boolean;
  authorized: boolean;
  acknowledgement_id: string | null;
  acknowledged_by: string | null;
  acknowledged_at: Date | string | null;
  inserted: boolean;
  audit_written: boolean;
};

type VerificationMutationRow = {
  version_exists: boolean;
  authorized: boolean;
  verification_id: string | null;
  verified_by: string | null;
  decision: EmployeeDocumentVerificationDecision | null;
  comment: string | null;
  verified_at: Date | string | null;
  audit_written: boolean;
};

/**
 * Records the linked employee's acknowledgement of one immutable document
 * version. Repeated acknowledgement of the same version by the same employee
 * is idempotent and does not create a second audit event.
 */
export async function acknowledgeEmployeeDocumentVersion(params: {
  actor: EmployeeDocumentAssuranceActor;
  personId: string;
  documentId: string;
  versionId: string;
}): Promise<
  | { outcome: 'recorded'; acknowledgement: EmployeeDocumentAcknowledgement }
  | { outcome: 'already_acknowledged'; acknowledgement: EmployeeDocumentAcknowledgement }
  | { outcome: 'version_not_found' }
  | { outcome: 'forbidden' }
> {
  const acknowledgementId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  const [, rows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`hr-employee-document-ack:${params.actor.organisationId}:${params.versionId}:${params.actor.userId}`},
          0
        )
      ) AS locked
    `,
    txn`
      WITH version_scope AS MATERIALIZED (
        SELECT
          v.id AS version_id,
          v.organisation_id,
          d.id AS document_id,
          d.person_id,
          p.linked_user_id,
          (
            p.linked_user_id IS NOT NULL
            AND p.linked_user_id = ${params.actor.userId}
          ) AS authorized
        FROM hr_employee_document_versions v
        JOIN hr_employee_documents d
          ON d.organisation_id = v.organisation_id
         AND d.id = v.document_id
         AND d.deleted_at IS NULL
        JOIN hr_people p
          ON p.organisation_id = d.organisation_id
         AND p.id = d.person_id
        WHERE v.organisation_id = ${params.actor.organisationId}
          AND v.id = ${params.versionId}::uuid
          AND d.id = ${params.documentId}::uuid
          AND d.person_id = ${params.personId}::uuid
        LIMIT 1
        FOR SHARE OF v, d, p
      ),
      existing_acknowledgement AS MATERIALIZED (
        SELECT a.id, a.document_version_id, a.acknowledged_by, a.acknowledged_at
        FROM hr_employee_document_acknowledgements a
        JOIN version_scope s
          ON s.organisation_id = a.organisation_id
         AND s.version_id = a.document_version_id
        WHERE a.acknowledged_by = ${params.actor.userId}
        LIMIT 1
      ),
      inserted_acknowledgement AS (
        INSERT INTO hr_employee_document_acknowledgements (
          id, organisation_id, document_version_id, acknowledged_by
        )
        SELECT
          ${acknowledgementId}::uuid,
          s.organisation_id,
          s.version_id,
          ${params.actor.userId}
        FROM version_scope s
        WHERE s.authorized = true
          AND NOT EXISTS (SELECT 1 FROM existing_acknowledgement)
        ON CONFLICT (
          organisation_id,
          document_version_id,
          acknowledged_by
        ) DO NOTHING
        RETURNING id, organisation_id, document_version_id, acknowledged_by, acknowledged_at
      ),
      acknowledgement_audit AS (
        INSERT INTO audit_logs (
          id, organisation_id, user_id, action, resource_type, resource_id,
          before_state, after_state, ip_address, user_agent
        )
        SELECT
          ${auditId},
          a.organisation_id,
          ${params.actor.userId},
          'hr_employee_document_acknowledgement.created',
          'hr_employee_document_acknowledgement',
          a.id::text,
          NULL::jsonb,
          jsonb_build_object(
            'document_version_id', a.document_version_id::text,
            'acknowledged_by', a.acknowledged_by,
            'acknowledged_at', a.acknowledged_at
          ),
          ${params.actor.ipAddress ?? null},
          ${params.actor.userAgent ?? null}
        FROM inserted_acknowledgement a
        RETURNING id
      ),
      resolved AS (
        SELECT
          i.id::text AS acknowledgement_id,
          i.acknowledged_by,
          i.acknowledged_at,
          true AS inserted
        FROM inserted_acknowledgement i
        UNION ALL
        SELECT
          e.id::text,
          e.acknowledged_by,
          e.acknowledged_at,
          false
        FROM existing_acknowledgement e
        WHERE NOT EXISTS (SELECT 1 FROM inserted_acknowledgement)
        LIMIT 1
      )
      SELECT
        EXISTS (SELECT 1 FROM version_scope) AS version_exists,
        COALESCE((SELECT authorized FROM version_scope), false) AS authorized,
        r.acknowledgement_id,
        r.acknowledged_by,
        r.acknowledged_at,
        COALESCE(r.inserted, false) AS inserted,
        EXISTS (SELECT 1 FROM acknowledgement_audit) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN resolved r ON TRUE
    `,
  ]);

  const row = (rows as AcknowledgementMutationRow[])[0];
  if (!row) throw new Error('Employee document acknowledgement returned no state row.');
  if (!row.version_exists) return { outcome: 'version_not_found' };
  if (!row.authorized) return { outcome: 'forbidden' };
  if (!row.acknowledgement_id || !row.acknowledged_by || !row.acknowledged_at) {
    throw new Error('Employee document acknowledgement did not resolve persisted state.');
  }
  if (row.inserted && !row.audit_written) {
    throw new Error('Employee document acknowledgement audit was not written.');
  }
  if (!row.inserted && row.audit_written) {
    throw new Error('Existing employee document acknowledgement unexpectedly wrote an audit event.');
  }

  const acknowledgement: EmployeeDocumentAcknowledgement = {
    id: row.acknowledgement_id,
    documentVersionId: params.versionId,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedAt: row.acknowledged_at,
  };

  return row.inserted
    ? { outcome: 'recorded', acknowledgement }
    : { outcome: 'already_acknowledged', acknowledgement };
}

/**
 * Appends one HR verification decision for an immutable document version.
 * Verification history is intentionally append-only; repeated decisions are
 * preserved rather than replacing prior evidence.
 */
export async function verifyEmployeeDocumentVersion(params: {
  actor: EmployeeDocumentAssuranceActor;
  personId: string;
  documentId: string;
  versionId: string;
  decision: EmployeeDocumentVerificationDecision;
  comment: string | null;
}): Promise<
  | { outcome: 'recorded'; verification: EmployeeDocumentVerification }
  | { outcome: 'version_not_found' }
  | { outcome: 'forbidden' }
> {
  const verificationId = crypto.randomUUID();
  const auditId = crypto.randomUUID();

  const [, rows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`hr-employee-document-verify:${params.actor.organisationId}:${params.versionId}`},
          0
        )
      ) AS locked
    `,
    txn`
      WITH version_scope AS MATERIALIZED (
        SELECT
          v.id AS version_id,
          v.organisation_id,
          d.id AS document_id,
          d.person_id,
          (
            ${params.actor.isSuperAdmin}
            OR EXISTS (
              SELECT 1
              FROM hr_administrators a
              WHERE a.organisation_id = v.organisation_id
                AND a.user_id = ${params.actor.userId}
            )
          ) AS authorized
        FROM hr_employee_document_versions v
        JOIN hr_employee_documents d
          ON d.organisation_id = v.organisation_id
         AND d.id = v.document_id
         AND d.deleted_at IS NULL
        WHERE v.organisation_id = ${params.actor.organisationId}
          AND v.id = ${params.versionId}::uuid
          AND d.id = ${params.documentId}::uuid
          AND d.person_id = ${params.personId}::uuid
        LIMIT 1
        FOR SHARE OF v, d
      ),
      inserted_verification AS (
        INSERT INTO hr_employee_document_verifications (
          id, organisation_id, document_version_id,
          verified_by, decision, comment
        )
        SELECT
          ${verificationId}::uuid,
          s.organisation_id,
          s.version_id,
          ${params.actor.userId},
          ${params.decision},
          ${params.comment}
        FROM version_scope s
        WHERE s.authorized = true
        RETURNING
          id, organisation_id, document_version_id,
          verified_by, decision, comment, verified_at
      ),
      verification_audit AS (
        INSERT INTO audit_logs (
          id, organisation_id, user_id, action, resource_type, resource_id,
          before_state, after_state, ip_address, user_agent
        )
        SELECT
          ${auditId},
          v.organisation_id,
          ${params.actor.userId},
          'hr_employee_document_verification.created',
          'hr_employee_document_verification',
          v.id::text,
          NULL::jsonb,
          jsonb_build_object(
            'document_version_id', v.document_version_id::text,
            'verified_by', v.verified_by,
            'decision', v.decision,
            'comment', '[redacted]',
            'verified_at', v.verified_at
          ),
          ${params.actor.ipAddress ?? null},
          ${params.actor.userAgent ?? null}
        FROM inserted_verification v
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM version_scope) AS version_exists,
        COALESCE((SELECT authorized FROM version_scope), false) AS authorized,
        v.id::text AS verification_id,
        v.verified_by,
        v.decision,
        v.comment,
        v.verified_at,
        EXISTS (SELECT 1 FROM verification_audit) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN inserted_verification v ON TRUE
    `,
  ]);

  const row = (rows as VerificationMutationRow[])[0];
  if (!row) throw new Error('Employee document verification returned no state row.');
  if (!row.version_exists) return { outcome: 'version_not_found' };
  if (!row.authorized) return { outcome: 'forbidden' };
  if (
    !row.verification_id
    || !row.verified_by
    || !row.decision
    || !row.verified_at
    || !row.audit_written
  ) {
    throw new Error('Employee document verification did not persist business and audit state.');
  }

  return {
    outcome: 'recorded',
    verification: {
      id: row.verification_id,
      documentVersionId: params.versionId,
      verifiedBy: row.verified_by,
      decision: row.decision,
      comment: row.comment,
      verifiedAt: row.verified_at,
    },
  };
}
