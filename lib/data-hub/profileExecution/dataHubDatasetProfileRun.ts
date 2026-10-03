import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import sql from "../../db";

// Data Hub 6.2D4D1B2 — dataset-profile-run lifecycle (resolve authoritative
// target / create attempt / fail attempt / abandon stale attempt).
// Structural analogue of
// lib/data-hub/normalizationExecution/dataHubNormalizationRun.ts, applied
// to D4D1B1's data_hub_dataset_profile_runs instead of
// data_hub_normalization_runs -- with ONE deliberate simplification: D4D1B1
// gave DataHubDatasetProfileRun no execution_token/lease_expires_at at all
// (profiling an already-persisted, already-small evidence set is a single
// synchronous operation, never a multi-request resumable batch loop like
// raw staging/normalization), so there is no lease to take over and no
// lease-stall class of bug to defend against here. A RUNNING attempt is
// owned by whichever single call created it, for the duration of that one
// call.
//
// DIRECTORY: lives beside normalizationExecution/staging (imports Prisma +
// the raw sql client), never under lib/data-hub/profiling/ (D4D1A's own
// pure library) or lib/data-hub/normalization/ (D4C-B2A's own pure
// library) -- importing either from there would break their own purity
// containment tests.
//
// AUTH BOUNDARY: accepts already-resolved trusted context only (never reads
// request input, never resolves its own session).

export type CreateDatasetProfileRunFailureCode = "NORMALIZATION_NOT_COMPLETE" | "NORMALIZATION_RUN_NOT_SUCCEEDED" | "PERSISTENCE_FAILURE";

export interface PinnedNormalizationContext {
  normalizationRunId: string;
  importBatchId: string;
  uploadId: string;
  sourceSchemaVersionId: string;
  sourceSchemaWorksheetId: string;
  worksheetMappingProfileVersionId: string;
  /** Normalization's own already-reconciled persisted row count -- the trusted D4D1A rowCount input. */
  persistedRowCount: number;
}

export type ResolveNormalizationContextResult = { ok: true; normalization: PinnedNormalizationContext } | { ok: false; code: "NORMALIZATION_NOT_COMPLETE" | "NORMALIZATION_RUN_NOT_SUCCEEDED" };

/**
 * Resolves the Upload's SINGLE authoritative normalization target. Never
 * accepts a normalization_run_id from a caller -- always derives it from
 * Upload.normalization_run_id (the same field D4C-B2B2A's own executor
 * writes as part of normalization completion), then independently proves
 * the pinned run belongs to this exact organisation/upload and is
 * SUCCEEDED. This is the ONLY place in this module that resolves "which
 * normalization run" -- every other function in this file receives an
 * already-resolved PinnedNormalizationContext.
 */
export async function resolveAuthoritativeNormalizationContext(context: { organisationId: string; uploadId: string }): Promise<ResolveNormalizationContextResult> {
  const upload = await prisma.upload.findFirst({
    where: { id: context.uploadId, organisation_id: context.organisationId, lineage_kind: "DATA_HUB" },
    select: { normalization_run_id: true },
  });
  if (!upload || upload.normalization_run_id === null) return { ok: false, code: "NORMALIZATION_NOT_COMPLETE" };

  // Matches Upload's own composite FK target exactly: (upload_id,
  // normalization_run_id, organisation_id) -> uploads(id,
  // normalization_run_id, organisation_id) is already proven at the DB
  // level by the time Upload.normalization_run_id is non-null -- this read
  // re-derives the run's own pinned lineage, never trusts a caller-supplied
  // value for any of it.
  const run = await prisma.dataHubNormalizationRun.findFirst({
    where: { id: upload.normalization_run_id, organisation_id: context.organisationId, upload_id: context.uploadId },
    select: {
      status: true,
      import_batch_id: true,
      source_schema_version_id: true,
      source_schema_worksheet_id: true,
      worksheet_mapping_profile_version_id: true,
      persisted_row_count: true,
    },
  });
  if (!run) return { ok: false, code: "NORMALIZATION_NOT_COMPLETE" };
  if (run.status !== "SUCCEEDED") return { ok: false, code: "NORMALIZATION_RUN_NOT_SUCCEEDED" };

  return {
    ok: true,
    normalization: {
      normalizationRunId: upload.normalization_run_id,
      importBatchId: run.import_batch_id,
      uploadId: context.uploadId,
      sourceSchemaVersionId: run.source_schema_version_id,
      sourceSchemaWorksheetId: run.source_schema_worksheet_id,
      worksheetMappingProfileVersionId: run.worksheet_mapping_profile_version_id,
      persistedRowCount: run.persisted_row_count,
    },
  };
}

