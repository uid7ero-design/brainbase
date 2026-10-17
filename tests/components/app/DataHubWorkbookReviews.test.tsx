import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import WorkbookReviewsClient from "@/app/data-hub/import/[batchId]/reviews/WorkbookReviewsClient";

const row = (index: number, extra = {}) => ({ id: `w${index}`, importBatchId: "batch", worksheetIndex: index,
  worksheetName: "Same name", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION", ...extra });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function setup() {
  const worksheets = Array.from({ length: 6 }, (_, i) => row(i, i === 5 ? { worksheetVisibility: "hidden" } : {}));
  const states = ["REVIEWED_WITH_NOTICES", "QUALITY_HOLD", "REVIEW_REQUIRED", "PREPARATION_REQUIRED", "REVIEWED"];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.method).toBe("GET"); expect(init.body).toBeUndefined();
    if (url.endsWith("/worksheets")) return response({ worksheets });
    const id = url.split('/').at(-2)!, index = Number(id.slice(1)), state = states[index];
    return response({ ok: true, status: { statusVersion: "v1", uploadId: id, state,
      ...(["REVIEWED", "REVIEWED_WITH_NOTICES", "QUALITY_HOLD"].includes(state) ? { datasetProfileRunId: `profile-${id}`, reviewRevision: index + 1 } : {}) } });
  }); vi.stubGlobal("fetch", fetcher); return { fetcher, original: fetcher.getMockImplementation()!, worksheets };
}
async function loaded() { await screen.findByRole("heading", { name: "Same name (worksheet 1)" }); }
async function checked() {
  fireEvent.click(screen.getByRole("button", { name: "Check saved reviews" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Check saved reviews" })).toBeEnabled());
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("workbook saved review observations", () => {
  it("loads only inventory initially, explicitly checks metadata and filters without extra requests", async () => {
    const { fetcher } = setup(); render(<WorkbookReviewsClient batchId="batch" />); await loaded(); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Not checked", { exact: true })).toHaveLength(5); await checked(); expect(fetcher).toHaveBeenCalledTimes(6);
    expect(screen.getByText("The saved review includes acknowledged quality notices.")).toBeInTheDocument();
    expect(screen.getByText(/Saved review 2 · profile profile-w1/)).toBeInTheDocument();
    expect(screen.getByText("The saved review has a quality hold. Review the required corrections before continuing.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open review for worksheet 4" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open review for worksheet 6" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Show review status"), { target: { value: "hold" } });
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(6);
    expect(fetcher.mock.calls.some(([url]) => /analysis-(count|planning|review)(\/|$)/.test(url))).toBe(false);
  });
  it("keeps failed observations unconfirmed, hides diagnostics and preserves other results", async () => {
    const { fetcher, original } = setup(); fetcher.mockImplementation((url, init) => url.includes('/w1/') ? Promise.resolve(response({ private: "secret" }, 503)) : original(url, init));
    render(<WorkbookReviewsClient batchId="batch" />); await loaded(); await checked();
    expect(screen.getByText("Status unconfirmed", { exact: true })).toBeInTheDocument(); expect(screen.queryByText("secret")).not.toBeInTheDocument();
    expect(screen.getAllByText("Saved review complete", { exact: true })).toHaveLength(2);
  });
  it.each([401, 403, 404])("clears all rows/results after HTTP %s scope loss", async status => {
    const { fetcher, original } = setup(); render(<WorkbookReviewsClient batchId="batch" />); await loaded(); await checked();
    fetcher.mockImplementation((url, init) => url.includes('/analysis-status') ? Promise.resolve(response({}, status)) : original(url, init));
    fireEvent.click(screen.getByRole("button", { name: "Check saved reviews" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable or your access has changed");
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument(); expect(screen.queryByText(/Saved review 2/)).not.toBeInTheDocument();
  });
  it("clears old status immediately on refresh, reads no status automatically", async () => {
    const { fetcher } = setup(); render(<WorkbookReviewsClient batchId="batch" />); await loaded(); await checked();
    fireEvent.click(screen.getByRole("button", { name: "Refresh worksheet list" })); await loaded();
    expect(screen.queryByText(/Saved review 2/)).not.toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(7);
  });
  it("stops stalled checks, drops late results and permits only an explicit retry", async () => {
    const { fetcher, original } = setup(); render(<WorkbookReviewsClient batchId="batch" />); await loaded(); await checked();
    let release!: (r: Response) => void;
    fetcher.mockImplementation((url, init) => url.endsWith('/worksheets') ? original(url, init) : new Promise(resolve => { release = resolve; }));
    const check = screen.getByRole("button", { name: "Check saved reviews" }); fireEvent.click(check); fireEvent.click(check);
    expect(fetcher).toHaveBeenCalledTimes(8); fireEvent.click(screen.getByRole("button", { name: "Stop checking" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Checking stopped");
    await act(async () => { release(response({ ok: true, status: { statusVersion: "v1", uploadId: "w1", state: "REVIEWED", datasetProfileRunId: "p", reviewRevision: 1 } })); });
    expect(screen.queryByText(/Saved review 2/)).not.toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(8);
    fetcher.mockImplementation(original); await checked(); expect(screen.getByText(/Saved review 2/)).toBeInTheDocument();
  });
  it("bounds stalled inventory even when the network ignores abort", async () => {
    vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); render(<WorkbookReviewsClient batchId="batch" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); }); expect(screen.getByRole("alert")).toHaveTextContent("took too long");
  });
  it("aborts the old workbook on replacement and never restores old observations", async () => {
    const { fetcher, original } = setup(); const view = render(<WorkbookReviewsClient batchId="batch" />); await loaded();
    let signal!: AbortSignal; fetcher.mockImplementation((url, init) => {
      if (url.endsWith('/analysis-status')) { signal = init.signal as AbortSignal; return new Promise(() => {}); }
      return original(url, init);
    }); fireEvent.click(screen.getByRole("button", { name: "Check saved reviews" })); view.rerender(<WorkbookReviewsClient batchId="other" />);
    await screen.findByRole("alert"); expect(signal.aborted).toBe(true); expect(screen.queryByText(/Saved review 2/)).not.toBeInTheDocument();
  });
  it("handles empty inventory and passes automated accessibility checks before and after observations", async () => {
    const { worksheets } = setup(); const view = render(<WorkbookReviewsClient batchId="batch" />); await loaded();
    expect((await axe(view.container)).violations).toEqual([]); await checked(); expect((await axe(view.container)).violations).toEqual([]);
    view.unmount(); worksheets.splice(0); render(<WorkbookReviewsClient batchId="batch" />);
    await screen.findByText(/No worksheets have been inspected/); expect(screen.getByRole("button", { name: "Check saved reviews" })).toBeDisabled();
  });
});
