import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import manifest from "@/config/data-hub/onkaparinga-monthly-operations-v1.json";
import matrix from "@/docs/architecture/data-hub-pilot-v2-review-matrix.json";
import { createRunsPilotReview, evaluateRunsPilotReview, RUNS_REVIEW_FIELDS } from "@/lib/data-hub/schemaProfiles/runsPilotReview";
import { parseProfileDocument, type ColumnRuleV2 } from "@/lib/data-hub/schemaProfiles/profileDocument";
import { buildNormalizationPlan } from "@/lib/data-hub/normalization/plan";
import { transformValue } from "@/lib/data-hub/normalization/transformValue";
import { transformRow } from "@/lib/data-hub/normalization/transformRow";
import { readWorksheetDataRows } from "@/lib/data-hub/workbookParser";
import type { RawCellInput } from "@/lib/data-hub/normalization/contracts";

const N = (rawValue: number): RawCellInput => ({ rawValueType: "NUMBER", rawValue });
const S = (rawValue: string): RawCellInput => ({ rawValueType: "STRING", rawValue });
const NULL: RawCellInput = { rawValueType: "NULL", rawValue: null };

function confirmedReview() {
  const review = createRunsPilotReview(); review.missingPolicy = "NULL_ONLY";
  review.fields.forEach(field => { field.confirmed = true; field.unit ??= "km";
    if (field.columnId.endsWith("c012")) field.unit = "kg";
    if (field.representation === "WHOLE_NUMBER") field.negativePolicy = "ALLOW"; });
  return review;
}
function syntheticProfile() {
  // Synthetic conventions ONLY: no claim about the real pilot source values.
  const columnRules: ColumnRuleV2[] = RUNS_REVIEW_FIELDS.map(({ id, ordinal }) => {
    if ([0, 2].includes(ordinal)) return { sourceSchemaColumnId: id, valueKind: "IDENTIFIER", preserveLeadingZeros: true };
    if (ordinal === 1) return { sourceSchemaColumnId: id, valueKind: "DATE", datePolicy: "ISO_8601" };
    if ([3, 4, 5].includes(ordinal)) return { sourceSchemaColumnId: id, valueKind: "STRING" };
    if (ordinal >= 6 && ordinal <= 10) return { sourceSchemaColumnId: id, valueKind: "INTEGER" };
    if (ordinal >= 15 && ordinal <= 17) return { sourceSchemaColumnId: id, valueKind: "DURATION", sourceUnit: "h", normalizedUnit: "h" };
    return { sourceSchemaColumnId: id, valueKind: "DECIMAL" };
  });
  return { documentVersion: 2, headerRowOneBased: 3, schemaStatus: "ACTIVE", columnRules };
}

