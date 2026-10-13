import { describe, expect, it } from "vitest";
import { parseAnalysisRequestInput, validateAnalysisRequest, buildAnalysisCapabilities } from "@/lib/data-hub/analysis";

const rows = { requestVersion: "v1", kind: "ROW_COUNT" };
const group = { requestVersion: "v1", kind: "GROUP_BY", sourceSchemaColumnId: "category" };
const aggregate = { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: "amount" };
const present = { ...aggregate, operator: "COUNT_PRESENT" };
function capabilities() {
  return buildAnalysisCapabilities({ readinessVersion: "v1", schemaVersion: "v1", profilerVersion: "v1",
    qualityResolutionVersion: "v1", state: "READY", fieldCount: 1, catalog: {
      textAttributes: [], identifiers: [], dimensions: [], flags: [], measures: ["amount"], temporals: [], geoCoordinates: [],
    } });
}

describe("closed analysis intent input", () => {
  it.each([rows, group, aggregate, present])("copies supported structural shape %#", input => {
    const result = parseAnalysisRequestInput(Object.freeze({ ...input }));
    expect(result).toEqual({ ok: true, request: input });
    if (!result.ok) throw new Error(result.code);
    expect(result.request).not.toBe(input);
  });
  it("detaches the admitted field identity and operator", () => {
    const input = { ...present }; const result = parseAnalysisRequestInput(input);
    input.sourceSchemaColumnId = "changed"; input.operator = "SUM";
    expect(result).toEqual({ ok: true, request: present });
  });
  it.each([null, [], {}, "ROW_COUNT", { ...rows, extra: true }, { ...rows, requestVersion: "v2" },
    { ...group, sourceSchemaColumnId: " " }, { ...group, operator: "COUNT_PRESENT" },
    { ...present, operator: undefined }, { ...present, operator: "SUM" }, Object.create(rows)])
    ("rejects malformed structure %#", input => {
      expect(parseAnalysisRequestInput(input)).toEqual({ ok: false, code: "INVALID_REQUEST" });
    });
  it.each(["requestVersion", "kind", "sourceSchemaColumnId", "operator"])
    ("rejects %s getter without invoking it", key => {
      const input = { ...present };
      Object.defineProperty(input, key, { enumerable: true, get() { throw new Error("must not invoke request getter"); } });
      expect(parseAnalysisRequestInput(input)).toEqual({ ok: false, code: "INVALID_REQUEST" });
      expect(validateAnalysisRequest(capabilities(), input)).toEqual({ ok: false, code: "INVALID_REQUEST" });
    });
  it("rejects hidden and symbol metadata", () => {
    for (const key of ["hidden", Symbol("extra"), "requestVersion"]) {
      const input = { ...rows }; Object.defineProperty(input, key, { value: "v1", enumerable: false });
      expect(parseAnalysisRequestInput(input)).toEqual({ ok: false, code: "INVALID_REQUEST" });
    }
  });
  it("preserves hold and unavailable-version precedence before parsing input", () => {
    const input = { ...rows };
    Object.defineProperty(input, "kind", { get() { throw new Error("must not read input"); } });
    const set = capabilities(); set.state = "BLOCKED_QUALITY_HOLD";
    expect(validateAnalysisRequest(set, input)).toEqual({ ok: false, code: "QUALITY_HOLD" });
    set.state = "UNAVAILABLE_INVALID_READINESS";
    expect(validateAnalysisRequest(set, input)).toEqual({ ok: false, code: "UNSUPPORTED_CAPABILITY_VERSION" });
  });
  it("keeps structural admission separate from available fields and supported execution", () => {
    expect(parseAnalysisRequestInput(group).ok).toBe(true);
    expect(validateAnalysisRequest(capabilities(), group)).toEqual({ ok: false, code: "CAPABILITY_NOT_AVAILABLE" });
    expect(parseAnalysisRequestInput(aggregate).ok).toBe(true);
    expect(validateAnalysisRequest(capabilities(), aggregate).ok).toBe(true);
    // Generic aggregate intent remains structurally valid; downstream planning rejects it.
  });
});
