import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// Data Hub 5A.2K.1 — real disposable-Postgres integration harness for the
// dark canonical DATA_HUB worksheet confirmation + illegal-dumping
// transactional importer service (confirmWorksheet.ts).
//
// Run ONLY via scripts/tests/verify-confirm-worksheet.sh, which starts a
// disposable postgres:16-alpine Docker container, applies a bootstrap
// schema (organisations/users/uploads/illegal_dumping) plus the exact
// scripts/create-import-batches.sql migration, exports DATABASE_URL to
// point at that container, then runs `npx vitest run --config
// vitest.integration.config.ts scripts/tests/confirmWorksheet.integration.test.ts`.
// NEVER run this file directly against any other DATABASE_URL — the guard
// rail below refuses to start if DATABASE_URL is unset or looks like a
// real hosted/Neon/production endpoint. Mirrors
// scripts/tests/inspectWorksheets.integration.test.ts's own harness
// pattern exactly (same guard rail, same InMemoryFileStore override).
//
// This suite exercises the REAL, unmodified production
// lib/data-hub/importBatch/confirmWorksheet.ts against a REAL Postgres
// instance — never a duplicated/parallel copy of its SQL/Prisma calls.
// Only the storage adapter is overridden (InMemoryFileStore, zero
// network) — never a live Vercel Blob call. This is the required-by-spec
// home for all 10 falsification categories (Sections 28-37 of the
// governing directive): wrong-tenant, LEGACY-lineage, status matrix,
// parent-state, storage-locator authority, hash mismatch,
// worksheet-identity-by-id-never-name, transaction-order, atomicity, and
// concurrency-claim — each proven as a real mutation/scenario against the
// real service and real DB, never a source-text assertion.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "confirmWorksheet.integration.test.ts requires DATABASE_URL to point at a disposable Postgres " +
      "container (see scripts/tests/verify-confirm-worksheet.sh). Refusing to run without it."
  );
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error(
    "Refusing to run the Data Hub integration suite against a DATABASE_URL that looks like a real " +
      "hosted/Production database. This suite may ONLY run against a local disposable Docker container."
  );
}
if (!/^(localhost|127\.0\.0\.1)/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, "http://")).hostname)) {
  throw new Error("Refusing to run the Data Hub integration suite against a non-localhost DATABASE_URL host.");
}

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

// 5A.2K.1-R addition: the shared production Prisma singleton
// (lib/prisma.ts), imported the SAME way confirmWorksheet.ts itself
// imports it (`../../prisma` from lib/data-hub/importBatch/ resolves to
// this exact module). Used ONLY by the zero-row-claim regression below to
// spy on the service's own Step 1 eligibility read and inject a real,
// deterministic concurrent state transition in the gap between that read
// and the transaction's own conditional claim — never to fake/mock the
// claim result itself.
let productionPrisma: typeof import("@/lib/prisma").prisma;

vi.doMock("@/lib/data-hub/importBatch/compositionRoot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data-hub/importBatch/compositionRoot")>();
  return {
    ...actual,
    createImportBatchStorage: () => sharedStore,
  };
});

let sharedStore: InstanceType<typeof import("@/lib/data-hub/storage/inMemoryFileStore").InMemoryFileStore>;
let confirmDataHubWorksheet: typeof import("@/lib/data-hub/importBatch/confirmWorksheet").confirmDataHubWorksheet;
let buildImportBatchKey: typeof import("@/lib/data-hub/storage/rawFileStore").buildImportBatchKey;

