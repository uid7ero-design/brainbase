import { describe, expect, it } from "vitest";
import { buildAnalysisPlan, buildProfileCountPlan, evaluateProfileCount, type AnalysisReadiness } from "@/lib/data-hub/analysis";

function readiness(): AnalysisReadiness {
  return { readinessVersion: "v1", schemaVersion: "v1", profilerVersion: "v1",
    qualityResolutionVersion: "v1", state: "READY", fieldCount: 2,
    catalog: { textAttributes: [], identifiers: [], dimensions: ["category"], flags: [],
      measures: ["amount"], temporals: [], geoCoordinates: [] } };
}
const rows = { requestVersion: "v1", kind: "ROW_COUNT" };
const present = { requestVersion: "v1", kind: "AGGREGATE", operator: "COUNT_PRESENT", sourceSchemaColumnId: "amount" };

describe("profile-statistics planning boundary", () => {
  it.each([rows, present])("preserves supported plans without evaluating evidence %#", request => {
    const input = readiness(); const before = structuredClone(input);
    expect(buildProfileCountPlan(input, request)).toEqual(buildAnalysisPlan(input, request));
    expect(input).toEqual(before);
  });
  it("distinguishes a valid grouped intent from profile support", () => {
    const request = { requestVersion: "v1", kind: "GROUP_BY", sourceSchemaColumnId: "category" };
    expect(buildAnalysisPlan(readiness(), request)).toMatchObject({ ok: true, plan: { operation: "GROUPED_ROW_COUNT" } });
    expect(buildProfileCountPlan(readiness(), request)).toEqual({ ok: false, code: "PROFILE_OPERATION_NOT_SUPPORTED" });
  });
  it.each(["schemaVersion", "profilerVersion", "qualityResolutionVersion"] as const)("rejects unsupported %s before reading profile statistics", key => {
    const input = readiness(); Object.assign(input, { [key]: "v2" });
    const evidence = { get rowCount(): number { throw new Error("Statistics must not be read"); } };
    for (const request of [rows, present]) {
      expect(buildProfileCountPlan(input, request)).toEqual({ ok: false, code: "PROFILE_PLAN_VERSION_UNSUPPORTED" });
      expect(evaluateProfileCount(input, request, evidence as Parameters<typeof evaluateProfileCount>[2]))
        .toEqual({ ok: false, code: "PROFILE_PLAN_VERSION_UNSUPPORTED" });
    }
  });
  it("retains holds and capability denial before target planning", () => {
    const input = readiness(); input.state = "BLOCKED_QUALITY_HOLD";
    expect(buildProfileCountPlan(input, rows)).toEqual({ ok: false, code: "QUALITY_HOLD" });
    expect(buildProfileCountPlan(readiness(), { ...present, sourceSchemaColumnId: "category" }))
      .toEqual({ ok: false, code: "CAPABILITY_NOT_AVAILABLE" });
  });
  it("retains acknowledged notices and excludes missing values for present counts", () => {
    const input = readiness(); input.state = "READY_WITH_ACKNOWLEDGED_NOTICES";
    expect(buildProfileCountPlan(input, present)).toMatchObject({ ok: true,
      plan: { readinessState: input.state, missingValuePolicy: "EXCLUDE_MISSING" } });
  });
  it("does not introduce a generic aggregate fallback", () => {
    expect(buildProfileCountPlan(readiness(), { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: "amount" }))
      .toEqual({ ok: false, code: "PLAN_KIND_NOT_SUPPORTED" });
  });
});
