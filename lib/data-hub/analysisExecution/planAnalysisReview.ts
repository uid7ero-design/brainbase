import { parseAnalysisReviewDecisionInput } from "../analysis/reviewDecisionInput";
import { loadProfileReviewEvidenceInTransaction, type LoadProfileReviewEvidenceResult } from "./loadProfileReviewEvidence";
import { prisma } from "../../prisma";
import { inferDatasetSemantics } from "../semanticInference/inferDatasetSemantics";
import { buildDatasetSemanticClarificationPlan, type DatasetSemanticClarificationPlan } from "../semanticInference/clarification";
import { resolveDatasetSemantics, type ResolveDatasetSemanticsResult } from "../semanticInference/resolution";
import { synthesizeSemanticDatasetSchema } from "../semanticInference/schemaSynthesis";
import { assessDataQuality, type AssessDataQualityResult } from "../dataQuality";
import { buildDataQualityReviewPlan, type DataQualityReviewPlan } from "../dataQuality/reviewPlanning";

export type PlanAnalysisReviewResult =
  | { ok: true; datasetProfileRunId: string; clarification: DatasetSemanticClarificationPlan;
      quality: DataQualityReviewPlan | null;
      fieldLabels: { sourceSchemaColumnId: string; label: string }[] }
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
  if (typeof scope.organisationId !== "string" || !scope.organisationId.trim() ||
      typeof scope.uploadId !== "string" || !scope.uploadId.trim()) return { ok: false, code: "CONTEXT_INPUT_INVALID" };
  try {
    return await prisma.$transaction(async (tx): Promise<PlanAnalysisReviewResult> => {
      const loaded = await loadProfileReviewEvidenceInTransaction(scope, tx);
      if (!loaded.ok) return loaded;
      const datasetProfileRunId = loaded.profile.context.datasetProfileRunId;
      if (parsed?.ok && parsed.input.datasetProfileRunId !== datasetProfileRunId) return { ok: false, code: "REVIEW_PROFILE_CHANGED" };
      const inferred = inferDatasetSemantics(loaded.profile.snapshot);
      const clarification = buildDatasetSemanticClarificationPlan(inferred);
      // Governed schema headers only, pinned to the same transaction as the
      // profile. Never inspect uploaded headers or raw/normalized cell values.
      const columns = await tx.sourceSchemaColumn.findMany({
        where: { organisation_id: scope.organisationId,
          source_schema_worksheet_id: loaded.profile.context.sourceSchemaWorksheetId,
          id: { in: clarification.columns.map(column => column.sourceSchemaColumnId) } },
        select: { id: true, source_header: true },
      });
      const labels = new Map(columns.map(column => [column.id, column.source_header]));
      const fieldLabels = clarification.columns.map((column, index) => ({
        sourceSchemaColumnId: column.sourceSchemaColumnId,
        label: labels.get(column.sourceSchemaColumnId)?.trim() || `Field ${index + 1}`,
      }));
      if (!parsed) return { ok: true, datasetProfileRunId, clarification, fieldLabels, quality: null };
      if (!parsed.ok) return { ok: false, code: "REVIEW_INPUT_INVALID" };
      const resolved = resolveDatasetSemantics(inferred, parsed.input.semanticChoices);
      if (!resolved.ok) return resolved;
      const assessed = assessDataQuality(loaded.profile.snapshot, synthesizeSemanticDatasetSchema(resolved.resolved));
      if (!assessed.ok) return assessed;
      return { ok: true, datasetProfileRunId, clarification, fieldLabels, quality: buildDataQualityReviewPlan(assessed.assessment) };
    }, { isolationLevel: "RepeatableRead" });
  } catch { return { ok: false, code: "REVIEW_PLAN_FAILED" }; }
}
