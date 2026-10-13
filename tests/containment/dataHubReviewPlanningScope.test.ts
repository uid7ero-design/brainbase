import { describe, expect, it } from "vitest";
import { buildReviewedProfileCountPlan, buildReviewedProfileCountBundle, buildReviewedProfileCountRequestCatalog, buildReviewedProfileCountSelection, type ReviewedPlanningSnapshot, type AnalysisDatasetContext } from "@/lib/data-hub/analysis";

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
const selection = { selectionVersion: "v1", expectedReviewRevision: 3, includeRowCount: true, measureColumnIds: [] };
const bundle = { bundleVersion: "v1", expectedReviewRevision: 3, requests: [rows] };
function run(kind: string, expected: AnalysisDatasetContext, metadata: ReviewedPlanningSnapshot) {
  if (kind === "single") {
    const result = buildReviewedProfileCountPlan(expected, metadata, rows);
    return result.ok ? { ok: true, context: result.plan.context, revision: result.reviewRevision } : result;
  }
  if (kind === "catalog") {
    const result = buildReviewedProfileCountRequestCatalog(expected, metadata);
    return result.ok ? { ok: true, context: result.catalog.context, revision: result.catalog.reviewRevision } : result;
  }
  const result = kind === "bundle" ? buildReviewedProfileCountBundle(expected, metadata, bundle)
    : buildReviewedProfileCountSelection(expected, metadata, selection);
  return result.ok ? { ok: true, context: result.plans[0].context, revision: result.reviewRevision } : result;
}
describe.each(["single", "catalog", "bundle", "selection"])("shared review scope admission for %s", kind => {
  it("captures revision once and context before later metadata reads", () => {
    const expected = context(); const metadata = review(); let reads = 0;
    Object.assign(expected, { privateMetadata: "omit" });
    Object.defineProperty(metadata, "revision", { get() { reads++; expected.uploadId = "changed"; return reads === 1 ? 3 : 0; } });
    expect(run(kind, expected, metadata)).toEqual({ ok: true, context: context(), revision: 3 });
    expect(reads).toBe(1);
  });
  it("rejects every identity mismatch in either review context before snapshot access", () => {
    for (const key of Object.keys(context()) as (keyof AnalysisDatasetContext)[]) {
      for (const name of ["schema", "quality"] as const) {
        const metadata = review(); metadata[name].context[key] = "other";
        Object.defineProperty(metadata.schema, "snapshot", { get() { throw new Error("must not read"); } });
        expect(run(kind, context(), metadata)).toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
      }
    }
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects revision %s before snapshot access", revision => {
    const metadata = review(); metadata.revision = revision;
    Object.defineProperty(metadata.schema, "snapshot", { get() { throw new Error("must not read"); } });
    expect(run(kind, context(), metadata)).toEqual({ ok: false, code: "REVIEW_REVISION_INVALID" });
  });
});
