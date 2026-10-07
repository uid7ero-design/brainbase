import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ upload: vi.fn(), profile: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: db.transaction } }));
import { loadProfileCountEvidence } from "@/lib/data-hub/analysisExecution/loadProfileCountEvidence";
import { evaluateProfileCount, type AnalysisReadiness } from "@/lib/data-hub/analysis";

function metadata() {
  const normalization = { id: "norm", organisation_id: "org", upload_id: "upload", import_batch_id: "batch",
    source_schema_version_id: "schema", source_schema_worksheet_id: "worksheet",
    worksheet_mapping_profile_version_id: "mapping", status: "SUCCEEDED" };
  return { ...normalization, id: "profile", normalization_run_id: "norm",
    profiler_version: "v1", normalization_run: normalization };
}
function counts() {
  return { row_count: BigInt(3), column_count: BigInt(1), columns: [{ source_schema_column_id: "amount",
    row_count: BigInt(3), non_null_count: BigInt(1), null_count: BigInt(2) }] };
}
const input = { organisationId: "org", uploadId: "upload" };
beforeEach(() => {
  vi.resetAllMocks();
  db.upload.mockResolvedValue({ id: "upload", organisation_id: "org", import_batch_id: "batch",
    dataset_profile_run_id: "profile", normalization_run_id: "norm" });
  db.profile.mockResolvedValueOnce(metadata()).mockResolvedValueOnce(counts());
  db.transaction.mockImplementation(async (callback) => callback({ upload: { findFirst: db.upload },
    dataHubDatasetProfileRun: { findFirst: db.profile } }));
});

describe("D4D5K pinned count loader (mocked reads)", () => {
  it("loads counts and authoritative context inside one transaction", async () => {
    const result = await loadProfileCountEvidence(input);
    expect(result).toMatchObject({ ok: true, profile: { context: { datasetProfileRunId: "profile" },
      snapshot: { profilerVersion: "v1", rowCount: 3, columnCount: 1,
        columns: [{ sourceSchemaColumnId: "amount", rowCount: 3, nonNullCount: 1, nullCount: 2 }] } } });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
    expect(db.profile.mock.calls[1][0].where).toEqual({ id: "profile", organisation_id: "org",
      upload_id: "upload", status: "SUCCEEDED", profiler_version: "v1" });
    expect(db.profile.mock.calls[1][0].select.columns.where).toEqual({ organisation_id: "org" });
    expect(db.profile.mock.calls[1][0].select.columns.orderBy).toEqual({ ordinal: "asc" });
  });
  it("selects exactly count evidence rather than values or summaries", async () => {
    await loadProfileCountEvidence(input);
    expect(db.profile.mock.calls[1][0].select).toEqual({ row_count: true, column_count: true,
      columns: { where: { organisation_id: "org" }, orderBy: { ordinal: "asc" },
        select: { source_schema_column_id: true, row_count: true, non_null_count: true, null_count: true } } });
  });
  it("feeds the real pure evaluator without fabricating profile statistics", async () => {
    const loaded = await loadProfileCountEvidence(input);
    if (!loaded.ok) throw new Error(loaded.code);
    const readiness: AnalysisReadiness = { readinessVersion: "v1", schemaVersion: "v1", profilerVersion: "v1",
      qualityResolutionVersion: "v1", state: "READY", fieldCount: 1,
      catalog: { textAttributes: [], identifiers: [], dimensions: [], flags: [], measures: ["amount"], temporals: [], geoCoordinates: [] } };
    expect(evaluateProfileCount(readiness, { requestVersion: "v1", kind: "AGGREGATE",
      sourceSchemaColumnId: "amount", operator: "COUNT_PRESENT" }, loaded.profile.snapshot))
      .toMatchObject({ ok: true, result: { count: 1 } });
  });
  it("does not load counts when context cannot be resolved", async () => {
    db.upload.mockResolvedValue(null);
    expect(await loadProfileCountEvidence(input)).toEqual({ ok: false, code: "UPLOAD_NOT_FOUND" });
    expect(db.profile).not.toHaveBeenCalled();
  });
  it("rejects an invalid input before any read", async () => {
    expect(await loadProfileCountEvidence({ ...input, uploadId: " " }))
      .toEqual({ ok: false, code: "CONTEXT_INPUT_INVALID" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("fails closed when the count query has no matching run", async () => {
    db.profile.mockReset().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(null);
    expect(await loadProfileCountEvidence(input)).toEqual({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" });
  });
  it.each([null, BigInt(-1), BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1)])("rejects missing or unsafe count %s", async (rowCount) => {
    db.profile.mockReset().mockResolvedValueOnce(metadata()).mockResolvedValueOnce({ ...counts(), row_count: rowCount });
    expect(await loadProfileCountEvidence(input)).toEqual({ ok: false, code: "PROFILE_COUNTS_INVALID" });
  });
  it.each(["sum", "duplicates", "columnCount", "rowCount", "blankId"])("rejects inconsistent evidence: %s", async (kind) => {
    const data = counts();
    if (kind === "sum") data.columns[0].null_count = BigInt(1);
    if (kind === "duplicates") { data.columns.push(data.columns[0]); data.column_count = BigInt(2); }
    if (kind === "columnCount") data.column_count = BigInt(2);
    if (kind === "rowCount") data.columns[0].row_count = BigInt(4);
    if (kind === "blankId") data.columns[0].source_schema_column_id = " ";
    db.profile.mockReset().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(data);
    expect(await loadProfileCountEvidence(input)).toEqual({ ok: false, code: "PROFILE_COUNTS_INVALID" });
  });
  it("supports empty datasets", async () => {
    db.profile.mockReset().mockResolvedValueOnce(metadata()).mockResolvedValueOnce({ row_count: BigInt(0), column_count: BigInt(0), columns: [] });
    expect(await loadProfileCountEvidence(input)).toMatchObject({ ok: true, profile: { snapshot: { rowCount: 0, columns: [] } } });
  });
  it("preserves closed read failures", async () => {
    db.profile.mockReset().mockResolvedValueOnce(metadata()).mockRejectedValueOnce(new Error("sensitive"));
    expect(await loadProfileCountEvidence(input)).toEqual({ ok: false, code: "CONTEXT_READ_FAILED" });
  });
});
