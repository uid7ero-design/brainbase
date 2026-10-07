import { describe, expect, it } from "vitest";
import { profileDataset } from "@/lib/data-hub/profiling/profileDataset";
import { evaluateScopedProfileCount, type AnalysisDatasetContext, type AnalysisReadiness } from "@/lib/data-hub/analysis";

function context(): AnalysisDatasetContext {
  return { organisationId: "org", uploadId: "upload", importBatchId: "batch",
    normalizationRunId: "normalization", datasetProfileRunId: "profile",
    sourceSchemaVersionId: "schema", sourceSchemaWorksheetId: "worksheet",
    worksheetMappingProfileVersionId: "mapping" };
}
function readiness(): AnalysisReadiness {
  return { readinessVersion: "v1", schemaVersion: "v1", profilerVersion: "v1",
    qualityResolutionVersion: "v1", state: "READY", fieldCount: 0,
    catalog: { textAttributes: [], identifiers: [], dimensions: [], flags: [], measures: [], temporals: [], geoCoordinates: [] } };
}
function profile() {
  const result = profileDataset({ rowCount: 2, columns: [] });
  if (!result.ok) throw new Error(result.code);
  return result.profile;
}
const request = { requestVersion: "v1", kind: "ROW_COUNT" };
const keys = Object.keys(context()) as (keyof AnalysisDatasetContext)[];

describe("D4D5H scoped profile counts", () => {
  it("returns the count with a copied, closed matching context", () => {
    const expected = { ...context(), extra: "never return this" };
    const result = evaluateScopedProfileCount(expected,
      { context: context(), snapshot: readiness() }, request, { context: context(), snapshot: profile() });
    expect(result).toMatchObject({ ok: true, result: { count: 2, context: context() } });
    if (!result.ok) throw new Error(result.code);
    expect(result.result.context).not.toBe(expected);
    expect(Object.keys(result.result.context).sort()).toEqual(keys.toSorted());
  });
  it.each(keys)("rejects a profile %s mismatch even with identical columns", (key) => {
    const other = context(); other[key] = "different";
    expect(evaluateScopedProfileCount(context(), { context: context(), snapshot: readiness() },
      request, { context: other, snapshot: profile() }))
      .toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
  });
  it.each(keys)("rejects a readiness %s mismatch", (key) => {
    const other = context(); other[key] = "different";
    expect(evaluateScopedProfileCount(context(), { context: other, snapshot: readiness() },
      request, { context: context(), snapshot: profile() }))
      .toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
  });
  it("rejects two matching snapshots outside the expected context", () => {
    const other = context(); other.organisationId = "other-org";
    expect(evaluateScopedProfileCount(context(), { context: other, snapshot: readiness() },
      request, { context: other, snapshot: profile() }))
      .toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
  });
  it.each(keys)("rejects blank %s rather than treating blanks as matching", (key) => {
    const invalid = context(); invalid[key] = " ";
    expect(evaluateScopedProfileCount(invalid, { context: invalid, snapshot: readiness() },
      request, { context: invalid, snapshot: profile() }))
      .toEqual({ ok: false, code: "DATASET_CONTEXT_INVALID" });
  });
  it("compares IDs exactly without trimming", () => {
    const other = context(); other.uploadId = " upload ";
    expect(evaluateScopedProfileCount(context(), { context: other, snapshot: readiness() },
      request, { context: context(), snapshot: profile() }))
      .toEqual({ ok: false, code: "DATASET_CONTEXT_MISMATCH" });
  });
  it("still blocks quality holds after matching context", () => {
    const input = readiness(); input.state = "BLOCKED_QUALITY_HOLD";
    expect(evaluateScopedProfileCount(context(), { context: context(), snapshot: input },
      request, { context: context(), snapshot: profile() }))
      .toEqual({ ok: false, code: "QUALITY_HOLD" });
  });
  it("preserves underlying request failures", () => {
    expect(evaluateScopedProfileCount(context(), { context: context(), snapshot: readiness() },
      null, { context: context(), snapshot: profile() }))
      .toEqual({ ok: false, code: "INVALID_REQUEST" });
  });
});
