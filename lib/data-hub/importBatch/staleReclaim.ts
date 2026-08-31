import sql from "../../db";
import { getMessageTemplate } from "./failureTaxonomy";

// Data Hub 5A.2G.1 — stale reclaim.
//
// A directly-callable service function only — NOT wired to any cron or
// scheduler anywhere in this phase (see tests/containment/
// dataHubImportBatchDarkness.test.ts for the static proof of that).
//
// AUTH BOUNDARY: exactly as initiate.ts/finalize.ts — this function has no
// request context at all (it is meant to be invoked by a future
// scheduler, not a user-facing route), and never imports lib/org.ts.
//
// THRESHOLD: 30 minutes (reverted from the prior discovery's un-evidenced
// 15-minute figure — the architecture review's own conclusion: fencing
// already makes a premature reclaim provably safe, so there is no
// correctness reason to tighten the threshold, only an unproven
// efficiency guess). Named, exported, independently-testable constant in
// CODE — never a literal baked directly into the raw SQL string — and the
// function accepts an optional override so tests can inject a much
// shorter threshold.
//
// Uses last_attempt_at, NOT updated_at, as the staleness signal:
// updated_at is also bumped by the completion UPDATE and cannot
// distinguish "just finished" from "stuck an hour ago".
//
// One atomic bulk UPDATE: WHERE status = 'PROCESSING' AND last_attempt_at
// <= (cutoff), computed SERVER-SIDE via Postgres's own now() (never an
// app-computed wall-clock value, to avoid clock skew). Does NOT touch
// attempt_count — reclaim doesn't itself attempt/claim anything; only a
// genuine finalize claim increments it.

export const STALE_RECLAIM_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export interface StaleReclaimResult {
  /** ids of every ImportBatch row this call reclaimed (moved PROCESSING -> FAILED/STALE_RECLAIMED). */
  reclaimedIds: string[];
}

/**
 * Reclaims every ImportBatch row stuck in PROCESSING for longer than
 * `thresholdMs` (default STALE_RECLAIM_THRESHOLD_MS), marking each FAILED
 * with the fixed STALE_RECLAIMED code/message and retryable=true. Global
 * (cross-tenant) by design — a stuck row's own organisation_id is
 * irrelevant to whether it is stale.
 */
export async function reclaimStaleImportBatches(
  thresholdMs: number = STALE_RECLAIM_THRESHOLD_MS
): Promise<StaleReclaimResult> {
  const message = getMessageTemplate("STALE_RECLAIMED");
  const thresholdSeconds = Math.max(0, Math.floor(thresholdMs / 1000));

  const rows = (await sql`
    UPDATE import_batches
    SET status = 'FAILED',
        last_failure_code = 'STALE_RECLAIMED',
        last_failure_message = ${message},
        last_failure_retryable = true
    WHERE status = 'PROCESSING'
      AND last_attempt_at <= now() - make_interval(secs => ${thresholdSeconds})
    RETURNING id
  `) as unknown as { id: string }[];

  return { reclaimedIds: rows.map((row) => row.id) };
}
