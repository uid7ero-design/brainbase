import { beforeEach, describe, expect, it, vi } from "vitest";
const seam = vi.hoisted(() => ({ load: vi.fn(), auth: vi.fn(), labels: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/data-hub/analysisExecution/loadProfileReviewEvidence", () => ({ loadProfileReviewEvidenceInTransaction: seam.load }));
vi.mock("@/lib/org", () => ({ requireRole: seam.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: seam.transaction } }));
import { planAnalysisReview } from "@/lib/data-hub/analysisExecution/planAnalysisReview";
import { GET, POST } from "@/app/api/data-hub/worksheets/[id]/analysis-review/plan/route";
import { profileDataset } from "@/lib/data-hub/profiling/profileDataset";
const scope = { organisationId: "org", uploadId: "upload" };
const context = { params: Promise.resolve({ id: "upload" }) };
const preview = { reviewVersion: "v1", datasetProfileRunId: "profile",
  semanticChoices: [{ sourceSchemaColumnId: "amount", role: "MEASURE" }], qualityDecisions: [] };
beforeEach(() => {
  vi.resetAllMocks(); seam.labels.mockResolvedValue([{ id: "amount", source_header: "Amount" }]);
  seam.transaction.mockImplementation(async callback => callback({ sourceSchemaColumn: { findMany: seam.labels } }));
  seam.auth.mockResolvedValue({ organisationId: "org", userId: "actor" });
  const result = profileDataset({ rowCount: 2, columns: [{ sourceSchemaColumnId: "amount", valueKind: "DECIMAL",
    sourceUnit: null, normalizedUnit: null, cells: [{ sourceRowNumber: 1, normalizedValue: "10" },
      { sourceRowNumber: 2, normalizedValue: null }] }] });
  if (!result.ok) throw new Error(result.code);
  seam.load.mockResolvedValue({ ok: true, profile: { context: { datasetProfileRunId: "profile", sourceSchemaWorksheetId: "worksheet" }, snapshot: result.profile } });
});
describe("D4D5X review planning with real semantic and quality engines", () => {
  it("discovers candidates without claiming quality readiness", async () => {
    expect(await planAnalysisReview(scope)).toMatchObject({ ok: true, datasetProfileRunId: "profile", quality: null,
      clarification: { columns: [{ sourceSchemaColumnId: "amount" }] }, fieldLabels: [{ sourceSchemaColumnId: "amount", label: "Amount" }] });
    expect(seam.labels).toHaveBeenCalledWith({ where: { organisation_id: "org", source_schema_worksheet_id: "worksheet", id: { in: ["amount"] } }, select: { id: true, source_header: true } });
    expect(seam.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
  });
  it("builds actual quality questions after valid semantic choices", async () => {
    expect(await planAnalysisReview(scope, preview)).toMatchObject({ ok: true, quality: { items: [
      { code: "COLUMN_PARTIALLY_NULL" }, { code: "COLUMN_CONSTANT" }] } });
  });
  it("rejects stale profile pins", async () => {
    expect(await planAnalysisReview(scope, { ...preview, datasetProfileRunId: "old" }))
      .toEqual({ ok: false, code: "REVIEW_PROFILE_CHANGED" });
    expect(seam.labels).not.toHaveBeenCalled();
  });
  it("uses a positional fallback without exposing unexpected label metadata", async () => {
    seam.labels.mockResolvedValue([{ id: "unrelated", source_header: "Secret header", secret: "hidden" }]);
    const result = await planAnalysisReview(scope);
    expect(result).toMatchObject({ ok: true, fieldLabels: [{ sourceSchemaColumnId: "amount", label: "Field 1" }] });
    expect(JSON.stringify(result)).not.toContain("Secret header");
    expect(JSON.stringify(result)).not.toContain("hidden");
  });
  it("rejects roles outside actual candidates", async () => {
    expect(await planAnalysisReview(scope, { ...preview, semanticChoices: [{ sourceSchemaColumnId: "amount", role: "IDENTIFIER" }] }))
      .toMatchObject({ ok: false, code: "ROLE_NOT_CANDIDATE" });
  });
  it("rejects quality decisions in the preview before loading", async () => {
    expect(await planAnalysisReview(scope, { ...preview, qualityDecisions: [{ code: "EMPTY_DATASET", scope: "DATASET", decision: "HOLD" }] }))
      .toEqual({ ok: false, code: "REVIEW_INPUT_INVALID" });
    expect(seam.load).not.toHaveBeenCalled();
  });
  it("closes load failures", async () => {
    seam.load.mockRejectedValue(new Error("secret"));
    expect(await planAnalysisReview(scope)).toEqual({ ok: false, code: "REVIEW_PLAN_FAILED" });
  });
  it("routes both phases through authenticated scope with no caching", async () => {
    const get = await GET(new Request("http://localhost?organisationId=other"), context);
    expect(get.status).toBe(200); expect(get.headers.get("Cache-Control")).toBe("private, no-store");
    expect(seam.load).toHaveBeenCalledWith(scope, expect.anything()); expect(seam.auth).toHaveBeenCalledWith("manager");
    const post = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(preview) }), context);
    expect(post.status).toBe(200);
  });
  it("rejects unauthorized callers before profile access", async () => {
    seam.auth.mockRejectedValue(new Error("Forbidden"));
    expect((await GET(new Request("http://localhost"), context)).status).toBe(403);
    expect(seam.load).not.toHaveBeenCalled();
  });
});