export interface ExistingDatasetProfileRunSummary {
  id: string;
  status: string;
  profilerVersion: string;
  attemptNumber: number;
  rowCount: bigint | null;
  columnCount: bigint | null;
}

/** Most recent attempt (by attempt_number) for this exact normalization run, or null if none exists yet. */
export async function findLatestDatasetProfileRun(context: { organisationId: string; normalizationRunId: string }): Promise<ExistingDatasetProfileRunSummary | null> {
  const run = await prisma.dataHubDatasetProfileRun.findFirst({
    where: { organisation_id: context.organisationId, normalization_run_id: context.normalizationRunId },
    orderBy: { attempt_number: "desc" },
    select: { id: true, status: true, profiler_version: true, attempt_number: true, row_count: true, column_count: true },
  });
  if (!run) return null;
  return { id: run.id, status: run.status, profilerVersion: run.profiler_version, attemptNumber: run.attempt_number, rowCount: run.row_count, columnCount: run.column_count };
}

export interface ActiveDatasetProfileRun {
  id: string;
  organisationId: string;
  importBatchId: string;
  uploadId: string;
  normalizationRunId: string;
  sourceSchemaVersionId: string;
  sourceSchemaWorksheetId: string;
  worksheetMappingProfileVersionId: string;
  attemptNumber: number;
  profilerVersion: string;
}

export type CreateDatasetProfileRunResult =
  | { ok: true; created: true; run: ActiveDatasetProfileRun }
  // A genuine create-race: another concurrent caller won. Truthfully
  // reports the run that now exists rather than ever claiming to have
  // created a second one.
  | { ok: true; created: false; profileRunId: string }
  | { ok: false; code: CreateDatasetProfileRunFailureCode };

/**
 * Phase A: creates ONE new, immutable-lineage, RUNNING profile attempt.
 * Caller must have already resolved and validated the
 * PinnedNormalizationContext (resolveAuthoritativeNormalizationContext) --
 * this function re-derives nothing and trusts exactly the context it is
 * given, mirroring createOrResumeNormalizationRun's own pinned-context
 * discipline.
 *
 * Attempt-number allocation: MAX(attempt_number)+1 scoped by upload_id
 * (D4D1B1's own unique(upload_id, attempt_number) key), identical to
 * createOrResumeNormalizationRun's own attemptAgg pattern. Concurrency
 * safety does not come from this MAX query (which is inherently racy on
 * its own) but from catching the DB's own unique-constraint violation on
 * create() -- via Prisma's typed P2002 detection, never raw driver text --
 * then independently re-verifying a RUNNING attempt now exists for this
 * exact normalization_run_id before reporting the race truthfully. This is
 * the exact create-race pattern createOrResumeNormalizationRun's own
 * CREATE_RACE_TRANSLATION block uses.
 */
