import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { isConfirmEligible, type ReviewPhase } from "@/app/data-hub/import/confirmEligibility";

const ROOT = process.cwd();
const REVIEW_PANEL_PATH = path.join(ROOT, "app", "data-hub", "import", "_components", "ReviewPanel.tsx");

function readReviewPanel(): string {
  return fs.readFileSync(REVIEW_PANEL_PATH, "utf8");
}

const FAKE_BATCH = { id: "b1", status: "READY" as const, originalFilename: "f.csv", contentType: "csv", sizeBytes: 10 };
const FAKE_WORKSHEET = {
  id: "w1",
  worksheetIndex: 0,
  worksheetName: "CSV",
  worksheetVisibility: "visible" as const,
  worksheetIsEmpty: false,
  canonicalStatus: "AWAITING_CONFIRMATION" as const,
  importBatchId: "b1",
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
  confirmedBy: null,
  confirmedAt: null,
};

function preview(overrides: Partial<{ rowCount: number; sampleRowCount: number; truncated: boolean; requiredHeadersPresent: boolean; missingRequiredHeaders: string[] }> = {}) {
  return {
    worksheetId: "w1",
    worksheetName: "CSV",
    worksheetIndex: 0,
    rowCount: overrides.rowCount ?? 5,
    columnCount: 3,
    headers: ["report_date", "location", "waste_type"],
    sampleRows: [["2024-01-01", "loc", "type"]],
    sampleRowCount: overrides.sampleRowCount ?? 1,
    truncated: overrides.truncated ?? false,
    requiredHeadersPresent: overrides.requiredHeadersPresent ?? true,
    missingRequiredHeaders: overrides.missingRequiredHeaders ?? [],
  };
}

describe("isConfirmEligible — T10/T12/T14/T18/T33/T34", () => {
  it("T10: confirmationReady (no preview attempted) is eligible — matches the shipped orchestrator's own confirm() guard, which accepts confirmationReady directly", () => {
    const state: ReviewPhase = { phase: "confirmationReady", batch: FAKE_BATCH, worksheet: FAKE_WORKSHEET };
    expect(isConfirmEligible(state, false)).toBe(true);
  });

  it("previewing is never eligible (still loading)", () => {
    const state: ReviewPhase = { phase: "previewing", batch: FAKE_BATCH, worksheet: FAKE_WORKSHEET };
    expect(isConfirmEligible(state, false)).toBe(false);
    expect(isConfirmEligible(state, true)).toBe(false);
  });

  it("T12/T18/T33: previewReady with requiredHeadersPresent:false is NEVER eligible — the server is known to reject this file", () => {
    const state: ReviewPhase = { phase: "previewReady", batch: FAKE_BATCH, worksheet: FAKE_WORKSHEET, preview: preview({ requiredHeadersPresent: false, missingRequiredHeaders: ["report_date"] }) };
    expect(isConfirmEligible(state, false)).toBe(false);
    expect(isConfirmEligible(state, true)).toBe(false); // acknowledgement is irrelevant here — this isn't the previewFailed case
  });

  it("T10: previewReady with requiredHeadersPresent:true IS eligible, no acknowledgement needed", () => {
    const state: ReviewPhase = { phase: "previewReady", batch: FAKE_BATCH, worksheet: FAKE_WORKSHEET, preview: preview({ requiredHeadersPresent: true }) };
    expect(isConfirmEligible(state, false)).toBe(true);
  });

  it("T14/T34: previewFailed requires acknowledgement:true; false is not eligible", () => {
    const state: ReviewPhase = { phase: "previewFailed", batch: FAKE_BATCH, worksheet: FAKE_WORKSHEET, code: "NETWORK", message: "m" };
    expect(isConfirmEligible(state, false)).toBe(false);
    expect(isConfirmEligible(state, true)).toBe(true);
  });
});

describe("ReviewPanel.tsx — T11/T13/M6 structural distinctness", () => {
  it("T11: the truncation caption text is present and driven by real preview fields (sampleRowCount/rowCount), not a hardcoded string", () => {
    const code = readReviewPanel();
    expect(code).toMatch(/Showing first \{preview\.sampleRowCount\} of \{preview\.rowCount\} rows/);
  });

  it("T13/M6: previewFailed's render branch and previewReady's render branch call genuinely DIFFERENT functions — previewFailed never calls PreviewTable (the same function previewReady uses)", () => {
    const code = readReviewPanel();
    const previewFailedBlockStart = code.indexOf('state.phase === "previewFailed"');
    const previewFailedBlockEnd = code.indexOf("state.phase === \"previewReady\"", previewFailedBlockStart);
    expect(previewFailedBlockStart).toBeGreaterThan(-1);
    expect(previewFailedBlockEnd).toBeGreaterThan(previewFailedBlockStart);
    const previewFailedBlock = code.slice(previewFailedBlockStart, previewFailedBlockEnd);
    // The previewFailed branch must NEVER render <PreviewTable — that call
    // exists exactly once in the file, inside the previewReady branch only.
    expect(previewFailedBlock).not.toContain("<PreviewTable");
    const previewTableCallCount = (code.match(/<PreviewTable/g) ?? []).length;
    expect(previewTableCallCount).toBe(1);
  });

  it("previewFailed's acknowledgement checkbox starts unchecked (not pre-checked)", () => {
    const code = readReviewPanel();
    expect(code).toMatch(/checked=\{acknowledged\}/);
    expect(code).toMatch(/useState\(false\)/);
  });

  it("T12/M8: missing required headers are rendered from the real preview.missingRequiredHeaders field, not hidden/ignored — the exact gating condition, not short-circuited by an extra always-false prefix", () => {
    const code = readReviewPanel();
    expect(code).toContain("preview.missingRequiredHeaders.join");
    // Exact conditional expression required — `{!preview.requiredHeadersPresent ? (` —
    // catches a mutation that short-circuits it (e.g. `{false && !preview...`),
    // since that prefix breaks this precise substring match.
    expect(code).toContain("{!preview.requiredHeadersPresent ? (");
  });
});
