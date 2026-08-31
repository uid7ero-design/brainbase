import sql from "../../db";
import {
  type PersistedFailureCode,
  PERSISTED_FAILURE_CODES,
  isFinalizationRetryEligible,
  getDbRetryable,
  getMessageTemplate,
} from "./failureTaxonomy";
import type { FinalizeImportBatchResult } from "./finalize";

// ============================================================================
// INTERNAL MODULE — NOT PART OF THE PUBLIC SERVICE CONTRACT.
//
// This file exists ONLY so the real-Postgres attempt-fencing integration
// test can drive the exact production SQL primitives directly. The ONLY
// production file permitted to import from this module is
// lib/data-hub/importBatch/finalize.ts. The ONLY test file permitted to
// import from it is scripts/tests/importBatchService.integration.test.ts
// (it needs to sequence "attempt 1 claims", an external stale-reclaim,
// "attempt 2 claims", and "attempt 1 completes using its own stale
// generation" deterministically against the exact same production SQL —
// never a hand-duplicated copy of it). No other file, production or test,
// may import from this module. This restriction is enforced by containment
// tests in tests/containment/finalizeImportBatch.test.ts (repo-wide
// import-statement scan), not by language-level privacy — these exports
// are real, importable bindings, so the safety here comes entirely from
// that discipline plus finalize.ts never re-exporting them under any name.
//
// WHY THIS IS DANGEROUS TO IMPORT ELSEWHERE: these are low-level,
// UNVALIDATED persistence primitives. completeReadyForFinalize and
// completeFailedForFinalize accept a caller-supplied `generation` number
// with ZERO runtime check that it corresponds to any real prior claim by
// the caller — the only thing that makes a call to them safe is the fenced
// WHERE clause baked into the SQL itself (id + organisation_id +
// status='PROCESSING' + attempt_count = generation), combined with the
// discipline that nothing but finalizeImportBatch's own claim/storage/
// validation pipeline ever calls them in production. A future caller
// importing this file directly in application code would bypass that
// entire pipeline and could force a row's state without ever performing a
// real claim, a real storage fetch, or any of finalize.ts's own
// validation. See finalize.ts's own header comment for the full design
// rationale behind the claim/fencing scheme these functions implement.
// ============================================================================

export interface ClaimedRow {
  attempt_count: number;
  content_type: string;
  size_bytes: number;
  expected_sha256: string | null;
}

const FINALIZATION_RETRY_ELIGIBLE_CODES = PERSISTED_FAILURE_CODES.filter(isFinalizationRetryEligible);

// ---------------------------------------------------------------------------
// Step 16 — the ONE atomic, fully-predicated claim statement. No transient
// write to any ineligible row ever occurs: id, organisation_id, and the
// eligible-state-or-failure-code condition are all part of the SAME WHERE
// clause of the SAME UPDATE. RETURNING captures the new attempt-generation
// value N atomically in the same statement — never a separate SELECT
// afterward, which would reintroduce a race.
// ---------------------------------------------------------------------------

/**
 * TESTING SEAM (exported for tests/scripts only — NOT part of the public
 * service contract; production code must only ever call
 * finalizeImportBatch, and finalize.ts is the only production file
 * permitted to import this module at all — see the file header above).
 * Exposed so the mandatory real-Postgres attempt-fencing proof (Step 23)
 * can sequence "attempt 1 claims", an external stale-reclaim, "attempt 2
 * claims", and "attempt 1 completes using its own stale generation"
 * deterministically against the exact same production SQL — never a
 * hand-duplicated copy of it.
 */
export async function claimForFinalize(organisationId: string, importBatchId: string): Promise<ClaimedRow | null> {
  const rows = (await sql`
    UPDATE import_batches
    SET status = 'PROCESSING',
        attempt_count = attempt_count + 1,
        last_attempt_at = now(),
        last_failure_retryable = NULL
    WHERE id = ${importBatchId}
      AND organisation_id = ${organisationId}
      AND (
        status = 'AWAITING_UPLOAD'
        OR (status = 'FAILED' AND last_failure_code = ANY(${FINALIZATION_RETRY_ELIGIBLE_CODES}::text[]))
      )
    RETURNING attempt_count, content_type, size_bytes, expected_sha256
  `) as unknown as ClaimedRow[];
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Step 22 — FAILED completion fence. Same ownership fence as READY
// (id, organisation_id, status='PROCESSING', attempt_count=N). Never
// writes a raw caught SDK/SQL/provider error's own message — only the
// fixed, sanitized template for the given code.
// ---------------------------------------------------------------------------

/**
 * TESTING SEAM (exported for tests/scripts only — NOT part of the public
 * service contract; production code must only ever call
 * finalizeImportBatch). See claimForFinalize's own header comment.
 */
export async function completeFailedForFinalize(
  organisationId: string,
  importBatchId: string,
  generation: number,
  code: PersistedFailureCode
): Promise<FinalizeImportBatchResult> {
  const retryable = getDbRetryable(code);
  const message = getMessageTemplate(code);
  const rows = (await sql`
    UPDATE import_batches
    SET status = 'FAILED',
        last_failure_code = ${code},
        last_failure_message = ${message},
        last_failure_retryable = ${retryable}
    WHERE id = ${importBatchId}
      AND organisation_id = ${organisationId}
      AND status = 'PROCESSING'
      AND attempt_count = ${generation}
    RETURNING id
  `) as unknown as { id: string }[];

  if (rows.length === 0) {
    return { outcome: "OWNERSHIP_LOST", batchId: importBatchId };
  }
  return { outcome: "FAILED", batchId: importBatchId, failureCode: code, retryable };
}

// ---------------------------------------------------------------------------
// Step 21 — READY completion fence. Second, independent, fully-fenced
// conditional UPDATE keyed on the exact generation N captured at claim
// time. Never touches size_bytes/attempt_count/last_attempt_at.
// ---------------------------------------------------------------------------

/**
 * TESTING SEAM (exported for tests/scripts only — NOT part of the public
 * service contract; production code must only ever call
 * finalizeImportBatch). See claimForFinalize's own header comment.
 */
export async function completeReadyForFinalize(
  organisationId: string,
  importBatchId: string,
  generation: number,
  sha256: string,
  storageEtag: string | undefined
): Promise<FinalizeImportBatchResult> {
  const readyRows = (await sql`
    UPDATE import_batches
    SET status = 'READY',
        sha256 = ${sha256},
        storage_etag = ${storageEtag ?? null},
        last_failure_code = NULL,
        last_failure_message = NULL,
        last_failure_retryable = NULL
    WHERE id = ${importBatchId}
      AND organisation_id = ${organisationId}
      AND status = 'PROCESSING'
      AND attempt_count = ${generation}
    RETURNING id
  `) as unknown as { id: string }[];

  if (readyRows.length === 0) {
    // A newer attempt or a stale-reclaim sweep has already taken
    // ownership — discard this attempt's work, do not repair/retry/write
    // anything else.
    return { outcome: "OWNERSHIP_LOST", batchId: importBatchId };
  }

  return { outcome: "READY", batchId: importBatchId, sha256, storageEtag };
}
