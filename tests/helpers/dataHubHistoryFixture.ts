import { planningFixture } from "./dataHubPlanningFixture";
import type { ReviewHistoryEntry, ReviewHistoryPage, ReviewComparison } from "@/lib/data-hub/analysis/reviewHistory";
export const historyEntry = (revision: number): ReviewHistoryEntry => ({ revision, semanticChoiceCount: 1, qualityDecisionCount: 1,
  acknowledgedNoticeCount: 0, continuedReviewCount: 1, heldReviewCount: 0 });
export function historyFixture(revision = 3) {
  const fixture = planningFixture(); fixture.review.revision = revision;
  const history: ReviewHistoryPage = { historyVersion: "v1", context: { ...fixture.context }, currentReviewRevision: revision,
    beforeRevision: null, nextBeforeRevision: null, entries: [historyEntry(revision), historyEntry(1)] };
  const comparison: ReviewComparison = { comparisonVersion: "v1", context: { ...fixture.context }, currentReviewRevision: revision, baselineRevision: 1,
    semanticChanges: [{ sourceSchemaColumnId: "amount", fromRole: "MEASURE", toRole: "CURRENCY" }],
    qualityChanges: [{ code: "COLUMN_ALL_NULL", scope: "COLUMN", sourceSchemaColumnId: "amount", fromDecision: "HOLD", toDecision: "CONTINUE" }] };
  return { ...fixture, history, comparison };
}
