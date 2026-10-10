import { describe, expect, it } from "vitest";
import { parseReviewedCountResponse } from "@/lib/data-hub/analysis/countResponse";

const response = (present = false) => ({ ok: true, reviewRevision: 3, result: {
  resultVersion: "v1", count: 0,
  plan: { planVersion: "v1", readinessVersion: "v1", schemaVersion: "v1", profilerVersion: "v1",
    qualityResolutionVersion: "v1", readinessState: "READY", operation: present ? "COUNT_PRESENT" : "ROW_COUNT",
    ...(present ? { sourceSchemaColumnId: "amount", missingValuePolicy: "EXCLUDE_MISSING" } : {}) },
  context: { organisationId: "org", uploadId: "upload", importBatchId: "batch", normalizationRunId: "normalized",
    datasetProfileRunId: "new-profile", sourceSchemaVersionId: "schema", sourceSchemaWorksheetId: "worksheet", worksheetMappingProfileVersionId: "mapping" },
} });
const expected = { uploadId: "upload", operation: "ROW_COUNT" } as const;

describe("closed reviewed-count response contract", () => {
  it("preserves zero and actual newer lineage with independent returned records", () => {
    const input = response(); const parsed = parseReviewedCountResponse(input, expected);
    expect(parsed).toEqual({ ok: true, response: input });
    input.result.count = 99; input.result.context.datasetProfileRunId = "changed"; input.result.plan.readinessState = "HOLD";
    if (!parsed.ok) throw new Error("Expected valid response");
    expect(parsed.response.result.count).toBe(0);
    expect(parsed.response.result.context.datasetProfileRunId).toBe("new-profile");
    expect(parsed.response.result.plan.readinessState).toBe("READY");
  });
  it("accepts present counts only with the requested field and exclusion policy", () => {
    expect(parseReviewedCountResponse(response(true), { uploadId: "upload", operation: "COUNT_PRESENT", sourceSchemaColumnId: "amount" }).ok).toBe(true);
  });
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "3", null])("rejects invalid count %s", value => {
    const input = response(); Object.assign(input.result, { count: value });
    expect(parseReviewedCountResponse(input, expected)).toEqual({ ok: false, code: "COUNT_RESPONSE_INVALID" });
  });
  it.each([0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1", null])("rejects invalid review revision %s", value => {
    const input = response(); Object.assign(input, { reviewRevision: value });
    expect(parseReviewedCountResponse(input, expected).ok).toBe(false);
  });
  it.each(["resultVersion", "planVersion", "readinessVersion", "schemaVersion", "profilerVersion", "qualityResolutionVersion"])("rejects incompatible %s", key => {
    const input = response(); Object.assign(key === "resultVersion" ? input.result : input.result.plan, { [key]: "v2" });
    expect(parseReviewedCountResponse(input, expected).ok).toBe(false);
  });
  it.each(Object.keys(response().result.context))("requires nonblank context %s", key => {
    for (const value of [undefined, null, " "]) {
      const input = response(); Object.assign(input.result.context, { [key]: value });
      expect(parseReviewedCountResponse(input, expected).ok).toBe(false);
    }
  });
  it.each(["root", "result", "plan", "context"])("rejects uncontracted data at %s", level => {
    const input = response(); const target = level === "root" ? input : level === "result" ? input.result : level === "plan" ? input.result.plan : input.result.context;
    Object.assign(target, { sourceValues: ["private"] });
    expect(parseReviewedCountResponse(input, expected).ok).toBe(false);
  });
  it.each([null, [], {}, { ok: false, code: "QUALITY_HOLD" }])("rejects incomplete or failed envelopes", input => {
    expect(parseReviewedCountResponse(input, expected).ok).toBe(false);
  });
  it.each(["HOLD_FOR_REMEDIATION", "BLOCKED_QUALITY_HOLD", "UNKNOWN"])("rejects readiness %s", state => {
    const input = response(); input.result.plan.readinessState = state;
    expect(parseReviewedCountResponse(input, expected).ok).toBe(false);
  });
  it("accepts acknowledged readiness but rejects grouped operations and altered missing policies", () => {
    const input = response(); input.result.plan.readinessState = "READY_WITH_ACKNOWLEDGED_NOTICES";
    expect(parseReviewedCountResponse(input, expected).ok).toBe(true);
    input.result.plan.operation = "GROUPED_ROW_COUNT";
    expect(parseReviewedCountResponse(input, expected).ok).toBe(false);
    const present = response(true); present.result.plan.missingValuePolicy = "INCLUDE_MISSING";
    expect(parseReviewedCountResponse(present, { uploadId: "upload", operation: "COUNT_PRESENT", sourceSchemaColumnId: "amount" }).ok).toBe(false);
  });
  it("rejects worksheet, operation and selected-field mismatches", () => {
    expect(parseReviewedCountResponse(response(), { ...expected, uploadId: "foreign" })).toEqual({ ok: false, code: "COUNT_RESPONSE_MISMATCH" });
    expect(parseReviewedCountResponse(response(true), expected)).toEqual({ ok: false, code: "COUNT_RESPONSE_MISMATCH" });
    expect(parseReviewedCountResponse(response(true), { uploadId: "upload", operation: "COUNT_PRESENT", sourceSchemaColumnId: "other" })).toEqual({ ok: false, code: "COUNT_RESPONSE_MISMATCH" });
  });
});
