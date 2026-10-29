import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import WorksheetPreparationClient from "@/app/data-hub/prepare/[uploadId]/WorksheetPreparationClient";

type Step = "stage" | "normalize" | "profile";
type State = Record<Step, string>;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const success = (status: string) => ({ ok: true, status, ...(status === "SUCCEEDED" ? { rowCount: 0, cellCount: 0, columnCount: 4 } : {}) });
function setup(initial: State = { stage: "NOT_STARTED", normalize: "NOT_STARTED", profile: "NOT_READY" }) {
  const state = { ...initial };
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    const step = url.split("/").at(-1) as Step;
    if (options.method === "POST") {
      state[step] = "SUCCEEDED";
      if (step === "normalize") state.profile = "NOT_STARTED";
    }
    return reply(success(state[step]));
  });
  vi.stubGlobal("fetch", fetcher);
  return { state, fetcher };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("guided worksheet preparation", () => {
  it("opens with bounded status reads only and offers the first step", async () => {
    const { fetcher } = setup(); render(<WorksheetPreparationClient uploadId="worksheet/a" />);
    await screen.findByRole("button", { name: "Prepare source rows" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toMatch(/^\/api\/data-hub\/worksheets\/worksheet%2Fa\/(stage|normalize|profile)$/);
      expect(options.method).toBe("GET"); expect(options.cache).toBe("no-store"); expect(options.credentials).toBe("same-origin");
    }
    expect(screen.queryByRole("button", { name: "Standardize values" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open worksheet review" })).not.toBeInTheDocument();
  });
  it("runs only explicit ordered steps and verifies status before opening review", async () => {
    const { fetcher } = setup(); render(<WorksheetPreparationClient uploadId="worksheet" />);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare source rows" }));
    fireEvent.click(await screen.findByRole("button", { name: "Standardize values" }));
    fireEvent.click(await screen.findByRole("button", { name: "Build dataset profile" }));
    expect(await screen.findByRole("link", { name: "Open worksheet review" })).toHaveAttribute("href", "/data-hub/analysis/worksheet");
    const posts = fetcher.mock.calls.filter(([, options]) => options.method === "POST");
    expect(posts.map(([url]) => url.split("/").at(-1))).toEqual(["stage", "normalize", "profile"]);
    expect(posts.every(([, options]) => options.body === undefined)).toBe(true);
    expect(screen.getAllByText("0 rows")).toHaveLength(3);
  });
  it("keeps yielded staging explicit instead of automatically advancing", async () => {
    const { fetcher, state } = setup(); const defaultFetch = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, options) => {
      if (options.method === "POST") { state.stage = "RUNNING"; return reply(success("RUNNING"), 202); }
      return defaultFetch(url, options);
    });
    render(<WorksheetPreparationClient uploadId="worksheet" />);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare source rows" }));
    await screen.findByRole("button", { name: "Continue preparing" });
    expect(fetcher.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Standardize values" })).not.toBeInTheDocument();
  });
  it("requires status reconciliation after an uncertain write without replaying it", async () => {
    const { fetcher, state } = setup(), defaultFetch = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, options) => {
      if (options.method === "POST") { state.stage = "SUCCEEDED"; throw new Error("network private detail"); }
      return defaultFetch(url, options);
    });
    render(<WorksheetPreparationClient uploadId="worksheet" />);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare source rows" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refresh status before trying again");
    expect(screen.queryByRole("button", { name: "Prepare source rows" })).not.toBeInTheDocument();
    expect(screen.queryByText("network private detail")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await screen.findByRole("button", { name: "Standardize values" });
    expect(fetcher.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });
  it("does not offer another profile request while one is already running", async () => {
    const { fetcher } = setup({ stage: "SUCCEEDED", normalize: "SUCCEEDED", profile: "RUNNING" });
    render(<WorksheetPreparationClient uploadId="worksheet" />);
    await screen.findByText(/A profile request is already in progress/);
    expect(screen.queryByRole("button", { name: "Build dataset profile" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(6));
    expect(fetcher.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
  });
  it("blocks same-tick double clicks", async () => {
    const { fetcher } = setup(); let finish!: (response: Response) => void;
    const defaultFetch = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, options) => options.method === "POST" ? new Promise(resolve => { finish = resolve; }) : defaultFetch(url, options));
    render(<WorksheetPreparationClient uploadId="worksheet" />);
    const button = await screen.findByRole("button", { name: "Prepare source rows" });
    fireEvent.click(button); fireEvent.click(button);
    expect(fetcher.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
    await act(async () => finish(reply(success("SUCCEEDED"))));
  });
  it("stops waiting and reconciles before another action", async () => {
    const { fetcher } = setup(), defaultFetch = fetcher.getMockImplementation()!;
    let signal!: AbortSignal;
    fetcher.mockImplementation((url, options) => {
      if (options.method !== "POST") return defaultFetch(url, options);
      signal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    });
    render(<WorksheetPreparationClient uploadId="worksheet" />);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare source rows" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Stopped waiting"); expect(signal.aborted).toBe(true);
    expect(screen.queryByRole("button", { name: "Prepare source rows" })).not.toBeInTheDocument();
  });
  it("times out a pending request and keeps stale readiness hidden", async () => {
    const { fetcher } = setup(), defaultFetch = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, options) => options.method === "POST" ? new Promise((_resolve, reject) => {
      options.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }) : defaultFetch(url, options));
    render(<WorksheetPreparationClient uploadId="worksheet" />);
    const button = await screen.findByRole("button", { name: "Prepare source rows" });
    vi.useFakeTimers(); fireEvent.click(button); await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("This request took too long");
    expect(screen.queryByRole("link", { name: "Open worksheet review" })).not.toBeInTheDocument();
  });
  it("aborts requests when leaving the page", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      const signal = options.signal as AbortSignal; signals.push(signal);
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const mounted = render(<WorksheetPreparationClient uploadId="worksheet" />); mounted.unmount();
    expect(signals).toHaveLength(3); expect(signals.every(signal => signal.aborted)).toBe(true);
  });
  it("rejects malformed completion instead of enabling review", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ ok: true, status: "SUCCEEDED", rowCount: "private", columnCount: 4 })));
    render(<WorksheetPreparationClient uploadId="worksheet" />);
    await screen.findByRole("alert"); expect(screen.queryByRole("link", { name: "Open worksheet review" })).not.toBeInTheDocument();
    expect(screen.queryByText("private")).not.toBeInTheDocument();
  });
  it("aborts an active preparation request when navigating away", async () => {
    const { fetcher } = setup(), defaultFetch = fetcher.getMockImplementation()!; let signal!: AbortSignal;
    fetcher.mockImplementation((url, options) => {
      if (options.method !== "POST") return defaultFetch(url, options);
      signal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    });
    const mounted = render(<WorksheetPreparationClient uploadId="worksheet" />);
    fireEvent.click(await screen.findByRole("button", { name: "Prepare source rows" }));
    mounted.unmount(); expect(signal.aborted).toBe(true);
  });
  it("has accessible step labels and recovery controls", async () => {
    setup(); const { container } = render(<WorksheetPreparationClient uploadId="worksheet" />);
    await screen.findByRole("button", { name: "Prepare source rows" });
    expect(await axe(container)).toHaveNoViolations();
  });
});
