import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma";
import sql from "../../db";
import { resolveStagingEligibility, resolvePinnedStagingRunContext } from "./eligibility";
import { readWorksheetDataRows, type GovernedColumnAddress } from "../workbookParser";
import { buildImportBatchKey, RawFileStoreError } from "../storage/rawFileStore";
import { createImportBatchStorage } from "../importBatch/compositionRoot";
import { MAX_SOURCE_FILE_BYTES } from "../limits";
import { resolveLeaseSeconds } from "./stagingConfig";

// Data Hub 6.2D4B — staging-run lifecycle (create/resume/lease) service.
//
// AUTH BOUNDARY: same discipline as establishImportBatchSchemaLineage.ts —
// accepts an already-resolved trusted context only. Never reads request
// input, never resolves its own session.
//
// LEASE MODEL: a run is created already holding its lease (status='RUNNING'
// from the moment of INSERT — no PENDING state). Every call to this
// module's createOrResumeStagingRun mints a FRESH execution_token and
// attempts an atomic conditional claim — either creating a brand new run,
// or taking over/renewing an existing RUNNING run's lease (only possible
// when that lease is expired, or already held by the caller's own prior
// token from an earlier batch within the same overall attempt — see the
// conditional UPDATE below). A live lease held by someone else yields
// RUN_ALREADY_IN_PROGRESS; the caller must not proceed.

export const PARSER_VERSION = "6.2D4B-1";

export type CreateOrResumeFailureCode = "BATCH_NOT_READY" | "STAGING_INELIGIBLE" | "INVALID_STATE" | "RUN_ALREADY_IN_PROGRESS" | "ALREADY_STAGED" | "STORAGE_NOT_FOUND" | "PROVIDER_FAILURE" | "STORAGE_INTEGRITY_MISMATCH" | "PARSER_REJECTED";

export interface ActiveStagingRun {
  id: string;
  organisationId: string;
  importBatchId: string;
  uploadId: string;
  sourceSchemaVersionId: string;
  sourceSchemaWorksheetId: string;
  worksheetMappingProfileId: string;
  worksheetMappingProfileVersionId: string;
  executionToken: string;
  headerRowOneBased: number;
  worksheetIndex: number;
  originalFilename: string;
  // REMEDIATION: pinned at resolution time (new-run eligibility, or the
  // existing run's own pinned context — never re-derived mid-batch-loop).
  sourceSha256: string;
  governedColumns: GovernedColumnAddress[];
  expectedRowCount: number;
  expectedCellCount: number;
  persistedRowCount: number;
  persistedCellCount: number;
}

export type CreateOrResumeResult =
  | { ok: true; alreadyStaged: false; run: ActiveStagingRun }
  | { ok: true; alreadyStaged: true }
  | { ok: false; code: CreateOrResumeFailureCode };

async function tryTakeoverExisting(
  existingRunId: string,
  organisationId: string,
  newToken: string,
  leaseSeconds: number
): Promise<boolean> {
  const rows = (await sql`
    UPDATE data_hub_raw_staging_runs
    SET execution_token = ${newToken},
        lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
        last_progress_at = now()
    WHERE id = ${existingRunId} AND organisation_id = ${organisationId}
      AND status = 'RUNNING' AND lease_expires_at < now()
    RETURNING id
  `) as unknown as { id: string }[];
  return rows.length === 1;
}

