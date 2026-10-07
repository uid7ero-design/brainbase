import { prisma } from "../../prisma";
import { DATASET_PROFILER_VERSION } from "../profiling/contracts";
import { hasValidProfileCounts, type ProfileCountEvidence } from "../analysis/profileCounts";
import type { ScopedAnalysisSnapshot } from "../analysis/scopedProfileCounts";
import { resolveAnalysisContextInTransaction, type ResolveAnalysisContextResult } from "./resolveAnalysisContext";

export type LoadProfileCountEvidenceResult =
  | { ok: true; profile: ScopedAnalysisSnapshot<ProfileCountEvidence> }
  | Extract<ResolveAnalysisContextResult, { ok: false }>
  | { ok: false; code: "PROFILE_COUNTS_INVALID" };

function safeCount(value: bigint | null): number {
  if (value === null || value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("INVALID_COUNT");
  return Number(value);
}

// Already-authorized scope only. No source values or numeric summaries are
// selected. Context and immutable profile counts share the same snapshot.
export async function loadProfileCountEvidence(
  input: { organisationId: string; uploadId: string },
): Promise<LoadProfileCountEvidenceResult> {
  if (typeof input.organisationId !== "string" || !input.organisationId.trim() ||
    typeof input.uploadId !== "string" || !input.uploadId.trim()) {
    return { ok: false, code: "CONTEXT_INPUT_INVALID" };
  }
  try {
    return await prisma.$transaction(async (tx): Promise<LoadProfileCountEvidenceResult> => {
      const resolved = await resolveAnalysisContextInTransaction(input, tx);
      if (!resolved.ok) return resolved;
      const context = resolved.context;
      const run = await tx.dataHubDatasetProfileRun.findFirst({
        where: { id: context.datasetProfileRunId, organisation_id: context.organisationId,
          upload_id: context.uploadId, status: "SUCCEEDED", profiler_version: DATASET_PROFILER_VERSION },
        select: { row_count: true, column_count: true, columns: {
          where: { organisation_id: context.organisationId }, orderBy: { ordinal: "asc" },
          select: { source_schema_column_id: true, row_count: true, non_null_count: true, null_count: true },
        } },
      });
      if (!run) return { ok: false, code: "PROFILE_LINEAGE_MISMATCH" };
      let snapshot: ProfileCountEvidence;
      try {
        snapshot = { profilerVersion: DATASET_PROFILER_VERSION,
          rowCount: safeCount(run.row_count), columnCount: safeCount(run.column_count),
          columns: run.columns.map((column) => ({ sourceSchemaColumnId: column.source_schema_column_id,
            rowCount: safeCount(column.row_count), nonNullCount: safeCount(column.non_null_count), nullCount: safeCount(column.null_count) })) };
      } catch {
        return { ok: false, code: "PROFILE_COUNTS_INVALID" };
      }
      if (!hasValidProfileCounts(snapshot)) return { ok: false, code: "PROFILE_COUNTS_INVALID" };
      return { ok: true, profile: { context, snapshot } };
    }, { isolationLevel: "RepeatableRead" });
  } catch {
    return { ok: false, code: "CONTEXT_READ_FAILED" };
  }
}
