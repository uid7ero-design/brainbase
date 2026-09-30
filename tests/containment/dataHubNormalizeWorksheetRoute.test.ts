import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Data Hub 6.2D4B2B — thin manager+ normalization route, static/unit
// containment. Mocks the auth seam (@/lib/org), the Upload existence
// pre-check (@/lib/prisma), and the three B2B2A executor functions this
// route consumes unchanged -- never a duplicated fake route
// implementation, always the real, unmodified exported POST/GET. Real
// disposable-Postgres route proof (concurrency, real B1/B2B1 DB functions)
// lives in scripts/tests/dataHubNormalizeWorksheetRoute.integration.test.ts.

const requireRoleMock = vi.fn();
vi.mock("@/lib/org", () => ({ requireRole: (...a: unknown[]) => requireRoleMock(...a) }));

const uploadFindFirstMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { upload: { findFirst: (...a: unknown[]) => uploadFindFirstMock(...a) } },
}));

const createOrResumeMock = vi.fn();
vi.mock("@/lib/data-hub/normalizationExecution/dataHubNormalizationRun", () => ({
  createOrResumeNormalizationRun: (...a: unknown[]) => createOrResumeMock(...a),
}));

const normalizeBatchesMock = vi.fn();
vi.mock("@/lib/data-hub/normalizationExecution/normalizeWorksheetRows", () => ({
  normalizeBatches: (...a: unknown[]) => normalizeBatchesMock(...a),
}));

const completeNormalizationRunMock = vi.fn();
vi.mock("@/lib/data-hub/normalizationExecution/completeNormalizationRun", () => ({
  completeNormalizationRun: (...a: unknown[]) => completeNormalizationRunMock(...a),
}));

const statusMock = vi.fn();
vi.mock("@/lib/data-hub/normalizationExecution/dataHubNormalizationRunStatus", () => ({
  dataHubNormalizationRunStatus: (...a: unknown[]) => statusMock(...a),
}));

vi.mock("@/lib/data-hub/staging/stagingConfig", () => ({
  resolveMaxDurationMs: () => 8000,
  resolveLeaseSeconds: () => 120,
  resolveTargetCellsPerBatch: () => 8000,
}));

let POST: typeof import("@/app/api/data-hub/worksheets/[id]/normalize/route").POST;
let GET: typeof import("@/app/api/data-hub/worksheets/[id]/normalize/route").GET;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ POST, GET } = await import("@/app/api/data-hub/worksheets/[id]/normalize/route"));
});

const ORG = "org-a";
const USER = "user-a";
const UPLOAD_ID = "up-1";

function asManagerSession() {
  requireRoleMock.mockResolvedValue({ organisationId: ORG, userId: USER, homeOrganisationId: ORG, role: "manager", name: "Manager" });
}

function postRequest() {
  return { req: new NextRequest(`http://localhost/api/data-hub/worksheets/${UPLOAD_ID}/normalize`, { method: "POST" }), params: Promise.resolve({ id: UPLOAD_ID }) };
}
function getRequest() {
  return { req: new NextRequest(`http://localhost/api/data-hub/worksheets/${UPLOAD_ID}/normalize`, { method: "GET" }), params: Promise.resolve({ id: UPLOAD_ID }) };
}

const ACTIVE_RUN = {
  id: "run-1",
  organisationId: ORG,
  importBatchId: "batch-1",
  uploadId: UPLOAD_ID,
  rawStagingRunId: "rawrun-1",
  sourceSchemaVersionId: "sv-1",
  sourceSchemaWorksheetId: "ws-1",
  worksheetMappingProfileId: "wp-1",
  worksheetMappingProfileVersionId: "pv-1",
  normalizerVersion: "v1",
  executionToken: "TOKEN-SECRET-abc123",
  expectedRowCount: 10,
  expectedCellCount: 20,
  persistedRowCount: 0,
  persistedCellCount: 0,
  plan: { rulesByColumnId: new Map() },
};

