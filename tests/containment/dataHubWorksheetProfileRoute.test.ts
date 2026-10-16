import { beforeEach, describe, expect, it, vi } from "vitest";
const seams = vi.hoisted(() => ({ auth: vi.fn(), status: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/org", () => ({ requireRole: seams.auth }));
vi.mock("@/lib/data-hub/preparation/worksheetProfile", () => ({ getWorksheetProfileStatus: seams.status, profileWorksheetForReview: seams.profile }));
import { GET, POST } from "@/app/api/data-hub/worksheets/[id]/profile/route";
const context = { params: Promise.resolve({ id: "worksheet" }) };
const request = (method = "GET", body?: string) => new Request("http://localhost?organisationId=foreign&normalizationRunId=other", { method, body });
beforeEach(() => { vi.resetAllMocks(); seams.auth.mockResolvedValue({ organisationId: "org", userId: "manager" }); });
describe("worksheet profiling HTTP boundary", () => {
  it.each([GET, POST])("denies unsigned and lower-role callers before reads or work", async handler => {
    for (const [message, status] of [["Unauthorized", 401], ["Forbidden", 403]] as const) {
      seams.auth.mockRejectedValue(new Error(message));
      const response = await handler(request(handler === POST ? "POST" : "GET"), context);
      expect(response.status).toBe(status); expect(seams.status).not.toHaveBeenCalled(); expect(seams.profile).not.toHaveBeenCalled();
    }
  });
  it("reads status from session scope without invoking the profiler", async () => {
    seams.status.mockResolvedValue({ ok: true, status: "NOT_READY" });
    const response = await GET(request(), context);
    expect(await response.json()).toEqual({ ok: true, status: "NOT_READY" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(seams.auth).toHaveBeenCalledWith("manager");
    expect(seams.status).toHaveBeenCalledWith({ organisationId: "org", uploadId: "worksheet" }); expect(seams.profile).not.toHaveBeenCalled();
  });
  it.each(["{}", '{"organisationId":"foreign","normalizationRunId":"other"}', "not json"])("rejects any posted input: %s", async body => {
    expect((await POST(request("POST", body), context)).status).toBe(400); expect(seams.profile).not.toHaveBeenCalled();
  });
  it.each([["SUCCEEDED", 200], ["RUNNING", 202]])("runs in signed-in scope and maps %s", async (status, httpStatus) => {
    seams.profile.mockResolvedValue({ ok: true, status });
    const response = await POST(request("POST"), context);
    expect(response.status).toBe(httpStatus); expect(seams.profile).toHaveBeenCalledWith({ organisationId: "org", uploadId: "worksheet", actorId: "manager" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("accepts an empty POST stream as used by HTTP adapters", async () => {
    seams.profile.mockResolvedValue({ ok: true, status: "SUCCEEDED", rowCount: 3, columnCount: 4 });
    expect((await POST(request("POST", ""), context)).status).toBe(200);
  });
  it.each([["UPLOAD_NOT_FOUND", 404], ["NORMALIZATION_NOT_COMPLETE", 409], ["PROFILER_VERSION_UNSUPPORTED", 409],
    ["PROFILE_INPUT_INVALID", 422], ["INTERACTIVE_PROFILE_LIMIT", 422], ["PERSISTENCE_FAILURE", 503]])("maps %s without diagnostics", async (code, httpStatus) => {
    seams.profile.mockResolvedValue({ ok: false, code, detail: "private evidence" });
    const response = await POST(request("POST"), context); expect(response.status).toBe(httpStatus); expect(await response.json()).toEqual({ ok: false, code });
  });
  it.each([GET, POST])("closes unexpected service exceptions", async handler => {
    seams.profile.mockRejectedValue(new Error("private evidence")); seams.status.mockRejectedValue(new Error("private evidence"));
    const response = await handler(request(handler === POST ? "POST" : "GET"), context);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private evidence");
  });
});
