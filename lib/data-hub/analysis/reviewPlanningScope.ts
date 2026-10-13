import type { ReviewedPlanningSnapshot } from "./reviewedProfileCountPlan";
import { copyAnalysisDatasetContext, validateAnalysisDatasetContexts, type AnalysisDatasetContext } from "./scopedProfileCounts";

// Internal shared admission only. Never read review snapshots or grant access.
export function admitReviewPlanningScope(expected: AnalysisDatasetContext, review: ReviewedPlanningSnapshot):
  | { ok: true; context: AnalysisDatasetContext; reviewRevision: number }
  | { ok: false; code: "DATASET_CONTEXT_INVALID" | "DATASET_CONTEXT_MISMATCH" }
  | { ok: false; code: "REVIEW_REVISION_INVALID" } {
  const checked = validateAnalysisDatasetContexts(expected, [review.schema.context, review.quality.context]);
  if (!checked.ok) return checked;
  const context = copyAnalysisDatasetContext(expected);
  const reviewRevision = review.revision;
  if (!Number.isSafeInteger(reviewRevision) || reviewRevision < 1) {
    return { ok: false, code: "REVIEW_REVISION_INVALID" };
  }
  return { ok: true, context, reviewRevision };
}
