import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ transaction: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: db.transaction } }));
vi.mock("@/lib/data-hub/analysisExecution/loadAnalysisReview", () => ({ loadAnalysisReviewInTransaction: db.load }));
import { loadReviewStatus } from "@/lib/data-hub/analysisExecution/loadReviewStatus";
import { decodeReviewStatus } from "@/lib/data-hub/analysis/reviewStatus";
import { checkWorkbookReviews } from "@/lib/data-hub/client/workbookReviews";
import type { WorkbookWorksheet } from "@/lib/data-hub/client/workbookPreparation";

const context = { organisationId: "org", uploadId: "upload", importBatchId: "batch", normalizationRunId: "normal",
  datasetProfileRunId: "profile", sourceSchemaVersionId: "schema", sourceSchemaWorksheetId: "worksheet", worksheetMappingProfileVersionId: "mapping" };
const saved = (state = "READY") => ({ ok: true, revision: 2,
  schema: { context, snapshot: { schemaVersion: "v1", profilerVersion: "v1", fields: [] } },
  quality: { context: { ...context }, snapshot: { schemaVersion: "v1", profilerVersion: "v1", resolutionVersion: "v1", state } } });
const scope = { organisationId: "org", uploadId: "upload" }, tx = {};
beforeEach(() => { vi.resetAllMocks(); db.transaction.mockImplementation(async callback => callback(tx)); db.load.mockResolvedValue(saved()); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("governed scalar review observation", () => {
  it.each([["READY", "REVIEWED"], ["READY_WITH_ACKNOWLEDGED_NOTICES", "REVIEWED_WITH_NOTICES"], ["HOLD_FOR_REMEDIATION", "QUALITY_HOLD"]])("projects %s without exposing review payload", async (quality, state) => {
    db.load.mockResolvedValue({ ...saved(quality), private: "hidden" });
    expect(await loadReviewStatus(scope)).toEqual({ ok: true, status: { statusVersion: "v1", uploadId: "upload", state, datasetProfileRunId: "profile", reviewRevision: 2 } });
    expect(db.load).toHaveBeenCalledWith(scope, tx);
    expect(db.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 5000 });
  });
  it.each([["PROFILE_NOT_COMPLETE", "PREPARATION_REQUIRED"], ["REVIEW_NOT_FOUND", "REVIEW_REQUIRED"]])("keeps %s separate from a completed review", async (code, state) => {
    db.load.mockResolvedValue({ ok: false, code });
    expect(await loadReviewStatus(scope)).toEqual({ ok: true, status: { statusVersion: "v1", uploadId: "upload", state } });
  });
  it.each(["PROFILE_LINEAGE_MISMATCH", "PROFILER_VERSION_UNSUPPORTED", "REVIEW_RECORD_INVALID", "ROLE_NOT_CANDIDATE"])("keeps %s unconfirmed instead of falling back", async code => {
    db.load.mockResolvedValue({ ok: false, code }); expect(await loadReviewStatus(scope)).toEqual({ ok: false, code: "REVIEW_STATUS_UNAVAILABLE" });
  });
  it("conceals missing/foreign worksheets without a status", async () => {
    db.load.mockResolvedValue({ ok: false, code: "UPLOAD_NOT_FOUND" }); expect(await loadReviewStatus(scope)).toEqual({ ok: false, code: "UPLOAD_NOT_FOUND" });
  });
  it.each(["organisationId", "uploadId", "datasetProfileRunId"])("rejects mismatched %s lineage", async key => {
    const review = saved(); review.quality.context = { ...context, [key]: "other" }; db.load.mockResolvedValue(review);
    expect(await loadReviewStatus(scope)).toEqual({ ok: false, code: "REVIEW_STATUS_UNAVAILABLE" });
  });
  it("rejects invalid revision and unknown quality state without readiness", async () => {
    db.load.mockResolvedValue({ ...saved(), revision: 0 }); expect((await loadReviewStatus(scope)).ok).toBe(false);
    db.load.mockResolvedValue(saved("invented")); expect((await loadReviewStatus(scope)).ok).toBe(false);
  });
  it("closes database exceptions and rejects invalid input before reads", async () => {
    expect(await loadReviewStatus({ ...scope, uploadId: " " })).toEqual({ ok: false, code: "REVIEW_STATUS_INVALID" }); expect(db.transaction).not.toHaveBeenCalled();
    db.transaction.mockRejectedValue(new Error("private")); expect(await loadReviewStatus(scope)).toEqual({ ok: false, code: "REVIEW_STATUS_UNAVAILABLE" });
  });
});

const base = { statusVersion: "v1", uploadId: "upload", state: "REVIEWED", datasetProfileRunId: "profile", reviewRevision: 2 };
describe("closed review status decoder", () => {
  it.each([base, { ...base, state: "QUALITY_HOLD" }, { statusVersion: "v1", uploadId: "upload", state: "REVIEW_REQUIRED" }])("copies supported observations", status => {
    expect(decodeReviewStatus(status, "upload")).toEqual(status); expect(decodeReviewStatus(status, "upload")).not.toBe(status);
  });
  it.each([null, [], { ...base, uploadId: "foreign" }, { ...base, statusVersion: "v2" }, { ...base, state: "READY" }, { ...base, reviewRevision: 0 },
    { ...base, reviewRevision: 1.5 }, { ...base, datasetProfileRunId: " " }, { ...base, private: "secret" },
    { ...base, state: "REVIEW_REQUIRED" }, { statusVersion: "v1", uploadId: "upload", state: "REVIEWED" }])("rejects malformed or mismatched observations", status => {
    expect(() => decodeReviewStatus(status, "upload")).toThrow("RESPONSE_INVALID");
  });
  it("rejects own and inherited accessors without invoking them", () => {
    const getter = vi.fn();
    const accessor = { ...base }; Object.defineProperty(accessor, "state", { get: getter });
    expect(() => decodeReviewStatus(accessor, "upload")).toThrow();
    const inherited = Object.create(Object.defineProperty({}, "state", { get: getter })); Object.assign(inherited, { statusVersion: "v1", uploadId: "upload" });
    expect(() => decodeReviewStatus(inherited, "upload")).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
});

const row = (i = 0): WorkbookWorksheet => ({ id: `w${i}`, name: "Same", index: i, excluded: false });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const result = (id: string) => ({ ok: true, status: { ...base, uploadId: id } });
describe("bounded, explicitly read-only workbook review scan", () => {
  it("reads only two statuses at once and skips excluded worksheets", async () => {
    const waiting: (() => void)[] = []; let active = 0, max = 0;
    const fetcher = vi.fn((url: string, init: RequestInit) => { active++; max = Math.max(max, active);
      expect(init.method).toBe("GET"); expect(init.body).toBeUndefined(); expect(init.cache).toBe("no-store");
      return new Promise<Response>(resolve => waiting.push(() => { active--; resolve(response(result(url.split('/').at(-2)!))); }));
    }); vi.stubGlobal("fetch", fetcher); const checked = vi.fn();
    const work = checkWorkbookReviews([row(), row(1), row(2), { ...row(3), excluded: true }], new AbortController().signal, checked);
    expect(fetcher).toHaveBeenCalledTimes(2); waiting.splice(0).forEach(release => release());
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3)); waiting.splice(0).forEach(release => release()); await work;
    expect(max).toBe(2); expect(checked).toHaveBeenCalledTimes(3);
  });
  it.each([401, 403, 404])("invalidates all work on HTTP %s and starts no later row", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, status))); const checked = vi.fn();
    await expect(checkWorkbookReviews([row(), row(1), row(2)], new AbortController().signal, checked)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2); expect(checked).not.toHaveBeenCalled();
  });
  it("marks malformed success or service failure unconfirmed without leaking content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...result('foreign'), private: "secret" })));
    const checked = vi.fn(); await checkWorkbookReviews([row()], new AbortController().signal, checked);
    expect(checked).toHaveBeenCalledWith("w0", { failed: true });
  });
  it("bounds a stalled worksheet and continues with other statuses", async () => {
    vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn((url: string) => url.includes('/w0/') ? new Promise(() => {}) : Promise.resolve(response(result('w1')))));
    const checked = vi.fn(); const work = checkWorkbookReviews([row(), row(1)], new AbortController().signal, checked);
    await vi.advanceTimersByTimeAsync(15_000); await work;
    expect(checked).toHaveBeenCalledWith("w0", { failed: true }); expect(checked).toHaveBeenCalledWith("w1", { status: { ...base, uploadId: "w1" } });
  });
  it("cancels stalled reads and drops late replies without polling", async () => {
    let release!: (r: Response) => void; vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
    const checked = vi.fn(), controller = new AbortController(); const work = checkWorkbookReviews([row(), row(1), row(2)], controller.signal, checked);
    const denied = expect(work).rejects.toThrow("REQUEST_CANCELLED"); controller.abort(); await denied;
    release(response(result('w1'))); await Promise.resolve(); expect(checked).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("enforces the full workbook deadline and stops queued work", async () => {
    vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const work = checkWorkbookReviews(Array.from({ length: 50 }, (_, i) => row(i)), new AbortController().signal, vi.fn());
    const denied = expect(work).rejects.toThrow("REQUEST_TIMED_OUT"); await vi.advanceTimersByTimeAsync(120_000); await denied;
    expect(vi.mocked(fetch).mock.calls.length).toBeLessThan(50);
  });
});
