import 'server-only';

import sql from '@/lib/db';

export type EmployeeDocumentAssuranceStatus = {
  acknowledged: boolean;
  acknowledgedAt: Date | string | null;
  latestVerification: {
    decision: 'VERIFIED' | 'REJECTED';
    verifiedAt: Date | string;
  } | null;
};

type AssuranceStatusRow = {
  acknowledged_at: Date | string | null;
  verification_decision: 'VERIFIED' | 'REJECTED' | null;
  verification_at: Date | string | null;
};

/**
 * Reads safe assurance state for one already-authorized immutable document
 * version. Callers must resolve access first through requireEmployeeDocumentVersion.
 *
 * Only the linked employee's acknowledgement is considered. Verification
 * comments, verifier identity, reminder state and document/storage metadata are
 * deliberately not selected.
 */
export async function getEmployeeDocumentAssuranceStatus(params: {
  organisationId: string;
  versionId: string;
  linkedEmployeeUserId: string | null;
}): Promise<EmployeeDocumentAssuranceStatus> {
  const rows = await sql`
    SELECT
      acknowledgement.acknowledged_at,
      verification.decision AS verification_decision,
      verification.verified_at AS verification_at
    FROM (SELECT 1) sentinel
    LEFT JOIN LATERAL (
      SELECT a.acknowledged_at
      FROM hr_employee_document_acknowledgements a
      WHERE a.organisation_id = ${params.organisationId}
        AND a.document_version_id = ${params.versionId}::uuid
        AND ${params.linkedEmployeeUserId}::text IS NOT NULL
        AND a.acknowledged_by = ${params.linkedEmployeeUserId}
      ORDER BY a.acknowledged_at DESC
      LIMIT 1
    ) acknowledgement ON TRUE
    LEFT JOIN LATERAL (
      SELECT v.decision, v.verified_at
      FROM hr_employee_document_verifications v
      WHERE v.organisation_id = ${params.organisationId}
        AND v.document_version_id = ${params.versionId}::uuid
      ORDER BY v.verified_at DESC, v.created_at DESC, v.id DESC
      LIMIT 1
    ) verification ON TRUE
  ` as AssuranceStatusRow[];

  const row = rows[0];
  if (!row) {
    throw new Error('Employee document assurance status returned no state row.');
  }

  const latestVerification = row.verification_decision && row.verification_at
    ? {
        decision: row.verification_decision,
        verifiedAt: row.verification_at,
      }
    : null;

  if ((row.verification_decision === null) !== (row.verification_at === null)) {
    throw new Error('Employee document verification status returned incomplete state.');
  }

  return {
    acknowledged: row.acknowledged_at !== null,
    acknowledgedAt: row.acknowledged_at,
    latestVerification,
  };
}
