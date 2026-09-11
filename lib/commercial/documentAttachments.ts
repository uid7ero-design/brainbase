import 'server-only';
import { randomUUID } from 'crypto';
import sql from '@/lib/db';
import { createCommercialAttachmentStore, buildCommercialAttachmentKey } from './attachmentStorage';
import { RawFileStoreError } from '@/lib/data-hub/storage/rawFileStore';
import { logCommercialAttachmentUploaded, logCommercialAttachmentRemoved } from './auditLog';

// C6.9 remediation — tenant-scoped data access + storage orchestration
// for commercial_document_attachments (see
// scripts/create-commercial-document-attachments.sql for the schema and
// its full rationale). Mirrors lib/commercial/documentDeliveries.ts's
// polymorphic-write-gating discipline exactly: the raw insert/delete
// primitives are NOT exported — every real write goes through
// uploadPurchaseOrderAttachment()/removePurchaseOrderAttachment() below,
// which each hardcode documentType = 'purchase_order' and require the
// caller to pass the already-resolved parent PO row (never a bare id
// string), asserting tenant ownership before anything is written.

export type CommercialAttachmentCategory = 'SUPPLIER_QUOTE' | 'SPECIFICATION' | 'SCOPE_OF_WORK' | 'APPROVAL' | 'OTHER';
export type CommercialAttachmentDocumentType = 'purchase_order';

const VALID_CATEGORIES: CommercialAttachmentCategory[] = ['SUPPLIER_QUOTE', 'SPECIFICATION', 'SCOPE_OF_WORK', 'APPROVAL', 'OTHER'];

// No central, app-wide upload-limits policy exists to inherit (checked:
// nothing outside Data Hub's own spreadsheet-specific ingestion limits).
// These are this feature's own, narrowly-scoped defaults — deliberately
// conservative for a "supplier quote / spec / approval document" use
// case, not a general-purpose file store.
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
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

