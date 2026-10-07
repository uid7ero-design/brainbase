import { prisma } from "../../prisma";
import type { Prisma } from "@prisma/client";
import { DATASET_PROFILER_VERSION } from "../profiling/contracts";
import { validateAnalysisDatasetContexts, type AnalysisDatasetContext } from "../analysis/scopedProfileCounts";

export type ResolveAnalysisContextResult =
  | { ok: true; context: AnalysisDatasetContext }
  | { ok: false; code: "CONTEXT_INPUT_INVALID" | "UPLOAD_NOT_FOUND" | "PROFILE_NOT_COMPLETE" |
      "PROFILE_LINEAGE_MISMATCH" | "PROFILER_VERSION_UNSUPPORTED" | "CONTEXT_READ_FAILED" };

// Accepts already-authorized organization/upload scope from a trusted caller.
// Resolves pointers at read time; it does not authorize future execution or
// promise that upload pointers remain current after the snapshot ends.
export async function resolveAnalysisContext(
  input: { organisationId: string; uploadId: string },
): Promise<ResolveAnalysisContextResult> {
  if (typeof input.organisationId !== "string" || !input.organisationId.trim() ||
    typeof input.uploadId !== "string" || !input.uploadId.trim()) {
    return { ok: false, code: "CONTEXT_INPUT_INVALID" };
  }
  try {
    return await prisma.$transaction((tx) => resolveAnalysisContextInTransaction(input, tx),
      { isolationLevel: "RepeatableRead" });
  } catch {
    return { ok: false, code: "CONTEXT_READ_FAILED" };
  }
}

// Internal composition entry point: caller owns the consistent transaction.
export async function resolveAnalysisContextInTransaction(
  input: { organisationId: string; uploadId: string },
  tx: Prisma.TransactionClient,
): Promise<ResolveAnalysisContextResult> {
      const upload = await tx.upload.findFirst({
        where: { id: input.uploadId, organisation_id: input.organisationId, lineage_kind: "DATA_HUB" },
        select: { id: true, organisation_id: true, import_batch_id: true,
          normalization_run_id: true, dataset_profile_run_id: true },
      });
      if (!upload) return { ok: false, code: "UPLOAD_NOT_FOUND" };
      if (!upload.dataset_profile_run_id || !upload.normalization_run_id) {
        return { ok: false, code: "PROFILE_NOT_COMPLETE" };
      }
      const run = await tx.dataHubDatasetProfileRun.findFirst({
        where: { id: upload.dataset_profile_run_id, organisation_id: input.organisationId, upload_id: input.uploadId },
        select: { id: true, organisation_id: true, upload_id: true, import_batch_id: true,
          normalization_run_id: true, source_schema_version_id: true,
          source_schema_worksheet_id: true, worksheet_mapping_profile_version_id: true,
          status: true, profiler_version: true,
          normalization_run: { select: { id: true, organisation_id: true, upload_id: true,
            import_batch_id: true, source_schema_version_id: true, source_schema_worksheet_id: true,
            worksheet_mapping_profile_version_id: true, status: true } } },
      });
      if (!run) return { ok: false, code: "PROFILE_LINEAGE_MISMATCH" };
      if (run.status !== "SUCCEEDED" || run.normalization_run.status !== "SUCCEEDED") {
        return { ok: false, code: "PROFILE_NOT_COMPLETE" };
      }
      if (run.profiler_version !== DATASET_PROFILER_VERSION) {
        return { ok: false, code: "PROFILER_VERSION_UNSUPPORTED" };
      }
      const context: AnalysisDatasetContext = {
        organisationId: run.organisation_id, uploadId: run.upload_id,
        importBatchId: run.import_batch_id, normalizationRunId: run.normalization_run_id,
        datasetProfileRunId: run.id, sourceSchemaVersionId: run.source_schema_version_id,
        sourceSchemaWorksheetId: run.source_schema_worksheet_id,
        worksheetMappingProfileVersionId: run.worksheet_mapping_profile_version_id,
      };
      const normalized = run.normalization_run;
      const normalizationContext: AnalysisDatasetContext = {
        organisationId: normalized.organisation_id, uploadId: normalized.upload_id,
        importBatchId: normalized.import_batch_id, normalizationRunId: normalized.id,
        datasetProfileRunId: run.id, sourceSchemaVersionId: normalized.source_schema_version_id,
        sourceSchemaWorksheetId: normalized.source_schema_worksheet_id,
        worksheetMappingProfileVersionId: normalized.worksheet_mapping_profile_version_id,
      };
      if (upload.id !== input.uploadId || upload.organisation_id !== input.organisationId ||
        context.uploadId !== upload.id || context.organisationId !== upload.organisation_id ||
        context.importBatchId !== upload.import_batch_id ||
        context.normalizationRunId !== upload.normalization_run_id ||
        context.datasetProfileRunId !== upload.dataset_profile_run_id ||
        !validateAnalysisDatasetContexts(context, [normalizationContext]).ok) {
        return { ok: false, code: "PROFILE_LINEAGE_MISMATCH" };
      }
      return { ok: true, context };
}
