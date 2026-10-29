import { describe, expect, it } from "vitest";
import { parseProfileCountSelectionInput, buildReviewedProfileCountSelection, type ReviewedPlanningSnapshot, type AnalysisDatasetContext } from "@/lib/data-hub/analysis";

function context(): AnalysisDatasetContext {
  return { organisationId: "org", uploadId: "upload", importBatchId: "batch",
    normalizationRunId: "normalization", datasetProfileRunId: "profile", sourceSchemaVersionId: "schema",
    sourceSchemaWorksheetId: "worksheet", worksheetMappingProfileVersionId: "mapping" };
}
function review(): ReviewedPlanningSnapshot {
  return { revision: 3, schema: { context: context(), snapshot: {
    schemaVersion: "v1", resolutionVersion: "v1", inferenceVersion: "v1", profilerVersion: "v1",
    recordKeyCandidateState: "NONE", fields: [{ sourceSchemaColumnId: "amount", semanticRole: "MEASURE",
      fieldClass: "MEASURE", recordKeyCandidate: false, confidence: "HIGH", evidence: [], resolutionSource: "CLARIFIED_CHOICE" }] } },
    quality: { context: context(), snapshot: { resolutionVersion: "v1", reviewVersion: "v1",
      qualityVersion: "v1", profilerVersion: "v1", schemaVersion: "v1", state: "READY",
      itemCount: 0, acknowledgedNoticeCount: 0, continuedReviewCount: 0, heldReviewCount: 0, items: [] } } };
}

const selection = (measureColumnIds: unknown[] = ["amount"], includeRowCount = true) =>
  ({ selectionVersion: "v1", expectedReviewRevision: 3, includeRowCount, measureColumnIds });
