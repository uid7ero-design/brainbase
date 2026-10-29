import { describe, expect, it } from "vitest";
import { parseProfileDocument, type ColumnRuleV2 } from "@/lib/data-hub/schemaProfiles/profileDocument";
import { transformValue } from "@/lib/data-hub/normalization/transformValue";
import { isLegacyCompatiblePlan } from "@/lib/data-hub/normalization/contracts";
import { buildRunsProfile, createRunsPilotReview, RUNS_REVIEW_FIELDS } from "@/lib/data-hub/schemaProfiles/runsPilotReview";
import { parseMappingSnapshot } from "@/lib/data-hub/client/mappingSetup";

const document = (rule: unknown) => ({ documentVersion: 2, schemaStatus: "ACTIVE", headerRowOneBased: 3, columnRules: [rule] });
describe("explicit day, rate and count policies", () => {
  it.each([
    ["DURATION", "d", "h", "0.5", "12"], ["DURATION", "d", "s", "1.25", "108000"],
    ["DURATION", "h", "d", "12", "0.5"], ["DURATION", "d", "d", "0.5", "0.5"],
    ["DECIMAL", "t/h", "kg/h", "1.125", "1125"], ["DECIMAL", "kg/h", "t/h", "12.5", "0.0125"],
    ["DECIMAL", "bins/h", "bins/h", "12.5", "12.5"],
  ])("converts %s %s to %s exactly", (valueKind, sourceUnit, normalizedUnit, rawValue, expected) => {
    const rule = { sourceSchemaColumnId: "synthetic", valueKind, sourceUnit, normalizedUnit };
    expect(parseProfileDocument(document(rule)).ok).toBe(true);
    expect(transformValue(rule as ColumnRuleV2, { rawValueType: "STRING", rawValue })).toMatchObject({ ok: true,
      output: { normalizedValue: expected, sourceUnit, normalizedUnit } });
  });
  it.each([["t/h", "kg"], ["bins/h", "kg/h"], ["d", "t/h"]])("rejects incompatible dimensions %s -> %s", (sourceUnit, normalizedUnit) => {
    expect(parseProfileDocument(document({ sourceSchemaColumnId: "synthetic", valueKind: "DECIMAL", sourceUnit, normalizedUnit })).ok).toBe(false);
  });
  it("does not round a repeating hour-to-day conversion", () => {
    expect(transformValue({ sourceSchemaColumnId: "synthetic", valueKind: "DURATION", sourceUnit: "h", normalizedUnit: "d" },
      { rawValueType: "NUMBER", rawValue: 1 })).toMatchObject({ ok: false, findings: [{ code: "NON_TERMINATING_UNIT_CONVERSION" }] });
  });
  it("requires an explicit minimum and preserves legacy signed integers and nulls", () => {
    const rule: ColumnRuleV2 = { sourceSchemaColumnId: "synthetic", valueKind: "INTEGER", minimum: "0" };
    expect(parseProfileDocument(document(rule)).ok).toBe(true);
    for (const rawValue of [-1, "-1"]) expect(transformValue(rule, { rawValueType: typeof rawValue === "number" ? "NUMBER" : "STRING", rawValue }))
      .toMatchObject({ ok: false, findings: [{ code: "NUMERIC_VALUE_BELOW_MINIMUM" }] });
    expect(transformValue(rule, { rawValueType: "NUMBER", rawValue: 0 })).toMatchObject({ ok: true, output: { normalizedValue: "0" } });
    expect(transformValue(rule, { rawValueType: "NULL", rawValue: null })).toMatchObject({ ok: true, output: { normalizedValue: null } });
    expect(transformValue({ sourceSchemaColumnId: "synthetic", valueKind: "INTEGER" }, { rawValueType: "NUMBER", rawValue: -1 })).toMatchObject({ ok: true });
    for (const minimum of [0, "-1", "1", true]) expect(parseProfileDocument(document({ ...rule, minimum })).ok).toBe(false);
    expect(parseProfileDocument(document({ ...rule, valueKind: "DECIMAL" })).ok).toBe(false);
  });
  it("never executes added semantics under a pinned v1 normalizer label", () => {
    const rulesByColumnId = new Map<string, ColumnRuleV2>([["a", { sourceSchemaColumnId: "a", valueKind: "INTEGER" }]]);
    expect(isLegacyCompatiblePlan("v1", { rulesByColumnId })).toBe(true);
    rulesByColumnId.get("a")!.minimum = "0";
    expect(isLegacyCompatiblePlan("v1", { rulesByColumnId })).toBe(false);
    rulesByColumnId.set("a", { sourceSchemaColumnId: "a", valueKind: "DURATION", sourceUnit: "d", normalizedUnit: "h" });
    expect(isLegacyCompatiblePlan("v1", { rulesByColumnId })).toBe(false);
    expect(isLegacyCompatiblePlan("future", { rulesByColumnId })).toBe(false);
  });
  it("compiles only complete reviews against exact server-resolved columns", () => {
    const review = createRunsPilotReview(); review.missingPolicy = "NULL_ONLY";
    review.fields.forEach((f, ordinal) => { f.confirmed = true; f.unit ??= ordinal === 12 ? "kg" : "km";
      if (f.representation === "WHOLE_NUMBER") f.negativePolicy = "FORBID"; });
    const columns = RUNS_REVIEW_FIELDS.map(f => ({ id: `synthetic-${f.ordinal}`, ordinal: f.ordinal, sourceHeader: f.header, sensitivityClass: f.sensitivity }));
    const result = buildRunsProfile(review, columns);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture invalid");
    expect(result.document.columnRules[6]).toMatchObject({ minimum: "0" });
    expect(result.document.columnRules[17]).toMatchObject({ sourceUnit: "d", normalizedUnit: "d" });
    expect(buildRunsProfile(review, columns.slice(1)).ok).toBe(false);
    expect(buildRunsProfile(review, columns.map(c => ({ ...c, sensitivityClass: "PUBLIC" }))).ok).toBe(false);
    expect(buildRunsProfile({ ...review, fields: review.fields.map(f => ({ ...f, confirmed: false })) }, columns).ok).toBe(false);
    const snapshot = { ok: true, kind: "SETUP", fingerprint: "a".repeat(64), version: 2, canSave: false, saved: true, confirmed: false, review };
    expect(parseMappingSnapshot(snapshot)).not.toBeNull();
    expect(parseMappingSnapshot({ ...snapshot, saved: false, confirmed: true })).toBeNull();
    expect(parseMappingSnapshot({ ...snapshot, sourceValues: ["private"] })).toBeNull();
    expect(parseMappingSnapshot({ ...snapshot, review: createRunsPilotReview() })).toBeNull();
  });
});
