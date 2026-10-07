import 'server-only';

import sql from '@/lib/db';
import type { OrgSession } from '@/lib/org';
import { canViewEmployeeDocument } from './employeeDocumentAccess';

export type EmployeeDocumentVersionListItem = {
  id: string;
  versionNumber: number;
  expiresAt: Date | string | null;
  isCurrent: boolean;
  createdAt: Date | string;
};

type DocumentAccessRow = {
  organisation_id: string;
  linked_user_id: string | null;
  is_hr_administrator: boolean;
  document_id: string;
};

type VersionListRow = {
  version_id: string;
  version_number: number;
  expires_at: Date | string | null;
  is_current: boolean;
  created_at: Date | string;
};

/**
 * Lists immutable versions for one live employee document after enforcing the
 * dedicated employee-document authority model. Historical-version access is
 * identical to current-version access: linked employee self-access or active
 * HR administration only.
 */
export async function listEmployeeDocumentVersions(
  session: OrgSession,
  personId: string,
  documentId: string,
): Promise<
  | { outcome: 'ok'; versions: EmployeeDocumentVersionListItem[] }
  | { outcome: 'not_found' }
> {
  const isSuperAdmin = session.role === 'super_admin';
  const accessRows = await sql`
    SELECT
      p.organisation_id,
      p.linked_user_id,
      (
        ${isSuperAdmin}
        OR EXISTS (
          SELECT 1
          FROM hr_administrators a
          WHERE a.organisation_id = p.organisation_id
            AND a.user_id = ${session.userId}
        )
      ) AS is_hr_administrator,
      d.id::text AS document_id
    FROM hr_people p
    JOIN hr_employee_documents d
      ON d.organisation_id = p.organisation_id
     AND d.person_id = p.id
     AND d.id = ${documentId}::uuid
     AND d.deleted_at IS NULL
    WHERE p.id = ${personId}::uuid
      AND p.organisation_id = ${session.organisationId}
    LIMIT 1
  ` as DocumentAccessRow[];

  const target = accessRows[0];
  if (!target) return { outcome: 'not_found' };

  const allowed = canViewEmployeeDocument(
    {
      organisationId: session.organisationId,
      userId: session.userId,
      isHrAdministrator: target.is_hr_administrator,
    },
    {
      organisationId: target.organisation_id,
      personLinkedUserId: target.linked_user_id,
    },
  );
  if (!allowed) return { outcome: 'not_found' };

  const rows = await sql`
    SELECT
      v.id::text AS version_id,
      v.version_number,
      v.expires_at,
      v.is_current,
      v.created_at
    FROM hr_employee_document_versions v
    WHERE v.organisation_id = ${session.organisationId}
      AND v.document_id = ${target.document_id}::uuid
    ORDER BY v.version_number DESC, v.created_at DESC, v.id DESC
  ` as VersionListRow[];

  return {
    outcome: 'ok',
    versions: rows.map(row => ({
      id: row.version_id,
      versionNumber: Number(row.version_number),
      expiresAt: row.expires_at,
      isCurrent: row.is_current,
      createdAt: row.created_at,
    })),
  };
}
