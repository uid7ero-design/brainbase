import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPlanningText, MAX_PLANNING_RESPONSE_BYTES, PLANNING_REQUEST_TIMEOUT_MS } from "@/lib/data-hub/client/planningTransport";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const json = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
const call = (controller = new AbortController()) => fetchPlanningText("/planning", { cache: "no-store" }, controller);
describe("bounded planning transport", () => {
  it("preserves HTTP outcome and split UTF-8 while measuring actual streamed bytes", async () => {
    const bytes = new TextEncoder().encode('{"label":"é"}');
    const body = new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close();
    } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 503, headers: { "Content-Type": "application/json" } })));
    expect(await call()).toEqual({ ok: true, text: '{"label":"é"}', httpOk: false });
  });
  it("accepts the byte limit exactly and ignores an inflated Content-Length", async () => {
    const response = json(" ".repeat(MAX_PLANNING_RESPONSE_BYTES)); response.headers.set("Content-Length", "99999999");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const result = await call(); expect(result.ok).toBe(true);
    if (result.ok) expect(result.text.length).toBe(MAX_PLANNING_RESPONSE_BYTES);
  });
  it("rejects multibyte overflow and cancels the body despite understated Content-Length", async () => {
    const cancel = vi.fn(); const bytes = new TextEncoder().encode("é".repeat(MAX_PLANNING_RESPONSE_BYTES / 2 + 1));
    const body = new ReadableStream({ start(controller) { controller.enqueue(bytes); }, cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "Content-Type": "application/json", "Content-Length": "1" } })));
    expect(await call()).toEqual({ ok: false, code: "PLANNING_RESPONSE_INVALID" }); expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["text/html", "text/plain", "application/problem+json"])("rejects unexpected content type %s", async contentType => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-diagnostic", { headers: { "Content-Type": contentType } })));
    expect(await call()).toEqual({ ok: false, code: "PLANNING_RESPONSE_INVALID" });
  });
  it("rejects invalid UTF-8 rather than silently repairing it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([0xc3, 0x28]), { headers: { "Content-Type": "application/json" } })));
    expect(await call()).toEqual({ ok: false, code: "PLANNING_RESPONSE_INVALID" });
  });
  it("contains network exceptions without exposing their messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private-diagnostic")));
    expect(await call()).toEqual({ ok: false, code: "REQUEST_FAILED" });
  });
  it("times out even if fetch ignores abort, and releases its timer", async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const pending = call(controller); await vi.advanceTimersByTimeAsync(PLANNING_REQUEST_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, code: "REQUEST_TIMED_OUT" });
    expect(controller.signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("times out a stalled response body, not only waiting for headers", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); }, cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { headers: { "Content-Type": "application/json" } })));
    const pending = call(); await vi.advanceTimersByTimeAsync(PLANNING_REQUEST_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, code: "REQUEST_TIMED_OUT" }); expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels immediately even if fetch ignores abort, with no automatic retry", async () => {
    vi.useFakeTimers(); const controller = new AbortController(); const fetcher = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher); const pending = call(controller); controller.abort();
    expect(await pending).toEqual({ ok: false, code: "REQUEST_CANCELLED" });
    expect(fetcher).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    expect(await call(controller)).toEqual({ ok: false, code: "REQUEST_CANCELLED" }); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("discards and cancels a late body from a transport that ignored abort", async () => {
    const controller = new AbortController(); let done!: (response: Response) => void; const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { done = resolve; })));
    const pending = call(controller); controller.abort();
    expect(await pending).toEqual({ ok: false, code: "REQUEST_CANCELLED" });
    const body = new ReadableStream({ cancel }); done(new Response(body, { headers: { "Content-Type": "application/json" } }));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });
});
