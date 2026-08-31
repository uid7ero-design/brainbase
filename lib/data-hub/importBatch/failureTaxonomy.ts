// Data Hub 5A.2G.1 — ImportBatch failure taxonomy.
//
// Single source of truth for every failure code the initiate/finalize/
// staleReclaim service layer can produce, split into two disjoint kinds:
//
//   PersistedFailureCode — may be written to ImportBatch.last_failure_code
//   (a durable batch state). Format-neutral naming is deliberate:
//   PREFLIGHT_REJECTED (not ARCHIVE_REJECTED) covers non-archive XLS/CSV
//   preflight rejections too, not only XLSX archive rejections.
//
//   CallerOnlyOutcomeCode — describes a synchronous service call's own
//   result (initiate/finalize/staleReclaim returning to THEIR caller).
//   Never written to any DB row — these are not durable batch states.
//
// This module also fixes DB-level retryability per persisted code, three
// explicit eligibility predicates operating on a persisted code (upload-
// token-replay eligibility, finalization-retry eligibility, and terminal-
// requires-new-batch), and a fixed, sanitized, code-keyed message-template
// table. Every persisted or caller-facing message returned by this module
// comes from that fixed table — NEVER from interpolating a raw caught SDK/
// SQL/provider error's own `.message`, a stack trace, a token, or a URL.

export type PersistedFailureCode =
  | "STORAGE_NOT_FOUND"
  | "STORAGE_METADATA_MISMATCH"
  | "SIZE_LIMIT"
  | "ZERO_BYTE"
  | "HASH_MISMATCH"
  | "PREFLIGHT_REJECTED"
  | "PROVIDER_FAILURE"
  | "STALE_RECLAIMED";

export type CallerOnlyOutcomeCode =
  | "INVALID_REQUEST"
  | "IDEMPOTENCY_CONFLICT"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "CONFIGURATION_ERROR"
  | "RECLAIM_NOT_ALLOWED"
  | "OWNERSHIP_LOST";

export type FailureCode = PersistedFailureCode | CallerOnlyOutcomeCode;

export const PERSISTED_FAILURE_CODES: readonly PersistedFailureCode[] = [
  "STORAGE_NOT_FOUND",
  "STORAGE_METADATA_MISMATCH",
  "SIZE_LIMIT",
  "ZERO_BYTE",
  "HASH_MISMATCH",
  "PREFLIGHT_REJECTED",
  "PROVIDER_FAILURE",
  "STALE_RECLAIMED",
];

export const CALLER_ONLY_OUTCOME_CODES: readonly CallerOnlyOutcomeCode[] = [
  "INVALID_REQUEST",
  "IDEMPOTENCY_CONFLICT",
  "NOT_FOUND",
  "INVALID_STATE",
  "CONFIGURATION_ERROR",
  "RECLAIM_NOT_ALLOWED",
  "OWNERSHIP_LOST",
];

export function isPersistedFailureCode(code: string): code is PersistedFailureCode {
  return (PERSISTED_FAILURE_CODES as readonly string[]).includes(code);
}

// ---------------------------------------------------------------------------
// DB-level retryability (exact matrix locked by the architecture review).
// This is coarse and intentionally does NOT determine upload-token-replay
// eligibility on its own — see isUploadTokenReplayEligible below, which
// must always be consulted via the specific persisted code, never this
// boolean alone.
// ---------------------------------------------------------------------------

const RETRYABLE_BY_CODE: Record<PersistedFailureCode, boolean> = {
  STORAGE_NOT_FOUND: true,
  PROVIDER_FAILURE: true,
  STALE_RECLAIMED: true,
  STORAGE_METADATA_MISMATCH: false,
  SIZE_LIMIT: false,
  ZERO_BYTE: false,
  HASH_MISMATCH: false,
  PREFLIGHT_REJECTED: false,
};

export function getDbRetryable(code: PersistedFailureCode): boolean {
  return RETRYABLE_BY_CODE[code];
}

// ---------------------------------------------------------------------------
// (a) Upload-token-replay eligibility: may `initiate` mint a fresh same-key
// browser upload token for a FAILED row carrying this code? TRUE only for
// STORAGE_NOT_FOUND — every other FAILED code (including the other two
// DB-retryable codes, PROVIDER_FAILURE and STALE_RECLAIMED) must NOT get a
// fresh upload token: the object may genuinely still exist (or a finalize
// retry, not a new upload, is the correct next step), and a fresh upload
// token risks an allowOverwrite:false conflict against that live object.
// ---------------------------------------------------------------------------

export function isUploadTokenReplayEligible(code: PersistedFailureCode): boolean {
  return code === "STORAGE_NOT_FOUND";
}

