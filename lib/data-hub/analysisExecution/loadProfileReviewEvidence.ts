import { prisma } from "../../prisma";
import { DATASET_PROFILER_VERSION, type DatasetReviewEvidence, type ValueKind, type Unit } from "../profiling/contracts";
import { VALUE_KINDS, UNITS } from "../schemaProfiles/profileDocument";
import { hasValidProfileCounts } from "../analysis/profileCounts";
import type { ScopedAnalysisSnapshot } from "../analysis/scopedProfileCounts";
import { resolveAnalysisContextInTransaction, type ResolveAnalysisContextResult } from "./resolveAnalysisContext";

export type LoadProfileReviewEvidenceResult =
  | { ok: true; profile: ScopedAnalysisSnapshot<DatasetReviewEvidence> }
  | Extract<ResolveAnalysisContextResult, { ok: false }>
  | { ok: false; code: "PROFILE_EVIDENCE_INVALID" };

function safeCount(value: bigint | null): number {
  if (typeof value !== "bigint" || value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("INVALID_COUNT");
  }
  return Number(value);
}
function valueKind(value: string): ValueKind {
  if (!(VALUE_KINDS as readonly string[]).includes(value)) throw new Error("INVALID_KIND");
  return value as ValueKind;
}
function unit(value: string | null): Unit | null {
  if (value !== null && !(UNITS as readonly string[]).includes(value)) throw new Error("INVALID_UNIT");
  return value as Unit | null;
}

// Internal, already-authorized scope. Reuses authoritative lineage resolution
// in one read snapshot. Only structural metadata is selected: no source values,
// ratios, extrema, sums, means, headers or caller-supplied profile evidence.
export async function loadProfileReviewEvidence(
  input: { organisationId: string; uploadId: string },
): Promise<LoadProfileReviewEvidenceResult> {
  if (typeof input.organisationId !== "string" || !input.organisationId.trim() ||
    typeof input.uploadId !== "string" || !input.uploadId.trim()) return { ok: false, code: "CONTEXT_INPUT_INVALID" };
  try {
    return await prisma.$transaction(async (tx): Promise<LoadProfileReviewEvidenceResult> => {
      const resolved = await resolveAnalysisContextInTransaction(input, tx);
      if (!resolved.ok) return resolved;
      const context = resolved.context;
      const run = await tx.dataHubDatasetProfileRun.findFirst({
        where: { id: context.datasetProfileRunId, organisation_id: context.organisationId,
          upload_id: context.uploadId, status: "SUCCEEDED", profiler_version: DATASET_PROFILER_VERSION },
        select: { row_count: true, column_count: true, columns: {
          where: { organisation_id: context.organisationId }, orderBy: { ordinal: "asc" },
          select: { ordinal: true, source_schema_column_id: true, value_kind: true, source_unit: true,
            normalized_unit: true, row_count: true, non_null_count: true, null_count: true, distinct_non_null_count: true },
        } },
      });
      if (!run) return { ok: false, code: "PROFILE_LINEAGE_MISMATCH" };
      let snapshot: DatasetReviewEvidence;
      try {
        snapshot = { profilerVersion: DATASET_PROFILER_VERSION,
          rowCount: safeCount(run.row_count), columnCount: safeCount(run.column_count),
          columns: run.columns.map((column, index) => {
            if (column.ordinal !== index) throw new Error("INVALID_ORDINAL");
            const rowCount = safeCount(column.row_count), nonNullCount = safeCount(column.non_null_count);
            const nullCount = safeCount(column.null_count), distinctNonNullCount = safeCount(column.distinct_non_null_count);
            if (distinctNonNullCount > nonNullCount || (nonNullCount > 0 && distinctNonNullCount === 0)) {
              throw new Error("INVALID_DISTINCT_COUNT");
            }
            return { sourceSchemaColumnId: column.source_schema_column_id, valueKind: valueKind(column.value_kind),
              sourceUnit: unit(column.source_unit), normalizedUnit: unit(column.normalized_unit),
              rowCount, nonNullCount, nullCount, distinctNonNullCount,
              isConstant: distinctNonNullCount === 1, isAllNull: rowCount > 0 && nonNullCount === 0,
              isUniqueAmongNonNull: nonNullCount > 0 && distinctNonNullCount === nonNullCount,
              isComplete: nullCount === 0, isSparse: rowCount > 0 && nonNullCount > 0 && nonNullCount < rowCount };
          }) };
        if (!hasValidProfileCounts(snapshot)) throw new Error("INVALID_COUNTS");
      } catch {
        return { ok: false, code: "PROFILE_EVIDENCE_INVALID" };
      }
      return { ok: true, profile: { context, snapshot } };
    }, { isolationLevel: "RepeatableRead" });
  } catch {
    return { ok: false, code: "CONTEXT_READ_FAILED" };
  }
}
