import 'server-only';

import sql from '@/lib/db';
import { RawFileStoreError } from '@/lib/data-hub/storage/rawFileStore';
import {
  buildEmployeeHrDocumentVersionKey,
  createEmployeeHrDocumentStore,
} from '@/lib/hr/employeeDocumentStorage';

export const MAX_EMPLOYEE_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES = [
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

export type EmployeeDocumentMutationActor = {
  organisationId: string;
  userId: string;
  isSuperAdmin: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type PublicEmployeeDocument = {
  id: string;
  person_id: string;
  document_type: string;
  title: string;
  lifecycle_task_id: string | null;
  deleted_at: Date | string | null;
  created_at: Date | string;
};

export type PublicEmployeeDocumentVersion = {
  id: string;
  document_id: string;
  version_number: number;
  uploaded_by: string;
  original_filename: string;
  content_type: string;
  byte_size: number;
  expires_at: Date | string | null;
  is_current: boolean;
  created_at: Date | string;
};

type CreateRow = {
  allowed: boolean;
  person_exists: boolean;
  lifecycle_task_valid: boolean;
  document_id: string | null;
  document_type: string | null;
  title: string | null;
  lifecycle_task_id: string | null;
  document_created_at: Date | string | null;
  version_id: string | null;
  version_number: number | null;
  uploaded_by: string | null;
  original_filename: string | null;
  content_type: string | null;
  byte_size: number | null;
  expires_at: Date | string | null;
  is_current: boolean | null;
  version_created_at: Date | string | null;
  document_audit_written: boolean;
  version_audit_written: boolean;
};

type AddVersionRow = {
  document_exists: boolean;
  allowed: boolean;
  version_id: string | null;
  version_number: number | null;
  uploaded_by: string | null;
  original_filename: string | null;
  content_type: string | null;
  byte_size: number | null;
  expires_at: Date | string | null;
  is_current: boolean | null;
  created_at: Date | string | null;
  version_audit_written: boolean;
  supersede_audit_written: boolean;
};

type DeleteRow = {
  document_exists: boolean;
  allowed: boolean;
  document_id: string | null;
  deleted_at: Date | string | null;
  audit_written: boolean;
};

function sanitiseFilename(name: string): string {
  const cleaned = name.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return (cleaned || 'file').slice(0, 255);
}

function validText(value: string): boolean {
  return value.trim().length > 0;
}

function validateUpload(contentType: string, bytes: Uint8Array):
  | { ok: true }
  | { ok: false; error: string } {
  if (!ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES.includes(
    contentType as (typeof ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES)[number],
  )) {
    return { ok: false, error: `File type "${contentType}" is not allowed.` };
  }
  if (bytes.byteLength === 0) return { ok: false, error: 'File is empty.' };
  if (bytes.byteLength > MAX_EMPLOYEE_DOCUMENT_BYTES) {
    return {
      ok: false,
      error: `File exceeds the ${MAX_EMPLOYEE_DOCUMENT_BYTES / (1024 * 1024)}MB limit.`,
    };
  }
  return { ok: true };
}

async function cleanupBlob(storageKey: string): Promise<void> {
  try {
    await createEmployeeHrDocumentStore().delete(storageKey);
  } catch (err) {
    console.error('[employee HR documents] failed to clean orphaned Blob', err);
  }
}

export async function createEmployeeDocumentWithVersion(params: {
  actor: EmployeeDocumentMutationActor;
  personId: string;
  documentType: string;
  title: string;
  lifecycleTaskId: string | null;
  originalFilename: string;
  contentType: string;
  bytes: Uint8Array;
  expiresAt: string | null;
}): Promise<
  | { outcome: 'created'; document: PublicEmployeeDocument; version: PublicEmployeeDocumentVersion }
  | { outcome: 'forbidden' }
  | { outcome: 'person_not_found' }
  | { outcome: 'lifecycle_task_not_found' }
  | { outcome: 'invalid'; error: string }
  | { outcome: 'storage_error' }
> {
  if (!validText(params.documentType)) return { outcome: 'invalid', error: 'document_type is required.' };
  if (!validText(params.title)) return { outcome: 'invalid', error: 'title is required.' };
  const uploadValidation = validateUpload(params.contentType, params.bytes);
  if (!uploadValidation.ok) return { outcome: 'invalid', error: uploadValidation.error };

  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const documentAuditId = crypto.randomUUID();
  const versionAuditId = crypto.randomUUID();
  const storageKey = buildEmployeeHrDocumentVersionKey(
    params.actor.organisationId,
    params.personId,
    documentId,
    versionId,
  );
  const store = createEmployeeHrDocumentStore();

  try {
    await store.put(storageKey, params.bytes, { contentType: params.contentType });
  } catch (err) {
    if (err instanceof RawFileStoreError) return { outcome: 'storage_error' };
    throw err;
  }

  try {
    const [, rows] = await sql.transaction(txn => [
      txn`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${`hr-employee-document-create:${params.actor.organisationId}:${params.personId}`},
            0
          )
        ) AS locked
      `,
      txn`
        WITH admin_scope AS MATERIALIZED (
          SELECT (
            ${params.actor.isSuperAdmin}
            OR EXISTS (
              SELECT 1 FROM hr_administrators a
              WHERE a.organisation_id = ${params.actor.organisationId}
                AND a.user_id = ${params.actor.userId}
            )
          ) AS allowed
        ),
        person_scope AS MATERIALIZED (
          SELECT p.id, p.organisation_id
          FROM hr_people p
          WHERE p.organisation_id = ${params.actor.organisationId}
            AND p.id = ${params.personId}::uuid
          LIMIT 1
        ),
        lifecycle_task_scope AS MATERIALIZED (
          SELECT t.id
          FROM hr_lifecycle_tasks t
          WHERE ${params.lifecycleTaskId}::text IS NOT NULL
            AND t.organisation_id = ${params.actor.organisationId}
            AND t.id = ${params.lifecycleTaskId}::uuid
            AND t.person_id = ${params.personId}::uuid
          LIMIT 1
        ),
        inserted_document AS (
          INSERT INTO hr_employee_documents (
            id, organisation_id, person_id, document_type, title, lifecycle_task_id
          )
          SELECT
            ${documentId}::uuid, person_scope.organisation_id, person_scope.id,
            ${params.documentType.trim()}, ${params.title.trim()}, ${params.lifecycleTaskId}::uuid
          FROM admin_scope, person_scope
          WHERE admin_scope.allowed = true
            AND (
              ${params.lifecycleTaskId}::text IS NULL
              OR EXISTS (SELECT 1 FROM lifecycle_task_scope)
            )
          RETURNING *
        ),
        inserted_version AS (
          INSERT INTO hr_employee_document_versions (
            id, organisation_id, document_id, version_number, uploaded_by,
            original_filename, content_type, byte_size, storage_key, expires_at, is_current
          )
          SELECT
            ${versionId}::uuid, inserted_document.organisation_id, inserted_document.id, 1,
            ${params.actor.userId}, ${sanitiseFilename(params.originalFilename)},
            ${params.contentType}, ${params.bytes.byteLength}, ${storageKey},
            ${params.expiresAt}::date, true
          FROM inserted_document
          RETURNING *
        ),
        document_audit AS (
          INSERT INTO audit_logs (
            id, organisation_id, user_id, action, resource_type, resource_id,
            before_state, after_state, ip_address, user_agent
          )
          SELECT
            ${documentAuditId}, d.organisation_id, ${params.actor.userId},
            'hr_employee_document.created', 'hr_employee_document', d.id::text,
            NULL::jsonb,
            jsonb_build_object(
              'person_id', d.person_id::text,
              'document_type', d.document_type,
              'title', '[redacted]',
              'lifecycle_task_id', d.lifecycle_task_id::text,
              'deleted_at', d.deleted_at
            ),
            ${params.actor.ipAddress ?? null}, ${params.actor.userAgent ?? null}
          FROM inserted_document d
          RETURNING id
        ),
        version_audit AS (
          INSERT INTO audit_logs (
            id, organisation_id, user_id, action, resource_type, resource_id,
            before_state, after_state, ip_address, user_agent
          )
          SELECT
            ${versionAuditId}, v.organisation_id, ${params.actor.userId},
            'hr_employee_document_version.created', 'hr_employee_document_version', v.id::text,
            NULL::jsonb,
            jsonb_build_object(
              'document_id', v.document_id::text,
              'version_number', v.version_number,
              'uploaded_by', v.uploaded_by,
              'original_filename', '[redacted]',
              'content_type', v.content_type,
              'byte_size', v.byte_size,
              'expires_at', v.expires_at,
              'is_current', v.is_current
            ),
            ${params.actor.ipAddress ?? null}, ${params.actor.userAgent ?? null}
          FROM inserted_version v
          RETURNING id
        )
        SELECT
          (SELECT allowed FROM admin_scope) AS allowed,
          EXISTS (SELECT 1 FROM person_scope) AS person_exists,
          (
            ${params.lifecycleTaskId}::text IS NULL
            OR EXISTS (SELECT 1 FROM lifecycle_task_scope)
          ) AS lifecycle_task_valid,
          d.id::text AS document_id, d.document_type, d.title,
          d.lifecycle_task_id::text AS lifecycle_task_id, d.created_at AS document_created_at,
          v.id::text AS version_id, v.version_number, v.uploaded_by, v.original_filename,
          v.content_type, v.byte_size, v.expires_at, v.is_current,
          v.created_at AS version_created_at,
          EXISTS (SELECT 1 FROM document_audit) AS document_audit_written,
          EXISTS (SELECT 1 FROM version_audit) AS version_audit_written
        FROM (SELECT 1) sentinel
        LEFT JOIN inserted_document d ON TRUE
        LEFT JOIN inserted_version v ON TRUE
      `,
    ]);

    const row = rows[0] as CreateRow | undefined;
    if (!row) throw new Error('Employee document create returned no state row.');
    if (!row.allowed) {
      await cleanupBlob(storageKey);
      return { outcome: 'forbidden' };
    }
    if (!row.person_exists) {
      await cleanupBlob(storageKey);
      return { outcome: 'person_not_found' };
    }
    if (!row.lifecycle_task_valid) {
      await cleanupBlob(storageKey);
      return { outcome: 'lifecycle_task_not_found' };
    }
    if (
      !row.document_id || !row.document_type || !row.title || !row.document_created_at
      || !row.version_id || row.version_number === null || !row.uploaded_by
      || !row.original_filename || !row.content_type || row.byte_size === null
      || row.is_current === null || !row.version_created_at
      || !row.document_audit_written || !row.version_audit_written
    ) {
      throw new Error('Employee document create did not persist business and audit state.');
    }

    return {
      outcome: 'created',
      document: {
        id: row.document_id,
        person_id: params.personId,
        document_type: row.document_type,
        title: row.title,
        lifecycle_task_id: row.lifecycle_task_id,
        deleted_at: null,
        created_at: row.document_created_at,
      },
      version: {
        id: row.version_id,
        document_id: row.document_id,
        version_number: row.version_number,
        uploaded_by: row.uploaded_by,
        original_filename: row.original_filename,
        content_type: row.content_type,
        byte_size: row.byte_size,
        expires_at: row.expires_at,
        is_current: row.is_current,
        created_at: row.version_created_at,
      },
    };
  } catch (err) {
    await cleanupBlob(storageKey);
    throw err;
  }
}

export async function addEmployeeDocumentVersion(params: {
  actor: EmployeeDocumentMutationActor;
  personId: string;
  documentId: string;
  originalFilename: string;
  contentType: string;
  bytes: Uint8Array;
  expiresAt: string | null;
}): Promise<
  | { outcome: 'created'; version: PublicEmployeeDocumentVersion }
  | { outcome: 'forbidden' }
  | { outcome: 'document_not_found' }
  | { outcome: 'invalid'; error: string }
  | { outcome: 'storage_error' }
> {
  const uploadValidation = validateUpload(params.contentType, params.bytes);
  if (!uploadValidation.ok) return { outcome: 'invalid', error: uploadValidation.error };

  const versionId = crypto.randomUUID();
  const versionAuditId = crypto.randomUUID();
  const supersedeAuditId = crypto.randomUUID();
  const storageKey = buildEmployeeHrDocumentVersionKey(
    params.actor.organisationId,
    params.personId,
    params.documentId,
    versionId,
  );
  const store = createEmployeeHrDocumentStore();

  try {
    await store.put(storageKey, params.bytes, { contentType: params.contentType });
  } catch (err) {
    if (err instanceof RawFileStoreError) return { outcome: 'storage_error' };
    throw err;
  }

  try {
    const [, rows] = await sql.transaction(txn => [
      txn`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${`hr-employee-document:${params.actor.organisationId}:${params.documentId}`},
            0
          )
        ) AS locked
      `,
      txn`
        WITH document_scope AS MATERIALIZED (
          SELECT
            d.id, d.organisation_id,
            (
              ${params.actor.isSuperAdmin}
              OR EXISTS (
                SELECT 1 FROM hr_administrators a
                WHERE a.organisation_id = d.organisation_id
                  AND a.user_id = ${params.actor.userId}
              )
            ) AS allowed
          FROM hr_employee_documents d
          WHERE d.organisation_id = ${params.actor.organisationId}
            AND d.person_id = ${params.personId}::uuid
            AND d.id = ${params.documentId}::uuid
            AND d.deleted_at IS NULL
          LIMIT 1
          FOR SHARE OF d
        ),
        current_version AS MATERIALIZED (
          SELECT v.id, v.version_number
          FROM hr_employee_document_versions v
          JOIN document_scope d
            ON d.organisation_id = v.organisation_id
           AND d.id = v.document_id
          WHERE v.is_current = true
          LIMIT 1
        ),
        superseded AS (
          UPDATE hr_employee_document_versions v
          SET is_current = false
          FROM document_scope d
          WHERE v.organisation_id = d.organisation_id
            AND v.document_id = d.id
            AND v.is_current = true
            AND d.allowed = true
          RETURNING v.id, v.organisation_id, v.document_id, v.version_number,
            v.uploaded_by, v.original_filename, v.content_type, v.byte_size,
            v.expires_at, v.is_current
        ),
        inserted AS (
          INSERT INTO hr_employee_document_versions (
            id, organisation_id, document_id, version_number, uploaded_by,
            original_filename, content_type, byte_size, storage_key, expires_at, is_current
          )
          SELECT
            ${versionId}::uuid, d.organisation_id, d.id,
            COALESCE((
              SELECT max(v.version_number) + 1
              FROM hr_employee_document_versions v
              WHERE v.organisation_id = d.organisation_id
                AND v.document_id = d.id
            ), 1),
            ${params.actor.userId}, ${sanitiseFilename(params.originalFilename)},
            ${params.contentType}, ${params.bytes.byteLength}, ${storageKey},
            ${params.expiresAt}::date, true
          FROM document_scope d
          JOIN superseded s
            ON s.organisation_id = d.organisation_id
           AND s.document_id = d.id
          WHERE d.allowed = true
          RETURNING *
        ),
        supersede_audit AS (
          INSERT INTO audit_logs (
            id, organisation_id, user_id, action, resource_type, resource_id,
            before_state, after_state, ip_address, user_agent
          )
          SELECT
            ${supersedeAuditId}, s.organisation_id, ${params.actor.userId},
            'hr_employee_document_version.superseded', 'hr_employee_document_version', s.id::text,
            jsonb_build_object(
              'document_id', s.document_id::text,
              'version_number', s.version_number,
              'is_current', true
            ),
            jsonb_build_object(
              'document_id', s.document_id::text,
              'version_number', s.version_number,
              'is_current', false
            ),
            ${params.actor.ipAddress ?? null}, ${params.actor.userAgent ?? null}
          FROM superseded s
          RETURNING id
        ),
        version_audit AS (
          INSERT INTO audit_logs (
            id, organisation_id, user_id, action, resource_type, resource_id,
            before_state, after_state, ip_address, user_agent
          )
          SELECT
            ${versionAuditId}, v.organisation_id, ${params.actor.userId},
            'hr_employee_document_version.created', 'hr_employee_document_version', v.id::text,
            NULL::jsonb,
            jsonb_build_object(
              'document_id', v.document_id::text,
              'version_number', v.version_number,
              'uploaded_by', v.uploaded_by,
              'original_filename', '[redacted]',
              'content_type', v.content_type,
              'byte_size', v.byte_size,
              'expires_at', v.expires_at,
              'is_current', v.is_current
            ),
            ${params.actor.ipAddress ?? null}, ${params.actor.userAgent ?? null}
          FROM inserted v
          RETURNING id
        )
        SELECT
          EXISTS (SELECT 1 FROM document_scope) AS document_exists,
          COALESCE((SELECT allowed FROM document_scope), false) AS allowed,
          v.id::text AS version_id, v.version_number, v.uploaded_by, v.original_filename,
          v.content_type, v.byte_size, v.expires_at, v.is_current, v.created_at,
          EXISTS (SELECT 1 FROM version_audit) AS version_audit_written,
          (
            NOT EXISTS (SELECT 1 FROM current_version)
            OR EXISTS (SELECT 1 FROM supersede_audit)
          ) AS supersede_audit_written
        FROM (SELECT 1) sentinel
        LEFT JOIN inserted v ON TRUE
      `,
    ]);

    const row = rows[0] as AddVersionRow | undefined;
    if (!row) throw new Error('Employee document version create returned no state row.');
    if (!row.document_exists) {
      await cleanupBlob(storageKey);
      return { outcome: 'document_not_found' };
    }
    if (!row.allowed) {
      await cleanupBlob(storageKey);
      return { outcome: 'forbidden' };
    }
    if (
      !row.version_id || row.version_number === null || !row.uploaded_by
      || !row.original_filename || !row.content_type || row.byte_size === null
      || row.is_current !== true || !row.created_at
      || !row.version_audit_written || !row.supersede_audit_written
    ) {
      throw new Error('Employee document version create did not persist business and audit state.');
    }

    return {
      outcome: 'created',
      version: {
        id: row.version_id,
        document_id: params.documentId,
        version_number: row.version_number,
        uploaded_by: row.uploaded_by,
        original_filename: row.original_filename,
        content_type: row.content_type,
        byte_size: row.byte_size,
        expires_at: row.expires_at,
        is_current: true,
        created_at: row.created_at,
      },
    };
  } catch (err) {
    await cleanupBlob(storageKey);
    throw err;
  }
}

export async function softDeleteEmployeeDocument(params: {
  actor: EmployeeDocumentMutationActor;
  personId: string;
  documentId: string;
}): Promise<
  | { outcome: 'deleted'; deletedAt: Date | string }
  | { outcome: 'document_not_found' }
  | { outcome: 'forbidden' }
> {
  const auditId = crypto.randomUUID();
  const [, rows] = await sql.transaction(txn => [
    txn`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`hr-employee-document:${params.actor.organisationId}:${params.documentId}`},
          0
        )
      ) AS locked
    `,
    txn`
      WITH document_scope AS MATERIALIZED (
        SELECT
          d.id, d.organisation_id, d.person_id, d.document_type, d.title,
          d.lifecycle_task_id, d.deleted_at,
          (
            ${params.actor.isSuperAdmin}
            OR EXISTS (
              SELECT 1 FROM hr_administrators a
              WHERE a.organisation_id = d.organisation_id
                AND a.user_id = ${params.actor.userId}
            )
          ) AS allowed
        FROM hr_employee_documents d
        WHERE d.organisation_id = ${params.actor.organisationId}
          AND d.person_id = ${params.personId}::uuid
          AND d.id = ${params.documentId}::uuid
          AND d.deleted_at IS NULL
        LIMIT 1
        FOR SHARE OF d
      ),
      deleted AS (
        UPDATE hr_employee_documents d
        SET deleted_at = NOW()
        FROM document_scope s
        WHERE d.id = s.id
          AND d.organisation_id = s.organisation_id
          AND s.allowed = true
        RETURNING d.id, d.organisation_id, d.person_id, d.document_type,
          d.title, d.lifecycle_task_id, d.deleted_at
      ),
      audited AS (
        INSERT INTO audit_logs (
          id, organisation_id, user_id, action, resource_type, resource_id,
          before_state, after_state, ip_address, user_agent
        )
        SELECT
          ${auditId}, d.organisation_id, ${params.actor.userId},
          'hr_employee_document.deleted', 'hr_employee_document', d.id::text,
          jsonb_build_object(
            'person_id', d.person_id::text,
            'document_type', d.document_type,
            'title', '[redacted]',
            'lifecycle_task_id', d.lifecycle_task_id::text,
            'deleted_at', NULL
          ),
          jsonb_build_object(
            'person_id', d.person_id::text,
            'document_type', d.document_type,
            'title', '[redacted]',
            'lifecycle_task_id', d.lifecycle_task_id::text,
            'deleted_at', d.deleted_at
          ),
          ${params.actor.ipAddress ?? null}, ${params.actor.userAgent ?? null}
        FROM deleted d
        RETURNING id
      )
      SELECT
        EXISTS (SELECT 1 FROM document_scope) AS document_exists,
        COALESCE((SELECT allowed FROM document_scope), false) AS allowed,
        d.id::text AS document_id, d.deleted_at,
        EXISTS (SELECT 1 FROM audited) AS audit_written
      FROM (SELECT 1) sentinel
      LEFT JOIN deleted d ON TRUE
    `,
  ]);

  const row = rows[0] as DeleteRow | undefined;
  if (!row) throw new Error('Employee document delete returned no state row.');
  if (!row.document_exists) return { outcome: 'document_not_found' };
  if (!row.allowed) return { outcome: 'forbidden' };
  if (!row.document_id || !row.deleted_at || !row.audit_written) {
    throw new Error('Employee document delete did not persist business and audit state.');
  }
  return { outcome: 'deleted', deletedAt: row.deleted_at };
}

export async function downloadEmployeeDocumentVersionBytes(params: {
  storageKey: string;
}): Promise<Uint8Array> {
  const store = createEmployeeHrDocumentStore();
  const { body } = await store.get(params.storageKey, { maxBytes: MAX_EMPLOYEE_DOCUMENT_BYTES });
  return body;
}
