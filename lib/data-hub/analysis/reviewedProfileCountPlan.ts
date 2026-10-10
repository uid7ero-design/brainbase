import type { SemanticDatasetSchemaDraft } from "../semanticInference/schemaSynthesis";
import type { DataQualityReviewResolution } from "../dataQuality/reviewResolution";
import { buildAnalysisReadiness } from "./buildAnalysisReadiness";
import type { AnalysisReadinessErrorCode } from "./contracts";
import { buildScopedProfileCountPlan, type BuildScopedProfileCountPlanResult } from "./scopedProfileCountPlan";
import { validateAnalysisDatasetContexts, type AnalysisDatasetContext,
  type ScopedAnalysisSnapshot } from "./scopedProfileCounts";

export interface ReviewedPlanningSnapshot {
  revision: number;
  schema: ScopedAnalysisSnapshot<SemanticDatasetSchemaDraft>;
  quality: ScopedAnalysisSnapshot<DataQualityReviewResolution>;
}
export type BuildReviewedProfileCountPlanResult =
  | (Extract<BuildScopedProfileCountPlanResult, { ok: true }> & { reviewRevision: number })
  | Extract<BuildScopedProfileCountPlanResult, { ok: false }>
  | { ok: false; code: AnalysisReadinessErrorCode | "REVIEW_REVISION_INVALID" };

// Internal pure composition over trusted loaded review metadata. No caller
// readiness, statistics, execution grant or persistence/freshness proof.
export function buildReviewedProfileCountPlan(
  expected: AnalysisDatasetContext, review: ReviewedPlanningSnapshot, input: unknown,
): BuildReviewedProfileCountPlanResult {
  const checked = validateAnalysisDatasetContexts(expected, [review.schema.context, review.quality.context]);
  if (!checked.ok) return checked;
  if (!Number.isSafeInteger(review.revision) || review.revision < 1) {
    return { ok: false, code: "REVIEW_REVISION_INVALID" };
  }
  const built = buildAnalysisReadiness(review.schema.snapshot, review.quality.snapshot);
  if (!built.ok) return built;
  const planned = buildScopedProfileCountPlan(expected,
    { context: review.schema.context, snapshot: built.readiness }, input);
  return planned.ok ? { ...planned, reviewRevision: review.revision } : planned;
}
