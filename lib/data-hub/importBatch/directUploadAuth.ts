import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import type { GenerateClientTokenOptions } from "@vercel/blob/client";
import { buildImportBatchKey } from "../storage/rawFileStore";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import type { WorkbookFormat } from "../fileSignatures";

// Data Hub 5A.2G.1 — direct-upload token authorization/signing.
//
// Kept separate from compositionRoot.ts specifically so buildDirectUpload
// TokenOptions() — the pure option-construction logic — is unit-testable
// without mocking the @vercel/blob/client SDK at all: it never calls the
// SDK itself, it only builds the exact options object the real, installed
// @vercel/blob 2.8.0 `generateClientTokenFromReadWriteToken` function
// (imported from "@vercel/blob/client" — verified directly from the
// installed package's dist/client.d.ts; NOT exported from the package's
// main "@vercel/blob" entry point) needs. mintDirectUploadToken() is the
// thin, separately-testable wrapper that actually calls the SDK with
// those options.
//
// IMPLEMENTATION-TIME SDK VERIFICATION FINDINGS (installed @vercel/blob
// 2.8.0, read directly from node_modules/@vercel/blob/dist/client.cjs —
// not assumed from documentation or from the (stale) .d.ts prose):
//
//   1. `token` must always be passed explicitly. When omitted,
//      generateClientTokenFromReadWriteToken falls back to
//      process.env.BLOB_READ_WRITE_TOKEN (getReadWriteBlobTokenFromOptions
//      OrEnv) — exactly the ambient-credential fallback this phase's
//      composition root exists to prevent. This module never omits it.
//
//   2. `validUntil` must always be passed explicitly. The installed SDK's
//      own compiled behavior when it is omitted is
//      `timestamp.setSeconds(timestamp.getSeconds() + 30)` — a 30-SECOND
//      default — not the "defaults to one hour from generation" the
//      package's own .d.ts comment claims. Relying on the documented
//      default would silently issue a token that expires 120x sooner than
//      expected. This module always computes and passes an explicit
//      validUntil (now + DIRECT_UPLOAD_TOKEN_TTL_MS).
//
//   3. GenerateClientTokenOptions (the real parameter type, verified from
//      dist/client.d.ts: `interface GenerateClientTokenOptions extends
//      BlobCommandOptions, BlobClientTokenConstraintOptions { pathname:
//      string }`) has NO `clientPayload`, `tokenPayload`,
//      `onUploadCompleted`, or `callbackUrl` field at all — those only
//      exist on handleUpload/handleUploadPresigned's own option types,
//      which this dark, route-free phase never calls (no route exists yet
//      to ever serve a callback). This module therefore has no field to
//      accidentally set for any of them, and does not fabricate a fake
//      callback URL just to populate one.
//
//   4. The SDK has no token-level field to forbid multipart uploads at
//      all — multipart is purely a CLIENT-side upload-strategy flag
//      (`ClientCommonPutOptions.multipart`), with no corresponding
//      server-mintable constraint anywhere in GenerateClientTokenOptions
//      or BlobClientTokenConstraintOptions. This module cannot encode "no
//      multipart" in the token; "no multipart" must instead be enforced
//      as a contract on whatever future client-calling code integrates
//      this token (documented here, not solved here — this phase has no
//      client-calling code at all).

/** 15 minutes — explicit, never left to the SDK's own (undocumented, and
 * shorter than documented) default. */
export const DIRECT_UPLOAD_TOKEN_TTL_MS = 15 * 60 * 1000;

// Advisory only — the real safety gate is finalize's own content-based
// preflight (workbookArchiveGuard.ts / fileSignatures.ts), never this
// allowlist. A browser can still lie about Content-Type; this only steers
// well-behaved clients and rejects egregious client-side mismatches early.
// Deliberately excludes application/octet-stream — no concrete requirement
// for it was found during implementation; do not add it speculatively.
export const DIRECT_UPLOAD_ALLOWED_CONTENT_TYPES: Record<WorkbookFormat, readonly string[]> = {
  csv: ["text/csv", "application/csv"],
  xls: ["application/vnd.ms-excel"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
};

export interface DirectUploadTokenInput {
  /** Trusted, already-authenticated caller context — never re-derived here. */
  organisationId: string;
  /** The already-created (or already-replayed) ImportBatch row's own id. */
  importBatchId: string;
  /** The persisted, trusted format enum — never a client-supplied MIME hint. */
  format: WorkbookFormat;
  /** The single resolved credential pair from compositionRoot.ts — the
   * SAME pair used to construct the RawFileStore adapter. */
  storeId: string;
  token: string;
  /** Injectable for deterministic tests; defaults to Date.now(). Never
   * used to compute anything other than validUntil. */
  now?: number;
}

/**
 * Pure option-construction: derives the exact GenerateClientTokenOptions
 * the real SDK function needs from trusted inputs. Never calls the SDK.
 * The canonical pathname always comes from the real, imported
 * buildImportBatchKey — never a locally re-templated string.
 */
export function buildDirectUploadTokenOptions(input: DirectUploadTokenInput): GenerateClientTokenOptions {
  const pathname = buildImportBatchKey(input.organisationId, input.importBatchId);
  const now = input.now ?? Date.now();

  return {
    pathname,
    token: input.token,
    storeId: input.storeId,
    allowedContentTypes: [...DIRECT_UPLOAD_ALLOWED_CONTENT_TYPES[input.format]],
    maximumSizeInBytes: MAX_SOURCE_FILE_BYTES,
    allowOverwrite: false,
    addRandomSuffix: false,
    validUntil: now + DIRECT_UPLOAD_TOKEN_TTL_MS,
  };
}

/**
 * Thin wrapper: builds the options (pure, above) and calls the real,
 * installed SDK function. Separated from buildDirectUploadTokenOptions so
 * the pure logic can be tested without mocking @vercel/blob/client at all.
 */
export async function mintDirectUploadToken(input: DirectUploadTokenInput): Promise<string> {
  const options = buildDirectUploadTokenOptions(input);
  return generateClientTokenFromReadWriteToken(options);
}
