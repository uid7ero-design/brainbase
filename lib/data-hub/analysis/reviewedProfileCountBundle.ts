import { buildReviewedProfileCountPlan, type BuildReviewedProfileCountPlanResult,
  type ReviewedPlanningSnapshot } from "./reviewedProfileCountPlan";
import { validateAnalysisDatasetContexts, type AnalysisDatasetContext } from "./scopedProfileCounts";

export const PROFILE_COUNT_BUNDLE_VERSION = "v1" as const;
export const MAX_PROFILE_COUNT_BUNDLE_REQUESTS = 20;

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
  if (!Number.isSafeInteger(review.revision) || review.revision < 1) {
    return { ok: false, code: "REVIEW_REVISION_INVALID" };
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, code: "PROFILE_BUNDLE_INVALID" };
  }
  const bundle = input as Record<string, unknown>;
  const keys = Object.keys(bundle);
  if (keys.length !== 3 || !["bundleVersion", "expectedReviewRevision", "requests"].every(key => keys.includes(key)) ||
      bundle.bundleVersion !== PROFILE_COUNT_BUNDLE_VERSION ||
      !Number.isSafeInteger(bundle.expectedReviewRevision) || (bundle.expectedReviewRevision as number) < 1 ||
      !Array.isArray(bundle.requests) || bundle.requests.length < 1 ||
      bundle.requests.length > MAX_PROFILE_COUNT_BUNDLE_REQUESTS) {
    return { ok: false, code: "PROFILE_BUNDLE_INVALID" };
  }
  if (bundle.expectedReviewRevision !== review.revision) {
    return { ok: false, code: "REVIEW_REVISION_MISMATCH" };
  }
  const plans: AcceptedPlan["plan"][] = [];
  for (let requestIndex = 0; requestIndex < bundle.requests.length; requestIndex++) {
    const planned = buildReviewedProfileCountPlan(expected, review, bundle.requests[requestIndex]);
    if (!planned.ok) return { ...planned, requestIndex };
    plans.push(planned.plan);
  }
  return { ok: true, bundleVersion: PROFILE_COUNT_BUNDLE_VERSION, reviewRevision: review.revision, plans };
}
