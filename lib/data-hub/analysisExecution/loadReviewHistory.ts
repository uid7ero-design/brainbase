import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import { loadProfileReviewEvidenceInTransaction } from "./loadProfileReviewEvidence";
import { parseAnalysisReviewDecisionInput } from "../analysis/reviewDecisionInput";
import { buildAnalysisReviewSnapshots } from "../analysis/buildAnalysisReviewSnapshots";
import { compareReviewDecisions, decodeReviewComparison, decodeReviewHistory, decodeReviewDetail, summarizeReview, MAX_HISTORY_FIELDS,
  MAX_HISTORY_QUALITY, REVIEW_HISTORY_PAGE_SIZE, type ReviewHistoryQuery, type ReviewHistoryPage, type ReviewComparison, type ReviewDetail } from "../analysis/reviewHistory";

type FailureCode = "UPLOAD_NOT_FOUND" | "REVIEW_NOT_FOUND" | "PROFILE_NOT_COMPLETE" | "REVIEW_PROFILE_CHANGED" | "REVIEW_REVISION_MISMATCH"
  | "REVIEW_RECORD_INVALID" | "REVIEW_HISTORY_INVALID" | "REVIEW_HISTORY_UNAVAILABLE" | "REVIEW_FIELD_LIMIT";
export type ReviewHistoryResult = { ok: true; history: ReviewHistoryPage } | { ok: true; comparison: ReviewComparison } | { ok: true; detail: ReviewDetail } | { ok: false; code: FailureCode };
const select = { organisation_id: true, upload_id: true, profile_run_id: true, revision: true,
  review_version: true, semantic_choices: true, quality_decisions: true } as const;
type Stored = Prisma.DataHubAnalysisReviewGetPayload<{ select: typeof select }>;
const boundedId = (value: unknown) => typeof value === "string" && !!value.trim() && value.length <= 512;

