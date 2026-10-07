import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ upload: vi.fn(), profile: vi.fn(), review: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: db.transaction } }));
import { loadAnalysisReview } from "@/lib/data-hub/analysisExecution/loadAnalysisReview";
const input = { organisationId: "org", uploadId: "upload" };
function review() {
  return { organisation_id: "org", upload_id: "upload", profile_run_id: "profile", revision: 2, review_version: "v1",
    semantic_choices: [{ sourceSchemaColumnId: "amount", role: "MEASURE" }],
    quality_decisions: [{ code: "COLUMN_PARTIALLY_NULL", scope: "COLUMN", sourceSchemaColumnId: "amount", decision: "ACKNOWLEDGE" }] };
}
beforeEach(() => {
  vi.resetAllMocks();
  const normalization = { id: "norm", organisation_id: "org", upload_id: "upload", import_batch_id: "batch",
    source_schema_version_id: "schema", source_schema_worksheet_id: "worksheet",
    worksheet_mapping_profile_version_id: "mapping", status: "SUCCEEDED" };
  db.upload.mockResolvedValue({ id: "upload", organisation_id: "org", import_batch_id: "batch",
    dataset_profile_run_id: "profile", normalization_run_id: "norm" });
  db.profile.mockResolvedValueOnce({ ...normalization, id: "profile", normalization_run_id: "norm",
    profiler_version: "v1", normalization_run: normalization }).mockResolvedValueOnce({ row_count: BigInt(3), column_count: BigInt(1),
    columns: [{ ordinal: 0, source_schema_column_id: "amount", value_kind: "DECIMAL", source_unit: null,
      normalized_unit: null, row_count: BigInt(3), non_null_count: BigInt(2), null_count: BigInt(1), distinct_non_null_count: BigInt(2) }] });
  db.review.mockResolvedValue(review());
  db.transaction.mockImplementation(async (callback) => callback({ upload: { findFirst: db.upload },
    dataHubDatasetProfileRun: { findFirst: db.profile }, dataHubAnalysisReview: { findFirst: db.review } }));
});
describe("D4D5S persisted review read composition (mocked Prisma, real engines)", () => {
  it("reads current scoped latest revision and recomputes readiness in one transaction", async () => {
    expect(await loadAnalysisReview(input)).toMatchObject({ ok: true, revision: 2,
      schema: { context: { datasetProfileRunId: "profile" } }, quality: { snapshot: { state: "READY_WITH_ACKNOWLEDGED_NOTICES" } } });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
    expect(db.review).toHaveBeenCalledWith({ where: { organisation_id: "org", upload_id: "upload", profile_run_id: "profile" },
      orderBy: { revision: "desc" }, select: { organisation_id: true, upload_id: true, profile_run_id: true,
        revision: true, review_version: true, semantic_choices: true, quality_decisions: true } });
  });
  it.each(["organisation_id", "upload_id", "profile_run_id", "review_version", "revision", "payload"])(
    "rejects invalid persisted %s", async (key) => {
      const stored = review();
      if (key === "revision") stored.revision = 0;
      else if (key === "payload") Object.assign(stored.semantic_choices[0], { state: "READY" });
      else Object.assign(stored, { [key]: "wrong" });
      db.review.mockResolvedValue(stored);
      expect(await loadAnalysisReview(input)).toEqual({ ok: false, code: "REVIEW_RECORD_INVALID" });
      expect(db.review).toHaveBeenCalledTimes(1);
    });
  it("rejects a shape-valid role outside real candidates", async () => {
    const stored = review(); stored.semantic_choices[0].role = "IDENTIFIER"; db.review.mockResolvedValue(stored);
    expect(await loadAnalysisReview(input)).toMatchObject({ ok: false, code: "ROLE_NOT_CANDIDATE" });
  });
  it("does not approve incomplete decisions or fall back to an older review", async () => {
    const stored = review(); stored.quality_decisions = []; db.review.mockResolvedValue(stored);
    expect(await loadAnalysisReview(input)).toMatchObject({ ok: false });
    expect(db.review).toHaveBeenCalledTimes(1);
  });
  it("returns missing review explicitly", async () => {
    db.review.mockResolvedValue(null);
    expect(await loadAnalysisReview(input)).toEqual({ ok: false, code: "REVIEW_NOT_FOUND" });
  });
  it("stops before review access on unavailable profile scope", async () => {
    db.upload.mockResolvedValue(null);
    expect(await loadAnalysisReview(input)).toEqual({ ok: false, code: "UPLOAD_NOT_FOUND" });
    expect(db.review).not.toHaveBeenCalled();
  });
  it("rejects invalid scope without database access", async () => {
    expect(await loadAnalysisReview({ ...input, organisationId: " " })).toEqual({ ok: false, code: "CONTEXT_INPUT_INVALID" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("closes database exceptions without disclosing details", async () => {
    db.review.mockRejectedValue(new Error("private"));
    expect(await loadAnalysisReview(input)).toEqual({ ok: false, code: "REVIEW_READ_FAILED" });
  });
});
