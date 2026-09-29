import { randomUUID } from "node:crypto";
import { prisma } from "../../prisma";
import sql from "../../db";
import { buildNormalizationPlan } from "../normalization/plan";
import { NORMALIZER_VERSION } from "../normalization/contracts";
import type { NormalizationPlan } from "../normalization/contracts";
import { resolveLeaseSeconds } from "../staging/stagingConfig";

// Data Hub 6.2D4B2A — normalization-run lifecycle (create/resume/lease)
// service. Exact structural analogue of
// lib/data-hub/staging/dataHubRawStagingRun.ts's createOrResumeStagingRun,
// applied to data_hub_normalization_runs instead of
// data_hub_raw_staging_runs.
//
// DIRECTORY: deliberately NOT under lib/data-hub/normalization/ (the pure
// B2A transform library) -- this module imports Prisma and the raw sql
// client, which would break dataHubNormalizationPurity.test.ts's own
// guarantee that every file in that directory is import-nothing-from-
// Prisma/DB/fs/net-and-never-calls-Date.now()/Math.random() pure. Lives in
// its own sibling directory instead, mirroring D4B's own lib/data-hub/
// staging/ split from the pure parser/eligibility modules it depends on.
//
// AUTH BOUNDARY: accepts an already-resolved trusted context only. Never
// reads request input, never resolves its own session.
//
// LEASE MODEL: identical to D4B — a run is created already holding its
// lease (status='RUNNING' from the moment of INSERT). Every call mints a
// FRESH execution_token and attempts an atomic conditional claim: create a
// brand-new run, or take over an existing RUNNING run's lease (only
// possible when that lease has expired). A live lease held by someone else
// yields RUN_ALREADY_IN_PROGRESS.
//
// PINNED-PROFILE DISCIPLINE (D4B precedent, applied here): a NEW run reads
// Upload.raw_staging_run_id and pins the referenced raw run's own IDs
// (import_batch_id, source_schema_version_id, source_schema_worksheet_id,
// worksheet_mapping_profile_id, worksheet_mapping_profile_version_id) --
// never WorksheetMappingProfile.active_profile_version_id. An EXISTING
// (resumed) run re-derives its execution context EXCLUSIVELY from its own
// immutably pinned IDs -- never re-resolves eligibility, never reads the
// active profile pointer. tests/containment's own static assertions pin
// this the same way dataHubRawStagingRunFoundation.test.ts does for D4B.

export type CreateOrResumeNormalizationFailureCode =
  | "INVALID_STATE"
  | "RAW_STAGING_NOT_COMPLETE"
  | "RAW_RUN_NOT_SUCCEEDED"
  | "NORMALIZATION_INELIGIBLE"
  | "PROFILE_DOCUMENT_INVALID"
  | "NORMALIZATION_PLAN_INVALID"
  | "NORMALIZER_VERSION_UNSUPPORTED"
  | "RUN_ALREADY_IN_PROGRESS";

export interface ActiveNormalizationRun {
  id: string;
  organisationId: string;
  importBatchId: string;
  uploadId: string;
  rawStagingRunId: string;
  sourceSchemaVersionId: string;
  sourceSchemaWorksheetId: string;
  worksheetMappingProfileId: string;
  worksheetMappingProfileVersionId: string;
  normalizerVersion: string;
  executionToken: string;
  expectedRowCount: number;
  expectedCellCount: number;
  persistedRowCount: number;
  persistedCellCount: number;
  plan: NormalizationPlan;
}

export type CreateOrResumeNormalizationResult =
  | { ok: true; alreadyNormalized: false; run: ActiveNormalizationRun }
  | { ok: true; alreadyNormalized: true }
  | { ok: false; code: CreateOrResumeNormalizationFailureCode };