export interface CommercialDocumentAttachment {
  id: string;
  organisation_id: string;
  document_type: CommercialAttachmentDocumentType;
  document_id: string;
  category: CommercialAttachmentCategory;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface CommercialDocumentAttachmentWithUploader extends CommercialDocumentAttachment {
  uploaded_by_name: string | null;
}

function assertSameOrganisation(organisationId: string, documentOrganisationId: string, documentType: CommercialAttachmentDocumentType): void {
  if (documentOrganisationId !== organisationId) {
    // Same "never reachable via any real call site today, loud fail-safe
    // against a future refactor" reasoning as
    // documentDeliveries.ts's identical assertion.
    throw new Error(`Tenant mismatch uploading a ${documentType} attachment: document belongs to a different organisation.`);
  }
}

// original_filename is sanitised for display/metadata only — it is
// NEVER used to construct the storage key (see attachmentStorage.ts's
// buildCommercialAttachmentKey, which is filename-free by design), so
// this is purely cosmetic hardening against control characters, not a
// traversal/injection concern.
function sanitiseFilename(name: string): string {
  const cleaned = name.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return (cleaned || 'file').slice(0, 255);
}

export async function listAttachmentsForPurchaseOrder(
  organisationId: string, purchaseOrderId: string,
): Promise<CommercialDocumentAttachmentWithUploader[]> {
  return (await sql`
    SELECT a.*, u.name AS uploaded_by_name
    FROM commercial_document_attachments a
    LEFT JOIN users u ON u.id = a.uploaded_by
    WHERE a.organisation_id = ${organisationId} AND a.document_type = 'purchase_order' AND a.document_id = ${purchaseOrderId}
    ORDER BY a.created_at DESC
  `) as CommercialDocumentAttachmentWithUploader[];
}

// Tenant- AND parent-document-scoped single-row lookup — used by both
// the download and remove routes so neither can be reached for an
// attachment that exists but belongs to a different PO or organisation.
export async function getPurchaseOrderAttachment(
  organisationId: string, purchaseOrderId: string, attachmentId: string,
): Promise<CommercialDocumentAttachment | null> {
  const rows = (await sql`
    SELECT * FROM commercial_document_attachments
    WHERE id = ${attachmentId} AND organisation_id = ${organisationId}
      AND document_type = 'purchase_order' AND document_id = ${purchaseOrderId}
  `) as CommercialDocumentAttachment[];
  return rows[0] ?? null;
}

export type UploadAttachmentResult =
  | { ok: true; attachment: CommercialDocumentAttachment }
  | { ok: false; error: string };

// The ONLY way to write a purchase-order attachment row + its Blob
// object. `purchaseOrder` must be the already-resolved row from a
// tenant-scoped lookup (getPurchaseOrder(session.organisationId, id)),
// mirroring recordPurchaseOrderDeliveryAttempt()'s identical discipline.
// Upload-then-insert ordering: the Blob object is written FIRST (keyed
// by a freshly minted attachment id), then the DB row — if the DB
// insert fails after a successful upload, the orphaned Blob object is
// best-effort cleaned up (never masks the real DB error). This is the
// same ordering rationale lib/organiser/attachmentStorage.ts documents
// for its own upload-failure compensation path, applied in the opposite
// direction (compensate the STORE write, not the DB write, since here
// the DB row is the source of truth for "does this attachment exist").
export async function uploadPurchaseOrderAttachment(params: {
  organisationId: string;
  userId: string;
  purchaseOrder: { id: string; organisation_id: string };
  category: string;
  originalFilename: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<UploadAttachmentResult> {
  assertSameOrganisation(params.organisationId, params.purchaseOrder.organisation_id, 'purchase_order');

  if (!VALID_CATEGORIES.includes(params.category as CommercialAttachmentCategory)) {
    return { ok: false, error: `category must be one of: ${VALID_CATEGORIES.join(', ')}.` };
  }
  if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(params.mimeType as (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number])) {
    return { ok: false, error: `File type "${params.mimeType}" is not allowed.` };
  }
  if (params.bytes.byteLength === 0) {
    return { ok: false, error: 'File is empty.' };
  }
  if (params.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `File exceeds the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit.` };
  }

  const attachmentId = randomUUID();
  const storageKey = buildCommercialAttachmentKey(params.organisationId, 'purchase_order', params.purchaseOrder.id, attachmentId);
  const store = createCommercialAttachmentStore();

  try {
    await store.put(storageKey, params.bytes, { contentType: params.mimeType });
  } catch (err) {
    const message = err instanceof RawFileStoreError ? err.message : 'Failed to store the uploaded file.';
    return { ok: false, error: message };
  }

  try {
    const rows = (await sql`
      INSERT INTO commercial_document_attachments (
        id, organisation_id, document_type, document_id, category,
        original_filename, mime_type, size_bytes, storage_key, uploaded_by
      ) VALUES (
        ${attachmentId}, ${params.organisationId}, 'purchase_order', ${params.purchaseOrder.id}, ${params.category},
        ${sanitiseFilename(params.originalFilename)}, ${params.mimeType}, ${params.bytes.byteLength}, ${storageKey}, ${params.userId}
      )
      RETURNING *
    `) as CommercialDocumentAttachment[];
    const attachment = rows[0];

    await logCommercialAttachmentUploaded({
      organisationId: params.organisationId, userId: params.userId, attachmentId: attachment.id,
      documentType: 'purchase_order', documentId: params.purchaseOrder.id,
      category: attachment.category, originalFilename: attachment.original_filename, sizeBytes: attachment.size_bytes,
    });

    return { ok: true, attachment };
  } catch (err) {
    // DB insert failed after a successful Blob write — best-effort
    // cleanup so a retry does not leak an unreferenced object. Never
    // lets a cleanup failure mask the real insert error.
    try { await store.delete(storageKey); } catch { /* best-effort only */ }
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to record the uploaded file.' };
  }
}

export async function downloadPurchaseOrderAttachmentBytes(attachment: CommercialDocumentAttachment): Promise<Uint8Array> {
  const store = createCommercialAttachmentStore();
  const { body } = await store.get(attachment.storage_key, { maxBytes: MAX_ATTACHMENT_BYTES });
  return body;
}

// The ONLY way to remove a purchase-order attachment. `purchaseOrder`
// must be the already-resolved, tenant-scoped parent row (same
// discipline as uploadPurchaseOrderAttachment() above). DB row is
// deleted FIRST, then the Blob object — the DB row is this feature's
// source of truth for "does this attachment still exist", so removing
// it first means a failure removing the Blob object afterward leaves,
// at worst, an orphaned object with no live reference (safe, cleanable
// later), never a live DB row pointing at already-deleted bytes.
export async function removePurchaseOrderAttachment(params: {
  organisationId: string;
  userId: string;
  purchaseOrder: { id: string; organisation_id: string };
  attachmentId: string;
}): Promise<boolean> {
  assertSameOrganisation(params.organisationId, params.purchaseOrder.organisation_id, 'purchase_order');

  const rows = (await sql`
    DELETE FROM commercial_document_attachments
    WHERE id = ${params.attachmentId} AND organisation_id = ${params.organisationId}
      AND document_type = 'purchase_order' AND document_id = ${params.purchaseOrder.id}
    RETURNING *
  `) as CommercialDocumentAttachment[];
  const removed = rows[0];
  if (!removed) return false;

  await logCommercialAttachmentRemoved({
    organisationId: params.organisationId, userId: params.userId, attachmentId: removed.id,
    documentType: 'purchase_order', documentId: params.purchaseOrder.id,
    category: removed.category, originalFilename: removed.original_filename,
  });

  try {
    const store = createCommercialAttachmentStore();
    await store.delete(removed.storage_key);
  } catch (err) {
    // Best-effort — the DB row (the source of truth) is already gone and
    // the removal is already audited; a Blob cleanup failure must never
    // surface as a failed remove to the caller. Logged for operator
    // visibility only.
    console.error('[commercial attachments] failed to delete Blob object after row removal (ignored)', err);
  }
  return true;
}
