import 'server-only';
import { createVercelBlobFileStore } from '@/lib/data-hub/storage/vercelBlobFileStore';
import { validateStorageKey, type RawFileStore } from '@/lib/data-hub/storage/rawFileStore';

// C6.9 remediation — Commercial (Purchasing + future Quotes/Invoicing/
// Bills/Contracts) document attachment storage.
//
// Mirrors lib/data-hub/importBatch/compositionRoot.ts's exact shape:
// ONE dedicated, PRIVATE Vercel Blob store, resolved from its own
// env vars only, never falling back to Data Hub's or Events' store
// credentials. Per docs/architecture/decisions/0001-data-hub-ingestion-foundation.md
// §14: Blob access mode (public/private) is fixed per-store at creation
// time and cannot be mixed within one store, so a genuinely private,
// tenant-safe Commercial attachment store cannot reuse Events'
// (lib/events/blobStorage.ts) or Organiser's (lib/organiser/attachmentStorage.ts)
// existing PUBLIC store — those are architecturally the wrong shape for
// documents that must fail closed on wrong-tenant access. Reusing Data
// Hub's own private store was also rejected: that store is explicitly
// documented as dedicated to Data Hub and "never shared, even in
// principle" — this module provisions its own, separate credential pair
// instead, using the exact same createVercelBlobFileStore() adapter
// (real reuse of the adapter *code*, not the adapter's *store*).
//
// FAILS CLOSED — same discipline as Data Hub's composition root: missing
// config throws immediately, never silently degrades to "storage off".
// Reused generically across every future Commercial document type (see
// buildCommercialAttachmentKey's documentType parameter) so a later
// Invoices/Bills/Contracts attachment feature needs zero new storage
// wiring, only a new document_type value.

export interface CommercialBlobCredentials {
  storeId: string;
  token: string;
}

export class CommercialAttachmentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommercialAttachmentConfigurationError';
  }
}

let memoizedCredentials: CommercialBlobCredentials | undefined;

function resolveCredentialsFromEnv(): CommercialBlobCredentials {
  const storeId = process.env.COMMERCIAL_BLOB_STORE_ID;
  const token = process.env.COMMERCIAL_BLOB_READ_WRITE_TOKEN;

  if (typeof storeId !== 'string' || storeId.trim().length === 0) {
    throw new CommercialAttachmentConfigurationError(
      'Commercial attachment storage is not configured: COMMERCIAL_BLOB_STORE_ID is missing or empty. ' +
        'This service never falls back to any other Blob store\'s configuration.'
    );
  }
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new CommercialAttachmentConfigurationError(
      'Commercial attachment storage is not configured: COMMERCIAL_BLOB_READ_WRITE_TOKEN is missing or empty. ' +
        'This service never falls back to any other Blob store\'s configuration.'
    );
  }
  return { storeId, token };
}

// override exists solely for tests — see
// lib/data-hub/importBatch/compositionRoot.ts's identical seam.
function resolveCredentials(override?: CommercialBlobCredentials): CommercialBlobCredentials {
  if (override) return override;
  if (memoizedCredentials) return memoizedCredentials;
  memoizedCredentials = resolveCredentialsFromEnv();
  return memoizedCredentials;
}

export function createCommercialAttachmentStore(override?: CommercialBlobCredentials): RawFileStore {
  const credentials = resolveCredentials(override);
  return createVercelBlobFileStore(credentials);
}

// ── Key construction ─────────────────────────────────────────────────
//
// Grammar: "org_<organisationId>/<documentType>_<documentId>/<attachmentId>"
// — mirrors buildImportBatchKey()'s "org_<x>/importbatch_<y>" shape
// exactly, extended one level for the document-type discriminator this
// table's own document_type CHECK already carries (see
// scripts/create-commercial-document-attachments.sql). No client-
// controlled fragment (never the original filename) — the same
// discipline buildImportBatchKey() documents for its own key, and the
// reason the original filename is stored as metadata in Postgres, never
// echoed into the storage key itself.
//
// attachmentId is the commercial_document_attachments row's own id,
// minted BEFORE the upload (so put()'s key is known up front and a
// failed DB insert never leaves an orphaned, differently-keyed blob
// behind to hunt for).
const KEY_COMPONENT_PATTERN = /^[A-Za-z0-9_-]+$/;

function validateKeyComponent(name: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  if (!KEY_COMPONENT_PATTERN.test(value)) {
    throw new TypeError(`${name} may only contain ASCII letters, digits, '_', and '-'; received ${JSON.stringify(value)}.`);
  }
}

export function buildCommercialAttachmentKey(
  organisationId: string,
  documentType: string,
  documentId: string,
  attachmentId: string,
): string {
  validateKeyComponent('organisationId', organisationId);
  validateKeyComponent('documentType', documentType);
  validateKeyComponent('documentId', documentId);
  validateKeyComponent('attachmentId', attachmentId);
  const key = `org_${organisationId}/${documentType}_${documentId}/${attachmentId}`;
  validateStorageKey(key);
  return key;
}
