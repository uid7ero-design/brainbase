import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareWorkbookSelection, MAX_PREPARATION_SELECTION, QUEUE_WORKSHEET_TIMEOUT_MS,
  PREPARATION_QUEUE_TIMEOUT_MS } from "@/lib/data-hub/client/workbookPreparationQueue";
import type { WorkbookWorksheet } from "@/lib/data-hub/client/workbookPreparation";

const sheet = (index = 0): WorkbookWorksheet => ({ id: `w${index}`, name: "Same name", index, excluded: false });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const inventory = (sheets: WorkbookWorksheet[]) => ({ worksheets: sheets.map(row => ({ id: row.id, importBatchId: "batch",
  worksheetIndex: row.index, worksheetName: row.name, worksheetVisibility: row.excluded ? "hidden" : "visible",
  worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION" })) });
function setup(sheets = [sheet(), sheet(1)]) {
  const states = new Map(sheets.map(row => [row.id, { stage: "NOT_STARTED", normalize: "NOT_STARTED", profile: "NOT_READY" }]));
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith("/worksheets")) return reply(inventory(sheets));
    const parts = url.split("/"), id = decodeURIComponent(parts.at(-2)!), step = parts.at(-1)! as "stage" | "normalize" | "profile";
    const state = states.get(id)!;
    expect(options.body).toBeUndefined(); expect(options.credentials).toBe("same-origin"); expect(options.cache).toBe("no-store");
    if (options.method === "POST") { state[step] = "SUCCEEDED"; if (step === "normalize") state.profile = "NOT_STARTED"; }
    return reply({ ok: true, status: state[step], rowCount: 3, columnCount: 4 });
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, states, original: fetcher.getMockImplementation()! };
}
const posts = (fetcher: ReturnType<typeof setup>["fetcher"]) => fetcher.mock.calls.filter(([, options]) => options.method === "POST").map(([url]) => url);
const run = (sheets = [sheet(), sheet(1)], progress = vi.fn(), signal = new AbortController().signal) => prepareWorkbookSelection("batch", sheets, signal, progress);
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("confirmed, bounded worksheet preparation queue", () => {
  it("revalidates inventory, runs physical worksheet order and reloads statuses after each successful write", async () => {
    const { fetcher } = setup(); const progress = vi.fn();
    await expect(run([sheet(1), sheet()], progress)).resolves.toEqual({ complete: true });
    expect(fetcher.mock.calls[0][0]).toBe("/api/data-hub/import-batches/batch/worksheets");
    expect(posts(fetcher)).toEqual([0, 1].flatMap(i => ["stage", "normalize", "profile"].map(step => `/api/data-hub/worksheets/w${i}/${step}`)));
    const methods = fetcher.mock.calls.map(([, options]) => options.method);
    expect(methods).toEqual(["GET", ...[0, 1].flatMap(() => ["GET", "GET", "GET", ...[0, 1, 2].flatMap(() => ["POST", "GET", "GET", "GET"])])]);
    expect(progress.mock.calls.filter(([, value]) => value.phase === "ready").map(([id]) => id)).toEqual(["w0", "w1"]);
  });
  it("reuses completed steps and never posts a completed worksheet", async () => {
    const { fetcher, states } = setup(); states.set("w0", { stage: "SUCCEEDED", normalize: "SUCCEEDED", profile: "SUCCEEDED" });
    states.set("w1", { stage: "SUCCEEDED", normalize: "SUCCEEDED", profile: "NOT_STARTED" });
    await run(); expect(posts(fetcher)).toEqual(["/api/data-hub/worksheets/w1/profile"]);
  });
  it.each(["RUNNING", "FAILED", "ABANDONED"])("stops before POST or later worksheets when the next step is %s", async status => {
    const { fetcher, states } = setup(); states.get("w0")!.stage = status; const progress = vi.fn();
    await expect(run(undefined, progress)).resolves.toEqual({ complete: false });
    expect(posts(fetcher)).toEqual([]); expect(fetcher.mock.calls.some(([url]) => url.includes("/w1/"))).toBe(false);
    expect(progress).toHaveBeenLastCalledWith("w0", expect.objectContaining({ phase: "attention" }));
  });
  it("refuses inconsistent downstream success without starting or rerunning work", async () => {
    const { fetcher, states } = setup(); states.get("w0")!.normalize = "SUCCEEDED";
    await expect(run()).resolves.toEqual({ complete: false }); expect(posts(fetcher)).toEqual([]);
  });
  it("never auto-continues a yielded 202 and does not start the next worksheet", async () => {
    const { fetcher, original, states } = setup();
    fetcher.mockImplementation((url, options) => {
      if (options.method === "POST") { states.get("w0")!.stage = "RUNNING"; return Promise.resolve(reply({ ok: true, status: "RUNNING" }, 202)); }
      return original(url, options);
    });
    await expect(run()).resolves.toEqual({ complete: false }); expect(posts(fetcher)).toHaveLength(1);
    expect(fetcher.mock.calls.some(([url]) => url.includes("/w1/"))).toBe(false);
  });
  it.each(["missing", "excluded", "position", "name", "foreign"])("rejects changed %s inventory before preparation writes", async change => {
    const { fetcher, original } = setup();
    fetcher.mockImplementation((url, options) => {
      if (!url.endsWith("/worksheets")) return original(url, options);
      const body = inventory([sheet(), sheet(1)]);
      if (change === "missing") body.worksheets.shift();
      if (change === "excluded") body.worksheets[0].worksheetVisibility = "hidden";
      if (change === "position") body.worksheets[0].worksheetIndex = 2;
      if (change === "name") body.worksheets[0].worksheetName = "Changed";
      if (change === "foreign") body.worksheets[0].importBatchId = "other";
      return Promise.resolve(reply(body));
    });
    await expect(run()).rejects.toThrow(); expect(posts(fetcher)).toEqual([]);
  });
  it.each([401, 403, 404, 503])("halts on HTTP %s without another write or leaking diagnostics", async status => {
    const { fetcher, original } = setup();
    fetcher.mockImplementation((url, options) => options.method === "POST" ? Promise.resolve(reply({ private: "secret" }, status)) : original(url, options));
    await expect(run()).rejects.not.toThrow("secret"); expect(posts(fetcher)).toHaveLength(1);
    expect(fetcher.mock.calls.some(([url]) => url.includes("/w1/"))).toBe(false);
  });
  it("stops after a successful POST if reloading status fails, without retry", async () => {
    const { fetcher, original } = setup(); let written = false;
    fetcher.mockImplementation((url, options) => {
      if (options.method === "POST") { written = true; return original(url, options); }
      return written ? Promise.resolve(reply({ private: "secret" }, 503)) : original(url, options);
    });
    await expect(run()).rejects.toThrow("PREPARATION_FAILED"); expect(posts(fetcher)).toHaveLength(1);
  });
  it("cancels an in-flight POST, discards its late response and never sends downstream work", async () => {
    const { fetcher, original } = setup(); let finish!: (r: Response) => void;
    fetcher.mockImplementation((url, options) => options.method === "POST" ? new Promise(resolve => { finish = resolve; }) : original(url, options));
    const controller = new AbortController(), progress = vi.fn(); const work = run(undefined, progress, controller.signal);
    await vi.waitFor(() => expect(posts(fetcher)).toHaveLength(1));
    const rejected = expect(work).rejects.toThrow("REQUEST_CANCELLED"); controller.abort(); await rejected;
    const count = progress.mock.calls.length; finish(reply({ ok: true, status: "SUCCEEDED" })); await Promise.resolve();
    expect(posts(fetcher)).toHaveLength(1); expect(progress).toHaveBeenCalledTimes(count);
  });
  it("enforces the worksheet deadline even when the network ignores abort", async () => {
    const { fetcher, original } = setup(); vi.useFakeTimers();
    fetcher.mockImplementation((url, options) => url.endsWith("/worksheets") ? original(url, options) : new Promise(() => {}));
    const work = run(); const rejected = expect(work).rejects.toThrow("QUEUE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(QUEUE_WORKSHEET_TIMEOUT_MS); await rejected; expect(posts(fetcher)).toEqual([]);
  });
  it("bounds a stalled fresh inventory without sending preparation", async () => {
    vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const work = run(); const rejected = expect(work).rejects.toThrow("QUEUE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(PREPARATION_QUEUE_TIMEOUT_MS); await rejected; expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("enforces a shared five-minute deadline across otherwise successful worksheets", async () => {
    vi.useFakeTimers(); const sheets = Array.from({ length: 10 }, (_, i) => sheet(i));
    const { fetcher, original, states } = setup(sheets);
    for (const state of states.values()) Object.assign(state, { stage: "SUCCEEDED", normalize: "SUCCEEDED", profile: "SUCCEEDED" });
    fetcher.mockImplementation((url, options) => url.endsWith("/worksheets") ? original(url, options)
      : new Promise(resolve => { setTimeout(() => { void original(url, options).then(resolve); }, 55_000); }));
    const progress = vi.fn(); const work = run(sheets, progress); const rejected = expect(work).rejects.toThrow("QUEUE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(PREPARATION_QUEUE_TIMEOUT_MS); await rejected;
    expect(progress.mock.calls.filter(([, value]) => value.phase === "ready")).toHaveLength(5);
    expect(fetcher.mock.calls.some(([url]) => url.includes("/w6/"))).toBe(false); expect(posts(fetcher)).toEqual([]);
  });
  it.each([[], [sheet(), sheet()], [{ ...sheet(), excluded: true }], Array.from({ length: MAX_PREPARATION_SELECTION + 1 }, (_, i) => sheet(i))].map(rows => [rows]))("rejects invalid selection without any read or write", async rows => {
    const { fetcher } = setup(); await expect(run(rows)).rejects.toThrow("SELECTION_INVALID"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("captures selected membership before async inventory reads and preserves opaque IDs", async () => {
    const selected = [{ ...sheet(), id: "__proto__" }]; const { fetcher, original } = setup([...selected, sheet(1)]);
    let finish!: (r: Response) => void;
    fetcher.mockImplementation((url, options) => url.endsWith("/worksheets") ? new Promise(resolve => { finish = resolve; }) : original(url, options));
    const work = run(selected); selected.push(sheet(1));
    finish(reply(inventory([{ ...sheet(), id: "__proto__" }, sheet(1)]))); await work;
    expect(posts(fetcher)).toHaveLength(3); expect(posts(fetcher).every(url => url.includes("/__proto__/"))).toBe(true);
  });
});
