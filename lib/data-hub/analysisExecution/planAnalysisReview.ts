import { parseAnalysisReviewDecisionInput } from "../analysis/reviewDecisionInput";
import { loadProfileReviewEvidence, type LoadProfileReviewEvidenceResult } from "./loadProfileReviewEvidence";
import { inferDatasetSemantics } from "../semanticInference/inferDatasetSemantics";
import { buildDatasetSemanticClarificationPlan, type DatasetSemanticClarificationPlan } from "../semanticInference/clarification";
import { resolveDatasetSemantics, type ResolveDatasetSemanticsResult } from "../semanticInference/resolution";
import { synthesizeSemanticDatasetSchema } from "../semanticInference/schemaSynthesis";
import { assessDataQuality, type AssessDataQualityResult } from "../dataQuality";
import { buildDataQualityReviewPlan, type DataQualityReviewPlan } from "../dataQuality/reviewPlanning";

export type PlanAnalysisReviewResult =
  | { ok: true; datasetProfileRunId: string; clarification: DatasetSemanticClarificationPlan;
      quality: DataQualityReviewPlan | null }
  | Extract<LoadProfileReviewEvidenceResult | ResolveDatasetSemanticsResult | AssessDataQualityResult, { ok: false }>
  | { ok: false; code: "REVIEW_INPUT_INVALID" | "REVIEW_PROFILE_CHANGED" | "REVIEW_PLAN_FAILED" };

// Already-authorized scope. Initial reads discover clarification requirements;
// previews accept the closed v1 decision envelope with no quality decisions.
// No review is saved and readiness is never asserted by this planning service.
export async function planAnalysisReview(
  scope: { organisationId: string; uploadId: string }, preview?: unknown,
): Promise<PlanAnalysisReviewResult> {
  const parsed = preview === undefined ? null : parseAnalysisReviewDecisionInput(preview);
  if (parsed && (!parsed.ok || parsed.input.qualityDecisions.length)) return { ok: false, code: "REVIEW_INPUT_INVALID" };
  try {
    const loaded = await loadProfileReviewEvidence(scope);
    if (!loaded.ok) return loaded;
    const datasetProfileRunId = loaded.profile.context.datasetProfileRunId;
    if (parsed?.ok && parsed.input.datasetProfileRunId !== datasetProfileRunId) return { ok: false, code: "REVIEW_PROFILE_CHANGED" };
    const inferred = inferDatasetSemantics(loaded.profile.snapshot);
    const clarification = buildDatasetSemanticClarificationPlan(inferred);
    if (!parsed) return { ok: true, datasetProfileRunId, clarification, quality: null };
    if (!parsed.ok) return { ok: false, code: "REVIEW_INPUT_INVALID" };
    const resolved = resolveDatasetSemantics(inferred, parsed.input.semanticChoices);
    if (!resolved.ok) return resolved;
    const assessed = assessDataQuality(loaded.profile.snapshot, synthesizeSemanticDatasetSchema(resolved.resolved));
    if (!assessed.ok) return assessed;
    return { ok: true, datasetProfileRunId, clarification, quality: buildDataQualityReviewPlan(assessed.assessment) };
  } catch { return { ok: false, code: "REVIEW_PLAN_FAILED" }; }
}
