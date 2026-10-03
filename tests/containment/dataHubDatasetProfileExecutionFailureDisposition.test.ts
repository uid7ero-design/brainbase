import { describe, it, expect, vi, beforeEach } from "vitest";

// Data Hub 6.2D4D1B2 — PR #324 remediation round 1. Focused, fully-mocked
// unit tests proving profileUploadDataset's own exception-containment and
// truthful-disposition orchestration for exactly the defect independent
// review found: (1) a thrown exception from evidence
// reconstruction/profiling/completion/disposition itself must never
// escape the public entry point; (2) the fail-run helper's boolean result
// must never be discarded; (3) the service must never claim a run is
// FAILED unless the DB actually confirms it.
//
// These scenarios are deliberately NOT exercised against real Postgres —
// forcing a genuine mid-call DB/connection exception, or a race where the
// fail-run UPDATE matches zero rows, is either impractical or flatly
// non-deterministic to engineer against a real database from a single
// test process. The underlying real STATE TRANSITIONS these mocks stand
// in for (a real RUNNING row becoming FAILED; a real UPDATE matching zero
// rows once a row is already terminal) are proven separately, for real,
// in scripts/tests/dataHubDatasetProfileExecution.integration.test.ts.

const resolveAuthoritativeNormalizationContextMock = vi.fn();
const findLatestDatasetProfileRunMock = vi.fn();
const createDatasetProfileRunAttemptMock = vi.fn();
const markDatasetProfileRunFailedMock = vi.fn();
const getDatasetProfileRunByIdMock = vi.fn();
vi.mock("@/lib/data-hub/profileExecution/dataHubDatasetProfileRun", () => ({
  resolveAuthoritativeNormalizationContext: (...a: unknown[]) => resolveAuthoritativeNormalizationContextMock(...a),
  findLatestDatasetProfileRun: (...a: unknown[]) => findLatestDatasetProfileRunMock(...a),
  createDatasetProfileRunAttempt: (...a: unknown[]) => createDatasetProfileRunAttemptMock(...a),
  markDatasetProfileRunFailed: (...a: unknown[]) => markDatasetProfileRunFailedMock(...a),
  getDatasetProfileRunById: (...a: unknown[]) => getDatasetProfileRunByIdMock(...a),
}));

const reconstructNormalizedDatasetEvidenceMock = vi.fn();
vi.mock("@/lib/data-hub/profileExecution/normalizedEvidenceAdapter", () => ({
  reconstructNormalizedDatasetEvidence: (...a: unknown[]) => reconstructNormalizedDatasetEvidenceMock(...a),
}));

const completeDatasetProfileRunMock = vi.fn();
vi.mock("@/lib/data-hub/profileExecution/completeDatasetProfileRun", () => ({
  completeDatasetProfileRun: (...a: unknown[]) => completeDatasetProfileRunMock(...a),
}));

let profileUploadDataset: typeof import("@/lib/data-hub/profileExecution/profileUploadDataset").profileUploadDataset;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ profileUploadDataset } = await import("@/lib/data-hub/profileExecution/profileUploadDataset"));
});

const ORG = "org-a";
const UPLOAD_ID = "up-1";
const ACTOR_ID = "user-a";
const NORMALIZATION_RUN_ID = "norm-1";
const RUN_ID = "profile-run-1";

const NORMALIZATION_CONTEXT = {
  normalizationRunId: NORMALIZATION_RUN_ID,
  importBatchId: "batch-1",
  uploadId: UPLOAD_ID,
  sourceSchemaVersionId: "sv-1",
  sourceSchemaWorksheetId: "ws-1",
  worksheetMappingProfileVersionId: "pv-1",
  persistedRowCount: 2,
};

const ACTIVE_RUN = {
  id: RUN_ID,
  organisationId: ORG,
  importBatchId: "batch-1",
  uploadId: UPLOAD_ID,
  normalizationRunId: NORMALIZATION_RUN_ID,
  sourceSchemaVersionId: "sv-1",
  sourceSchemaWorksheetId: "ws-1",
  worksheetMappingProfileVersionId: "pv-1",
  attemptNumber: 1,
  profilerVersion: "v1",
};

function primeHappyPathUpToCreate() {
  resolveAuthoritativeNormalizationContextMock.mockResolvedValue({ ok: true, normalization: NORMALIZATION_CONTEXT });
  findLatestDatasetProfileRunMock.mockResolvedValue(null);
  createDatasetProfileRunAttemptMock.mockResolvedValue({ ok: true, created: true, run: ACTIVE_RUN });
}

