import { describe, expect, it } from "vitest";
import { profileDataset } from "@/lib/data-hub/profiling/profileDataset";
import { evaluateProfileCount, type AnalysisReadiness } from "@/lib/data-hub/analysis";

function readiness(): AnalysisReadiness {
  return { readinessVersion: "v1", schemaVersion: "v1", profilerVersion: "v1",
    qualityResolutionVersion: "v1", state: "READY", fieldCount: 1,
    catalog: { textAttributes: [], identifiers: [], dimensions: [], flags: [],
      measures: ["amount"], temporals: [], geoCoordinates: [] } };
}
function profile(rowCount = 3) {
  const result = profileDataset({ rowCount, columns: [{ sourceSchemaColumnId: "amount",
    valueKind: "DECIMAL", sourceUnit: null, normalizedUnit: null,
    cells: rowCount === 0 ? [] : [{ sourceRowNumber: 1, normalizedValue: "0" },
      { sourceRowNumber: 2, normalizedValue: null }] }] });
  if (!result.ok) throw new Error(result.code);
  return result.profile;
}
const rows = { requestVersion: "v1", kind: "ROW_COUNT" };
const present = { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: "amount", operator: "COUNT_PRESENT" };

describe("D4D5G profile count results", () => {
  it("projects the actual profiler's row count", () => {
    expect(evaluateProfileCount(readiness(), rows, profile())).toMatchObject({ ok: true,
      result: { resultVersion: "v1", count: 3, plan: { operation: "ROW_COUNT" } } });
  });
  it("counts zero as present and excludes explicit null and absent cells", () => {
    expect(evaluateProfileCount(readiness(), present, profile())).toMatchObject({ ok: true,
      result: { count: 1, plan: { operation: "COUNT_PRESENT", missingValuePolicy: "EXCLUDE_MISSING" } } });
  });
  it.each([rows, present])("returns zero for an empty profile %#", (request) => {
    expect(evaluateProfileCount(readiness(), request, profile(0))).toMatchObject({ ok: true, result: { count: 0 } });
  });
  it("rechecks quality holds", () => {
    const input = readiness(); input.state = "BLOCKED_QUALITY_HOLD";
    expect(evaluateProfileCount(input, rows, profile())).toEqual({ ok: false, code: "QUALITY_HOLD" });
  });
  it("returns zero for an all-null measure", () => {
    const result = profileDataset({ rowCount: 2, columns: [{ sourceSchemaColumnId: "amount",
      valueKind: "DECIMAL", sourceUnit: null, normalizedUnit: null, cells: [] }] });
    if (!result.ok) throw new Error(result.code);
    expect(evaluateProfileCount(readiness(), present, result.profile))
      .toMatchObject({ ok: true, result: { count: 0 } });
  });
  it("rejects duplicate readiness identities", () => {
    const input = readiness(); input.catalog.measures.push("amount"); input.fieldCount = 2;
    expect(evaluateProfileCount(input, rows, profile()))
      .toEqual({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" });
  });
  it("revalidates request input before producing results", () => {
    expect(evaluateProfileCount(readiness(), { ...rows, query: "select *" }, profile()))
      .toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
  it("preserves acknowledged notices", () => {
    const input = readiness(); input.state = "READY_WITH_ACKNOWLEDGED_NOTICES";
    expect(evaluateProfileCount(input, present, profile())).toMatchObject({ ok: true,
      result: { plan: { readinessState: input.state } } });
  });
  it("rejects profiler version mismatch", () => {
    const input = profile(); input.profilerVersion = "v2" as typeof input.profilerVersion;
    expect(evaluateProfileCount(readiness(), rows, input)).toEqual({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" });
  });
  it.each(["missing", "duplicate", "count"])("rejects inconsistent column identities: %s", (kind) => {
    const input = profile();
    if (kind === "missing") input.columns[0].sourceSchemaColumnId = "other";
    if (kind === "duplicate") { input.columns.push(input.columns[0]); input.columnCount = 2; }
    if (kind === "count") input.columnCount = 2;
    expect(evaluateProfileCount(readiness(), rows, input)).toEqual({ ok: false, code: "PROFILE_LINEAGE_MISMATCH" });
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid row count %s", (count) => {
    const input = profile(); input.rowCount = count;
    expect(evaluateProfileCount(readiness(), rows, input)).toEqual({ ok: false, code: "PROFILE_COUNTS_INVALID" });
  });
  it.each(["nonNull", "null", "row"])("rejects inconsistent column counts: %s", (kind) => {
    const input = profile();
    if (kind === "nonNull") input.columns[0].nonNullCount = 4;
    if (kind === "null") input.columns[0].nullCount = 1;
    if (kind === "row") input.columns[0].rowCount = 4;
    expect(evaluateProfileCount(readiness(), present, input)).toEqual({ ok: false, code: "PROFILE_COUNTS_INVALID" });
  });
  it("does not synthesize grouped counts from a profile", () => {
    const input = readiness(); input.catalog.measures = []; input.catalog.dimensions = ["amount"];
    expect(evaluateProfileCount(input, { requestVersion: "v1", kind: "GROUP_BY", sourceSchemaColumnId: "amount" }, profile()))
      .toEqual({ ok: false, code: "PROFILE_OPERATION_NOT_SUPPORTED" });
  });
  it("returns only count and plan metadata without mutating the profile", () => {
    const input = profile(); const before = JSON.stringify(input);
    const result = evaluateProfileCount(readiness(), present, input);
    expect(result).toEqual(evaluateProfileCount(readiness(), present, input));
    expect(JSON.stringify(input)).toBe(before);
    if (!result.ok) throw new Error(result.code);
    expect(Object.keys(result.result).sort()).toEqual(["count", "plan", "resultVersion"]);
    expect(JSON.stringify(result)).not.toContain("numericStats");
  });
});
