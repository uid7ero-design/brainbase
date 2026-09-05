// Data Hub 5A.3B — direct-to-private-Blob browser upload.
//
// Uses `put()` from "@vercel/blob/client" — the real, installed
// (2.8.0) browser-side upload function. This is NOT `upload()`/
// `handleUpload()`: this repo has no server route implementing the
// handleUpload callback protocol anywhere (`grep -r handleUpload app/api`
// at implementation time returns nothing), so `upload()` (which requires a
// `handleUploadUrl`) is not a usable option here. `put()` is the correct,
// and only, function for a pre-minted client-token flow like this one.
//
// PATHNAME DERIVATION — THE LOAD-BEARING FINDING OF THIS FILE: `put()`'s
// first argument must be the EXACT pathname the server encoded into the
// client token when it called generateClientTokenFromReadWriteToken
// (buildImportBatchKey(organisationId, importBatchId), i.e.
// "org_<organisationId>/importbatch_<importBatchId>" — see
// lib/data-hub/importBatch/directUploadAuth.ts). A mismatch throws
// BlobPathnameMismatchError (verified directly from the installed
// package's own dist/chunk-QMTUXFZH.cjs: "Pathname mismatch, ...").
// The initiate HTTP response deliberately never exposes storageKey or
// organisationId to the client (app/api/data-hub/import-batches/route.ts's
// own POST handler comment: "never a spread of result.batch... which
// internally carries storageKey"), so this module CANNOT reconstruct that
// pathname itself by re-deriving buildImportBatchKey client-side — it has
// only half of that function's two inputs (importBatchId, not
// organisationId, which is session-only and never sent to the browser).
//
// The resolution needs NO backend change: `getPayloadFromClientToken`,
// exported from this same "@vercel/blob/client" entry point, decodes the
// client token ITSELF (a client-side-only base64 JWT-payload decode, no
// network round-trip, no signature verification needed since this is the
// caller's own already-issued token) and recovers the exact
// GenerateClientTokenOptions the server embedded — including `pathname`.
// This module always derives the upload pathname this way, never by
// guessing or re-deriving buildImportBatchKey's algorithm independently
// (which would silently drift the moment that algorithm's format ever
// changed server-side).
//
// ACCESS FIELD: `access` is syntactically required by ClientPutCommandOptions
// (verified from the installed package's own client.d.ts:
// `ClientCommonCreateBlobOptions.access: BlobAccessType`), but it is NOT
// part of GenerateClientTokenOptions/BlobClientTokenConstraintOptions at
// all (confirmed: directUploadAuth.ts's buildDirectUploadTokenOptions never
// sets it) — the server-issued token carries no access-level constraint of
// its own. This repo's Blob store is provisioned private at the
// infrastructure level (see the ADR referenced by
// lib/data-hub/importBatch/compositionRoot.ts), so this field is a
// required-by-the-SDK-type, but practically inert, value here — this
// module always passes "private" (matching the store's real, actual
// provisioning) and never "public"; it is not a security lever this client
// can use to loosen or tighten anything.
//
// NO MULTIPART: directUploadAuth.ts's own header comment (finding #4 of the
// governing audit) explicitly defers the "no multipart" constraint to
// "whatever future client-calling code integrates this token" — this
// module IS that code, and it never sets `multipart: true`. The 20 MiB
// MAX_SOURCE_FILE_BYTES ceiling this repo enforces server-side makes
// multipart upload unnecessary for this flow's own traffic; a caller must
// not enable it without also re-litigating that deferred server-side
// constraint gap.

import { put, getPayloadFromClientToken } from "@vercel/blob/client";
import type { DataHubUploadProgress } from "./types";

export interface DirectUploadInput {
  /** The exact File/Blob selected by the user. Only File/Blob is accepted
   * (not a raw ArrayBuffer/string) — see the module's own StartImport
   * caller in orchestrator.ts for why: File is the one input type that
   * lets `put()` infer the byte length for progress totals without this
   * module reading the whole body into memory first. */
  file: File;
  /** The single-use client token returned by initiate's own uploadToken
   * field. Never re-used across two different ImportBatch ids — a fresh
   * initiate call (which may replay-return the SAME token value for the
   * SAME AWAITING_UPLOAD batch) is always this module's only token
   * source. */
  uploadToken: string;
  onUploadProgress?: (progress: DataHubUploadProgress) => void;
  /** Real cancellation, not fake progress — @vercel/blob 2.8.0's
   * ClientCommonCreateBlobOptions.abortSignal is a genuine, independently
   * verified field (see this module's own header comment). Aborting here
   * races with physical completion — see orchestrator.ts's own
   * "ABORT-VS-COMPLETION RACE" comment for how that uncertainty is
   * resolved (never assumed either way; always reconciled through a
   * subsequent finalize call). */
  abortSignal?: AbortSignal;
}