// ---------------------------------------------------------------------------
// (b) Finalization-retry eligibility: may `finalize` re-claim and re-verify
// a FAILED row carrying this code, without any new upload? TRUE for the
// three DB-retryable codes; FALSE for every deterministic bad-object code.
// ---------------------------------------------------------------------------

const FINALIZATION_RETRY_ELIGIBLE_CODES: ReadonlySet<PersistedFailureCode> = new Set([
  "STORAGE_NOT_FOUND",
  "PROVIDER_FAILURE",
  "STALE_RECLAIMED",
]);

export function isFinalizationRetryEligible(code: PersistedFailureCode): boolean {
  return FINALIZATION_RETRY_ELIGIBLE_CODES.has(code);
}

// ---------------------------------------------------------------------------
// (c) Terminal-requires-new-batch: the inverse of (b), stated as its own
// explicit function (rather than inlining `!isFinalizationRetryEligible`
// at every call site) for clarity — a terminal code means the existing
// ImportBatch row can never reach READY; the caller must start an entirely
// new batch under a new idempotency key.
// ---------------------------------------------------------------------------

export function isTerminalRequiresNewBatch(code: PersistedFailureCode): boolean {
  return !isFinalizationRetryEligible(code);
}

// ---------------------------------------------------------------------------
// Fixed, sanitized, code-keyed message templates. Every one of these is
// checked at module-load time to be <= 500 characters (matching the DB's
// own import_batches_failure_message_length_check CHECK constraint) — see
// the self-check below. Callers must NEVER interpolate a raw caught error's
// own `.message`/stack/token/URL into any persisted or returned message;
// always look it up here instead.
// ---------------------------------------------------------------------------

const MESSAGE_TEMPLATES: Record<FailureCode, string> = {
  // Persisted (DB-writable) codes.
  STORAGE_NOT_FOUND:
    "The uploaded file could not be found in storage. This may be a temporary condition; a new upload attempt to the same batch may succeed.",
  STORAGE_METADATA_MISMATCH:
    "The uploaded file's actual size does not match the size declared when the upload was initiated. This batch cannot be corrected; start a new upload.",
  SIZE_LIMIT:
    "The uploaded file exceeds the maximum allowed size. This batch cannot be corrected; start a new upload with a smaller file.",
  ZERO_BYTE:
    "The uploaded file is empty (zero bytes). This batch cannot be corrected; start a new upload.",
  HASH_MISMATCH:
    "The uploaded file's content does not match the checksum that was expected for this upload. This batch cannot be corrected; start a new upload.",
  PREFLIGHT_REJECTED:
    "The uploaded file failed a required content safety check and cannot be processed. This batch cannot be corrected; start a new upload with a corrected file.",
  PROVIDER_FAILURE:
    "A storage provider error occurred while processing this file. This may be a temporary condition; a retry may succeed.",
  STALE_RECLAIMED:
    "This attempt was automatically reclaimed after exceeding its processing time limit. A retry may succeed.",
  // Caller-only outcome codes (never persisted).
  INVALID_REQUEST: "The request could not be processed because it was invalid.",
  IDEMPOTENCY_CONFLICT:
    "A different request already exists for this idempotency key. Use a new idempotency key to start a different upload.",
  NOT_FOUND: "No matching import batch was found for this organisation.",
  INVALID_STATE: "The import batch is not currently in a state that allows this operation.",
  CONFIGURATION_ERROR:
    "The service is not correctly configured to complete this request. Contact an administrator.",
  RECLAIM_NOT_ALLOWED: "This import batch cannot currently be reclaimed.",
  OWNERSHIP_LOST:
    "This attempt no longer owns the import batch — a newer attempt or an automatic reclaim has already taken over.",
};

const MAX_MESSAGE_LENGTH = 500;

// Module-load-time self-check (the "enforce in code" half of the Step 6
// requirement — the test suite's own assertion is the second, independent
// half). A template exceeding the DB's own CHECK constraint bound would be
// a silent, only-discovered-at-write-time bug; failing fast at import time
// makes it impossible to ship.
for (const [code, template] of Object.entries(MESSAGE_TEMPLATES)) {
  if (template.length > MAX_MESSAGE_LENGTH) {
    throw new Error(
      `failureTaxonomy: message template for "${code}" is ${template.length} characters, exceeding the ${MAX_MESSAGE_LENGTH}-character limit.`
    );
  }
}

/**
 * Returns the fixed, sanitized message template for a given failure/outcome
 * code. Never accepts or interpolates any caller-supplied text — the
 * returned string is always exactly one of the fixed templates above.
 */
export function getMessageTemplate(code: FailureCode): string {
  return MESSAGE_TEMPLATES[code];
}
