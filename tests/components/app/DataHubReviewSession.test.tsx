import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import AnalysisReviewClient from "@/app/data-hub/analysis/[uploadId]/AnalysisReviewClient";
import ReviewWorkbookNavigation from "@/app/data-hub/analysis/_components/ReviewWorkbookNavigation";
import { reviewWorkbookHint, worksheetReviewHref } from "@/lib/data-hub/client/reviewNavigation";
import { reviewPlanFixture, reviewPreviewFixture, savedReviewFixture } from "../../helpers/dataHubReviewFixture";
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const worksheet = (id: string, index: number, overrides = {}) => ({ id, importBatchId: "batch/a", worksheetName: "Data", worksheetIndex: index,
  worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "IMPORTED", ...overrides });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([undefined, ["batch"], "", " ", "x".repeat(513), 1])("ignores invalid or ambiguous workbook hint %j", hint => expect(reviewWorkbookHint(hint)).toBeUndefined());
it("encodes opaque identities in navigation links", () => expect(worksheetReviewHref("u/a?", "b/a&")).toBe("/data-hub/analysis/u%2Fa%3F?workbook=b%2Fa%26"));
it("loads navigation explicitly, sorts physical sheets, excludes hidden/skipped/empty sheets and disables dirty links", async () => {
  const fetcher = vi.fn().mockResolvedValue(reply({ worksheets: [worksheet("next", 4), worksheet("hidden", 1, { worksheetVisibility: "hidden" }),
    worksheet("__proto__", 0), worksheet("current", 3), worksheet("skipped", 2, { canonicalStatus: "SKIPPED" }),
    worksheet("empty", 5, { worksheetIsEmpty: true })] }));
  vi.stubGlobal("fetch", fetcher); const onBusyChange = vi.fn(), onScopeLoss = vi.fn();
  const props = { uploadId: "current", batchId: "batch/a", disabled: false, onBusyChange, onScopeLoss };
  const view = render(<ReviewWorkbookNavigation {...props} />); expect(fetcher).not.toHaveBeenCalled();
  expect(await axe(view.container)).toHaveNoViolations();
  fireEvent.click(screen.getByText("Load workbook navigation"));
  expect(await screen.findByRole("link", { name: "Previous worksheet: Data (worksheet 1)" })).toHaveAttribute("href", "/data-hub/analysis/__proto__?workbook=batch%2Fa");
  expect(screen.getByRole("link", { name: "Next worksheet: Data (worksheet 5)" })).toHaveAttribute("href", "/data-hub/analysis/next?workbook=batch%2Fa");
  expect(screen.getByText(/2 of 3 available worksheets/)).toBeInTheDocument();
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store" });
  view.rerender(<ReviewWorkbookNavigation {...props} disabled />);
  expect(screen.queryByRole("link")).not.toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await axe(view.container)).toHaveNoViolations();
});
it.each(["membership", "batch", "denied"])("fails closed for %s navigation without loading or saving a review", async kind => {
  const fetcher = vi.fn().mockResolvedValue(kind === "denied" ? reply({ private: "private" }, 403) : reply({ worksheets: [
    worksheet(kind === "membership" ? "other" : "current", 0, kind === "batch" ? { importBatchId: "foreign" } : {}),
  ] })); vi.stubGlobal("fetch", fetcher); const onScopeLoss = vi.fn();
  render(<ReviewWorkbookNavigation uploadId="current" batchId="batch/a" disabled={false} onBusyChange={vi.fn()} onScopeLoss={onScopeLoss} />);
  fireEvent.click(screen.getByText("Load workbook navigation")); await screen.findByRole("alert");
  expect(screen.queryByRole("link")).not.toBeInTheDocument(); expect(screen.getByRole("alert")).not.toHaveTextContent("private");
  expect(onScopeLoss).toHaveBeenCalledTimes(kind === "denied" ? 1 : 0); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("cancels stalled navigation and ignores a late metadata reply", async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done; })); vi.stubGlobal("fetch", fetcher);
  render(<ReviewWorkbookNavigation uploadId="current" batchId="batch/a" disabled={false} onBusyChange={vi.fn()} onScopeLoss={vi.fn()} />);
  fireEvent.click(screen.getByText("Load workbook navigation")); fireEvent.click(screen.getByText("Stop loading navigation"));
  await screen.findByRole("alert"); resolve(reply({ worksheets: [worksheet("current", 0)] }));
  await waitFor(() => expect(screen.getByText("Load workbook navigation")).toBeEnabled());
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
it("cancels discovery, releases controls, ignores late responses and supports an explicit retry", async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }))
    .mockResolvedValueOnce(reply(reviewPlanFixture())).mockResolvedValueOnce(reply(savedReviewFixture()));
  vi.stubGlobal("fetch", fetcher); render(<AnalysisReviewClient uploadId="upload" />);
  fireEvent.click(screen.getByText("Load current review")); fireEvent.click(screen.getByText("Stop review request"));
  await screen.findByRole("alert"); expect(screen.getByRole("alert")).toHaveTextContent("REQUEST_CANCELLED");
  resolve(reply(reviewPlanFixture())); await waitFor(() => expect(screen.getByText("Load current review")).toBeEnabled());
  expect(screen.queryByText("Field meanings")).not.toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Load current review")); await screen.findByText("Saved review 2"); expect(fetcher).toHaveBeenCalledTimes(3);
});
it("aborts on worksheet replacement so an old reply cannot populate the next worksheet", async () => {
  let resolve!: (value: Response) => void; const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  vi.stubGlobal("fetch", fetcher); const view = render(<AnalysisReviewClient uploadId="old" />);
  fireEvent.click(screen.getByText("Load current review")); const signal = fetcher.mock.calls[0][1].signal;
  view.rerender(<AnalysisReviewClient uploadId="next" />); expect(signal.aborted).toBe(true); resolve(reply(reviewPlanFixture()));
  await waitFor(() => expect(screen.getByText("Worksheet: next")).toBeInTheDocument());
  expect(screen.queryByText("Field meanings")).not.toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(["__proto__", "constructor", "toString"])("preserves opaque field identity %s in explicit choices", async id => {
  const plan = reviewPlanFixture(); plan.clarification.columns[0].sourceSchemaColumnId = plan.fieldLabels[0].sourceSchemaColumnId = id;
  const fetcher = vi.fn().mockResolvedValueOnce(reply(plan)).mockResolvedValueOnce(reply({ ok: false, code: "REVIEW_NOT_FOUND" }, 404))
    .mockResolvedValueOnce(reply({ ...plan, quality: null })); vi.stubGlobal("fetch", fetcher);
  render(<AnalysisReviewClient uploadId="upload" />); fireEvent.click(screen.getByText("Load current review")); await screen.findByText("Field meanings");
  fireEvent.change(screen.getByLabelText("Amount (field 1)"), { target: { value: "MEASURE" } }); fireEvent.click(screen.getByText("Review quality"));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetcher.mock.calls[2][1].body).semanticChoices).toEqual([{ sourceSchemaColumnId: id, role: "MEASURE" }]);
});
it("keeps a cancelled save locked across a failed reload; only a successful explicit reload recovers it", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply(reviewPlanFixture())).mockResolvedValueOnce(reply({ ok: false, code: "REVIEW_NOT_FOUND" }, 404))
    .mockResolvedValueOnce(reply(reviewPreviewFixture())).mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValueOnce(reply({ ok: false, code: "REVIEW_PLAN_FAILED" }, 503))
    .mockResolvedValueOnce(reply(reviewPlanFixture())).mockResolvedValueOnce(reply(savedReviewFixture()));
  vi.stubGlobal("fetch", fetcher); render(<AnalysisReviewClient uploadId="upload" workbookHint="batch/a" />);
  fireEvent.click(screen.getByText("Load current review")); await screen.findByText("Field meanings");
  fireEvent.change(screen.getByLabelText("Amount (field 1)"), { target: { value: "MEASURE" } });
  expect(screen.getByText("Load workbook navigation")).toBeDisabled();
  fireEvent.click(screen.getByText("Review quality")); await screen.findByText("Data quality");
  fireEvent.change(screen.getByLabelText(/column partially null/), { target: { value: "ACKNOWLEDGE" } });
  fireEvent.click(screen.getByText("Save review")); fireEvent.click(screen.getByText("Stop review request")); await screen.findByRole("alert");
  expect(screen.getByText("Save review")).toBeDisabled(); expect(fetcher).toHaveBeenCalledTimes(4);
  fireEvent.click(screen.getByText("Load current review")); await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("REVIEW_PLAN_FAILED"));
  expect(screen.getByText(/The previous save may have completed/)).toBeInTheDocument(); expect(screen.getByText("Load workbook navigation")).toBeDisabled();
  fireEvent.click(screen.getByText("Load current review")); await screen.findByText("Saved review 2");
  expect(screen.getByText("Load workbook navigation")).toBeEnabled();
  expect(fetcher.mock.calls.filter(call => call[0].endsWith("/analysis-review") && call[1].method === "POST")).toHaveLength(1);
});
it("clears saved review, planning and count controls when a later count loses scope", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply(reviewPlanFixture())).mockResolvedValueOnce(reply(savedReviewFixture()))
    .mockResolvedValueOnce(reply({ ok: false, code: "FORBIDDEN" }, 403)); vi.stubGlobal("fetch", fetcher);
  render(<AnalysisReviewClient uploadId="upload" />); fireEvent.click(screen.getByText("Load current review")); await screen.findByText("Saved review 2");
  fireEvent.click(screen.getByText("Count rows")); await screen.findByRole("alert");
  expect(screen.queryByText("Field meanings")).not.toBeInTheDocument(); expect(screen.queryByRole("region", { name: "Analysis planning" })).not.toBeInTheDocument();
  expect(screen.queryByText("Count rows")).not.toBeInTheDocument();
});