async function bodyOf(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════

describe("auth", () => {
  it("unauthenticated -> 401, no downstream call made", async () => {
    requireRoleMock.mockRejectedValue(new Error("Unauthorized"));
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    expect(createOrResumeMock).not.toHaveBeenCalled();
  });

  it("below manager -> 403, no downstream call made", async () => {
    requireRoleMock.mockRejectedValue(new Error("Forbidden"));
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(403);
    expect(createOrResumeMock).not.toHaveBeenCalled();
  });

  it("manager allowed -- request proceeds to the Upload existence check", async () => {
    asManagerSession();
    uploadFindFirstMock.mockResolvedValue(null);
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(404); // proceeded past auth, hit the (mocked) not-found upload
    expect(requireRoleMock).toHaveBeenCalledWith("manager");
  });

  it("session organisation is authoritative -- createOrResumeNormalizationRun is called with session.organisationId, never a client-supplied value", async () => {
    asManagerSession();
    uploadFindFirstMock.mockResolvedValue({ id: UPLOAD_ID });
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: true });
    const { req, params } = postRequest();
    await POST(req, { params });
    expect(createOrResumeMock).toHaveBeenCalledWith({ organisationId: ORG, uploadId: UPLOAD_ID, actorUserId: USER });
  });

  it("path id is the only client-selected executor input -- no request body is ever read", async () => {
    asManagerSession();
    uploadFindFirstMock.mockResolvedValue({ id: UPLOAD_ID });
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: true });
    const req = new NextRequest(`http://localhost/api/data-hub/worksheets/${UPLOAD_ID}/normalize`, {
      method: "POST",
      body: JSON.stringify({ organisationId: "attacker-org", actorUserId: "attacker-user", runId: "some-run", executionToken: "stolen" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: UPLOAD_ID }) });
    expect(res.status).toBe(200);
    expect(createOrResumeMock).toHaveBeenCalledWith({ organisationId: ORG, uploadId: UPLOAD_ID, actorUserId: USER });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POST
// ═══════════════════════════════════════════════════════════════════════

describe("POST", () => {
  beforeEach(() => {
    asManagerSession();
    uploadFindFirstMock.mockResolvedValue({ id: UPLOAD_ID });
  });

  it("already normalized -> 200 SUCCEEDED, alreadyNormalized:true, no batch/completion call", async () => {
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: true });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body).toEqual({ ok: true, status: "SUCCEEDED", alreadyNormalized: true });
    expect(normalizeBatchesMock).not.toHaveBeenCalled();
    expect(completeNormalizationRunMock).not.toHaveBeenCalled();
  });

  it("new run, exhausted -> completion called -> 200 SUCCEEDED", async () => {
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: false, run: ACTIVE_RUN });
    normalizeBatchesMock.mockResolvedValue({ ok: true, exhausted: true, persistedRowCount: 10, persistedCellCount: 20 });
    completeNormalizationRunMock.mockResolvedValue({ ok: true, rowCount: 10, cellCount: 20 });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body).toEqual({ ok: true, status: "SUCCEEDED", rowCount: 10, cellCount: 20 });
    expect(completeNormalizationRunMock).toHaveBeenCalledWith({ organisationId: ORG, runId: ACTIVE_RUN.id, executionToken: ACTIVE_RUN.executionToken, completedByUserId: USER });
  });

  it("continuation -> 202 RUNNING, completion never called", async () => {
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: false, run: ACTIVE_RUN });
    normalizeBatchesMock.mockResolvedValue({ ok: true, exhausted: false, persistedRowCount: 3, persistedCellCount: 6 });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(202);
    const body = await bodyOf(res);
    expect(body).toEqual({ ok: true, status: "RUNNING", persistedRowCount: 3, persistedCellCount: 6 });
    expect(completeNormalizationRunMock).not.toHaveBeenCalled();
  });

  it("RUN_ALREADY_IN_PROGRESS -> 409 CONFLICT", async () => {
    createOrResumeMock.mockResolvedValue({ ok: false, code: "RUN_ALREADY_IN_PROGRESS" });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(409);
    const body = await bodyOf(res);
    expect(body.status).toBe("CONFLICT");
    expect(body.code).toBe("RUN_ALREADY_IN_PROGRESS");
  });

  it("LEASE_LOST from create/resume -> 409 CONFLICT", async () => {
    createOrResumeMock.mockResolvedValue({ ok: false, code: "LEASE_LOST" });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).status).toBe("CONFLICT");
  });

  it("PERSISTENCE_FAILURE from create/resume -> 503 RETRYABLE", async () => {
    createOrResumeMock.mockResolvedValue({ ok: false, code: "PERSISTENCE_FAILURE" });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(503);
    expect((await bodyOf(res)).status).toBe("RETRYABLE");
  });

  it("raw staging incomplete -> 409 NOT_READY", async () => {
    createOrResumeMock.mockResolvedValue({ ok: false, code: "RAW_STAGING_NOT_COMPLETE" });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).status).toBe("NOT_READY");
  });

  it("raw run not SUCCEEDED -> 409 NOT_READY (same stable choice as RAW_STAGING_NOT_COMPLETE)", async () => {
    createOrResumeMock.mockResolvedValue({ ok: false, code: "RAW_RUN_NOT_SUCCEEDED" });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).status).toBe("NOT_READY");
  });

  it.each(["NORMALIZATION_INELIGIBLE", "PROFILE_DOCUMENT_INVALID", "NORMALIZATION_PLAN_INVALID", "NORMALIZER_VERSION_UNSUPPORTED"])(
    "%s -> 409 INELIGIBLE",
    async (code) => {
      createOrResumeMock.mockResolvedValue({ ok: false, code });
      const { req, params } = postRequest();
      const res = await POST(req, { params });
      expect(res.status).toBe(409);
      expect((await bodyOf(res)).status).toBe("INELIGIBLE");
    }
  );

  it("INVALID_STATE from create/resume -> bounded 500, code collapsed to INVALID_STATE", async () => {
    createOrResumeMock.mockResolvedValue({ ok: false, code: "INVALID_STATE" });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(500);
    const body = await bodyOf(res);
    expect(body.code).toBe("INVALID_STATE");
  });

  it("blocking -> 422 FAILED, code NORMALIZATION_BLOCKED, no findings/raw content in body", async () => {
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: false, run: ACTIVE_RUN });
    normalizeBatchesMock.mockResolvedValue({ ok: false, code: "NORMALIZATION_BLOCKED", exhausted: false, persistedRowCount: 1, persistedCellCount: 2 });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(422);
    const body = await bodyOf(res);
    expect(body).toEqual({ ok: false, status: "FAILED", code: "NORMALIZATION_BLOCKED", error: expect.any(String) });
    expect(JSON.stringify(body)).not.toMatch(/finding|rawValue|raw_value/i);
    expect(completeNormalizationRunMock).not.toHaveBeenCalled();
  });

  it("LEASE_LOST from normalizeBatches -> 409 CONFLICT", async () => {
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: false, run: ACTIVE_RUN });
    normalizeBatchesMock.mockResolvedValue({ ok: false, code: "LEASE_LOST", exhausted: false, persistedRowCount: 0, persistedCellCount: 0 });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).status).toBe("CONFLICT");
  });

  it("PERSISTENCE_FAILURE from normalizeBatches -> 503 RETRYABLE", async () => {
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: false, run: ACTIVE_RUN });
    normalizeBatchesMock.mockResolvedValue({ ok: false, code: "PERSISTENCE_FAILURE", exhausted: false, persistedRowCount: 0, persistedCellCount: 0 });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(503);
    expect((await bodyOf(res)).status).toBe("RETRYABLE");
  });

  it("completion rejected -> stable non-leaking 409 response", async () => {
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: false, run: ACTIVE_RUN });
    normalizeBatchesMock.mockResolvedValue({ ok: true, exhausted: true, persistedRowCount: 10, persistedCellCount: 20 });
    completeNormalizationRunMock.mockResolvedValue({ ok: false, code: "COMPLETION_REJECTED" });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(409);
    const body = await bodyOf(res);
    expect(body.status).toBe("COMPLETION_REJECTED");
    expect(JSON.stringify(body)).not.toMatch(/prisma|postgres|sql|constraint/i);
  });

  it("LEASE_LOST from completion -> 409 CONFLICT", async () => {
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: false, run: ACTIVE_RUN });
    normalizeBatchesMock.mockResolvedValue({ ok: true, exhausted: true, persistedRowCount: 10, persistedCellCount: 20 });
    completeNormalizationRunMock.mockResolvedValue({ ok: false, code: "LEASE_LOST" });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).status).toBe("CONFLICT");
  });

  it("wrong-tenant / nonexistent Upload -> identical 404", async () => {
    uploadFindFirstMock.mockResolvedValue(null);
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(404);
    expect(createOrResumeMock).not.toHaveBeenCalled();
  });

  it("an unexpected thrown exception never leaks its message, and returns a bounded 500", async () => {
    createOrResumeMock.mockRejectedValue(new Error("password=hunter2 at postgres://internal-host/db"));
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(res.status).toBe(500);
    const body = await bodyOf(res);
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(body)).not.toContain("postgres://");
    expect(body).toEqual({ ok: false, status: "ERROR", error: "Failed to normalize this worksheet." });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CALL SHAPE
// ═══════════════════════════════════════════════════════════════════════

describe("call shape", () => {
  beforeEach(() => {
    asManagerSession();
    uploadFindFirstMock.mockResolvedValue({ id: UPLOAD_ID });
  });

  it("normalizeBatches receives the returned pinned run object directly, never a rebuilt/re-resolved plan", async () => {
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: false, run: ACTIVE_RUN });
    normalizeBatchesMock.mockResolvedValue({ ok: true, exhausted: false, persistedRowCount: 0, persistedCellCount: 0 });
    const { req, params } = postRequest();
    await POST(req, { params });
    expect(normalizeBatchesMock).toHaveBeenCalledWith(ACTIVE_RUN, 8000);
  });

  it("completeNormalizationRun gets authenticated session.userId as completedByUserId, never the run's own created_by or any other actor", async () => {
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: false, run: ACTIVE_RUN });
    normalizeBatchesMock.mockResolvedValue({ ok: true, exhausted: true, persistedRowCount: 10, persistedCellCount: 20 });
    completeNormalizationRunMock.mockResolvedValue({ ok: true, rowCount: 10, cellCount: 20 });
    const { req, params } = postRequest();
    await POST(req, { params });
    expect(completeNormalizationRunMock).toHaveBeenCalledWith(expect.objectContaining({ completedByUserId: USER }));
  });

  it("the route forwards executionToken ONLY to completeNormalizationRun -- never elsewhere, never in a response", async () => {
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: false, run: ACTIVE_RUN });
    normalizeBatchesMock.mockResolvedValue({ ok: true, exhausted: true, persistedRowCount: 10, persistedCellCount: 20 });
    completeNormalizationRunMock.mockResolvedValue({ ok: true, rowCount: 10, cellCount: 20 });
    const { req, params } = postRequest();
    const res = await POST(req, { params });
    expect(completeNormalizationRunMock).toHaveBeenCalledWith(expect.objectContaining({ executionToken: ACTIVE_RUN.executionToken }));
    const body = await bodyOf(res);
    expect(JSON.stringify(body)).not.toContain(ACTIVE_RUN.executionToken);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// GET / STATUS
