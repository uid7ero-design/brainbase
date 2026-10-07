import type { SemanticDatasetSchemaDraft } from "../semanticInference/schemaSynthesis";
import type { DataQualityReviewResolution } from "../dataQuality/reviewResolution";
import type { ScopedAnalysisSnapshot } from "../analysis/scopedProfileCounts";
import { analyzeProfileCount, type AnalyzeProfileCountResult } from "../analysis/analyzeProfileCount";
import { loadProfileCountEvidence, type LoadProfileCountEvidenceResult } from "./loadProfileCountEvidence";

export type AnalyzeUploadProfileCountResult = AnalyzeProfileCountResult |
  Extract<LoadProfileCountEvidenceResult, { ok: false }> |
  { ok: false; code: "ANALYSIS_EVALUATION_FAILED" };

// Internal read-only service. The caller supplies already-authorized scope
// and trusted semantic/review snapshots. Their pinned context must match the
// profile resolved from the upload. No caller-supplied profile is accepted.
export async function analyzeUploadProfileCount(
  scope: { organisationId: string; uploadId: string },
  schema: ScopedAnalysisSnapshot<SemanticDatasetSchemaDraft>,
  quality: ScopedAnalysisSnapshot<DataQualityReviewResolution>,
  request: unknown,
): Promise<AnalyzeUploadProfileCountResult> {
  try {
    const loaded = await loadProfileCountEvidence(scope);
    if (!loaded.ok) return loaded;
    const profile = loaded.profile;
    if (profile.context.organisationId !== scope.organisationId || profile.context.uploadId !== scope.uploadId) {
      return { ok: false, code: "DATASET_CONTEXT_MISMATCH" };
    }
    return analyzeProfileCount(profile.context, schema, quality, profile, request);
  } catch {
    return { ok: false, code: "ANALYSIS_EVALUATION_FAILED" };
  }
}
