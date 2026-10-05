import 'server-only';

import sql from '@/lib/db';
import type { OrgSession } from '@/lib/org';
import {
  canManageEmployeeDocument,
  canViewEmployeeDocument,
} from './employeeDocumentAccess';

export type EmployeeDocumentListItem = {
  id: string;
  documentType: string;
  title: string;
  lifecycleTaskId: string | null;
  createdAt: Date | string;
  currentVersion: {
    id: string;
    versionNumber: number;
    expiresAt: Date | string | null;
    createdAt: Date | string;
  } | null;
};

type PersonAccessRow = {
  organisation_id: string;
  linked_user_id: string | null;
  is_hr_administrator: boolean;
};

type DocumentListRow = {
  document_id: string;
  document_type: string;
  title: string;
  lifecycle_task_id: string | null;
  document_created_at: Date | string;
  version_id: string | null;
  version_number: number | null;
  expires_at: Date | string | null;
  version_created_at: Date | string | null;
};

/**
 * Lists live employee documents for one person after enforcing the dedicated
 * employee-document authority model: linked employee self-access or active HR
 * administration only. Direct-manager profile access does not imply document
 * access.
 */
export async function listEmployeeDocumentsForPerson(
  session: OrgSession,
  personId: string,
): Promise<
  | {
      outcome: 'ok';
      canManageDocuments: boolean;
      documents: EmployeeDocumentListItem[];
    }
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
      ) AS is_hr_administrator
    FROM hr_people p
    WHERE p.id = ${personId}::uuid
      AND p.organisation_id = ${session.organisationId}
    LIMIT 1
  ` as PersonAccessRow[];

  const person = accessRows[0];
  if (!person) return { outcome: 'not_found' };

  const allowed = canViewEmployeeDocument(
    {
      organisationId: session.organisationId,
      userId: session.userId,
      isHrAdministrator: person.is_hr_administrator,
    },
    {
      organisationId: person.organisation_id,
      personLinkedUserId: person.linked_user_id,
    },
  );
  if (!allowed) return { outcome: 'not_found' };

  const rows = await sql`
    SELECT
      d.id::text AS document_id,
      d.document_type,
      d.title,
      d.lifecycle_task_id::text AS lifecycle_task_id,
      d.created_at AS document_created_at,
      v.id::text AS version_id,
      v.version_number,
      v.expires_at,
      v.created_at AS version_created_at
    FROM hr_employee_documents d
    LEFT JOIN hr_employee_document_versions v
      ON v.organisation_id = d.organisation_id
     AND v.document_id = d.id
     AND v.is_current = TRUE
    WHERE d.organisation_id = ${session.organisationId}
      AND d.person_id = ${personId}::uuid
      AND d.deleted_at IS NULL
    ORDER BY d.created_at DESC, d.id DESC
  ` as DocumentListRow[];

  return {
    outcome: 'ok',
    canManageDocuments: canManageEmployeeDocument(
      {
        organisationId: session.organisationId,
        userId: session.userId,
        isHrAdministrator: person.is_hr_administrator,
      },
      { organisationId: person.organisation_id },
    ),
    documents: rows.map(row => ({
      id: row.document_id,
      documentType: row.document_type,
      title: row.title,
      lifecycleTaskId: row.lifecycle_task_id,
      createdAt: row.document_created_at,
      currentVersion: row.version_id && row.version_number !== null && row.version_created_at
        ? {
            id: row.version_id,
            versionNumber: Number(row.version_number),
            expiresAt: row.expires_at,
            createdAt: row.version_created_at,
          }
        : null,
    })),
  };
}
