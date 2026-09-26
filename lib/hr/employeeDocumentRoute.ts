import 'server-only';

import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import type { OrgSession } from '@/lib/org';
import {
  canViewEmployeeDocument,
  type EmployeeDocumentAccessTarget,
  type EmployeeDocumentActorContext,
} from './employeeDocumentAccess';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isEmployeeDocumentResourceId(value: string): boolean {
  return UUID_RE.test(value);
}

export function employeeDocumentNotFoundResponse(): NextResponse {
  return NextResponse.json({ error: 'Employee document not found.' }, { status: 404 });
}

export async function isEmployeeDocumentAdministrator(session: OrgSession): Promise<boolean> {
  if (session.role === 'super_admin') return true;
  const rows = await sql`
    SELECT EXISTS (
      SELECT 1
      FROM hr_administrators a
      WHERE a.organisation_id = ${session.organisationId}
        AND a.user_id = ${session.userId}
    ) AS allowed
  `;
  return (rows[0] as { allowed?: boolean } | undefined)?.allowed === true;
}

export type EmployeeDocumentRow = {
  id: string;
  organisationId: string;
  personId: string;
  documentType: string;
  title: string;
  lifecycleTaskId: string | null;
  deletedAt: Date | string | null;
  createdAt: Date | string;
};

export type EmployeeDocumentVersionRow = {
  id: string;
  organisationId: string;
  documentId: string;
  versionNumber: number;
  uploadedBy: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  storageKey: string;
  expiresAt: Date | string | null;
  isCurrent: boolean;
  createdAt: Date | string;
};

export type EmployeeDocumentAuthorizationFacts = {
  actor: EmployeeDocumentActorContext;
  target: EmployeeDocumentAccessTarget;
};

export type EmployeeDocumentRouteResult =
  | {
      ok: true;
      document: EmployeeDocumentRow;
      auth: EmployeeDocumentAuthorizationFacts;
    }
  | { ok: false; response: NextResponse };

export type EmployeeDocumentVersionRouteResult =
  | {
      ok: true;
      document: EmployeeDocumentRow;
      version: EmployeeDocumentVersionRow;
      auth: EmployeeDocumentAuthorizationFacts;
    }
  | { ok: false; response: NextResponse };

function actorFromRow(
  session: OrgSession,
  row: Record<string, unknown>,
): EmployeeDocumentActorContext {
  return {
    organisationId: session.organisationId,
    userId: session.userId,
    isHrAdministrator: row.is_hr_administrator === true,
  };
}

function targetFromRow(row: Record<string, unknown>): EmployeeDocumentAccessTarget {
  return {
    organisationId: row.organisation_id as string,
    personLinkedUserId: (row.person_linked_user_id as string | null) ?? null,
  };
}

function documentFromRow(row: Record<string, unknown>): EmployeeDocumentRow {
  return {
    id: row.document_id as string,
    organisationId: row.organisation_id as string,
    personId: row.person_id as string,
    documentType: row.document_type as string,
    title: row.title as string,
    lifecycleTaskId: (row.lifecycle_task_id as string | null) ?? null,
    deletedAt: (row.deleted_at as Date | string | null) ?? null,
    createdAt: row.document_created_at as Date | string,
  };
}

/**
 * Canonical resolver for a live logical employee document.
 * Malformed, nonexistent, cross-org, deleted, and inaccessible resources all
 * collapse to the same 404 so HR document identity cannot be enumerated.
 */
