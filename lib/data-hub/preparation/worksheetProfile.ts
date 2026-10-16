import { prisma } from "@/lib/prisma";
import { resolveAnalysisContextInTransaction } from "../analysisExecution/resolveAnalysisContext";
import { DATASET_PROFILER_VERSION } from "../profiling/contracts";
import { profileUploadDataset } from "../profileExecution/profileUploadDataset";

// The existing profiler reconstructs its normalized evidence in memory.
// Bound its new interactive HTTP entry point before invoking that service.
export const MAX_INTERACTIVE_PROFILE_CELLS = 100_000;
type Scope = { organisationId: string; uploadId: string };
const count = (value: bigint | number | null): number | null => {
  if (value === null) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
};

export async function getWorksheetProfileStatus(scope: Scope) {
  return prisma.$transaction(async tx => {
    const upload = await tx.upload.findFirst({
      where: { id: scope.uploadId, organisation_id: scope.organisationId, lineage_kind: "DATA_HUB" },
      select: { normalization_run_id: true, dataset_profile_run_id: true },
    });
    if (!upload) return { ok: false as const, code: "UPLOAD_NOT_FOUND" };
    if (!upload.normalization_run_id) return { ok: true as const, status: "NOT_READY" };
    if (upload.dataset_profile_run_id) {
      const resolved = await resolveAnalysisContextInTransaction(scope, tx);
      if (!resolved.ok) return resolved;
      const profile = await tx.dataHubDatasetProfileRun.findFirst({
        where: { id: resolved.context.datasetProfileRunId, organisation_id: scope.organisationId, upload_id: scope.uploadId },
        select: { row_count: true, column_count: true },
      });
      const rowCount = profile ? count(profile.row_count) : null;
      const columnCount = profile ? count(profile.column_count) : null;
      if (rowCount === null || columnCount === null) return { ok: false as const, code: "PROFILE_LINEAGE_MISMATCH" };
      return { ok: true as const, status: "SUCCEEDED", rowCount, columnCount };
    }
    const latest = await tx.dataHubDatasetProfileRun.findFirst({
      where: { organisation_id: scope.organisationId, upload_id: scope.uploadId, normalization_run_id: upload.normalization_run_id },
      orderBy: { attempt_number: "desc" }, select: { status: true },
    });
    if (!latest) return { ok: true as const, status: "NOT_STARTED" };
    if (!["RUNNING", "FAILED", "ABANDONED"].includes(latest.status)) {
      return { ok: false as const, code: "PROFILE_LINEAGE_MISMATCH" };
    }
    return { ok: true as const, status: latest.status };
  }, { isolationLevel: "RepeatableRead" });
}

export async function profileWorksheetForReview(scope: Scope & { actorId: string }) {
  const upload = await prisma.upload.findFirst({
    where: { id: scope.uploadId, organisation_id: scope.organisationId, lineage_kind: "DATA_HUB" },
    select: { normalized_cell_count: true, dataset_profile_run_id: true },
  });
  if (!upload) return { ok: false as const, code: "UPLOAD_NOT_FOUND" };
  if (!upload.dataset_profile_run_id && upload.normalized_cell_count !== null &&
      upload.normalized_cell_count > MAX_INTERACTIVE_PROFILE_CELLS) {
    return { ok: false as const, code: "INTERACTIVE_PROFILE_LIMIT" };
  }
  const result = await profileUploadDataset(scope);
  if (!result.ok) return result;
  if (result.profilerVersion !== DATASET_PROFILER_VERSION) return { ok: false as const, code: "PROFILER_VERSION_UNSUPPORTED" };
  if (result.status === "RUNNING") return { ok: true as const, status: "RUNNING" };
  const rowCount = count(result.rowCount), columnCount = count(result.columnCount);
  if (rowCount === null || columnCount === null) return { ok: false as const, code: "PROFILE_LINEAGE_MISMATCH" };
  // Confirm the authoritative completed pointer before enabling review.
  return getWorksheetProfileStatus(scope);
}
