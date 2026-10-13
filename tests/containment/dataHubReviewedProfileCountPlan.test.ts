import { describe, expect, it } from "vitest";
import { buildReviewedProfileCountPlan, type ReviewedPlanningSnapshot, type AnalysisDatasetContext } from "@/lib/data-hub/analysis";

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
const keys = Object.keys(context()) as (keyof AnalysisDatasetContext)[];

describe("review-derived profile planning", () => {
  it.each([rows, present])("derives scoped intent from review metadata without statistics %#", request => {
    const input = review(); const before = structuredClone(input);
    const result = buildReviewedProfileCountPlan(context(), input, request);
    expect(result).toMatchObject({ ok: true, reviewRevision: 3,
      plan: { context: context(), snapshot: { readinessState: "READY", operation: request.kind === "ROW_COUNT" ? "ROW_COUNT" : "COUNT_PRESENT" } } });
    expect(input).toEqual(before);
    if (!result.ok) throw new Error(result.code);
    input.revision = 4; input.schema.context.uploadId = "changed"; input.quality.snapshot.state = "HOLD_FOR_REMEDIATION";
    expect(result.reviewRevision).toBe(3); expect(result.plan.context).toEqual(context());
    expect(result.plan.snapshot.readinessState).toBe("READY");
    expect(result).not.toHaveProperty("count");
  });
  it.each(keys)("rejects schema and quality %s mismatches", key => {
    for (const name of ["schema", "quality"] as const) {
      const input = review(); input[name].context[key] = "other";
      expect(buildReviewedProfileCountPlan(context(), input, rows)).toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
    }
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid review revision %s", revision => {
    const input = review(); input.revision = revision;
    expect(buildReviewedProfileCountPlan(context(), input, rows)).toEqual({ ok: false, code: "REVIEW_REVISION_INVALID" });
  });
  it("checks scope before reading review snapshots", () => {
    const input = review(); input.schema.context.uploadId = "other";
    Object.defineProperty(input.schema, "snapshot", { get() { throw new Error("Snapshot must not be read"); } });
    expect(buildReviewedProfileCountPlan(context(), input, rows)).toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
  });
  it.each(["hold", "unknown", "lineage", "version", "catalog", "field"])("retains composed denial %s", kind => {
    const input = review(); let request: unknown = rows; let code = "";
    if (kind === "hold") { input.quality.snapshot.state = "HOLD_FOR_REMEDIATION"; code = "QUALITY_HOLD"; }
    if (kind === "unknown") { Object.assign(input.quality.snapshot, { state: "UNKNOWN" }); code = "QUALITY_STATE_INVALID"; }
    if (kind === "lineage") { Object.assign(input.quality.snapshot, { schemaVersion: "v2" }); code = "SCHEMA_QUALITY_LINEAGE_MISMATCH"; }
    if (kind === "version") { Object.assign(input.quality.snapshot, { resolutionVersion: "v2" }); code = "PROFILE_PLAN_VERSION_UNSUPPORTED"; }
    if (kind === "catalog") { input.schema.snapshot.fields.push(input.schema.snapshot.fields[0]); code = "READINESS_CATALOG_INVALID"; }
    if (kind === "field") { request = { ...present, sourceSchemaColumnId: "missing" }; code = "CAPABILITY_NOT_AVAILABLE"; }
    expect(buildReviewedProfileCountPlan(context(), input, request)).toEqual({ ok: false, code });
  });
  it("retains acknowledged notices and actual review revision", () => {
    const input = review(); input.revision = 7; input.quality.snapshot.state = "READY_WITH_ACKNOWLEDGED_NOTICES";
    expect(buildReviewedProfileCountPlan(context(), input, present)).toMatchObject({ ok: true, reviewRevision: 7,
      plan: { snapshot: { readinessState: "READY_WITH_ACKNOWLEDGED_NOTICES", missingValuePolicy: "EXCLUDE_MISSING" } } });
  });
});
