import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 5A.3D.1 — behavioral tests for resumeFromBatchId(), the browser
// orchestrator's import-recovery/hydration entry point. Same discipline as
// dataHubClientOrchestrator.test.ts (5A.3B): `fetch` is injected per-session
// via `fetchImpl` (never real network/DB/Blob), "@vercel/blob/client" is
// module-mocked so ANY accidental use is immediately observable via
// putMock/getPayloadFromClientTokenMock call counts.

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

/** Like dataHubClientOrchestrator.test.ts's own makeSequentialFetch, but
 * also records every URL/method observed — resume-specific tests need to
 * assert on WHICH routes were (or were not) called, not just their bodies. */
function makeRecordingFetch(responders: Array<Response | ((url: string, init?: RequestInit) => Response | Promise<Response>) | Error>) {
  let i = 0;
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    const responder = responders[i++];
    if (responder === undefined) throw new Error(`No more queued responses (call #${i} for ${String(url)})`);
    if (responder instanceof Error) throw responder;
    if (responder instanceof Response) return responder;
    return responder(String(url), init);
  });
  return { fetchImpl, calls };
}

function collectStates(session: ReturnType<typeof createIllegalDumpingImportSession>): DataHubImportState[] {
  const states: DataHubImportState[] = [];
  session.subscribe((s) => states.push(s));
  return states;
}

const BATCH_ID = "batch-1";
const ORCHESTRATOR_PATH = path.join(process.cwd(), "lib", "data-hub", "client", "orchestrator.ts");

function orchestratorSource(): string {
  return fs.readFileSync(ORCHESTRATOR_PATH, "utf8");
}

function batchDetail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: BATCH_ID,
    status: "READY",
    originalFilename: "dumping.csv",
    contentType: "csv",
    sizeBytes: 8,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sha256: "abc123",
    uploadedBy: "user-1",
    attemptCount: 1,
    lastAttemptAt: "2026-01-01T00:00:00.000Z",
    lastFailureCode: null,
    lastFailureMessage: null,
    lastFailureRetryable: null,
    deletedAt: null,
    ...overrides,
  };
}

function worksheetFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    lastAttemptAt: null,
    attemptCount: 0,
    lastFailureCode: null,
    lastFailureMessage: null,
    lastFailureRetryable: null,
    importedRowCount: null,
    ...overrides,
  };
}

beforeEach(() => {
  putMock.mockReset();
  getPayloadFromClientTokenMock.mockReset();
});

// ---------------------------------------------------------------------------
// T1 / T27 — no automatic work on construction or otherwise.
// ---------------------------------------------------------------------------