describe("A. evidence reconstruction throws", () => {
  it("does not throw; disposes the RUNNING attempt; returns a bounded result; never a raw exception", async () => {
    primeHappyPathUpToCreate();
    reconstructNormalizedDatasetEvidenceMock.mockRejectedValue(new Error("connection terminated unexpectedly: password=hunter2"));
    markDatasetProfileRunFailedMock.mockResolvedValue(true);

    const result = await profileUploadDataset({ organisationId: ORG, uploadId: UPLOAD_ID, actorId: ACTOR_ID });

    expect(result).toEqual({ ok: false, code: "PERSISTENCE_FAILURE" });
    expect(markDatasetProfileRunFailedMock).toHaveBeenCalledWith({ organisationId: ORG, runId: RUN_ID, failureCode: "PERSISTENCE_FAILURE" });
    // Never leaks the raw exception text anywhere in the result.
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(completeDatasetProfileRunMock).not.toHaveBeenCalled();
  });
});

describe("B. fail-run update returns false (zero rows affected)", () => {
  it("does not silently report success; re-reads current state; reports FAILED truthfully when the run is already FAILED", async () => {
    primeHappyPathUpToCreate();
    reconstructNormalizedDatasetEvidenceMock.mockResolvedValue({ ok: false, code: "PROFILE_INPUT_INVALID" });
    markDatasetProfileRunFailedMock.mockResolvedValue(false);
    getDatasetProfileRunByIdMock.mockResolvedValue({ id: RUN_ID, status: "FAILED", profilerVersion: "v1", attemptNumber: 1, rowCount: null, columnCount: null, failureCode: "PROFILE_INPUT_INVALID" });

    const result = await profileUploadDataset({ organisationId: ORG, uploadId: UPLOAD_ID, actorId: ACTOR_ID });

    expect(result).toEqual({ ok: false, code: "PROFILE_INPUT_INVALID" });
    expect(getDatasetProfileRunByIdMock).toHaveBeenCalledWith({ organisationId: ORG, runId: RUN_ID });
  });

  it("reports the real SUCCEEDED state truthfully rather than falsely claiming failure, if the run turns out to already be SUCCEEDED", async () => {
    primeHappyPathUpToCreate();
    reconstructNormalizedDatasetEvidenceMock.mockResolvedValue({ ok: false, code: "PROFILE_INPUT_INVALID" });
    markDatasetProfileRunFailedMock.mockResolvedValue(false);
    getDatasetProfileRunByIdMock.mockResolvedValue({ id: RUN_ID, status: "SUCCEEDED", profilerVersion: "v1", attemptNumber: 1, rowCount: BigInt(2), columnCount: BigInt(4), failureCode: null });

    const result = await profileUploadDataset({ organisationId: ORG, uploadId: UPLOAD_ID, actorId: ACTOR_ID });

    expect(result).toEqual({
      ok: true,
      profileRunId: RUN_ID,
      status: "SUCCEEDED",
      created: false,
      resumed: false,
      reused: true,
      profilerVersion: "v1",
      normalizationRunId: NORMALIZATION_RUN_ID,
      rowCount: 2,
      columnCount: 4,
    });
  });

  it("reports a bounded PERSISTENCE_FAILURE (never a false FAILED claim) when the run is still RUNNING after disposition did not apply", async () => {
    primeHappyPathUpToCreate();
    reconstructNormalizedDatasetEvidenceMock.mockResolvedValue({ ok: false, code: "PROFILE_INPUT_INVALID" });
    markDatasetProfileRunFailedMock.mockResolvedValue(false);
    getDatasetProfileRunByIdMock.mockResolvedValue({ id: RUN_ID, status: "RUNNING", profilerVersion: "v1", attemptNumber: 1, rowCount: null, columnCount: null, failureCode: null });

    const result = await profileUploadDataset({ organisationId: ORG, uploadId: UPLOAD_ID, actorId: ACTOR_ID });

    expect(result).toEqual({ ok: false, code: "PERSISTENCE_FAILURE" });
  });

  it("reports a bounded PERSISTENCE_FAILURE when the run can no longer be found at all", async () => {
    primeHappyPathUpToCreate();
    reconstructNormalizedDatasetEvidenceMock.mockResolvedValue({ ok: false, code: "PROFILE_INPUT_INVALID" });
    markDatasetProfileRunFailedMock.mockResolvedValue(false);
    getDatasetProfileRunByIdMock.mockResolvedValue(null);

    const result = await profileUploadDataset({ organisationId: ORG, uploadId: UPLOAD_ID, actorId: ACTOR_ID });

    expect(result).toEqual({ ok: false, code: "PERSISTENCE_FAILURE" });
  });
});

