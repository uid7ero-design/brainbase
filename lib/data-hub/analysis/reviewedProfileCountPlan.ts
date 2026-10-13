import type { SemanticDatasetSchemaDraft } from "../semanticInference/schemaSynthesis";
import type { DataQualityReviewResolution } from "../dataQuality/reviewResolution";
import { buildAnalysisReadiness } from "./buildAnalysisReadiness";
import type { AnalysisReadinessErrorCode } from "./contracts";
import { buildScopedProfileCountPlan, type BuildScopedProfileCountPlanResult } from "./scopedProfileCountPlan";
import { admitReviewPlanningScope } from "./reviewPlanningScope";
import { type AnalysisDatasetContext,
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
  const checked = admitReviewPlanningScope(expected, review);
  if (!checked.ok) return checked;
  const built = buildAnalysisReadiness(review.schema.snapshot, review.quality.snapshot);
  if (!built.ok) return built;
  const planned = buildScopedProfileCountPlan(checked.context,
    { context: checked.context, snapshot: built.readiness }, input);
  return planned.ok ? { ...planned, reviewRevision: checked.reviewRevision } : planned;
}
