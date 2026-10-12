import { describe, expect, it } from "vitest";
import { profileDataset } from "@/lib/data-hub/profiling/profileDataset";
import { buildAnalysisReviewSnapshots, buildReviewedProfileCountBundle, buildReviewedProfileCountRequestCatalog, buildReviewedProfileCountSelection,
  parsePlanningCatalogJson, parsePlanningSelectionJson, type AnalysisDatasetContext } from "@/lib/data-hub/analysis";
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

const rows = { requestVersion: "v1", kind: "ROW_COUNT" };
const present = { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: "amount", operator: "COUNT_PRESENT" };
function plan(f: ReturnType<typeof fixture>, requests: unknown[] = [rows, present], expectedReviewRevision = 6) {
  const built = buildAnalysisReviewSnapshots(f.context, f.profile, f.choices, f.decisions);
  if (!built.ok) return built;
  // Synthetic trusted revision supplied by this test; no persistence claim.
  return buildReviewedProfileCountBundle(f.context, { revision: 6, schema: built.schema, quality: built.quality },
    { bundleVersion: "v1", expectedReviewRevision, requests });
}

describe("pure governed review-to-bundle acceptance", () => {
  it("round-trips actual reviewed discovery and selected plans through the closed exchange", () => {
    const f = fixture("DECIMAL", ["0", "5"]);
    f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "MEASURE" });
    const built = buildAnalysisReviewSnapshots(f.context, f.profile, f.choices, f.decisions);
    if (!built.ok) throw new Error(built.code);
    const review = { revision: 6, schema: built.schema, quality: built.quality };
    const discovered = buildReviewedProfileCountRequestCatalog(f.context, review);
    const admitted = parsePlanningCatalogJson(JSON.stringify(discovered), { context: f.context, reviewRevision: 6 });
    if (!admitted.ok || !admitted.response.ok) throw new Error("catalog exchange failed");
    const catalog = admitted.response.catalog;
    const selection = { selectionVersion: "v1" as const, expectedReviewRevision: catalog.reviewRevision,
      includeRowCount: true, measureColumnIds: catalog.requests.flatMap(request =>
        "sourceSchemaColumnId" in request ? [request.sourceSchemaColumnId] : []) };
    const planned = buildReviewedProfileCountSelection(f.context, review, selection);
    const decoded = parsePlanningSelectionJson(JSON.stringify(planned), {
      context: catalog.context, readinessState: catalog.readinessState, selection,
    });
    expect(decoded).toEqual({ ok: true, response: planned });
    if (!decoded.ok || !decoded.response.ok) throw new Error("plan exchange failed");
    expect(decoded.response.plans.every(plan => !("count" in plan.snapshot))).toBe(true);
    review.quality.snapshot.state = "HOLD_FOR_REMEDIATION";
    const held = buildReviewedProfileCountSelection(f.context, review, selection);
    expect(parsePlanningSelectionJson(JSON.stringify(held), {
      context: catalog.context, readinessState: catalog.readinessState, selection,
    })).toEqual({ ok: true, response: { ok: false, code: "QUALITY_HOLD", requestIndex: 0 } });
  });
  it("completes discovery, selected-intent planning and revision revalidation without evaluating counts", () => {
    const f = fixture("DECIMAL", ["0", "5"]);
    f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "MEASURE" });
    const built = buildAnalysisReviewSnapshots(f.context, f.profile, f.choices, f.decisions);
    if (!built.ok) throw new Error(built.code);
    const review = { revision: 6, schema: built.schema, quality: built.quality };
    const discovered = buildReviewedProfileCountRequestCatalog(f.context, review);
    if (!discovered.ok) throw new Error(discovered.code);
    const input = { selectionVersion: "v1", expectedReviewRevision: discovered.catalog.reviewRevision,
      includeRowCount: true, measureColumnIds: discovered.catalog.requests.flatMap(request =>
        "sourceSchemaColumnId" in request ? [request.sourceSchemaColumnId] : []) };
    const planned = buildReviewedProfileCountSelection(f.context, review, input);
    expect(planned).toMatchObject({ ok: true, reviewRevision: 6, plans: [
      { snapshot: { operation: "ROW_COUNT" } }, { snapshot: { operation: "COUNT_PRESENT", sourceSchemaColumnId: "amount" } },
    ] });
    if (!planned.ok) throw new Error(planned.code);
    expect(planned.plans.every(plan => !("count" in plan.snapshot))).toBe(true);
    review.revision = 7;
    expect(buildReviewedProfileCountSelection(f.context, review, input))
      .toEqual({ ok: false, code: "REVIEW_REVISION_MISMATCH" });
    input.expectedReviewRevision = 7; review.quality.snapshot.state = "HOLD_FOR_REMEDIATION";
    expect(buildReviewedProfileCountSelection(f.context, review, input))
      .toEqual({ ok: false, code: "QUALITY_HOLD", requestIndex: 0 });
    expect(planned.reviewRevision).toBe(6); // Prior intent is detached, not reusable authorization.
  });
  it("discovers target-supported requests from actual reviewed meanings and replans them", () => {
    const f = fixture("DECIMAL", ["0", "5"]);
    f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "MEASURE" });
    const reviewed = buildAnalysisReviewSnapshots(f.context, f.profile, f.choices, f.decisions);
    if (!reviewed.ok) throw new Error(reviewed.code);
    const catalog = buildReviewedProfileCountRequestCatalog(f.context, { revision: 6, schema: reviewed.schema, quality: reviewed.quality });
    if (!catalog.ok) throw new Error(catalog.code);
    expect(catalog.catalog.requests).toEqual([rows, present]);
    expect(plan(f, [...catalog.catalog.requests], catalog.catalog.reviewRevision)).toMatchObject({ ok: true });
  });
  it("derives measure plans from actual semantic review without leaking statistics or computing counts", () => {
    const f = fixture("DECIMAL", ["0", "5"]);
    f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "MEASURE" });
    Object.assign(f.context, { privateMetadata: "must-be-omitted" });
    const before = structuredClone(f); const result = plan(f);
    expect(f).toEqual(before);
    expect(result).toMatchObject({ ok: true, reviewRevision: 6, plans: [
      { context: { uploadId: "upload" }, snapshot: { operation: "ROW_COUNT", readinessState: "READY" } },
      { snapshot: { operation: "COUNT_PRESENT", sourceSchemaColumnId: "amount", missingValuePolicy: "EXCLUDE_MISSING" } },
    ] });
    if (!result.ok || !("plans" in result)) throw new Error("planning failed");
    for (const scoped of result.plans) {
      expect(scoped.context).not.toHaveProperty("privateMetadata");
      for (const key of ["count", "rowCount", "nonNullCount", "nullCount", "numericStats", "cells", "normalizedValue"])
        expect(scoped.snapshot).not.toHaveProperty(key);
    }
    f.profile.context.uploadId = "changed"; f.choices.snapshot[0].role = "CATEGORICAL_DIMENSION";
    expect(result.plans[1]).toMatchObject({ context: { uploadId: "upload" }, snapshot: { sourceSchemaColumnId: "amount" } });
  });
  it("requires a real generated notice decision before planning and retains acknowledged state", () => {
    const f = fixture("DECIMAL", ["5", "5"]);
    f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "MEASURE" });
    expect(plan(f)).toMatchObject({ ok: false, code: "DECISION_REQUIRED" });
    f.decisions.snapshot.push({ code: "COLUMN_CONSTANT", scope: "COLUMN", sourceSchemaColumnId: "amount", decision: "ACKNOWLEDGE" });
    expect(plan(f)).toMatchObject({ ok: true, plans: [
      { snapshot: { readinessState: "READY_WITH_ACKNOWLEDGED_NOTICES" } },
      { snapshot: { readinessState: "READY_WITH_ACKNOWLEDGED_NOTICES" } },
    ] });
  });
  it.each(["CONTINUE", "HOLD"] as const)("preserves the explicit empty-profile review decision %s", decision => {
    const f = fixture("DECIMAL", []);
    f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "MEASURE" });
    f.decisions.snapshot.push({ code: "EMPTY_DATASET", scope: "DATASET", decision });
    expect(plan(f)).toMatchObject(decision === "HOLD" ? { ok: false, code: "QUALITY_HOLD", requestIndex: 0 }
      : { ok: true, plans: [{ snapshot: { operation: "ROW_COUNT" } }, { snapshot: { operation: "COUNT_PRESENT" } }] });
  });
  it.each(["profile", "choices", "decisions"] as const)("rejects mismatched %s lineage before composing plans", name => {
    for (const key of Object.keys(fixture().context) as (keyof AnalysisDatasetContext)[]) {
      const f = fixture(); f[name].context[key] = "other";
      expect(plan(f)).toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
    }
  });
  it("rejects missing and invented meaning choices without accepted plans", () => {
    const f = fixture();
    expect(plan(f)).toMatchObject({ ok: false, code: "CHOICE_REQUIRED" });
    f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "IDENTIFIER" });
    expect(plan(f)).toMatchObject({ ok: false, code: "ROLE_NOT_CANDIDATE" });
  });
  it("rejects fabricated quality decisions", () => {
    const f = fixture(); f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "MEASURE" });
    f.decisions.snapshot.push({ code: "EMPTY_DATASET", scope: "DATASET", decision: "CONTINUE" });
    expect(plan(f)).toMatchObject({ ok: false, code: "UNKNOWN_REVIEW_ITEM" });
  });
  it("does not turn automatically resolved flags into measure or profile-group authority", () => {
    const f = fixture("BOOLEAN", [true, false]);
    expect(plan(f, [rows])).toMatchObject({ ok: true });
    expect(plan(f)).toEqual({ ok: false, code: "CAPABILITY_NOT_AVAILABLE", requestIndex: 1 });
    expect(plan(f, [rows, { requestVersion: "v1", kind: "GROUP_BY", sourceSchemaColumnId: "amount" }]))
      .toEqual({ ok: false, code: "PROFILE_OPERATION_NOT_SUPPORTED", requestIndex: 1 });
  });
  it("retains unsupported aggregate denial after a valid first intent", () => {
    const f = fixture(); f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "MEASURE" });
    expect(plan(f, [rows, { requestVersion: "v1", kind: "AGGREGATE", sourceSchemaColumnId: "amount" }]))
      .toEqual({ ok: false, code: "PLAN_KIND_NOT_SUPPORTED", requestIndex: 1 });
  });
  it.each([5, 7])("rejects supplied revision mismatch %s after real review derivation", revision => {
    const f = fixture(); f.choices.snapshot.push({ sourceSchemaColumnId: "amount", role: "MEASURE" });
    expect(plan(f, [rows], revision)).toEqual({ ok: false, code: "REVIEW_REVISION_MISMATCH" });
  });
  it("rejects inconsistent evidence before semantic review", () => {
    const f = fixture(); f.profile.snapshot.columns[0].nonNullCount = 99;
    expect(plan(f)).toEqual({ ok: false, code: "PROFILE_EVIDENCE_INVALID" });
  });
});