beforeAll(async () => {
  const { InMemoryFileStore } = await import("@/lib/data-hub/storage/inMemoryFileStore");
  sharedStore = new InMemoryFileStore();
  ({ confirmDataHubWorksheet } = await import("@/lib/data-hub/importBatch/confirmWorksheet"));
  ({ buildImportBatchKey } = await import("@/lib/data-hub/storage/rawFileStore"));
  ({ prisma: productionPrisma } = await import("@/lib/prisma"));

  await prisma.$executeRawUnsafe(`
    INSERT INTO organisations (id, name, slug) VALUES
      ('org-a', 'Org A', 'org-a'),
      ('org-b', 'Org B', 'org-b')
    ON CONFLICT (id) DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users (id, organisation_id, username, name) VALUES
      ('user-a1', 'org-a', 'user-a1', 'User A1'),
      ('user-a2', 'org-a', 'user-a2', 'User A2'),
      ('user-b1', 'org-b', 'user-b1', 'User B1')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Full row-level reset between tests — cheaper and less brittle than a
  // fresh container per test, and every table here is scoped to this
  // disposable container only.
  await prisma.$executeRawUnsafe(`DELETE FROM illegal_dumping`);
  await prisma.$executeRawUnsafe(`DELETE FROM uploads`);
  await prisma.$executeRawUnsafe(`DELETE FROM import_batches`);
});

function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const VALID_CSV = Buffer.from(
  "report_date,location,waste_type,severity,status\n" +
    "2024-01-15,Main St,tyres,high,open\n" +
    "2024-02-01,Oak Ave,furniture,low,resolved\n"
);

async function seedReadyBatch(
  organisationId: string,
  body: Buffer,
  overrides: Partial<{
    contentType: "csv" | "xlsx" | "xls";
    status: string;
    deletedAt: Date | null;
    sha256: string;
    uploadedBy: string | null;
  }> = {}
) {
  const id = randomUUID();
  const storageKey = buildImportBatchKey(organisationId, id);
  await prisma.importBatch.create({
    data: {
      id,
      organisation_id: organisationId,
      uploaded_by: overrides.uploadedBy ?? null,
      original_filename: `fixture.${overrides.contentType ?? "csv"}`,
      content_type: overrides.contentType ?? "csv",
      size_bytes: body.byteLength,
      sha256: overrides.sha256 ?? sha256Of(body),
      storage_provider: "vercel-blob-private",
      storage_key: storageKey,
      status: overrides.status ?? "READY",
      deleted_at: overrides.deletedAt ?? null,
    },
  });
  await sharedStore.put(storageKey, body);
  return { id, storageKey };
}

async function seedWorksheet(
  organisationId: string,
  importBatchId: string,
  overrides: Partial<{
    worksheetIndex: number;
    canonicalStatus: string;
    lineageKind: "DATA_HUB" | "LEGACY";
    worksheetName: string;
  }> = {}
) {
  const lineageKind = overrides.lineageKind ?? "DATA_HUB";
  if (lineageKind === "LEGACY") {
    return prisma.upload.create({
      data: {
        organisation_id: organisationId,
        original_name: "legacy-row",
        stored_path: "legacy:whatever",
        mimetype: "text/csv",
        size_bytes: 0,
        lineage_kind: "LEGACY",
      },
    });
  }
  return prisma.upload.create({
    data: {
      organisation_id: organisationId,
      original_name: "worksheet-row",
      stored_path: `datahub-worksheet:${importBatchId}:${overrides.worksheetIndex ?? 0}`,
      mimetype: "text/csv",
      size_bytes: 0,
      import_batch_id: importBatchId,
      worksheet_index: overrides.worksheetIndex ?? 0,
      worksheet_name: overrides.worksheetName ?? "CSV",
      worksheet_visibility: "visible",
      worksheet_is_empty: false,
      lineage_kind: "DATA_HUB",
      canonical_status: overrides.canonicalStatus ?? "AWAITING_CONFIRMATION",
    },
  });
}

async function domainRowsFor(organisationId: string, uploadId: string) {
  return prisma.illegalDumping.findMany({ where: { organisation_id: organisationId, upload_id: uploadId } });
}
async function worksheetById(id: string) {
  return prisma.upload.findUnique({ where: { id } });
}

// ─── 1. Wrong-tenant falsification ─────────────────────────────────────

describe("integration — wrong-tenant falsification", () => {
  it("confirming org-a's worksheet as org-b -> WORKSHEET_NOT_FOUND, zero domain rows, worksheet status untouched", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    const worksheet = await seedWorksheet("org-a", batchId);

    const result = await confirmDataHubWorksheet({ organisationId: "org-b", worksheetUploadId: worksheet.id, confirmedBy: "user-b1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });

    const rows = await domainRowsFor("org-a", worksheet.id);
    expect(rows).toHaveLength(0);
    const refreshed = await worksheetById(worksheet.id);
    expect(refreshed?.canonical_status).toBe("AWAITING_CONFIRMATION");
    // 5A.2L — a cross-tenant attempt cannot read, write, or otherwise
    // influence actor attribution on org-a's own worksheet.
    expect(refreshed?.confirmed_by).toBeNull();
    expect(refreshed?.confirmed_at).toBeNull();
  });
});

// ─── 2. LEGACY-lineage falsification ────────────────────────────────────

describe("integration — LEGACY-lineage falsification", () => {
  it("a LEGACY-lineage upload id -> WORKSHEET_NOT_FOUND, never treated as a DATA_HUB worksheet", async () => {
    const legacyRow = await seedWorksheet("org-a", "irrelevant", { lineageKind: "LEGACY" });
    const result = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: legacyRow.id, confirmedBy: "user-a1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
  });
});

// ─── 3. Status-matrix falsification ─────────────────────────────────────

describe("integration — canonical_status matrix", () => {
  for (const status of ["INELIGIBLE", "SKIPPED"]) {
    it(`${status} -> WORKSHEET_NOT_ELIGIBLE, zero domain rows, status unchanged`, async () => {
      const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
      const worksheet = await seedWorksheet("org-a", batchId, { canonicalStatus: status });
      const result = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a1" });
      expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
      const refreshed = await worksheetById(worksheet.id);
      expect(refreshed?.canonical_status).toBe(status);
      expect(await domainRowsFor("org-a", worksheet.id)).toHaveLength(0);
      // 5A.2L — a rejected first attempt (never eligible) leaves both NULL.
      expect(refreshed?.confirmed_by).toBeNull();
      expect(refreshed?.confirmed_at).toBeNull();
    });
  }

  it("IMPORTED -> idempotent success, zero NEW domain rows, no re-attempt, and a pre-existing (pre-5A.2L-shaped) IMPORTED row with no recorded actor is NOT retroactively backfilled by a later confirm call", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    const worksheet = await seedWorksheet("org-a", batchId, { canonicalStatus: "IMPORTED" });
    const beforeRow = await worksheetById(worksheet.id);
    expect(beforeRow?.confirmed_by).toBeNull(); // seeded directly, never confirmed via the service
    const result = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a1" });
    expect(result).toEqual({ ok: true, alreadyImported: true, worksheetUploadId: worksheet.id });
    expect(await domainRowsFor("org-a", worksheet.id)).toHaveLength(0);
    const afterRow = await worksheetById(worksheet.id);
    expect(afterRow?.confirmed_by).toBeNull();
    expect(afterRow?.confirmed_at).toBeNull();
  });
});

// ─── 4. Parent-batch-state falsification ────────────────────────────────

describe("integration — parent ImportBatch readiness gate", () => {
  it("parent batch status PROCESSING (not READY) -> BATCH_NOT_READY, zero domain rows", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV, { status: "PROCESSING" });
    const worksheet = await seedWorksheet("org-a", batchId);
    const result = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a1" });
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_READY" });
    expect(await domainRowsFor("org-a", worksheet.id)).toHaveLength(0);
    const refreshed = await worksheetById(worksheet.id);
    expect(refreshed?.confirmed_by).toBeNull();
    expect(refreshed?.confirmed_at).toBeNull();
  });

  it("parent batch tombstoned (deleted_at set) -> WORKSHEET_NOT_FOUND, never BATCH_NOT_READY", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV, { deletedAt: new Date() });
    const worksheet = await seedWorksheet("org-a", batchId);
    const result = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a1" });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
    const refreshed = await worksheetById(worksheet.id);
    expect(refreshed?.confirmed_by).toBeNull();
    expect(refreshed?.confirmed_at).toBeNull();
  });
});

// ─── 5. Storage-locator-authority falsification ─────────────────────────

describe("integration — storage locator authority (never caller-controlled)", () => {
  it("the service reads from the ImportBatch's OWN persisted storage_key, computed server-side — bytes placed at any other key are never consulted", async () => {
    const { id: batchId, storageKey } = await seedReadyBatch("org-a", VALID_CSV);
    // Plant a DIFFERENT, malicious payload at an attacker-chosen key that
    // is NOT the batch's real storage_key, to prove the service could not
    // possibly be redirected to it (it has no code path that accepts a
    // storage key from anywhere but buildImportBatchKey(organisationId,
    // worksheet.import_batch_id) — this test would only fail if some
    // future change introduced a caller-influenced storage lookup).
    await sharedStore.put("org_org-a/importbatch_attacker-planted-key", Buffer.from("malicious,payload\n"));
    const worksheet = await seedWorksheet("org-a", batchId);

    const result = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a1" });
    expect(result.ok).toBe(true);
    expect(storageKey).not.toBe("org_org-a/importbatch_attacker-planted-key");
    const rows = await domainRowsFor("org-a", worksheet.id);
    expect(rows.map((r) => r.location).sort()).toEqual(["Main St", "Oak Ave"]);
  });
});

// ─── 6. Hash-mismatch falsification ──────────────────────────────────────

describe("integration — mandatory SHA-256 re-verification", () => {
  it("storage bytes silently swapped after batch creation (real bit-rot/tamper simulation) -> STORAGE_INTEGRITY_MISMATCH, zero domain rows, worksheet untouched", async () => {
    const { id: batchId, storageKey } = await seedReadyBatch("org-a", VALID_CSV);
    const worksheet = await seedWorksheet("org-a", batchId);

    // Simulate storage-side tampering/corruption: overwrite the object at
    // the SAME real key with different bytes than the batch's persisted
    // sha256 was computed from.
    await sharedStore.delete(storageKey);
    await sharedStore.put(storageKey, Buffer.from("report_date,location,waste_type\n2099-01-01,Tampered,other\n"));

    const result = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a1" });
    expect(result).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
    expect(await domainRowsFor("org-a", worksheet.id)).toHaveLength(0);
    const refreshed = await worksheetById(worksheet.id);
    expect(refreshed?.canonical_status).toBe("AWAITING_CONFIRMATION");
    expect(refreshed?.confirmed_by).toBeNull();
    expect(refreshed?.confirmed_at).toBeNull();
  });
});

// ─── 7. Worksheet-identity falsification (id, never name) ──────────────

describe("integration — worksheet identity resolves strictly by primary-key id, never by worksheet_name", () => {
  it("two worksheets sharing the SAME worksheet_name on the same batch -> confirming one specific id only ever affects that row", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    const worksheetOne = await seedWorksheet("org-a", batchId, { worksheetIndex: 0, worksheetName: "Sheet" });
    const worksheetTwo = await seedWorksheet("org-a", batchId, { worksheetIndex: 1, worksheetName: "Sheet" });

    const result = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheetOne.id, confirmedBy: "user-a1" });
    expect(result.ok).toBe(true);

    const refreshedOne = await worksheetById(worksheetOne.id);
    const refreshedTwo = await worksheetById(worksheetTwo.id);
    expect(refreshedOne?.canonical_status).toBe("IMPORTED");
    // The identically-named sibling at a different index/id is completely
    // untouched — name was never consulted for routing.
    expect(refreshedTwo?.canonical_status).toBe("AWAITING_CONFIRMATION");
    expect(await domainRowsFor("org-a", worksheetOne.id)).toHaveLength(2);
    expect(await domainRowsFor("org-a", worksheetTwo.id)).toHaveLength(0);
  });
});

// ─── 8/9. Transaction-order + atomicity falsification ───────────────────

describe("integration — transaction-order and atomicity", () => {
  it("a domain-row CHECK violation mid-transaction rolls back the claim TOGETHER with the insert — worksheet remains AWAITING_CONFIRMATION, zero domain rows, retry succeeds afterward", async () => {
    // illegal_dumping_cost_estimate_nonneg_check (test-only fixture
    // constraint, added by verify-confirm-worksheet.sh's bootstrap) is
    // violated by a negative cost_estimate — a value the mapper itself
    // does not reject (it only requires cost_estimate to be a valid
    // float-or-null), so this forces a genuine mid-transaction Postgres
    // error on an otherwise mapper-valid row.
    const csv = Buffer.from(
      "report_date,location,waste_type,cost_estimate\n2024-01-01,Main St,tyres,-50\n"
    );
    const { id: batchId } = await seedReadyBatch("org-a", csv);
    const worksheet = await seedWorksheet("org-a", batchId);

    await expect(
      confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a1" })
    ).rejects.toThrow();

    // Rolled back: the claim UPDATE (worksheet -> IMPORTED) is undone
    // together with the failed domain INSERT — proving they share one
    // transaction, in the required order (claim first, domain write
    // second, both-or-neither committed). 5A.2L: confirmed_by/confirmed_at
    // are set in that SAME claim UPDATE, so a rollback must undo them too
    // — a rolled-back attempt must never leave false attribution behind.
    const refreshed = await worksheetById(worksheet.id);
    expect(refreshed?.canonical_status).toBe("AWAITING_CONFIRMATION");
    expect(await domainRowsFor("org-a", worksheet.id)).toHaveLength(0);
    expect(refreshed?.confirmed_by).toBeNull();
    expect(refreshed?.confirmed_at).toBeNull();

    // A subsequent retry with valid data succeeds normally — the failed
    // attempt left the worksheet in a clean, retryable state.
    const validCsv = Buffer.from("report_date,location,waste_type\n2024-01-01,Main St,tyres\n");
    const { id: batchId2 } = await seedReadyBatch("org-a", validCsv);
    await prisma.upload.update({
      where: { id: worksheet.id },
      data: { import_batch_id: batchId2 },
    });
    const retryResult = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a2" });
    expect(retryResult).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1 });
    // The SUCCESSFUL retry (a genuinely new, distinct confirming actor)
    // correctly records attribution — proving the earlier rollback didn't
    // leave the row in a state that blocks a real subsequent write.
    const afterRetry = await worksheetById(worksheet.id);
    expect(afterRetry?.confirmed_by).toBe("user-a2");
    expect(afterRetry?.confirmed_at).toBeInstanceOf(Date);
  });
});

// ─── 10. Concurrency-claim falsification ─────────────────────────────────

describe("integration — concurrent confirmation attempts", () => {
  it("two simultaneous confirmDataHubWorksheet calls against the SAME worksheet, by two DIFFERENT authenticated managers, converge to exactly one import AND exactly one persisted actor — no mixed/duplicate attribution", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    const worksheet = await seedWorksheet("org-a", batchId);

    const [r1, r2] = await Promise.all([
      confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a1" }),
      confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a2" }),
    ]);

    // Exactly one of the two attempts actually performed the import;
    // the other observes the already-IMPORTED outcome (idempotent
    // success) — never two conflicting/duplicate writes, never a raw
    // unhandled DB error surfaced to either caller.
    const outcomes = [r1, r2];
    const winners = outcomes.filter((r) => r.ok && !r.alreadyImported);
    const losers = outcomes.filter((r) => r.ok && r.alreadyImported);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const rows = await domainRowsFor("org-a", worksheet.id);
    expect(rows).toHaveLength(2); // VALID_CSV has exactly 2 data rows — never duplicated to 4.
    const refreshed = await worksheetById(worksheet.id);
    expect(refreshed?.canonical_status).toBe("IMPORTED");
    // 5A.2L — exactly ONE of the two candidate actors is persisted, and it
    // must be user-a1 OR user-a2, never both/neither/some other value —
    // proving the loser's own confirmedBy never reaches the row.
    expect(["user-a1", "user-a2"]).toContain(refreshed?.confirmed_by);
    expect(refreshed?.confirmed_at).toBeInstanceOf(Date);
  });
});

// ─── Bonus: sequential idempotency ───────────────────────────────────────

describe("integration — sequential idempotency", () => {
  it("confirming an already-IMPORTED worksheet a second time is a clean idempotent success, never a duplicate insert, and NEVER overwrites the original confirmed_by/confirmed_at — a second (different) manager replaying the call must not become the recorded confirmer", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    const worksheet = await seedWorksheet("org-a", batchId);

    const first = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a1" });
    expect(first).toMatchObject({ ok: true, alreadyImported: false, importedRows: 2 });
    const afterFirst = await worksheetById(worksheet.id);
    expect(afterFirst?.confirmed_by).toBe("user-a1");
    const originalConfirmedAt = afterFirst?.confirmed_at;
    expect(originalConfirmedAt).toBeInstanceOf(Date);

    // Deliberately a DIFFERENT manager on the repeat call — this is the
    // hard invariant: a replay by someone else must not become the
    // recorded confirmer, and must not refresh the timestamp either.
    const second = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a2" });
    expect(second).toEqual({ ok: true, alreadyImported: true, worksheetUploadId: worksheet.id });

    expect(await domainRowsFor("org-a", worksheet.id)).toHaveLength(2);
    const afterSecond = await worksheetById(worksheet.id);
    expect(afterSecond?.confirmed_by).toBe("user-a1"); // unchanged — NOT user-a2
    expect(afterSecond?.confirmed_at?.getTime()).toBe(originalConfirmedAt?.getTime()); // unchanged
  });
});

// ─── 11. Zero-row-claim regression (5A.2K.1-R) ───────────────────────────
//
// Independent adversarial review of the original 5A.2K.1 candidate found
// that the transaction's zero-row-claim early return (claim.count === 0 ->
// return early, never reach tx.illegalDumping.createMany) was correct in
// production source, but UNCOVERED by any permanent test: none of the
// tests above ever forces claim.count to genuinely be zero from a state
// that was AWAITING_CONFIRMATION at Step 1's read. This test constructs
// that exact TOCTOU deterministically (not probabilistically): it spies on
// the REAL production Prisma singleton's upload.findFirst — the exact call
// confirmWorksheet.ts's own Step 1 makes — lets the real read return
// AWAITING_CONFIRMATION as normal, then, still inside the mock, performs a
// real concurrent-caller-shaped UPDATE flipping the worksheet to SKIPPED
// BEFORE returning control to confirmWorksheet.ts. By the time execution
// reaches the transaction's own conditional claim UPDATE (WHERE
// canonical_status = 'AWAITING_CONFIRMATION'), the row is genuinely
// SKIPPED in the real database -- the claim genuinely affects zero rows,
// for a real reason, not a mocked one.
describe("integration — zero-row-claim regression (5A.2K.1-R, load-bearing)", () => {
  it("worksheet transitions AWAITING_CONFIRMATION -> SKIPPED strictly between Step 1's read and the transaction's claim -> claim genuinely affects zero rows, domain createMany never executes, zero domain rows persist, worksheet remains SKIPPED (never reverted, never IMPORTED), and the outcome is the intended WORKSHEET_NOT_ELIGIBLE loser semantics — never a false success", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    const worksheet = await seedWorksheet("org-a", batchId);

    const originalFindFirst = productionPrisma.upload.findFirst.bind(productionPrisma.upload);
    const findFirstSpy = vi
      .spyOn(productionPrisma.upload, "findFirst")
      .mockImplementationOnce(async (args: Parameters<typeof originalFindFirst>[0]) => {
        const real = await originalFindFirst(args);
        // The injected race: a concurrent caller (a separate confirmation
        // attempt, an admin skip action, whatever the real cause) commits a
        // real state transition here, strictly between the read this mock
        // wraps and the transaction confirmDataHubWorksheet is about to
        // open. Uses the test's OWN prisma client (a distinct connection),
        // exactly as a genuinely concurrent process would.
        await prisma.$executeRawUnsafe(`UPDATE uploads SET canonical_status = 'SKIPPED' WHERE id = $1`, worksheet.id);
        return real;
      });

    let result: Awaited<ReturnType<typeof confirmDataHubWorksheet>>;
    try {
      result = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a1" });
    } finally {
      findFirstSpy.mockRestore();
    }

    // Intended loser semantics: WORKSHEET_NOT_ELIGIBLE, never a false
    // success. (currentStatus inside the transaction is 'SKIPPED', not
    // 'IMPORTED', so this is NOT the idempotent-success branch either.)
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });

    // The real-DB proof: domain createMany never executed (zero rows),
    // and the worksheet was never reverted or force-advanced by this
    // losing attempt -- it stays exactly SKIPPED, proving the claim
    // predicate (canonical_status: 'AWAITING_CONFIRMATION') genuinely did
    // not match and no domain write occurred as a side effect.
    expect(await domainRowsFor("org-a", worksheet.id)).toHaveLength(0);
    const refreshed = await worksheetById(worksheet.id);
    expect(refreshed?.canonical_status).toBe("SKIPPED");
    // 5A.2L — a genuine zero-row claim (the exact TOCTOU above) must never
    // record the losing attempt's confirmedBy/timestamp on a row it never
    // actually claimed. The UPDATE that would have set these affected zero
    // rows, so both remain exactly as before: NULL.
    expect(refreshed?.confirmed_by).toBeNull();
    expect(refreshed?.confirmed_at).toBeNull();
  });
});

// ─── 12. 100,000-row boundary reliability (5A.2K.1-R) ────────────────────
//
// Independent adversarial review found Prisma's default 5000ms
// interactive-transaction timeout fails well within the documented
// CSV_ONLY_LIMITS.maxSelectedWorksheetRows (100,000-row) accepted
// contract (empirically ~35,000-45,000 rows onward, always by 100,000).
// confirmWorksheet.ts's Step 8 transaction now passes an explicit,
// empirically-derived timeout (see the ADR's Section 23 for the
// measurement record: 3 real-Postgres runs at 100,000 rows, ~8.2-8.5s
// each). This is the permanent proof that the documented maximum accepted
// workload actually completes: real decode, real mapping, real single
// createMany, real commit, exactly 100,000 persisted rows, zero
// duplicates, worksheet reaches IMPORTED, no transaction-timeout
// exception. Takes several seconds against real Postgres -- this
// integration suite is manually-run only (never part of the blocking
// `npm test` CI suite; see this file's own header comment and
// vitest.integration.config.ts), so this cost is acceptable here.
describe("integration — 100,000-row boundary reliability (5A.2K.1-R)", () => {
  it("a CSV at the documented 100,000-data-row ceiling (header row not counted, per csvOnlyDecoder.ts) imports completely: exactly 100,000 rows persisted, zero duplicates, worksheet IMPORTED, no timeout", async () => {
    const rows = 100_000;
    const parts: string[] = ["report_date,location,waste_type\n"];
    for (let i = 0; i < rows; i++) {
      parts.push(`2024-01-15,Main St ${i},tyres\n`);
    }
    const csv = Buffer.from(parts.join(""));

    const { id: batchId } = await seedReadyBatch("org-a", csv);
    const worksheet = await seedWorksheet("org-a", batchId);

    const result = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a1" });

    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: rows });
    const persistedCount = await prisma.illegalDumping.count({
      where: { organisation_id: "org-a", upload_id: worksheet.id },
    });
    expect(persistedCount).toBe(rows);
    const refreshed = await worksheetById(worksheet.id);
    expect(refreshed?.canonical_status).toBe("IMPORTED");
  }, 60_000);
});

// ─── 13. 5A.2L — confirmation-actor attribution (success path) ──────────

describe("integration — 5A.2L confirmation-actor attribution — success path", () => {
  it("a successful first confirmation durably stores confirmed_by (the caller's own confirmedBy) and a real server-generated confirmed_at, in the SAME atomic claim as the IMPORTED transition", async () => {
    const before = new Date();
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    const worksheet = await seedWorksheet("org-a", batchId);

    const result = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: 2 });
    const after = new Date();

    const refreshed = await worksheetById(worksheet.id);
    expect(refreshed?.canonical_status).toBe("IMPORTED");
    expect(refreshed?.confirmed_by).toBe("user-a1");
    expect(refreshed?.confirmed_at).toBeInstanceOf(Date);
    // Server-generated, bounded by the actual test execution window — not
    // a client-supplied value, not the upload/inspection time (both of
    // which predate `before` here since the batch/worksheet were seeded
    // before this call).
    expect(refreshed!.confirmed_at!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(refreshed!.confirmed_at!.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("uploader and confirmer are independent, distinct actor references — confirming does not alter the parent batch's own uploaded_by lineage, and a worksheet confirmed by one user while its batch was uploaded by a different user preserves both independently", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV, { uploadedBy: "user-a2" });
    const worksheet = await seedWorksheet("org-a", batchId);

    const result = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-a1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false });

    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    const refreshed = await worksheetById(worksheet.id);
    expect(batch?.uploaded_by).toBe("user-a2"); // unchanged by confirmation
    expect(refreshed?.confirmed_by).toBe("user-a1"); // distinct actor, correctly recorded
    expect(batch?.uploaded_by).not.toBe(refreshed?.confirmed_by);
  });

  it("deleting the user who confirmed an import does NOT fail (ON DELETE SET NULL on confirmed_by) and does NOT lose the historical confirmed_at timestamp — the confirmation EVENT survives even when the specific actor identity is later deleted", async () => {
    // Real-Postgres proof of a genuine finding surfaced by this slice's own
    // migration-safety testing: a naive "confirmed_by/confirmed_at NULL
    // together or NOT NULL together" CHECK constraint would make this
    // DELETE fail outright, because the FK's ON DELETE SET NULL action
    // nulls ONLY confirmed_by, not confirmed_at, in the same statement.
    // uploads_confirmation_actor_coherence_check is deliberately asymmetric
    // to allow exactly this state (confirmed_at survives, confirmed_by
    // nulled) — see scripts/create-import-batches.sql for the full
    // rationale.
    // Raw SQL (not prisma.user.create), matching this file's own beforeAll
    // seeding pattern — the disposable bootstrap `users` table intentionally
    // reproduces only the columns this harness needs, not the full
    // production User model.
    await prisma.$executeRawUnsafe(
      `INSERT INTO users (id, organisation_id, username, name) VALUES ('user-ephemeral', 'org-a', 'user-ephemeral', 'Ephemeral User')`
    );
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    const worksheet = await seedWorksheet("org-a", batchId);
    const result = await confirmDataHubWorksheet({ organisationId: "org-a", worksheetUploadId: worksheet.id, confirmedBy: "user-ephemeral" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false });

    const beforeDelete = await worksheetById(worksheet.id);
    expect(beforeDelete?.confirmed_by).toBe("user-ephemeral");
    const originalConfirmedAt = beforeDelete?.confirmed_at;
    expect(originalConfirmedAt).toBeInstanceOf(Date);

    // Must not throw — a real FK/CHECK constraint violation would reject
    // this DELETE and surface as a thrown Postgres error here.
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = 'user-ephemeral'`);

    const afterDelete = await worksheetById(worksheet.id);
    expect(afterDelete?.confirmed_by).toBeNull(); // identity reference gone
    expect(afterDelete?.confirmed_at?.getTime()).toBe(originalConfirmedAt?.getTime()); // event/timing preserved
    expect(afterDelete?.canonical_status).toBe("IMPORTED"); // the import itself is entirely unaffected
    expect(await domainRowsFor("org-a", worksheet.id)).toHaveLength(2); // domain rows untouched
  });
});