export async function createOrResumeStagingRun(context: {
  organisationId: string;
  uploadId: string;
  actorUserId: string;
  leaseSeconds?: number;
}): Promise<CreateOrResumeResult> {
  const { organisationId, uploadId, actorUserId } = context;
  const leaseSeconds = context.leaseSeconds ?? resolveLeaseSeconds();

  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
    select: { raw_staged_at: true },
  });
  if (!upload) return { ok: false, code: "INVALID_STATE" };
  if (upload.raw_staged_at !== null) return { ok: true, alreadyStaged: true };

  const existing = await prisma.dataHubRawStagingRun.findFirst({
    where: { organisation_id: organisationId, upload_id: uploadId, status: "RUNNING" },
    select: { id: true },
  });

  const newToken = randomUUID();

  // REMEDIATION: an EXISTING run is NEVER resolved via
  // resolveStagingEligibility (which follows today's
  // active_profile_version_id) — it is resolved EXCLUSIVELY via
  // resolvePinnedStagingRunContext, from the run's own immutably-pinned
  // IDs. resolveStagingEligibility is called ONLY further below, on the
  // genuinely-new-run path.
  if (existing) {
    const took = await tryTakeoverExisting(existing.id, organisationId, newToken, leaseSeconds);
    if (!took) return { ok: false, code: "RUN_ALREADY_IN_PROGRESS" };
    const run = await prisma.dataHubRawStagingRun.findFirstOrThrow({
      where: { id: existing.id, organisation_id: organisationId },
    });
    const pinned = await resolvePinnedStagingRunContext({
      organisationId,
      uploadId: run.upload_id,
      importBatchId: run.import_batch_id,
      sourceSchemaVersionId: run.source_schema_version_id,
      sourceSchemaWorksheetId: run.source_schema_worksheet_id,
      worksheetMappingProfileId: run.worksheet_mapping_profile_id,
      worksheetMappingProfileVersionId: run.worksheet_mapping_profile_version_id,
    });
    if (!pinned.ok) return { ok: false, code: pinned.code };
    return {
      ok: true,
      alreadyStaged: false,
      run: {
        id: run.id,
        organisationId,
        importBatchId: run.import_batch_id,
        uploadId: run.upload_id,
        sourceSchemaVersionId: run.source_schema_version_id,
        sourceSchemaWorksheetId: run.source_schema_worksheet_id,
        worksheetMappingProfileId: run.worksheet_mapping_profile_id,
        // Reported verbatim from the run row itself — NEVER from `pinned`
        // (which, being derived from the same immutable IDs, will always
        // agree, but the run row is the one authoritative source).
        worksheetMappingProfileVersionId: run.worksheet_mapping_profile_version_id,
        executionToken: newToken,
        headerRowOneBased: pinned.headerRowOneBased,
        worksheetIndex: pinned.worksheetIndex,
        originalFilename: pinned.originalFilename,
        sourceSha256: pinned.sha256,
        governedColumns: pinned.governedColumns,
        expectedRowCount: run.expected_row_count ?? 0,
        expectedCellCount: run.expected_cell_count ?? 0,
        persistedRowCount: run.persisted_row_count,
        persistedCellCount: run.persisted_cell_count,
      },
    };
  }

  // Genuinely new run — resolveStagingEligibility is the correct, and
  // only, gate here: it resolves TODAY's active profile version and pins
  // it onto the run being created.
  const eligibility = await resolveStagingEligibility({ organisationId, uploadId });
  if (!eligibility.ok) return { ok: false, code: eligibility.code };

  const storage = createImportBatchStorage();
  let stored;
  try {
    stored = await storage.get(buildImportBatchKey(organisationId, eligibility.importBatchId), { maxBytes: MAX_SOURCE_FILE_BYTES });
  } catch (err) {
    if (err instanceof RawFileStoreError && err.code === "NOT_FOUND") return { ok: false, code: "STORAGE_NOT_FOUND" };
    return { ok: false, code: "PROVIDER_FAILURE" };
  }
  const { createHash } = await import("node:crypto");
  if (createHash("sha256").update(stored.body).digest("hex") !== eligibility.sha256) {
    return { ok: false, code: "STORAGE_INTEGRITY_MISMATCH" };
  }

  // Compute expected counts up front via one full physical scan (no rows
  // persisted yet) — set once, immutably, at run creation.
  let expectedRowCount = 0;
  let expectedCellCount = 0;
  try {
    let cursor: number | undefined = undefined;
    for (;;) {
      const page = await readWorksheetDataRows(
        stored.body,
        { filename: eligibility.originalFilename },
        {
          index: eligibility.worksheetIndex,
          headerRowOneBased: eligibility.headerRowOneBased,
          governedColumns: eligibility.governedColumns,
          resumeAfterSourceRowOneBased: cursor,
          maxRowsToRead: 5000,
        }
      );
      expectedRowCount += page.rows.length;
      expectedCellCount += page.rows.length * eligibility.governedColumns.length;
      if (page.exhausted) break;
      cursor = page.rows.length > 0 ? page.rows[page.rows.length - 1].sourceRowOneBased : cursor;
      if (page.rows.length === 0) break;
    }
  } catch {
    return { ok: false, code: "PARSER_REJECTED" };
  }

  const attemptAgg = await prisma.dataHubRawStagingRun.aggregate({
    where: { organisation_id: organisationId, upload_id: uploadId },
    _max: { attempt_number: true },
  });
  const attemptNumber = (attemptAgg._max.attempt_number ?? 0) + 1;

  const runId = randomUUID();
  await prisma.dataHubRawStagingRun.create({
    data: {
      id: runId,
      organisation_id: organisationId,
      import_batch_id: eligibility.importBatchId,
      upload_id: uploadId,
      source_schema_version_id: eligibility.sourceSchemaVersionId,
      source_schema_worksheet_id: eligibility.sourceSchemaWorksheetId,
      worksheet_mapping_profile_id: eligibility.worksheetMappingProfileId,
      worksheet_mapping_profile_version_id: eligibility.worksheetMappingProfileVersionId,
      attempt_number: attemptNumber,
      source_sha256: eligibility.sha256,
      parser_version: PARSER_VERSION,
      status: "RUNNING",
      execution_token: newToken,
      lease_expires_at: new Date(Date.now() + leaseSeconds * 1000),
      last_progress_at: new Date(),
      expected_row_count: expectedRowCount,
      expected_cell_count: expectedCellCount,
      persisted_row_count: 0,
      persisted_cell_count: 0,
      created_by: actorUserId,
    },
  });

  return {
    ok: true,
    alreadyStaged: false,
    run: {
      id: runId,
      organisationId,
      importBatchId: eligibility.importBatchId,
      uploadId,
      sourceSchemaVersionId: eligibility.sourceSchemaVersionId,
      sourceSchemaWorksheetId: eligibility.sourceSchemaWorksheetId,
      worksheetMappingProfileId: eligibility.worksheetMappingProfileId,
      worksheetMappingProfileVersionId: eligibility.worksheetMappingProfileVersionId,
      executionToken: newToken,
      headerRowOneBased: eligibility.headerRowOneBased,
      worksheetIndex: eligibility.worksheetIndex,
      originalFilename: eligibility.originalFilename,
      sourceSha256: eligibility.sha256,
      governedColumns: eligibility.governedColumns,
      expectedRowCount,
      expectedCellCount,
      persistedRowCount: 0,
      persistedCellCount: 0,
    },
  };
}

