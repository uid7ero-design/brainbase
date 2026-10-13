import { beforeEach, describe, expect, it, vi } from "vitest";
import { planningFixture } from "../helpers/dataHubPlanningFixture";
const seams = vi.hoisted(() => ({ auth: vi.fn(), catalog: vi.fn(), page: vi.fn(), plan: vi.fn() }));
vi.mock("@/lib/org", () => ({ requireRole: seams.auth }));
vi.mock("@/lib/data-hub/analysisExecution/uploadPlanning", () => ({ loadUploadPlanningCatalog: seams.catalog, loadUploadPlanningPage: seams.page, planUploadSelection: seams.plan }));
import { GET, POST } from "@/app/api/data-hub/worksheets/[id]/analysis-planning/route";
const context = { params: Promise.resolve({ id: "upload" }) };
const post = (body = JSON.stringify(planningFixture().body), contentType = "application/json") =>
  new Request("http://localhost?organisationId=other", { method: "POST", headers: { "Content-Type": contentType }, body });
beforeEach(() => { vi.resetAllMocks(); seams.auth.mockResolvedValue({ organisationId: "org", userId: "actor" }); });
describe("authenticated planning route", () => {
  it("serves the closed pinned page query using session scope and no-store", async () => {
    const f = planningFixture(); seams.page.mockResolvedValue(f.page());
    const response = await GET(new Request("http://localhost?" + new URLSearchParams({ pageVersion: "v1", datasetProfileRunId: "profile", expectedReviewRevision: "3", pageSize: "50", offset: "0" })), context);
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(seams.page).toHaveBeenCalledWith({ organisationId: "org", uploadId: "upload" },
      { pageVersion: "v1", datasetProfileRunId: "profile", expectedReviewRevision: 3, pageSize: 50, offset: 0 });
    expect(seams.catalog).not.toHaveBeenCalled();
  });
  it.each(["pageVersion=v1", "pageVersion=v1&offset=0&offset=0", "pageVersion=v1&organisationId=other"])
    ("rejects malformed/injected pages before reading metadata %#", async query => {
      const response = await GET(new Request("http://localhost?" + query), context);
      expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, code: "PLANNING_PAGE_INVALID" });
      expect(seams.page).not.toHaveBeenCalled(); expect(seams.catalog).not.toHaveBeenCalled();
    });
  it("requires manager authorization before page input admission", async () => {
    seams.auth.mockRejectedValue(new Error("Forbidden"));
    expect((await GET(new Request("http://localhost?pageVersion=v1"), context)).status).toBe(403);
    expect(seams.page).not.toHaveBeenCalled();
  });
  it("uses only session/path scope and no-store responses for both methods", async () => {
    const f = planningFixture(); seams.catalog.mockResolvedValue(f.catalog()); seams.plan.mockResolvedValue(f.planned());
    const responses = [await GET(new Request("http://localhost?organisationId=other"), context), await POST(post(), context)];
    for (const response of responses) { expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); }
    expect(seams.auth).toHaveBeenCalledWith("manager");
    expect(seams.catalog).toHaveBeenCalledWith({ organisationId: "org", uploadId: "upload" });
    expect(seams.plan).toHaveBeenCalledWith({ organisationId: "org", uploadId: "upload" }, f.body);
  });
  it.each([["Unauthorized", 401], ["Forbidden", 403]] as const)("denies %s before reading/planning", async (message, status) => {
    seams.auth.mockRejectedValue(new Error(message));
    for (const response of [await GET(new Request("http://localhost"), context), await POST(post(), context)]) {
      expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(seams.catalog).not.toHaveBeenCalled(); expect(seams.plan).not.toHaveBeenCalled();
  });
  it.each(["{private", "null", "x".repeat(65537)])("rejects malformed/oversized JSON before service invocation %#", async body => {
    const response = await POST(post(body), context);
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false, code: "PROFILE_SELECTION_INVALID" });
    expect(seams.plan).not.toHaveBeenCalled();
  });
  it("rejects wrong content type and measures bytes rather than trusting Content-Length", async () => {
    expect((await POST(post("{}", "text/plain"), context)).status).toBe(400);
    const request = post("x".repeat(65537)); request.headers.set("Content-Length", "1");
    expect((await POST(request, context)).status).toBe(400); expect(seams.plan).not.toHaveBeenCalled();
  });
  it("rejects valid JSON over the UTF-8 byte limit even when its character length fits", async () => {
    const body = JSON.stringify({ ...planningFixture().body, datasetProfileRunId: "é".repeat(33000) });
    expect(body.length).toBeLessThan(65536);
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(65536);
    expect((await POST(post(body), context)).status).toBe(400);
    expect(seams.plan).not.toHaveBeenCalled();
  });
  it.each([["UPLOAD_NOT_FOUND", 404], ["REVIEW_NOT_FOUND", 404], ["REVIEW_PROFILE_CHANGED", 409],
    ["REVIEW_REVISION_MISMATCH", 409], ["QUALITY_HOLD", 422], ["REVIEW_READ_FAILED", 503]] as const)
    ("preserves closed %s denial with HTTP %s", async (code, status) => {
      seams.plan.mockResolvedValue({ ok: false, code }); const response = await POST(post(), context);
      expect(response.status).toBe(status); expect(await response.json()).toEqual({ ok: false, code });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });
  it("does not expose unexpected service exceptions", async () => {
    seams.catalog.mockRejectedValue(new Error("private"));
    expect(await (await GET(new Request("http://localhost"), context)).json()).toEqual({ ok: false, code: "REVIEW_READ_FAILED" });
  });
});
