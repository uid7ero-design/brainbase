import { ANALYSIS_READINESS_VERSION } from "./contracts";
import { ANALYSIS_PLAN_VERSION } from "./plan";
import { PROFILE_COUNT_RESULT_VERSION, type ProfileCountResult } from "./profileCounts";
import type { AnalysisDatasetContext } from "./scopedProfileCounts";
import { DATASET_PROFILER_VERSION } from "../profiling/contracts";
import { SEMANTIC_SCHEMA_VERSION } from "../semanticInference/schemaSynthesis";
import { DATA_QUALITY_REVIEW_RESOLUTION_VERSION } from "../dataQuality/reviewResolution";

export type CountResponseExpectation = { uploadId: string } & (
  | { operation: "ROW_COUNT" }
  | { operation: "COUNT_PRESENT"; sourceSchemaColumnId: string }
);
export interface ReviewedCountResponse {
  ok: true;
  reviewRevision: number;
  result: ProfileCountResult & { context: AnalysisDatasetContext };
}
export type ParseReviewedCountResponseResult =
  | { ok: true; response: ReviewedCountResponse }
  | { ok: false; code: "COUNT_RESPONSE_INVALID" | "COUNT_RESPONSE_MISMATCH" };

const contextKeys = ["organisationId", "uploadId", "importBatchId", "normalizationRunId",
  "datasetProfileRunId", "sourceSchemaVersionId", "sourceSchemaWorksheetId", "worksheetMappingProfileVersionId"] as const;
const planKeys = ["planVersion", "readinessVersion", "schemaVersion", "profilerVersion", "qualityResolutionVersion", "readinessState", "operation"];
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
const identity = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// Pure wire-contract validation, not authorization or proof of freshness.
// A legitimate count may use a newer profile/review than the loaded screen;
// preserve that returned lineage rather than relabeling it with local state.
export function parseReviewedCountResponse(input: unknown, expected: CountResponseExpectation): ParseReviewedCountResponseResult {
  const invalid = { ok: false, code: "COUNT_RESPONSE_INVALID" } as const;
  if (!identity(expected.uploadId) || (expected.operation !== "ROW_COUNT" && expected.operation !== "COUNT_PRESENT") ||
      (expected.operation === "COUNT_PRESENT" && !identity(expected.sourceSchemaColumnId))) return invalid;
  if (!object(input) || !keys(input, ["ok", "reviewRevision", "result"]) || input.ok !== true ||
      !count(input.reviewRevision) || input.reviewRevision === 0 || !object(input.result)) return invalid;
  const result = input.result;
  if (!keys(result, ["resultVersion", "plan", "count", "context"]) ||
      result.resultVersion !== PROFILE_COUNT_RESULT_VERSION || !count(result.count) || !object(result.plan) || !object(result.context)) return invalid;
  const plan = result.plan, context = result.context;
  if (!keys(context, contextKeys) || !contextKeys.every(key => identity(context[key])) ||
      plan.planVersion !== ANALYSIS_PLAN_VERSION || plan.readinessVersion !== ANALYSIS_READINESS_VERSION ||
      plan.schemaVersion !== SEMANTIC_SCHEMA_VERSION || plan.profilerVersion !== DATASET_PROFILER_VERSION ||
      plan.qualityResolutionVersion !== DATA_QUALITY_REVIEW_RESOLUTION_VERSION ||
      (plan.readinessState !== "READY" && plan.readinessState !== "READY_WITH_ACKNOWLEDGED_NOTICES")) return invalid;
  if (plan.operation === "ROW_COUNT") {
    if (!keys(plan, planKeys)) return invalid;
  } else if (plan.operation === "COUNT_PRESENT") {
    if (!keys(plan, [...planKeys, "sourceSchemaColumnId", "missingValuePolicy"]) ||
        !identity(plan.sourceSchemaColumnId) || plan.missingValuePolicy !== "EXCLUDE_MISSING") return invalid;
  } else return invalid;
  if (context.uploadId !== expected.uploadId || plan.operation !== expected.operation ||
      (expected.operation === "COUNT_PRESENT" && plan.sourceSchemaColumnId !== expected.sourceSchemaColumnId)) {
    return { ok: false, code: "COUNT_RESPONSE_MISMATCH" };
  }
  // Both nested records contain only validated primitives; return owned copies.
  return { ok: true, response: { ok: true, reviewRevision: input.reviewRevision,
    result: { resultVersion: PROFILE_COUNT_RESULT_VERSION, count: result.count,
      plan: { ...plan } as unknown as ProfileCountResult["plan"],
      context: { ...context } as unknown as AnalysisDatasetContext } } };
}