describe("Runs owner review — exact inventory and explicit confirmation", () => {
  it("covers the exact 21 fields, ordinals, header row and existing sensitivity labels", () => {
    const runs = manifest.worksheets.find(w => w.logicalKey === "runs")!;
    const proposed = matrix.worksheets.find(w => w.name === "Runs")!;
    expect(runs.headerRowOneBased).toBe(3); expect(RUNS_REVIEW_FIELDS).toHaveLength(21);
    expect(RUNS_REVIEW_FIELDS.map(f => ({ id: f.id, ordinal: f.ordinal, header: f.header })))
      .toEqual(proposed.fields.map(f => ({ id: f.id, ordinal: f.ordinal, header: f.header })));
    expect(RUNS_REVIEW_FIELDS.map(f => f.sensitivity)).toEqual(runs.columns.map(c => c.sensitivityClass));
    expect(RUNS_REVIEW_FIELDS[5].sensitivity).toBe("PERSONALLY_IDENTIFIABLE");
  });
  it("records tonnes/days/working hours as suggestions with zero confirmed fields", () => {
    const review = createRunsPilotReview(), result = evaluateRunsPilotReview(review);
    expect(review.fields[11]).toMatchObject({ unit: "t", confirmed: false });
    expect(review.fields[15]).toMatchObject({ unit: "h", confirmed: false });
    expect(review.fields[17]).toMatchObject({ unit: "d", confirmed: false });
    expect(review.fields[12].unit).toBeNull(); expect(review.fields[20].unit).toBeNull();
    expect(result).toMatchObject({ ok: true, activationAllowed: false, confirmedCount: 0, reviewComplete: false, blockers: [] });
  });
  it("cannot mistake a complete review for an executable or activated mapping", () => {
    const result = evaluateRunsPilotReview(confirmedReview());
    expect(result).toMatchObject({ ok: true, activationAllowed: false, confirmedCount: 21, reviewComplete: true });
    expect(parseProfileDocument(result.ok ? result.review : result).ok).toBe(false);
    if (result.ok) expect(result.blockers.map(b => b.code)).toEqual([
      "RATE_UNIT_NEEDS_SUPPORT", "RATE_UNIT_NEEDS_SUPPORT", "DAY_UNIT_NEEDS_SUPPORT",
    ]);
  });
  it("requires missing policy and negative policy rather than treating a checkbox as sufficient", () => {
    const review = confirmedReview(); review.missingPolicy = null; review.fields[6].negativePolicy = null;
    expect(evaluateRunsPilotReview(review)).toMatchObject({ ok: true, confirmedCount: 20, reviewComplete: false });
  });
  it.each([
    ["activation flag", (r: Record<string, unknown>) => { r.activationAllowed = true; }],
    ["foreign schema", (r: Record<string, unknown>) => { r.schemaId = "another-schema"; }],
    ["foreign worksheet", (r: Record<string, unknown>) => { r.worksheetId = "another-worksheet"; }],
    ["unknown key/cell payload", (r: Record<string, unknown>) => { r.sample = "private value"; }],
    ["missing field", (r: Record<string, unknown>) => { (r.fields as unknown[]).pop(); }],
    ["duplicate identity", (r: Record<string, unknown>) => { (r.fields as unknown[])[1] = (r.fields as unknown[])[0]; }],
    ["string boolean", (r: Record<string, unknown>) => { (r.fields as Record<string, unknown>[])[0].confirmed = "true"; }],
    ["unknown field key", (r: Record<string, unknown>) => { (r.fields as Record<string, unknown>[])[0].rawValue = "private value"; }],
    ["wrong physical family", (r: Record<string, unknown>) => { (r.fields as Record<string, unknown>[])[11].unit = "km"; }],
    ["wrong representation", (r: Record<string, unknown>) => { (r.fields as Record<string, unknown>[])[0].representation = "DECIMAL_NUMBER"; }],
  ])("rejects %s without reflecting supplied values", (_, mutate) => {
    const review = JSON.parse(JSON.stringify(confirmedReview())); mutate(review);
    expect(evaluateRunsPilotReview(review)).toEqual({ ok: false, activationAllowed: false, code: "INVALID_REVIEW" });
  });
  it("canonicalizes shuffled field order without mutating its input", () => {
    const review = confirmedReview(); review.fields.reverse(); const before = JSON.stringify(review);
    const result = evaluateRunsPilotReview(review);
    expect(JSON.stringify(review)).toBe(before);
    if (!result.ok) throw new Error("review invalid");
    expect(result.review.fields.map(f => f.columnId)).toEqual(RUNS_REVIEW_FIELDS.map(f => f.id));
  });
  it("records every unsupported source policy, including counts represented by Vehicles/Drivers", () => {
    const review = confirmedReview(); review.missingPolicy = "ADDITIONAL_MARKERS";
    review.fields[0].representation = "IDENTIFIER_NUMBER";
    review.fields[3].representation = "WHOLE_NUMBER"; review.fields[3].negativePolicy = "FORBID";
    review.fields[15].representation = "CLOCK_DURATION";
    review.fields[16].representation = "EXCEL_DAY_FRACTION"; review.fields[16].unit = "h";
    const result = evaluateRunsPilotReview(review);
    if (!result.ok) throw new Error("review invalid");
    expect(result.blockers).toEqual(expect.arrayContaining([
      { code: "MISSING_MARKERS_NEED_RULE" },
      { columnId: review.fields[0].columnId, code: "NUMERIC_IDENTIFIER_NEEDS_DECISION" },
      { columnId: review.fields[3].columnId, code: "NONNEGATIVE_COUNTS_NEED_RULE" },
      { columnId: review.fields[15].columnId, code: "CLOCK_DURATION_NEEDS_SUPPORT" },
      { columnId: review.fields[16].columnId, code: "SOURCE_REPRESENTATION_UNIT_MISMATCH" },
    ]));
  });
});

