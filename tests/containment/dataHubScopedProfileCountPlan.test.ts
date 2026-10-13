import { describe, expect, it } from "vitest";
import { buildScopedProfileCountPlan, type AnalysisDatasetContext, type AnalysisReadiness } from "@/lib/data-hub/analysis";

function context(): AnalysisDatasetContext {
  return { organisationId: "org", uploadId: "upload", importBatchId: "batch",
    normalizationRunId: "normalization", datasetProfileRunId: "profile",
    sourceSchemaVersionId: "schema", sourceSchemaWorksheetId: "worksheet",
    worksheetMappingProfileVersionId: "mapping" };
}
function readiness(): AnalysisReadiness {
  return { readinessVersion: "v1", schemaVersion: "v1", profilerVersion: "v1",
    qualityResolutionVersion: "v1", state: "READY", fieldCount: 2,
    catalog: { textAttributes: [], identifiers: [], dimensions: ["category"], flags: [],
      measures: ["amount"], temporals: [], geoCoordinates: [] } };
}
const rows = { requestVersion: "v1", kind: "ROW_COUNT" };
const present = { requestVersion: "v1", kind: "AGGREGATE", operator: "COUNT_PRESENT", sourceSchemaColumnId: "amount" };
const keys = Object.keys(context()) as (keyof AnalysisDatasetContext)[];

describe("dataset-scoped profile planning", () => {
  it.each([rows, present])("plans supported intent with detached closed lineage without statistics %#", request => {
    const expected = { ...context(), diagnostic: "private-metadata" };
    const input = { context: context(), snapshot: readiness() };
    const result = buildScopedProfileCountPlan(expected, input, request);
    expect(result).toMatchObject({ ok: true, plan: { context: context(), snapshot: {
      planVersion: "v1", readinessState: "READY", operation: request.kind === "ROW_COUNT" ? "ROW_COUNT" : "COUNT_PRESENT" } } });
    if (!result.ok) throw new Error(result.code);
    expect(result.plan.context).not.toBe(expected);
    expect(Object.keys(result.plan.context).sort()).toEqual(keys.toSorted());
    expected.uploadId = "changed"; input.context.datasetProfileRunId = "changed";
    input.snapshot.state = "BLOCKED_QUALITY_HOLD"; input.snapshot.catalog.measures.length = 0;
    expect(result.plan.context).toEqual(context());
    expect(result.plan.snapshot.readinessState).toBe("READY");
    expect(JSON.stringify(result)).not.toContain("private-metadata");
  });
  it.each(keys)("rejects mismatched %s before reading readiness", key => {
    const other = context(); other[key] = "other";
    const input = { context: other, get snapshot(): AnalysisReadiness { throw new Error("Readiness must not be read"); } };
    expect(buildScopedProfileCountPlan(context(), input, rows)).toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
  });
  it.each(keys)("rejects incomplete matching %s", key => {
    const invalid = context(); invalid[key] = " ";
    expect(buildScopedProfileCountPlan(invalid, { context: invalid, snapshot: readiness() }, rows))
      .toEqual({ ok: false, code: "DATASET_CONTEXT_INVALID" });
  });
  it("compares identities exactly without normalizing them", () => {
    const other = context(); other.uploadId = " upload ";
    expect(buildScopedProfileCountPlan(context(), { context: other, snapshot: readiness() }, rows))
      .toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
  });
  it.each(["hold", "catalog", "version", "group", "field", "request"])("retains target denial after matching context: %s", kind => {
    const input = readiness(); let request: unknown = rows; let code = "";
    if (kind === "hold") { input.state = "BLOCKED_QUALITY_HOLD"; code = "QUALITY_HOLD"; }
    if (kind === "catalog") { input.fieldCount++; code = "READINESS_CATALOG_INVALID"; }
    if (kind === "version") { Object.assign(input, { schemaVersion: "v2" }); code = "PROFILE_PLAN_VERSION_UNSUPPORTED"; }
    if (kind === "group") { request = { requestVersion: "v1", kind: "GROUP_BY", sourceSchemaColumnId: "category" }; code = "PROFILE_OPERATION_NOT_SUPPORTED"; }
    if (kind === "field") { request = { ...present, sourceSchemaColumnId: "missing" }; code = "CAPABILITY_NOT_AVAILABLE"; }
    if (kind === "request") { request = { ...rows, sql: "unaccepted" }; code = "INVALID_REQUEST"; }
    expect(buildScopedProfileCountPlan(context(), { context: context(), snapshot: input }, request)).toEqual({ ok: false, code });
  });
});
