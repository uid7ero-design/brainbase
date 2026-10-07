import { prisma } from "../../prisma";
import { parseAnalysisReviewDecisionInput, buildAnalysisReviewSnapshots } from "../analysis";
import type { BuildAnalysisReviewSnapshotsResult } from "../analysis/buildAnalysisReviewSnapshots";
import { loadProfileReviewEvidenceInTransaction, type LoadProfileReviewEvidenceResult } from "./loadProfileReviewEvidence";

export type LoadAnalysisReviewResult =
  | (Extract<BuildAnalysisReviewSnapshotsResult, { ok: true }> & { revision: number })
  | Extract<BuildAnalysisReviewSnapshotsResult | LoadProfileReviewEvidenceResult, { ok: false }>
  | { ok: false; code: "REVIEW_NOT_FOUND" | "REVIEW_RECORD_INVALID" | "REVIEW_READ_FAILED" };

// Internal read service. Scope must already be authorized by the caller.
// Readiness is recomputed from the pinned profile and latest decisions in one
// snapshot. Historical actor eligibility is enforced at insertion, not read.
export async function loadAnalysisReview(
  input: { organisationId: string; uploadId: string },
): Promise<LoadAnalysisReviewResult> {
  if (typeof input.organisationId !== "string" || !input.organisationId.trim() ||
    typeof input.uploadId !== "string" || !input.uploadId.trim()) return { ok: false, code: "CONTEXT_INPUT_INVALID" };
  try {
    return await prisma.$transaction(async (tx): Promise<LoadAnalysisReviewResult> => {
      const loaded = await loadProfileReviewEvidenceInTransaction(input, tx);
      if (!loaded.ok) return loaded;
      const { context } = loaded.profile;
      const review = await tx.dataHubAnalysisReview.findFirst({
        where: { organisation_id: context.organisationId, upload_id: context.uploadId,
          profile_run_id: context.datasetProfileRunId },
        orderBy: { revision: "desc" },
        select: { organisation_id: true, upload_id: true, profile_run_id: true, revision: true,
          review_version: true, semantic_choices: true, quality_decisions: true },
      });
      if (!review) return { ok: false, code: "REVIEW_NOT_FOUND" };
      if (review.organisation_id !== context.organisationId || review.upload_id !== context.uploadId ||
        review.profile_run_id !== context.datasetProfileRunId || !Number.isSafeInteger(review.revision) || review.revision < 1) {
        return { ok: false, code: "REVIEW_RECORD_INVALID" };
      }
      const parsed = parseAnalysisReviewDecisionInput({ reviewVersion: review.review_version,
        datasetProfileRunId: review.profile_run_id, semanticChoices: review.semantic_choices,
        qualityDecisions: review.quality_decisions });
      if (!parsed.ok) return { ok: false, code: "REVIEW_RECORD_INVALID" };
      const resolved = buildAnalysisReviewSnapshots(context, loaded.profile,
        { context, snapshot: parsed.input.semanticChoices }, { context, snapshot: parsed.input.qualityDecisions });
      return resolved.ok ? { ...resolved, revision: review.revision } : resolved;
    }, { isolationLevel: "RepeatableRead" });
  } catch {
    return { ok: false, code: "REVIEW_READ_FAILED" };
  }
}
