import type { DatasetProfile } from "../profiling/contracts";
import type { SemanticDatasetSchemaDraft } from "../semanticInference/schemaSynthesis";
import type { DataQualityReviewResolution } from "../dataQuality/reviewResolution";
import { buildAnalysisReadiness } from "./buildAnalysisReadiness";
import type { AnalysisReadinessErrorCode } from "./contracts";
import { evaluateScopedProfileCount, validateAnalysisDatasetContexts,
  type AnalysisDatasetContext, type ScopedAnalysisSnapshot,
  type EvaluateScopedProfileCountResult } from "./scopedProfileCounts";

export type AnalyzeProfileCountResult = EvaluateScopedProfileCountResult |
  { ok: false; code: AnalysisReadinessErrorCode | "QUALITY_STATE_INVALID" };

// One pure path from scoped semantic and reviewed-quality snapshots to a count.
// Callers must resolve authoritative context and access before invoking this.
export function analyzeProfileCount(
  expected: AnalysisDatasetContext,
  schema: ScopedAnalysisSnapshot<SemanticDatasetSchemaDraft>,
  quality: ScopedAnalysisSnapshot<DataQualityReviewResolution>,
  profile: ScopedAnalysisSnapshot<DatasetProfile>,
  input: unknown,
): AnalyzeProfileCountResult {
  const context = validateAnalysisDatasetContexts(expected, [schema.context, quality.context, profile.context]);
  if (!context.ok) return context;
  if (quality.snapshot.state !== "READY" &&
    quality.snapshot.state !== "READY_WITH_ACKNOWLEDGED_NOTICES" &&
    quality.snapshot.state !== "HOLD_FOR_REMEDIATION") {
    return { ok: false, code: "QUALITY_STATE_INVALID" };
  }
  const built = buildAnalysisReadiness(schema.snapshot, quality.snapshot);
  if (!built.ok) return built;
  return evaluateScopedProfileCount(expected,
    { context: schema.context, snapshot: built.readiness }, input, profile);
}
