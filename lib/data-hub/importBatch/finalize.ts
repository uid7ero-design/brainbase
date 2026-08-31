import { createHash } from "node:crypto";
import sql from "../../db";
import { RawFileStoreError, buildImportBatchKey } from "../storage/rawFileStore";
import { createImportBatchStorage } from "./compositionRoot";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import { matchesSignature, containsNulByte, OLE_SIGNATURE, type WorkbookFormat } from "../fileSignatures";
import { assertSafeXlsxArchive, ArchiveGuardError } from "../workbookArchiveGuard";
import {
  type PersistedFailureCode,
  type FailureCode,
  getMessageTemplate,
} from "./failureTaxonomy";
import { claimForFinalize, completeReadyForFinalize, completeFailedForFinalize } from "./finalizeInternal";

// Data Hub 5A.2G.1 — finalize service (dark, route-free, transport-
// independent).
//
// AUTH BOUNDARY: exactly as initiate.ts — this function accepts an
// already-resolved trusted context (organisationId, and optionally userId
// for future audit purposes) as plain parameters. It never resolves its
// own auth/session and deliberately never imports lib/org.ts's
// requireRole/requireSession (they depend on next/headers' cookies() and
// server-only, and cannot run outside a real Next.js request context —
// this function must also be callable from tests). A FUTURE route
// wrapping this service MUST enforce manager+ role authorization (via
// requireRole('manager')) BEFORE ever calling it, and MUST derive
// organisationId/userId from a real, authenticated session, never from
// arbitrary request input. This is deferred because there is no route at
// all in this phase — this module provides ZERO HTTP-level authorization
// of any kind.
//
// Never trusts any client-supplied organisation, storage key, pathname,
// format, hash, or status — every one of these is derived server-side
// from the trusted, already-claimed DB row's own identity. Every lookup
// is tenant-scoped (id AND organisation_id together), never a global
// lookup by id alone.
//
// XLSX-FREE IMPORT GRAPH (Step 20 — critical security boundary): this
// module imports ONLY from fileSignatures.ts (xlsx-free — see that
// module's own header) and workbookArchiveGuard.ts (independently
// verified zero-xlsx: node:zlib, crc-32, yauzl only) for format
// preflight. It MUST NOT import `xlsx` directly, and MUST NOT import
// workbookParser.ts AT ALL — that file itself imports xlsx, so importing
// even an unrelated export from it would transitively pull xlsx into this
// module's graph. It never calls XLSX.read, inspectWorkbook, or
// decodeWorksheet, anywhere, under any circumstance. See
// tests/containment/finalizeImportBatch.test.ts for the static,
// source-text containment proof of this boundary.
//
// SIZE_BYTES IMMUTABILITY (Step 11, load-bearing — the other half of
// initiate.ts's own header comment): this module NEVER writes size_bytes,
// anywhere, under any circumstance, including on a successful READY
// completion. The already-persisted, never-mutated size_bytes set once at
// initiate is compared against the actual retrieved body's byte length
// (see the STORAGE_METADATA_MISMATCH check below) — a mismatch is
// terminal (a brand-new batch is required), never "corrected" by
// overwriting size_bytes with the observed value.
//
// LOW-LEVEL PERSISTENCE PRIMITIVES LIVE IN finalizeInternal.ts (remediation
// — encapsulation move, no behavioral change): the atomic claim UPDATE
// (claimForFinalize), and the two fenced completion UPDATEs
// (completeReadyForFinalize / completeFailedForFinalize), plus the
// ClaimedRow type, are defined in ./finalizeInternal and imported here.
// This module (finalize.ts) is the ONLY production file permitted to
// import from finalizeInternal.ts, and never re-exports those low-level
// primitives under any name — this module's own public surface is limited
// to finalizeImportBatch and the high-level context/result types below.
// See finalizeInternal.ts's own header comment for the full restriction
// and rationale, and tests/containment/finalizeImportBatch.test.ts for the
// structural containment proof.

export interface FinalizeTrustedContext {
  organisationId: string;
  /** Optional; accepted for future audit purposes, not currently persisted. */
  userId?: string;
}

