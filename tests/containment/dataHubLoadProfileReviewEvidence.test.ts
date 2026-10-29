import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ upload: vi.fn(), profile: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: db.transaction } }));
import { loadProfileReviewEvidence } from "@/lib/data-hub/analysisExecution/loadProfileReviewEvidence";
import { buildAnalysisReviewSnapshots } from "@/lib/data-hub/analysis";

function metadata() {
  const normalization = { id: "norm", organisation_id: "org", upload_id: "upload", import_batch_id: "batch",
    source_schema_version_id: "schema", source_schema_worksheet_id: "worksheet",
    worksheet_mapping_profile_version_id: "mapping", status: "SUCCEEDED" };
  return { ...normalization, id: "profile", normalization_run_id: "norm", profiler_version: "v1", normalization_run: normalization };
}
function evidence() {
  return { row_count: BigInt(3), column_count: BigInt(1), columns: [{ ordinal: 0, source_schema_column_id: "amount",
    value_kind: "DECIMAL", source_unit: null as string | null, normalized_unit: null as string | null,
    row_count: BigInt(3), non_null_count: BigInt(2), null_count: BigInt(1), distinct_non_null_count: BigInt(2) }] };
}
const input = { organisationId: "org", uploadId: "upload" };
beforeEach(() => {
  vi.resetAllMocks(); db.upload.mockResolvedValue({ id: "upload", organisation_id: "org", import_batch_id: "batch",
    dataset_profile_run_id: "profile", normalization_run_id: "norm" });
  db.profile.mockResolvedValueOnce(metadata()).mockResolvedValueOnce(evidence());
  db.transaction.mockImplementation(async (callback) => callback({ upload: { findFirst: db.upload },
    dataHubDatasetProfileRun: { findFirst: db.profile } }));
});

describe("D4D5P structural review evidence loader (mocked Prisma)", () => {
  it("loads pinned structural evidence in one consistent transaction", async () => {
    expect(await loadProfileReviewEvidence(input)).toMatchObject({ ok: true, profile: {
      context: { datasetProfileRunId: "profile" }, snapshot: { columns: [{ valueKind: "DECIMAL", distinctNonNullCount: 2,
        isSparse: true, isComplete: false, isConstant: false, isAllNull: false, isUniqueAmongNonNull: true }] } } });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
    expect(db.profile.mock.calls[1][0].where).toEqual({ id: "profile", organisation_id: "org", upload_id: "upload",
      status: "SUCCEEDED", profiler_version: "v1" });
    expect(db.profile.mock.calls[1][0].select).toEqual({ row_count: true, column_count: true,
      columns: { where: { organisation_id: "org" }, orderBy: { ordinal: "asc" }, select: {
        ordinal: true, source_schema_column_id: true, value_kind: true, source_unit: true, normalized_unit: true,
        row_count: true, non_null_count: true, null_count: true, distinct_non_null_count: true } } });
  });
  it("feeds real inference and quality resolution without full value statistics", async () => {
    const loaded = await loadProfileReviewEvidence(input); if (!loaded.ok) throw new Error(loaded.code);
    const context = loaded.profile.context;
    expect(buildAnalysisReviewSnapshots(context, loaded.profile,
      { context, snapshot: [{ sourceSchemaColumnId: "amount", role: "MEASURE" }] },
      { context, snapshot: [{ code: "COLUMN_PARTIALLY_NULL", scope: "COLUMN", sourceSchemaColumnId: "amount",
        decision: "ACKNOWLEDGE" }] })).toMatchObject({ ok: true, quality: { snapshot: { state: "READY_WITH_ACKNOWLEDGED_NOTICES" } } });
  });
  it.each(["allNull", "constant", "empty"])("derives structural flags for %s evidence", async (kind) => {
    const data = evidence(), column = data.columns[0];
    if (kind === "allNull") { column.non_null_count = BigInt(0); column.null_count = BigInt(3); column.distinct_non_null_count = BigInt(0); }
    if (kind === "constant") column.distinct_non_null_count = BigInt(1);
    if (kind === "empty") { data.row_count = column.row_count = column.non_null_count = column.null_count = column.distinct_non_null_count = BigInt(0); }
    db.profile.mockReset().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(data);
    const loaded = await loadProfileReviewEvidence(input); if (!loaded.ok) throw new Error(loaded.code);
    expect(loaded.profile.snapshot.columns[0]).toMatchObject({ isAllNull: kind === "allNull",
      isConstant: kind === "constant", isComplete: kind === "empty", isUniqueAmongNonNull: false });
  });
  it.each(["ordinal", "kind", "unit", "distinctTooLarge", "distinctZero", "negative", "unsafe", "sum", "duplicate"])(
    "rejects invalid structural evidence: %s", async (kind) => {
      const data = evidence(), column = data.columns[0];
      if (kind === "ordinal") column.ordinal = 1;
      if (kind === "kind") column.value_kind = "SQL";
      if (kind === "unit") column.source_unit = "invented";
      if (kind === "distinctTooLarge") column.distinct_non_null_count = BigInt(3);
      if (kind === "distinctZero") column.distinct_non_null_count = BigInt(0);
      if (kind === "negative") column.non_null_count = BigInt(-1);
      if (kind === "unsafe") column.row_count = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1);
      if (kind === "sum") column.null_count = BigInt(0);
      if (kind === "duplicate") { data.columns.push({ ...column, ordinal: 1 }); data.column_count = BigInt(2); }
      db.profile.mockReset().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(data);
      expect(await loadProfileReviewEvidence(input)).toEqual({ ok: false, code: "PROFILE_EVIDENCE_INVALID" });
    });
  it("does not load evidence when upload is unavailable", async () => {
    db.upload.mockResolvedValue(null);
    expect(await loadProfileReviewEvidence(input)).toEqual({ ok: false, code: "UPLOAD_NOT_FOUND" });
    expect(db.profile).not.toHaveBeenCalled();
  });
  it("rejects invalid scope before opening a transaction", async () => {
    expect(await loadProfileReviewEvidence({ ...input, organisationId: " " })).toEqual({ ok: false, code: "CONTEXT_INPUT_INVALID" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("closes missing or failed evidence reads", async () => {
    db.profile.mockReset().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(null);
    expect(await loadProfileReviewEvidence(input)).toEqual({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" });
    db.transaction.mockRejectedValue(new Error("private"));
    expect(await loadProfileReviewEvidence(input)).toEqual({ ok: false, code: "CONTEXT_READ_FAILED" });
  });
});