async function tryTakeoverExisting(existingRunId: string, organisationId: string, newToken: string, leaseSeconds: number): Promise<boolean> {
  const rows = (await sql`
    UPDATE data_hub_normalization_runs
    SET execution_token = ${newToken},
        lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
        last_progress_at = now()
    WHERE id = ${existingRunId} AND organisation_id = ${organisationId}
      AND status = 'RUNNING' AND lease_expires_at < now()
    RETURNING id
  `) as unknown as { id: string }[];
  return rows.length === 1;
}

type ResolvePlanFailureCode = "INVALID_STATE" | "PROFILE_DOCUMENT_INVALID" | "NORMALIZATION_INELIGIBLE" | "NORMALIZATION_PLAN_INVALID";

/**
 * Loads the EXACT pinned WorksheetMappingProfileVersion by id + organisation
 * + worksheet_mapping_profile_id (never today's active_profile_version_id)
 * and the exact governed SourceSchemaColumn ids for the pinned worksheet,
 * then builds the plan via the merged B2A buildNormalizationPlan. Used both
 * on new-run creation (from the raw run's own pins) and on every resume
 * (from the run's own immutable pins) -- the SAME resolution path, so a
 * profile that has since become malformed/foreign-ruled fails resume
 * exactly as it would fail a fresh create.
 */
async function resolvePlanForPinnedVersion(context: {
  organisationId: string;
  worksheetMappingProfileId: string;
  worksheetMappingProfileVersionId: string;
  sourceSchemaWorksheetId: string;
}): Promise<{ ok: true; plan: NormalizationPlan } | { ok: false; code: ResolvePlanFailureCode }> {
  const { organisationId, worksheetMappingProfileId, worksheetMappingProfileVersionId, sourceSchemaWorksheetId } = context;

  const profileVersion = await prisma.worksheetMappingProfileVersion.findFirst({
    where: { id: worksheetMappingProfileVersionId, organisation_id: organisationId, worksheet_mapping_profile_id: worksheetMappingProfileId },
    select: { profile_document: true },
  });
  if (!profileVersion) return { ok: false, code: "INVALID_STATE" };

  const columns = await prisma.sourceSchemaColumn.findMany({
    where: { organisation_id: organisationId, source_schema_worksheet_id: sourceSchemaWorksheetId },
    select: { id: true },
  });
  if (columns.length === 0) return { ok: false, code: "INVALID_STATE" };

  const planResult = buildNormalizationPlan(
    profileVersion.profile_document,
    columns.map((c) => c.id)
  );
  if (!planResult.ok) {
    const codes = new Set(planResult.findings.map((f) => f.code));
    if (codes.has("PROFILE_DOCUMENT_INVALID")) return { ok: false, code: "PROFILE_DOCUMENT_INVALID" };
    if (codes.has("NORMALIZATION_INELIGIBLE_V1")) return { ok: false, code: "NORMALIZATION_INELIGIBLE" };
    return { ok: false, code: "NORMALIZATION_PLAN_INVALID" };
  }
  return { ok: true, plan: planResult.plan };
}

