import { describe, expect, it } from "vitest";
import { buildReviewedProfileCountRequestCatalog, buildReviewedProfileCountSelection, parsePlanningCatalogResponse, parsePlanningSelectionResponse, parsePlanningCatalogJson, parsePlanningSelectionJson, type ReviewedPlanningSnapshot, type AnalysisDatasetContext, type PlanningSelectionExpectation } from "@/lib/data-hub/analysis";
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

const selection = { selectionVersion: "v1" as const, expectedReviewRevision: 3, includeRowCount: true, measureColumnIds: ["amount"] };
const catalogExpected = () => ({ context: context(), reviewRevision: 3 });
const planExpected = (): PlanningSelectionExpectation => ({ context: context(), readinessState: "READY", selection: structuredClone(selection) });
function catalog() {
  const built = buildReviewedProfileCountRequestCatalog(context(), review());
  if (!built.ok) throw new Error(built.code);
  return JSON.parse(JSON.stringify(built)) as typeof built;
}
function planned() {
  const built = buildReviewedProfileCountSelection(context(), review(), selection);
  if (!built.ok) throw new Error(built.code);
  return JSON.parse(JSON.stringify(built)) as typeof built;
}
const invalid = { ok: false, code: "PLANNING_RESPONSE_INVALID" };
const mismatch = { ok: false, code: "PLANNING_RESPONSE_MISMATCH" };

