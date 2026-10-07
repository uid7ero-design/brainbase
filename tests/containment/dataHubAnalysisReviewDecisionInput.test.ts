import { describe, expect, it } from "vitest";
import { parseAnalysisReviewDecisionInput, buildAnalysisReviewSnapshots } from "@/lib/data-hub/analysis";
import { SEMANTIC_ROLES } from "@/lib/data-hub/semanticInference/contracts";
import { DATA_QUALITY_OBSERVATION_CODES } from "@/lib/data-hub/dataQuality/contracts";
import { profileDataset } from "@/lib/data-hub/profiling/profileDataset";

function input() {
  return { reviewVersion: "v1", datasetProfileRunId: "profile", semanticChoices: [{ sourceSchemaColumnId: "amount", role: "MEASURE" }],
    qualityDecisions: [] as unknown[] };
}
const invalid = { ok: false, code: "REVIEW_INPUT_INVALID" };
describe("D4D5R closed review decision input", () => {
  it("copies valid decisions without normalizing identity or mutating input", () => {
    const value = input(); value.datasetProfileRunId = " profile "; value.semanticChoices[0].sourceSchemaColumnId = " amount ";
    value.qualityDecisions.push({ code: "EMPTY_DATASET", scope: "DATASET", decision: "HOLD" });
    const before = JSON.stringify(value), result = parseAnalysisReviewDecisionInput(value);
    expect(result).toEqual({ ok: true, input: value }); expect(JSON.stringify(value)).toBe(before);
    expect(result).toEqual(parseAnalysisReviewDecisionInput(value));
    if (!result.ok) throw new Error(result.code);
    result.input.semanticChoices[0].role = "TEXT"; result.input.qualityDecisions[0].decision = "CONTINUE";
    expect(value.semanticChoices[0].role).toBe("MEASURE");
    expect(value.qualityDecisions[0]).toMatchObject({ decision: "HOLD" });
  });
  it("allows empty decisions for server recomputation, without asserting readiness", () => {
    const value = input(); value.semanticChoices = [];
    expect(parseAnalysisReviewDecisionInput(value)).toEqual({ ok: true, input: value });
  });
  it.each([null, [], "request", 1, {}])("rejects malformed top-level input %#", (value) => {
    expect(parseAnalysisReviewDecisionInput(value)).toEqual(invalid);
  });
  it.each(["organisationId", "uploadId", "reviewedById", "revision", "reviewedAt", "state", "schema", "profile", "query"])(
    "rejects caller-provided %s", (key) => {
      expect(parseAnalysisReviewDecisionInput({ ...input(), [key]: "injected" })).toEqual(invalid);
    });
  it.each(["version", "pin", "choices", "decisions"])("rejects invalid %s", (kind) => {
    const value = input();
    if (kind === "version") value.reviewVersion = "v2";
    if (kind === "pin") value.datasetProfileRunId = " ";
    expect(parseAnalysisReviewDecisionInput(kind === "choices" ? { ...value, semanticChoices: {} }
      : kind === "decisions" ? { ...value, qualityDecisions: null } : value)).toEqual(invalid);
  });
  it.each(SEMANTIC_ROLES)("accepts the closed semantic role %s", (role) => {
    const value = input(); value.semanticChoices[0].role = role;
    expect(parseAnalysisReviewDecisionInput(value)).toEqual({ ok: true, input: value });
  });
  it.each(["unknownRole", "blankColumn", "extra", "duplicate"])("rejects invalid semantic choice: %s", (kind) => {
    const value = input();
    if (kind === "unknownRole") value.semanticChoices[0].role = "SQL";
    if (kind === "blankColumn") value.semanticChoices[0].sourceSchemaColumnId = " ";
    if (kind === "extra") Object.assign(value.semanticChoices[0], { confidence: "HIGH" });
    if (kind === "duplicate") value.semanticChoices.push({ ...value.semanticChoices[0] });
    expect(parseAnalysisReviewDecisionInput(value)).toEqual(invalid);
  });
  it.each(DATA_QUALITY_OBSERVATION_CODES)("accepts correctly scoped decisions for %s", (code) => {
    const value = input(), dataset = ["EMPTY_DATASET", "NO_COLUMNS", "MULTIPLE_RECORD_KEY_CANDIDATES"].includes(code);
    const notice = code === "COLUMN_PARTIALLY_NULL" || code === "COLUMN_CONSTANT";
    value.qualityDecisions = [{ code, scope: dataset ? "DATASET" : "COLUMN",
      ...(dataset ? {} : { sourceSchemaColumnId: "amount" }), decision: notice ? "ACKNOWLEDGE" : "HOLD" }];
    expect(parseAnalysisReviewDecisionInput(value)).toEqual({ ok: true, input: value });
  });
  it.each(["code", "scope", "missingColumn", "noticeDecision", "extra", "duplicate"])("rejects invalid quality decision: %s", (kind) => {
    const value = input(), item = { code: "COLUMN_CONSTANT", scope: "COLUMN", sourceSchemaColumnId: "amount", decision: "ACKNOWLEDGE" };
    if (kind === "code") item.code = "INVENTED";
    if (kind === "scope") item.scope = "DATASET";
    if (kind === "noticeDecision") item.decision = "CONTINUE";
    if (kind === "extra") Object.assign(item, { state: "READY" });
    value.qualityDecisions = kind === "missingColumn" ? [{ code: item.code, scope: item.scope, decision: item.decision }]
      : kind === "duplicate" ? [item, item] : [item];
    expect(parseAnalysisReviewDecisionInput(value)).toEqual(invalid);
  });
  it("rejects acknowledgement in place of a required dataset review", () => {
    expect(parseAnalysisReviewDecisionInput({ ...input(), qualityDecisions: [{ code: "EMPTY_DATASET", scope: "DATASET",
      decision: "ACKNOWLEDGE" }] })).toEqual(invalid);
  });
  it("rejects accessor fields without invoking their getters", () => {
    let calls = 0; const value = input();
    Object.defineProperty(value, "datasetProfileRunId", { enumerable: true, get: () => { calls++; return "profile"; } });
    expect(parseAnalysisReviewDecisionInput(value)).toEqual(invalid); expect(calls).toBe(0);
  });
  it("rejects inherited, symbolic and non-enumerable extensions", () => {
    const inherited = Object.assign(Object.create({ state: "READY" }), input());
    const symbol = input(); Object.assign(symbol, { [Symbol("state")]: "READY" });
    const hidden = input(); Object.defineProperty(hidden, "state", { value: "READY" });
    for (const value of [inherited, symbol, hidden]) expect(parseAnalysisReviewDecisionInput(value)).toEqual(invalid);
  });
  it("rejects sparse, accessor and extended decision arrays", () => {
    const sparse = new Array(1), getter: unknown[] = [null], extended: unknown[] = [];
    Object.defineProperty(getter, "0", { enumerable: true, get: () => { throw new Error("must not run"); } });
    Object.assign(extended, { state: "READY" });
    for (const qualityDecisions of [sparse, getter, extended]) {
      expect(parseAnalysisReviewDecisionInput({ ...input(), qualityDecisions })).toEqual(invalid);
    }
  });
  it("closes unexpected object inspection errors", () => {
    const value = new Proxy(input(), { getPrototypeOf: () => { throw new Error("private details"); } });
    expect(parseAnalysisReviewDecisionInput(value)).toEqual(invalid);
  });
  it("leaves candidate membership and required review completeness to real recomputation", () => {
    const profiled = profileDataset({ rowCount: 2, columns: [{ sourceSchemaColumnId: "amount", valueKind: "DECIMAL",
      sourceUnit: null, normalizedUnit: null, cells: [{ sourceRowNumber: 1, normalizedValue: "10" },
        { sourceRowNumber: 2, normalizedValue: "20" }] }] });
    if (!profiled.ok) throw new Error(profiled.code);
    const context = { organisationId: "org", uploadId: "upload", importBatchId: "batch", normalizationRunId: "norm",
      datasetProfileRunId: "profile", sourceSchemaVersionId: "schema", sourceSchemaWorksheetId: "worksheet",
      worksheetMappingProfileVersionId: "mapping" };
    const value = input(); value.semanticChoices[0].role = "IDENTIFIER";
    const parsed = parseAnalysisReviewDecisionInput(value); if (!parsed.ok) throw new Error(parsed.code);
    expect(buildAnalysisReviewSnapshots(context, { context, snapshot: profiled.profile },
      { context, snapshot: parsed.input.semanticChoices }, { context, snapshot: parsed.input.qualityDecisions }))
      .toMatchObject({ ok: false, code: "ROLE_NOT_CANDIDATE" });
  });
});
