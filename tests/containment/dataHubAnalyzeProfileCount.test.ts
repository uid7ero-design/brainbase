import { describe, expect, it } from "vitest";
import { profileDataset } from "@/lib/data-hub/profiling/profileDataset";
import { analyzeProfileCount, type AnalysisDatasetContext } from "@/lib/data-hub/analysis";
import type { SemanticDatasetSchemaDraft } from "@/lib/data-hub/semanticInference/schemaSynthesis";
import type { DataQualityReviewResolution } from "@/lib/data-hub/dataQuality/reviewResolution";

function fixture() {
  const context: AnalysisDatasetContext = { organisationId: "org", uploadId: "upload", importBatchId: "batch",
    normalizationRunId: "normalization", datasetProfileRunId: "profile", sourceSchemaVersionId: "schema",
    sourceSchemaWorksheetId: "worksheet", worksheetMappingProfileVersionId: "mapping" };
  const schema: SemanticDatasetSchemaDraft = { schemaVersion: "v1", resolutionVersion: "v1",
    inferenceVersion: "v1", profilerVersion: "v1", recordKeyCandidateState: "NONE", fields: [{
      sourceSchemaColumnId: "amount", semanticRole: "MEASURE", fieldClass: "MEASURE",
      recordKeyCandidate: false, confidence: "HIGH", evidence: [], resolutionSource: "AUTO_HIGH_CONFIDENCE" }] };
  const quality: DataQualityReviewResolution = { resolutionVersion: "v1", reviewVersion: "v1",
    qualityVersion: "v1", profilerVersion: "v1", schemaVersion: "v1", state: "READY",
    itemCount: 0, acknowledgedNoticeCount: 0, continuedReviewCount: 0, heldReviewCount: 0, items: [] };
  const built = profileDataset({ rowCount: 3, columns: [{ sourceSchemaColumnId: "amount",
    valueKind: "DECIMAL", sourceUnit: null, normalizedUnit: null,
    cells: [{ sourceRowNumber: 1, normalizedValue: "0" }] }] });
  if (!built.ok) throw new Error(built.code);
  return { expected: context, schema: { context: { ...context }, snapshot: schema },
    quality: { context: { ...context }, snapshot: quality },
    profile: { context: { ...context }, snapshot: built.profile } };
}
const rows = { requestVersion: "v1", kind: "ROW_COUNT" };
const present = { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: "amount", operator: "COUNT_PRESENT" };
function run(f: ReturnType<typeof fixture>, request: unknown = rows) {
  return analyzeProfileCount(f.expected, f.schema, f.quality, f.profile, request);
}

describe("D4D5I profile count orchestration", () => {
  it.each([[rows, 3], [present, 1]])("builds readiness, plan, and result in one path %#", (request, count) => {
    expect(run(fixture(), request)).toMatchObject({ ok: true, result: { count, context: fixture().expected } });
  });
  it.each(["schema", "quality", "profile"] as const)("checks %s scope before evaluating", (name) => {
    const f = fixture(); f[name].context.datasetProfileRunId = "other";
    expect(run(f)).toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
  });
  it("rejects two matching semantic/quality snapshots outside the expected context", () => {
    const f = fixture(); f.schema.context.uploadId = "other"; f.quality.context.uploadId = "other";
    expect(run(f)).toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
  });
  it("blocks a reviewed quality hold", () => {
    const f = fixture(); f.quality.snapshot.state = "HOLD_FOR_REMEDIATION";
    expect(run(f)).toEqual({ ok: false, code: "QUALITY_HOLD" });
  });
  it("keeps acknowledged notices in the result", () => {
    const f = fixture(); f.quality.snapshot.state = "READY_WITH_ACKNOWLEDGED_NOTICES";
    expect(run(f)).toMatchObject({ ok: true, result: { plan: { readinessState: f.quality.snapshot.state } } });
  });
  it("rejects invalid runtime quality state rather than treating it as ready", () => {
    const f = fixture(); f.quality.snapshot.state = "unknown" as typeof f.quality.snapshot.state;
    expect(run(f)).toEqual({ ok: false, code: "QUALITY_STATE_INVALID" });
  });
  it("preserves schema-quality version failures", () => {
    const f = fixture(); f.quality.snapshot.schemaVersion = "other" as typeof f.quality.snapshot.schemaVersion;
    expect(run(f)).toEqual({ ok: false, code: "SCHEMA_QUALITY_LINEAGE_MISMATCH" });
  });
  it("preserves profile compatibility failures", () => {
    const f = fixture(); f.profile.snapshot.columns[0].sourceSchemaColumnId = "other";
    expect(run(f)).toEqual({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" });
  });
  it("rejects malformed requests", () => {
    expect(run(fixture(), null)).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
  it("leaves all snapshots unchanged and emits no profile statistics beyond count", () => {
    const f = fixture(); const before = JSON.stringify(f); const result = run(f, present);
    expect(run(f, present)).toEqual(result);
    expect(JSON.stringify(f)).toBe(before);
    expect(JSON.stringify(result)).not.toContain("numericStats");
  });
});
