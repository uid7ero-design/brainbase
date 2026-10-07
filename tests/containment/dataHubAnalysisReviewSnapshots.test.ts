import { describe, expect, it } from "vitest";
import { profileDataset } from "@/lib/data-hub/profiling/profileDataset";
import { buildAnalysisReviewSnapshots, analyzeProfileCount, type AnalysisDatasetContext } from "@/lib/data-hub/analysis";
import type { SemanticClarificationChoice } from "@/lib/data-hub/semanticInference/resolution";
import type { DataQualityReviewDecisionInput } from "@/lib/data-hub/dataQuality/reviewResolution";

function fixture(valueKind: "DECIMAL" | "BOOLEAN" = "DECIMAL", values: (string | boolean | null)[] = ["10", "20"]) {
  const profiled = profileDataset({ rowCount: values.length, columns: [{ sourceSchemaColumnId: "amount", valueKind,
    sourceUnit: null, normalizedUnit: null,
    cells: values.map((normalizedValue, index) => ({ sourceRowNumber: index + 1, normalizedValue })) }] });
  if (!profiled.ok) throw new Error("invalid fixture");
  const context: AnalysisDatasetContext = { organisationId: "org", uploadId: "upload", importBatchId: "batch",
    normalizationRunId: "norm", datasetProfileRunId: "profile", sourceSchemaVersionId: "schema",
    sourceSchemaWorksheetId: "worksheet", worksheetMappingProfileVersionId: "mapping" };
  return { context, profile: { context: { ...context }, snapshot: profiled.profile },
    choices: { context: { ...context }, snapshot: [] as SemanticClarificationChoice[] },
    decisions: { context: { ...context }, snapshot: [] as DataQualityReviewDecisionInput[] } };
}
function build(f: ReturnType<typeof fixture>) {
  return buildAnalysisReviewSnapshots(f.context, f.profile, f.choices, f.decisions);
}

describe("D4D5O derived analysis review snapshots", () => {
  it("requires an explicit choice for an ambiguous measure", () => {
    expect(build(fixture())).toEqual({ ok: false, code: "CHOICE_REQUIRED", sourceSchemaColumnId: "amount" });
  });
  it("derives compatible snapshots and feeds the real count evaluator", () => {
    const f = fixture(); f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "MEASURE" });
    const result = build(f);
    expect(result).toMatchObject({ ok: true, schema: { snapshot: { fields: [{ semanticRole: "MEASURE",
      resolutionSource: "CLARIFIED_CHOICE" }] } }, quality: { snapshot: { state: "READY", items: [] } } });
    if (!result.ok) throw new Error(result.code);
    expect(analyzeProfileCount(f.context, result.schema, result.quality, f.profile,
      { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: "amount", operator: "COUNT_PRESENT" }))
      .toMatchObject({ ok: true, result: { count: 2 } });
  });
  it("automatically resolves one high-confidence role without inventing decisions", () => {
    const f = fixture("BOOLEAN", [true, false]);
    expect(build(f)).toMatchObject({ ok: true, schema: { snapshot: { fields: [{ semanticRole: "BOOLEAN_FLAG",
      resolutionSource: "AUTO_HIGH_CONFIDENCE" }] } }, quality: { snapshot: { state: "READY" } } });
  });
  it("requires acknowledgement of actual generated notices", () => {
    // Use a real constant profile rather than manually supplying a review plan.
    const constant = fixture("DECIMAL", ["10", "10"]);
    constant.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "MEASURE" });
    expect(build(constant)).toEqual({ ok: false, code: "DECISION_REQUIRED",
      item: { code: "COLUMN_CONSTANT", scope: "COLUMN", sourceSchemaColumnId: "amount" } });
    constant.decisions.snapshot.push({ code: "COLUMN_CONSTANT", scope: "COLUMN",
      sourceSchemaColumnId: "amount", decision: "ACKNOWLEDGE" });
    expect(build(constant)).toMatchObject({ ok: true, quality: { snapshot: { state: "READY_WITH_ACKNOWLEDGED_NOTICES" } } });
  });
  it.each(["CONTINUE", "HOLD"] as const)("preserves the explicit empty-dataset review decision %s", (decision) => {
    const f = fixture("DECIMAL", []); f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "MEASURE" });
    f.decisions.snapshot.push({ code: "EMPTY_DATASET", scope: "DATASET", decision });
    const result = build(f);
    expect(result).toMatchObject({ ok: true, quality: { snapshot: {
      state: decision === "HOLD" ? "HOLD_FOR_REMEDIATION" : "READY" } } });
    if (!result.ok) throw new Error(result.code);
    expect(analyzeProfileCount(f.context, result.schema, result.quality, f.profile,
      { requestVersion: "v1", kind: "ROW_COUNT" })).toMatchObject(decision === "HOLD"
      ? { ok: false, code: "QUALITY_HOLD" } : { ok: true, result: { count: 0 } });
  });
  it("rejects an invented semantic role", () => {
    const f = fixture(); f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "IDENTIFIER" });
    expect(build(f)).toMatchObject({ ok: false, code: "ROLE_NOT_CANDIDATE" });
  });
  it("rejects invented review items", () => {
    const f = fixture(); f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "MEASURE" });
    f.decisions.snapshot.push({ code: "EMPTY_DATASET", scope: "DATASET", decision: "CONTINUE" });
    expect(build(f)).toMatchObject({ ok: false, code: "UNKNOWN_REVIEW_ITEM" });
  });
  it.each(["profile", "choices", "decisions"] as const)("rejects stale %s context before interpreting decisions", (key) => {
    const f = fixture(); f[key].context.datasetProfileRunId = "old-profile";
    expect(build(f)).toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
  });
  it("rejects invalid context", () => {
    const f = fixture(); f.context.uploadId = " ";
    expect(build(f)).toEqual({ ok: false, code: "DATASET_CONTEXT_INVALID" });
  });
  it("rejects inconsistent profile counts", () => {
    const f = fixture(); f.profile.snapshot.columns[0].nonNullCount = 99;
    expect(build(f)).toEqual({ ok: false, code: "PROFILE_EVIDENCE_INVALID" });
  });
  it("copies closed contexts, omits source statistics and does not mutate inputs", () => {
    const f = fixture(); f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "MEASURE" });
    Object.assign(f.context, { secret: "private metadata" });
    const before = JSON.stringify(f); const first = build(f);
    expect(first).toEqual(build(f)); expect(JSON.stringify(f)).toBe(before);
    expect(JSON.stringify(first)).not.toContain("private metadata");
    expect(JSON.stringify(first)).not.toContain("numericStats");
    if (!first.ok) throw new Error(first.code);
    first.schema.context.uploadId = "changed";
    expect(first.quality.context.uploadId).toBe("upload"); expect(f.context.uploadId).toBe("upload");
  });
});
