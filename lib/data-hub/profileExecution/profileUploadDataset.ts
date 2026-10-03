import { profileDataset } from "../profiling/profileDataset";
import { DATASET_PROFILER_VERSION } from "../profiling/contracts";
import { reconstructNormalizedDatasetEvidence } from "./normalizedEvidenceAdapter";
import { completeDatasetProfileRun } from "./completeDatasetProfileRun";
import { resolveAuthoritativeNormalizationContext, findLatestDatasetProfileRun, createDatasetProfileRunAttempt, markDatasetProfileRunFailed } from "./dataHubDatasetProfileRun";

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

  // Phase B -- no open transaction while this runs.
  const evidenceResult = await reconstructNormalizedDatasetEvidence({
    organisationId,
    normalizationRunId: normalization.normalizationRunId,
    sourceSchemaWorksheetId: normalization.sourceSchemaWorksheetId,
    worksheetMappingProfileVersionId: normalization.worksheetMappingProfileVersionId,
    rowCount: normalization.persistedRowCount,
  });
  if (!evidenceResult.ok) {
    await markDatasetProfileRunFailed({ organisationId, runId: run.id, failureCode: "PROFILE_INPUT_INVALID" });
    return { ok: false, code: "PROFILE_INPUT_INVALID" };
  }

  // D4D1A, called exactly once, unmodified.
  const profileResult = profileDataset(evidenceResult.input);
  if (!profileResult.ok) {
    await markDatasetProfileRunFailed({ organisationId, runId: run.id, failureCode: "PROFILE_INPUT_INVALID" });
    return { ok: false, code: "PROFILE_INPUT_INVALID" };
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
    await markDatasetProfileRunFailed({ organisationId, runId: run.id, failureCode: completion.code });
    return { ok: false, code: completion.code };
  }

  return succeededResult(run.id, DATASET_PROFILER_VERSION, normalization.normalizationRunId, BigInt(completion.rowCount), BigInt(completion.columnCount), { created: true, resumed: false, reused: false });
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
