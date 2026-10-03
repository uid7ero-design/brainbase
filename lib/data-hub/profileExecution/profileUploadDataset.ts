import { profileDataset } from "../profiling/profileDataset";
import { DATASET_PROFILER_VERSION } from "../profiling/contracts";
import { reconstructNormalizedDatasetEvidence } from "./normalizedEvidenceAdapter";
import { completeDatasetProfileRun } from "./completeDatasetProfileRun";
import { resolveAuthoritativeNormalizationContext, findLatestDatasetProfileRun, createDatasetProfileRunAttempt, markDatasetProfileRunFailed, getDatasetProfileRunById } from "./dataHubDatasetProfileRun";

// Data Hub 6.2D4D1B2 — the trusted dataset-profile execution path:
// successful DataHubNormalizationRun -> reconstruct exact normalized
// evidence -> D4D1A pure profiler (called exactly once, unmodified) ->
// durable D4D1B1 profile attempt -> atomic completion -> Upload
// authoritative profile pointer.
//
// profileUploadDataset(...) is the ONLY public entry point. It derives
// normalization_run_id EXCLUSIVELY from the Upload's own authoritative
// pin (never accepts one from a caller) -- see
// dataHubDatasetProfileRun.ts's resolveAuthoritativeNormalizationContext.
//
// PHASES (deliberately not one long-lived transaction -- see each helper's
// own header comment for why):
//   Phase A (dataHubDatasetProfileRun.createDatasetProfileRunAttempt):
//     one immediate INSERT, commits on its own. A run row existing means a
//     real attempt exists.
//   Phase B (this file, in application memory, no open transaction):
//     reconstruct evidence, call D4D1A's pure profileDataset() exactly
//     once.
//   Phase C (completeDatasetProfileRun, one DB function call = one
//     transaction): insert every immutable column row, transition the run
//     to SUCCEEDED (firing D4D1B1's own pre-existing reconciliation
//     trigger), write Upload's pointer -- all or nothing.
// If Phase B or Phase C fails, the RUNNING attempt created in Phase A is
// explicitly transitioned to FAILED in a separate, bounded call -- never
// left RUNNING, never silently abandoned.
//
// REMEDIATION (PR #324 round 1) -- once a RUNNING attempt has been
// created, EVERYTHING downstream (evidence reconstruction, the D4D1A
// call, completion, and the failure-disposition call itself) is covered
// by one try/catch whose catch routes through disposeExecutionFailure
// below with PERSISTENCE_FAILURE. Dataset-profile runs deliberately carry
// no execution_token/lease_expires_at (see dataHubDatasetProfileRun.ts's
// own header comment), so a stranded RUNNING row has NO self-healing
// path at all -- unlike createOrResumeNormalizationRun's own lease model,
// there is no "next call takes over the stale lease" safety net here.
// This makes exception containment at this exact boundary load-bearing,
// not merely defensive, which is why this remediation exists: an
// uncaught exception from any of those four phases previously escaped
// profileUploadDataset() entirely, and the three failure call sites each
// discarded markDatasetProfileRunFailed's own boolean result, so a
// disposition that silently affected zero rows was never detected or
// handled truthfully.

export type ProfileUploadDatasetFailureCode = "NORMALIZATION_NOT_COMPLETE" | "NORMALIZATION_RUN_NOT_SUCCEEDED" | "PROFILER_VERSION_UNSUPPORTED" | "PROFILE_INPUT_INVALID" | "PROFILE_RECONCILIATION_FAILED" | "PERSISTENCE_FAILURE";

export interface ProfileUploadDatasetSuccess {
  ok: true;
  profileRunId: string;
  status: "RUNNING" | "SUCCEEDED";
  created: boolean;
  resumed: boolean;
  reused: boolean;
  profilerVersion: string;
  normalizationRunId: string;
  rowCount: number | null;
  columnCount: number | null;
}

export type ProfileUploadDatasetResult = ProfileUploadDatasetSuccess | { ok: false; code: ProfileUploadDatasetFailureCode };

