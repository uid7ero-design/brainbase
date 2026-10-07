import { beforeEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/data-hub/analysisExecution/loadProfileCountEvidence", () => ({ loadProfileCountEvidence: mocked.load }));
import { analyzeUploadProfileCount } from "@/lib/data-hub/analysisExecution/analyzeUploadProfileCount";
import type { AnalysisDatasetContext } from "@/lib/data-hub/analysis";
import type { SemanticDatasetSchemaDraft } from "@/lib/data-hub/semanticInference/schemaSynthesis";
import type { DataQualityReviewResolution } from "@/lib/data-hub/dataQuality/reviewResolution";

function fixture() {
  const context: AnalysisDatasetContext = { organisationId: "org", uploadId: "upload", importBatchId: "batch",
    normalizationRunId: "norm", datasetProfileRunId: "profile", sourceSchemaVersionId: "schema",
    sourceSchemaWorksheetId: "worksheet", worksheetMappingProfileVersionId: "mapping" };
  const schema: SemanticDatasetSchemaDraft = { schemaVersion: "v1", resolutionVersion: "v1",
    inferenceVersion: "v1", profilerVersion: "v1", recordKeyCandidateState: "NONE", fields: [{
      sourceSchemaColumnId: "amount", semanticRole: "MEASURE", fieldClass: "MEASURE",
      recordKeyCandidate: false, confidence: "HIGH", evidence: [], resolutionSource: "AUTO_HIGH_CONFIDENCE" }] };
  const quality: DataQualityReviewResolution = { resolutionVersion: "v1", reviewVersion: "v1", qualityVersion: "v1",
    profilerVersion: "v1", schemaVersion: "v1", state: "READY", itemCount: 0, acknowledgedNoticeCount: 0,
    continuedReviewCount: 0, heldReviewCount: 0, items: [] };
  return { scope: { organisationId: "org", uploadId: "upload" },
    schema: { context: { ...context }, snapshot: schema }, quality: { context: { ...context }, snapshot: quality },
    profile: { context, snapshot: { profilerVersion: "v1" as const, rowCount: 3, columnCount: 1,
      columns: [{ sourceSchemaColumnId: "amount", rowCount: 3, nonNullCount: 1, nullCount: 2 }] } } };
}
const rows = { requestVersion: "v1", kind: "ROW_COUNT" };
const present = { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: "amount", operator: "COUNT_PRESENT" };
beforeEach(() => { vi.resetAllMocks(); mocked.load.mockResolvedValue({ ok: true, profile: fixture().profile }); });

describe("D4D5L upload count service (mocked loader, real evaluation)", () => {
  it.each([[rows, 3], [present, 1]])("loads pinned evidence and evaluates count %#", async (request, count) => {
    const f = fixture();
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, request))
      .toMatchObject({ ok: true, result: { count, context: f.profile.context } });
    expect(mocked.load).toHaveBeenCalledExactlyOnceWith(f.scope);
  });
  it.each(["UPLOAD_NOT_FOUND", "PROFILE_NOT_COMPLETE", "PROFILE_COUNTS_INVALID", "CONTEXT_READ_FAILED"])(
    "preserves loader failure %s", async (code) => {
      mocked.load.mockResolvedValue({ ok: false, code }); const f = fixture();
      expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, rows)).toEqual({ ok: false, code });
    },
  );
  it.each(["organisationId", "uploadId"] as const)("checks loaded %s against authorized scope", async (key) => {
    const f = fixture(); f.profile.context[key] = "other";
    mocked.load.mockResolvedValue({ ok: true, profile: f.profile });
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, rows))
      .toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
  });
  it.each(["schema", "quality"] as const)("rejects stale %s snapshot context", async (name) => {
    const f = fixture(); f[name].context.datasetProfileRunId = "old-profile";
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, rows))
      .toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
  });
  it("propagates a reviewed hold", async () => {
    const f = fixture(); f.quality.snapshot.state = "HOLD_FOR_REMEDIATION";
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, rows))
      .toEqual({ ok: false, code: "QUALITY_HOLD" });
  });
  it("preserves acknowledged notices", async () => {
    const f = fixture(); f.quality.snapshot.state = "READY_WITH_ACKNOWLEDGED_NOTICES";
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, present))
      .toMatchObject({ ok: true, result: { plan: { readinessState: f.quality.snapshot.state } } });
  });
  it("rejects request extensions instead of executing them", async () => {
    const f = fixture();
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, { ...rows, query: "select *" }))
      .toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
  it("does not allow a caller to replace the loaded profile", async () => {
    const f = fixture();
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, { ...rows, profile: { rowCount: 999 } }))
      .toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
  it("does not modify supplied semantic and quality snapshots", async () => {
    const f = fixture(); const before = JSON.stringify(f);
    await analyzeUploadProfileCount(f.scope, f.schema, f.quality, present);
    expect(JSON.stringify(f)).toBe(before);
  });
  it("closes unexpected errors without returning sensitive text", async () => {
    mocked.load.mockRejectedValue(new Error("sensitive details")); const f = fixture();
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, rows))
      .toEqual({ ok: false, code: "ANALYSIS_EVALUATION_FAILED" });
  });
});
