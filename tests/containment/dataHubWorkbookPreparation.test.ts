import { afterEach, describe, expect, it, vi } from "vitest";
import { checkWorkbookWorksheets, decodeWorkbookWorksheets, workbookWorksheetState,
  WORKSHEET_CHECK_TIMEOUT_MS } from "@/lib/data-hub/client/workbookPreparation";
import { preparationJson, MAX_PREPARATION_RESPONSE_BYTES } from "@/lib/data-hub/client/preparationTransport";
import type { PreparationSnapshot } from "@/lib/data-hub/client/preparation";

const row = (index = 0) => ({ id: `w${index}`, importBatchId: "batch", worksheetIndex: index,
  worksheetName: "Same name", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION" });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sheet = (index = 0) => decodeWorkbookWorksheets({ worksheets: [row(index)] }, "batch")[0];
const snapshot = (stage = "SUCCEEDED", normalize = "SUCCEEDED", profile = "SUCCEEDED") =>
  ({ stage: { status: stage }, normalize: { status: normalize }, profile: { status: profile } }) as PreparationSnapshot;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("workbook metadata admission and honest status", () => {
  it("projects only needed metadata, distinguishes duplicate names and sorts physical positions", () => {
    const rows = decodeWorkbookWorksheets({ worksheets: [{ ...row(1), failure_detail: "private", storage_key: "private" }, row()] }, "batch");
    expect(rows).toEqual([{ id: "w0", name: "Same name", index: 0, excluded: false }, { id: "w1", name: "Same name", index: 1, excluded: false }]);
  });
  it.each([
    { worksheets: [row(), row()] }, { worksheets: [row(), { ...row(1), worksheetIndex: 0 }] },
    { worksheets: [{ ...row(), importBatchId: "foreign" }] }, { worksheets: Array.from({ length: 51 }, (_, i) => row(i)) },
    { worksheets: [{ ...row(), worksheetVisibility: "invented" }] }, { worksheets: [{ ...row(), canonicalStatus: "invented" }] },
    { worksheets: [{ ...row(), worksheetIsEmpty: null }] }, { worksheets: [{ ...row(), worksheetIndex: -1 }] },
    { worksheets: [{ ...row(), id: " " }] }, { worksheets: [null] }, { worksheets: null }, null,
    { worksheets: [{ ...row(), worksheetIndex: Number.MAX_SAFE_INTEGER }] },
    { worksheets: [{ ...row(), id: "a".repeat(513) }] }, { worksheets: [{ ...row(), worksheetName: "a".repeat(4097) }] },
  ])("rejects the whole malformed or mismatched inventory: %j", body => {
    expect(() => decodeWorkbookWorksheets(body, "batch")).toThrow("RESPONSE_INVALID");
  });
  it("accepts an empty inventory and the full 50 worksheet bound", () => {
    expect(decodeWorkbookWorksheets({ worksheets: [] }, "batch")).toEqual([]);
    expect(decodeWorkbookWorksheets({ worksheets: Array.from({ length: 50 }, (_, i) => row(i)) }, "batch")).toHaveLength(50);
  });
  it.each([{ worksheetVisibility: "hidden" }, { worksheetVisibility: "veryHidden" }, { worksheetIsEmpty: true }, { canonicalStatus: "INELIGIBLE" }, { canonicalStatus: "SKIPPED" }])("excludes without dropping metadata: %j", change => {
    expect(decodeWorkbookWorksheets({ worksheets: [{ ...row(), ...change }] }, "batch")[0].excluded).toBe(true);
  });
  it.each([
    [snapshot(), "ready"], [snapshot("NOT_STARTED", "NOT_STARTED", "NOT_READY"), "needs"],
    [snapshot("RUNNING", "NOT_STARTED", "NOT_READY"), "running"], [snapshot("SUCCEEDED", "FAILED", "NOT_READY"), "attention"],
    [snapshot("SUCCEEDED", "ABANDONED", "NOT_READY"), "attention"], [snapshot("NOT_STARTED", "SUCCEEDED", "SUCCEEDED"), "attention"],
    [snapshot("SUCCEEDED", "NOT_STARTED", "SUCCEEDED"), "attention"],
  ] as const)("classifies ordered step observations honestly", (value, expected) => {
    expect(workbookWorksheetState(sheet(), { snapshot: value })).toBe(expected);
  });
  it("never equates unknown, failed checks or excluded worksheets with readiness", () => {
    expect(workbookWorksheetState(sheet())).toBe("unchecked");
    expect(workbookWorksheetState(sheet(), { failed: true })).toBe("attention");
    expect(workbookWorksheetState({ ...sheet(), excluded: true }, { snapshot: snapshot() })).toBe("excluded");
  });
});

describe("bounded preparation response transport", () => {
  it.each(["text/html", "text/plain"])("rejects a non-JSON success (%s)", async type => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{}', { headers: { "content-type": type } })));
    await expect(preparationJson("/safe", "GET", new AbortController().signal)).rejects.toThrow("RESPONSE_INVALID");
  });
  it.each(["{", new Uint8Array([0xff])])("rejects malformed JSON or UTF-8", async body => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "application/json" } })));
    await expect(preparationJson("/safe", "GET", new AbortController().signal)).rejects.toThrow("RESPONSE_INVALID");
  });
  it("bounds actual streamed bytes despite a false Content-Length", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_PREPARATION_RESPONSE_BYTES + 1)); }, cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { headers: { "content-type": "application/json", "content-length": "2" } })));
    await expect(preparationJson("/safe", "GET", new AbortController().signal)).rejects.toThrow("RESPONSE_INVALID");
    expect(cancel).toHaveBeenCalled();
  });
  it.each([401, 403, 404])("sanitizes HTTP %s even when its response isn't JSON", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private", { status })));
    await expect(preparationJson("/safe", "GET", new AbortController().signal)).rejects.toThrow({ 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "UPLOAD_NOT_FOUND" }[status]);
  });
  it("releases a canceled request even if fetch ignores abort", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const controller = new AbortController();
    const request = preparationJson("/safe", "GET", controller.signal);
    const rejected = expect(request).rejects.toThrow("REQUEST_CANCELLED"); controller.abort(); await rejected;
  });
  it("releases a canceled streamed body and cancels its reader", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } })));
    const controller = new AbortController(); const request = preparationJson("/safe", "GET", controller.signal);
    await Promise.resolve(); await Promise.resolve();
    const rejected = expect(request).rejects.toThrow("REQUEST_CANCELLED"); controller.abort(); await rejected;
    expect(cancel).toHaveBeenCalled();
  });
});

