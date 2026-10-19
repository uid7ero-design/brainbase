import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import ReviewHistoryClient from "@/app/data-hub/analysis/_components/ReviewHistoryClient";
import AnalysisReviewClient from "@/app/data-hub/analysis/[uploadId]/AnalysisReviewClient";
import { historyEntry, historyFixture } from "../../helpers/dataHubHistoryFixture";
import { reviewPlanFixture, savedReviewFixture } from "../../helpers/dataHubReviewFixture";
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fixture = () => { const f = historyFixture(); return { ...f, props: { uploadId: "upload", review: f.review, fieldLabels: f.labels, disabled: false, onBusyChange: vi.fn(), onInvalidated: vi.fn() } }; };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("loads only on demand, compares explicit decisions without save/count and passes accessible states", async () => {
  const f = fixture(), fetcher = vi.fn().mockResolvedValueOnce(response({ ok: true, history: f.history })).mockResolvedValueOnce(response({ ok: true, comparison: f.comparison }));
  vi.stubGlobal("fetch", fetcher); const view = render(<ReviewHistoryClient {...f.props} />);
  expect(fetcher).not.toHaveBeenCalled(); expect(await axe(view.container)).toHaveNoViolations();
  fireEvent.click(screen.getByText("Load review history")); await screen.findByText("Revision 1");
  fireEvent.click(screen.getByText("Compare revision 1 with current review"));
  const changes = await screen.findByRole("region", { name: "Review decision changes" });
  expect(changes).toHaveTextContent("Amount (field 1): measure → currency"); expect(changes).toHaveTextContent("hold → continue");
  expect(fetcher.mock.calls.every(call => call[1].method === "GET" && call[1].body === undefined && call[1].cache === "no-store")).toBe(true);
  expect(fetcher.mock.calls[1][0]).toContain("/history/compare?historyVersion=v1&datasetProfileRunId=profile&expectedReviewRevision=3&baselineRevision=1");
  expect(await axe(view.container)).toHaveNoViolations(); expect(f.props.onInvalidated).not.toHaveBeenCalled();
});
it("renders only ten entries, moves to older pages explicitly and clears the comparison", async () => {
  const f = fixture(); f.props.review.revision = 12;
  const first = { ...f.history, currentReviewRevision: 12, entries: Array.from({ length: 10 }, (_, i) => historyEntry(12 - i)), nextBeforeRevision: 3 };
  const second = { ...first, beforeRevision: 3, nextBeforeRevision: null, entries: [historyEntry(2), historyEntry(1)] };
  const fetcher = vi.fn().mockResolvedValueOnce(response({ ok: true, history: first })).mockResolvedValueOnce(response({ ok: true, history: second })); vi.stubGlobal("fetch", fetcher);
  render(<ReviewHistoryClient {...f.props} />); fireEvent.click(screen.getByText("Load review history")); await screen.findByText("Revision 3");
  expect(screen.getAllByRole("listitem")).toHaveLength(10); fireEvent.click(screen.getByText("Older reviews")); await screen.findByText("Revision 1");
  expect(screen.getAllByRole("listitem")).toHaveLength(2); expect(fetcher.mock.calls[1][0]).toContain("beforeRevision=3"); expect(screen.getByText("Newest reviews")).toBeEnabled();
});
it("cancels stalled work, ignores its late reply and releases the parent lock", async () => {
  const f = fixture(); let resolve!: (r: Response) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  render(<ReviewHistoryClient {...f.props} />); fireEvent.click(screen.getByText("Load review history")); fireEvent.click(screen.getByText("Stop loading history"));
  await screen.findByRole("alert"); expect(screen.getByRole("alert")).toHaveTextContent("REQUEST_CANCELLED");
  await act(async () => resolve(response({ ok: true, history: f.history }))); expect(screen.queryByText("Revision 1")).not.toBeInTheDocument();
  expect(f.props.onBusyChange).toHaveBeenLastCalledWith(false); expect(fetch).toHaveBeenCalledTimes(1);
});
it("times out a stalled transport and discards state on unmount", async () => {
  vi.useFakeTimers(); const f = fixture(), fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => new Promise(() => {})); vi.stubGlobal("fetch", fetcher);
  const view = render(<ReviewHistoryClient {...f.props} />); fireEvent.click(screen.getByText("Load review history"));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(screen.getByRole("alert")).toHaveTextContent("REQUEST_TIMED_OUT");
  fireEvent.click(screen.getByText("Load review history")); const signal = fetcher.mock.calls[1][1].signal; view.unmount(); expect(signal?.aborted).toBe(true);
});
it.each(["FORBIDDEN", "REVIEW_REVISION_MISMATCH", "REVIEW_PROFILE_CHANGED", "REVIEW_NOT_FOUND"])("invalidates the entire review when history returns %s", async code => {
  const fetcher = vi.fn().mockResolvedValueOnce(response(reviewPlanFixture())).mockResolvedValueOnce(response(savedReviewFixture()))
    .mockResolvedValueOnce(response({ ok: false, code }, code === "FORBIDDEN" ? 403 : 409)); vi.stubGlobal("fetch", fetcher);
  render(<AnalysisReviewClient uploadId="upload" />); fireEvent.click(screen.getByText("Load current review")); await screen.findByText("Saved review 2");
  fireEvent.click(screen.getByText("Load review history")); await screen.findByRole("alert");
  expect(screen.queryByRole("region", { name: "Saved review results" })).not.toBeInTheDocument(); expect(screen.queryByRole("region", { name: "Analysis planning" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Saved review history" })).not.toBeInTheDocument();
});
it("locks sibling controls during history, rejects malformed replies without diagnostics and keeps recovery explicit", async () => {
  let release!: (r: Response) => void;
  const fetcher = vi.fn().mockResolvedValueOnce(response(reviewPlanFixture())).mockResolvedValueOnce(response(savedReviewFixture()))
    .mockImplementationOnce(() => new Promise<Response>(done => { release = done; })); vi.stubGlobal("fetch", fetcher);
  render(<AnalysisReviewClient uploadId="upload" />); fireEvent.click(screen.getByText("Load current review")); await screen.findByText("Saved review 2");
  fireEvent.click(screen.getByText("Load review history")); expect(screen.getByText("Count rows")).toBeDisabled(); expect(screen.getByText("Load planning choices")).toBeDisabled();
  await act(async () => release(response({ ok: true, history: { privateValues: ["private"] } })));
  const region = screen.getByRole("region", { name: "Saved review history" }); await within(region).findByRole("alert");
  expect(region).not.toHaveTextContent("private"); expect(region).toHaveTextContent("RESPONSE_INVALID");
  await waitFor(() => expect(screen.getByText("Count rows")).toBeEnabled()); expect(fetcher).toHaveBeenCalledTimes(3);
});
it("renders only fifty changes at once and pages locally without another API call", async () => {
  const f = fixture();
  f.props.fieldLabels = Array.from({ length: 51 }, (_, i) => ({ sourceSchemaColumnId: `field-${i}`, label: "Duplicate name" }));
  f.props.review.schema.snapshot.fields = f.props.fieldLabels.map(field => ({ ...f.props.review.schema.snapshot.fields[0], sourceSchemaColumnId: field.sourceSchemaColumnId }));
  f.comparison.semanticChanges = f.props.fieldLabels.map(field => ({ sourceSchemaColumnId: field.sourceSchemaColumnId, fromRole: "MEASURE", toRole: "CURRENCY" })); f.comparison.qualityChanges = [];
  const fetcher = vi.fn().mockResolvedValueOnce(response({ ok: true, history: f.history })).mockResolvedValueOnce(response({ ok: true, comparison: f.comparison })); vi.stubGlobal("fetch", fetcher);
  render(<ReviewHistoryClient {...f.props} />); fireEvent.click(screen.getByText("Load review history")); await screen.findByText("Revision 1"); fireEvent.click(screen.getByText("Compare revision 1 with current review"));
  const changes = await screen.findByRole("region", { name: "Review decision changes" }); expect(within(changes).getAllByRole("listitem")).toHaveLength(50);
  fireEvent.click(screen.getByText("Next changes")); expect(within(changes).getAllByRole("listitem")).toHaveLength(1); expect(changes).toHaveTextContent("Duplicate name (field 51)");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