export type FinalizeClaimFailureReason =
  | "NOT_FOUND"
  | "ALREADY_PROCESSING"
  | "ALREADY_READY"
  | "TERMINAL_FAILURE"
  | "DELETION_PENDING"
  | "UNEXPECTED_STATE";

export type FinalizeImportBatchResult =
  | { outcome: "READY"; batchId: string; sha256: string; storageEtag?: string }
  | { outcome: "FAILED"; batchId: string; failureCode: PersistedFailureCode; retryable: boolean }
  | { outcome: "OWNERSHIP_LOST"; batchId: string }
  | { outcome: "CLAIM_REJECTED"; code: FailureCode; reason: FinalizeClaimFailureReason; message: string };

interface ReselectedRow {
  status: string;
  last_failure_code: string | null;
}

async function classifyClaimFailure(
  organisationId: string,
  importBatchId: string
): Promise<FinalizeImportBatchResult> {
  const rows = (await sql`
    SELECT status, last_failure_code
    FROM import_batches
    WHERE id = ${importBatchId} AND organisation_id = ${organisationId}
  `) as unknown as ReselectedRow[];

  if (rows.length === 0) {
    return { outcome: "CLAIM_REJECTED", code: "NOT_FOUND", reason: "NOT_FOUND", message: getMessageTemplate("NOT_FOUND") };
  }
  const row = rows[0];
  if (row.status === "PROCESSING") {
    return {
      outcome: "CLAIM_REJECTED",
      code: "INVALID_STATE",
      reason: "ALREADY_PROCESSING",
      message: getMessageTemplate("INVALID_STATE"),
    };
  }
  if (row.status === "READY") {
    return {
      outcome: "CLAIM_REJECTED",
      code: "INVALID_STATE",
      reason: "ALREADY_READY",
      message: getMessageTemplate("INVALID_STATE"),
    };
  }
  if (row.status === "DELETION_PENDING") {
    return {
      outcome: "CLAIM_REJECTED",
      code: "INVALID_STATE",
      reason: "DELETION_PENDING",
      message: getMessageTemplate("INVALID_STATE"),
    };
  }
  if (row.status === "FAILED") {
    // Reached here only because the atomic claim's WHERE clause did not
    // match — meaning last_failure_code is NOT one of the finalization-
    // retry-eligible codes. A terminally-FAILED (non-retry-eligible) code.
    return {
      outcome: "CLAIM_REJECTED",
      code: "RECLAIM_NOT_ALLOWED",
      reason: "TERMINAL_FAILURE",
      message: getMessageTemplate("RECLAIM_NOT_ALLOWED"),
    };
  }
  return {
    outcome: "CLAIM_REJECTED",
    code: "INVALID_STATE",
    reason: "UNEXPECTED_STATE",
    message: getMessageTemplate("INVALID_STATE"),
  };
}

// ---------------------------------------------------------------------------
// Step 20 — format preflight. XLSX: the EXISTING assertSafeXlsxArchive,
// unmodified. XLS: the OLE/CFB signature check from fileSignatures.ts.
// CSV: the NUL-byte-rejection check from fileSignatures.ts. Any rejection
// maps to the single service-level PREFLIGHT_REJECTED.
// ---------------------------------------------------------------------------

async function passesFormatPreflight(format: WorkbookFormat, bytes: Uint8Array): Promise<boolean> {
  if (format === "xlsx") {
    try {
      await assertSafeXlsxArchive(bytes);
      return true;
    } catch (err) {
      if (err instanceof ArchiveGuardError) return false;
      throw err;
    }
  }
  if (format === "xls") {
    return matchesSignature(bytes, OLE_SIGNATURE);
  }
  // csv
  return !containsNulByte(bytes);
}

/**
 * Finalizes a claimed ImportBatch: retrieves the uploaded bytes, validates
 * size/hash, runs format preflight, and completes the row to READY or
 * FAILED via a fenced, generation-checked completion write. Tenant-scoped
 * throughout — never a global lookup by id alone.
 */