export async function createDatasetProfileRunAttempt(context: { organisationId: string; actorId: string; normalization: PinnedNormalizationContext; profilerVersion: string }): Promise<CreateDatasetProfileRunResult> {
  const { organisationId, actorId, normalization, profilerVersion } = context;

  const attemptAgg = await prisma.dataHubDatasetProfileRun.aggregate({
    where: { organisation_id: organisationId, upload_id: normalization.uploadId },
    _max: { attempt_number: true },
  });
  const attemptNumber = (attemptAgg._max.attempt_number ?? 0) + 1;

  const runId = randomUUID();
  try {
    await prisma.dataHubDatasetProfileRun.create({
      data: {
        id: runId,
        organisation_id: organisationId,
        import_batch_id: normalization.importBatchId,
        upload_id: normalization.uploadId,
        normalization_run_id: normalization.normalizationRunId,
        source_schema_version_id: normalization.sourceSchemaVersionId,
        source_schema_worksheet_id: normalization.sourceSchemaWorksheetId,
        worksheet_mapping_profile_version_id: normalization.worksheetMappingProfileVersionId,
        attempt_number: attemptNumber,
        profiler_version: profilerVersion,
        status: "RUNNING",
        created_by: actorId,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const nowRunning = await prisma.dataHubDatasetProfileRun.findFirst({
        where: { organisation_id: organisationId, normalization_run_id: normalization.normalizationRunId, status: "RUNNING" },
        select: { id: true },
      });
      if (nowRunning) {
        return { ok: true, created: false, profileRunId: nowRunning.id };
      }
    }
    return { ok: false, code: "PERSISTENCE_FAILURE" };
  }

  return {
    ok: true,
    created: true,
    run: {
      id: runId,
      organisationId,
      importBatchId: normalization.importBatchId,
      uploadId: normalization.uploadId,
      normalizationRunId: normalization.normalizationRunId,
      sourceSchemaVersionId: normalization.sourceSchemaVersionId,
      sourceSchemaWorksheetId: normalization.sourceSchemaWorksheetId,
      worksheetMappingProfileVersionId: normalization.worksheetMappingProfileVersionId,
      attemptNumber,
      profilerVersion,
    },
  };
}

/**
 * Transitions a RUNNING attempt this call owns to FAILED. Conditioned only
 * on (id, organisation_id, status='RUNNING') -- no execution_token exists
 * on this table (see module header), and no other process can legitimately
 * be operating on a run this same synchronous call just created, so no
 * lease-style condition is needed. Returns whether the transition actually
 * applied (false only if the run was somehow already terminal, which this
 * module's own call sequencing should make unreachable in practice).
 * Never persists a raw exception message -- failureCode is always one of
 * D4D1B1's own closed vocabulary.
 */
export async function markDatasetProfileRunFailed(context: { organisationId: string; runId: string; failureCode: string }): Promise<boolean> {
  const rows = (await sql`
    UPDATE data_hub_dataset_profile_runs
    SET status = 'FAILED', failed_at = now(), failure_code = ${context.failureCode}
    WHERE id = ${context.runId} AND organisation_id = ${context.organisationId} AND status = 'RUNNING'
    RETURNING id
  `) as unknown as { id: string }[];
  return rows.length === 1;
}

/**
 * Explicit, OPERATOR-INVOKED recovery for a RUNNING attempt stranded by a
 * process crash between Phase A and Phase C (see profileUploadDataset.ts's
 * own header comment). This is NEVER called automatically by this module,
 * by a scheduler, or by any wall-clock-elapsed heuristic -- D4D1B2
 * deliberately does not build one (per the task's own instruction). A
 * future operator tool/CLI may call this directly when a stuck RUNNING row
 * is confirmed abandoned.
 */
export async function abandonStaleDatasetProfileRun(context: { organisationId: string; runId: string }): Promise<boolean> {
  const rows = (await sql`
    UPDATE data_hub_dataset_profile_runs
    SET status = 'ABANDONED'
    WHERE id = ${context.runId} AND organisation_id = ${context.organisationId} AND status = 'RUNNING'
    RETURNING id
  `) as unknown as { id: string }[];
  return rows.length === 1;
}
