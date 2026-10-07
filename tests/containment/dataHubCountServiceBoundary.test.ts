import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ upload: vi.fn(), profile: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: db.transaction } }));
import { analyzeUploadProfileCount } from "@/lib/data-hub/analysisExecution/analyzeUploadProfileCount";
import type { AnalysisDatasetContext } from "@/lib/data-hub/analysis";
import type { SemanticDatasetSchemaDraft } from "@/lib/data-hub/semanticInference/schemaSynthesis";
import type { DataQualityReviewResolution } from "@/lib/data-hub/dataQuality/reviewResolution";

function fixture() {
  const context: AnalysisDatasetContext = { organisationId: "org", uploadId: "upload", importBatchId: "batch",
    normalizationRunId: "norm", datasetProfileRunId: "profile", sourceSchemaVersionId: "schema",
    sourceSchemaWorksheetId: "worksheet", worksheetMappingProfileVersionId: "mapping" };
  const normalization = { id: "norm", organisation_id: "org", upload_id: "upload", import_batch_id: "batch",
    source_schema_version_id: "schema", source_schema_worksheet_id: "worksheet",
    worksheet_mapping_profile_version_id: "mapping", status: "SUCCEEDED" };
  const metadata = { ...normalization, id: "profile", normalization_run_id: "norm",
    profiler_version: "v1", normalization_run: normalization };
  const counts = { row_count: BigInt(3), column_count: BigInt(1), columns: [{ source_schema_column_id: "amount",
    row_count: BigInt(3), non_null_count: BigInt(1), null_count: BigInt(2) }] };
  const schema: SemanticDatasetSchemaDraft = { schemaVersion: "v1", resolutionVersion: "v1",
    inferenceVersion: "v1", profilerVersion: "v1", recordKeyCandidateState: "NONE", fields: [{
      sourceSchemaColumnId: "amount", semanticRole: "MEASURE", fieldClass: "MEASURE",
      recordKeyCandidate: false, confidence: "HIGH", evidence: [], resolutionSource: "AUTO_HIGH_CONFIDENCE" }] };
  const quality: DataQualityReviewResolution = { resolutionVersion: "v1", reviewVersion: "v1", qualityVersion: "v1",
    profilerVersion: "v1", schemaVersion: "v1", state: "READY", itemCount: 0, acknowledgedNoticeCount: 0,
    continuedReviewCount: 0, heldReviewCount: 0, items: [] };
  return { metadata, counts, scope: { organisationId: "org", uploadId: "upload" },
    schema: { context: { ...context }, snapshot: schema }, quality: { context: { ...context }, snapshot: quality } };
}
const rows = { requestVersion: "v1", kind: "ROW_COUNT" };
const present = { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: "amount", operator: "COUNT_PRESENT" };
beforeEach(() => {
  vi.resetAllMocks(); const f = fixture();
  db.upload.mockResolvedValue({ id: "upload", organisation_id: "org", import_batch_id: "batch",
    dataset_profile_run_id: "profile", normalization_run_id: "norm" });
  db.profile.mockResolvedValueOnce(f.metadata).mockResolvedValueOnce(f.counts);
  db.transaction.mockImplementation(async (callback) => callback({ upload: { findFirst: db.upload },
    dataHubDatasetProfileRun: { findFirst: db.profile } }));
});

// Only Prisma is mocked: service, resolver, loader and evaluation run together.
// This proves composition and rejection behavior, not database isolation or SQL.
describe("D4D5M complete count service boundary", () => {
  it.each([[rows, 3], [present, 1]])("returns persisted count through the complete chain %#", async (request, count) => {
    const f = fixture();
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, request))
      .toMatchObject({ ok: true, result: { count, context: f.schema.context } });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
    expect(db.upload.mock.calls[0][0].where).toEqual({ id: "upload", organisation_id: "org", lineage_kind: "DATA_HUB" });
    expect(db.profile.mock.calls[1][0].where.id).toBe("profile");
  });
  it("rejects snapshots from the previous profile after the upload pointer changes", async () => {
    const f = fixture(); db.upload.mockResolvedValue({ id: "upload", organisation_id: "org", import_batch_id: "batch",
      dataset_profile_run_id: "new-profile", normalization_run_id: "norm" });
    db.profile.mockReset().mockResolvedValueOnce({ ...f.metadata, id: "new-profile" }).mockResolvedValueOnce(f.counts);
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, rows))
      .toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
    expect(db.profile.mock.calls[1][0].where.id).toBe("new-profile");
  });
  it("rejects a cross-organization normalization before loading counts", async () => {
    const f = fixture(); f.metadata.normalization_run.organisation_id = "other";
    db.profile.mockReset().mockResolvedValueOnce(f.metadata);
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, rows))
      .toEqual({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" });
    expect(db.profile).toHaveBeenCalledTimes(1);
  });
  it("rejects incomplete profiling before loading counts", async () => {
    const f = fixture(); db.profile.mockReset().mockResolvedValueOnce({ ...f.metadata, status: "RUNNING" });
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, rows))
      .toEqual({ ok: false, code: "PROFILE_NOT_COMPLETE" });
    expect(db.profile).toHaveBeenCalledTimes(1);
  });
  it("rejects corrupt persisted count evidence", async () => {
    const f = fixture(); f.counts.columns[0].null_count = BigInt(0);
    db.profile.mockReset().mockResolvedValueOnce(f.metadata).mockResolvedValueOnce(f.counts);
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, present))
      .toEqual({ ok: false, code: "PROFILE_COUNTS_INVALID" });
  });
  it("rejects a semantic field set that differs from persisted profile columns", async () => {
    const f = fixture(); f.schema.snapshot.fields[0].sourceSchemaColumnId = "other";
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, rows))
      .toEqual({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" });
  });
  it("honors quality holds after loading valid evidence", async () => {
    const f = fixture(); f.quality.snapshot.state = "HOLD_FOR_REMEDIATION";
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, present))
      .toEqual({ ok: false, code: "QUALITY_HOLD" });
  });
  it("closes database errors without exposing their details", async () => {
    const f = fixture(); db.transaction.mockRejectedValue(new Error("private database details"));
    expect(await analyzeUploadProfileCount(f.scope, f.schema, f.quality, rows))
      .toEqual({ ok: false, code: "CONTEXT_READ_FAILED" });
  });
});
