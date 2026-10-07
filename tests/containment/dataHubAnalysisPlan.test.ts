import { describe, expect, it } from "vitest";
import { buildAnalysisPlan, type AnalysisReadiness } from "@/lib/data-hub/analysis";

function readiness(): AnalysisReadiness {
  return {
    readinessVersion: "v1", schemaVersion: "v1", profilerVersion: "v1",
    qualityResolutionVersion: "v1", state: "READY", fieldCount: 2,
    catalog: { textAttributes: [], identifiers: [], dimensions: ["category"],
      flags: [], measures: ["amount"], temporals: [], geoCoordinates: [] },
  };
}
const request = { requestVersion: "v1", kind: "ROW_COUNT" };

describe("D4D5D row count plan", () => {
  it("builds a closed plan with lineage and readiness", () => {
    expect(buildAnalysisPlan(readiness(), request)).toEqual({ ok: true, plan: {
      planVersion: "v1", readinessVersion: "v1", schemaVersion: "v1",
      profilerVersion: "v1", qualityResolutionVersion: "v1",
      readinessState: "READY", operation: "ROW_COUNT",
    } });
  });
  it("preserves acknowledged notices", () => {
    const input = readiness(); input.state = "READY_WITH_ACKNOWLEDGED_NOTICES";
    expect(buildAnalysisPlan(input, request)).toMatchObject({ ok: true,
      plan: { readinessState: "READY_WITH_ACKNOWLEDGED_NOTICES" } });
  });
  it("rechecks a hold even when a request was accepted earlier", () => {
    const input = readiness();
    expect(buildAnalysisPlan(input, request).ok).toBe(true);
    input.state = "BLOCKED_QUALITY_HOLD";
    expect(buildAnalysisPlan(input, request)).toEqual({ ok: false, code: "QUALITY_HOLD" });
  });
  it.each([null, { ...request, query: "SELECT *" }, { ...request, requestVersion: "v2" }])(
    "rejects malformed intent %#", (input) => {
      expect(buildAnalysisPlan(readiness(), input)).toEqual({ ok: false, code: "INVALID_REQUEST" });
    },
  );
  it.each([
    { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: "amount" },
  ])("does not silently plan other supported intents: $kind", (input) => {
    expect(buildAnalysisPlan(readiness(), input)).toEqual({ ok: false, code: "PLAN_KIND_NOT_SUPPORTED" });
  });
  it("still rejects unavailable fields", () => {
    expect(buildAnalysisPlan(readiness(), {
      requestVersion: "v1", kind: "GROUP_BY", sourceSchemaColumnId: "missing",
    })).toEqual({ ok: false, code: "CAPABILITY_NOT_AVAILABLE" });
  });
  it("rejects invalid runtime readiness states", () => {
    const input = readiness(); input.state = "unexpected" as typeof input.state;
    expect(buildAnalysisPlan(input, request).ok).toBe(false);
  });
  it("is deterministic and does not mutate or retain input", () => {
    const input = readiness(); const before = JSON.stringify(input);
    const result = buildAnalysisPlan(input, request);
    expect(result).toEqual(buildAnalysisPlan(input, request));
    expect(JSON.stringify(input)).toBe(before);
    input.state = "BLOCKED_QUALITY_HOLD";
    expect(result).toMatchObject({ ok: true, plan: { readinessState: "READY" } });
  });
});
