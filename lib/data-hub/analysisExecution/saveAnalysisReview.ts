import { prisma } from "../../prisma";
import { parseAnalysisReviewDecisionInput, buildAnalysisReviewSnapshots } from "../analysis";
import type { BuildAnalysisReviewSnapshotsResult } from "../analysis/buildAnalysisReviewSnapshots";
import { loadProfileReviewEvidenceInTransaction, type LoadProfileReviewEvidenceResult } from "./loadProfileReviewEvidence";

export type SaveAnalysisReviewResult =
  | { ok: true; revision: number }
  | Extract<BuildAnalysisReviewSnapshotsResult | LoadProfileReviewEvidenceResult, { ok: false }>
  | { ok: false; code: "REVIEW_INPUT_INVALID" | "REVIEW_ACTOR_INVALID" | "REVIEW_PROFILE_CHANGED" | "REVIEW_SAVE_FAILED" };

// Internal service: a trusted authenticated caller supplies scope and actor.
// Decision input cannot select identity, revision, timestamp or readiness.
// Serializable conflicts fail closed; callers may retry the whole operation.
export async function saveAnalysisReview(
  scope: { organisationId: string; uploadId: string; actorId: string }, decisions: unknown,
): Promise<SaveAnalysisReviewResult> {
  if (typeof scope.organisationId !== "string" || !scope.organisationId.trim() ||
    typeof scope.uploadId !== "string" || !scope.uploadId.trim()) return { ok: false, code: "CONTEXT_INPUT_INVALID" };
  if (typeof scope.actorId !== "string" || !scope.actorId.trim()) return { ok: false, code: "REVIEW_ACTOR_INVALID" };
  const parsed = parseAnalysisReviewDecisionInput(decisions);
  if (!parsed.ok) return parsed;
  try {
    return await prisma.$transaction(async (tx): Promise<SaveAnalysisReviewResult> => {
      const actor = await tx.user.findFirst({ where: { id: scope.actorId, organisation_id: scope.organisationId,
        status: "ACTIVE", role: { in: ["SUPER_ADMIN", "ADMIN", "MANAGER"] } }, select: { id: true } });
      if (!actor || actor.id !== scope.actorId) return { ok: false, code: "REVIEW_ACTOR_INVALID" };
      const loaded = await loadProfileReviewEvidenceInTransaction(scope, tx);
      if (!loaded.ok) return loaded;
      const { context } = loaded.profile;
      if (parsed.input.datasetProfileRunId !== context.datasetProfileRunId) return { ok: false, code: "REVIEW_PROFILE_CHANGED" };
      const resolved = buildAnalysisReviewSnapshots(context, loaded.profile,
        { context, snapshot: parsed.input.semanticChoices }, { context, snapshot: parsed.input.qualityDecisions });
      if (!resolved.ok) return resolved;
      const latest = await tx.dataHubAnalysisReview.findFirst({ where: { organisation_id: context.organisationId,
        upload_id: context.uploadId, profile_run_id: context.datasetProfileRunId },
        orderBy: { revision: "desc" }, select: { revision: true } });
      const revision = (latest?.revision ?? 0) + 1;
      if (!Number.isSafeInteger(revision) || revision < 1 || revision > 2147483647) return { ok: false, code: "REVIEW_SAVE_FAILED" };
      await tx.dataHubAnalysisReview.create({ data: { organisation_id: context.organisationId, upload_id: context.uploadId,
        profile_run_id: context.datasetProfileRunId, revision, review_version: "v1", reviewed_by_id: scope.actorId,
        semantic_choices: parsed.input.semanticChoices.map((choice) => ({ ...choice })),
        quality_decisions: parsed.input.qualityDecisions.map((decision) => ({ ...decision })) }, select: { id: true } });
      return { ok: true, revision };
    }, { isolationLevel: "Serializable" });
  } catch {
    return { ok: false, code: "REVIEW_SAVE_FAILED" };
  }
}
