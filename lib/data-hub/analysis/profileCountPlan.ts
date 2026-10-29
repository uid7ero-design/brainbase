import { buildAnalysisPlan, type BuildAnalysisPlanResult,
  type RowCountAnalysisPlan, type CountPresentAnalysisPlan } from "./plan";
import { ANALYSIS_READINESS_VERSION, type AnalysisReadiness } from "./contracts";
import { DATASET_PROFILER_VERSION } from "../profiling/contracts";
import { SEMANTIC_SCHEMA_VERSION } from "../semanticInference/schemaSynthesis";
import { DATA_QUALITY_REVIEW_RESOLUTION_VERSION } from "../dataQuality/reviewResolution";

export type ProfileCountAnalysisPlan = RowCountAnalysisPlan | CountPresentAnalysisPlan;
export type BuildProfileCountPlanResult =
  | { ok: true; plan: ProfileCountAnalysisPlan }
  | Extract<BuildAnalysisPlanResult, { ok: false }>
  | { ok: false; code: "PROFILE_OPERATION_NOT_SUPPORTED" | "PROFILE_PLAN_VERSION_UNSUPPORTED" };

// Planning only: semantic capabilities can describe more than profile
// statistics can answer. This contract grants no access or execution authority.
export function buildProfileCountPlan(readiness: AnalysisReadiness, input: unknown): BuildProfileCountPlanResult {
  const planned = buildAnalysisPlan(readiness, input);
  if (!planned.ok) return planned;
  if (planned.plan.operation === "GROUPED_ROW_COUNT") {
    return { ok: false, code: "PROFILE_OPERATION_NOT_SUPPORTED" };
  }
  if (readiness.readinessVersion !== ANALYSIS_READINESS_VERSION ||
      readiness.schemaVersion !== SEMANTIC_SCHEMA_VERSION ||
      readiness.profilerVersion !== DATASET_PROFILER_VERSION ||
      readiness.qualityResolutionVersion !== DATA_QUALITY_REVIEW_RESOLUTION_VERSION) {
    return { ok: false, code: "PROFILE_PLAN_VERSION_UNSUPPORTED" };
  }
  return { ok: true, plan: planned.plan };
}
