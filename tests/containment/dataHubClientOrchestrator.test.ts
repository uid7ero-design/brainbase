import { describe, it, expect, vi, beforeEach } from "vitest";

// Data Hub 5A.3B — behavioral tests for the end-to-end browser
// orchestration state machine. Disposable/mocked only: `fetch` is injected
// per-session via `fetchImpl` (never real network/DB/Blob), and
// "@vercel/blob/client" is module-mocked (never a real upload).

const putMock = vi.fn();
const getPayloadFromClientTokenMock = vi.fn();
vi.mock("@vercel/blob/client", () => ({
  put: (...args: unknown[]) => putMock(...args),
  getPayloadFromClientToken: (...args: unknown[]) => getPayloadFromClientTokenMock(...args),
}));

import { createIllegalDumpingImportSession } from "@/lib/data-hub/client/orchestrator";
import type { DataHubImportState } from "@/lib/data-hub/client/orchestrator";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Sequential fetch stub: each call to fetch() consumes the next queued
 * responder, in order. A responder may be a canned Response or a function
 * of (url, init) for tests that need to assert on the request. Throwing a
 * responder simulates a network-level failure. */
function makeSequentialFetch(responders: Array<Response | ((url: string, init?: RequestInit) => Response | Promise<Response>) | Error>) {
  let i = 0;
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const responder = responders[i++];
    if (responder === undefined) throw new Error(`No more queued responses (call #${i} for ${String(url)})`);
    if (responder instanceof Error) throw responder;
    if (responder instanceof Response) return responder;
    return responder(String(url), init);
  });
}

function collectStates(session: ReturnType<typeof createIllegalDumpingImportSession>): DataHubImportState[] {
  const states: DataHubImportState[] = [];
  session.subscribe((s) => states.push(s));
  return states;
}

const testFile = () => new File(["a,b\n1,2\n"], "dumping.csv", { type: "text/csv" });

beforeEach(() => {
  putMock.mockReset();
  getPayloadFromClientTokenMock.mockReset();
  getPayloadFromClientTokenMock.mockReturnValue({ pathname: "org_1/importbatch_1" });
});

const BATCH_ID = "batch-1";

