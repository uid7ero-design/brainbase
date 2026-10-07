import { describe, expect, it } from "vitest";
import { buildAnalysisPlan, type AnalysisReadiness } from "@/lib/data-hub/analysis";

function readiness(): AnalysisReadiness {
  return {
    readinessVersion: "v1", schemaVersion: "v1", profilerVersion: "v1",
    qualityResolutionVersion: "v1", state: "READY", fieldCount: 7,
    catalog: { textAttributes: ["text"], identifiers: ["id"], dimensions: ["category"],
      flags: ["flag"], measures: ["amount"], temporals: ["time"], geoCoordinates: ["geo"] },
  };
}
function request(id = "category") {
  return { requestVersion: "v1", kind: "GROUP_BY", sourceSchemaColumnId: id };
}

describe("D4D5E grouped row count plan", () => {
  it.each(["category", "flag"])("plans a governed grouping for %s", (id) => {
    expect(buildAnalysisPlan(readiness(), request(id))).toEqual({ ok: true, plan: {
      planVersion: "v1", readinessVersion: "v1", schemaVersion: "v1",
      profilerVersion: "v1", qualityResolutionVersion: "v1", readinessState: "READY",
      operation: "GROUPED_ROW_COUNT", sourceSchemaColumnId: id,
      missingValuePolicy: "SEPARATE_GROUP",
    } });
  });
  it.each(["text", "id", "amount", "time", "geo", "missing"])("rejects grouping %s", (id) => {
    expect(buildAnalysisPlan(readiness(), request(id))).toEqual({ ok: false, code: "CAPABILITY_NOT_AVAILABLE" });
  });
  it("rechecks a changed quality hold", () => {
    const input = readiness();
    expect(buildAnalysisPlan(input, request()).ok).toBe(true);
    input.state = "BLOCKED_QUALITY_HOLD";
    expect(buildAnalysisPlan(input, request())).toEqual({ ok: false, code: "QUALITY_HOLD" });
  });
  it("carries acknowledged notices into the grouped plan", () => {
    const input = readiness(); input.state = "READY_WITH_ACKNOWLEDGED_NOTICES";
    expect(buildAnalysisPlan(input, request())).toMatchObject({ ok: true,
      plan: { readinessState: "READY_WITH_ACKNOWLEDGED_NOTICES" } });
  });
  it("does not accept caller-supplied execution or missing-value policy", () => {
    expect(buildAnalysisPlan(readiness(), { ...request(), missingValuePolicy: "DROP" }))
      .toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
  it("retains exact governed IDs rather than trimming them", () => {
    expect(buildAnalysisPlan(readiness(), request(" category ")))
      .toEqual({ ok: false, code: "CAPABILITY_NOT_AVAILABLE" });
  });
  it("is deterministic and leaves the readiness catalog unchanged", () => {
    const input = readiness(); const before = JSON.stringify(input);
    expect(buildAnalysisPlan(input, request())).toEqual(buildAnalysisPlan(input, request()));
    expect(JSON.stringify(input)).toBe(before);
  });
});
