import { buildAnalysisCapabilities } from "./capabilities";
import type { AnalysisReadiness } from "./contracts";
import { validateAnalysisRequest, type AnalysisRequestErrorCode } from "./requestValidation";

export const ANALYSIS_PLAN_VERSION = "v1" as const;

// A description only, scoped to the supplied readiness snapshot. This is
// neither dataset identity nor durable authorization to execute a query.
export interface RowCountAnalysisPlan {
  planVersion: typeof ANALYSIS_PLAN_VERSION;
  readinessVersion: AnalysisReadiness["readinessVersion"];
  schemaVersion: AnalysisReadiness["schemaVersion"];
  profilerVersion: AnalysisReadiness["profilerVersion"];
  qualityResolutionVersion: AnalysisReadiness["qualityResolutionVersion"];
  readinessState: "READY" | "READY_WITH_ACKNOWLEDGED_NOTICES";
  operation: "ROW_COUNT";
}

export type BuildAnalysisPlanResult =
  | { ok: true; plan: RowCountAnalysisPlan }
  | { ok: false; code: AnalysisRequestErrorCode | "PLAN_KIND_NOT_SUPPORTED" };

export function buildAnalysisPlan(
  readiness: AnalysisReadiness,
  input: unknown,
): BuildAnalysisPlanResult {
  const result = validateAnalysisRequest(buildAnalysisCapabilities(readiness), input);
  if (!result.ok) return result;
  if (result.request.kind !== "ROW_COUNT") {
    return { ok: false, code: "PLAN_KIND_NOT_SUPPORTED" };
  }
  // Explicit allowlist also rejects an invalid runtime readiness state.
  if (readiness.state !== "READY" && readiness.state !== "READY_WITH_ACKNOWLEDGED_NOTICES") {
    return { ok: false, code: "UNSUPPORTED_CAPABILITY_VERSION" };
  }
  return {
    ok: true,
    plan: {
      planVersion: ANALYSIS_PLAN_VERSION,
      readinessVersion: readiness.readinessVersion,
      schemaVersion: readiness.schemaVersion,
      profilerVersion: readiness.profilerVersion,
      qualityResolutionVersion: readiness.qualityResolutionVersion,
      readinessState: readiness.state,
      operation: "ROW_COUNT",
    },
  };
}