describe("closed profile-count selection workflow", () => {
  it.each([selection([], true), selection(["amount"], false), selection()])("admits nonempty selection shapes %#", input => {
    expect(parseProfileCountSelectionInput(input)).toEqual({ ok: true, selection: input });
    expect(buildReviewedProfileCountSelection(context(), review(), input)).toMatchObject({ ok: true });
  });
  it("copies scalar identities and retains order without normalization", () => {
    const input = selection(["second", " first "]); const result = parseProfileCountSelectionInput(input);
    input.measureColumnIds.reverse(); input.measureColumnIds.push("other"); input.includeRowCount = false;
    expect(result).toEqual({ ok: true, selection: selection(["second", " first "]) });
    if (!result.ok) throw new Error(result.code);
    expect(result.selection.measureColumnIds).not.toBe(input.measureColumnIds);
  });
  it.each([true, false])("admits exactly 20 requests with row count included=%s", includeRowCount => {
    const ids = Array.from({ length: includeRowCount ? 19 : 20 }, (_, i) => `measure-${i}`);
    expect(parseProfileCountSelectionInput(selection(ids, includeRowCount)).ok).toBe(true);
    expect(parseProfileCountSelectionInput(selection([...ids, "extra"], includeRowCount)))
      .toEqual({ ok: false, code: "PROFILE_SELECTION_INVALID" });
  });
  it.each([null, [], {}, Object.create(selection()), { ...selection(), selectionVersion: "v2" },
    { ...selection(), extra: true }, { ...selection(), expectedReviewRevision: 0 },
    { ...selection(), expectedReviewRevision: 1.5 }, { ...selection(), expectedReviewRevision: Infinity },
    { ...selection(), expectedReviewRevision: "3" }, { ...selection(), includeRowCount: "true" },
    { ...selection(), measureColumnIds: "amount" }, selection([], false), selection(["amount", "amount"]),
    selection([" "]), selection([1]), selection(new Array(2))])("rejects malformed selection %#", input => {
    expect(parseProfileCountSelectionInput(input)).toEqual({ ok: false, code: "PROFILE_SELECTION_INVALID" });
  });
  it.each(["selectionVersion", "expectedReviewRevision", "includeRowCount", "measureColumnIds"])
    ("rejects %s getters without invoking them", key => {
      const input = selection(); Object.defineProperty(input, key, { get() { throw new Error("getter must not run"); } });
      expect(parseProfileCountSelectionInput(input)).toEqual({ ok: false, code: "PROFILE_SELECTION_INVALID" });
    });
  it("rejects symbol/hidden metadata and accessor or inherited list entries", () => {
    const symbol = selection(); Object.defineProperty(symbol, Symbol("extra"), { value: true });
    const hidden = selection(); Object.defineProperty(hidden, "hidden", { value: true });
    const accessor = selection(); Object.defineProperty(accessor.measureColumnIds, 0, { get() { throw new Error("must not run"); } });
    const inherited = selection(new Array(1)); Object.setPrototypeOf(inherited.measureColumnIds, { 0: "amount" });
    for (const input of [symbol, hidden, accessor, inherited])
      expect(parseProfileCountSelectionInput(input)).toEqual({ ok: false, code: "PROFILE_SELECTION_INVALID" });
  });
  it("copies indices without using a custom iterator", () => {
    const input = selection(); input.measureColumnIds[Symbol.iterator] = () => { throw new Error("must not run"); };
    expect(parseProfileCountSelectionInput(input)).toEqual({ ok: true, selection: selection() });
  });
  it("plans row count first and selected measures in selection order", () => {
    const metadata = review(); metadata.schema.snapshot.fields.push({ ...metadata.schema.snapshot.fields[0], sourceSchemaColumnId: "second" });
    const input = selection(["second", "amount"]); const before = structuredClone({ metadata, input });
    const result = buildReviewedProfileCountSelection(context(), metadata, input);
    expect({ metadata, input }).toEqual(before);
    expect(result).toMatchObject({ ok: true, reviewRevision: 3, plans: [
      { snapshot: { operation: "ROW_COUNT" } }, { snapshot: { operation: "COUNT_PRESENT", sourceSchemaColumnId: "second" } },
      { snapshot: { operation: "COUNT_PRESENT", sourceSchemaColumnId: "amount" } },
    ] });
  });
  it("revalidates unavailable fields and rejects the entire selection", () => {
    expect(buildReviewedProfileCountSelection(context(), review(), selection(["amount", "missing"])))
      .toEqual({ ok: false, code: "CAPABILITY_NOT_AVAILABLE", requestIndex: 2 });
    expect(buildReviewedProfileCountSelection(context(), review(), selection(["missing"], false)))
      .toEqual({ ok: false, code: "CAPABILITY_NOT_AVAILABLE", requestIndex: 0 });
  });
  it.each([true, false])("plans the maximum admitted selection with includeRowCount=%s", includeRowCount => {
    const metadata = review(); const field = metadata.schema.snapshot.fields[0];
    const ids = Array.from({ length: includeRowCount ? 19 : 20 }, (_, i) => `measure-${i}`);
    metadata.schema.snapshot.fields = ids.map(sourceSchemaColumnId => ({ ...field, sourceSchemaColumnId }));
    const result = buildReviewedProfileCountSelection(context(), metadata, selection(ids, includeRowCount));
    if (!result.ok) throw new Error(result.code);
    expect(result.plans).toHaveLength(20);
    expect(result.plans[0].snapshot.operation).toBe(includeRowCount ? "ROW_COUNT" : "COUNT_PRESENT");
  });
  it("rejects scope before selection parsing and holds after valid selection admission", () => {
    const metadata = review(); metadata.quality.context.uploadId = "other";
    expect(buildReviewedProfileCountSelection(context(), metadata, null))
      .toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
    metadata.quality.context = context(); metadata.quality.snapshot.state = "HOLD_FOR_REMEDIATION";
    expect(buildReviewedProfileCountSelection(context(), metadata, selection(["missing"])))
      .toEqual({ ok: false, code: "QUALITY_HOLD", requestIndex: 0 });
  });
  it("captures selections before review preparation changes the caller list", () => {
    const metadata = review(); const schema = metadata.schema.snapshot; const input = selection();
    Object.defineProperty(metadata.schema, "snapshot", { get() {
      input.measureColumnIds[0] = "missing"; input.measureColumnIds.push(...Array(30).fill("other")); return schema;
    } });
    const result = buildReviewedProfileCountSelection(context(), metadata, input);
    expect(result).toMatchObject({ ok: true, plans: [{ snapshot: { operation: "ROW_COUNT" } },
      { snapshot: { sourceSchemaColumnId: "amount", missingValuePolicy: "EXCLUDE_MISSING" } }] });
    if (!result.ok) throw new Error(result.code);
    expect(result.plans).toHaveLength(2);
  });
  it("checks revision pins before reading snapshots", () => {
    const metadata = review(); Object.defineProperty(metadata.schema, "snapshot", { get() { throw new Error("must not read"); } });
    expect(buildReviewedProfileCountSelection(context(), metadata, { ...selection(), expectedReviewRevision: 4 }))
      .toEqual({ ok: false, code: "REVIEW_REVISION_MISMATCH" });
  });
  it("preserves holds and acknowledged notices", () => {
    const metadata = review(); metadata.quality.snapshot.state = "HOLD_FOR_REMEDIATION";
    expect(buildReviewedProfileCountSelection(context(), metadata, selection()))
      .toEqual({ ok: false, code: "QUALITY_HOLD", requestIndex: 0 });
    metadata.quality.snapshot.state = "READY_WITH_ACKNOWLEDGED_NOTICES";
    expect(buildReviewedProfileCountSelection(context(), metadata, selection())).toMatchObject({ ok: true,
      plans: [{ snapshot: { readinessState: "READY_WITH_ACKNOWLEDGED_NOTICES" } },
        { snapshot: { readinessState: "READY_WITH_ACKNOWLEDGED_NOTICES" } }] });
  });
});
