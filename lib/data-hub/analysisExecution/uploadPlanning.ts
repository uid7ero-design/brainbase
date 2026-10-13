import { loadAnalysisReview } from "./loadAnalysisReview";
import { buildReviewedProfileCountRequestCatalog, type ReviewedProfileCountRequestCatalog } from "../analysis/reviewedProfileCountCatalog";
import { buildReviewedProfileCountSelection } from "../analysis/profileCountSelection";
import { parsePlanningSelectionRequest } from "../analysis/planningSelectionRequest";
import { isPlanningFailureCode, type PlanningExchangeFailure, type PlanningSelectionResponse } from "../analysis/planningExchange";

type Scope = { organisationId: string; uploadId: string };
type CatalogResult = { ok: true; catalog: ReviewedProfileCountRequestCatalog } | PlanningExchangeFailure;
type SelectionResult = PlanningSelectionResponse | PlanningExchangeFailure;
const validScope = (scope: Scope) => typeof scope.organisationId === "string" && !!scope.organisationId.trim() &&
  typeof scope.uploadId === "string" && !!scope.uploadId.trim();
function denial(result: { code: unknown; requestIndex?: number }): PlanningExchangeFailure {
  return { ok: false, code: isPlanningFailureCode(result.code) ? result.code : "REVIEW_RECORD_INVALID",
    ...(result.requestIndex === undefined ? {} : { requestIndex: result.requestIndex }) };
}

// Caller authorizes manager/tenant scope. The existing loader owns a single
// RepeatableRead profile/review snapshot. Pure planning performs no further I/O.
export async function loadUploadPlanningCatalog(scope: Scope): Promise<CatalogResult> {
  if (!validScope(scope)) return { ok: false, code: "CONTEXT_INPUT_INVALID" };
  try {
    const loaded = await loadAnalysisReview(scope);
    if (!loaded.ok) return denial(loaded);
    const built = buildReviewedProfileCountRequestCatalog(loaded.schema.context, loaded);
    return built.ok ? built : denial(built);
  } catch { return { ok: false, code: "REVIEW_READ_FAILED" }; }
}
export async function planUploadSelection(scope: Scope, input: unknown): Promise<SelectionResult> {
  if (!validScope(scope)) return { ok: false, code: "CONTEXT_INPUT_INVALID" };
  const parsed = parsePlanningSelectionRequest(input);
  if (!parsed.ok) return parsed;
  try {
    const loaded = await loadAnalysisReview(scope);
    if (!loaded.ok) return denial(loaded);
    if (parsed.input.datasetProfileRunId !== loaded.schema.context.datasetProfileRunId) {
      return { ok: false, code: "REVIEW_PROFILE_CHANGED" };
    }
    const built = buildReviewedProfileCountSelection(loaded.schema.context, loaded, parsed.input.selection);
    return built.ok ? built : denial(built);
  } catch { return { ok: false, code: "REVIEW_READ_FAILED" }; }
}
