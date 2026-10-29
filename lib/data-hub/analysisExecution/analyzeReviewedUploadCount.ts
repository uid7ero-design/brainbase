import { prisma } from "../../prisma";
import { analyzeProfileCount, type AnalyzeProfileCountResult } from "../analysis/analyzeProfileCount";
import { loadAnalysisReviewInTransaction, type LoadAnalysisReviewResult } from "./loadAnalysisReview";
import { loadProfileCountEvidenceInTransaction, type LoadProfileCountEvidenceResult } from "./loadProfileCountEvidence";

export type AnalyzeReviewedUploadCountResult =
  | (Extract<AnalyzeProfileCountResult, { ok: true }> & { reviewRevision: number })
  | Extract<AnalyzeProfileCountResult | LoadAnalysisReviewResult | LoadProfileCountEvidenceResult, { ok: false }>
  | { ok: false; code: "ANALYSIS_EVALUATION_FAILED" };

// Already-authorized scope. Accepts a request only, never caller-built review
// snapshots. Latest decisions, authoritative profile and count evaluation
// share one read snapshot; the result identifies its review revision.
export async function analyzeReviewedUploadCount(
  input: { organisationId: string; uploadId: string }, request: unknown,
): Promise<AnalyzeReviewedUploadCountResult> {
  if (typeof input.organisationId !== "string" || !input.organisationId.trim() ||
    typeof input.uploadId !== "string" || !input.uploadId.trim()) return { ok: false, code: "CONTEXT_INPUT_INVALID" };
  try {
    return await prisma.$transaction(async (tx): Promise<AnalyzeReviewedUploadCountResult> => {
      const review = await loadAnalysisReviewInTransaction(input, tx);
      if (!review.ok) return review;
      const loaded = await loadProfileCountEvidenceInTransaction(input, tx);
      if (!loaded.ok) return loaded;
      const result = analyzeProfileCount(loaded.profile.context, review.schema, review.quality, loaded.profile, request);
      return result.ok ? { ...result, reviewRevision: review.revision } : result;
    }, { isolationLevel: "RepeatableRead" });
  } catch { return { ok: false, code: "ANALYSIS_EVALUATION_FAILED" }; }
}
