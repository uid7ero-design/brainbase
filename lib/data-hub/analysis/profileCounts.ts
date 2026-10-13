import type { DatasetProfile } from "../profiling/contracts";
import type { AnalysisReadiness } from "./contracts";
import { buildProfileCountPlan, type BuildProfileCountPlanResult,
  type ProfileCountAnalysisPlan } from "./profileCountPlan";

export const PROFILE_COUNT_RESULT_VERSION = "v1" as const;

export interface ProfileCountEvidence {
  profilerVersion: DatasetProfile["profilerVersion"];
  rowCount: number;
  columnCount: number;
  columns: Pick<DatasetProfile["columns"][number], "sourceSchemaColumnId" | "rowCount" | "nonNullCount" | "nullCount">[];
}

export interface ProfileCountResult {
  resultVersion: typeof PROFILE_COUNT_RESULT_VERSION;
  plan: ProfileCountAnalysisPlan;
  count: number;
}

export type EvaluateProfileCountResult =
  | { ok: true; result: ProfileCountResult }
  | Extract<BuildProfileCountPlanResult, { ok: false }>
  | { ok: false; code: "PROFILE_LINEAGE_MISMATCH" | "PROFILE_COUNTS_INVALID" };

function validCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function hasValidProfileCounts(profile: ProfileCountEvidence): boolean {
  return validCount(profile.rowCount) && profile.columnCount === profile.columns.length &&
    new Set(profile.columns.map((column) => column.sourceSchemaColumnId)).size === profile.columns.length &&
    profile.columns.every((column) => column.sourceSchemaColumnId.trim().length > 0 &&
      column.rowCount === profile.rowCount && validCount(column.nonNullCount) && validCount(column.nullCount) &&
      column.nonNullCount <= profile.rowCount && column.nullCount === profile.rowCount - column.nonNullCount);
}

// Pure projection of already-computed profile statistics. Callers must supply
// matching snapshots: version and column checks do not establish dataset
// identity, freshness, or access authorization.
export function evaluateProfileCount(
  readiness: AnalysisReadiness,
  input: unknown,
  profile: ProfileCountEvidence,
): EvaluateProfileCountResult {
  const planned = buildProfileCountPlan(readiness, input);
  if (!planned.ok) return planned;
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
  if (!hasValidProfileCounts(profile)) {
    return { ok: false, code: "PROFILE_COUNTS_INVALID" };
  }
  const plan = planned.plan;
  const count = plan.operation === "ROW_COUNT" ? profile.rowCount :
    profile.columns.find((column) => column.sourceSchemaColumnId === plan.sourceSchemaColumnId)!.nonNullCount;
  return { ok: true, result: { resultVersion: PROFILE_COUNT_RESULT_VERSION, plan, count } };
}
