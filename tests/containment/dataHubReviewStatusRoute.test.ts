import { beforeEach, describe, expect, it, vi } from "vitest";
const seams = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/org", () => ({ requireRole: seams.auth }));
vi.mock("@/lib/data-hub/analysisExecution/loadReviewStatus", () => ({ loadReviewStatus: seams.load }));
import { GET } from "@/app/api/data-hub/worksheets/[id]/analysis-status/route";
const context = { params: Promise.resolve({ id: "upload" }) };
beforeEach(() => { vi.resetAllMocks(); seams.auth.mockResolvedValue({ organisationId: "org", userId: "actor" }); });
describe("manager-only metadata review status route", () => {
  it("uses only server/session scope and returns private no-store status", async () => {
    const result = { ok: true, status: { statusVersion: "v1", uploadId: "upload", state: "REVIEW_REQUIRED" } }; seams.load.mockResolvedValue(result);
    const response = await GET(new Request("http://localhost/status"), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(result);
    expect(seams.auth).toHaveBeenCalledWith("manager"); expect(seams.load).toHaveBeenCalledWith({ organisationId: "org", uploadId: "upload" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it.each([["Unauthorized", 401], ["Forbidden", 403]])("rejects %s before input admission or reads", async (message, status) => {
    seams.auth.mockRejectedValue(new Error(message));
    const response = await GET(new Request("http://localhost/status?organisationId=foreign"), context);
    expect(response.status).toBe(status); expect(seams.load).not.toHaveBeenCalled(); expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("rejects query-supplied identity/readiness before any read", async () => {
    const response = await GET(new Request("http://localhost/status?organisationId=foreign&state=REVIEWED"), context);
    expect(response.status).toBe(400); expect(seams.load).not.toHaveBeenCalled();
  });
  it.each([["UPLOAD_NOT_FOUND", 404], ["REVIEW_STATUS_INVALID", 400], ["REVIEW_STATUS_UNAVAILABLE", 503]])("projects safe %s failures", async (code, status) => {
    seams.load.mockResolvedValue({ ok: false, code, private: "secret" }); const response = await GET(new Request("http://localhost/status"), context);
    expect(response.status).toBe(status); expect(await response.json()).toEqual({ ok: false, code }); expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
  it("closes unexpected exceptions without diagnostics", async () => {
    seams.load.mockRejectedValue(new Error("secret")); const response = await GET(new Request("http://localhost/status"), context);
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, code: "REVIEW_STATUS_UNAVAILABLE" });
  });
});