export interface DirectUploadSuccess {
  ok: true;
  pathname: string;
  url: string;
  contentType: string;
  etag: string;
}

export type DirectUploadFailureReason = "aborted" | "uploadError";

export interface DirectUploadFailure {
  ok: false;
  reason: DirectUploadFailureReason;
  message: string;
  cause: unknown;
}

export type DirectUploadResult = DirectUploadSuccess | DirectUploadFailure;

/**
 * Decodes the pathname embedded in an already-issued client upload token.
 * Pure, synchronous, no network call — see this module's own header
 * comment for why this (never a client-side re-derivation of
 * buildImportBatchKey) is the sanctioned way to obtain the exact pathname
 * `put()` requires.
 */
export function resolveUploadPathname(uploadToken: string): string {
  const payload = getPayloadFromClientToken(uploadToken);
  if (typeof payload.pathname !== "string" || payload.pathname.length === 0) {
    // Defensive only: every token this client ever receives was minted by
    // buildDirectUploadTokenOptions, which always sets a non-empty
    // pathname. A token failing this check is not a shape this client's
    // own server contract can produce — surfaced as a thrown error (a
    // genuine programmer/contract-drift bug), never silently defaulted.
    throw new Error("data-hub client: upload token payload did not contain a usable pathname.");
  }
  return payload.pathname;
}

/**
 * Performs the direct browser-to-private-Blob upload. Never throws for an
 * ordinary abort or upload-provider error — both are reported through
 * DirectUploadFailure. A genuine programmer error (e.g. an unparseable
 * token — see resolveUploadPathname above) is still allowed to throw: that
 * is not a runtime "the upload failed" case, it is a contract violation
 * this module cannot recover from.
 */
export async function uploadFileDirectToBlob(input: DirectUploadInput): Promise<DirectUploadResult> {
  const pathname = resolveUploadPathname(input.uploadToken);

  try {
    const result = await put(pathname, input.file, {
      access: "private",
      token: input.uploadToken,
      contentType: input.file.type || undefined,
      multipart: false,
      abortSignal: input.abortSignal,
      onUploadProgress: input.onUploadProgress,
    });
    return {
      ok: true,
      pathname: result.pathname,
      url: result.url,
      contentType: result.contentType,
      etag: result.etag,
    };
  } catch (err) {
    // Native fetch/AbortController cancellation surfaces as a DOMException
    // (browser) or a Node AbortError (SSR/test) named "AbortError" — this
    // is standard Fetch-spec behavior, not a @vercel/blob-specific
    // mechanism, so it is checked without importing anything from the
    // package. See this module's own header comment for why the more
    // specific Blob*Error subclasses (BlobPathnameMismatchError,
    // BlobClientTokenExpiredError, etc.) are NOT imported/instanceof-
    // checked here: they are defined in a shared internal chunk that is
    // exported from "@vercel/blob" (the server entry point, which pulls in
    // node:http/undici) but is deliberately NOT re-exported from
    // "@vercel/blob/client" at all (verified directly against the
    // installed package's own client.d.ts export list) — importing them
    // here would mean importing a server-oriented entry point into a
    // browser-only module for a handful of `instanceof` checks. This
    // mirrors the exact same import-boundary discipline this repo's own
    // server code already applies elsewhere (e.g. inspectCsvWorksheet.ts's
    // refusal to import workbookParser.ts merely to reach its CSV branch).
    // Every non-abort put() failure is therefore surfaced as one honest,
    // un-subdivided "uploadError" reason, carrying the SDK's own message
    // verbatim (never re-derived/guessed into a fake specific code) — the
    // caller can inspect `.message`/`.cause` for detail but must not
    // assume this module can discriminate pathname-mismatch from
    // token-expiry from content-type-rejection from a wire-level
    // "AbortError" name.
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      reason: isAbort ? "aborted" : "uploadError",
      message: err instanceof Error ? err.message : "The direct upload failed.",
      cause: err,
    };
  }
}