export async function createOrResumeNormalizationRun(context: {
  organisationId: string;
  uploadId: string;
  actorUserId: string;
  leaseSeconds?: number;
}): Promise<CreateOrResumeNormalizationResult> {
  const { organisationId, uploadId, actorUserId } = context;
  const leaseSeconds = context.leaseSeconds ?? resolveLeaseSeconds();

  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, organisation_id: organisationId, lineage_kind: "DATA_HUB" },
    select: {
      raw_staged_at: true,
      raw_staging_run_id: true,
      raw_profile_version_id: true,
      raw_row_count: true,
      raw_cell_count: true,
      normalized_at: true,
    },
  });
  if (!upload) return { ok: false, code: "INVALID_STATE" };
  if (upload.normalized_at !== null) return { ok: true, alreadyNormalized: true };

  const existing = await prisma.dataHubNormalizationRun.findFirst({
    where: { organisation_id: organisationId, upload_id: uploadId, status: "RUNNING" },
    select: { id: true },
  });

  const newToken = randomUUID();

  // EXISTING RUN RESUME -- never resolves new-run eligibility, never
  // inspects the active profile pointer, never repins anything. Resolves
  // strictly from the run's own immutable stored pins.
  if (existing) {
    const took = await tryTakeoverExisting(existing.id, organisationId, newToken, leaseSeconds);
    if (!took) return { ok: false, code: "RUN_ALREADY_IN_PROGRESS" };

    const run = await prisma.dataHubNormalizationRun.findFirstOrThrow({
      where: { id: existing.id, organisation_id: organisationId },
    });

    if (run.normalizer_version !== NORMALIZER_VERSION) {
      return { ok: false, code: "NORMALIZER_VERSION_UNSUPPORTED" };
    }

    const rawRun = await prisma.dataHubRawStagingRun.findFirst({
      where: { id: run.raw_staging_run_id, organisation_id: organisationId },
      select: { status: true },
    });
    if (!rawRun || rawRun.status !== "SUCCEEDED") return { ok: false, code: "RAW_RUN_NOT_SUCCEEDED" };

    // PINNED_RESUME_PLAN_BEGIN (mutation-proof harness marker — do not remove or rename; scripts/tests/verify-datahub-normalization-executor.sh's mutation-proof phase replaces exactly this block to prove the pinning tests actually depend on it)
    const planResult = await resolvePlanForPinnedVersion({
      organisationId,
      worksheetMappingProfileId: run.worksheet_mapping_profile_id,
      worksheetMappingProfileVersionId: run.worksheet_mapping_profile_version_id,
      sourceSchemaWorksheetId: run.source_schema_worksheet_id,
    });
    // PINNED_RESUME_PLAN_END
    if (!planResult.ok) return { ok: false, code: planResult.code };

    return {
      ok: true,
      alreadyNormalized: false,
      run: {
        id: run.id,
        organisationId,
        importBatchId: run.import_batch_id,
        uploadId: run.upload_id,
        rawStagingRunId: run.raw_staging_run_id,
        sourceSchemaVersionId: run.source_schema_version_id,
        sourceSchemaWorksheetId: run.source_schema_worksheet_id,
        worksheetMappingProfileId: run.worksheet_mapping_profile_id,
        // Reported verbatim from the run row itself (never re-derived).
        worksheetMappingProfileVersionId: run.worksheet_mapping_profile_version_id,
        normalizerVersion: run.normalizer_version,
        executionToken: newToken,
        expectedRowCount: run.expected_row_count ?? 0,
        expectedCellCount: run.expected_cell_count ?? 0,
        persistedRowCount: run.persisted_row_count,
        persistedCellCount: run.persisted_cell_count,
        plan: planResult.plan,
      },
    };
  }

  // NEW RUN ELIGIBILITY.
  if (upload.raw_staged_at === null || upload.raw_staging_run_id === null || upload.raw_profile_version_id === null || upload.raw_row_count === null || upload.raw_cell_count === null) {
    return { ok: false, code: "RAW_STAGING_NOT_COMPLETE" };
  }

  // Load the EXACT Upload.raw_staging_run_id -- never search for another
  // successful raw run.
  const rawRun = await prisma.dataHubRawStagingRun.findFirst({
    where: { id: upload.raw_staging_run_id, organisation_id: organisationId, upload_id: uploadId },
    select: {
      status: true,
      import_batch_id: true,
      source_schema_version_id: true,
      source_schema_worksheet_id: true,
      worksheet_mapping_profile_id: true,
      worksheet_mapping_profile_version_id: true,
      persisted_row_count: true,
      persisted_cell_count: true,
    },
  });
  if (!rawRun) return { ok: false, code: "INVALID_STATE" };
  if (rawRun.status !== "SUCCEEDED") return { ok: false, code: "RAW_RUN_NOT_SUCCEEDED" };

  const planResult = await resolvePlanForPinnedVersion({
    organisationId,
    worksheetMappingProfileId: rawRun.worksheet_mapping_profile_id,
    worksheetMappingProfileVersionId: rawRun.worksheet_mapping_profile_version_id,
    sourceSchemaWorksheetId: rawRun.source_schema_worksheet_id,
  });
  if (!planResult.ok) return { ok: false, code: planResult.code };

  // Expected counts: the authoritative successful raw run's own durable
  // PERSISTED counts -- the raw run has already completed reconciliation
  // (datahub_complete_raw_staging_run requires persisted === expected
  // before allowing SUCCEEDED), so persisted_row_count/persisted_cell_count
  // are both the proven ground truth AND equal to expected_row_count/
  // expected_cell_count at this point. Never rescanned/reinvented here.
  const expectedRowCount = rawRun.persisted_row_count;
  const expectedCellCount = rawRun.persisted_cell_count;

  const attemptAgg = await prisma.dataHubNormalizationRun.aggregate({
    where: { organisation_id: organisationId, upload_id: uploadId },
    _max: { attempt_number: true },
  });
  const attemptNumber = (attemptAgg._max.attempt_number ?? 0) + 1;

  const runId = randomUUID();
  await prisma.dataHubNormalizationRun.create({
    data: {
      id: runId,
      organisation_id: organisationId,
      import_batch_id: rawRun.import_batch_id,
      upload_id: uploadId,
      raw_staging_run_id: upload.raw_staging_run_id,
      source_schema_version_id: rawRun.source_schema_version_id,
      source_schema_worksheet_id: rawRun.source_schema_worksheet_id,
      worksheet_mapping_profile_id: rawRun.worksheet_mapping_profile_id,
      worksheet_mapping_profile_version_id: rawRun.worksheet_mapping_profile_version_id,
      attempt_number: attemptNumber,
      normalizer_version: NORMALIZER_VERSION,
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
    alreadyNormalized: false,
    run: {
      id: runId,
      organisationId,
      importBatchId: rawRun.import_batch_id,
      uploadId,
      rawStagingRunId: upload.raw_staging_run_id,
      sourceSchemaVersionId: rawRun.source_schema_version_id,
      sourceSchemaWorksheetId: rawRun.source_schema_worksheet_id,
      worksheetMappingProfileId: rawRun.worksheet_mapping_profile_id,
      worksheetMappingProfileVersionId: rawRun.worksheet_mapping_profile_version_id,
      normalizerVersion: NORMALIZER_VERSION,
      executionToken: newToken,
      expectedRowCount,
      expectedCellCount,
      persistedRowCount: 0,
      persistedCellCount: 0,
      plan: planResult.plan,
    },
  };
}

// B2B2 equivalent of D4B's markRunFailed -- conditioned on the CURRENT
// lease (token + still RUNNING + not expired). Returns whether the
// transition actually applied so callers can tell "durably failed" apart
// from "lease already lost".
export async function markNormalizationRunFailed(context: { organisationId: string; runId: string; executionToken: string; failureCode: string; failureDetail?: string }): Promise<boolean> {
  const rows = (await sql`
    UPDATE data_hub_normalization_runs
    SET status = 'FAILED', failed_at = now(), failure_code = ${context.failureCode}, failure_detail = ${context.failureDetail ?? null}
    WHERE id = ${context.runId} AND organisation_id = ${context.organisationId}
      AND status = 'RUNNING' AND execution_token = ${context.executionToken}
      AND lease_expires_at > now()
    RETURNING id
  `) as unknown as { id: string }[];
  return rows.length === 1;
}

// B2B2 equivalent of D4B's releaseLeaseForYield -- sets lease_expires_at to
// now() so the very next request can immediately take over, rather than
// leaving the full lease window intact.
export async function releaseNormalizationLeaseForYield(context: { organisationId: string; runId: string; executionToken: string }): Promise<boolean> {
  const rows = (await sql`
    UPDATE data_hub_normalization_runs
    SET lease_expires_at = now()
    WHERE id = ${context.runId} AND organisation_id = ${context.organisationId}
      AND execution_token = ${context.executionToken} AND status = 'RUNNING'
    RETURNING id
  `) as unknown as { id: string }[];
  return rows.length === 1;
}
