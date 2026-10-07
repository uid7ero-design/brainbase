import { beforeEach, describe, expect, it, vi } from "vitest";
const seams = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/org", () => ({ requireRole: seams.auth }));
vi.mock("@/lib/data-hub/analysisExecution/loadAnalysisReview", () => ({ loadAnalysisReview: seams.load }));
vi.mock("@/lib/data-hub/analysisExecution/saveAnalysisReview", () => ({ saveAnalysisReview: seams.save }));
import { GET, POST } from "@/app/api/data-hub/worksheets/[id]/analysis-review/route";
const context = { params: Promise.resolve({ id: "upload" }) };
const body = { reviewVersion: "v1", datasetProfileRunId: "profile", semanticChoices: [], qualityDecisions: [] };
const request = () => new Request("http://localhost/api?organisationId=other&actorId=other", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); seams.auth.mockResolvedValue({ organisationId: "org", userId: "actor" }); });
describe("D4D5U manager analysis review API (mocked service boundary)", () => {
  it("takes scope from the session and path for reads", async () => {
    seams.load.mockResolvedValue({ ok: true, revision: 1 });
    const response = await GET(request(), context);
    expect(response.status).toBe(200); expect(seams.auth).toHaveBeenCalledWith("manager");
    expect(seams.load).toHaveBeenCalledWith({ organisationId: "org", uploadId: "upload" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("takes reviewer identity from the session and reports append creation", async () => {
    seams.save.mockResolvedValue({ ok: true, revision: 2 });
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect(seams.save).toHaveBeenCalledWith({ organisationId: "org", uploadId: "upload", actorId: "actor" }, body);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it.each([GET, POST])("rejects unauthenticated and forbidden callers before services", async (handler) => {
    for (const [message, status] of [["Unauthorized", 401], ["Forbidden", 403]] as const) {
      seams.auth.mockRejectedValue(new Error(message));
      expect((await handler(request(), context)).status).toBe(status);
    }
    expect(seams.load).not.toHaveBeenCalled(); expect(seams.save).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON without invoking save", async () => {
    expect((await POST(new Request("http://localhost", { method: "POST", body: "{" }), context)).status).toBe(400);
    expect(seams.save).not.toHaveBeenCalled();
  });
  it.each([["UPLOAD_NOT_FOUND", 404], ["REVIEW_NOT_FOUND", 404], ["REVIEW_ACTOR_INVALID", 403],
    ["REVIEW_INPUT_INVALID", 400], ["REVIEW_PROFILE_CHANGED", 409], ["PROFILE_NOT_COMPLETE", 409],
    ["DECISION_REQUIRED", 422], ["ROLE_NOT_CANDIDATE", 422], ["REVIEW_SAVE_FAILED", 503]])(
    "maps %s without reflecting service details", async (code, status) => {
      seams.save.mockResolvedValue({ ok: false, code, message: "secret source value" });
      const response = await POST(request(), context);
      expect(response.status).toBe(status); expect(await response.json()).toEqual({ ok: false, code });
    });
  it.each([GET, POST])("closes unexpected service exceptions", async (handler) => {
    seams.load.mockRejectedValue(new Error("secret")); seams.save.mockRejectedValue(new Error("secret"));
    const response = await handler(request(), context);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  });
});
