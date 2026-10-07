import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ upload: vi.fn(), profile: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: db.transaction } }));
import { resolveAnalysisContext } from "@/lib/data-hub/analysisExecution/resolveAnalysisContext";

function records() {
  const normalization = { id: "norm", organisation_id: "org", upload_id: "upload", import_batch_id: "batch",
    source_schema_version_id: "schema", source_schema_worksheet_id: "worksheet",
    worksheet_mapping_profile_version_id: "mapping", status: "SUCCEEDED" };
  return { upload: { id: "upload", organisation_id: "org", import_batch_id: "batch",
    normalization_run_id: "norm", dataset_profile_run_id: "profile" },
  profile: { ...normalization, id: "profile", normalization_run_id: "norm",
    profiler_version: "v1", normalization_run: normalization } };
}
const input = { organisationId: "org", uploadId: "upload" };

beforeEach(() => {
  vi.resetAllMocks(); const data = records();
  db.upload.mockResolvedValue(data.upload); db.profile.mockResolvedValue(data.profile);
  db.transaction.mockImplementation(async (callback) => callback({ upload: { findFirst: db.upload },
    dataHubDatasetProfileRun: { findFirst: db.profile } }));
});

describe("D4D5J authoritative analysis context resolver (mocked reads)", () => {
  it("derives all identities from the upload's pinned successful runs", async () => {
    expect(await resolveAnalysisContext(input)).toEqual({ ok: true, context: {
      organisationId: "org", uploadId: "upload", importBatchId: "batch", normalizationRunId: "norm",
      datasetProfileRunId: "profile", sourceSchemaVersionId: "schema", sourceSchemaWorksheetId: "worksheet",
      worksheetMappingProfileVersionId: "mapping" } });
    expect(db.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
    expect(db.upload.mock.calls[0][0].where).toEqual({ id: "upload", organisation_id: "org", lineage_kind: "DATA_HUB" });
    expect(db.profile.mock.calls[0][0].where).toEqual({ id: "profile", organisation_id: "org", upload_id: "upload" });
  });
  it("does not accept a caller-supplied profile pointer", async () => {
    await resolveAnalysisContext({ ...input, datasetProfileRunId: "attacker" } as typeof input);
    expect(db.profile.mock.calls[0][0].where.id).toBe("profile");
  });
  it.each(["organisationId", "uploadId"] as const)("rejects blank %s without DB access", async (key) => {
    expect(await resolveAnalysisContext({ ...input, [key]: " " })).toEqual({ ok: false, code: "CONTEXT_INPUT_INVALID" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("fails closed on a missing or inaccessible upload", async () => {
    db.upload.mockResolvedValue(null);
    expect(await resolveAnalysisContext(input)).toEqual({ ok: false, code: "UPLOAD_NOT_FOUND" });
    expect(db.profile).not.toHaveBeenCalled();
  });
  it.each(["dataset_profile_run_id", "normalization_run_id"] as const)("rejects missing %s", async (key) => {
    db.upload.mockResolvedValue({ ...records().upload, [key]: null });
    expect(await resolveAnalysisContext(input)).toEqual({ ok: false, code: "PROFILE_NOT_COMPLETE" });
  });
  it("rejects a missing scoped profile run", async () => {
    db.profile.mockResolvedValue(null);
    expect(await resolveAnalysisContext(input)).toEqual({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" });
  });
  it.each(["RUNNING", "FAILED", "ABANDONED"])("rejects profile status %s", async (status) => {
    db.profile.mockResolvedValue({ ...records().profile, status });
    expect(await resolveAnalysisContext(input)).toEqual({ ok: false, code: "PROFILE_NOT_COMPLETE" });
  });
  it("rejects a normalization run that did not succeed", async () => {
    const data = records(); data.profile.normalization_run.status = "FAILED";
    db.profile.mockResolvedValue(data.profile);
    expect(await resolveAnalysisContext(input)).toEqual({ ok: false, code: "PROFILE_NOT_COMPLETE" });
  });
  it("rejects unsupported profiler versions", async () => {
    db.profile.mockResolvedValue({ ...records().profile, profiler_version: "v2" });
    expect(await resolveAnalysisContext(input)).toEqual({ ok: false, code: "PROFILER_VERSION_UNSUPPORTED" });
  });
  it.each(["id", "organisation_id", "upload_id", "import_batch_id", "normalization_run_id"])(
    "cross-checks profile %s against upload pointers", async (key) => {
      db.profile.mockResolvedValue({ ...records().profile, [key]: "other" });
      expect(await resolveAnalysisContext(input)).toEqual({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" });
    },
  );
  it.each(["id", "organisation_id", "upload_id", "import_batch_id", "source_schema_version_id",
    "source_schema_worksheet_id", "worksheet_mapping_profile_version_id"])(
    "cross-checks normalization %s against profile lineage", async (key) => {
      const data = records(); db.profile.mockResolvedValue({ ...data.profile,
        normalization_run: { ...data.profile.normalization_run, [key]: "other" } });
      expect(await resolveAnalysisContext(input)).toEqual({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" });
    },
  );
  it("returns a closed failure without leaking DB error text", async () => {
    db.transaction.mockRejectedValue(new Error("sensitive connection details"));
    expect(await resolveAnalysisContext(input)).toEqual({ ok: false, code: "CONTEXT_READ_FAILED" });
  });
  it("selects only identity and status metadata", async () => {
    await resolveAnalysisContext(input);
    const selection = JSON.stringify(db.profile.mock.calls[0][0].select);
    for (const forbidden of ["columns", "numeric_min", "normalized_value", "raw_value"]) {
      expect(selection).not.toContain(forbidden);
    }
  });
});
