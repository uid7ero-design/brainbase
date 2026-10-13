import { describe, expect, it } from "vitest";
import { buildReviewedProfileCountRequestCatalog, buildReviewedProfileCountPlan, buildReviewedProfileCountBundle, type ReviewedPlanningSnapshot, type AnalysisDatasetContext } from "@/lib/data-hub/analysis";

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

describe("review-derived profile-target request discovery", () => {
  it("exposes only target-supported templates that round-trip through governed planning", () => {
    const metadata = review(); const before = structuredClone(metadata);
    const result = buildReviewedProfileCountRequestCatalog(context(), metadata);
    expect(metadata).toEqual(before);
    expect(result).toEqual({ ok: true, catalog: { catalogVersion: "v1", context: context(), reviewRevision: 3,
      readinessState: "READY", requests: [{ requestVersion: "v1", kind: "ROW_COUNT" },
        { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: "amount", operator: "COUNT_PRESENT" }] } });
    if (!result.ok) throw new Error(result.code);
    for (const request of result.catalog.requests) {
      expect(buildReviewedProfileCountPlan(context(), metadata, request).ok).toBe(true);
    }
    expect(buildReviewedProfileCountBundle(context(), metadata, { bundleVersion: "v1", expectedReviewRevision: 3,
      requests: result.catalog.requests })).toMatchObject({ ok: true });
    expect(result.catalog).not.toHaveProperty("count");
  });
  it("copies closed context and templates without retaining mutable review references", () => {
    const expected = context(); Object.assign(expected, { privateMetadata: "omit" });
    const metadata = review(); const result = buildReviewedProfileCountRequestCatalog(expected, metadata);
    metadata.revision = 4; metadata.schema.snapshot.fields[0].sourceSchemaColumnId = "changed";
    expected.uploadId = "changed";
    expect(result).toMatchObject({ ok: true, catalog: { context: context(), reviewRevision: 3,
      requests: [{ kind: "ROW_COUNT" }, { sourceSchemaColumnId: "amount" }] } });
    if (!result.ok) throw new Error(result.code);
    expect(result.catalog.context).not.toHaveProperty("privateMetadata");
    expect(result.catalog).not.toHaveProperty("numericStats");
  });
  it.each(["TEXT_ATTRIBUTE", "IDENTIFIER", "DIMENSION", "FLAG", "TEMPORAL", "GEO_COORDINATE"] as const)
    ("does not advertise measure count for reviewed class %s", fieldClass => {
      const metadata = review(); metadata.schema.snapshot.fields[0].fieldClass = fieldClass;
      expect(buildReviewedProfileCountRequestCatalog(context(), metadata)).toMatchObject({ ok: true,
        catalog: { requests: [{ requestVersion: "v1", kind: "ROW_COUNT" }] } });
      const result = buildReviewedProfileCountRequestCatalog(context(), metadata);
      if (!result.ok) throw new Error(result.code);
      expect(result.catalog.requests).toHaveLength(1);
    });
  it("retains every measure in source order without imposing a batch-execution limit", () => {
    const metadata = review(); const field = metadata.schema.snapshot.fields[0];
    metadata.schema.snapshot.fields = Array.from({ length: 21 }, (_, i) => ({ ...field, sourceSchemaColumnId: `measure-${i}` }));
    const result = buildReviewedProfileCountRequestCatalog(context(), metadata);
    if (!result.ok) throw new Error(result.code);
    expect(result.catalog.requests).toHaveLength(22);
    expect(result.catalog.requests.slice(1).map(request => "sourceSchemaColumnId" in request ? request.sourceSchemaColumnId : null))
      .toEqual(Array.from({ length: 21 }, (_, i) => `measure-${i}`));
    expect(buildReviewedProfileCountBundle(context(), metadata, { bundleVersion: "v1", expectedReviewRevision: 3,
      requests: result.catalog.requests })).toEqual({ ok: false, code: "PROFILE_BUNDLE_INVALID" });
  });
  it("admits row count for a valid zero-field schema", () => {
    const metadata = review(); metadata.schema.snapshot.fields = [];
    expect(buildReviewedProfileCountRequestCatalog(context(), metadata)).toMatchObject({ ok: true,
      catalog: { requests: [{ requestVersion: "v1", kind: "ROW_COUNT" }] } });
  });
  it.each(Object.keys(context()) as (keyof AnalysisDatasetContext)[])("rejects mismatched %s in either snapshot", key => {
    for (const name of ["schema", "quality"] as const) {
      const metadata = review(); metadata[name].context[key] = "other";
      expect(buildReviewedProfileCountRequestCatalog(context(), metadata)).toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
    }
  });
  it("checks scope and invalid revision before accessing snapshots", () => {
    const metadata = review(); metadata.schema.context.uploadId = "other";
    Object.defineProperty(metadata.schema, "snapshot", { get() { throw new Error("must not read schema"); } });
    expect(buildReviewedProfileCountRequestCatalog(context(), metadata)).toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
    metadata.schema.context = context(); metadata.revision = 0;
    expect(buildReviewedProfileCountRequestCatalog(context(), metadata)).toEqual({ ok: false, code: "REVIEW_REVISION_INVALID" });
  });
  it.each(["hold", "unknown", "lineage", "catalog", "version"])("exposes no catalog after denial %s", kind => {
    const metadata = review(); let code = "";
    if (kind === "hold") { metadata.quality.snapshot.state = "HOLD_FOR_REMEDIATION"; code = "QUALITY_HOLD"; }
    if (kind === "unknown") { Object.assign(metadata.quality.snapshot, { state: "UNKNOWN" }); code = "QUALITY_STATE_INVALID"; }
    if (kind === "lineage") { Object.assign(metadata.quality.snapshot, { schemaVersion: "v2" }); code = "SCHEMA_QUALITY_LINEAGE_MISMATCH"; }
    if (kind === "catalog") { metadata.schema.snapshot.fields.push(metadata.schema.snapshot.fields[0]); code = "READINESS_CATALOG_INVALID"; }
    if (kind === "version") { Object.assign(metadata.quality.snapshot, { resolutionVersion: "v2" }); code = "PROFILE_PLAN_VERSION_UNSUPPORTED"; }
    expect(buildReviewedProfileCountRequestCatalog(context(), metadata)).toEqual({ ok: false, code });
  });
  it("retains acknowledged notices in discovery", () => {
    const metadata = review(); metadata.quality.snapshot.state = "READY_WITH_ACKNOWLEDGED_NOTICES";
    expect(buildReviewedProfileCountRequestCatalog(context(), metadata)).toMatchObject({ ok: true,
      catalog: { readinessState: "READY_WITH_ACKNOWLEDGED_NOTICES" } });
  });
});
