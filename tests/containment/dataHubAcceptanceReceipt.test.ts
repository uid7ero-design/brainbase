import { describe, expect, it } from "vitest";
import { ARTIFACTS, D4D5Q_BLOB, FIXTURE_PREPARATION, RECEIPT_VERSION, SETUP_STORAGE, createAcceptanceReceipt } from "../../scripts/tests/helpers/dataHubAcceptanceReceipt.mjs";
const input = () => ({ candidateCommit: "a".repeat(40), finalCommit: "a".repeat(40), migrationBlob: D4D5Q_BLOB,
  buildId: "local_build-123", cleanWorktree: true, startedAt: "2026-10-13T00:00:00Z", completedAt: "2026-10-13T00:01:00Z",
  cleanup: { ownedDatabaseRemoved: true, loginFixtureRemoved: true, localListenerClosed: true },
  artifactHashes: Object.fromEntries(ARTIFACTS.map(name => [name, "b".repeat(64)])),
  evidence: { passed: true, productionTouched: false, transport: "Local Neon transport; real application and PostgreSQL",
    fixturePreparation: FIXTURE_PREPARATION, setupStorage: SETUP_STORAGE, fixtureLineageVerified: true, fixtureWorldCount: 3,
    checks: ["PRIVATE_DIAGNOSTIC_NOT_COPIED"] } });
describe("isolated acceptance receipts", () => {
  it("pins metadata and artifact hashes while preserving release limits and projecting away diagnostics", () => {
    const source = input(); const receipt = createAcceptanceReceipt({ ...source, releaseAuthorized: true, secret: "PRIVATE" });
    expect(receipt.status).toBe("passed"); expect(receipt.candidateCommit).toBe(source.candidateCommit);
    expect(receipt.migrationGitBlob).toBe(D4D5Q_BLOB); expect(receipt.artifactSha256).toEqual(source.artifactHashes);
    expect(receipt.releaseAuthorized).toBe(false); expect(receipt.productionTouched).toBe(false);
    expect(receipt.receiptVersion).toBe(RECEIPT_VERSION); expect(receipt.setupStorage).toBe(SETUP_STORAGE);
    expect(receipt.validation.fixtureLineageVerified).toBe(true); expect(receipt.validation.fixtureWorldCount).toBe(3);
    expect(receipt.proofLimits).toHaveLength(4); expect(JSON.stringify(receipt)).not.toContain("PRIVATE");
    source.artifactHashes["evidence.json"] = "c".repeat(64);
    expect(receipt.artifactSha256["evidence.json"]).toBe("b".repeat(64));
  });
  it.each(["commit", "changed-head", "dirty", "migration", "build", "timestamp", "time-order", "failed", "production", "hosted", "fixture", "storage", "lineage", "worlds", "checks", "cleanup", "hash", "missing-artifact", "extra-artifact"])
    ("rejects incomplete or mismatched %s evidence", kind => {
      const source = input();
      if (kind === "commit") source.candidateCommit = "invalid";
      if (kind === "changed-head") source.finalCommit = "c".repeat(40);
      if (kind === "dirty") source.cleanWorktree = false;
      if (kind === "migration") source.migrationBlob = "d".repeat(40);
      if (kind === "build") source.buildId = "../../private";
      if (kind === "timestamp") source.completedAt = "private";
      if (kind === "time-order") source.completedAt = "2026-10-12T00:00:00Z";
      if (kind === "failed") source.evidence.passed = false;
      if (kind === "production") source.evidence.productionTouched = true;
      if (kind === "hosted") source.evidence.transport = "hosted";
      if (kind === "fixture") source.evidence.fixturePreparation = "pre-profiled";
      if (kind === "storage") source.evidence.setupStorage = "hosted";
      if (kind === "lineage") source.evidence.fixtureLineageVerified = false;
      if (kind === "worlds") source.evidence.fixtureWorldCount = 1;
      if (kind === "checks") source.evidence.checks = [];
      if (kind === "cleanup") source.cleanup.localListenerClosed = false;
      if (kind === "hash") source.artifactHashes["evidence.json"] = "private";
      if (kind === "missing-artifact") delete source.artifactHashes["evidence.json"];
      if (kind === "extra-artifact") source.artifactHashes["private.json"] = "b".repeat(64);
      expect(() => createAcceptanceReceipt(source)).toThrow("ACCEPTANCE_RECEIPT_INVALID");
    });
});
