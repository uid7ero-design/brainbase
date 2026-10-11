import { describe, expect, it } from "vitest";
import { buildReviewedProfileCountBundle, buildReviewedProfileCountPlan, MAX_PROFILE_COUNT_BUNDLE_REQUESTS, type ReviewedPlanningSnapshot, type AnalysisDatasetContext } from "@/lib/data-hub/analysis";
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
  it("retains copied request payloads when review preparation mutates the originals", () => {
    const metadata = review(); const schema = metadata.schema.snapshot;
    const request = { ...present }; const input = bundle([request, request]);
    Object.defineProperty(metadata.schema, "snapshot", { get() {
      request.sourceSchemaColumnId = "missing"; request.operator = "SUM"; return schema;
    } });
    const result = buildReviewedProfileCountBundle(context(), metadata, input);
    expect(result).toMatchObject({ ok: true, plans: [
      { snapshot: { operation: "COUNT_PRESENT", sourceSchemaColumnId: "amount" } },
      { snapshot: { operation: "COUNT_PRESENT", sourceSchemaColumnId: "amount" } },
    ] });
  });
  it("returns indexed invalid intent for accessor payloads without invoking them", () => {
    const request = { ...present };
    Object.defineProperty(request, "sourceSchemaColumnId", { get() { throw new Error("must not read payload getter"); } });
    expect(buildReviewedProfileCountBundle(context(), review(), bundle([rows, request])))
      .toEqual({ ok: false, code: "INVALID_REQUEST", requestIndex: 1 });
  });
  it("uses the admitted fixed list when review loading changes the source requests", () => {
    const metadata = review(); const schema = metadata.schema.snapshot;
    const input = bundle([rows, present]);
    Object.defineProperty(metadata.schema, "snapshot", { get() {
      input.requests.reverse(); input.requests.push(...Array(30).fill(rows)); return schema;
    } });
    const result = buildReviewedProfileCountBundle(context(), metadata, input);
    expect(input.requests).toHaveLength(32);
    expect(result).toMatchObject({ ok: true, plans: [
      { snapshot: { operation: "ROW_COUNT" } }, { snapshot: { operation: "COUNT_PRESENT" } },
    ] });
    if (!result.ok) throw new Error(result.code);
    expect(result.plans).toHaveLength(2);
  });
  it("reads the review revision and snapshots once for the largest accepted bundle", () => {
    const metadata = review();
    const schema = metadata.schema.snapshot; const quality = metadata.quality.snapshot;
    let revisions = 0; let schemas = 0; let qualities = 0;
    Object.defineProperty(metadata, "revision", { get() { revisions++; return revisions === 1 ? 3 : 4; } });
    Object.defineProperty(metadata.schema, "snapshot", { get() { schemas++; return schema; } });
    Object.defineProperty(metadata.quality, "snapshot", { get() { qualities++; return quality; } });
    const result = buildReviewedProfileCountBundle(context(), metadata, bundle(Array(MAX_PROFILE_COUNT_BUNDLE_REQUESTS).fill(present)));
    expect(result).toMatchObject({ ok: true, reviewRevision: 3 });
    expect({ revisions, schemas, qualities }).toEqual({ revisions: 1, schemas: 1, qualities: 1 });
    if (!result.ok) throw new Error(result.code);
    expect(result.plans).toHaveLength(MAX_PROFILE_COUNT_BUNDLE_REQUESTS);
  });
  it.each(["READY", "READY_WITH_ACKNOWLEDGED_NOTICES", "HOLD_FOR_REMEDIATION"] as const)
    ("preserves single-request planner behavior for quality %s", state => {
      const metadata = review(); metadata.quality.snapshot.state = state;
      for (const request of [rows, present, { ...present, sourceSchemaColumnId: "missing" }, null]) {
        const single = buildReviewedProfileCountPlan(context(), metadata, request);
        const result = buildReviewedProfileCountBundle(context(), metadata, bundle([request]));
        expect(result).toEqual(single.ok ? { ok: true, bundleVersion: "v1", reviewRevision: single.reviewRevision,
          plans: [single.plan] } : { ...single, requestIndex: 0 });
      }
    });
  it.each(["lineage", "quality", "catalog", "version"])("retains review admission denial %s without partial plans", kind => {
    const metadata = review();
    if (kind === "lineage") Object.assign(metadata.quality.snapshot, { schemaVersion: "v2" });
    if (kind === "quality") Object.assign(metadata.quality.snapshot, { state: "UNKNOWN" });
    if (kind === "catalog") metadata.schema.snapshot.fields.push(metadata.schema.snapshot.fields[0]);
    if (kind === "version") Object.assign(metadata.quality.snapshot, { resolutionVersion: "v2" });
    const single = buildReviewedProfileCountPlan(context(), metadata, rows);
    expect(single.ok).toBe(false);
    expect(buildReviewedProfileCountBundle(context(), metadata, bundle())).toEqual({ ...single, requestIndex: 0 });
  });
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
