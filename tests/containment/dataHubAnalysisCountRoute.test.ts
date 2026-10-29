import { beforeEach, describe, expect, it, vi } from "vitest";
const seams = vi.hoisted(() => ({ auth: vi.fn(), analyze: vi.fn() }));
vi.mock("@/lib/org", () => ({ requireRole: seams.auth }));
vi.mock("@/lib/data-hub/analysisExecution/analyzeReviewedUploadCount", () => ({ analyzeReviewedUploadCount: seams.analyze }));
import { POST } from "@/app/api/data-hub/worksheets/[id]/analysis-count/route";
const context = { params: Promise.resolve({ id: "upload" }) };
const body = { requestVersion: "v1", kind: "ROW_COUNT" };
const request = () => new Request("http://localhost?organisationId=other", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); seams.auth.mockResolvedValue({ organisationId: "org", userId: "actor" }); });
describe("D4D5W authenticated count route (mocked service boundary)", () => {
  it("uses session scope and returns the result revision without caching", async () => {
    seams.analyze.mockResolvedValue({ ok: true, reviewRevision: 2, result: { count: 5 } });
    const response = await POST(request(), context);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ reviewRevision: 2, result: { count: 5 } });
    expect(seams.auth).toHaveBeenCalledWith("manager");
    expect(seams.analyze).toHaveBeenCalledWith({ organisationId: "org", uploadId: "upload" }, body);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it.each([["Unauthorized", 401], ["Forbidden", 403]])("rejects %s before evaluation", async (message, status) => {
    seams.auth.mockRejectedValue(new Error(message));
    expect((await POST(request(), context)).status).toBe(status); expect(seams.analyze).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON before evaluation", async () => {
    expect((await POST(new Request("http://localhost", { method: "POST", body: "{" }), context)).status).toBe(400);
    expect(seams.analyze).not.toHaveBeenCalled();
  });
  it.each([["INVALID_REQUEST", 400], ["UPLOAD_NOT_FOUND", 404], ["REVIEW_NOT_FOUND", 404],
    ["PROFILE_NOT_COMPLETE", 409], ["DATASET_CONTEXT_MISMATCH", 409], ["BLOCKED_QUALITY_HOLD", 422],
    ["DECISION_REQUIRED", 422], ["ANALYSIS_EVALUATION_FAILED", 503], ["REVIEW_READ_FAILED", 503]])(
    "maps %s and omits detailed evidence", async (code, status) => {
      seams.analyze.mockResolvedValue({ ok: false, code, details: "secret" });
      const response = await POST(request(), context);
      expect(response.status).toBe(status); expect(await response.json()).toEqual({ ok: false, code });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });
  it("closes unexpected exceptions", async () => {
    seams.analyze.mockRejectedValue(new Error("secret"));
    const response = await POST(request(), context);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  });
});