export async function requireEmployeeDocument(
  session: OrgSession,
  personId: string,
  documentId: string,
): Promise<EmployeeDocumentRouteResult> {
  if (
    !isEmployeeDocumentResourceId(personId)
    || !isEmployeeDocumentResourceId(documentId)
  ) {
    return { ok: false, response: employeeDocumentNotFoundResponse() };
  }

  const isSuperAdmin = session.role === 'super_admin';
  const rows = await sql`
    SELECT
      d.id::text AS document_id,
      d.organisation_id,
      d.person_id::text AS person_id,
      d.document_type,
      d.title,
      d.lifecycle_task_id::text AS lifecycle_task_id,
      d.deleted_at,
      d.created_at AS document_created_at,
      p.linked_user_id AS person_linked_user_id,
      (
        ${isSuperAdmin}
        OR EXISTS (
          SELECT 1
          FROM hr_administrators a
          WHERE a.organisation_id = d.organisation_id
            AND a.user_id = ${session.userId}
        )
      ) AS is_hr_administrator
    FROM hr_employee_documents d
    JOIN hr_people p
      ON p.organisation_id = d.organisation_id
     AND p.id = d.person_id
    WHERE d.id = ${documentId}::uuid
      AND d.person_id = ${personId}::uuid
      AND d.organisation_id = ${session.organisationId}
      AND d.deleted_at IS NULL
    LIMIT 1
  `;

  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return { ok: false, response: employeeDocumentNotFoundResponse() };

  const actor = actorFromRow(session, row);
  const target = targetFromRow(row);
  if (!canViewEmployeeDocument(actor, target)) {
    return { ok: false, response: employeeDocumentNotFoundResponse() };
  }

  return {
    ok: true,
    document: documentFromRow(row),
    auth: { actor, target },
  };
}

/**
 * Resolves an immutable version under one live logical document.
 * storageKey remains server-only and is returned only to authenticated server
 * orchestration, never directly to a client response.
 */
export async function requireEmployeeDocumentVersion(
  session: OrgSession,
  personId: string,
  documentId: string,
  versionId: string,
): Promise<EmployeeDocumentVersionRouteResult> {
  if (
    !isEmployeeDocumentResourceId(personId)
    || !isEmployeeDocumentResourceId(documentId)
    || !isEmployeeDocumentResourceId(versionId)
  ) {
    return { ok: false, response: employeeDocumentNotFoundResponse() };
  }

  const isSuperAdmin = session.role === 'super_admin';
  const rows = await sql`
    SELECT
      d.id::text AS document_id,
      d.organisation_id,
      d.person_id::text AS person_id,
      d.document_type,
      d.title,
      d.lifecycle_task_id::text AS lifecycle_task_id,
      d.deleted_at,
      d.created_at AS document_created_at,
      v.id::text AS version_id,
      v.version_number,
      v.uploaded_by,
      v.original_filename,
      v.content_type,
      v.byte_size,
      v.storage_key,
      v.expires_at,
      v.is_current,
      v.created_at AS version_created_at,
      p.linked_user_id AS person_linked_user_id,
      (
        ${isSuperAdmin}
        OR EXISTS (
          SELECT 1
          FROM hr_administrators a
          WHERE a.organisation_id = d.organisation_id
            AND a.user_id = ${session.userId}
        )
      ) AS is_hr_administrator
    FROM hr_employee_documents d
    JOIN hr_employee_document_versions v
      ON v.organisation_id = d.organisation_id
     AND v.document_id = d.id
    JOIN hr_people p
      ON p.organisation_id = d.organisation_id
     AND p.id = d.person_id
    WHERE d.id = ${documentId}::uuid
      AND d.person_id = ${personId}::uuid
      AND d.organisation_id = ${session.organisationId}
      AND d.deleted_at IS NULL
      AND v.id = ${versionId}::uuid
    LIMIT 1
  `;

  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return { ok: false, response: employeeDocumentNotFoundResponse() };

  const actor = actorFromRow(session, row);
  const target = targetFromRow(row);
  if (!canViewEmployeeDocument(actor, target)) {
    return { ok: false, response: employeeDocumentNotFoundResponse() };
  }

  return {
    ok: true,
    document: documentFromRow(row),
    version: {
      id: row.version_id as string,
      organisationId: row.organisation_id as string,
      documentId: row.document_id as string,
      versionNumber: Number(row.version_number),
      uploadedBy: row.uploaded_by as string,
      originalFilename: row.original_filename as string,
      contentType: row.content_type as string,
      byteSize: Number(row.byte_size),
      storageKey: row.storage_key as string,
      expiresAt: (row.expires_at as Date | string | null) ?? null,
      isCurrent: row.is_current === true,
      createdAt: row.version_created_at as Date | string,
    },
    auth: { actor, target },
  };
}