describe("bounded read-only scan", () => {
  it("starts at most two worksheet checks, skips excluded rows and sends only six GETs at once", async () => {
    let active = 0, maximum = 0;
    const waiting: (() => void)[] = [];
    const fetcher = vi.fn((_url: string, options: RequestInit) => {
      active++; maximum = Math.max(active, maximum);
      expect(options.method).toBe("GET"); expect(options.body).toBeUndefined(); expect(options.cache).toBe("no-store");
      return new Promise<Response>(resolve => waiting.push(() => { active--; resolve(reply({ ok: true, status: "NOT_STARTED" })); }));
    });
    vi.stubGlobal("fetch", fetcher);
    const results = vi.fn();
    const work = checkWorkbookWorksheets([sheet(0), sheet(1), sheet(2), { ...sheet(3), excluded: true }], new AbortController().signal, results);
    expect(fetcher).toHaveBeenCalledTimes(6);
    waiting.splice(0).forEach(resolve => resolve());
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(9));
    waiting.splice(0).forEach(resolve => resolve()); await work;
    expect(maximum).toBe(6); expect(results).toHaveBeenCalledTimes(3);
  });
  it("reports a timed-out worksheet as unconfirmed and continues the bounded queue", async () => {
    vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const results = vi.fn(); const work = checkWorkbookWorksheets([sheet()], new AbortController().signal, results);
    await vi.advanceTimersByTimeAsync(WORKSHEET_CHECK_TIMEOUT_MS); await work;
    expect(results).toHaveBeenCalledWith("w0", { failed: true });
  });
  it("aborts all sibling reads and stops the queue on a scope denial", async () => {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn((_url: string, options: RequestInit) => {
      signals.push(options.signal as AbortSignal);
      return signals.length === 1 ? Promise.resolve(reply({}, 403)) : new Promise<Response>(() => {});
    }); vi.stubGlobal("fetch", fetcher); const results = vi.fn();
    await expect(checkWorkbookWorksheets([sheet(0), sheet(1), sheet(2)], new AbortController().signal, results)).rejects.toThrow("FORBIDDEN");
    expect(fetcher).toHaveBeenCalledTimes(6); expect(signals.every(signal => signal.aborted)).toBe(true); expect(results).not.toHaveBeenCalled();
  });
  it("cancellation stops queued checks and drops late results", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const controller = new AbortController(), results = vi.fn();
    const work = checkWorkbookWorksheets([sheet(0), sheet(1), sheet(2)], controller.signal, results);
    const rejected = expect(work).rejects.toThrow("REQUEST_CANCELLED"); controller.abort(); await rejected;
    expect(results).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(6);
  });
});
