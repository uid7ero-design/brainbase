import { describe, expect, it } from "vitest";
import { buildAnalysisPlan, buildProfileCountPlan, evaluateProfileCount,
  hasValidAnalysisFieldCatalog, type AnalysisReadiness } from "@/lib/data-hub/analysis";

function readiness(): AnalysisReadiness {
  return { readinessVersion: "v1", schemaVersion: "v1", profilerVersion: "v1",
    qualityResolutionVersion: "v1", state: "READY", fieldCount: 2,
    catalog: { textAttributes: [], identifiers: [], dimensions: ["category"], flags: [],
      measures: ["amount"], temporals: [], geoCoordinates: [] } };
}
const requests = [{ requestVersion: "v1", kind: "ROW_COUNT" },
  { requestVersion: "v1", kind: "GROUP_BY", sourceSchemaColumnId: "category" },
  { requestVersion: "v1", kind: "AGGREGATE", operator: "COUNT_PRESENT", sourceSchemaColumnId: "amount" }];

describe("planning catalog admission", () => {
  it("accepts a complete catalog without mutating metadata", () => {
    const input = readiness(); const before = structuredClone(input);
    expect(hasValidAnalysisFieldCatalog(input)).toBe(true);
    for (const request of requests) expect(buildAnalysisPlan(input, request).ok).toBe(true);
    expect(input).toEqual(before);
  });
  it("accepts an empty dataset catalog and plans only its row count", () => {
    const input = readiness(); input.fieldCount = 0; input.catalog.dimensions = []; input.catalog.measures = [];
    expect(buildProfileCountPlan(input, requests[0]).ok).toBe(true);
    expect(buildAnalysisPlan(input, requests[2])).toEqual({ ok: false, code: "CAPABILITY_NOT_AVAILABLE" });
  });
  it.each(["negative", "fraction", "unsafe", "mismatch", "missing", "extra", "not-array",
    "duplicate", "cross-role", "blank", "non-string", "sparse"])("rejects malformed metadata %s before evidence access", kind => {
    const input = readiness();
    if (kind === "negative") input.fieldCount = -1;
    if (kind === "fraction") input.fieldCount = 1.5;
    if (kind === "unsafe") input.fieldCount = Number.MAX_SAFE_INTEGER + 1;
    if (kind === "mismatch") input.fieldCount = 3;
    if (kind === "missing") Reflect.deleteProperty(input.catalog, "flags");
    if (kind === "extra") Object.assign(input.catalog, { unknownFields: [] });
    if (kind === "not-array") Object.assign(input.catalog, { measures: "amount" });
    if (kind === "duplicate") { input.catalog.measures.push("amount"); input.fieldCount++; }
    if (kind === "cross-role") { input.catalog.flags.push("amount"); input.fieldCount++; }
    if (kind === "blank") input.catalog.measures = [" "];
    if (kind === "non-string") Object.assign(input.catalog, { measures: [null] });
    if (kind === "sparse") input.catalog.measures = new Array(1);
    expect(hasValidAnalysisFieldCatalog(input)).toBe(false);
    const denied = { ok: false, code: "READINESS_CATALOG_INVALID" };
    for (const request of requests) expect(buildAnalysisPlan(input, request)).toEqual(denied);
    expect(buildProfileCountPlan(input, requests[0])).toEqual(denied);
    const profile = { get rowCount(): number { throw new Error("Evidence must not be read"); } };
    expect(evaluateProfileCount(input, requests[0], profile as Parameters<typeof evaluateProfileCount>[2])).toEqual(denied);
  });
  it.each([null, undefined, [], {}, { fieldCount: 0, catalog: null }])("rejects incomplete runtime readiness %#", input => {
    expect(hasValidAnalysisFieldCatalog(input)).toBe(false);
    expect(buildAnalysisPlan(input as unknown as AnalysisReadiness, requests[0]))
      .toEqual({ ok: false, code: "READINESS_CATALOG_INVALID" });
  });
  it("preserves hold denial even when its catalog is unavailable", () => {
    const input = { state: "BLOCKED_QUALITY_HOLD" } as AnalysisReadiness;
    expect(buildProfileCountPlan(input, requests[0])).toEqual({ ok: false, code: "QUALITY_HOLD" });
  });
});
