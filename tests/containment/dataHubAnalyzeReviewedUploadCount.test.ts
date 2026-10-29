import { beforeEach, describe, expect, it, vi } from "vitest";
const seams = vi.hoisted(() => ({ transaction: vi.fn(), review: vi.fn(), profile: vi.fn(), evaluate: vi.fn(), tx: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: seams.transaction } }));
vi.mock("@/lib/data-hub/analysisExecution/loadAnalysisReview", () => ({ loadAnalysisReviewInTransaction: seams.review }));
vi.mock("@/lib/data-hub/analysisExecution/loadProfileCountEvidence", () => ({ loadProfileCountEvidenceInTransaction: seams.profile }));
vi.mock("@/lib/data-hub/analysis/analyzeProfileCount", () => ({ analyzeProfileCount: seams.evaluate }));
import { analyzeReviewedUploadCount } from "@/lib/data-hub/analysisExecution/analyzeReviewedUploadCount";
const scope = { organisationId: "org", uploadId: "upload" };
const request = { requestVersion: "v1", kind: "ROW_COUNT" };
beforeEach(() => {
  vi.resetAllMocks(); seams.transaction.mockImplementation(async (callback) => callback(seams.tx));
  seams.review.mockResolvedValue({ ok: true, revision: 3, schema: "server schema", quality: "server quality" });
  seams.profile.mockResolvedValue({ ok: true, profile: { context: "context", snapshot: "counts" } });
  seams.evaluate.mockReturnValue({ ok: true, result: { count: 5 } });
});
describe("D4D5V reviewed count service transaction composition", () => {
  it("uses one snapshot and only server-loaded evidence", async () => {
    expect(await analyzeReviewedUploadCount(scope, request)).toEqual({ ok: true, reviewRevision: 3, result: { count: 5 } });
    expect(seams.transaction).toHaveBeenCalledTimes(1);
    expect(seams.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
    expect(seams.review).toHaveBeenCalledWith(scope, seams.tx);
    expect(seams.profile).toHaveBeenCalledWith(scope, seams.tx);
    expect(seams.evaluate).toHaveBeenCalledWith("context", "server schema", "server quality",
      { context: "context", snapshot: "counts" }, request);
  });
  it.each(["REVIEW_NOT_FOUND", "DECISION_REQUIRED", "UPLOAD_NOT_FOUND"])("stops on %s", async (code) => {
    seams.review.mockResolvedValue({ ok: false, code });
    expect(await analyzeReviewedUploadCount(scope, request)).toEqual({ ok: false, code });
    expect(seams.profile).not.toHaveBeenCalled(); expect(seams.evaluate).not.toHaveBeenCalled();
  });
  it("stops on invalid profile evidence", async () => {
    seams.profile.mockResolvedValue({ ok: false, code: "PROFILE_COUNTS_INVALID" });
    expect(await analyzeReviewedUploadCount(scope, request)).toEqual({ ok: false, code: "PROFILE_COUNTS_INVALID" });
    expect(seams.evaluate).not.toHaveBeenCalled();
  });
  it("preserves evaluator rejection without a success revision", async () => {
    seams.evaluate.mockReturnValue({ ok: false, code: "BLOCKED_QUALITY_HOLD" });
    expect(await analyzeReviewedUploadCount(scope, request)).toEqual({ ok: false, code: "BLOCKED_QUALITY_HOLD" });
  });
  it("rejects invalid scope before database access", async () => {
    expect(await analyzeReviewedUploadCount({ ...scope, uploadId: " " }, request)).toEqual({ ok: false, code: "CONTEXT_INPUT_INVALID" });
    expect(seams.transaction).not.toHaveBeenCalled();
  });
  it("closes unexpected transaction failure", async () => {
    seams.transaction.mockRejectedValue(new Error("secret"));
    expect(await analyzeReviewedUploadCount(scope, request)).toEqual({ ok: false, code: "ANALYSIS_EVALUATION_FAILED" });
  });
});
