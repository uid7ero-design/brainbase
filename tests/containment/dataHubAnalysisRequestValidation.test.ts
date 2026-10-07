import { describe, expect, it } from "vitest";
import {
  buildAnalysisCapabilities,
  buildAnalysisReadiness,
  validateAnalysisRequest,
  type AnalysisCapabilitySet,
  type AnalysisRequest,
} from "@/lib/data-hub/analysis";

function capabilities(): AnalysisCapabilitySet {
  return buildAnalysisCapabilities({
    readinessVersion: "v1", schemaVersion: "v1", profilerVersion: "v1",
    qualityResolutionVersion: "v1", state: "READY", fieldCount: 4,
    catalog: { textAttributes: ["text"], identifiers: ["id"],
      dimensions: ["category"], flags: [], measures: ["amount"],
      temporals: [], geoCoordinates: [] },
  });
}

describe("D4D5C analysis request validation", () => {
  it.each<AnalysisRequest>([
    { requestVersion: "v1", kind: "ROW_COUNT" },
    { requestVersion: "v1", kind: "GROUP_BY", sourceSchemaColumnId: "category" },
    { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: "amount" },
  ])("accepts supported intent: $kind", (request) => {
    expect(validateAnalysisRequest(capabilities(), request)).toEqual({ ok: true, request });
  });

  it("rejects every request on quality hold, even malformed input", () => {
    const set = capabilities();
    set.state = "BLOCKED_QUALITY_HOLD";
    for (const request of [null, { requestVersion: "v1", kind: "ROW_COUNT" }]) {
      expect(validateAnalysisRequest(set, request)).toEqual({ ok: false, code: "QUALITY_HOLD" });
    }
  });

  it.each(["text", "id", "amount", "missing"])("does not permit grouping %s", (id) => {
    expect(validateAnalysisRequest(capabilities(), {
      requestVersion: "v1", kind: "GROUP_BY", sourceSchemaColumnId: id,
    })).toEqual({ ok: false, code: "CAPABILITY_NOT_AVAILABLE" });
  });

  it("requires the dataset capability explicitly", () => {
    const set = capabilities();
    set.datasetCapabilities = [];
    expect(validateAnalysisRequest(set, { requestVersion: "v1", kind: "ROW_COUNT" }))
      .toEqual({ ok: false, code: "CAPABILITY_NOT_AVAILABLE" });
  });

  it.each([null, [], "ROW_COUNT", {},
    { requestVersion: "v2", kind: "ROW_COUNT" },
    { requestVersion: "v1", kind: "SQL", query: "select *" },
    { requestVersion: "v1", kind: "ROW_COUNT", value: "source-value" },
    { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: "amount", operator: "SUM" },
    { requestVersion: "v1", kind: "GROUP_BY", sourceSchemaColumnId: " " },
    { requestVersion: "v1", kind: "GROUP_BY", sourceSchemaColumnId: 1 },
  ])("rejects malformed or expanded intent %#", (input) => {
    expect(validateAnalysisRequest(capabilities(), input)).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });

  it("fails closed on unsupported capability versions", () => {
    const set = capabilities();
    set.capabilityVersion = "v2" as typeof set.capabilityVersion;
    expect(validateAnalysisRequest(set, { requestVersion: "v1", kind: "ROW_COUNT" }))
      .toEqual({ ok: false, code: "UNSUPPORTED_CAPABILITY_VERSION" });
  });

  it("copies accepted intent deterministically without mutating input", () => {
    const set = capabilities();
    const before = JSON.stringify(set);
    const request = Object.freeze({ requestVersion: "v1", kind: "ROW_COUNT" });
    const result = validateAnalysisRequest(set, request);
    expect(result).toEqual(validateAnalysisRequest(set, request));
    expect(JSON.stringify(set)).toBe(before);
    if (result.ok) expect(result.request).not.toBe(request);
  });

  it("propagates acknowledged notices through the real readiness-capability chain", () => {
    const result = buildAnalysisReadiness({
      schemaVersion: "v1", resolutionVersion: "v1", inferenceVersion: "v1",
      profilerVersion: "v1", recordKeyCandidateState: "NONE", fields: [],
    }, {
      resolutionVersion: "v1", reviewVersion: "v1", qualityVersion: "v1",
      profilerVersion: "v1", schemaVersion: "v1",
      state: "READY_WITH_ACKNOWLEDGED_NOTICES", itemCount: 1,
      acknowledgedNoticeCount: 1, continuedReviewCount: 0, heldReviewCount: 0, items: [],
    });
    if (!result.ok) throw new Error(result.code);
    expect(validateAnalysisRequest(buildAnalysisCapabilities(result.readiness), {
      requestVersion: "v1", kind: "ROW_COUNT",
    }).ok).toBe(true);
  });
});