describe("orchestrator — full happy path", () => {
  it("drives initiate -> upload -> finalize READY -> inspect -> obtain worksheet -> confirmationReady -> confirm (fresh import)", async () => {
    putMock.mockResolvedValue({ url: "u", downloadUrl: "d", pathname: "org_1/importbatch_1", contentType: "text/csv", contentDisposition: "inline", etag: "e" });

    const fetchImpl = makeSequentialFetch([
      // initiate
      jsonResponse(200, {
        batch: { id: BATCH_ID, status: "AWAITING_UPLOAD", originalFilename: "dumping.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null },
        uploadToken: "tok-1",
        configurationError: false,
      }),
      // finalize
      jsonResponse(200, { ok: true, outcome: "READY", batchId: BATCH_ID, sha256: "abc123" }),
      // inspect
      jsonResponse(200, { ok: true, worksheets: [{ worksheetIndex: 0, worksheetName: "CSV", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION" }] }),
      // list worksheets (obtain worksheet)
      jsonResponse(200, {
        worksheets: [
          {
            id: "ws-1",
            worksheetIndex: 0,
            worksheetName: "CSV",
            worksheetVisibility: "visible",
            worksheetIsEmpty: false,
            canonicalStatus: "AWAITING_CONFIRMATION",
            importBatchId: BATCH_ID,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            confirmedBy: null,
            confirmedAt: null,
          },
        ],
      }),
      // confirm-illegal-dumping
      jsonResponse(200, { ok: true, alreadyImported: false, worksheetUploadId: "ws-1", importedRows: 42 }),
    ]);

    const session = createIllegalDumpingImportSession({ fetchImpl });
    const states = collectStates(session);

    await session.start(testFile());
    expect(session.getState().phase).toBe("awaitingUpload");

    await session.upload();
    // upload() auto-advances through finalize -> inspect -> obtain worksheet
    expect(session.getState().phase).toBe("confirmationReady");

    await session.confirm();
    const final = session.getState();
    expect(final.phase).toBe("imported");
    if (final.phase === "imported") {
      expect(final.importedRows).toBe(42);
      expect(final.worksheetId).toBe("ws-1");
    }

    // Never jumps straight to "imported"/"alreadyImported" from any earlier
    // phase — confirming is always observed immediately beforehand.
    const phases = states.map((s) => s.phase);
    const confirmIdx = phases.indexOf("confirming");
    const importedIdx = phases.indexOf("imported");
    expect(confirmIdx).toBeGreaterThanOrEqual(0);
    expect(importedIdx).toBe(confirmIdx + 1);
  });
});

describe("orchestrator — initiate soft failure (configurationError)", () => {
  it("exposes initiateConfigurationError distinctly, never treating ok:true as 'proceed to upload'", async () => {
    const fetchImpl = makeSequentialFetch([
      jsonResponse(200, {
        batch: { id: BATCH_ID, status: "AWAITING_UPLOAD", originalFilename: "x.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null },
        uploadToken: null,
        configurationError: true,
      }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.start(testFile());
    expect(session.getState().phase).toBe("initiateConfigurationError");
  });

  it("retryInitiate() re-issues initiate with the SAME idempotency key", async () => {
    const seenKeys: string[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenKeys.push(headers.get("Idempotency-Key")!);
      return jsonResponse(200, {
        batch: { id: BATCH_ID, status: "AWAITING_UPLOAD", originalFilename: "x.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null },
        uploadToken: null,
        configurationError: true,
      });
    });
    const session = createIllegalDumpingImportSession({ fetchImpl, generateIdempotencyKey: () => "fixed-key" });
    await session.start(testFile());
    await session.retryInitiate();
    expect(seenKeys).toEqual(["fixed-key", "fixed-key"]);
  });
});

describe("orchestrator — finalize outcome-in-body discipline", () => {
  it("interprets a 200 response by its outcome field, not merely HTTP 200 (FAILED outcome is not success)", async () => {
    putMock.mockResolvedValue({ url: "u", downloadUrl: "d", pathname: "p", contentType: "text/csv", contentDisposition: "inline", etag: "e" });
    const fetchImpl = makeSequentialFetch([
      jsonResponse(200, { batch: { id: BATCH_ID, status: "AWAITING_UPLOAD", originalFilename: "x.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null }, uploadToken: "tok", configurationError: false }),
      jsonResponse(200, { ok: true, outcome: "FAILED", batchId: BATCH_ID, failureCode: "HASH_MISMATCH", failureMessage: "does not match", retryable: false }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.start(testFile());
    await session.upload();
    const state = session.getState();
    expect(state.phase).toBe("physicalFailed");
    if (state.phase === "physicalFailed") {
      expect(state.failureCode).toBe("HASH_MISMATCH");
      expect(state.retryable).toBe(false);
    }
  });

  it("a repeat-finalize 409 (ALREADY_READY, indistinguishable on the wire from ALREADY_PROCESSING/DELETION_PENDING) is reconciled to SUCCESS via GET batch detail, never surfaced as a failure", async () => {
    putMock.mockResolvedValue({ url: "u", downloadUrl: "d", pathname: "p", contentType: "text/csv", contentDisposition: "inline", etag: "e" });
    const fetchImpl = makeSequentialFetch([
      jsonResponse(200, { batch: { id: BATCH_ID, status: "AWAITING_UPLOAD", originalFilename: "x.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null }, uploadToken: "tok", configurationError: false }),
      // finalize: the real wire shape for ALREADY_READY — bare {error}, HTTP 409, NO reason code.
      jsonResponse(409, { error: "The import batch is not currently in a state that allows this operation." }),
      // reconciliation GET: ground truth says READY.
      jsonResponse(200, {
        batch: {
          id: BATCH_ID,
          status: "READY",
          originalFilename: "x.csv",
          contentType: "csv",
          sizeBytes: 8,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          sha256: "readysha",
          uploadedBy: "u1",
          attemptCount: 2,
          lastAttemptAt: "2026-01-01T00:00:00.000Z",
          lastFailureCode: null,
          lastFailureMessage: null,
          lastFailureRetryable: null,
          deletedAt: null,
        },
      }),
      // auto-advance to inspect
      jsonResponse(200, { ok: true, worksheets: [{ worksheetIndex: 0, worksheetName: "CSV", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION" }] }),
      // auto-advance to obtain worksheet
      jsonResponse(200, { worksheets: [{ id: "ws-1", worksheetIndex: 0, worksheetName: "CSV", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION", importBatchId: BATCH_ID, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", confirmedBy: null, confirmedAt: null }] }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.start(testFile());
    await session.upload();
    const state = session.getState();
    expect(state.phase).toBe("confirmationReady");
    if (state.phase === "confirmationReady") {
      expect(state.batch.status).toBe("READY");
    }
  });

  it("a network timeout during finalize is reconciled, never marked as a failed import (a subsequent GET shows FAILED authoritatively)", async () => {
    putMock.mockResolvedValue({ url: "u", downloadUrl: "d", pathname: "p", contentType: "text/csv", contentDisposition: "inline", etag: "e" });
    const timeoutErr = new Error("timed out");
    const fetchImpl = makeSequentialFetch([
      jsonResponse(200, { batch: { id: BATCH_ID, status: "AWAITING_UPLOAD", originalFilename: "x.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null }, uploadToken: "tok", configurationError: false }),
      timeoutErr, // finalize network failure
      jsonResponse(200, {
        batch: {
          id: BATCH_ID,
          status: "FAILED",
          originalFilename: "x.csv",
          contentType: "csv",
          sizeBytes: 8,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          sha256: null,
          uploadedBy: "u1",
          attemptCount: 1,
          lastAttemptAt: "2026-01-01T00:00:00.000Z",
          lastFailureCode: "ZERO_BYTE",
          lastFailureMessage: "The uploaded file is empty.",
          lastFailureRetryable: false,
          deletedAt: null,
        },
      }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.start(testFile());
    await session.upload();
    const state = session.getState();
    expect(state.phase).toBe("physicalFailed");
    if (state.phase === "physicalFailed") {
      expect(state.failureCode).toBe("ZERO_BYTE");
    }
  });

  it("reconciliation finding status still PROCESSING stays honestly uncertain (neither success nor failure)", async () => {
    putMock.mockResolvedValue({ url: "u", downloadUrl: "d", pathname: "p", contentType: "text/csv", contentDisposition: "inline", etag: "e" });
    const fetchImpl = makeSequentialFetch([
      jsonResponse(200, { batch: { id: BATCH_ID, status: "AWAITING_UPLOAD", originalFilename: "x.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null }, uploadToken: "tok", configurationError: false }),
      new Error("connection reset"),
      jsonResponse(200, {
        batch: { id: BATCH_ID, status: "PROCESSING", originalFilename: "x.csv", contentType: "csv", sizeBytes: 8, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", sha256: null, uploadedBy: "u1", attemptCount: 1, lastAttemptAt: "2026-01-01T00:00:00.000Z", lastFailureCode: null, lastFailureMessage: null, lastFailureRetryable: null, deletedAt: null },
      }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.start(testFile());
    await session.upload();
    expect(session.getState().phase).toBe("finalizeUncertain");
  });
});

describe("orchestrator — upload abort / uncertainty", () => {
  it("an aborted upload never proceeds directly to a retry-upload state; it exposes proceedToFinalize as the recovery", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    putMock.mockRejectedValue(abortErr);

    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/import-batches")) {
        return jsonResponse(200, { batch: { id: BATCH_ID, status: "AWAITING_UPLOAD", originalFilename: "x.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null }, uploadToken: "tok", configurationError: false });
      }
      if (u.includes("/finalize")) {
        return jsonResponse(200, { ok: true, outcome: "FAILED", batchId: BATCH_ID, failureCode: "STORAGE_NOT_FOUND", failureMessage: "not found", retryable: true });
      }
      throw new Error(`unexpected URL ${u}`);
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.start(testFile());
    await session.upload();
    const state = session.getState();
    expect(state.phase).toBe("uploadUncertain");

    // The recommended recovery is proceedToFinalize() — finalize's own
    // storage.head() call is authoritative on whether the object landed.
    await session.proceedToFinalize();
    const after = session.getState();
    expect(after.phase).toBe("physicalFailed");
    if (after.phase === "physicalFailed") {
      expect(after.failureCode).toBe("STORAGE_NOT_FOUND");
      expect(after.retryable).toBe(true);
    }
  });
});

describe("orchestrator — obtain worksheet (the id inspect never returns)", () => {
  it("never treats inspect's own success as sufficient for confirm — it always fetches the worksheet list to obtain the id", async () => {
    putMock.mockResolvedValue({ url: "u", downloadUrl: "d", pathname: "p", contentType: "text/csv", contentDisposition: "inline", etag: "e" });
    let listCalled = false;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/import-batches") && !u.includes("/finalize") && !u.includes("/inspect") && !u.includes("/worksheets") && !u.endsWith(`/${BATCH_ID}`)) {
        return jsonResponse(200, { batch: { id: BATCH_ID, status: "AWAITING_UPLOAD", originalFilename: "x.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null }, uploadToken: "tok", configurationError: false });
      }
      if (u.includes("/finalize")) return jsonResponse(200, { ok: true, outcome: "READY", batchId: BATCH_ID, sha256: "s" });
      if (u.includes("/inspect")) return jsonResponse(200, { ok: true, worksheets: [{ worksheetIndex: 0, worksheetName: "CSV", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION" }] });
      if (u.includes("/worksheets")) {
        listCalled = true;
        return jsonResponse(200, { worksheets: [{ id: "ws-99", worksheetIndex: 0, worksheetName: "CSV", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION", importBatchId: BATCH_ID, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", confirmedBy: null, confirmedAt: null }] });
      }
      throw new Error(`unexpected URL ${u}`);
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.start(testFile());
    await session.upload();
    expect(listCalled).toBe(true);
    const state = session.getState();
    expect(state.phase).toBe("confirmationReady");
    if (state.phase === "confirmationReady") {
      expect(state.worksheet.id).toBe("ws-99");
    }
  });
});

describe("orchestrator — confirm two distinct success shapes", () => {
  async function driveToConfirmationReady(confirmResponder: (url: string) => Response) {
    putMock.mockResolvedValue({ url: "u", downloadUrl: "d", pathname: "p", contentType: "text/csv", contentDisposition: "inline", etag: "e" });
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/import-batches")) return jsonResponse(200, { batch: { id: BATCH_ID, status: "AWAITING_UPLOAD", originalFilename: "x.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null }, uploadToken: "tok", configurationError: false });
      if (u.includes("/finalize")) return jsonResponse(200, { ok: true, outcome: "READY", batchId: BATCH_ID, sha256: "s" });
      if (u.includes("/inspect")) return jsonResponse(200, { ok: true, worksheets: [{ worksheetIndex: 0, worksheetName: "CSV", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION" }] });
      if (u.includes("/worksheets") && !u.includes("confirm")) return jsonResponse(200, { worksheets: [{ id: "ws-1", worksheetIndex: 0, worksheetName: "CSV", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION", importBatchId: BATCH_ID, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", confirmedBy: null, confirmedAt: null }] });
      if (u.includes("confirm-illegal-dumping")) return confirmResponder(u);
      throw new Error(`unexpected URL ${u}`);
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.start(testFile());
    await session.upload();
    expect(session.getState().phase).toBe("confirmationReady");
    return session;
  }

  it("fresh import: alreadyImported:false carries importedRows", async () => {
    const session = await driveToConfirmationReady(() => jsonResponse(200, { ok: true, alreadyImported: false, worksheetUploadId: "ws-1", importedRows: 7 }));
    await session.confirm();
    const state = session.getState();
    expect(state.phase).toBe("imported");
    if (state.phase === "imported") expect(state.importedRows).toBe(7);
  });

  it("idempotent replay: alreadyImported:true carries NO importedRows field at all", async () => {
    const session = await driveToConfirmationReady(() => jsonResponse(200, { ok: true, alreadyImported: true, worksheetUploadId: "ws-1" }));
    await session.confirm();
    const state = session.getState();
    expect(state.phase).toBe("alreadyImported");
    expect("importedRows" in state).toBe(false);
  });

  it("a confirm failure exposes retryConfirm(), which succeeds without double-importing when the server reports alreadyImported", async () => {
    let attempt = 0;
    const session = await driveToConfirmationReady(() => {
      attempt++;
      if (attempt === 1) return jsonResponse(500, { error: "internal" });
      return jsonResponse(200, { ok: true, alreadyImported: true, worksheetUploadId: "ws-1" });
    });
    await session.confirm();
    expect(session.getState().phase).toBe("confirmFailed");
    await session.retryConfirm();
    expect(session.getState().phase).toBe("alreadyImported");
  });
});

describe("orchestrator — PARSER_REJECTED honesty (no fabricated specificity)", () => {
  it("surfaces the server's own generic message verbatim, never inventing a more specific reason", async () => {
    putMock.mockResolvedValue({ url: "u", downloadUrl: "d", pathname: "p", contentType: "text/csv", contentDisposition: "inline", etag: "e" });
    const fetchImpl = makeSequentialFetch([
      jsonResponse(200, { batch: { id: BATCH_ID, status: "AWAITING_UPLOAD", originalFilename: "x.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null }, uploadToken: "tok", configurationError: false }),
      jsonResponse(200, { ok: true, outcome: "READY", batchId: BATCH_ID, sha256: "s" }),
      jsonResponse(422, { ok: false, error: "The uploaded file could not be safely parsed as a workbook.", code: "PARSER_REJECTED" }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.start(testFile());
    await session.upload();
    const state = session.getState();
    expect(state.phase).toBe("inspectFailed");
    if (state.phase === "inspectFailed") {
      expect(state.code).toBe("PARSER_REJECTED");
      expect(state.message).toBe("The uploaded file could not be safely parsed as a workbook.");
    }
  });
});
