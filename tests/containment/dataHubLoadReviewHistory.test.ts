import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ transaction: vi.fn(), profile: vi.fn(), first: vi.fn(), many: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: db.transaction } }));
vi.mock("@/lib/data-hub/analysisExecution/loadProfileReviewEvidence", () => ({ loadProfileReviewEvidenceInTransaction: db.profile }));
import { loadReviewHistory } from "@/lib/data-hub/analysisExecution/loadReviewHistory";
const context = { organisationId: "org", uploadId: "upload", importBatchId: "batch", normalizationRunId: "norm", datasetProfileRunId: "profile",
  sourceSchemaVersionId: "schema", sourceSchemaWorksheetId: "worksheet", worksheetMappingProfileVersionId: "mapping" };
const scope = { organisationId: "org", uploadId: "upload" }, query = { kind: "page" as const, datasetProfileRunId: "profile", expectedReviewRevision: 3, beforeRevision: null };
const record = (revision = 3) => ({ organisation_id: "org", upload_id: "upload", profile_run_id: "profile", revision, review_version: "v1",
  semantic_choices: [{ sourceSchemaColumnId: "amount", role: "MEASURE" }], quality_decisions: [{ code: "COLUMN_PARTIALLY_NULL", scope: "COLUMN", sourceSchemaColumnId: "amount", decision: "ACKNOWLEDGE" }] });
const profile = () => ({ ok: true, profile: { context: { ...context }, snapshot: { profilerVersion: "v1", rowCount: 3, columnCount: 1, columns: [
  { sourceSchemaColumnId: "amount", valueKind: "DECIMAL", sourceUnit: null, normalizedUnit: null, rowCount: 3, nonNullCount: 2, nullCount: 1, distinctNonNullCount: 2,
    isConstant: false, isAllNull: false, isUniqueAmongNonNull: true, isComplete: false, isSparse: true },
] } } });
beforeEach(() => { vi.resetAllMocks(); db.profile.mockResolvedValue(profile()); db.first.mockResolvedValue(record()); db.many.mockResolvedValue([record(), record(2), record(1)]);
  db.transaction.mockImplementation(async fn => fn({ dataHubAnalysisReview: { findFirst: db.first, findMany: db.many } })); });
it("reads a bounded current-profile page in a single snapshot and selects no actor or raw data", async () => {
  expect(await loadReviewHistory(scope, query)).toMatchObject({ ok: true, history: { currentReviewRevision: 3, nextBeforeRevision: null, entries: [
    { revision: 3, semanticChoiceCount: 1, qualityDecisionCount: 1, acknowledgedNoticeCount: 1 }, { revision: 2 }, { revision: 1 },
  ] } });
  expect(db.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 5000 });
  expect(db.many.mock.calls[0][0]).toMatchObject({ take: 11, orderBy: { revision: "desc" }, where: { organisation_id: "org", upload_id: "upload", profile_run_id: "profile", revision: { lte: 3 } } });
  expect(Object.keys(db.many.mock.calls[0][0].select).sort()).toEqual(["organisation_id", "upload_id", "profile_run_id", "quality_decisions", "review_version", "revision", "semantic_choices"].sort());
});
it("uses exclusive keyset bounds and compares only a scoped earlier revision to latest", async () => {
  db.many.mockResolvedValue([record(1)]);
  expect(await loadReviewHistory(scope, { ...query, beforeRevision: 2 })).toMatchObject({ ok: true, history: { entries: [{ revision: 1 }] } });
  expect(db.many.mock.calls[0][0].where.revision).toEqual({ lt: 2 });
  db.first.mockReset().mockResolvedValueOnce(record()).mockResolvedValueOnce(record(1));
  expect(await loadReviewHistory(scope, { kind: "compare", datasetProfileRunId: "profile", expectedReviewRevision: 3, baselineRevision: 1 })).toMatchObject({ ok: true, comparison: { baselineRevision: 1, semanticChanges: [], qualityChanges: [] } });
  expect(db.first.mock.calls[1][0].where).toEqual({ organisation_id: "org", upload_id: "upload", profile_run_id: "profile", revision: 1 });
});
it.each(["actor-scope", "profile", "revision", "invalid-latest", "historical", "order", "exception"])("fails closed for %s without fallback", async kind => {
  if (kind === "actor-scope") { const p = profile(); p.profile.context.organisationId = "foreign"; db.profile.mockResolvedValue(p); }
  if (kind === "profile") { const p = profile(); p.profile.context.datasetProfileRunId = "new"; db.profile.mockResolvedValue(p); }
  if (kind === "revision") db.first.mockResolvedValue(record(4));
  if (kind === "invalid-latest") db.first.mockResolvedValue({ ...record(), quality_decisions: [] });
  if (kind === "historical") db.many.mockResolvedValue([record(), { ...record(2), semantic_choices: [] }]);
  if (kind === "order") db.many.mockResolvedValue([record(2), record()]);
  if (kind === "exception") db.first.mockRejectedValue(new Error("private-diagnostic"));
  const result = await loadReviewHistory(scope, query);
  expect(result).toEqual({ ok: false, code: kind === "profile" ? "REVIEW_PROFILE_CHANGED" : kind === "revision" ? "REVIEW_REVISION_MISMATCH" :
    ["historical", "order", "invalid-latest"].includes(kind) ? "REVIEW_RECORD_INVALID" : "REVIEW_HISTORY_UNAVAILABLE" });
  if (["revision", "invalid-latest"].includes(kind)) expect(db.many).not.toHaveBeenCalled();
});
it("stops missing and incomplete profiles and enforces rendering and query bounds", async () => {
  db.profile.mockResolvedValue({ ok: false, code: "UPLOAD_NOT_FOUND" }); expect(await loadReviewHistory(scope, query)).toEqual({ ok: false, code: "UPLOAD_NOT_FOUND" });
  expect(db.first).not.toHaveBeenCalled();
  const p = profile(); p.profile.snapshot.columns = Array(1001).fill(p.profile.snapshot.columns[0]); db.profile.mockResolvedValue(p);
  expect(await loadReviewHistory(scope, query)).toEqual({ ok: false, code: "REVIEW_FIELD_LIMIT" });
  db.transaction.mockClear(); expect(await loadReviewHistory(scope, { ...query, beforeRevision: 4 })).toEqual({ ok: false, code: "REVIEW_HISTORY_INVALID" }); expect(db.transaction).not.toHaveBeenCalled();
});
