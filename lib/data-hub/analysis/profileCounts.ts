import type { DatasetProfile } from "../profiling/contracts";
import type { AnalysisReadiness } from "./contracts";
import { buildAnalysisPlan, type BuildAnalysisPlanResult,
  type RowCountAnalysisPlan, type CountPresentAnalysisPlan } from "./plan";

export const PROFILE_COUNT_RESULT_VERSION = "v1" as const;

export interface ProfileCountResult {
  resultVersion: typeof PROFILE_COUNT_RESULT_VERSION;
  plan: RowCountAnalysisPlan | CountPresentAnalysisPlan;
  count: number;
}

export type EvaluateProfileCountResult =
  | { ok: true; result: ProfileCountResult }
  | Extract<BuildAnalysisPlanResult, { ok: false }>
  | { ok: false; code: "PROFILE_LINEAGE_MISMATCH" | "PROFILE_COUNTS_INVALID" | "PROFILE_OPERATION_NOT_SUPPORTED" };

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

// Pure projection of already-computed profile statistics. Callers must supply
// matching snapshots: version and column checks do not establish dataset
// identity, freshness, or access authorization.
export function evaluateProfileCount(
  readiness: AnalysisReadiness,
  input: unknown,
  profile: DatasetProfile,
): EvaluateProfileCountResult {
  const planned = buildAnalysisPlan(readiness, input);
  if (!planned.ok) return planned;
  if (planned.plan.operation === "GROUPED_ROW_COUNT") {
    return { ok: false, code: "PROFILE_OPERATION_NOT_SUPPORTED" };
  }
  const ids = Object.values(readiness.catalog).flat();
  const expected = new Set(ids);
  const actual = new Set(profile.columns.map((column) => column.sourceSchemaColumnId));
  if (
    profile.profilerVersion !== readiness.profilerVersion ||
    ids.length !== readiness.fieldCount || expected.size !== ids.length ||
    profile.columnCount !== profile.columns.length || actual.size !== profile.columns.length ||
    actual.size !== expected.size || [...actual].some((id) => !expected.has(id))
  ) {
    return { ok: false, code: "PROFILE_LINEAGE_MISMATCH" };
  }
  if (!validCount(profile.rowCount) || profile.columns.some((column) =>
    column.rowCount !== profile.rowCount ||
    !validCount(column.nonNullCount) || !validCount(column.nullCount) ||
    column.nonNullCount > profile.rowCount ||
    column.nullCount !== profile.rowCount - column.nonNullCount
  )) {
    return { ok: false, code: "PROFILE_COUNTS_INVALID" };
  }
  const plan = planned.plan;
  const count = plan.operation === "ROW_COUNT" ? profile.rowCount :
    profile.columns.find((column) => column.sourceSchemaColumnId === plan.sourceSchemaColumnId)!.nonNullCount;
  return { ok: true, result: { resultVersion: PROFILE_COUNT_RESULT_VERSION, plan, count } };
}