export async function profileUploadDataset(context: { organisationId: string; uploadId: string; actorId: string }): Promise<ProfileUploadDatasetResult> {
  const { organisationId, uploadId, actorId } = context;

  const normalizationResult = await resolveAuthoritativeNormalizationContext({ organisationId, uploadId });
  if (!normalizationResult.ok) return { ok: false, code: normalizationResult.code };
  const normalization = normalizationResult.normalization;

  // CREATE-OR-REUSE SEMANTICS (section 10/17): checked BEFORE attempting a
  // new attempt -- an optimistic pre-check, not the actual concurrency
  // guarantee (that comes from the DB's own one-RUNNING partial unique
  // index + the P2002 race handling inside createDatasetProfileRunAttempt
  // below, exactly mirroring createOrResumeNormalizationRun's own two-
  // layer design).
  const existing = await findLatestDatasetProfileRun({ organisationId, normalizationRunId: normalization.normalizationRunId });
  if (existing) {
    if (existing.status === "RUNNING") {
      return runningResult(existing.id, existing.profilerVersion, normalization.normalizationRunId);
    }
    if (existing.status === "SUCCEEDED") {
      // Same run + same profiler version -> idempotent authoritative
      // success, truthfully reused, no second D4D1A execution.
      if (existing.profilerVersion === DATASET_PROFILER_VERSION) {
        return succeededResult(existing.id, existing.profilerVersion, normalization.normalizationRunId, existing.rowCount, existing.columnCount, { created: false, resumed: false, reused: true });
      }
      // DIFFERENT profiler version (section 17, choice B): reject as
      // unsupported until an explicit reprofile operation exists, rather
      // than silently overwriting/reinterpreting prior version history or
      // automatically creating a new versioned attempt. The smallest
      // correct contract for a slice with no reprofile operation at all.
      return { ok: false, code: "PROFILER_VERSION_UNSUPPORTED" };
    }
    // FAILED/ABANDONED terminal history -> a new monotonic attempt may be
    // created; falls through below. Historical rows are never touched.
  }

  const createResult = await createDatasetProfileRunAttempt({ organisationId, actorId, normalization, profilerVersion: DATASET_PROFILER_VERSION });
  if (!createResult.ok) return { ok: false, code: createResult.code };
  if (!createResult.created) {
    // Lost a genuine create race -- report the winner's identity
    // truthfully rather than ever claiming to have created a second
    // attempt.
    return runningResult(createResult.profileRunId, DATASET_PROFILER_VERSION, normalization.normalizationRunId);
  }
  const run = createResult.run;

  // From here on, a RUNNING attempt is durably committed. Every path
  // below -- expected bounded failures AND unexpected thrown exceptions
  // alike -- must dispose of it truthfully via disposeExecutionFailure,
  // never leave it stranded, never let a raw exception escape.
  try {
    // Phase B -- no open transaction while this runs.
    const evidenceResult = await reconstructNormalizedDatasetEvidence({
      organisationId,
      normalizationRunId: normalization.normalizationRunId,
      sourceSchemaWorksheetId: normalization.sourceSchemaWorksheetId,
      worksheetMappingProfileVersionId: normalization.worksheetMappingProfileVersionId,
      rowCount: normalization.persistedRowCount,
    });
    if (!evidenceResult.ok) {
      return await disposeExecutionFailure(organisationId, run.id, normalization.normalizationRunId, "PROFILE_INPUT_INVALID");
    }

    // D4D1A, called exactly once, unmodified.
    const profileResult = profileDataset(evidenceResult.input);
    if (!profileResult.ok) {
      return await disposeExecutionFailure(organisationId, run.id, normalization.normalizationRunId, "PROFILE_INPUT_INVALID");
    }

    // Phase C -- single atomic completion transaction.
    const completion = await completeDatasetProfileRun({
      organisationId,
      profileRunId: run.id,
      completedBy: actorId,
      profile: profileResult.profile,
      sourceColumnOrdinalByColumnId: evidenceResult.sourceColumnOrdinalByColumnId,
    });
    if (!completion.ok) {
      return await disposeExecutionFailure(organisationId, run.id, normalization.normalizationRunId, completion.code);
    }

    return succeededResult(run.id, DATASET_PROFILER_VERSION, normalization.normalizationRunId, BigInt(completion.rowCount), BigInt(completion.columnCount), { created: true, resumed: false, reused: false });
  } catch {
    // An UNEXPECTED thrown exception from any of the three phases above
    // (e.g. a dropped DB connection mid-query) -- never logged, never
    // persisted, never allowed to escape this function. Routed through
    // the exact same truthful disposition path as an ordinary bounded
    // failure, using PERSISTENCE_FAILURE since the true cause is an
    // infrastructure/transient error, not a data-shape problem.
    return await disposeExecutionFailure(organisationId, run.id, normalization.normalizationRunId, "PERSISTENCE_FAILURE");
  }
}

