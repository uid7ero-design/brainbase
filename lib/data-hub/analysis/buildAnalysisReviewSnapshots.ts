import { DATASET_PROFILER_VERSION, type DatasetReviewEvidence } from "../profiling/contracts";
import { inferDatasetSemantics } from "../semanticInference/inferDatasetSemantics";
import { resolveDatasetSemantics, type SemanticClarificationChoice,
  type ResolveDatasetSemanticsResult } from "../semanticInference/resolution";
import { synthesizeSemanticDatasetSchema, type SemanticDatasetSchemaDraft } from "../semanticInference/schemaSynthesis";
import { assessDataQuality } from "../dataQuality/assessDataQuality";
import type { AssessDataQualityResult } from "../dataQuality/contracts";
import { buildDataQualityReviewPlan } from "../dataQuality/reviewPlanning";
import { resolveDataQualityReview, type DataQualityReviewDecisionInput,
  type DataQualityReviewResolution, type ResolveDataQualityReviewResult } from "../dataQuality/reviewResolution";
import { hasValidProfileCounts } from "./profileCounts";
import { validateAnalysisDatasetContexts, type AnalysisDatasetContext,
  type ScopedAnalysisSnapshot } from "./scopedProfileCounts";

export type BuildAnalysisReviewSnapshotsResult =
  | { ok: true; schema: ScopedAnalysisSnapshot<SemanticDatasetSchemaDraft>;
      quality: ScopedAnalysisSnapshot<DataQualityReviewResolution> }
  | Extract<ResolveDatasetSemanticsResult | AssessDataQualityResult | ResolveDataQualityReviewResult, { ok: false }>
  | { ok: false; code: "DATASET_CONTEXT_INVALID" | "DATASET_CONTEXT_MISMATCH" | "PROFILE_EVIDENCE_INVALID" };

// Internal pure composition over trusted, typed profile evidence and explicit
// decisions. No caller-created schema or continuation state is accepted.
// The future server loader must establish profile provenance and authorize
// decisions; matching contexts alone cannot establish either responsibility.
export function buildAnalysisReviewSnapshots(
  expected: AnalysisDatasetContext,
  profile: ScopedAnalysisSnapshot<DatasetReviewEvidence>,
  semanticChoices: ScopedAnalysisSnapshot<readonly SemanticClarificationChoice[]>,
  qualityDecisions: ScopedAnalysisSnapshot<readonly DataQualityReviewDecisionInput[]>,
): BuildAnalysisReviewSnapshotsResult {
  const checked = validateAnalysisDatasetContexts(expected,
    [profile.context, semanticChoices.context, qualityDecisions.context]);
  if (!checked.ok) return checked;
  if (profile.snapshot.profilerVersion !== DATASET_PROFILER_VERSION || !hasValidProfileCounts(profile.snapshot)) {
    return { ok: false, code: "PROFILE_EVIDENCE_INVALID" };
  }
  const inferred = inferDatasetSemantics(profile.snapshot);
  const semantics = resolveDatasetSemantics(inferred, semanticChoices.snapshot);
  if (!semantics.ok) return semantics;
  const schema = synthesizeSemanticDatasetSchema(semantics.resolved);
  const assessed = assessDataQuality(profile.snapshot, schema);
  if (!assessed.ok) return assessed;
  const reviewed = resolveDataQualityReview(buildDataQualityReviewPlan(assessed.assessment), qualityDecisions.snapshot);
  if (!reviewed.ok) return reviewed;
  // Explicit projection prevents unexpected caller metadata entering output.
  const context: AnalysisDatasetContext = {
    organisationId: expected.organisationId, uploadId: expected.uploadId, importBatchId: expected.importBatchId,
    normalizationRunId: expected.normalizationRunId, datasetProfileRunId: expected.datasetProfileRunId,
    sourceSchemaVersionId: expected.sourceSchemaVersionId, sourceSchemaWorksheetId: expected.sourceSchemaWorksheetId,
    worksheetMappingProfileVersionId: expected.worksheetMappingProfileVersionId,
  };
  return { ok: true, schema: { context: { ...context }, snapshot: schema },
    quality: { context: { ...context }, snapshot: reviewed.resolved } };
}
