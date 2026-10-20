import { expect, it } from "vitest";
import { decodeReviewDetail, parseReviewHistoryQuery, type ReviewDetail } from "@/lib/data-hub/analysis/reviewHistory";
import { historyFixture } from "../helpers/dataHubHistoryFixture";
const f = historyFixture();
const query = { kind: "detail" as const, datasetProfileRunId: "profile", expectedReviewRevision: 3, revision: 1 };
const detail = (): ReviewDetail => ({ detailVersion: "v1", context: { ...f.context }, currentReviewRevision: 3, revision: 1,
  semanticChoices: [{ sourceSchemaColumnId: "amount", role: "MEASURE" }],
  qualityDecisions: [{ code: "COLUMN_ALL_NULL", scope: "COLUMN", sourceSchemaColumnId: "amount", decision: "HOLD" }] });
const decode = (value: unknown) => decodeReviewDetail({ ok: true, detail: value }, f.context, query, ["amount"]);
it("copies a closed decision-only snapshot without inventing absent choices", () => {
  const source = detail(), result = decode(source);
  expect(result).toEqual(source); result.semanticChoices[0].role = "CURRENCY"; expect(source.semanticChoices[0].role).toBe("MEASURE");
  expect(decode({ ...detail(), semanticChoices: [], qualityDecisions: [] })).toMatchObject({ semanticChoices: [], qualityDecisions: [] });
});
it.each(["currentReviewRevision", "revision", "context", "version", "actor", "raw", "duplicate", "foreign", "vocabulary", "quality", "oversized", "accessor"])("rejects invalid %s details", kind => {
  const value = detail();
  if (kind === "currentReviewRevision") value.currentReviewRevision = 4;
  if (kind === "revision") value.revision = 2;
  if (kind === "context") value.context.uploadId = "foreign";
  if (kind === "version") Object.assign(value, { detailVersion: "v2" });
  if (kind === "actor") Object.assign(value, { actorId: "private" });
  if (kind === "raw") Object.assign(value.semanticChoices[0], { rawValue: "private" });
  if (kind === "duplicate") value.semanticChoices.push({ ...value.semanticChoices[0] });
  if (kind === "foreign") value.semanticChoices[0].sourceSchemaColumnId = "foreign";
  if (kind === "vocabulary") Object.assign(value.semanticChoices[0], { role: "APPROVED" });
  if (kind === "quality") Object.assign(value.qualityDecisions[0], { decision: "ACKNOWLEDGE" });
  if (kind === "oversized") value.semanticChoices = Array(1001).fill(value.semanticChoices[0]);
  if (kind === "accessor") Object.defineProperty(value.qualityDecisions[0], "decision", { enumerable: true, get: () => { throw new Error("must not read"); } });
  expect(() => decode(value)).toThrow("RESPONSE_INVALID");
});
it("preserves opaque field identities and rejects overlong identities", () => {
  const value = detail(); value.semanticChoices[0].sourceSchemaColumnId = "__proto__"; value.qualityDecisions = [];
  expect(decodeReviewDetail({ ok: true, detail: value }, f.context, query, ["__proto__"]).semanticChoices[0].sourceSchemaColumnId).toBe("__proto__");
  value.semanticChoices[0].sourceSchemaColumnId = "x".repeat(513);
  expect(() => decodeReviewDetail({ ok: true, detail: value }, f.context, query, ["x".repeat(513)])).toThrow("RESPONSE_INVALID");
});
const search = "historyVersion=v1&datasetProfileRunId=profile&expectedReviewRevision=3";
it.each(["1", "3"])("accepts selected revision %s with a separate current pin", revision => {
  expect(parseReviewHistoryQuery(new URLSearchParams(`${search}&revision=${revision}`), "detail")).toEqual({ ...query, revision: Number(revision) });
});
it.each(["", "&revision=0", "&revision=4", "&revision=-1", "&revision=01", "&revision=1.0", "&revision=9007199254740992", "&revision=1&revision=2", "&revision=1&beforeRevision=2", "&revision=1&baselineRevision=1", "&revision=1&organisationId=foreign"])("rejects malformed or extra detail query %s", suffix => {
  expect(parseReviewHistoryQuery(new URLSearchParams(search + suffix), "detail")).toBeNull();
});
