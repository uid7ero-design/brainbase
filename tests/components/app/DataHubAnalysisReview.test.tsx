import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AnalysisReviewClient from "@/app/data-hub/analysis/[uploadId]/AnalysisReviewClient";

const initial = { ok: true, datasetProfileRunId: "profile-1", clarification: { columns: [
  { sourceSchemaColumnId: "amount", resolutionState: "CLARIFICATION_REQUIRED", candidateRoles: ["MEASURE", "CURRENCY"], reasons: ["MULTIPLE_CANDIDATES"] },
] }, quality: null, fieldLabels: [{ sourceSchemaColumnId: "amount", label: "Amount" }] };
const preview = { ...initial, quality: { items: [{ code: "PARTIAL_NULL_VALUES", scope: "COLUMN", sourceSchemaColumnId: "amount", action: "ACKNOWLEDGE_NOTICE" }] } };
const saved = (held = false) => ({ ok: true, revision: 2, quality: { snapshot: { state: held ? "HOLD_FOR_REMEDIATION" : "READY" } }, schema: { context: { datasetProfileRunId: "profile-1" }, snapshot: { fields: [{ sourceSchemaColumnId: "amount", fieldClass: "MEASURE" }] } } });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Data Hub review screen", () => {
  it("requires explicit choices, saves only decisions and displays the server count provenance", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(initial))
      .mockResolvedValueOnce(reply({ ok: false, code: "REVIEW_NOT_FOUND" }, 404))
      .mockResolvedValueOnce(reply(preview)).mockResolvedValueOnce(reply({ ok: true }, 201))
      .mockResolvedValueOnce(reply(saved())).mockResolvedValueOnce(reply({ ok: true, result: { plan: { operation: "ROW_COUNT" }, count: 7, context: { datasetProfileRunId: "profile-2" } }, reviewRevision: 3 }));
    vi.stubGlobal("fetch", fetcher);
    render(<AnalysisReviewClient uploadId="upload/a" />);
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Load current review"));
    await screen.findByText("Field meanings");
    expect(screen.getByText("Review quality")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Amount (field 1)"), { target: { value: "MEASURE" } });
    fireEvent.click(screen.getByText("Review quality"));
    await screen.findByText("Data quality");
    expect(screen.getByText("Save review")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("partial null values — Amount"), { target: { value: "ACKNOWLEDGE" } });
    fireEvent.click(screen.getByText("Save review"));
    await screen.findByText("Saved review 2");
    const body = JSON.parse(fetcher.mock.calls[3][1].body);
    expect(body).toEqual({ reviewVersion: "v1", datasetProfileRunId: "profile-1", semanticChoices: [{ sourceSchemaColumnId: "amount", role: "MEASURE" }],
      qualityDecisions: [{ code: "PARTIAL_NULL_VALUES", scope: "COLUMN", sourceSchemaColumnId: "amount", decision: "ACKNOWLEDGE" }] });
    expect(fetcher.mock.calls[0][0]).toContain("upload%2Fa/analysis-review/plan");
    fireEvent.click(screen.getByText("Count rows"));
    await screen.findByText("Rows: 7. Based on review 3, profile profile-2.");
    fireEvent.change(screen.getByLabelText("Amount (field 1)"), { target: { value: "CURRENCY" } });
    expect(screen.queryByText("Data quality")).not.toBeInTheDocument();
    expect(screen.queryByText("Count rows")).not.toBeInTheDocument();
    expect(screen.queryByText(/Rows: 7/)).not.toBeInTheDocument();
  });
  it("blocks counts on an existing quality hold", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(initial)).mockResolvedValueOnce(reply(saved(true))));
    render(<AnalysisReviewClient uploadId="upload" />);
    fireEvent.click(screen.getByText("Load current review"));
    await screen.findByText("On hold for correction. Counts are unavailable.");
    expect(screen.getByText("Count rows")).toBeDisabled();
    expect(screen.getByText("Count present values")).toBeDisabled();
  });
  it("restores validated saved meanings and quality decisions for the matching profile", async () => {
    const loaded = { ...saved(), schema: { context: { datasetProfileRunId: "profile-1" }, snapshot: { fields: [
      { sourceSchemaColumnId: "amount", semanticRole: "MEASURE", fieldClass: "MEASURE", resolutionSource: "CLARIFIED_CHOICE" },
    ] } }, quality: { snapshot: { state: "READY", items: [{ code: "PARTIAL_NULL_VALUES", scope: "COLUMN", sourceSchemaColumnId: "amount", decision: "ACKNOWLEDGE" }] } } };
    const fetcher = vi.fn().mockResolvedValueOnce(reply(initial)).mockResolvedValueOnce(reply(loaded)).mockResolvedValueOnce(reply(preview));
    vi.stubGlobal("fetch", fetcher); render(<AnalysisReviewClient uploadId="upload" />);
    fireEvent.click(screen.getByText("Load current review")); await screen.findByText("Saved review 2");
    expect(screen.getByLabelText("Amount (field 1)")).toHaveValue("MEASURE");
    fireEvent.click(screen.getByText("Review quality")); await screen.findByText("Data quality");
    expect(screen.getByLabelText("partial null values — Amount")).toHaveValue("ACKNOWLEDGE");
    expect(screen.getByText("Save review")).toBeEnabled();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.filter(call => call[0].endsWith("/analysis-review") && call[1].method === "POST")).toHaveLength(0);
  });
  it("does not restore meanings across profile changes", async () => {
    const loaded = { ...saved(), schema: { context: { datasetProfileRunId: "profile-2" }, snapshot: { fields: [
      { sourceSchemaColumnId: "amount", semanticRole: "MEASURE", fieldClass: "MEASURE", resolutionSource: "CLARIFIED_CHOICE" },
    ] } } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(initial)).mockResolvedValueOnce(reply(loaded)));
    render(<AnalysisReviewClient uploadId="upload" />);
    fireEvent.click(screen.getByText("Load current review")); await screen.findByText("Saved review 2");
    expect(screen.getByLabelText("Amount (field 1)")).toHaveValue("");
    expect(screen.getByText("Review quality")).toBeDisabled();
  });
  it("counts only a saved measure with an explicit closed request", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(initial)).mockResolvedValueOnce(reply(saved()))
      .mockResolvedValueOnce(reply({ ok: true, result: { plan: { operation: "COUNT_PRESENT", sourceSchemaColumnId: "amount" }, count: 0,
        context: { datasetProfileRunId: "profile-1" } }, reviewRevision: 2 }));
    vi.stubGlobal("fetch", fetcher);
    render(<AnalysisReviewClient uploadId="upload" />);
    fireEvent.click(screen.getByText("Load current review"));
    await screen.findByText("Saved review 2");
    expect(screen.getByText("Count present values")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Measure to count"), { target: { value: "amount" } });
    fireEvent.click(screen.getByText("Count present values"));
    await screen.findByText("Present values: 0. Based on review 2, profile profile-1.");
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ requestVersion: "v1", kind: "AGGREGATE",
      operator: "COUNT_PRESENT", sourceSchemaColumnId: "amount" });
    fireEvent.change(screen.getByLabelText("Measure to count"), { target: { value: "" } });
    expect(screen.queryByText(/Present values: 0/)).not.toBeInTheDocument();
  });
  it("does not offer measures from a saved review on a different profile", async () => {
    const different = saved(); different.schema.context.datasetProfileRunId = "profile-2";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(initial)).mockResolvedValueOnce(reply(different)));
    render(<AnalysisReviewClient uploadId="upload" />);
    fireEvent.click(screen.getByText("Load current review"));
    await screen.findByText("Saved review 2");
    expect(screen.queryByLabelText("Measure to count")).not.toBeInTheDocument();
    expect(screen.getByText(/Reload the current review to load field choices/)).toBeInTheDocument();
  });
  it("requires reload after an uncertain save and never automatically retries", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(initial))
      .mockResolvedValueOnce(reply({ ok: false, code: "REVIEW_NOT_FOUND" }, 404))
      .mockResolvedValueOnce(reply(preview)).mockRejectedValueOnce(new Error("Connection lost"));
    vi.stubGlobal("fetch", fetcher);
    render(<AnalysisReviewClient uploadId="upload" />);
    fireEvent.click(screen.getByText("Load current review")); await screen.findByText("Field meanings");
    fireEvent.change(screen.getByLabelText("Amount (field 1)"), { target: { value: "MEASURE" } });
    fireEvent.click(screen.getByText("Review quality")); await screen.findByText("Data quality");
    fireEvent.change(screen.getByLabelText("partial null values — Amount"), { target: { value: "ACKNOWLEDGE" } });
    fireEvent.click(screen.getByText("Save review")); await screen.findByRole("alert");
    expect(screen.getByText("Save review")).toBeDisabled();
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("clears results before refresh and shows a stale-profile failure", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(initial)).mockResolvedValueOnce(reply(saved()))
      .mockResolvedValueOnce(reply({ ok: false, code: "REVIEW_PROFILE_CHANGED" }, 409));
    vi.stubGlobal("fetch", fetcher);
    render(<AnalysisReviewClient uploadId="upload" />);
    fireEvent.click(screen.getByText("Load current review"));
    await screen.findByText("Saved review 2");
    fireEvent.click(screen.getByText("Load current review"));
    await screen.findByRole("alert");
    expect(screen.queryByText("Count rows")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("REVIEW_PROFILE_CHANGED");
    await waitFor(() => expect(screen.getByText("Load current review")).toBeEnabled());
  });
});
