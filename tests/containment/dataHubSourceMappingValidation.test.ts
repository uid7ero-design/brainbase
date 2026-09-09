import { describe, it, expect } from "vitest";
import { listSourceSystems, createSourceSystem } from "@/lib/data-hub/sourceMapping/sourceSystems";
import { listSourceMappings, createSourceMapping } from "@/lib/data-hub/sourceMapping/sourceMappings";
import { createMappingVersion } from "@/lib/data-hub/sourceMapping/mappingVersions";
import { MAX_LIST_LIMIT, NAME_MAX_LENGTH } from "@/lib/data-hub/sourceMapping/types";

// Data Hub 5B.2 — behavioral tests for the input-validation branches that
// return BEFORE any database call, so these run safely against
// tests/setupEnv.ts's placeholder DATABASE_URL with no real Postgres
// connection required (the same discipline already applies to every
// sibling *.test.ts in this repo — real constraint/concurrency proofs
// live in the disposable-Postgres integration suite instead).

describe("pagination validation — no DB call required for the invalid branch", () => {
  it("T17/INVALID_LIMIT — zero, negative, non-integer, and over-max limits are all rejected", async () => {
    for (const bad of [0, -1, 1.5, MAX_LIST_LIMIT + 1, Number.NaN]) {
      const r = await listSourceSystems("org-x", { limit: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("INVALID_LIMIT");
    }
  });

  it("INVALID_CURSOR — a malformed cursor is rejected before any query", async () => {
    const r = await listSourceSystems("org-x", { cursor: "not-valid-base64url-json" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_CURSOR");

    const r2 = await listSourceMappings("org-x", { cursor: "also-not-valid" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("INVALID_CURSOR");
  });
});

describe("create-input validation — rejected before any database write", () => {
  it("VALIDATION_ERROR — blank/whitespace-only/oversized SourceSystem name rejected", async () => {
    const blank = await createSourceSystem({ organisationId: "org-x", userId: "user-x" }, { name: "   " });
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.code).toBe("VALIDATION_ERROR");

    const oversized = await createSourceSystem({ organisationId: "org-x", userId: "user-x" }, { name: "x".repeat(NAME_MAX_LENGTH + 1) });
    expect(oversized.ok).toBe(false);

    const wrongType = await createSourceSystem({ organisationId: "org-x", userId: "user-x" }, { name: 12345 });
    expect(wrongType.ok).toBe(false);
  });

  it("VALIDATION_ERROR — SourceMapping create requires both a valid name and a string sourceSystemId", async () => {
    const missingParent = await createSourceMapping({ organisationId: "org-x", userId: "user-x" }, { name: "Valid Name" });
    expect(missingParent.ok).toBe(false);
    if (!missingParent.ok) expect(missingParent.code).toBe("VALIDATION_ERROR");

    const numericParent = await createSourceMapping({ organisationId: "org-x", userId: "user-x" }, { sourceSystemId: 12345, name: "Valid Name" });
    expect(numericParent.ok).toBe(false);
  });

  it("VALIDATION_ERROR — MappingVersion create rejects an invalid mapping document before touching the DB", async () => {
    const r = await createMappingVersion({ organisationId: "org-x", userId: "user-x" }, { sourceMappingId: "sm-x", mappingDocument: { not: "valid" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VALIDATION_ERROR");

    const r2 = await createMappingVersion({ organisationId: "org-x", userId: "user-x" }, { mappingDocument: { fields: { report_date: "x" } } });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("VALIDATION_ERROR");
  });
});
