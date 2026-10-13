import type { LoadAnalysisReviewResult } from "@/lib/data-hub/analysisExecution/loadAnalysisReview";
import { buildReviewedProfileCountRequestCatalog } from "@/lib/data-hub/analysis/reviewedProfileCountCatalog";
import { buildReviewedProfileCountSelection } from "@/lib/data-hub/analysis/profileCountSelection";
import { buildReviewedPlanningCatalogPage } from "@/lib/data-hub/analysis/planningCatalogPage";

export function planningFixture(measures = 1) {
  const context = { organisationId: "org", uploadId: "upload", importBatchId: "batch", normalizationRunId: "norm",
    datasetProfileRunId: "profile", sourceSchemaVersionId: "schema", sourceSchemaWorksheetId: "worksheet", worksheetMappingProfileVersionId: "mapping" };
  const review: Extract<LoadAnalysisReviewResult, { ok: true }> = { ok: true, revision: 3,
    schema: { context: { ...context }, snapshot: { schemaVersion: "v1", resolutionVersion: "v1", inferenceVersion: "v1",
      profilerVersion: "v1", recordKeyCandidateState: "NONE", fields: Array.from({ length: measures }, (_, index) => ({
        sourceSchemaColumnId: index === 0 ? "amount" : `measure-${index}`, semanticRole: "MEASURE", fieldClass: "MEASURE",
        recordKeyCandidate: false, confidence: "HIGH", evidence: [], resolutionSource: "CLARIFIED_CHOICE" })) } },
    quality: { context: { ...context }, snapshot: { resolutionVersion: "v1", reviewVersion: "v1", qualityVersion: "v1",
      profilerVersion: "v1", schemaVersion: "v1", state: "READY", itemCount: 0, acknowledgedNoticeCount: 0,
      continuedReviewCount: 0, heldReviewCount: 0, items: [] } } };
  const selection = { selectionVersion: "v1" as const, expectedReviewRevision: 3, includeRowCount: true, measureColumnIds: ["amount"] };
  return { context, review, selection, body: { datasetProfileRunId: "profile", selection },
    labels: review.schema.snapshot.fields.map(field => ({ sourceSchemaColumnId: field.sourceSchemaColumnId, label: "Amount" })),
    catalog: () => buildReviewedProfileCountRequestCatalog(context, review),
    page: (offset = 0, pageSize = 50) => buildReviewedPlanningCatalogPage(context, review, { pageVersion: "v1",
      datasetProfileRunId: context.datasetProfileRunId, expectedReviewRevision: review.revision, pageSize, offset }),
    planned: () => buildReviewedProfileCountSelection(context, review, selection) };
}