describe("T1/T27 — construction performs zero work; resume is never auto-invoked", () => {
  it("creating a session and subscribing triggers zero fetch calls", () => {
    const { fetchImpl, calls } = makeRecordingFetch([]);
    const session = createIllegalDumpingImportSession({ fetchImpl });
    collectStates(session);
    expect(session.getState().phase).toBe("idle");
    expect(calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T2 — READY, no worksheet yet -> falls through to the EXISTING
// inspect -> obtainWorksheet chain, unmodified.
// ---------------------------------------------------------------------------

describe("T2 — READY batch with no persisted worksheet resumes via the existing inspect flow", () => {
  it("reaches confirmationReady via GET batch -> GET worksheets(empty) -> POST inspect -> GET worksheets(1)", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([
      jsonResponse(200, { batch: batchDetail({ status: "READY" }) }),
      jsonResponse(200, { worksheets: [] }),
      jsonResponse(200, { ok: true, worksheets: [{ worksheetIndex: 0, worksheetName: "CSV", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION" }] }),
      jsonResponse(200, { worksheets: [worksheetFixture()] }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });
    const states = collectStates(session);

    await session.resumeFromBatchId(BATCH_ID);

    expect(session.getState().phase).toBe("confirmationReady");
    expect(states.map((s) => s.phase)).toEqual([
      "resumingBatch",
      "physicalReady",
      "inspecting",
      "obtainingWorksheet",
      "confirmationReady",
    ]);
    expect(calls.map((c) => c.method + " " + c.url.replace(/^https?:\/\/[^/]*/, ""))).toEqual([
      "GET /api/data-hub/import-batches/batch-1",
      "GET /api/data-hub/import-batches/batch-1/worksheets",
      "POST /api/data-hub/import-batches/batch-1/inspect",
      "GET /api/data-hub/import-batches/batch-1/worksheets",
    ]);
  });
});

// ---------------------------------------------------------------------------
// T3 — READY with an existing AWAITING_CONFIRMATION worksheet -> straight to
// confirmationReady, no redundant inspect call.
// ---------------------------------------------------------------------------

describe("T3 — recovered AWAITING_CONFIRMATION worksheet reaches confirmationReady directly", () => {
  it("does not call inspect when a worksheet already exists", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([
      jsonResponse(200, { batch: batchDetail({ status: "READY" }) }),
      jsonResponse(200, { worksheets: [worksheetFixture({ canonicalStatus: "AWAITING_CONFIRMATION" })] }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });

    await session.resumeFromBatchId(BATCH_ID);

    const final = session.getState();
    expect(final.phase).toBe("confirmationReady");
    expect(calls.some((c) => c.url.includes("/inspect"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T4 — recovered worksheet can load Preview via the existing loadPreview().
// ---------------------------------------------------------------------------

describe("T4 — recovered worksheet can load Preview", () => {
  it("loadPreview() from a resumed confirmationReady reaches previewReady", async () => {
    const { fetchImpl } = makeRecordingFetch([
      jsonResponse(200, { batch: batchDetail({ status: "READY" }) }),
      jsonResponse(200, { worksheets: [worksheetFixture()] }),
      jsonResponse(200, {
        ok: true,
        preview: {
          worksheetId: "ws-1",
          worksheetName: "CSV",
          worksheetIndex: 0,
          rowCount: 1,
          columnCount: 3,
          headers: ["report_date", "location", "waste_type"],
          sampleRows: [["2026-01-01", "loc", "type"]],
          sampleRowCount: 1,
          truncated: false,
          requiredHeadersPresent: true,
          missingRequiredHeaders: [],
        },
      }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });

    await session.resumeFromBatchId(BATCH_ID);
    expect(session.getState().phase).toBe("confirmationReady");

    await session.loadPreview();
    expect(session.getState().phase).toBe("previewReady");
  });
});

// ---------------------------------------------------------------------------
// T5 / T19 — recovered worksheet confirms ONLY via an explicit confirm()
// call, and alreadyImported replay remains success (existing semantics,
// unmodified, reused as-is).
// ---------------------------------------------------------------------------

describe("T5/T19 — recovered worksheet confirms only via explicit confirm(), replay semantics unchanged", () => {
  it("resume never calls confirm-illegal-dumping itself; an explicit confirm() reaches imported", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([
      jsonResponse(200, { batch: batchDetail({ status: "READY" }) }),
      jsonResponse(200, { worksheets: [worksheetFixture()] }),
      jsonResponse(200, { ok: true, alreadyImported: false, worksheetUploadId: "ws-1", importedRows: 7 }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });

    await session.resumeFromBatchId(BATCH_ID);
    expect(calls.some((c) => c.url.includes("confirm-illegal-dumping"))).toBe(false);

    await session.confirm();
    const final = session.getState();
    expect(final.phase).toBe("imported");
    if (final.phase === "imported") expect(final.importedRows).toBe(7);
  });

  it("an explicit confirm() on a resumed session that the server reports as already-imported reaches alreadyImported, not a duplicate success", async () => {
    const { fetchImpl } = makeRecordingFetch([
      jsonResponse(200, { batch: batchDetail({ status: "READY" }) }),
      jsonResponse(200, { worksheets: [worksheetFixture()] }),
      jsonResponse(200, { ok: true, alreadyImported: true, worksheetUploadId: "ws-1" }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId(BATCH_ID);
    await session.confirm();
    expect(session.getState().phase).toBe("alreadyImported");
  });
});

// ---------------------------------------------------------------------------
// T6 / T7 / T8 — IMPORTED worksheet hydrates terminal success using the
// authoritative 5A.3D.0 read-time count, genuine zero preserved.
// ---------------------------------------------------------------------------

describe("T6/T7/T8 — IMPORTED worksheet hydration and authoritative row count", () => {
  it("hydrates an IMPORTED worksheet as terminal success using importedRowCount", async () => {
    const { fetchImpl } = makeRecordingFetch([
      jsonResponse(200, { batch: batchDetail({ status: "READY" }) }),
      jsonResponse(200, { worksheets: [worksheetFixture({ canonicalStatus: "IMPORTED", importedRowCount: 42 })] }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId(BATCH_ID);
    const final = session.getState();
    expect(final.phase).toBe("imported");
    if (final.phase === "imported") {
      expect(final.importedRows).toBe(42);
      expect(final.worksheetId).toBe("ws-1");
    }
  });

  it("preserves a genuine zero imported-row count rather than collapsing it", async () => {
    const { fetchImpl } = makeRecordingFetch([
      jsonResponse(200, { batch: batchDetail({ status: "READY" }) }),
      jsonResponse(200, { worksheets: [worksheetFixture({ canonicalStatus: "IMPORTED", importedRowCount: 0 })] }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId(BATCH_ID);
    const final = session.getState();
    expect(final.phase).toBe("imported");
    if (final.phase === "imported") expect(final.importedRows).toBe(0);
  });

  it("never fabricates a count: a null importedRowCount on an IMPORTED worksheet surfaces honestly as unknownError, not a coerced 0", async () => {
    const { fetchImpl } = makeRecordingFetch([
      jsonResponse(200, { batch: batchDetail({ status: "READY" }) }),
      jsonResponse(200, { worksheets: [worksheetFixture({ canonicalStatus: "IMPORTED", importedRowCount: null })] }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId(BATCH_ID);
    const final = session.getState();
    expect(final.phase).toBe("unknownError");
  });
});

// ---------------------------------------------------------------------------
// T9 / T10 — AWAITING_UPLOAD is honestly non-resumable: no re-upload, no
// minted token.
// ---------------------------------------------------------------------------

describe("T9/T10 — AWAITING_UPLOAD hydrates as non-resumable, no re-upload/token minting", () => {
  it("hydrates batchTerminal without calling initiate, upload, or Blob", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([jsonResponse(200, { batch: batchDetail({ status: "AWAITING_UPLOAD" }) })]);
    const session = createIllegalDumpingImportSession({ fetchImpl });

    await session.resumeFromBatchId(BATCH_ID);

    const final = session.getState();
    expect(final.phase).toBe("batchTerminal");
    expect("uploadToken" in final).toBe(false);
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("GET");
    expect(putMock).not.toHaveBeenCalled();
    expect(getPayloadFromClientTokenMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T11 — PROCESSING is non-actionable: no automatic finalize retry.
// ---------------------------------------------------------------------------

describe("T11 — PROCESSING hydrates non-actionable, no automatic finalize retry", () => {
  it("hydrates batchTerminal without ever POSTing finalize", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([jsonResponse(200, { batch: batchDetail({ status: "PROCESSING" }) })]);
    const session = createIllegalDumpingImportSession({ fetchImpl });

    await session.resumeFromBatchId(BATCH_ID);

    expect(session.getState().phase).toBe("batchTerminal");
    expect(calls.some((c) => c.url.includes("/finalize"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T12 — FAILED hydrates truthfully via the EXISTING physicalFailed shape.
// ---------------------------------------------------------------------------

describe("T12 — FAILED batch hydrates the persisted failure state safely", () => {
  it("reaches physicalFailed with the sanitized persisted failure fields, no raw detail invented, no auto-retry", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([
      jsonResponse(200, {
        batch: batchDetail({
          status: "FAILED",
          lastFailureCode: "STORAGE_NOT_FOUND",
          lastFailureMessage: "The uploaded object could not be located.",
          lastFailureRetryable: true,
        }),
      }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });

    await session.resumeFromBatchId(BATCH_ID);

    const final = session.getState();
    expect(final.phase).toBe("physicalFailed");
    if (final.phase === "physicalFailed") {
      expect(final.failureCode).toBe("STORAGE_NOT_FOUND");
      expect(final.failureMessage).toBe("The uploaded object could not be located.");
      expect(final.retryable).toBe(true);
    }
    // Even though retryable === true, resume itself never auto-retries —
    // only the single GET this resume performed, nothing else.
    expect(calls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T13 — DELETION_PENDING remains display-only/non-actionable.
// ---------------------------------------------------------------------------

describe("T13 — DELETION_PENDING remains non-actionable", () => {
  it("hydrates batchTerminal without any mutating call", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([jsonResponse(200, { batch: batchDetail({ status: "DELETION_PENDING" }) })]);
    const session = createIllegalDumpingImportSession({ fetchImpl });

    await session.resumeFromBatchId(BATCH_ID);

    expect(session.getState().phase).toBe("batchTerminal");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T14 / T15 — INELIGIBLE / SKIPPED worksheets are terminal/non-confirmable.
// ---------------------------------------------------------------------------

describe("T14/T15 — INELIGIBLE and SKIPPED worksheets cannot confirm", () => {
  it("INELIGIBLE hydrates worksheetTerminal and confirm() throws", async () => {
    const { fetchImpl } = makeRecordingFetch([
      jsonResponse(200, { batch: batchDetail({ status: "READY" }) }),
      jsonResponse(200, { worksheets: [worksheetFixture({ canonicalStatus: "INELIGIBLE" })] }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId(BATCH_ID);

    const final = session.getState();
    expect(final.phase).toBe("worksheetTerminal");
    if (final.phase === "worksheetTerminal") expect(final.reason).toBe("INELIGIBLE");
    await expect(session.confirm()).rejects.toThrow();
  });

  it("SKIPPED hydrates worksheetTerminal and confirm() throws", async () => {
    const { fetchImpl } = makeRecordingFetch([
      jsonResponse(200, { batch: batchDetail({ status: "READY" }) }),
      jsonResponse(200, { worksheets: [worksheetFixture({ canonicalStatus: "SKIPPED" })] }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId(BATCH_ID);

    const final = session.getState();
    expect(final.phase).toBe("worksheetTerminal");
    if (final.phase === "worksheetTerminal") expect(final.reason).toBe("SKIPPED");
    await expect(session.confirm()).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T16 — foreign/missing batch surfaces the existing safe, indistinguishable
// error semantics (never distinguishing not-found from wrong-tenant).
// ---------------------------------------------------------------------------

describe("T16 — foreign/missing/malformed batch id surfaces existing safe error semantics", () => {
  it("a 404 {error} response hydrates a recoverable unknownError, not a crash or a distinguishing message", async () => {
    const { fetchImpl } = makeRecordingFetch([jsonResponse(404, { error: "Import batch not found." })]);
    const session = createIllegalDumpingImportSession({ fetchImpl });

    await session.resumeFromBatchId("does-not-exist-or-foreign-tenant");

    const final = session.getState();
    expect(final.phase).toBe("unknownError");
    if (final.phase === "unknownError") {
      expect(final.recoverable).toBe(true);
      expect(final.message).toBe("Import batch not found.");
    }
  });
});

// ---------------------------------------------------------------------------
// T17 — resumeFromBatchId never accepts an organisationId (structural proof:
// exactly one parameter, and organisationId never appears in this method's
// own request construction — the trusted context is resolved server-side).
// ---------------------------------------------------------------------------

describe("T17 — resumeFromBatchId never accepts a caller-supplied organisationId", () => {
  it("the method's own arity is exactly one (batchId) and its body never references organisationId/organisation_id", () => {
    const src = orchestratorSource();
    const match = src.match(/async resumeFromBatchId\(([^)]*)\)/);
    expect(match).not.toBeNull();
    expect(match![1].trim()).toBe("batchId: string");

    const start = src.indexOf("async resumeFromBatchId(");
    const end = src.indexOf("\n  private async runResumeFromDetail(", start);
    const body = src.slice(start, end);
    expect(body).not.toMatch(/organisationId/i);
    expect(body).not.toMatch(/organisation_id/i);
  });
});

// ---------------------------------------------------------------------------
// T18 — every resume performs a genuinely fresh read; two resumes of the
// SAME batch id each issue their own GET (no caching/memoization that could
// let a stale assumption survive).
// ---------------------------------------------------------------------------

describe("T18 — fresh server state is always re-read, never cached across resumes", () => {
  it("resuming the same batch id twice performs two independent GET calls and reflects the second, changed response", async () => {
    const { fetchImpl, calls } = makeRecordingFetch([
      jsonResponse(200, { batch: batchDetail({ status: "PROCESSING" }) }),
      jsonResponse(200, { batch: batchDetail({ status: "FAILED", lastFailureCode: "PROVIDER_FAILURE", lastFailureMessage: "m", lastFailureRetryable: false }) }),
    ]);
    const session = createIllegalDumpingImportSession({ fetchImpl });

    await session.resumeFromBatchId(BATCH_ID);
    expect(session.getState().phase).toBe("batchTerminal");

    await session.resumeFromBatchId(BATCH_ID);
    expect(session.getState().phase).toBe("physicalFailed");
    expect(calls.filter((c) => c.method === "GET" && c.url.endsWith(BATCH_ID)).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// T20 — duplicate resumeFromBatchId(A) called twice rapidly: deterministic,
// no duplicate mutation, exactly one call "wins".
// ---------------------------------------------------------------------------

describe("T20 — duplicate resumeFromBatchId(A) called twice rapidly is deterministic with no duplicate mutation", () => {
  it("the second call's result wins; no confirm/finalize/inspect mutation is duplicated", async () => {
    let resolveFirst!: (r: Response) => void;
    const firstGate = new Promise<Response>((resolve) => (resolveFirst = resolve));
    let firstCallStarted = false;

    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith(BATCH_ID) && !firstCallStarted) {
        firstCallStarted = true;
        return firstGate; // never resolves until we say so
      }
      if (u.endsWith(BATCH_ID)) {
        return jsonResponse(200, { batch: batchDetail({ status: "PROCESSING" }) });
      }
      throw new Error(`unexpected call: ${u}`);
    });

    const session = createIllegalDumpingImportSession({ fetchImpl });

    const firstPromise = session.resumeFromBatchId(BATCH_ID); // starts, blocks on firstGate
    const secondPromise = session.resumeFromBatchId(BATCH_ID); // supersedes immediately

    await secondPromise;
    expect(session.getState().phase).toBe("batchTerminal"); // PROCESSING -> batchTerminal, from the SECOND call

    // Now let the first call's stale fetch resolve with a DIFFERENT outcome —
    // it must never overwrite the already-settled, newer state.
    resolveFirst(jsonResponse(200, { batch: batchDetail({ status: "DELETION_PENDING" }) }));
    await firstPromise;

    expect(session.getState().phase).toBe("batchTerminal");
    // Still the SECOND call's PROCESSING-derived message, not the stale
    // first call's DELETION_PENDING-derived one.
    const final = session.getState();
    if (final.phase === "batchTerminal") {
      expect(final.message).toMatch(/currently being processed/);
    }
  });
});

// ---------------------------------------------------------------------------
// T21 — dispose() during an in-flight resume suppresses the stale
// completion entirely (no listener notified, no state mutation).
// ---------------------------------------------------------------------------

describe("T21 — dispose() during resume suppresses the stale completion", () => {
  it("a resume that resolves after dispose() never calls setState or notifies listeners", async () => {
    let resolveFetch!: (r: Response) => void;
    const gate = new Promise<Response>((resolve) => (resolveFetch = resolve));
    const fetchImpl = vi.fn(async () => gate);

    const session = createIllegalDumpingImportSession({ fetchImpl });
    const listener = vi.fn();
    session.subscribe(listener);
    listener.mockClear();

    // The synchronous "resumingBatch" transition (before the first await)
    // legitimately fires — that's the resume genuinely starting. What must
    // be suppressed is the STALE completion, which resolves AFTER dispose().
    const resumePromise = session.resumeFromBatchId(BATCH_ID);
    expect(listener).toHaveBeenCalledTimes(1);
    const callsBeforeDispose = listener.mock.calls.length;
    const stateBeforeDispose = session.getState();

    session.dispose();
    resolveFetch(jsonResponse(200, { batch: batchDetail({ status: "READY" }) }));
    await resumePromise;

    expect(listener.mock.calls.length).toBe(callsBeforeDispose);
    // The underlying state itself must also be untouched by the stale
    // completion — not just "no listener saw it" (dispose() already clears
    // listeners on its own, which would mask a mutation that still lands).
    expect(session.getState()).toEqual(stateBeforeDispose);
  });
});

// ---------------------------------------------------------------------------
// T22 — a later, different operation (a fresh start()) cannot be overwritten
// by an older resume's stale completion.
// ---------------------------------------------------------------------------

describe("T22 — a later start() cannot be overwritten by an older resume's stale completion", () => {
  it("resume(A) in flight, then start(newFile) begins; the stale resume completion never clobbers the new attempt", async () => {
    let resolveResumeFetch!: (r: Response) => void;
    const resumeGate = new Promise<Response>((resolve) => (resolveResumeFetch = resolve));
    let sawInitiate = false;

    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith(BATCH_ID)) return resumeGate;
      if (u.endsWith("/import-batches")) {
        sawInitiate = true;
        return jsonResponse(200, {
          batch: { id: "batch-2", status: "AWAITING_UPLOAD", originalFilename: "x.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null },
          uploadToken: "tok-2",
          configurationError: false,
        });
      }
      throw new Error(`unexpected call: ${u}`);
    });

    const session = createIllegalDumpingImportSession({ fetchImpl, generateIdempotencyKey: () => "k" });
    const resumePromise = session.resumeFromBatchId(BATCH_ID);
    const newFile = new File(["a"], "x.csv", { type: "text/csv" });
    await session.start(newFile);

    expect(sawInitiate).toBe(true);
    expect(session.getState().phase).toBe("awaitingUpload");

    resolveResumeFetch(jsonResponse(200, { batch: batchDetail({ status: "DELETION_PENDING" }) }));
    await resumePromise;

    // The stale resume's completion must not have clobbered start()'s result.
    expect(session.getState().phase).toBe("awaitingUpload");
  });
});

// ---------------------------------------------------------------------------
// T23 — the ordinary new-import path is unchanged: resumeFromBatchId is
// never entered, and neither new phase ever appears.
// ---------------------------------------------------------------------------

describe("T23 — ordinary start-flow regression: resume-only phases never appear", () => {
  it("a full start -> upload -> finalize -> inspect -> obtainWorksheet -> confirm run never visits resumingBatch or worksheetTerminal", async () => {
    putMock.mockResolvedValue({ url: "u", downloadUrl: "d", pathname: "org_1/importbatch_1", contentType: "text/csv", contentDisposition: "inline", etag: "e" });
    getPayloadFromClientTokenMock.mockReturnValue({ pathname: "org_1/importbatch_1" });

    const { fetchImpl } = makeRecordingFetch([
      jsonResponse(200, {
        batch: { id: BATCH_ID, status: "AWAITING_UPLOAD", originalFilename: "dumping.csv", contentType: "csv", sizeBytes: 8, expectedSha256: null, attemptCount: 0, lastFailureCode: null },
        uploadToken: "tok-1",
        configurationError: false,
      }),
      jsonResponse(200, { ok: true, outcome: "READY", batchId: BATCH_ID, sha256: "abc123" }),
      jsonResponse(200, { ok: true, worksheets: [{ worksheetIndex: 0, worksheetName: "CSV", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION" }] }),
      jsonResponse(200, { worksheets: [worksheetFixture()] }),
      jsonResponse(200, { ok: true, alreadyImported: false, worksheetUploadId: "ws-1", importedRows: 42 }),
    ]);

    const session = createIllegalDumpingImportSession({ fetchImpl });
    const states = collectStates(session);

    await session.start(new File(["a,b\n1,2\n"], "dumping.csv", { type: "text/csv" }));
    await session.upload();
    await session.confirm();

    const phases = states.map((s) => s.phase);
    expect(phases).not.toContain("resumingBatch");
    expect(phases).not.toContain("worksheetTerminal");
    expect(session.getState().phase).toBe("imported");
  });
});

// ---------------------------------------------------------------------------
// T24 / T25 / T26 — no browser persistence of any kind.
// ---------------------------------------------------------------------------

describe("T24/T25/T26 — no localStorage/sessionStorage/IndexedDB anywhere in this module", () => {
  it("orchestrator.ts source never references localStorage, sessionStorage, or indexedDB", () => {
    const src = orchestratorSource();
    expect(src).not.toMatch(/localStorage/);
    expect(src).not.toMatch(/sessionStorage/);
    expect(src).not.toMatch(/indexedDB/i);
  });
});

// ---------------------------------------------------------------------------
// T28 — no direct Blob client use anywhere in the new recovery code.
// ---------------------------------------------------------------------------

describe("T28 — recovery code never touches the Blob client directly", () => {
  it("resumeFromBatchId/runResumeFromDetail/runResumeReadyWorksheetRecovery never reference uploadFileDirectToBlob/put/getPayloadFromClientToken", () => {
    const src = orchestratorSource();
    const start = src.indexOf("async resumeFromBatchId(");
    const end = src.lastIndexOf("\n}"); // end of class
    const recoverySection = src.slice(start, end);
    expect(recoverySection).not.toMatch(/uploadFileDirectToBlob/);
    expect(recoverySection).not.toMatch(/\bput\(/);
    expect(recoverySection).not.toMatch(/getPayloadFromClientToken/);
  });
});

// ---------------------------------------------------------------------------
// T29 — no raw storage locator exposure: structurally impossible, since
// neither ImportBatchDetailDTOClient nor WorksheetSummaryDTOClient carries
// any storage-internal field, and the recovery code never introduces one.
// ---------------------------------------------------------------------------

describe("T29 — no raw storage locator exposure", () => {
  it("recovery code never references storage_key/etag/provider/pathname", () => {
    const src = orchestratorSource();
    const start = src.indexOf("async resumeFromBatchId(");
    const recoverySection = src.slice(start);
    expect(recoverySection).not.toMatch(/storage_key/);
    expect(recoverySection).not.toMatch(/\betag\b/);
    expect(recoverySection).not.toMatch(/\bprovider\b/);
    expect(recoverySection).not.toMatch(/pathname/);
  });
});

// ---------------------------------------------------------------------------
// T30 — no new backend route: the known Data Hub route file set is
// unchanged.
// ---------------------------------------------------------------------------

describe("T30 — no new backend route was introduced", () => {
  it("the app/api/data-hub route.ts file set matches the known 5A.3D.0 baseline exactly", () => {
    const apiDir = path.join(process.cwd(), "app", "api", "data-hub");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts") found.push(path.relative(apiDir, full).replace(/\\/g, "/"));
      }
    };
    walk(apiDir);
    found.sort();
    expect(found).toEqual(
      [
        "import-batches/route.ts",
        "import-batches/[id]/route.ts",
        "import-batches/[id]/finalize/route.ts",
        "import-batches/[id]/inspect/route.ts",
        "import-batches/[id]/worksheets/route.ts",
        "worksheets/[id]/route.ts",
        "worksheets/[id]/preview/route.ts",
        "worksheets/[id]/confirm-illegal-dumping/route.ts",
      ].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// T31 — no XLS/XLSX enablement.
// ---------------------------------------------------------------------------

describe("T31 — no XLS/XLSX enablement", () => {
  it("recovery code never references xlsx/xls or workbookParser", () => {
    const src = orchestratorSource();
    const start = src.indexOf("async resumeFromBatchId(");
    const recoverySection = src.slice(start);
    expect(recoverySection.toLowerCase()).not.toMatch(/xlsx/);
    expect(recoverySection).not.toMatch(/workbookParser/);
  });
});

// ---------------------------------------------------------------------------
// T32 — legacy /data upload pipeline untouched by this diff (structural
// proof: these files are never imported by the client package at all).
// ---------------------------------------------------------------------------

describe("extra invariant — recovery code never bypasses the httpClient abstraction with a raw fetch call", () => {
  it("resumeFromBatchId/runResumeFromDetail/runResumeReadyWorksheetRecovery never call a bare fetch(", () => {
    const src = orchestratorSource();
    const start = src.indexOf("async resumeFromBatchId(");
    const recoverySection = src.slice(start);
    expect(recoverySection).not.toMatch(/[^.\w]fetch\(/);
  });
});

describe("T32 — legacy /data upload pipeline untouched", () => {
  it("orchestrator.ts never imports the legacy upload/schema-detector/column-mapper modules", () => {
    const src = orchestratorSource();
    expect(src).not.toMatch(/services\/upload/);
    expect(src).not.toMatch(/schema-detector/);
    expect(src).not.toMatch(/column-mapper/);
  });
});