// ═══════════════════════════════════════════════════════════════════════

describe("GET", () => {
  beforeEach(() => {
    asManagerSession();
  });

  it("wrong tenant / nonexistent Upload -> identical 404", async () => {
    uploadFindFirstMock.mockResolvedValue(null);
    const { req, params } = getRequest();
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
    expect(statusMock).not.toHaveBeenCalled();
  });

  it("Upload.normalized_at set -> 200 SUCCEEDED from Upload's own B1 fields, status helper never called", async () => {
    uploadFindFirstMock.mockResolvedValue({ normalized_at: new Date(), normalized_row_count: 42, normalized_cell_count: 84 });
    const { req, params } = getRequest();
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body).toEqual({ ok: true, status: "SUCCEEDED", rowCount: 42, cellCount: 84 });
    expect(statusMock).not.toHaveBeenCalled();
  });

  it("not yet normalized -> delegates to the read-only status helper, forwarding organisationId/uploadId", async () => {
    uploadFindFirstMock.mockResolvedValue({ normalized_at: null, normalized_row_count: null, normalized_cell_count: null });
    statusMock.mockResolvedValue({ ok: true, status: "RUNNING", attemptNumber: 1, persistedRowCount: 2, persistedCellCount: 4, expectedRowCount: 10, expectedCellCount: 20, failureCode: null });
    const { req, params } = getRequest();
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    expect(statusMock).toHaveBeenCalledWith({ organisationId: ORG, uploadId: UPLOAD_ID });
    const body = await bodyOf(res);
    expect(body.status).toBe("RUNNING");
  });

  it("NOT_STARTED status passes through unchanged", async () => {
    uploadFindFirstMock.mockResolvedValue({ normalized_at: null, normalized_row_count: null, normalized_cell_count: null });
    statusMock.mockResolvedValue({ ok: true, status: "NOT_STARTED" });
    const { req, params } = getRequest();
    const res = await GET(req, { params });
    const body = await bodyOf(res);
    expect(body).toEqual({ ok: true, status: "NOT_STARTED" });
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PRIVACY
// ═══════════════════════════════════════════════════════════════════════

describe("privacy", () => {
  beforeEach(() => {
    asManagerSession();
    uploadFindFirstMock.mockResolvedValue({ id: UPLOAD_ID });
  });

  const FORBIDDEN_PATTERN = /executionToken|execution_token|rawValue|raw_value|profile_document|failure_detail|source_header/i;

  it("no token/internal-pin leakage in any POST response body, across every outcome", async () => {
    const scenarios: Array<() => Promise<void>> = [
      async () => {
        createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: false, run: ACTIVE_RUN });
        normalizeBatchesMock.mockResolvedValue({ ok: true, exhausted: false, persistedRowCount: 1, persistedCellCount: 2 });
      },
      async () => {
        createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: false, run: ACTIVE_RUN });
        normalizeBatchesMock.mockResolvedValue({ ok: false, code: "NORMALIZATION_BLOCKED", exhausted: false, persistedRowCount: 1, persistedCellCount: 2 });
      },
      async () => {
        createOrResumeMock.mockResolvedValue({ ok: false, code: "RUN_ALREADY_IN_PROGRESS" });
      },
    ];
    for (const setup of scenarios) {
      vi.clearAllMocks();
      asManagerSession();
      uploadFindFirstMock.mockResolvedValue({ id: UPLOAD_ID });
      await setup();
      const { req, params } = postRequest();
      const res = await POST(req, { params });
      const raw = JSON.stringify(await bodyOf(res));
      expect(raw).not.toMatch(FORBIDDEN_PATTERN);
      expect(raw).not.toContain(ACTIVE_RUN.executionToken);
      expect(raw).not.toContain(ACTIVE_RUN.id); // runId itself never exposed
    }
  });

  it("Cache-Control is private, no-store on every status code", async () => {
    // 401
    requireRoleMock.mockRejectedValueOnce(new Error("Unauthorized"));
    {
      const { req, params } = postRequest();
      const res = await POST(req, { params });
      expect(res.status).toBe(401);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }

    // 404
    asManagerSession();
    uploadFindFirstMock.mockResolvedValue(null);
    {
      const { req, params } = postRequest();
      const res = await POST(req, { params });
      expect(res.status).toBe(404);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }

    // 409
    uploadFindFirstMock.mockResolvedValue({ id: UPLOAD_ID });
    createOrResumeMock.mockResolvedValue({ ok: false, code: "RUN_ALREADY_IN_PROGRESS" });
    {
      const { req, params } = postRequest();
      const res = await POST(req, { params });
      expect(res.status).toBe(409);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }

    // 503
    createOrResumeMock.mockResolvedValue({ ok: false, code: "PERSISTENCE_FAILURE" });
    {
      const { req, params } = postRequest();
      const res = await POST(req, { params });
      expect(res.status).toBe(503);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }

    // 422
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: false, run: ACTIVE_RUN });
    normalizeBatchesMock.mockResolvedValue({ ok: false, code: "NORMALIZATION_BLOCKED", exhausted: false, persistedRowCount: 0, persistedCellCount: 0 });
    {
      const { req, params } = postRequest();
      const res = await POST(req, { params });
      expect(res.status).toBe(422);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }

    // 500
    createOrResumeMock.mockRejectedValue(new Error("boom"));
    {
      const { req, params } = postRequest();
      const res = await POST(req, { params });
      expect(res.status).toBe(500);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });

  it("no request body is ever parsed/awaited by the route (a malformed JSON body does not crash the handler)", async () => {
    createOrResumeMock.mockResolvedValue({ ok: true, alreadyNormalized: true });
    const req = new NextRequest(`http://localhost/api/data-hub/worksheets/${UPLOAD_ID}/normalize`, { method: "POST", body: "{not valid json!!" });
    const res = await POST(req, { params: Promise.resolve({ id: UPLOAD_ID }) });
    expect(res.status).toBe(200);
  });
});