// Caller derives organization from the authorized live manager session. All
// profile, latest-review and historical reads share one bounded snapshot.
export async function loadReviewHistory(scope: { organisationId: string; uploadId: string }, query: ReviewHistoryQuery): Promise<ReviewHistoryResult> {
  if (!boundedId(scope.organisationId) || !boundedId(scope.uploadId) || !boundedId(query.datasetProfileRunId) ||
      !Number.isSafeInteger(query.expectedReviewRevision) || query.expectedReviewRevision < 1 ||
      (query.kind === "page" ? query.beforeRevision !== null && (!Number.isSafeInteger(query.beforeRevision) || query.beforeRevision < 1 || query.beforeRevision > query.expectedReviewRevision) :
        query.kind === "detail" ? !Number.isSafeInteger(query.revision) || query.revision < 1 || query.revision > query.expectedReviewRevision :
        query.kind !== "compare" || !Number.isSafeInteger(query.baselineRevision) || query.baselineRevision < 1 || query.baselineRevision >= query.expectedReviewRevision)) return { ok: false, code: "REVIEW_HISTORY_INVALID" };
  try {
    return await prisma.$transaction(async tx => {
      const loaded = await loadProfileReviewEvidenceInTransaction(scope, tx);
      if (!loaded.ok) return { ok: false as const, code: loaded.code === "UPLOAD_NOT_FOUND" || loaded.code === "PROFILE_NOT_COMPLETE" ? loaded.code : "REVIEW_HISTORY_UNAVAILABLE" as const };
      const profile = loaded.profile;
      const { context, snapshot } = profile;
      if (context.organisationId !== scope.organisationId || context.uploadId !== scope.uploadId) return { ok: false as const, code: "REVIEW_HISTORY_UNAVAILABLE" as const };
      if (context.datasetProfileRunId !== query.datasetProfileRunId) return { ok: false as const, code: "REVIEW_PROFILE_CHANGED" as const };
      if (snapshot.columns.length > MAX_HISTORY_FIELDS) return { ok: false as const, code: "REVIEW_FIELD_LIMIT" as const };
      const where = { organisation_id: context.organisationId, upload_id: context.uploadId, profile_run_id: context.datasetProfileRunId };
      function decisions(row: Stored) {
        if (row.organisation_id !== where.organisation_id || row.upload_id !== where.upload_id || row.profile_run_id !== where.profile_run_id ||
            !Number.isSafeInteger(row.revision) || row.revision < 1 || !Array.isArray(row.semantic_choices) || row.semantic_choices.length > MAX_HISTORY_FIELDS ||
            !Array.isArray(row.quality_decisions) || row.quality_decisions.length > MAX_HISTORY_QUALITY) throw new Error("REVIEW_RECORD_INVALID");
        const parsed = parseAnalysisReviewDecisionInput({ reviewVersion: row.review_version, datasetProfileRunId: row.profile_run_id,
          semanticChoices: row.semantic_choices, qualityDecisions: row.quality_decisions });
        if (!parsed.ok || !buildAnalysisReviewSnapshots(context, profile,
          { context, snapshot: parsed.input.semanticChoices }, { context, snapshot: parsed.input.qualityDecisions }).ok) throw new Error("REVIEW_RECORD_INVALID");
        return parsed.input;
      }
      const latest = await tx.dataHubAnalysisReview.findFirst({ where, orderBy: { revision: "desc" }, select });
      if (!latest) return { ok: false as const, code: "REVIEW_NOT_FOUND" as const };
      const current = decisions(latest); // Invalid latest decisions never fall back.
      if (latest.revision !== query.expectedReviewRevision) return { ok: false as const, code: "REVIEW_REVISION_MISMATCH" as const };
      if (query.kind === "detail") {
        const selected = query.revision === latest.revision ? latest : await tx.dataHubAnalysisReview.findFirst({ where: { ...where, revision: query.revision }, select });
        if (!selected || selected.revision !== query.revision) return { ok: false as const, code: "REVIEW_RECORD_INVALID" as const };
        const input = query.revision === latest.revision ? current : decisions(selected);
        const detail = { detailVersion: "v1" as const, context, currentReviewRevision: latest.revision, revision: selected.revision,
          semanticChoices: input.semanticChoices, qualityDecisions: input.qualityDecisions };
        return { ok: true as const, detail: decodeReviewDetail({ ok: true, detail }, context, query, snapshot.columns.map(column => column.sourceSchemaColumnId)) };
      }
      if (query.kind === "compare") {
        const baseline = await tx.dataHubAnalysisReview.findFirst({ where: { ...where, revision: query.baselineRevision }, select });
        if (!baseline || baseline.revision !== query.baselineRevision) return { ok: false as const, code: "REVIEW_RECORD_INVALID" as const };
        const comparison = { comparisonVersion: "v1" as const, context, currentReviewRevision: latest.revision,
          baselineRevision: baseline.revision, ...compareReviewDecisions(decisions(baseline), current) };
        return { ok: true as const, comparison: decodeReviewComparison({ ok: true, comparison }, context, query, snapshot.columns.map(column => column.sourceSchemaColumnId)) };
      }
      const rows = await tx.dataHubAnalysisReview.findMany({ where: { ...where,
        revision: query.beforeRevision === null ? { lte: latest.revision } : { lt: query.beforeRevision } }, orderBy: { revision: "desc" }, take: REVIEW_HISTORY_PAGE_SIZE + 1, select });
      let last = query.beforeRevision ?? Infinity;
      const entries = rows.map(row => {
        if (row.revision >= last || row.revision > latest.revision) throw new Error("REVIEW_RECORD_INVALID");
        last = row.revision; return summarizeReview(row.revision, decisions(row));
      });
      const shown = entries.slice(0, REVIEW_HISTORY_PAGE_SIZE);
      const history = { historyVersion: "v1" as const, context, currentReviewRevision: latest.revision, beforeRevision: query.beforeRevision,
        nextBeforeRevision: entries.length > REVIEW_HISTORY_PAGE_SIZE ? shown.at(-1)!.revision : null, entries: shown };
      return { ok: true as const, history: decodeReviewHistory({ ok: true, history }, context, query) };
    }, { isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 5_000 });
  } catch (error) { return { ok: false, code: error instanceof Error && error.message === "REVIEW_RECORD_INVALID" ? "REVIEW_RECORD_INVALID" : "REVIEW_HISTORY_UNAVAILABLE" }; }
}
