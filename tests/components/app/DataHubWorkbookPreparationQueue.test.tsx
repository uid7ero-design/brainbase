import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import WorkbookPreparationClient from "@/app/data-hub/import/[batchId]/preparation/WorkbookPreparationClient";

const row = (index = 0, extra = {}) => ({ id: `w${index}`, importBatchId: "batch", worksheetIndex: index,
  worksheetName: "Same name", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION", ...extra });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function setup(count = 2) {
  const worksheets = Array.from({ length: count }, (_, i) => row(i));
  const states = new Map(worksheets.map(row => [row.id, { stage: "NOT_STARTED", normalize: "NOT_STARTED", profile: "NOT_READY" }]));
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith("/worksheets")) return reply({ worksheets });
    const step = url.split("/").at(-1)! as "stage" | "normalize" | "profile", state = states.get(url.split("/").at(-2)!)!;
    if (options.method === "POST") { state[step] = "SUCCEEDED"; if (step === "normalize") state.profile = "NOT_STARTED"; }
    return reply({ ok: true, status: state[step], rowCount: 3, columnCount: 4 });
  });
  vi.stubGlobal("fetch", fetcher);
  return { worksheets, states, fetcher, original: fetcher.getMockImplementation()! };
}
async function loaded() { await screen.findByRole("checkbox", { name: "Select worksheet 1 for preparation" }); }
function select(index = 1) { fireEvent.click(screen.getByRole("checkbox", { name: `Select worksheet ${index} for preparation` })); }
function confirm() { fireEvent.click(screen.getByRole("button", { name: "Prepare selection" })); }
function start() { fireEvent.click(screen.getByRole("button", { name: "Start selected preparation" })); }
const writes = (fetcher: ReturnType<typeof setup>["fetcher"]) => fetcher.mock.calls.filter(([, options]) => options.method === "POST");
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("workbook preparation selection and recovery", () => {
  it("does no status read or write on selection/confirmation and shows all chosen identities across filters", async () => {
    const { fetcher } = setup(); render(<WorkbookPreparationClient batchId="batch" />); await loaded();
    select(2); select();
    fireEvent.change(screen.getByLabelText("Show worksheets"), { target: { value: "ready" } }); confirm();
    const region = screen.getByRole("region", { name: "Confirm worksheet preparation" });
    expect(within(region).getAllByRole("listitem").map(item => item.textContent)).toEqual(["Same name (worksheet 1)", "Same name (worksheet 2)"]);
    expect(region).toHaveTextContent("server work may still finish"); expect(fetcher).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep selecting" }));
    expect(screen.queryByRole("button", { name: "Start selected preparation" })).not.toBeInTheDocument();
  });
  it("limits selection to ten, omits excluded rows and clears consent after selection changes", async () => {
    const { worksheets } = setup(12); worksheets[11].worksheetVisibility = "hidden";
    render(<WorkbookPreparationClient batchId="batch" />); await loaded();
    expect(screen.queryByRole("checkbox", { name: "Select worksheet 12 for preparation" })).not.toBeInTheDocument();
    for (let i = 1; i <= 10; i++) select(i);
    expect(screen.getByRole("checkbox", { name: "Select worksheet 11 for preparation" })).toBeDisabled(); confirm(); select();
    expect(screen.queryByRole("button", { name: "Start selected preparation" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select worksheet 11 for preparation" })).toBeEnabled();
  });
  it("starts once after explicit confirmation, prepares only selected sheets and exposes individual reviews", async () => {
    const { fetcher } = setup(); render(<WorkbookPreparationClient batchId="batch" />); await loaded(); select(); confirm();
    const button = screen.getByRole("button", { name: "Start selected preparation" }); fireEvent.click(button); fireEvent.click(button);
    await screen.findByText("Selected worksheets are ready for their individual field and quality reviews.");
    expect(writes(fetcher)).toHaveLength(3); expect(fetcher.mock.calls.some(([url]) => url.includes("/w1/"))).toBe(false);
    expect(screen.getByRole("link", { name: "Review worksheet 1" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review worksheet 2" })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.some(([url]) => /analysis|count/.test(url))).toBe(false);
  });
  it("pauses on existing running work and blocks restart until an explicit read-only check", async () => {
    const { fetcher, states } = setup(); states.get("w0")!.stage = "RUNNING";
    render(<WorkbookPreparationClient batchId="batch" />); await loaded(); select(); select(2); confirm(); start();
    await screen.findByText(/Preparation paused at a worksheet/);
    expect(writes(fetcher)).toHaveLength(0); expect(fetcher.mock.calls.some(([url]) => url.includes("/w1/"))).toBe(false);
    expect(screen.getByRole("button", { name: "Prepare selection" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check preparation" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Prepare selection" })).toBeEnabled());
    expect(writes(fetcher)).toHaveLength(0);
  });
  it("requires read-only recovery after an uncertain POST, drops late success and never automatically retries", async () => {
    const { fetcher, original } = setup(); let finish!: (r: Response) => void;
    fetcher.mockImplementation((url, options) => options.method === "POST" ? new Promise(resolve => { finish = resolve; }) : original(url, options));
    render(<WorkbookPreparationClient batchId="batch" />); await loaded(); select(); select(2); confirm(); start();
    await waitFor(() => expect(writes(fetcher)).toHaveLength(1));
    expect(screen.getByRole("checkbox", { name: "Select worksheet 1 for preparation" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Stop preparation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Work may still finish on the server");
    expect(screen.getByRole("button", { name: "Prepare selection" })).toBeDisabled();
    await act(async () => { finish(reply({ ok: true, status: "SUCCEEDED" })); });
    expect(screen.queryByRole("link", { name: "Review worksheet 1" })).not.toBeInTheDocument(); expect(writes(fetcher)).toHaveLength(1);
    fetcher.mockImplementation(original); fireEvent.click(screen.getByRole("button", { name: "Check preparation" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Prepare selection" })).toBeEnabled());
    expect(writes(fetcher)).toHaveLength(1);
  });
  it.each([401, 403, 404])("clears selection, inventory and readiness on HTTP %s during a queue", async status => {
    const { fetcher, original } = setup();
    fetcher.mockImplementation((url, options) => options.method === "POST" ? Promise.resolve(reply({ detail: "private" }, status)) : original(url, options));
    render(<WorkbookPreparationClient batchId="batch" />); await loaded(); select(); select(2); confirm(); start();
    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable or your access has changed");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(screen.queryByText("private")).not.toBeInTheDocument();
    expect(writes(fetcher)).toHaveLength(1);
  });
  it("clears selection on inventory refresh and aborts the queue when the workbook changes", async () => {
    const { fetcher, original } = setup(); const view = render(<WorkbookPreparationClient batchId="batch" />); await loaded(); select();
    fireEvent.click(screen.getByRole("button", { name: "Refresh worksheet list" })); await loaded();
    expect(screen.getByRole("checkbox", { name: "Select worksheet 1 for preparation" })).not.toBeChecked();
    select(); confirm(); let finish!: (r: Response) => void; let signal!: AbortSignal;
    fetcher.mockImplementation((url, options) => {
      if (options.method !== "POST") return original(url, options);
      signal = options.signal as AbortSignal; return new Promise(resolve => { finish = resolve; });
    }); start(); await waitFor(() => expect(writes(fetcher)).toHaveLength(1));
    view.rerender(<WorkbookPreparationClient batchId="new" />);
    await act(async () => { finish(reply({ ok: true, status: "SUCCEEDED" })); });
    expect(signal.aborted).toBe(true); expect(writes(fetcher)).toHaveLength(1);
    expect(screen.queryByText("Confirmed complete in this queue.")).not.toBeInTheDocument();
  });
  it("has no automated accessibility violations in selection, consent and completed states", async () => {
    setup(); const view = render(<WorkbookPreparationClient batchId="batch" />); await loaded(); select(); confirm();
    expect((await axe(view.container)).violations).toEqual([]); start();
    await screen.findByText("Selected worksheets are ready for their individual field and quality reviews.");
    expect((await axe(view.container)).violations).toEqual([]);
  });
});
