import { buildAnalysisCapabilities } from "./capabilities";
import type { AnalysisReadiness } from "./contracts";
import { validateAnalysisRequest, type AnalysisRequestErrorCode } from "./requestValidation";

export const ANALYSIS_PLAN_VERSION = "v1" as const;

// A description only, scoped to the supplied readiness snapshot. This is
// neither dataset identity nor durable authorization to execute a query.
interface AnalysisPlanLineage {
  planVersion: typeof ANALYSIS_PLAN_VERSION;
  readinessVersion: AnalysisReadiness["readinessVersion"];
  schemaVersion: AnalysisReadiness["schemaVersion"];
  profilerVersion: AnalysisReadiness["profilerVersion"];
  qualityResolutionVersion: AnalysisReadiness["qualityResolutionVersion"];
  readinessState: "READY" | "READY_WITH_ACKNOWLEDGED_NOTICES";
}

export interface RowCountAnalysisPlan extends AnalysisPlanLineage {
  operation: "ROW_COUNT";
}

export interface GroupedRowCountAnalysisPlan extends AnalysisPlanLineage {
  operation: "GROUPED_ROW_COUNT";
  sourceSchemaColumnId: string;
  // Missing values remain visible rather than silently losing rows. A future
  // executor must map its normalized missing representation to this group.
  missingValuePolicy: "SEPARATE_GROUP";
}

export interface CountPresentAnalysisPlan extends AnalysisPlanLineage {
  operation: "COUNT_PRESENT";
  sourceSchemaColumnId: string;
  // A future executor counts normalized present values, including zero.
  missingValuePolicy: "EXCLUDE_MISSING";
}

export type AnalysisPlan = RowCountAnalysisPlan | GroupedRowCountAnalysisPlan | CountPresentAnalysisPlan;

export type BuildAnalysisPlanResult =
  | { ok: true; plan: AnalysisPlan }
  | { ok: false; code: AnalysisRequestErrorCode | "PLAN_KIND_NOT_SUPPORTED" };

export function buildAnalysisPlan(
  readiness: AnalysisReadiness,
  input: unknown,
): BuildAnalysisPlanResult {
  const result = validateAnalysisRequest(buildAnalysisCapabilities(readiness), input);
  if (!result.ok) return result;
  if (result.request.kind === "AGGREGATE" && result.request.operator !== "COUNT_PRESENT") {
    return { ok: false, code: "PLAN_KIND_NOT_SUPPORTED" };
  }
  // Explicit allowlist also rejects an invalid runtime readiness state.
  if (readiness.state !== "READY" && readiness.state !== "READY_WITH_ACKNOWLEDGED_NOTICES") {
    return { ok: false, code: "UNSUPPORTED_CAPABILITY_VERSION" };
  }
  const lineage: AnalysisPlanLineage = {
    planVersion: ANALYSIS_PLAN_VERSION,
    readinessVersion: readiness.readinessVersion,
    schemaVersion: readiness.schemaVersion,
    profilerVersion: readiness.profilerVersion,
    qualityResolutionVersion: readiness.qualityResolutionVersion,
    readinessState: readiness.state,
  };
  if (result.request.kind === "AGGREGATE") {
    return {
      ok: true,
      plan: {
        ...lineage, operation: "COUNT_PRESENT",
        sourceSchemaColumnId: result.request.sourceSchemaColumnId,
        missingValuePolicy: "EXCLUDE_MISSING",
      },
    };
  }
  if (result.request.kind === "GROUP_BY") {
    return {
      ok: true,
      plan: {
        ...lineage,
        operation: "GROUPED_ROW_COUNT",
        sourceSchemaColumnId: result.request.sourceSchemaColumnId,
        missingValuePolicy: "SEPARATE_GROUP",
      },
    };
  }
  return {
    ok: true,
    plan: { ...lineage, operation: "ROW_COUNT" },
  };
}
