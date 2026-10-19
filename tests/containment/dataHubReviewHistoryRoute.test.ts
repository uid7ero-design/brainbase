import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ role: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/org", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/data-hub/analysisExecution/loadReviewHistory", () => ({ loadReviewHistory: mocks.load }));
import * as page from "@/app/api/data-hub/worksheets/[id]/analysis-review/history/route";
import * as compare from "@/app/api/data-hub/worksheets/[id]/analysis-review/history/compare/route";
import { historyFixture } from "../helpers/dataHubHistoryFixture";
const f = historyFixture(), search = "historyVersion=v1&datasetProfileRunId=profile&expectedReviewRevision=3";
const params = { params: Promise.resolve({ id: "upload/a" }) };
beforeEach(() => { vi.resetAllMocks(); mocks.role.mockResolvedValue({ organisationId: "server-org" }); mocks.load.mockResolvedValue({ ok: true, history: f.history }); });
it("derives scope from the live manager session and has GET handlers only", async () => {
  const response = await page.GET(new Request(`http://localhost/history?${search}`), params);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.role).toHaveBeenCalledWith("manager");
  expect(mocks.load).toHaveBeenCalledWith({ organisationId: "server-org", uploadId: "upload/a" }, { kind: "page", datasetProfileRunId: "profile", expectedReviewRevision: 3, beforeRevision: null });
  expect(Object.keys(page)).toEqual(["GET"]); expect(Object.keys(compare)).toEqual(["GET"]);
});
it("admits only the explicit older baseline for comparison", async () => {
  mocks.load.mockResolvedValue({ ok: true, comparison: f.comparison });
  const response = await compare.GET(new Request(`http://localhost/history/compare?${search}&baselineRevision=1`), params);
  expect(response.status).toBe(200); expect(mocks.load.mock.calls[0][1]).toEqual({ kind: "compare", datasetProfileRunId: "profile", expectedReviewRevision: 3, baselineRevision: 1 });
});
it.each(["Forbidden", "Unauthorized"])("checks %s before admitting query data", async message => {
  mocks.role.mockRejectedValue(new Error(message)); const response = await page.GET(new Request("http://localhost/history?private=1"), params);
  expect(response.status).toBe(message === "Forbidden" ? 403 : 401); expect(mocks.load).not.toHaveBeenCalled(); expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it.each(["", search + "&organisationId=foreign", search + "&expectedReviewRevision=3", search + "&beforeRevision=-1"])("rejects invalid queries without reading history %s", async query => {
  const response = await page.GET(new Request(`http://localhost/history?${query}`), params); expect(response.status).toBe(400); expect(mocks.load).not.toHaveBeenCalled();
});
it.each([["UPLOAD_NOT_FOUND", 404], ["REVIEW_NOT_FOUND", 404], ["REVIEW_PROFILE_CHANGED", 409], ["REVIEW_REVISION_MISMATCH", 409], ["REVIEW_RECORD_INVALID", 503], ["REVIEW_FIELD_LIMIT", 422]])("maps %s safely", async (code, status) => {
  mocks.load.mockResolvedValue({ ok: false, code, private: "hidden" }); const response = await page.GET(new Request(`http://localhost/history?${search}`), params);
  expect(response.status).toBe(status); expect(await response.json()).toEqual({ ok: false, code }); expect(response.headers.get("cache-control")).toBe("private, no-store");
});
