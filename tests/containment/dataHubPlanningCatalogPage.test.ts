import { describe, expect, it, vi } from "vitest";
import { planningFixture } from "../helpers/dataHubPlanningFixture";
import { parsePlanningPageRequest, parsePlanningPageQuery, parsePlanningCatalogPageJson, buildReviewedPlanningCatalogPage } from "@/lib/data-hub/analysis/planningCatalogPage";
const request = (offset = 0, pageSize = 50) => ({ pageVersion: "v1", datasetProfileRunId: "profile", expectedReviewRevision: 3, pageSize, offset });
const expectation = (f = planningFixture(121), offset = 0, pageSize = 50) => ({ context: f.context, reviewRevision: f.review.revision,
  readinessState: f.review.quality.snapshot.state, offset, pageSize, measureColumnIds: f.review.schema.snapshot.fields.map(field => field.sourceSchemaColumnId) });
describe("review-pinned paged discovery", () => {
  it("round-trips first, middle and last pages without losing any governed identity", () => {
    const f = planningFixture(121); const all: string[] = [];
    for (const [offset, length, nextOffset] of [[0, 50, 50], [50, 50, 100], [100, 21, null]] as const) {
      const built = f.page(offset); expect(built.ok).toBe(true);
      if (!built.ok) throw new Error("fixture failed");
      expect(built.page.requests).toHaveLength(length); expect(built.page.nextOffset).toBe(nextOffset);
      expect(built.page.totalMeasures).toBe(121); expect(built.page.rowCountRequest.kind).toBe("ROW_COUNT");
      const parsed = parsePlanningCatalogPageJson(JSON.stringify(built), expectation(f, offset));
      expect(parsed).toEqual({ ok: true, response: built });
      all.push(...built.page.requests.map(entry => entry.sourceSchemaColumnId));
    }
    expect(all).toEqual(expectation(f).measureColumnIds); expect(new Set(all).size).toBe(121);
  });
  it("returns row-only discovery for an empty measure inventory", () => {
    const f = planningFixture(0); const built = f.page();
    expect(built).toMatchObject({ ok: true, page: { totalMeasures: 0, offset: 0, nextOffset: null, requests: [] } });
    expect(parsePlanningCatalogPageJson(JSON.stringify(built), expectation(f))).toEqual({ ok: true, response: built });
  });
  it.each([0, -1, 51, 1.5, NaN, Infinity])("rejects page size %s", pageSize => {
    expect(parsePlanningPageRequest(request(0, pageSize))).toEqual({ ok: false, code: "PLANNING_PAGE_INVALID" });
  });
  it.each([-1, 1, 49, 51, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects unaligned/invalid offset %s", offset => {
    expect(parsePlanningPageRequest(request(offset))).toEqual({ ok: false, code: "PLANNING_PAGE_INVALID" });
  });
  it.each(["pageVersion=v1&pageSize=050&offset=0&datasetProfileRunId=profile&expectedReviewRevision=3",
    "pageVersion=v1&pageSize=50&offset=0x0&datasetProfileRunId=profile&expectedReviewRevision=3",
    "pageVersion=v1&pageSize=50&offset=0&offset=0&datasetProfileRunId=profile&expectedReviewRevision=3",
    "pageVersion=v1&pageSize=50&offset=0&datasetProfileRunId=profile&expectedReviewRevision=3&organisationId=other",
    "pageVersion=v1&pageSize=50&offset=0&datasetProfileRunId=profile", "pageVersion=v2&pageSize=50&offset=0&datasetProfileRunId=profile&expectedReviewRevision=3"])
    ("rejects malformed or injected closed query %#", query => expect(parsePlanningPageQuery(new URLSearchParams(query))).toEqual({ ok: false, code: "PLANNING_PAGE_INVALID" }));
  it("admits canonical query values and copies request input without invoking accessors", () => {
    const parsed = parsePlanningPageQuery(new URLSearchParams(Object.fromEntries(Object.entries(request(50)).map(([key, value]) => [key, String(value)]))));
    expect(parsed).toEqual({ ok: true, request: request(50) });
    const input = request(); const copied = parsePlanningPageRequest(input); input.offset = 50;
    expect(copied).toEqual({ ok: true, request: request() });
    const getter = vi.fn(() => 0); Object.defineProperty(input, "offset", { get: getter });
    expect(parsePlanningPageRequest(input).ok).toBe(false); expect(getter).not.toHaveBeenCalled();
    expect(parsePlanningPageRequest({ ...request(), [Symbol("extra")]: true }).ok).toBe(false);
  });
  it("rejects stale pins before exposing measures and revalidates holds/versions", () => {
    const f = planningFixture();
    expect(buildReviewedPlanningCatalogPage(f.context, f.review, { ...request(), datasetProfileRunId: "obsolete" })).toEqual({ ok: false, code: "REVIEW_PROFILE_CHANGED" });
    expect(buildReviewedPlanningCatalogPage(f.context, f.review, { ...request(), expectedReviewRevision: 2 })).toEqual({ ok: false, code: "REVIEW_REVISION_MISMATCH" });
    f.review.quality.snapshot.state = "HOLD_FOR_REMEDIATION"; expect(f.page()).toEqual({ ok: false, code: "QUALITY_HOLD" });
    f.review.quality.snapshot.state = "READY"; Object.assign(f.review.schema.snapshot, { profilerVersion: "v2" });
    expect(f.page().ok).toBe(false);
  });
  it("rejects offsets beyond the inventory rather than inventing an empty last page", () => {
    expect(planningFixture(100).page(100)).toEqual({ ok: false, code: "PLANNING_PAGE_INVALID" });
    expect(planningFixture(0).page(50)).toEqual({ ok: false, code: "PLANNING_PAGE_INVALID" });
  });
  it.each(["version", "offset", "size", "total", "next", "row", "extra", "order", "foreign", "revision", "partial", "duplicate"])
    ("rejects corrupt or mismatched %s page without partial output", kind => {
      const f = planningFixture(121); const built = f.page(); if (!built.ok) throw new Error("fixture failed");
      const value = structuredClone(built); const page = value.page;
      if (kind === "version") Object.assign(page, { pageVersion: "v2" });
      if (kind === "offset") Object.assign(page, f.page(50).ok ? (f.page(50) as typeof built).page : {});
      if (kind === "size") Object.assign(page, { pageSize: 51 });
      if (kind === "total") Object.assign(page, { totalMeasures: 122 });
      if (kind === "next") page.nextOffset = 0;
      if (kind === "row") Object.assign(page.rowCountRequest, { requestVersion: "v2" });
      if (kind === "extra") Object.assign(page, { rawValues: ["private"] });
      if (kind === "order") (page.requests as unknown[]).reverse();
      if (kind === "foreign") page.context.organisationId = "other";
      if (kind === "revision") page.reviewRevision = 4;
      if (kind === "partial") (page.requests as unknown[]).pop();
      if (kind === "duplicate") (page.requests as unknown[])[1] = page.requests[0];
      const parsed = parsePlanningCatalogPageJson(JSON.stringify(value), expectation(f));
      expect(parsed.ok).toBe(false); expect(parsed).not.toHaveProperty("response");
    });
  it("accepts only unindexed known denials and never exposes private parser text", () => {
    const f = planningFixture(); const expected = expectation(f);
    expect(parsePlanningCatalogPageJson('{"ok":false,"code":"PLANNING_PAGE_INVALID"}', expected)).toEqual({ ok: true, response: { ok: false, code: "PLANNING_PAGE_INVALID" } });
    for (const text of ["<html>private</html>", '{"ok":false,"code":"QUALITY_HOLD","requestIndex":0}', '{"ok":false,"code":"private"}']) {
      expect(parsePlanningCatalogPageJson(text, expected)).toEqual({ ok: false, code: "PLANNING_RESPONSE_INVALID" });
    }
  });
});