describe("closed planning exchange", () => {
  it("round-trips catalog and selected plans through JSON with detached nested output", () => {
    const sourceCatalog = catalog(); const sourcePlan = planned();
    const decodedCatalog = parsePlanningCatalogJson(JSON.stringify(sourceCatalog), catalogExpected());
    const decodedPlan = parsePlanningSelectionJson(JSON.stringify(sourcePlan), planExpected());
    expect(decodedCatalog).toEqual({ ok: true, response: sourceCatalog });
    expect(decodedPlan).toEqual({ ok: true, response: sourcePlan });
    const direct = parsePlanningSelectionResponse(sourcePlan, planExpected());
    if (!direct.ok || !direct.response.ok) throw new Error("decode failed");
    sourcePlan.plans[0].context.uploadId = "changed";
    sourcePlan.plans[1].snapshot.operation = "ROW_COUNT";
    expect(direct.response.plans[0].context).toEqual(context());
    expect(direct.response.plans[1].snapshot.operation).toBe("COUNT_PRESENT");
    direct.response.plans[0].context.uploadId = "one-plan-only";
    expect(direct.response.plans[1].context).toEqual(context());
  });
  it("preserves the full discovery inventory beyond the submitted-bundle bound", () => {
    const metadata = review(); const field = metadata.schema.snapshot.fields[0];
    metadata.schema.snapshot.fields = Array.from({ length: 21 }, (_, i) => ({ ...field, sourceSchemaColumnId: `measure-${i}` }));
    const built = buildReviewedProfileCountRequestCatalog(context(), metadata);
    const result = parsePlanningCatalogResponse(built, catalogExpected());
    if (!result.ok || !result.response.ok) throw new Error("decode failed");
    expect(result.response.catalog.requests).toHaveLength(22);
  });
  it("does not turn a structurally decoded invented template into a governed capability", () => {
    const source = catalog(); Object.assign(source.catalog.requests[1], { sourceSchemaColumnId: "invented" });
    const decoded = parsePlanningCatalogResponse(source, catalogExpected());
    if (!decoded.ok || !decoded.response.ok) throw new Error("decode failed");
    const ids = decoded.response.catalog.requests.flatMap(request => "sourceSchemaColumnId" in request ? [request.sourceSchemaColumnId] : []);
    expect(buildReviewedProfileCountSelection(context(), review(), { ...selection, measureColumnIds: ids }))
      .toEqual({ ok: false, code: "CAPABILITY_NOT_AVAILABLE", requestIndex: 1 });
  });
  it.each([true, false])("round-trips maximum selected-plan size with includeRowCount=%s", includeRowCount => {
    const metadata = review(); const field = metadata.schema.snapshot.fields[0];
    const ids = Array.from({ length: includeRowCount ? 19 : 20 }, (_, i) => `measure-${i}`);
    metadata.schema.snapshot.fields = ids.map(sourceSchemaColumnId => ({ ...field, sourceSchemaColumnId }));
    const selected = { ...selection, includeRowCount, measureColumnIds: ids };
    const built = buildReviewedProfileCountSelection(context(), metadata, selected);
    expect(parsePlanningSelectionJson(JSON.stringify(built), { ...planExpected(), selection: selected }))
      .toEqual({ ok: true, response: built });
  });
  it.each(Object.keys(context()) as (keyof AnalysisDatasetContext)[])("rejects valid but mismatched %s in both response kinds", key => {
    const discovered = catalog(); discovered.catalog.context[key] = "other";
    expect(parsePlanningCatalogResponse(discovered, catalogExpected())).toEqual(mismatch);
    const source = planned(); source.plans[1].context[key] = "other";
    expect(parsePlanningSelectionResponse(source, planExpected())).toEqual(mismatch);
  });
  it.each([2, 4])("rejects either older or newer revision %s rather than relabeling it", revision => {
    const discovered = catalog(); discovered.catalog.reviewRevision = revision;
    expect(parsePlanningCatalogResponse(discovered, catalogExpected())).toEqual(mismatch);
    const source = planned(); source.reviewRevision = revision;
    expect(parsePlanningSelectionResponse(source, planExpected())).toEqual(mismatch);
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects unsafe revision %s", revision => {
    const discovered = catalog(); discovered.catalog.reviewRevision = revision;
    expect(parsePlanningCatalogResponse(discovered, catalogExpected())).toEqual(invalid);
    const source = planned(); source.reviewRevision = revision;
    expect(parsePlanningSelectionResponse(source, planExpected())).toEqual(invalid);
  });
  it.each([null, [], {}, 1, "private-diagnostic", { ok: true }, { ok: false, code: "UNKNOWN_CODE" },
    { ok: false, code: "QUALITY_HOLD", message: "private-diagnostic" },
    { ok: false, code: "QUALITY_HOLD", plans: [] }])("rejects malformed outer response %#", input => {
    expect(parsePlanningCatalogResponse(input, catalogExpected())).toEqual(invalid);
    expect(parsePlanningSelectionResponse(input, planExpected())).toEqual(invalid);
  });
  it.each([null, [], "", "{private diagnostic", "null", "[]", "{\"ok\":true}", "<html>private diagnostic</html>"])
    ("maps malformed JSON/envelopes to a fixed reference %#", input => {
      expect(parsePlanningCatalogJson(input, catalogExpected())).toEqual(invalid);
      expect(parsePlanningSelectionJson(input, planExpected())).toEqual(invalid);
    });
  it.each(["version", "state", "revision", "context", "generic", "group", "duplicate", "row-position", "extra"])
    ("rejects invalid catalog contract %s", kind => {
      const source = catalog();
      if (kind === "version") Object.assign(source.catalog, { catalogVersion: "v2" });
      if (kind === "state") Object.assign(source.catalog, { readinessState: "UNKNOWN" });
      if (kind === "revision") source.catalog.reviewRevision = 0;
      if (kind === "context") Object.assign(source.catalog.context, { rawValue: "private" });
      if (kind === "generic") Object.assign(source.catalog.requests[1], { operator: undefined });
      if (kind === "group") Object.assign(source.catalog.requests[1], { kind: "GROUP_BY" });
      if (kind === "duplicate") source.catalog.requests = [...source.catalog.requests, source.catalog.requests[1]];
      if (kind === "row-position") source.catalog.requests = [...source.catalog.requests].reverse();
      if (kind === "extra") Object.assign(source.catalog, { labels: ["private"] });
      expect(parsePlanningCatalogResponse(source, catalogExpected())).toEqual(invalid);
    });
  it.each(["version", "planVersion", "schemaVersion", "profilerVersion", "readinessVersion", "qualityResolutionVersion", "state", "revision", "count", "policy", "context", "empty", "oversized", "group"])
    ("rejects invalid selected-plan contract %s", kind => {
      const source = planned();
      if (kind === "version") Object.assign(source, { bundleVersion: "v2" });
      if (["planVersion", "schemaVersion", "profilerVersion", "readinessVersion", "qualityResolutionVersion"].includes(kind)) Object.assign(source.plans[0].snapshot, { [kind]: "v2" });
      if (kind === "state") Object.assign(source.plans[0].snapshot, { readinessState: "UNKNOWN" });
      if (kind === "revision") source.reviewRevision = 0;
      if (kind === "count") Object.assign(source.plans[0].snapshot, { count: 999 });
      if (kind === "policy") Object.assign(source.plans[1].snapshot, { missingValuePolicy: "INCLUDE_MISSING" });
      if (kind === "context") Object.assign(source.plans[0].context, { rawValue: "private" });
      if (kind === "empty") source.plans = [];
      if (kind === "oversized") source.plans = Array(21).fill(source.plans[0]);
      if (kind === "group") Object.assign(source.plans[1].snapshot, { operation: "GROUPED_ROW_COUNT", missingValuePolicy: "SEPARATE_GROUP" });
      expect(parsePlanningSelectionResponse(source, planExpected())).toEqual(invalid);
    });
  it.each(["order", "field", "length", "state"])("rejects structurally valid response with mismatched %s", kind => {
    const source = planned();
    if (kind === "order") source.plans.reverse();
    if (kind === "field") Object.assign(source.plans[1].snapshot, { sourceSchemaColumnId: "other" });
    if (kind === "length") source.plans.pop();
    if (kind === "state") source.plans[1].snapshot.readinessState = "READY_WITH_ACKNOWLEDGED_NOTICES";
    expect(parsePlanningSelectionResponse(source, planExpected())).toEqual(mismatch);
  });
  it("admits closed known denials as denials and validates indexed failures", () => {
    expect(parsePlanningCatalogResponse({ ok: false, code: "QUALITY_HOLD" }, catalogExpected()))
      .toEqual({ ok: true, response: { ok: false, code: "QUALITY_HOLD" } });
    expect(parsePlanningSelectionResponse({ ok: false, code: "CAPABILITY_NOT_AVAILABLE", requestIndex: 1 }, planExpected()))
      .toEqual({ ok: true, response: { ok: false, code: "CAPABILITY_NOT_AVAILABLE", requestIndex: 1 } });
    for (const requestIndex of [-1, 2, 1.5, NaN, Infinity])
      expect(parsePlanningSelectionResponse({ ok: false, code: "QUALITY_HOLD", requestIndex }, planExpected())).toEqual(invalid);
    expect(parsePlanningSelectionResponse({ ok: false, code: "REVIEW_REVISION_MISMATCH", requestIndex: 0 }, planExpected())).toEqual(invalid);
    expect(parsePlanningCatalogResponse({ ok: false, code: "QUALITY_HOLD", requestIndex: 0 }, catalogExpected())).toEqual(invalid);
  });
  it.each(["UNAUTHORIZED", "FORBIDDEN", "REVIEW_NOT_FOUND", "REVIEW_READ_FAILED", "PROFILE_EVIDENCE_INVALID"])
    ("preserves closed loading denial %s without accepting an indexed form", code => {
      const denied = { ok: false, code };
      expect(parsePlanningCatalogResponse(denied, catalogExpected())).toEqual({ ok: true, response: denied });
      expect(parsePlanningSelectionResponse(denied, planExpected())).toEqual({ ok: true, response: denied });
      expect(parsePlanningSelectionResponse({ ...denied, requestIndex: 0 }, planExpected())).toEqual(invalid);
    });
  it("rejects invalid expectations before accepting any response", () => {
    expect(parsePlanningCatalogResponse(catalog(), { ...catalogExpected(), reviewRevision: 0 })).toEqual(invalid);
    const expected = planExpected(); expected.selection.measureColumnIds = ["amount", "amount"];
    expect(parsePlanningSelectionResponse(planned(), expected)).toEqual(invalid);
    expect(parsePlanningSelectionResponse(planned(), { ...planExpected(), readinessState: "UNKNOWN" } as unknown as PlanningSelectionExpectation)).toEqual(invalid);
  });
  it("copies catalogs and ignores custom list iterators without retaining mutable records", () => {
    const source = catalog();
    source.catalog.requests[Symbol.iterator] = () => { throw new Error("must not invoke iterator"); };
    const result = parsePlanningCatalogResponse(source, catalogExpected());
    if (!result.ok || !result.response.ok) throw new Error("decode failed");
    source.catalog.context.uploadId = "changed";
    Object.assign(source.catalog.requests[1], { sourceSchemaColumnId: "changed" });
    expect(result.response.catalog.context).toEqual(context());
    expect(result.response.catalog.requests[1]).toMatchObject({ sourceSchemaColumnId: "amount" });
  });
  it("rejects getters, inherited/hidden/symbol metadata and sparse arrays without executing accessors", () => {
    const source = planned();
    Object.defineProperty(source.plans[0].snapshot, "planVersion", { get() { throw new Error("getter must not run"); } });
    expect(parsePlanningSelectionResponse(source, planExpected())).toEqual(invalid);
    for (const key of ["hidden", Symbol("private"), "ok"]) {
      const entry = catalog(); Object.defineProperty(entry, key, { value: true, enumerable: false });
      expect(parsePlanningCatalogResponse(entry, catalogExpected())).toEqual(invalid);
    }
    expect(parsePlanningCatalogResponse(Object.create(catalog()), catalogExpected())).toEqual(invalid);
    const sparse = planned(); delete sparse.plans[1];
    expect(parsePlanningSelectionResponse(sparse, planExpected())).toEqual(invalid);
    const accessor = catalog(); Object.defineProperty(accessor.catalog.requests, 0, { get() { throw new Error("must not run"); } });
    expect(parsePlanningCatalogResponse(accessor, catalogExpected())).toEqual(invalid);
  });
  it("accepts acknowledged-notice metadata consistently and matches supplied expectations", () => {
    const metadata = review(); metadata.quality.snapshot.state = "READY_WITH_ACKNOWLEDGED_NOTICES";
    const built = buildReviewedProfileCountSelection(context(), metadata, selection);
    const expected = planExpected(); expected.readinessState = "READY_WITH_ACKNOWLEDGED_NOTICES";
    expect(parsePlanningSelectionResponse(built, expected)).toEqual({ ok: true, response: built });
    expect(parsePlanningSelectionResponse(built, planExpected())).toEqual(mismatch);
  });
});
