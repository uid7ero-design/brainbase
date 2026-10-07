import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ transaction: vi.fn(), actor: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: db.transaction } }));
import { saveAnalysisReview } from "@/lib/data-hub/analysisExecution/saveAnalysisReview";
const scope = { organisationId: "org", uploadId: "upload", actorId: "actor" };
const decisions = { reviewVersion: "v1", datasetProfileRunId: "profile", semanticChoices: [], qualityDecisions: [] };
beforeEach(() => {
  vi.resetAllMocks();
  db.transaction.mockImplementation(async (callback) => callback({ user: { findFirst: db.actor } }));
});
describe("D4D5T trusted review save boundary", () => {
  it.each(["organisationId", "uploadId", "actorId"])("rejects blank %s before database access", async (key) => {
    expect(await saveAnalysisReview({ ...scope, [key]: " " }, decisions)).toMatchObject({ ok: false });
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it.each(["reviewedById", "revision", "reviewedAt", "state"])("rejects injected %s before database access", async (key) => {
    expect(await saveAnalysisReview(scope, { ...decisions, [key]: "injected" }))
      .toEqual({ ok: false, code: "REVIEW_INPUT_INVALID" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it("requires active same-organization reviewer roles inside a serializable transaction", async () => {
    db.actor.mockResolvedValue(null);
    expect(await saveAnalysisReview(scope, decisions)).toEqual({ ok: false, code: "REVIEW_ACTOR_INVALID" });
    expect(db.actor).toHaveBeenCalledWith({ where: { id: "actor", organisation_id: "org", status: "ACTIVE",
      role: { in: ["SUPER_ADMIN", "ADMIN", "MANAGER"] } }, select: { id: true } });
    expect(db.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });
  it("rejects an unexpected returned actor identity", async () => {
    db.actor.mockResolvedValue({ id: "other" });
    expect(await saveAnalysisReview(scope, decisions)).toEqual({ ok: false, code: "REVIEW_ACTOR_INVALID" });
  });
  it("closes database and serialization exceptions without automatic duplicate retries", async () => {
    db.transaction.mockRejectedValue(new Error("private detail"));
    expect(await saveAnalysisReview(scope, decisions)).toEqual({ ok: false, code: "REVIEW_SAVE_FAILED" });
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});
