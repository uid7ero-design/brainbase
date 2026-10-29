import { afterEach, expect, it, vi } from "vitest";
import { decodeReviewPlan, decodeSessionReview, decodeReviewSave, requestReviewJson, MAX_REVIEW_FIELDS } from "@/lib/data-hub/client/reviewSession";
import { reviewPlanFixture, reviewPreviewFixture, savedReviewFixture } from "../helpers/dataHubReviewFixture";
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("projects supported metadata, owns copies and omits unused rich fields", () => {
  const input = reviewPreviewFixture(); Object.assign(input.clarification.columns[0], { privateValues: ["private"] });
  const parsed = decodeReviewPlan(input, "profile-1");
  input.clarification.columns[0].candidateRoles.length = 0;
  expect(parsed.clarification.columns[0].candidateRoles).toEqual(["MEASURE", "CURRENCY"]);
  expect(JSON.stringify(parsed)).not.toContain("private");
  const saved = savedReviewFixture(), review = decodeSessionReview(saved, "upload", "profile-1");
  saved.schema.context.uploadId = "changed";
  expect(review.schema.context.uploadId).toBe("upload");
  expect(review.schema.snapshot.fields[0]).not.toHaveProperty("evidence");
});
it.each(["outer", "version", "duplicate", "labels", "role", "sparse", "accessor", "inherited", "quality"])("rejects invalid %s discovery metadata", kind => {
  const input = reviewPreviewFixture();
  if (kind === "outer") Object.assign(input, { rawValues: ["private"] });
  if (kind === "version") input.clarification.profilerVersion = "v2";
  if (kind === "duplicate") input.clarification.columns.push(input.clarification.columns[0]);
  if (kind === "labels") input.fieldLabels[0].sourceSchemaColumnId = "foreign";
  if (kind === "role") input.clarification.columns[0].candidateRoles = ["PRIVATE"];
  if (kind === "sparse") delete input.clarification.columns[0];
  if (kind === "accessor") Object.defineProperty(input.clarification, "columns", { get: () => { throw new Error("private"); } });
  if (kind === "inherited") input.clarification = Object.create(input.clarification);
  if (kind === "quality") input.quality.items[0].sourceSchemaColumnId = "foreign";
  expect(() => decodeReviewPlan(input)).toThrow("RESPONSE_INVALID");
});
it("closes oversized interactive review metadata and pins preview profile", () => {
  const input = reviewPlanFixture(); input.clarification.columns = Array(MAX_REVIEW_FIELDS + 1).fill(input.clarification.columns[0]);
  expect(() => decodeReviewPlan(input)).toThrow("REVIEW_FIELD_LIMIT");
  expect(() => decodeReviewPlan(reviewPreviewFixture(), "obsolete")).toThrow("REVIEW_PROFILE_CHANGED");
  expect(() => decodeSessionReview(savedReviewFixture(), "upload", "profile-1", ["foreign"])).toThrow("RESPONSE_INVALID");
});
it.each(["context", "profile", "revision", "version", "field", "quality-state", "quality-id"])("rejects invalid saved %s before rendering controls", kind => {
  const input = savedReviewFixture();
  if (kind === "context") input.quality.context.organisationId = "other";
  if (kind === "profile") input.schema.context.datasetProfileRunId = input.quality.context.datasetProfileRunId = "obsolete";
  if (kind === "revision") input.revision = 0;
  if (kind === "version") Object.assign(input.schema.snapshot, { resolutionVersion: "v2" });
  if (kind === "field") input.schema.snapshot.fields.push(input.schema.snapshot.fields[0]);
  if (kind === "quality-state") input.quality.snapshot.state = "HOLD_FOR_REMEDIATION";
  if (kind === "quality-id") input.quality.snapshot.items.push({ code: "COLUMN_PARTIALLY_NULL", scope: "COLUMN", sourceSchemaColumnId: "foreign", decision: "ACKNOWLEDGE" });
  expect(() => decodeSessionReview(input, "upload", "profile-1")).toThrow(kind === "context" ? "DATASET_CONTEXT_MISMATCH" : kind === "profile" ? "REVIEW_PROFILE_CHANGED" : "RESPONSE_INVALID");
});
it.each([{}, { ok: true }, { ok: true, revision: 0 }, { ok: true, revision: 1, extra: "private" }])("requires an exact positive save acknowledgement %j", value => {
  expect(() => decodeReviewSave(value)).toThrow("RESPONSE_INVALID"); expect(decodeReviewSave({ ok: true, revision: 3 })).toBe(3);
});
it("keeps supported missing review errors and hides private server failures", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply({ ok: false, code: "REVIEW_NOT_FOUND" }, 404))
    .mockResolvedValueOnce(reply({ ok: false, code: "private" }, 500)));
  await expect(requestReviewJson("/review", new AbortController())).rejects.toThrow("REVIEW_NOT_FOUND");
  await expect(requestReviewJson("/review", new AbortController())).rejects.toThrow("REQUEST_FAILED");
});
it("releases stalled discovery and late bodies on cancellation or the deadline", async () => {
  vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const controller = new AbortController();
  const pending = requestReviewJson("/review", controller).catch(error => error.message); controller.abort();
  expect(await pending).toBe("REQUEST_CANCELLED");
  const deadline = requestReviewJson("/review", new AbortController()).catch(error => error.message);
  await vi.advanceTimersByTimeAsync(15_000); expect(await deadline).toBe("REQUEST_TIMED_OUT");
});
