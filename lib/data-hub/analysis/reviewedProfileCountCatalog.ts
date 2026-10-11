import { buildAnalysisReadiness } from "./buildAnalysisReadiness";
import { buildProfileCountPlan, type ProfileCountAnalysisPlan } from "./profileCountPlan";
import type { AnalysisRequest } from "./requestValidation";
import type { ReviewedPlanningSnapshot, BuildReviewedProfileCountPlanResult } from "./reviewedProfileCountPlan";
import { copyAnalysisDatasetContext, validateAnalysisDatasetContexts, type AnalysisDatasetContext } from "./scopedProfileCounts";

export const PROFILE_COUNT_REQUEST_CATALOG_VERSION = "v1" as const;
export type ProfileCountRequestTemplate =
  | Extract<AnalysisRequest, { kind: "ROW_COUNT" }>
  | (Extract<AnalysisRequest, { kind: "AGGREGATE" }> & { operator: "COUNT_PRESENT" });
export interface ReviewedProfileCountRequestCatalog {
  catalogVersion: typeof PROFILE_COUNT_REQUEST_CATALOG_VERSION;
  context: AnalysisDatasetContext;
  reviewRevision: number;
  readinessState: ProfileCountAnalysisPlan["readinessState"];
  requests: readonly ProfileCountRequestTemplate[];
}
export type BuildReviewedProfileCountRequestCatalogResult =
  | { ok: true; catalog: ReviewedProfileCountRequestCatalog }
  | Extract<BuildReviewedProfileCountPlanResult, { ok: false }>;

// Discovery over trusted metadata, not evidence, authorization or execution.
// Templates still require planning against current authorized review metadata.
export function buildReviewedProfileCountRequestCatalog(
  expected: AnalysisDatasetContext, review: ReviewedPlanningSnapshot,
): BuildReviewedProfileCountRequestCatalogResult {
  const checked = validateAnalysisDatasetContexts(expected, [review.schema.context, review.quality.context]);
  if (!checked.ok) return checked;
  const reviewRevision = review.revision;
  if (!Number.isSafeInteger(reviewRevision) || reviewRevision < 1) {
    return { ok: false, code: "REVIEW_REVISION_INVALID" };
  }
  const built = buildAnalysisReadiness(review.schema.snapshot, review.quality.snapshot);
  if (!built.ok) return built;
  // Existing target admission checks holds, catalog structure and all supported
  // algorithm versions before exposing any request template.
  const admitted = buildProfileCountPlan(built.readiness, { requestVersion: "v1", kind: "ROW_COUNT" });
  if (!admitted.ok) return admitted;
  const requests: ProfileCountRequestTemplate[] = [{ requestVersion: "v1", kind: "ROW_COUNT" }];
  for (const sourceSchemaColumnId of built.readiness.catalog.measures) {
    requests.push({ requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId, operator: "COUNT_PRESENT" });
  }
  return { ok: true, catalog: { catalogVersion: PROFILE_COUNT_REQUEST_CATALOG_VERSION,
    context: copyAnalysisDatasetContext(expected), reviewRevision,
    readinessState: admitted.plan.readinessState, requests } };
}
