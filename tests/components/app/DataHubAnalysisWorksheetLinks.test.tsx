import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AnalysisWorksheetLinks from "@/app/data-hub/analysis/_components/AnalysisWorksheetLinks";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

it("reads worksheets only on demand and links by encoded identity, including duplicate names", async () => {
  const fetcher = vi.fn().mockResolvedValue(reply({ worksheets: [
    { id: "upload/a", worksheetName: "Data", worksheetIndex: 0, storageKey: "hidden" },
    { id: "upload-b", worksheetName: "Data", worksheetIndex: 1 },
  ] }));
  vi.stubGlobal("fetch", fetcher);
  render(<AnalysisWorksheetLinks batchId="batch/a" filename="source.xlsx" />);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review worksheets in source.xlsx" }));
  const first = await screen.findByRole("link", { name: "Data (worksheet 1) — review and count" });
  expect(first).toHaveAttribute("href", "/data-hub/analysis/upload%2Fa");
  expect(screen.getByRole("link", { name: "Data (worksheet 2) — review and count" })).toHaveAttribute("href", "/data-hub/analysis/upload-b");
  expect(fetcher).toHaveBeenCalledWith("/api/data-hub/import-batches/batch%2Fa/worksheets", expect.objectContaining({ method: "GET", credentials: "same-origin" }));
  expect(screen.queryByText("hidden")).not.toBeInTheDocument();
});

it("shows an empty list honestly without implying analysis readiness", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ worksheets: [] })));
  render(<AnalysisWorksheetLinks batchId="batch" filename="source.xlsx" />);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByText("No persisted worksheets are available for analysis yet.");
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it.each(["denied", "malformed", "duplicate", "tooMany"])("closes %s responses and permits an explicit retry", async kind => {
  const row = { id: "u", worksheetName: "Data", worksheetIndex: 0 };
  const invalid = kind === "denied" ? reply({ error: "private backend detail" }, 403) :
    reply({ worksheets: kind === "malformed" ? [{ ...row, worksheetIndex: -1 }] : kind === "duplicate" ? [row, row] : Array(51).fill(row) });
  const fetcher = vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(reply({ worksheets: [] }));
  vi.stubGlobal("fetch", fetcher);
  render(<AnalysisWorksheetLinks batchId="batch" filename="source.xlsx" />);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("alert"); expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).not.toHaveTextContent("private backend detail");
  await waitFor(() => expect(screen.getByRole("button")).toBeEnabled());
  fireEvent.click(screen.getByRole("button")); await screen.findByText("No persisted worksheets are available for analysis yet.");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
