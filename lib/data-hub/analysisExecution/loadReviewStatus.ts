import { prisma } from "../../prisma";
import { loadAnalysisReviewInTransaction } from "./loadAnalysisReview";
import { buildAnalysisReadiness } from "../analysis/buildAnalysisReadiness";
import { validateAnalysisDatasetContexts } from "../analysis/scopedProfileCounts";
import { decodeReviewStatus, type ReviewStatus } from "../analysis/reviewStatus";

export type LoadReviewStatusResult = { ok: true; status: ReviewStatus }
  | { ok: false; code: "UPLOAD_NOT_FOUND" | "REVIEW_STATUS_INVALID" | "REVIEW_STATUS_UNAVAILABLE" };

// Authorized caller supplies scope. Read the current profile and latest matching
// decisions in one snapshot; never expose decisions, statistics or raw values.
export async function loadReviewStatus(input: { organisationId: string; uploadId: string }): Promise<LoadReviewStatusResult> {
  if (typeof input.organisationId !== "string" || !input.organisationId.trim() ||
      typeof input.uploadId !== "string" || !input.uploadId.trim() || input.uploadId.length > 512) return { ok: false, code: "REVIEW_STATUS_INVALID" };
  try {
    return await prisma.$transaction(async tx => {
      const loaded = await loadAnalysisReviewInTransaction(input, tx);
      const base = { statusVersion: "v1" as const, uploadId: input.uploadId };
      if (!loaded.ok) {
        if (loaded.code === "UPLOAD_NOT_FOUND") return { ok: false as const, code: "UPLOAD_NOT_FOUND" as const };
        if (loaded.code === "PROFILE_NOT_COMPLETE" || loaded.code === "REVIEW_NOT_FOUND") {
          return { ok: true as const, status: { ...base, state: loaded.code === "PROFILE_NOT_COMPLETE" ? "PREPARATION_REQUIRED" as const : "REVIEW_REQUIRED" as const } };
        }
        return { ok: false as const, code: "REVIEW_STATUS_UNAVAILABLE" as const };
      }
      const context = loaded.schema.context;
      if (context.organisationId !== input.organisationId || context.uploadId !== input.uploadId ||
          !validateAnalysisDatasetContexts(context, [loaded.quality.context]).ok) return { ok: false as const, code: "REVIEW_STATUS_UNAVAILABLE" as const };
      const readiness = buildAnalysisReadiness(loaded.schema.snapshot, loaded.quality.snapshot);
      if (!readiness.ok) return { ok: false as const, code: "REVIEW_STATUS_UNAVAILABLE" as const };
      const state = readiness.readiness.state === "BLOCKED_QUALITY_HOLD" ? "QUALITY_HOLD"
        : readiness.readiness.state === "READY_WITH_ACKNOWLEDGED_NOTICES" ? "REVIEWED_WITH_NOTICES" : "REVIEWED";
      const status = decodeReviewStatus({ ...base, state, datasetProfileRunId: context.datasetProfileRunId, reviewRevision: loaded.revision }, input.uploadId);
      return { ok: true as const, status };
    }, { isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 5_000 });
  } catch { return { ok: false, code: "REVIEW_STATUS_UNAVAILABLE" }; }
}