describe("Runs source-format compatibility — real parser and transformers, synthetic inputs", () => {
  const rules = syntheticProfile().columnRules;
  it("passes all 21 columns from a real XLSX at header row 3 through the pinned-plan transformer", async () => {
    const wb = XLSX.utils.book_new();
    const source = ["0007", new Date("2026-10-24T00:00:00.000Z"), "0002", "TRUCK-A, TRUCK-B", "Synthetic service", "Synthetic driver",
      0, 5, null, 1, 0, 12.5, 8.25, 10, 2.5, 1.5, 2.25, 4, 10.5, 20, 30.5];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Synthetic acceptance"], [], RUNS_REVIEW_FIELDS.map(f => f.header), source]), "Runs");
    const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const decoded = await readWorksheetDataRows(new Uint8Array(bytes), { filename: "synthetic-runs.xlsx" }, {
      index: 0, headerRowOneBased: 3, maxRowsToRead: 10, governedColumns: RUNS_REVIEW_FIELDS.map(f => ({
        id: f.id, ordinal: f.ordinal, sourceHeader: f.header, sensitivityClass: f.sensitivity })) });
    expect(decoded.rows).toHaveLength(1); expect(decoded.rows[0].sourceRowOneBased).toBe(4);
    const plan = buildNormalizationPlan(syntheticProfile(), RUNS_REVIEW_FIELDS.map(f => f.id));
    if (!plan.ok) throw new Error("synthetic plan invalid");
    const transformed = transformRow({ rawRowId: "synthetic-row", sourceRowNumber: 4 }, decoded.rows[0].cells.map(c => ({
      sourceSchemaColumnId: c.id, cell: { rawValue: c.value, rawValueType: c.value === null ? "NULL" :
        typeof c.value === "number" ? "NUMBER" : typeof c.value === "boolean" ? "BOOLEAN" : "STRING" } })), plan.plan);
    expect(transformed.findings).toEqual([]); expect(transformed.outputs).toHaveLength(21);
    expect(transformed.outputs.slice(0, 3).map(c => c.normalizedValue)).toEqual(["0007", "2026-10-24", "0002"]);
    expect(transformed.outputs.slice(6, 9).map(c => c.normalizedValue)).toEqual(["0", "5", null]);
  });
  it.each(["d", "t/h", "kg/h", "bins/h"])("proves the current profile vocabulary rejects %s", unit => {
    const rule = { sourceSchemaColumnId: "synthetic-column", valueKind: unit === "d" ? "DURATION" : "DECIMAL", sourceUnit: unit, normalizedUnit: unit };
    expect(parseProfileDocument({ documentVersion: 2, schemaStatus: "ACTIVE", headerRowOneBased: 3, columnRules: [rule] }).ok).toBe(false);
  });
  it("does not silently turn clock text, unknown markers, decimal counts or numeric IDs into valid values", () => {
    for (const [rule, cell] of [[rules[15], S("01:30:00")], [rules[6], S("N/A")], [rules[6], S("")], [rules[6], N(1.5)], [rules[0], N(7)]] as const) {
      const result = transformValue(rule, cell); expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(cell.rawValue === "" ? '"rawValue"' : String(cell.rawValue));
    }
  });
  it("preserves zero/null distinctly, accepts negative counts, and does not multiply a day fraction by 24", () => {
    expect(transformValue(rules[6], N(0))).toMatchObject({ ok: true, output: { normalizedValue: "0" } });
    expect(transformValue(rules[6], NULL)).toMatchObject({ ok: true, output: { normalizedValue: null } });
    expect(transformValue(rules[6], N(-1))).toMatchObject({ ok: true, output: { normalizedValue: "-1" } });
    expect(transformValue(rules[15], N(0.5))).toMatchObject({ ok: true, output: { normalizedValue: "0.5", normalizedUnit: "h" } });
  });
  it("rejects an impossible date and any datetime outside the exact Excel UTC-midnight date shape", () => {
    expect(transformValue(rules[1], S("2026-02-30"))).toMatchObject({ ok: false });
    expect(transformValue(rules[1], S("2026-10-24T01:00:00.000Z"))).toMatchObject({ ok: false });
    expect(transformValue(rules[1], N(46319))).toMatchObject({ ok: false });
  });
  it("rejects a profile that omits even one of the 21 governed columns", () => {
    const doc = syntheticProfile(); doc.columnRules.pop();
    expect(buildNormalizationPlan(doc, RUNS_REVIEW_FIELDS.map(f => f.id))).toMatchObject({ ok: false,
      findings: [{ code: "MISSING_GOVERNED_RULE", sourceSchemaColumnId: RUNS_REVIEW_FIELDS[20].id }] });
  });
});