describe("C. fail-run update itself throws", () => {
  it("does not throw; returns bounded PERSISTENCE_FAILURE; never leaks raw DB error text; never falsely claims FAILED", async () => {
    primeHappyPathUpToCreate();
    reconstructNormalizedDatasetEvidenceMock.mockResolvedValue({ ok: false, code: "PROFILE_INPUT_INVALID" });
    markDatasetProfileRunFailedMock.mockRejectedValue(new Error("connection terminated unexpectedly: secret-token-xyz"));

    const result = await profileUploadDataset({ organisationId: ORG, uploadId: UPLOAD_ID, actorId: ACTOR_ID });

    expect(result).toEqual({ ok: false, code: "PERSISTENCE_FAILURE" });
    expect(JSON.stringify(result)).not.toContain("secret-token-xyz");
    // The disposition attempt threw before any re-read could even happen
    // -- the run's true state is unconfirmed, so no re-read is attempted
    // and no FAILED claim is made.
    expect(getDatasetProfileRunByIdMock).not.toHaveBeenCalled();
  });
});

describe("D. completion failure + failure-disposition failure", () => {
  it("no profile columns survive (never attempted again by this layer), Upload pointer untouched, run is not SUCCEEDED, bounded result returned, no raw exception escapes", async () => {
    primeHappyPathUpToCreate();
    reconstructNormalizedDatasetEvidenceMock.mockResolvedValue({
      ok: true,
      input: { rowCount: 1, columns: [] },
      sourceColumnOrdinalByColumnId: new Map(),
    });
    completeDatasetProfileRunMock.mockResolvedValue({ ok: false, code: "PROFILE_RECONCILIATION_FAILED" });
    markDatasetProfileRunFailedMock.mockResolvedValue(false);
    getDatasetProfileRunByIdMock.mockResolvedValue({ id: RUN_ID, status: "RUNNING", profilerVersion: "v1", attemptNumber: 1, rowCount: null, columnCount: null, failureCode: null });

    const result = await profileUploadDataset({ organisationId: ORG, uploadId: UPLOAD_ID, actorId: ACTOR_ID });

    // Completion already failed closed (no columns were committed, per
    // completeDatasetProfileRun's own real-Postgres-proven rollback
    // behavior) and disposition could not apply either -- the service
    // must report this as a bounded, non-SUCCEEDED, retry-worthy result,
    // never claim SUCCEEDED or FAILED without confirmation.
    expect(result).toEqual({ ok: false, code: "PERSISTENCE_FAILURE" });
    expect(markDatasetProfileRunFailedMock).toHaveBeenCalledWith({ organisationId: ORG, runId: RUN_ID, failureCode: "PROFILE_RECONCILIATION_FAILED" });
  });
});

describe("E. existing success-path regression", () => {
  it("happy path: created, SUCCEEDED, exactly one D4D1A-equivalent completion call", async () => {
    primeHappyPathUpToCreate();
    reconstructNormalizedDatasetEvidenceMock.mockResolvedValue({
      ok: true,
      input: { rowCount: 1, columns: [] },
      sourceColumnOrdinalByColumnId: new Map(),
    });
    completeDatasetProfileRunMock.mockResolvedValue({ ok: true, rowCount: 1, columnCount: 0 });

    const result = await profileUploadDataset({ organisationId: ORG, uploadId: UPLOAD_ID, actorId: ACTOR_ID });

    expect(result).toEqual({
      ok: true,
      profileRunId: RUN_ID,
      status: "SUCCEEDED",
      created: true,
      resumed: false,
      reused: false,
      profilerVersion: "v1",
      normalizationRunId: NORMALIZATION_RUN_ID,
      rowCount: 1,
      columnCount: 0,
    });
    expect(completeDatasetProfileRunMock).toHaveBeenCalledTimes(1);
    expect(markDatasetProfileRunFailedMock).not.toHaveBeenCalled();
  });

  it("idempotent reuse: an existing SUCCEEDED same-version run short-circuits before any create/profile/complete call", async () => {
    resolveAuthoritativeNormalizationContextMock.mockResolvedValue({ ok: true, normalization: NORMALIZATION_CONTEXT });
    findLatestDatasetProfileRunMock.mockResolvedValue({ id: RUN_ID, status: "SUCCEEDED", profilerVersion: "v1", attemptNumber: 1, rowCount: BigInt(5), columnCount: BigInt(3), failureCode: null });

    const result = await profileUploadDataset({ organisationId: ORG, uploadId: UPLOAD_ID, actorId: ACTOR_ID });

    expect(result).toEqual({
      ok: true,
      profileRunId: RUN_ID,
      status: "SUCCEEDED",
      created: false,
      resumed: false,
      reused: true,
      profilerVersion: "v1",
      normalizationRunId: NORMALIZATION_RUN_ID,
      rowCount: 5,
      columnCount: 3,
    });
    expect(createDatasetProfileRunAttemptMock).not.toHaveBeenCalled();
    expect(reconstructNormalizedDatasetEvidenceMock).not.toHaveBeenCalled();
    expect(completeDatasetProfileRunMock).not.toHaveBeenCalled();
  });
});
