import { type BuildReviewedProfileCountPlanResult,
  type ReviewedPlanningSnapshot } from "./reviewedProfileCountPlan";
import { buildAnalysisReadiness } from "./buildAnalysisReadiness";
import { buildScopedProfileCountPlan } from "./scopedProfileCountPlan";
import { validateAnalysisDatasetContexts, type AnalysisDatasetContext } from "./scopedProfileCounts";
import { PROFILE_COUNT_BUNDLE_VERSION, validateProfileCountBundleInput } from "./profileCountBundleInput";
export { PROFILE_COUNT_BUNDLE_VERSION, MAX_PROFILE_COUNT_BUNDLE_REQUESTS } from "./profileCountBundleInput";

type AcceptedPlan = Extract<BuildReviewedProfileCountPlanResult, { ok: true }>;
type PlanningFailure = Extract<BuildReviewedProfileCountPlanResult, { ok: false }>;
export type BuildReviewedProfileCountBundleResult =
  | { ok: true; bundleVersion: typeof PROFILE_COUNT_BUNDLE_VERSION;
      reviewRevision: number; plans: AcceptedPlan["plan"][] }
  | PlanningFailure
  | (PlanningFailure & { requestIndex: number })
  | { ok: false; code: "PROFILE_BUNDLE_INVALID" | "REVIEW_REVISION_MISMATCH" };

// Internal, bounded, all-or-nothing intent composition. Revision equality only
// compares supplied metadata; it does not prove persisted freshness or access.
export function buildReviewedProfileCountBundle(
  expected: AnalysisDatasetContext, review: ReviewedPlanningSnapshot, input: unknown,
): BuildReviewedProfileCountBundleResult {
  const checked = validateAnalysisDatasetContexts(expected, [review.schema.context, review.quality.context]);
  if (!checked.ok) return checked;
  const reviewRevision = review.revision;
  if (!Number.isSafeInteger(reviewRevision) || reviewRevision < 1) {
    return { ok: false, code: "REVIEW_REVISION_INVALID" };
  }
  const admitted = validateProfileCountBundleInput(input);
  if (!admitted.ok) return admitted;
  const bundle = admitted.bundle;
  if (bundle.expectedReviewRevision !== reviewRevision) {
    return { ok: false, code: "REVIEW_REVISION_MISMATCH" };
  }
  // Derive owned readiness once, so every intent uses the same admitted
  // review metadata. Neither revision nor review snapshots are reread later.
  const built = buildAnalysisReadiness(review.schema.snapshot, review.quality.snapshot);
  if (!built.ok) return { ...built, requestIndex: 0 };
  const readiness = { context: expected, snapshot: built.readiness };
  const plans: AcceptedPlan["plan"][] = [];
  for (let requestIndex = 0; requestIndex < bundle.requests.length; requestIndex++) {
    const planned = buildScopedProfileCountPlan(expected, readiness, bundle.requests[requestIndex]);
    if (!planned.ok) return { ...planned, requestIndex };
    plans.push(planned.plan);
  }
  return { ok: true, bundleVersion: PROFILE_COUNT_BUNDLE_VERSION, reviewRevision, plans };
}
