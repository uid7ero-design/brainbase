import { describe, expect, it } from "vitest";
import { buildAnalysisCapabilities, buildAnalysisPlan, validateAnalysisRequest,
  type AnalysisReadiness } from "@/lib/data-hub/analysis";

function readiness(): AnalysisReadiness {
  return { readinessVersion: "v1", schemaVersion: "v1", profilerVersion: "v1",
    qualityResolutionVersion: "v1", state: "READY", fieldCount: 7,
    catalog: { textAttributes: ["text"], identifiers: ["id"], dimensions: ["category"],
      flags: ["flag"], measures: ["amount"], temporals: ["time"], geoCoordinates: ["geo"] } };
}
function request(id = "amount") {
  return { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: id, operator: "COUNT_PRESENT" };
}

describe("D4D5F count-present plan", () => {
  it("validates and preserves the explicit operator", () => {
    expect(validateAnalysisRequest(buildAnalysisCapabilities(readiness()), request()))
      .toEqual({ ok: true, request: request() });
  });
  it("builds a closed measure count plan with explicit missing policy", () => {
    expect(buildAnalysisPlan(readiness(), request())).toEqual({ ok: true, plan: {
      planVersion: "v1", readinessVersion: "v1", schemaVersion: "v1", profilerVersion: "v1",
      qualityResolutionVersion: "v1", readinessState: "READY", operation: "COUNT_PRESENT",
      sourceSchemaColumnId: "amount", missingValuePolicy: "EXCLUDE_MISSING",
    } });
  });
  it.each(["text", "id", "category", "flag", "time", "geo", "missing"])(
    "rejects non-measure or unknown field %s", (id) => {
      expect(buildAnalysisPlan(readiness(), request(id))).toEqual({ ok: false, code: "CAPABILITY_NOT_AVAILABLE" });
    },
  );
  it.each(["SUM", "AVG", "MIN", "MAX", null, undefined])("rejects unsupported operator %s", (operator) => {
    expect(buildAnalysisPlan(readiness(), { ...request(), operator })).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
  it("keeps generic aggregate intent valid but unplanned", () => {
    const input = { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: "amount" };
    expect(validateAnalysisRequest(buildAnalysisCapabilities(readiness()), input)).toEqual({ ok: true, request: input });
    expect(buildAnalysisPlan(readiness(), input)).toEqual({ ok: false, code: "PLAN_KIND_NOT_SUPPORTED" });
  });
  it.each(["ROW_COUNT", "GROUP_BY"])("rejects an operator on %s", (kind) => {
    expect(buildAnalysisPlan(readiness(), { ...request(), kind })).toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
  it("rejects caller-supplied missing policy", () => {
    expect(buildAnalysisPlan(readiness(), { ...request(), missingValuePolicy: "INCLUDE" }))
      .toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
  it("blocks planning after a quality hold", () => {
    const input = readiness();
    expect(buildAnalysisPlan(input, request()).ok).toBe(true);
    input.state = "BLOCKED_QUALITY_HOLD";
    expect(buildAnalysisPlan(input, request())).toEqual({ ok: false, code: "QUALITY_HOLD" });
  });
  it("preserves notices without modifying input", () => {
    const input = readiness(); input.state = "READY_WITH_ACKNOWLEDGED_NOTICES";
    const before = JSON.stringify(input);
    const result = buildAnalysisPlan(input, request());
    expect(result).toMatchObject({ ok: true, plan: { readinessState: input.state } });
    expect(result).toEqual(buildAnalysisPlan(input, request()));
    expect(JSON.stringify(input)).toBe(before);
  });
});
