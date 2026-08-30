// Data Hub raw file storage boundary (Phase 5A.2E).
//
// This module defines the minimum durable abstraction required so a future
// private Vercel Blob adapter (5A.2F) can be built without redesign, and so
// the eventual initiate/finalize ImportBatch lifecycle (5A.2G) can depend on
// a stable contract rather than a concrete provider. It deliberately knows
// nothing about HTTP, organisations, ImportBatch rows, or the workbook
// parser — see docs/architecture/decisions/0001-data-hub-ingestion-foundation.md
// for the full boundary rationale (Section: RawFileStore).
//
// Scope discipline (5A.2E-R1 architecture review):
//   - put() accepts Uint8Array only. The committed direct-browser-to-
//     private-Blob protocol means canonical production code never calls
//     put() with the uploaded workbook bytes at all — the browser writes
//     directly to the provider via a separate, not-yet-built direct-upload
//     capability. put() exists for test-fixture seeding and any reference/
//     reconciliation writes, not the canonical hot path. Streaming input
//     was considered and rejected: no identified caller needs it.
//   - No uploadedAt, no sha256/expectedSha256, no URL/downloadUrl, no
//     filename, no organisationId, no provider-specific metadata escape
//     hatch. Every field must have an identified caller (ImportBatch's own
//     columns, or the finalize flow) or it does not belong here.
//   - RawFileStore is tenant-agnostic. Tenant isolation happens one layer
//     up, via buildImportBatchKey()'s organisation-scoped namespace plus
//     the database's own existing composite-FK tenant-scoping discipline
//     (the same pattern already used by ImportBatch/Upload in 5A.2C). The
//     storage layer validates key SYNTAX, never authorization.

export type RawFileStoreErrorCode =
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "INVALID_KEY"
  | "SIZE_LIMIT"
  | "PROVIDER_FAILURE";

export class RawFileStoreError extends Error {
  readonly code: RawFileStoreErrorCode;
  readonly cause?: unknown;

  constructor(code: RawFileStoreErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "RawFileStoreError";
    this.code = code;
    this.cause = cause;
  }
}

export interface RawFileMetadata {
  provider: string;
  size: number;
  contentType?: string;
  etag?: string;
}

export interface RawFilePutResult extends RawFileMetadata {
  key: string;
}

export interface RawFileGetOptions {
  /** Hard ceiling on bytes materialized. Enforced during reading, not only
   * after the fact — see each implementation's streaming/early-rejection
   * logic. Malformed values (non-finite, negative, non-integer) throw a
   * plain TypeError: this is a programmer error, not a storage-domain
   * failure, and does not belong in the five-code RawFileStoreErrorCode
   * union (mirrors the identical discipline already established for
   * WorkbookLimits validation in lib/data-hub/workbookParser.ts). */
  maxBytes?: number;
}

export interface RawFileStore {
  readonly provider: string;

  put(
    key: string,
    body: Uint8Array,
    opts?: { contentType?: string }
  ): Promise<RawFilePutResult>;

  head(key: string): Promise<RawFileMetadata | null>;

  get(
    key: string,
    opts?: RawFileGetOptions
  ): Promise<{ metadata: RawFileMetadata; body: Uint8Array }>;

  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Canonical key construction (single sanctioned path for minting a key) and
// validation (enforced independently and identically by every
// implementation, so a caller that bypasses the builder — or a bug in it —
// still cannot produce a key one implementation accepts and another
// rejects).
// ---------------------------------------------------------------------------

// Deliberately narrow grammar: ASCII letters/digits/underscore/hyphen
// segments joined by a single '/' namespace separator, no leading/trailing
// slash, no '.' or '..' segment, no empty segment, no backslash, no NUL, no
// characters outside this list. This mirrors the exact name-policy
// discipline already proven in 5A.2D's workbookArchiveGuard (ASCII-only,
// no traversal, no absolute paths) — the same class of untrusted-identifier
// problem gets the same answer here.
const KEY_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

export function validateStorageKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new RawFileStoreError("INVALID_KEY", "Storage key must be a non-empty string.");
  }
  if (key.includes("\\")) {
    throw new RawFileStoreError("INVALID_KEY", "Storage key must not contain a backslash.", { key });
  }
  if (key.includes("\0")) {
    throw new RawFileStoreError("INVALID_KEY", "Storage key must not contain a NUL byte.", { key });
  }
  if (key.startsWith("/") || key.endsWith("/")) {
    throw new RawFileStoreError("INVALID_KEY", "Storage key must not start or end with '/'.", { key });
  }
  // Windows drive form (e.g. "C:", "c:/x") — reject the colon outright;
  // no legitimate key segment in this grammar ever needs one.
  if (key.includes(":")) {
    throw new RawFileStoreError("INVALID_KEY", "Storage key must not contain ':'.", { key });
  }
  const segments = key.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new RawFileStoreError("INVALID_KEY", "Storage key must not contain an empty path segment.", { key });
    }
    if (segment === "." || segment === "..") {
      throw new RawFileStoreError("INVALID_KEY", "Storage key must not contain a '.' or '..' path segment.", { key });
    }
    if (!KEY_SEGMENT_PATTERN.test(segment)) {
      throw new RawFileStoreError(
        "INVALID_KEY",
        "Storage key segments may only contain ASCII letters, digits, '_', and '-'.",
        { key, segment }
      );
    }
  }
}

/**
 * The single sanctioned way canonical code mints an ImportBatch storage
 * key. Deterministic, organisation-scoped, content-addressing-free (sha256
 * is explicitly non-unique per the 5A.2C schema's own idempotency design —
 * two distinct ImportBatch rows may legitimately share identical bytes),
 * and carries no client-controlled fragment (never the original filename).
 * Grammar: "org_<organisationId>/importbatch_<importBatchId>".
 */
export function buildImportBatchKey(organisationId: string, importBatchId: string): string {
  if (typeof organisationId !== "string" || organisationId.length === 0) {
    throw new RawFileStoreError("INVALID_KEY", "organisationId must be a non-empty string.");
  }
  if (typeof importBatchId !== "string" || importBatchId.length === 0) {
    throw new RawFileStoreError("INVALID_KEY", "importBatchId must be a non-empty string.");
  }
  const key = `org_${organisationId}/importbatch_${importBatchId}`;
  validateStorageKey(key);
  return key;
}

export function validateMaxBytes(maxBytes: number | undefined): number | undefined {
  if (maxBytes === undefined) return undefined;
  if (!Number.isFinite(maxBytes) || !Number.isInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError(`maxBytes must be a non-negative integer; received ${String(maxBytes)}.`);
  }
  return maxBytes;
}
