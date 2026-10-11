import { describe, expect, it } from "vitest";
import { buildReviewedProfileCountBundle, MAX_PROFILE_COUNT_BUNDLE_REQUESTS, type ReviewedPlanningSnapshot, type AnalysisDatasetContext } from "@/lib/data-hub/analysis";
function context(): AnalysisDatasetContext {
  return { organisationId: "org", uploadId: "upload", importBatchId: "batch",
    normalizationRunId: "normalization", datasetProfileRunId: "profile", sourceSchemaVersionId: "schema",
    sourceSchemaWorksheetId: "worksheet", worksheetMappingProfileVersionId: "mapping" };
}
function review(): ReviewedPlanningSnapshot {
  return { revision: 3, schema: { context: context(), snapshot: {
    schemaVersion: "v1", resolutionVersion: "v1", inferenceVersion: "v1", profilerVersion: "v1",
    recordKeyCandidateState: "NONE", fields: [{ sourceSchemaColumnId: "amount", semanticRole: "MEASURE",
      fieldClass: "MEASURE", recordKeyCandidate: false, confidence: "HIGH", evidence: [], resolutionSource: "CLARIFIED_CHOICE" }] } },
    quality: { context: context(), snapshot: { resolutionVersion: "v1", reviewVersion: "v1",
      qualityVersion: "v1", profilerVersion: "v1", schemaVersion: "v1", state: "READY",
      itemCount: 0, acknowledgedNoticeCount: 0, continuedReviewCount: 0, heldReviewCount: 0, items: [] } } };
}
const rows = { requestVersion: "v1", kind: "ROW_COUNT" };
const present = { requestVersion: "v1", kind: "AGGREGATE", operator: "COUNT_PRESENT", sourceSchemaColumnId: "amount" };
const bundle = (requests: unknown[] = [rows, present], expectedReviewRevision = 3) =>
  ({ bundleVersion: "v1", expectedReviewRevision, requests });

describe("review-pinned profile planning bundles", () => {
  it("preserves order and duplicates with detached plans and no values", () => {
    const metadata = review(); const input = bundle([present, rows, present]);
    const before = structuredClone({ metadata, input });
    const result = buildReviewedProfileCountBundle(context(), metadata, input);
    expect({ metadata, input }).toEqual(before);
    expect(result).toMatchObject({ ok: true, bundleVersion: "v1", reviewRevision: 3,
      plans: [{ snapshot: { operation: "COUNT_PRESENT" } }, { snapshot: { operation: "ROW_COUNT" } },
        { snapshot: { operation: "COUNT_PRESENT" } }] });
    if (!result.ok) throw new Error(result.code);
    metadata.revision = 4; metadata.schema.context.uploadId = "changed";
    input.requests.length = 0;
    expect(result.reviewRevision).toBe(3); expect(result.plans).toHaveLength(3);
    result.plans[0].context.uploadId = "mutated";
    expect(result.plans[1].context).toEqual(context()); expect(result.plans[2].context).toEqual(context());
    expect(result.plans.every(plan => !("count" in plan.snapshot))).toBe(true);
  });
  it.each([1, MAX_PROFILE_COUNT_BUNDLE_REQUESTS])("accepts the documented bound %s", length => {
    expect(buildReviewedProfileCountBundle(context(), review(), bundle(Array(length).fill(rows)))).toMatchObject({ ok: true });
  });
  it.each([null, [], {}, { ...bundle(), extra: true }, { ...bundle(), bundleVersion: "v2" },
    { ...bundle(), requests: [] }, { ...bundle(), requests: Array(MAX_PROFILE_COUNT_BUNDLE_REQUESTS + 1).fill(rows) },
    { ...bundle(), requests: "rows" }, { ...bundle(), expectedReviewRevision: 0 },
    { ...bundle(), expectedReviewRevision: 1.5 }, { ...bundle(), expectedReviewRevision: Infinity },
    { ...bundle(), expectedReviewRevision: Number.MAX_SAFE_INTEGER + 1 }])("rejects malformed envelopes %#", input => {
    expect(buildReviewedProfileCountBundle(context(), review(), input)).toEqual({ ok: false, code: "PROFILE_BUNDLE_INVALID" });
  });
  it.each([2, 4])("rejects an older or newer supplied revision %s before snapshot access", revision => {
    const metadata = review();
    Object.defineProperty(metadata.schema, "snapshot", { get() { throw new Error("must not read schema"); } });
    expect(buildReviewedProfileCountBundle(context(), metadata, bundle([rows], revision)))
      .toEqual({ ok: false, code: "REVIEW_REVISION_MISMATCH" });
  });
  it("checks trusted scope and review revision before request envelope or snapshots", () => {
    const metadata = review(); metadata.quality.context.organisationId = "other";
    Object.defineProperty(metadata.schema, "snapshot", { get() { throw new Error("must not read schema"); } });
    expect(buildReviewedProfileCountBundle(context(), metadata, null)).toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
    metadata.quality.context = context(); metadata.revision = 0;
    expect(buildReviewedProfileCountBundle(context(), metadata, null)).toEqual({ ok: false, code: "REVIEW_REVISION_INVALID" });
  });
  it.each([null, { ...present, sourceSchemaColumnId: "missing" },
    { ...present, operator: undefined }])("rejects the whole bundle at the first failing position %#", request => {
    const result = buildReviewedProfileCountBundle(context(), review(), bundle([rows, request, rows]));
    expect(result).toMatchObject({ ok: false, requestIndex: 1 });
    expect(result).not.toHaveProperty("plans");
  });
  it("rejects sparse request arrays instead of silently skipping holes", () => {
    const requests = new Array(2); requests[0] = rows;
    expect(buildReviewedProfileCountBundle(context(), review(), bundle(requests)))
      .toEqual({ ok: false, code: "INVALID_REQUEST", requestIndex: 1 });
  });
  it("retains quality hold denial without any accepted subset", () => {
    const metadata = review(); metadata.quality.snapshot.state = "HOLD_FOR_REMEDIATION";
    expect(buildReviewedProfileCountBundle(context(), metadata, bundle()))
      .toEqual({ ok: false, code: "QUALITY_HOLD", requestIndex: 0 });
  });
  it("retains acknowledged notices across every accepted request", () => {
    const metadata = review(); metadata.quality.snapshot.state = "READY_WITH_ACKNOWLEDGED_NOTICES";
    const result = buildReviewedProfileCountBundle(context(), metadata, bundle());
    if (!result.ok) throw new Error(result.code);
    expect(result.plans.every(plan => plan.snapshot.readinessState === "READY_WITH_ACKNOWLEDGED_NOTICES")).toBe(true);
  });
});
