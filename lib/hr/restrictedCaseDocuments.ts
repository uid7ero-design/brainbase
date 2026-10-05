import 'server-only';

import { randomUUID } from 'crypto';
import sql from '@/lib/db';
import { RawFileStoreError } from '@/lib/data-hub/storage/rawFileStore';
import {
  buildRestrictedHrDocumentKey,
  createRestrictedHrDocumentStore,
} from '@/lib/hr/restrictedDocumentStorage';

export const MAX_RESTRICTED_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const ALLOWED_RESTRICTED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
] as const;

export type RestrictedCaseDocument = {
  id: string;
  organisation_id: string;
  case_id: string;
  uploaded_by: string;
  original_filename: string;
  content_type: string;
  byte_size: number;
  storage_key: string;
  deleted_at: Date | string | null;
  created_at: Date | string;
};

export type PublicRestrictedCaseDocument = Omit<
  RestrictedCaseDocument,
  'organisation_id' | 'storage_key'
>;

export type RestrictedDocumentActor = {
  organisationId: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type UploadMutationRow = {
  case_exists: boolean;
  id: string | null;
  uploaded_by: string | null;
  original_filename: string | null;
  content_type: string | null;
  byte_size: number | null;
  deleted_at: Date | string | null;
  created_at: Date | string | null;
  audit_written: boolean;
};

type DeleteMutationRow = {
  case_exists: boolean;
  document_id: string | null;
  storage_key: string | null;
  deleted_at: Date | string | null;
  audit_written: boolean;
};

function sanitiseFilename(name: string): string {
  const cleaned = name.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return (cleaned || 'file').slice(0, 255);
}

function publicDocument(row: RestrictedCaseDocument): PublicRestrictedCaseDocument {
  return {
    id: row.id,
    case_id: row.case_id,
    uploaded_by: row.uploaded_by,
    original_filename: row.original_filename,
    content_type: row.content_type,
    byte_size: row.byte_size,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
  };
}

export async function listRestrictedCaseDocuments(
  organisationId: string,
  caseId: string,
): Promise<RestrictedCaseDocument[]> {
  return await sql`
    SELECT
      id, organisation_id, case_id, uploaded_by, original_filename,
      content_type, byte_size, storage_key, deleted_at, created_at
    FROM hr_restricted_case_documents
    WHERE organisation_id = ${organisationId}
      AND case_id = ${caseId}::uuid
      AND deleted_at IS NULL
    ORDER BY created_at ASC, id ASC
  ` as RestrictedCaseDocument[];
}

export async function getRestrictedCaseDocument(
  organisationId: string,
  caseId: string,
  documentId: string,
): Promise<RestrictedCaseDocument | null> {
  const rows = await sql`
    SELECT
      id, organisation_id, case_id, uploaded_by, original_filename,
      content_type, byte_size, storage_key, deleted_at, created_at
    FROM hr_restricted_case_documents
    WHERE id = ${documentId}::uuid
      AND organisation_id = ${organisationId}
      AND case_id = ${caseId}::uuid
      AND deleted_at IS NULL
    LIMIT 1
  ` as RestrictedCaseDocument[];
  return rows[0] ?? null;
}

export async function uploadRestrictedCaseDocument(params: {
  actor: RestrictedDocumentActor;
  caseId: string;
  originalFilename: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<
  | { outcome: 'created'; document: PublicRestrictedCaseDocument }
  | { outcome: 'case_not_found' }
  | { outcome: 'invalid'; error: string }
  | { outcome: 'storage_error' }
> {
  if (!ALLOWED_RESTRICTED_DOCUMENT_MIME_TYPES.includes(
    params.contentType as (typeof ALLOWED_RESTRICTED_DOCUMENT_MIME_TYPES)[number],
  )) {
    return { outcome: 'invalid', error: `File type "${params.contentType}" is not allowed.` };
  }
  if (params.bytes.byteLength === 0) return { outcome: 'invalid', error: 'File is empty.' };
  if (params.bytes.byteLength > MAX_RESTRICTED_DOCUMENT_BYTES) {
    return {
      outcome: 'invalid',
      error: `File exceeds the ${MAX_RESTRICTED_DOCUMENT_BYTES / (1024 * 1024)}MB limit.`,
    };
  }

  const documentId = randomUUID();
  const auditId = randomUUID();
  const storageKey = buildRestrictedHrDocumentKey(
    params.actor.organisationId,
    params.caseId,
    documentId,
  );
  const store = createRestrictedHrDocumentStore();

  try {
    await store.put(storageKey, params.bytes, { contentType: params.contentType });
  } catch (err) {
    if (err instanceof RawFileStoreError) {
      return { outcome: 'storage_error' };
    }
    throw err;
  }

  try {
    const rows = await sql`
      WITH case_scope AS MATERIALIZED (
        SELECT id, organisation_id
        FROM hr_restricted_cases
        WHERE id = ${params.caseId}::uuid
          AND organisation_id = ${params.actor.organisationId}
      ),
      inserted AS (
        INSERT INTO hr_restricted_case_documents (
          id, organisation_id, case_id, uploaded_by, original_filename,
          content_type, byte_size, storage_key
        )
        SELECT
          ${documentId}::uuid,
          case_scope.organisation_id,
          case_scope.id,
          ${params.actor.userId},
          ${sanitiseFilename(params.originalFilename)},
          ${params.contentType},
          ${params.bytes.byteLength},
          ${storageKey}
        FROM case_scope
        RETURNING id, uploaded_by, original_filename, content_type,
          byte_size, deleted_at, created_at
      ),
      audited AS (
        INSERT INTO audit_logs (
          id, organisation_id, user_id, action, resource_type, resource_id,
          before_state, after_state, ip_address, user_agent
        )
        SELECT
          ${auditId}, ${params.actor.organisationId}, ${params.actor.userId},
          'hr_restricted_case_document.created',
          'hr_restricted_case_document',
          inserted.id::text,
          NULL::jsonb,
          jsonb_build_object(
            'case_id', ${params.caseId},
            'uploaded_by', inserted.uploaded_by,
            'original_filename', '[redacted]',
            'content_type', inserted.content_type,
            'byte_size', inserted.byte_size,
            'deleted_at', inserted.deleted_at
          ),
          ${params.actor.ipAddress ?? null}, ${params.actor.userAgent ?? null}
        FROM inserted
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM case_scope) AS case_exists,
        inserted.id::text AS id,
        inserted.uploaded_by,
        inserted.original_filename,
        inserted.content_type,
        inserted.byte_size,
        inserted.deleted_at,
        inserted.created_at,
        EXISTS (SELECT 1 FROM audited) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN inserted ON TRUE
    ` as UploadMutationRow[];

    const row = rows[0];
    if (!row?.case_exists) {
      try { await store.delete(storageKey); } catch { /* best effort */ }
      return { outcome: 'case_not_found' };
    }
    if (
      !row.id || !row.uploaded_by || !row.original_filename ||
      !row.content_type || row.byte_size === null || row.created_at === null ||
      !row.audit_written
    ) {
      throw new Error('Restricted HR document insert/audit invariant failed.');
    }

    return {
      outcome: 'created',
      document: {
        id: row.id,
        case_id: params.caseId,
        uploaded_by: row.uploaded_by,
        original_filename: row.original_filename,
        content_type: row.content_type,
        byte_size: row.byte_size,
        deleted_at: row.deleted_at,
        created_at: row.created_at,
      },
    };
  } catch (err) {
    try { await store.delete(storageKey); } catch (cleanupErr) {
      console.error('[restricted HR documents] failed to clean orphaned Blob after DB failure', cleanupErr);
    }
    throw err;
  }
}

export async function downloadRestrictedCaseDocumentBytes(
  document: RestrictedCaseDocument,
): Promise<Uint8Array> {
  const store = createRestrictedHrDocumentStore();
  const { body } = await store.get(document.storage_key, { maxBytes: MAX_RESTRICTED_DOCUMENT_BYTES });
  return body;
}

export async function softDeleteRestrictedCaseDocument(params: {
  actor: RestrictedDocumentActor;
  caseId: string;
  documentId: string;
}): Promise<
  | { outcome: 'deleted'; deletedAt: Date | string }
  | { outcome: 'not_found' }
> {
  const auditId = randomUUID();
  const rows = await sql`
    WITH case_scope AS MATERIALIZED (
      SELECT id, organisation_id
      FROM hr_restricted_cases
      WHERE id = ${params.caseId}::uuid
        AND organisation_id = ${params.actor.organisationId}
    ),
    deleted AS (
      UPDATE hr_restricted_case_documents d
      SET deleted_at = NOW()
      FROM case_scope
      WHERE d.id = ${params.documentId}::uuid
        AND d.organisation_id = case_scope.organisation_id
        AND d.case_id = case_scope.id
        AND d.deleted_at IS NULL
      RETURNING d.id, d.case_id, d.uploaded_by, d.original_filename,
        d.content_type, d.byte_size, d.storage_key, d.deleted_at
    ),
    audited AS (
      INSERT INTO audit_logs (
        id, organisation_id, user_id, action, resource_type, resource_id,
        before_state, after_state, ip_address, user_agent
      )
      SELECT
        ${auditId}, ${params.actor.organisationId}, ${params.actor.userId},
        'hr_restricted_case_document.deleted',
        'hr_restricted_case_document',
        deleted.id::text,
        NULL::jsonb,
        jsonb_build_object(
          'case_id', deleted.case_id::text,
          'uploaded_by', deleted.uploaded_by,
          'original_filename', '[redacted]',
          'content_type', deleted.content_type,
          'byte_size', deleted.byte_size,
          'deleted_at', deleted.deleted_at
        ),
        ${params.actor.ipAddress ?? null}, ${params.actor.userAgent ?? null}
      FROM deleted
      RETURNING id
    )
    SELECT
      EXISTS (SELECT 1 FROM case_scope) AS case_exists,
      deleted.id::text AS document_id,
      deleted.storage_key,
      deleted.deleted_at,
      EXISTS (SELECT 1 FROM audited) AS audit_written
    FROM (SELECT 1) sentinel
    LEFT JOIN deleted ON TRUE
  ` as DeleteMutationRow[];

  const row = rows[0];
  if (!row?.case_exists || !row.document_id || !row.storage_key || row.deleted_at === null) {
    return { outcome: 'not_found' };
  }
  if (!row.audit_written) throw new Error('Restricted HR document delete audit was not written.');

  try {
    const store = createRestrictedHrDocumentStore();
    await store.delete(row.storage_key);
  } catch (err) {
    console.error('[restricted HR documents] failed to delete Blob after metadata soft-delete (ignored)', err);
  }

  return { outcome: 'deleted', deletedAt: row.deleted_at };
}

export { publicDocument as toPublicRestrictedCaseDocument };
