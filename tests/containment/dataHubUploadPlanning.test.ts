import { beforeEach, describe, expect, it, vi } from "vitest";
import { planningFixture } from "../helpers/dataHubPlanningFixture";
const seams = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/data-hub/analysisExecution/loadAnalysisReview", () => ({ loadAnalysisReview: seams.load }));
import { loadUploadPlanningCatalog, planUploadSelection } from "@/lib/data-hub/analysisExecution/uploadPlanning";
const scope = { organisationId: "org", uploadId: "upload" };
beforeEach(() => { vi.resetAllMocks(); });

describe("upload planning over the existing scoped review loader", () => {
  it("loads authoritative review metadata and produces closed descriptions without mutating it", async () => {
    const f = planningFixture(); const before = structuredClone(f.review); seams.load.mockResolvedValue(f.review);
    expect(await loadUploadPlanningCatalog(scope)).toEqual(f.catalog());
    expect(await planUploadSelection(scope, f.body)).toEqual(f.planned());
    expect(seams.load).toHaveBeenCalledWith(scope); expect(f.review).toEqual(before);
  });
  it.each([null, {}, { ...planningFixture().body, organisationId: "other" },
    { ...planningFixture().body, schema: {} }, { ...planningFixture().body, datasetProfileRunId: " " },
    { ...planningFixture().body, selection: { ...planningFixture().selection, measureColumnIds: ["amount", "amount"] } }])
    ("rejects injection/malformed requests before loading metadata %#", async body => {
      expect(await planUploadSelection(scope, body)).toEqual({ ok: false, code: "PROFILE_SELECTION_INVALID" });
      expect(seams.load).not.toHaveBeenCalled();
    });
  it("rejects an obsolete profile even when its revision number matches", async () => {
    const f = planningFixture(); seams.load.mockResolvedValue(f.review);
    expect(await planUploadSelection(scope, { ...f.body, datasetProfileRunId: "old-profile" }))
      .toEqual({ ok: false, code: "REVIEW_PROFILE_CHANGED" });
  });
  it("rejects accessor and inherited required pins without invoking getters", async () => {
    const f = planningFixture(); const getter = vi.fn(() => "profile");
    const accessor = Object.defineProperty({ selection: f.selection }, "datasetProfileRunId", { enumerable: true, get: getter });
    const inherited = Object.assign(Object.create({ datasetProfileRunId: "profile" }), { selection: f.selection });
    for (const input of [accessor, inherited, { ...f.body, [Symbol("private")]: true }]) {
      expect(await planUploadSelection(scope, input)).toEqual({ ok: false, code: "PROFILE_SELECTION_INVALID" });
    }
    expect(getter).not.toHaveBeenCalled(); expect(seams.load).not.toHaveBeenCalled();
  });
  it("rechecks revision, measure eligibility and quality holds on every submission", async () => {
    const f = planningFixture(); seams.load.mockResolvedValue(f.review);
    expect(await planUploadSelection(scope, { ...f.body, selection: { ...f.selection, expectedReviewRevision: 2 } }))
      .toEqual({ ok: false, code: "REVIEW_REVISION_MISMATCH" });
    f.review.schema.snapshot.fields[0].fieldClass = "DIMENSION";
    expect(await planUploadSelection(scope, f.body)).toEqual({ ok: false, code: "CAPABILITY_NOT_AVAILABLE", requestIndex: 1 });
    f.review.quality.snapshot.state = "HOLD_FOR_REMEDIATION";
    expect(await planUploadSelection(scope, f.body)).toEqual({ ok: false, code: "QUALITY_HOLD", requestIndex: 0 });
  });
  it("drops loader diagnostics and normalizes unsupported stored-review errors", async () => {
    seams.load.mockResolvedValue({ ok: false, code: "CHOICE_REQUIRED", sourceSchemaColumnId: "private", trace: "private" });
    expect(await loadUploadPlanningCatalog(scope)).toEqual({ ok: false, code: "REVIEW_RECORD_INVALID" });
    seams.load.mockResolvedValue({ ok: false, code: "UPLOAD_NOT_FOUND", trace: "private" });
    expect(await planUploadSelection(scope, planningFixture().body)).toEqual({ ok: false, code: "UPLOAD_NOT_FOUND" });
  });
  it("contains thrown read errors and invalid trusted scope", async () => {
    seams.load.mockRejectedValue(new Error("private database diagnostic"));
    expect(await loadUploadPlanningCatalog(scope)).toEqual({ ok: false, code: "REVIEW_READ_FAILED" });
    expect(await planUploadSelection(scope, planningFixture().body)).toEqual({ ok: false, code: "REVIEW_READ_FAILED" });
    seams.load.mockClear();
    expect(await loadUploadPlanningCatalog({ ...scope, organisationId: " " })).toEqual({ ok: false, code: "CONTEXT_INPUT_INVALID" });
    expect(seams.load).not.toHaveBeenCalled();
  });
});