// Remediation (point 5): conditioned on the CURRENT lease (token + still
// RUNNING + not expired) — a worker that has already lost its lease has no
// authority to declare this run FAILED (someone else may already be
// entitled to resume it). Returns whether the transition actually applied,
// so callers can tell "durably failed" apart from "lease already lost"
// and avoid claiming an API outcome the durable state doesn't back up.
export async function markRunFailed(context: {
  organisationId: string;
  runId: string;
  executionToken: string;
  failureCode: string;
  failureDetail?: string;
}): Promise<boolean> {
  const rows = (await sql`
    UPDATE data_hub_raw_staging_runs
    SET status = 'FAILED', failed_at = now(), failure_code = ${context.failureCode}, failure_detail = ${context.failureDetail ?? null}
    WHERE id = ${context.runId} AND organisation_id = ${context.organisationId}
      AND status = 'RUNNING' AND execution_token = ${context.executionToken}
      AND lease_expires_at > now()
    RETURNING id
  `) as unknown as { id: string }[];
  return rows.length === 1;
}

// Remediation (point 1 — graceful yield/continuation): called by
// stageWorksheetRows.ts when it stops early because its request time
// budget is reached with more work remaining. Sets lease_expires_at to
// now() (unambiguously already-expired/immediately-reacquirable) so the
// VERY NEXT request for this upload can atomically take the lease over
// via createOrResumeStagingRun's own tryTakeoverExisting — no waiting out
// the full lease duration. Conditioned on the CURRENT token still holding
// a live, RUNNING lease; if that has already changed (lost to someone
// else, or already yielded), returns false rather than silently
// no-op-succeeding, so the caller can report LEASE_LOST instead of RUNNING.
export async function releaseLeaseForYield(context: {
  organisationId: string;
  runId: string;
  executionToken: string;
}): Promise<boolean> {
  const rows = (await sql`
    UPDATE data_hub_raw_staging_runs
    SET lease_expires_at = now()
    WHERE id = ${context.runId} AND organisation_id = ${context.organisationId}
      AND execution_token = ${context.executionToken} AND status = 'RUNNING'
    RETURNING id
  `) as unknown as { id: string }[];
  return rows.length === 1;
}