/**
 * The ONLY place profileUploadDataset disposes of a RUNNING attempt it
 * owns. Never throws (every internal step is individually guarded), so
 * it is always safe to call from inside a catch block. Distinguishes,
 * and reports truthfully, every outcome of attempting the FAILED
 * transition:
 *   - markDatasetProfileRunFailed() applies (returns true): the run is
 *     now durably FAILED. Return the ORIGINAL cause code, never a raw
 *     exception message.
 *   - markDatasetProfileRunFailed() itself throws (e.g. a connection
 *     error during the disposition UPDATE itself): caught here, never
 *     escapes. The run's true state is now unknown/unconfirmed -- never
 *     claim FAILED without DB confirmation. Returns bounded
 *     PERSISTENCE_FAILURE.
 *   - markDatasetProfileRunFailed() returns false (the UPDATE matched
 *     zero rows -- the run was no longer RUNNING by the time this call
 *     attempted the transition): re-read the run's CURRENT durable state
 *     rather than guessing, and report that truthfully:
 *       * already FAILED -> report that failure (its own failure_code,
 *         falling back to this call's own cause code only if somehow
 *         unset).
 *       * already SUCCEEDED -> report the real success (this should be
 *         unreachable given this module's own call sequencing, but if it
 *         ever happened, silently claiming failure here would be a
 *         worse lie than reporting the truth).
 *       * still RUNNING, or the row can no longer be found -- bounded
 *         PERSISTENCE_FAILURE; this is the one genuinely unresolved case
 *         (cleanup did not complete), reported as a retryable
 *         infrastructure failure rather than invented free-form state.
 */
async function disposeExecutionFailure(organisationId: string, runId: string, normalizationRunId: string, failureCode: ProfileUploadDatasetFailureCode): Promise<ProfileUploadDatasetResult> {
  let applied: boolean;
  try {
    applied = await markDatasetProfileRunFailed({ organisationId, runId, failureCode });
  } catch {
    return { ok: false, code: "PERSISTENCE_FAILURE" };
  }

  if (applied) {
    return { ok: false, code: failureCode };
  }

  const current = await getDatasetProfileRunById({ organisationId, runId }).catch(() => null);
  if (!current) {
    return { ok: false, code: "PERSISTENCE_FAILURE" };
  }
  if (current.status === "FAILED") {
    return { ok: false, code: (current.failureCode as ProfileUploadDatasetFailureCode | null) ?? failureCode };
  }
  if (current.status === "SUCCEEDED") {
    return succeededResult(current.id, current.profilerVersion, normalizationRunId, current.rowCount, current.columnCount, { created: false, resumed: false, reused: true });
  }
  // Still RUNNING (or any other non-terminal status) -- the disposition
  // genuinely did not complete. Never report FAILED without confirmation.
  return { ok: false, code: "PERSISTENCE_FAILURE" };
}

function runningResult(profileRunId: string, profilerVersion: string, normalizationRunId: string): ProfileUploadDatasetSuccess {
  return { ok: true, profileRunId, status: "RUNNING", created: false, resumed: true, reused: false, profilerVersion, normalizationRunId, rowCount: null, columnCount: null };
}

function succeededResult(
  profileRunId: string,
  profilerVersion: string,
  normalizationRunId: string,
  rowCount: bigint | null,
  columnCount: bigint | null,
  flags: { created: boolean; resumed: boolean; reused: boolean }
): ProfileUploadDatasetSuccess {
  return {
    ok: true,
    profileRunId,
    status: "SUCCEEDED",
    ...flags,
    profilerVersion,
    normalizationRunId,
    rowCount: rowCount === null ? null : Number(rowCount),
    columnCount: columnCount === null ? null : Number(columnCount),
  };
}
