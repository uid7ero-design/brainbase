import { planningFixture } from "./dataHubPlanningFixture";

export const reviewPlanFixture = () => ({ ok: true, datasetProfileRunId: "profile-1", clarification: {
  clarificationVersion: "v1", inferenceVersion: "v1", profilerVersion: "v1", requiresClarification: true, columns: [
    { sourceSchemaColumnId: "amount", resolutionState: "CLARIFICATION_REQUIRED", candidateRoles: ["MEASURE", "CURRENCY"], reasons: ["MULTIPLE_CANDIDATES"] },
  ] }, quality: null, fieldLabels: [{ sourceSchemaColumnId: "amount", label: "Amount" }] });
export const reviewPreviewFixture = () => ({ ...reviewPlanFixture(), quality: { reviewVersion: "v1", qualityVersion: "v1",
  profilerVersion: "v1", schemaVersion: "v1", items: [{ code: "COLUMN_PARTIALLY_NULL", scope: "COLUMN", sourceSchemaColumnId: "amount", action: "ACKNOWLEDGE_NOTICE" }] } });
export function savedReviewFixture(held = false, uploadId = "upload") {
  const { review } = planningFixture();
  review.revision = 2;
  review.schema.context.uploadId = review.quality.context.uploadId = uploadId;
  review.schema.context.datasetProfileRunId = review.quality.context.datasetProfileRunId = "profile-1";
  if (held) { review.quality.snapshot.state = "HOLD_FOR_REMEDIATION"; review.quality.snapshot.items = [
    { code: "COLUMN_ALL_NULL", scope: "COLUMN", sourceSchemaColumnId: "amount", decision: "HOLD" },
  ]; }
  return review;
}