export async function finalizeImportBatch(
  context: FinalizeTrustedContext,
  importBatchId: string
): Promise<FinalizeImportBatchResult> {
  const { organisationId } = context;

  const claimed = await claimForFinalize(organisationId, importBatchId);
  if (!claimed) {
    return classifyClaimFailure(organisationId, importBatchId);
  }

  const generation = claimed.attempt_count;
  const format = claimed.content_type as WorkbookFormat;
  const persistedSizeBytes = claimed.size_bytes;
  const expectedSha256 = claimed.expected_sha256;

  // ---- Step 17 — all storage/network/hash/preflight work OUTSIDE any DB
  // transaction or long-lived connection. ----

  const storage = createImportBatchStorage();
  const storageKey = buildImportBatchKey(organisationId, importBatchId);

  // Step 18 — classify strictly from the evidence of THIS single attempt.
  // No second, speculative HEAD to "reclassify" an ambiguous failure.
  let headMetadata;
  try {
    headMetadata = await storage.head(storageKey);
  } catch {
    // head() THROWING -> PROVIDER_FAILURE, object existence UNKNOWN.
    return completeFailedForFinalize(organisationId, importBatchId, generation, "PROVIDER_FAILURE");
  }
  if (headMetadata === null) {
    // head() returning a clean null -> STORAGE_NOT_FOUND. The ONLY way to
    // reach this code.
    return completeFailedForFinalize(organisationId, importBatchId, generation, "STORAGE_NOT_FOUND");
  }

  let getResult;
  try {
    // Exact limit, no +1 sentinel — the adapter's own boundary check is
    // strictly-greater-than on both the HEAD-precheck and the streaming-
    // total check, so this exact value correctly accepts an exactly-at-
    // limit object and rejects anything larger.
    getResult = await storage.get(storageKey, { maxBytes: MAX_SOURCE_FILE_BYTES });
  } catch (err) {
    if (err instanceof RawFileStoreError && err.code === "SIZE_LIMIT") {
      // A deterministic, evidenced fact about the object itself (it
      // exceeds the absolute system-wide cap) — not an ambiguous provider
      // failure. Maps directly to the taxonomy's own SIZE_LIMIT code.
      return completeFailedForFinalize(organisationId, importBatchId, generation, "SIZE_LIMIT");
    }
    // Every other get() failure (a generic PROVIDER_FAILURE, or the rare
    // NOT_FOUND race where the object was removed between HEAD and GET)
    // occurs AFTER head() already confirmed existence — classified
    // PROVIDER_FAILURE, existence CONFIRMED, per Step 18.
    return completeFailedForFinalize(organisationId, importBatchId, generation, "PROVIDER_FAILURE");
  }

  const body = getResult.body;

  // ---- Step 19 — byte/metadata validation this module must independently
  // add (RawFileStore's own get() contract already validated declared
  // size vs. maxBytes, streamed total vs. maxBytes, and body.byteLength
  // vs. its own reported metadata.size — never re-implemented here). ----

  if (body.byteLength === 0) {
    return completeFailedForFinalize(organisationId, importBatchId, generation, "ZERO_BYTE");
  }
  if (body.byteLength !== persistedSizeBytes) {
    // Compared against the already-persisted, NEVER-mutated size_bytes —
    // this module never writes to size_bytes, on any path, including here.
    return completeFailedForFinalize(organisationId, importBatchId, generation, "STORAGE_METADATA_MISMATCH");
  }

  const computedSha256 = createHash("sha256").update(body).digest("hex");
  if (expectedSha256 && expectedSha256 !== computedSha256) {
    return completeFailedForFinalize(organisationId, importBatchId, generation, "HASH_MISMATCH");
  }

  const preflightPassed = await passesFormatPreflight(format, body);
  if (!preflightPassed) {
    return completeFailedForFinalize(organisationId, importBatchId, generation, "PREFLIGHT_REJECTED");
  }

  return completeReadyForFinalize(organisationId, importBatchId, generation, computedSha256, getResult.metadata.etag);
}
