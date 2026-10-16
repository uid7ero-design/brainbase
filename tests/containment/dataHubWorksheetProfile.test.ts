import { beforeEach, describe, expect, it, vi } from "vitest";
const seams = vi.hoisted(() => ({ upload: vi.fn(), run: vi.fn(), transaction: vi.fn(), profile: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { upload: { findFirst: seams.upload }, $transaction: seams.transaction } }));
vi.mock("@/lib/data-hub/profileExecution/profileUploadDataset", () => ({ profileUploadDataset: seams.profile }));
vi.mock("@/lib/data-hub/analysisExecution/resolveAnalysisContext", () => ({ resolveAnalysisContextInTransaction: seams.resolve }));
import { getWorksheetProfileStatus, profileWorksheetForReview, MAX_INTERACTIVE_PROFILE_CELLS } from "@/lib/data-hub/preparation/worksheetProfile";
const scope = { organisationId: "org", uploadId: "upload", actorId: "actor" };
const tx = { upload: { findFirst: seams.upload }, dataHubDatasetProfileRun: { findFirst: seams.run } };
beforeEach(() => {
  vi.resetAllMocks(); seams.transaction.mockImplementation(action => action(tx));
  seams.upload.mockResolvedValue({ normalization_run_id: "normalization", dataset_profile_run_id: null, normalized_cell_count: 12 });
  seams.run.mockResolvedValue(null);
  seams.resolve.mockResolvedValue({ ok: true, context: { datasetProfileRunId: "profile" } });
});
describe("read-only profile readiness", () => {
  it("hides foreign and missing worksheets", async () => {
    seams.upload.mockResolvedValue(null);
    expect(await getWorksheetProfileStatus(scope)).toEqual({ ok: false, code: "UPLOAD_NOT_FOUND" });
    expect(seams.upload).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "upload", organisation_id: "org", lineage_kind: "DATA_HUB" } }));
    expect(seams.run).not.toHaveBeenCalled(); expect(seams.profile).not.toHaveBeenCalled();
  });
  it("reports incomplete normalization without reading profile history", async () => {
    seams.upload.mockResolvedValue({ normalization_run_id: null, dataset_profile_run_id: null });
    expect(await getWorksheetProfileStatus(scope)).toEqual({ ok: true, status: "NOT_READY" }); expect(seams.run).not.toHaveBeenCalled();
  });
  it.each([null, "RUNNING", "FAILED", "ABANDONED"])("projects %s without private details", async status => {
    seams.run.mockResolvedValue(status ? { status, failure_detail: "secret", execution_token: "secret" } : null);
    expect(await getWorksheetProfileStatus(scope)).toEqual({ ok: true, status: status ?? "NOT_STARTED" });
    expect(seams.run).toHaveBeenCalledWith(expect.objectContaining({ where: { organisation_id: "org", upload_id: "upload", normalization_run_id: "normalization" } }));
  });
  it("rejects a successful historical run without its authoritative pointer", async () => {
    seams.run.mockResolvedValue({ status: "SUCCEEDED" });
    expect(await getWorksheetProfileStatus(scope)).toEqual({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" });
  });
  it("validates completed lineage in the same read transaction and preserves zero", async () => {
    seams.upload.mockResolvedValue({ normalization_run_id: "normalization", dataset_profile_run_id: "profile" });
    seams.run.mockResolvedValue({ row_count: BigInt(0), column_count: BigInt(4) });
    expect(await getWorksheetProfileStatus(scope)).toEqual({ ok: true, status: "SUCCEEDED", rowCount: 0, columnCount: 4 });
    expect(seams.resolve).toHaveBeenCalledWith(scope, tx);
    expect(seams.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 5_000 });
  });
  it.each([null, BigInt(-1), BigInt("9007199254740992")])("does not label invalid completed counts ready: %s", async row_count => {
    seams.upload.mockResolvedValue({ normalization_run_id: "n", dataset_profile_run_id: "p" }); seams.run.mockResolvedValue({ row_count, column_count: BigInt(4) });
    expect(await getWorksheetProfileStatus(scope)).toEqual({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" });
  });
  it("retains the existing authoritative lineage refusal", async () => {
    seams.upload.mockResolvedValue({ normalization_run_id: "n", dataset_profile_run_id: "p" });
    seams.resolve.mockResolvedValue({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" });
    expect(await getWorksheetProfileStatus(scope)).toEqual({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" }); expect(seams.run).not.toHaveBeenCalled();
  });
});
describe("interactive profiling wrapper", () => {
  it("denies foreign or missing scope before starting the profiler", async () => {
    seams.upload.mockResolvedValue(null);
    expect(await profileWorksheetForReview(scope)).toEqual({ ok: false, code: "UPLOAD_NOT_FOUND" }); expect(seams.profile).not.toHaveBeenCalled();
  });
  it("bounds new interactive profiling before evidence is read", async () => {
    seams.upload.mockResolvedValue({ normalized_cell_count: MAX_INTERACTIVE_PROFILE_CELLS + 1, dataset_profile_run_id: null });
    expect(await profileWorksheetForReview(scope)).toEqual({ ok: false, code: "INTERACTIVE_PROFILE_LIMIT" }); expect(seams.profile).not.toHaveBeenCalled();
  });
  it("returns an existing in-progress attempt without leaking identifiers", async () => {
    seams.profile.mockResolvedValue({ ok: true, status: "RUNNING", profilerVersion: "v1", profileRunId: "private", normalizationRunId: "private" });
    expect(await profileWorksheetForReview(scope)).toEqual({ ok: true, status: "RUNNING" }); expect(seams.profile).toHaveBeenCalledWith(scope);
  });
  it("checks the completed pointer instead of trusting the execution response alone", async () => {
    seams.profile.mockResolvedValue({ ok: true, status: "SUCCEEDED", profilerVersion: "v1", rowCount: 3, columnCount: 4 });
    seams.upload.mockResolvedValueOnce({ normalized_cell_count: 12, dataset_profile_run_id: null })
      .mockResolvedValueOnce({ normalization_run_id: "n", dataset_profile_run_id: "p" });
    seams.run.mockResolvedValue({ row_count: BigInt(3), column_count: BigInt(4) });
    expect(await profileWorksheetForReview(scope)).toEqual({ ok: true, status: "SUCCEEDED", rowCount: 3, columnCount: 4 }); expect(seams.resolve).toHaveBeenCalled();
  });
  it("can reuse a completed profile above the new interactive execution limit", async () => {
    seams.upload.mockResolvedValue({ normalized_cell_count: MAX_INTERACTIVE_PROFILE_CELLS + 1, normalization_run_id: "n", dataset_profile_run_id: "p" });
    seams.profile.mockResolvedValue({ ok: true, status: "SUCCEEDED", profilerVersion: "v1", rowCount: 3, columnCount: 4 });
    seams.run.mockResolvedValue({ row_count: BigInt(3), column_count: BigInt(4) });
    expect(await profileWorksheetForReview(scope)).toEqual({ ok: true, status: "SUCCEEDED", rowCount: 3, columnCount: 4 }); expect(seams.profile).toHaveBeenCalledOnce();
  });
});
