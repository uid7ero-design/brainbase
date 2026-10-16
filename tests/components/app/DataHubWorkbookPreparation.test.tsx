import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import WorkbookPreparationClient from "@/app/data-hub/import/[batchId]/preparation/WorkbookPreparationClient";

const row = (index = 0, extra = {}) => ({ id: `w${index}`, importBatchId: "batch", worksheetIndex: index,
  worksheetName: "Same name", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION", ...extra });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function setup(worksheets = [row(), row(1), row(2, { worksheetVisibility: "hidden" })]) {
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    expect(options.method).toBe("GET");
    if (url.endsWith("/worksheets")) return reply({ worksheets });
    const id = url.split("/").at(-2), step = url.split("/").at(-1);
    return reply({ ok: true, status: id === "w0" ? "SUCCEEDED" : step === "profile" ? "NOT_READY" : "NOT_STARTED",
      ...(id === "w0" ? { rowCount: 0, columnCount: 4 } : {}) });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
async function loaded() { await screen.findByRole("link", { name: "Open preparation for worksheet 1" }); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("workbook preparation overview", () => {
  it("opens by reading persisted inventory only and distinguishes unchecked worksheets", async () => {
    const fetcher = setup(); render(<WorkbookPreparationClient batchId="batch" />); await loaded();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/data-hub/import-batches/batch/worksheets");
    expect(screen.getAllByText("Not checked", { exact: true })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "Review worksheet 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open preparation for worksheet 3" })).not.toBeInTheDocument();
  });
  it("checks eligible worksheets explicitly, filters current observations and links to review without writes", async () => {
    const fetcher = setup(); render(<WorkbookPreparationClient batchId="batch" />); await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Check preparation" }));
    expect(await screen.findByRole("link", { name: "Review worksheet 1" })).toHaveAttribute("href", "/data-hub/analysis/w0");
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(screen.getByRole("combobox")).toHaveAccessibleName("Show worksheets");
    expect(fetcher.mock.calls.some(([url]) => url.includes("/w2/"))).toBe(false);
    fireEvent.change(screen.getByLabelText("Show worksheets"), { target: { value: "ready" } });
    expect(screen.getByRole("heading", { name: "Same name (worksheet 1)" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Same name (worksheet 2)" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Show worksheets"), { target: { value: "needs" } });
    expect(screen.getByRole("heading", { name: "Same name (worksheet 2)" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review worksheet 2" })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.every(([, options]) => options.method === "GET" && options.body === undefined)).toBe(true);
  });
  it("refreshing inventory clears prior readiness and never starts another scan", async () => {
    const fetcher = setup(); render(<WorkbookPreparationClient batchId="batch" />); await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Check preparation" })); await screen.findByRole("link", { name: "Review worksheet 1" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh worksheet list" })); await loaded();
    expect(screen.queryByRole("link", { name: "Review worksheet 1" })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(8);
  });
  it("keeps a failed worksheet unconfirmed while other checked worksheets remain visible", async () => {
    const fetcher = setup(), original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, options) => url.includes('/w1/') ? Promise.resolve(reply({ error: "private error" }, 503)) : original(url, options));
    render(<WorkbookPreparationClient batchId="batch" />); await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Check preparation" })); await screen.findByRole("link", { name: "Review worksheet 1" });
    expect(screen.getByText("Needs attention", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("private error")).not.toBeInTheDocument();
  });
  it.each([401, 403, 404])("clears the inventory and completed results if a scan receives HTTP %s", async status => {
    const fetcher = setup(), original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, options) => url.includes('/w1/') ? Promise.resolve(reply({}, status)) : original(url, options));
    render(<WorkbookPreparationClient batchId="batch" />); await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Check preparation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable or your access has changed");
    expect(screen.queryByRole("heading", { name: /Same name/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review worksheet 1" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check preparation" })).toBeDisabled();
  });
  it("stops a stalled scan, clears old readiness and requires an explicit new check", async () => {
    const fetcher = setup(), original = fetcher.getMockImplementation()!;
    render(<WorkbookPreparationClient batchId="batch" />); await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Check preparation" })); await screen.findByRole("link", { name: "Review worksheet 1" });
    fetcher.mockImplementation((url, options) => url.endsWith('/worksheets') ? original(url, options) : new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Check preparation" }));
    expect(screen.queryByRole("link", { name: "Review worksheet 1" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop checking" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Checking stopped");
    const calls = fetcher.mock.calls.length; await act(async () => { await Promise.resolve(); });
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect(screen.getByRole("button", { name: "Check preparation" })).toBeEnabled();
    expect(screen.getAllByText("Not checked", { exact: true })).toHaveLength(2);
  });
  it("times out initial inventory even if fetch ignores abort", async () => {
    vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<WorkbookPreparationClient batchId="batch" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("took too long");
    expect(screen.getByRole("button", { name: "Refresh worksheet list" })).toBeEnabled();
  });
  it("ignores a stale inventory response after the workbook changes", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn((url: string) => url.includes('/old/') ? new Promise<Response>(resolve => { finish = resolve; })
      : Promise.resolve(reply({ worksheets: [row(1, { importBatchId: "new" })] })));
    vi.stubGlobal("fetch", fetcher);
    const view = render(<WorkbookPreparationClient batchId="old" />); view.rerender(<WorkbookPreparationClient batchId="new" />);
    await screen.findByRole("link", { name: "Open preparation for worksheet 2" });
    await act(async () => { finish(reply({ worksheets: [row(0, { importBatchId: "old" })] })); });
    expect(screen.queryByRole("link", { name: "Open preparation for worksheet 1" })).not.toBeInTheDocument();
  });
  it("bounds a whole 50-worksheet scan and clears partial observations at its deadline", async () => {
    const fetcher = setup(Array.from({ length: 50 }, (_, index) => row(index)));
    render(<WorkbookPreparationClient batchId="batch" />); await loaded();
    fetcher.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Check preparation" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("took too long");
    expect(screen.getAllByText("Not checked", { exact: true })).toHaveLength(50);
    expect(screen.getByRole("button", { name: "Check preparation" })).toBeEnabled();
    expect(fetcher.mock.calls.length).toBeLessThan(151);
  });
  it("blocks same-tick duplicate scans and aborts requests when leaving", async () => {
    const fetcher = setup(), original = fetcher.getMockImplementation()!, signals: AbortSignal[] = [];
    const view = render(<WorkbookPreparationClient batchId="batch" />); await loaded();
    fetcher.mockImplementation((url, options) => {
      if (url.endsWith('/worksheets')) return original(url, options);
      signals.push(options.signal as AbortSignal); return new Promise(() => {});
    });
    const button = screen.getByRole("button", { name: "Check preparation" }); fireEvent.click(button); fireEvent.click(button);
    expect(signals).toHaveLength(6); view.unmount();
    expect(signals.every(signal => signal.aborted)).toBe(true);
  });
  it("renders empty and excluded-only workbooks without preparation actions", async () => {
    setup([]); const view = render(<WorkbookPreparationClient batchId="batch" />);
    await screen.findByText(/No worksheets have been inspected/); expect(screen.getByRole("button", { name: "Check preparation" })).toBeDisabled();
    view.unmount(); setup([row(0, { worksheetIsEmpty: true })]); render(<WorkbookPreparationClient batchId="batch" />);
    await screen.findByText("Outside preparation", { exact: true }); expect(screen.getByRole("button", { name: "Check preparation" })).toBeDisabled();
  });
  it("has labelled controls and no automated accessibility violations before and after checking", async () => {
    setup(); const view = render(<WorkbookPreparationClient batchId="batch" />); await loaded();
    expect((await axe(view.container)).violations).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Check preparation" })); await screen.findByRole("link", { name: "Review worksheet 1" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Check preparation" })).toBeEnabled());
    expect((await axe(view.container)).violations).toEqual([]);
  });
});
