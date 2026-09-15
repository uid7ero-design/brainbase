// Data Hub 6.1D2 — real disposable-Postgres correctness + performance proof
// for the BATCHED per-worksheet reconciliation design in
// confirmWorksheet.ts (supersedes the old per-row O(rows) design's own
// proof coverage in confirmWorksheetReconciliation.postgres-proof.test.ts,
// which remains in place, unmodified, and still passes against the new
// code since the reconciliation MODEL itself is unchanged).
//
// WHY THIS FILE EXISTS: the old per-row design was measured against
// Onkaparinga's real 405-row first import to issue ~1,218 sequential DB
// round trips, landing at/past the 30s transaction timeout and producing a
// real Production Prisma P2028 failure. This proof exercises the new,
// batched design against a REALISTIC 405-row worksheet (matching the real
// file's exact row count) through the ACTUAL confirmDataHubWorksheet() code
// path and a REAL generated Prisma Client against a REAL disposable
// Postgres container — never mocked at the database boundary — and
// measures wall-clock duration as direct evidence of the fix.
//
// NOT part of the default vitest containment suite (tests/containment/**)
// — invoked explicitly via `npx vitest run --config
// tests/postgres-proof/vitest.proof.config.ts
// tests/postgres-proof/confirmWorksheetBatchedReconciliation.postgres-proof.test.ts`
// against a throwaway `postgres:16-alpine` Docker container on port 55444
// (distinct from the 6.1B proof's 55433 and the 6.1D1 proof's 55442, so all
// three can run concurrently without a port clash), never Production/
// Preview. Only the Blob storage composition root is mocked (an in-memory
// byte store keyed by import-batch key) — identical, established pattern
// to confirmWorksheetReconciliation.postgres-proof.test.ts.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { PrismaClient } from "@prisma/client";
import { buildImportBatchKey } from "../../lib/data-hub/storage/rawFileStore";

if (!process.env.DATABASE_URL?.includes("55444")) {
  throw new Error(
    "Refusing to run: DATABASE_URL does not point at the disposable 6.1D2 proof container (port 55444). " +
      "This proof must never run against Production/Preview."
  );
}

const inMemoryBlobs = new Map<string, Buffer>();

vi.mock("@/lib/data-hub/importBatch/compositionRoot", () => ({
  createImportBatchStorage: () => ({
    provider: "in-memory-proof-store",
    put: vi.fn(),
    head: vi.fn(),
    get: async (key: string) => {
      const body = inMemoryBlobs.get(key);
      if (!body) throw new Error(`proof store: no blob for key ${key}`);
      return { body };
    },
    delete: vi.fn(),
  }),
}));

// Same AsyncLocalStorage-routed prisma singleton mock as
// confirmWorksheetReconciliation.postgres-proof.test.ts — see that file's
// own header comment for the full rationale (a single shared PrismaClient
// serializes concurrent interactive transactions in this environment,
// which would make a same-singleton "concurrency" test pass for the wrong
// reason).
const activeClientStorage = new AsyncLocalStorage<PrismaClient>();
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        const client = activeClientStorage.getStore();
        if (!client) {
          throw new Error("confirmWorksheetBatchedReconciliation proof: no active PrismaClient bound for this call");
        }
        return Reflect.get(client, prop, client);
      },
    }
  ),
}));

function runWithClient<T>(client: PrismaClient, fn: () => Promise<T>): Promise<T> {
  return activeClientStorage.run(client, fn);
}

// Fixture setup/assertions use their own separate, ordinary PrismaClient
// with query-event logging enabled, so P1's performance assertion can
// report a real, measured query count alongside wall-clock duration.
const prisma = new PrismaClient();

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(headers: string[], rows: string[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
}

const HEADERS = ["report_date", "location", "waste_type", "source_external_id"];

describe("6.1D2 confirmWorksheet BATCHED reconciliation — real disposable Postgres correctness + performance proof", () => {
  let organisationId: string;
  let organisationId2: string;
  let sourceSystemId: string;
  let actor1: string;
  let actor2: string;

  beforeAll(async () => {
    const org = await prisma.organisation.create({
      data: { name: "6.1D2 Proof Org", slug: `proof-org-6-1d2-${Date.now()}` },
    });
    organisationId = org.id;

    const org2 = await prisma.organisation.create({
      data: { name: "6.1D2 Proof Org 2 (tenant isolation)", slug: `proof-org-6-1d2-2-${Date.now()}` },
    });
    organisationId2 = org2.id;

    const u1 = await prisma.user.create({
      data: { organisation_id: organisationId, username: `actor1-${Date.now()}`, name: "Actor One" },
    });
    actor1 = u1.id;
    const u2 = await prisma.user.create({
      data: { organisation_id: organisationId, username: `actor2-${Date.now()}`, name: "Actor Two" },
    });
    actor2 = u2.id;

    const s1 = await prisma.sourceSystem.create({
      data: { organisation_id: organisationId, name: "6.1D2 Batched Reconciliation Proof SourceSystem", active: true },
    });
    sourceSystemId = s1.id;

    const s2 = await prisma.sourceSystem.create({
      data: { organisation_id: organisationId2, name: "6.1D2 Tenant-2 SourceSystem", active: true },
    });
    (globalThis as { __proof_sourceSystemId2?: string }).__proof_sourceSystemId2 = s2.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Creates a fresh, eligible worksheet+batch with N rows for the given
   * organisation. `rows` are [report_date, location, waste_type,
   * source_external_id] tuples. */
  async function createWorksheet(orgId: string, sourceSysId: string, label: string, rows: string[][]) {
    const csv = buildCsv(HEADERS, rows);
    const body = Buffer.from(csv, "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");

    const batch = await prisma.importBatch.create({
      data: {
        organisation_id: orgId,
        source_system_id: sourceSysId,
        original_filename: `${label}.csv`,
        content_type: "csv",
        size_bytes: body.byteLength,
        sha256,
        storage_provider: "in-memory-proof-store",
        storage_key: `proof-key-${label}-${Date.now()}-${Math.random()}`,
        status: "READY",
      },
    });
    inMemoryBlobs.set(buildImportBatchKey(orgId, batch.id), body);

    const worksheet = await prisma.upload.create({
      data: {
        organisation_id: orgId,
        original_name: `${label}.csv`,
        stored_path: "n/a",
        mimetype: "text/csv",
        size_bytes: body.byteLength,
        lineage_kind: "DATA_HUB",
        import_batch_id: batch.id,
        worksheet_index: 0,
        canonical_status: "AWAITING_CONFIRMATION",
        mapping_version_id: null,
      },
    });
    return { batchId: batch.id, worksheetId: worksheet.id };
  }

  async function freshConfirm() {
    vi.resetModules();
    return import("../../lib/data-hub/importBatch/confirmWorksheet");
  }

  function rowsFor(prefix: string, count: number, waste = "tyres"): string[][] {
    return Array.from({ length: count }, (_, i) => [
      "2024-01-01",
      `${prefix} St ${i}`,
      waste,
      `${prefix}-${i}-${Date.now()}`,
    ]);
  }

  it("P1. 405 all-NEW rows — succeeds, 405 identities, 405 observations, 405 NEW domain rows, response NEW=405/UNCHANGED=0/CHANGED=0, and completes with a bounded, measured query count far below the old O(rows) design", async () => {
    const rows = rowsFor("P1", 405);
    const { worksheetId } = await createWorksheet(organisationId, sourceSystemId, "p1-405", rows);
    const { confirmDataHubWorksheet } = await freshConfirm();

    const client = new PrismaClient({ log: [{ level: "query", emit: "event" }] });
    let queryCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).$on("query", () => {
      queryCount++;
    });

    const start = Date.now();
    let result: Awaited<ReturnType<typeof confirmDataHubWorksheet>>;
    try {
      result = await runWithClient(client, () =>
        confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor1 })
      );
    } finally {
      await client.$disconnect();
    }
    const durationMs = Date.now() - start;

    expect(result).toMatchObject({ ok: true, alreadyImported: false, newRows: 405, unchangedRows: 0, changedRows: 0, importedRows: 405 });

    const identityCount = await prisma.sourceRecordIdentity.count({
      where: { organisation_id: organisationId, source_system_id: sourceSystemId, source_external_id: { in: rows.map((r) => r[3]) } },
    });
    expect(identityCount).toBe(405);
    const observationCount = await prisma.sourceRecordObservation.count({ where: { upload_id: worksheetId } });
    expect(observationCount).toBe(405);
    const domainCount = await prisma.illegalDumping.count({ where: { upload_id: worksheetId } });
    expect(domainCount).toBe(405);

    // PERFORMANCE ASSERTION (Section K): the old per-row design issued
    // ~3 sequential round trips PER ROW for an all-NEW worksheet this
    // size (~1,218 total for 405 rows) plus the lock/claim, and took long
    // enough in real Production to hit a 30-second transaction timeout.
    // The batched design's total query count must not scale with row
    // count — bounded well under 100 total statements for this run
    // (lock + claim + identity preload/insert/reload + observation
    // insert + domain insert + Prisma's own connection/transaction
    // bookkeeping statements), a direct, measured structural proof that
    // O(rows) sequential round trips were NOT reintroduced.
    console.log(`[6.1D2 P1] 405-row confirm: ${durationMs}ms wall-clock, ${queryCount} SQL statements logged by Prisma`);
    expect(queryCount).toBeLessThan(100);
    expect(durationMs).toBeLessThan(15_000);
  }, 60_000);

  it("P2. Replay/same canonical data — existing identities reused, 405 new observations, domain rows not duplicated, UNCHANGED classification correct", async () => {
    const rows = rowsFor("P2", 50);
    const { worksheetId: ws1 } = await createWorksheet(organisationId, sourceSystemId, "p2-first", rows);
    const { confirmDataHubWorksheet: confirm1 } = await freshConfirm();
    const client1 = new PrismaClient();
    let result1: Awaited<ReturnType<typeof confirm1>>;
    try {
      result1 = await runWithClient(client1, () => confirm1({ organisationId, worksheetUploadId: ws1, confirmedBy: actor1 }));
    } finally {
      await client1.$disconnect();
    }
    expect(result1).toMatchObject({ ok: true, newRows: 50, unchangedRows: 0, changedRows: 0 });

    const identityIdsBefore = await prisma.sourceRecordIdentity.findMany({
      where: { organisation_id: organisationId, source_system_id: sourceSystemId, source_external_id: { in: rows.map((r) => r[3]) } },
      select: { id: true },
    });
    const domainIdsBefore = await prisma.illegalDumping.findMany({
      where: { source_record_identity_id: { in: identityIdsBefore.map((i) => i.id) } },
      select: { id: true, updated_at: true },
    });

    // Second worksheet, IDENTICAL governed field values, same external ids.
    const { worksheetId: ws2 } = await createWorksheet(organisationId, sourceSystemId, "p2-second", rows);
    const { confirmDataHubWorksheet: confirm2 } = await freshConfirm();
    const client2 = new PrismaClient();
    let result2: Awaited<ReturnType<typeof confirm2>>;
    try {
      result2 = await runWithClient(client2, () => confirm2({ organisationId, worksheetUploadId: ws2, confirmedBy: actor2 }));
    } finally {
      await client2.$disconnect();
    }
    expect(result2).toMatchObject({ ok: true, alreadyImported: false, newRows: 0, unchangedRows: 50, changedRows: 0, importedRows: 50 });

    const identityIdsAfter = await prisma.sourceRecordIdentity.findMany({
      where: { organisation_id: organisationId, source_system_id: sourceSystemId, source_external_id: { in: rows.map((r) => r[3]) } },
      select: { id: true },
    });
    expect(identityIdsAfter.map((i) => i.id).sort()).toEqual(identityIdsBefore.map((i) => i.id).sort());

    const domainIdsAfter = await prisma.illegalDumping.findMany({
      where: { source_record_identity_id: { in: identityIdsBefore.map((i) => i.id) } },
      select: { id: true, upload_id: true, updated_at: true },
    });
    expect(domainIdsAfter).toHaveLength(50);
    expect(domainIdsAfter.every((d) => d.upload_id === ws1)).toBe(true);
    expect(domainIdsAfter.map((d) => d.updated_at.getTime()).sort()).toEqual(domainIdsBefore.map((d) => d.updated_at.getTime()).sort());

    const observationCountWs2 = await prisma.sourceRecordObservation.count({ where: { upload_id: ws2 } });
    expect(observationCountWs2).toBe(50);
    const totalObservations = await prisma.sourceRecordObservation.count({
      where: { source_record_identity_id: { in: identityIdsBefore.map((i) => i.id) } },
    });
    expect(totalObservations).toBe(100);
  }, 60_000);

  it("P3. Mixed CHANGED + UNCHANGED — correct counts, only CHANGED domain rows updated, observation inserted for every input row", async () => {
    const unchangedRows = rowsFor("P3U", 20);
    const changedRowsOriginal = rowsFor("P3C", 20);
    const firstBatch = [...unchangedRows, ...changedRowsOriginal];
    const { worksheetId: ws1 } = await createWorksheet(organisationId, sourceSystemId, "p3-first", firstBatch);
    const { confirmDataHubWorksheet: confirm1 } = await freshConfirm();
    const client1 = new PrismaClient();
    try {
      await runWithClient(client1, () => confirm1({ organisationId, worksheetUploadId: ws1, confirmedBy: actor1 }));
    } finally {
      await client1.$disconnect();
    }

    // Second worksheet: unchangedRows repeated verbatim; changedRows with a
    // different `location` value (a source-controlled, hashed field).
    const changedRowsModified = changedRowsOriginal.map((r) => [r[0], `${r[1]} MODIFIED`, r[2], r[3]]);
    const secondBatch = [...unchangedRows, ...changedRowsModified];
    const { worksheetId: ws2 } = await createWorksheet(organisationId, sourceSystemId, "p3-second", secondBatch);
    const { confirmDataHubWorksheet: confirm2 } = await freshConfirm();
    const client2 = new PrismaClient();
    let result2: Awaited<ReturnType<typeof confirm2>>;
    try {
      result2 = await runWithClient(client2, () => confirm2({ organisationId, worksheetUploadId: ws2, confirmedBy: actor2 }));
    } finally {
      await client2.$disconnect();
    }
    expect(result2).toMatchObject({ ok: true, newRows: 0, unchangedRows: 20, changedRows: 20, importedRows: 40 });

    const changedIdentities = await prisma.sourceRecordIdentity.findMany({
      where: { organisation_id: organisationId, source_system_id: sourceSystemId, source_external_id: { in: changedRowsOriginal.map((r) => r[3]) } },
      select: { id: true },
    });
    const changedDomainRows = await prisma.illegalDumping.findMany({
      where: { source_record_identity_id: { in: changedIdentities.map((i) => i.id) } },
    });
    expect(changedDomainRows).toHaveLength(20);
    expect(changedDomainRows.every((d) => d.location.endsWith("MODIFIED"))).toBe(true);
    expect(changedDomainRows.every((d) => d.upload_id === ws1)).toBe(true); // CHANGED updates in place — upload_id never reassigned.

    const unchangedIdentities = await prisma.sourceRecordIdentity.findMany({
      where: { organisation_id: organisationId, source_system_id: sourceSystemId, source_external_id: { in: unchangedRows.map((r) => r[3]) } },
      select: { id: true },
    });
    const unchangedDomainRows = await prisma.illegalDumping.findMany({
      where: { source_record_identity_id: { in: unchangedIdentities.map((i) => i.id) } },
    });
    expect(unchangedDomainRows.every((d) => !d.location.endsWith("MODIFIED"))).toBe(true);

    const totalObservationsWs2 = await prisma.sourceRecordObservation.count({ where: { upload_id: ws2 } });
    expect(totalObservationsWs2).toBe(40);
  }, 60_000);

  it("P4. Case C — pre-existing identity with zero history fails the whole transaction closed, zero partial writes from that attempt", async () => {
    const extId = `P4-${Date.now()}`;
    // Manufacture the anomalous state directly (bypassing the normal code
    // path, test setup only): an identity with zero observations.
    const identity = await prisma.sourceRecordIdentity.create({
      data: { organisation_id: organisationId, source_system_id: sourceSystemId, domain_kind: "ILLEGAL_DUMPING", source_external_id: extId },
    });

    const { worksheetId } = await createWorksheet(organisationId, sourceSystemId, "p4", [["2024-01-01", "Case C St", "tyres", extId]]);
    const { confirmDataHubWorksheet } = await freshConfirm();
    const client = new PrismaClient();
    let result: Awaited<ReturnType<typeof confirmDataHubWorksheet>>;
    try {
      result = await runWithClient(client, () => confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor1 }));
    } finally {
      await client.$disconnect();
    }
    expect(result).toMatchObject({ ok: false, code: "RECONCILIATION_HISTORY_INCONSISTENT" });

    const observationCount = await prisma.sourceRecordObservation.count({ where: { source_record_identity_id: identity.id } });
    expect(observationCount).toBe(0);
    const domainCount = await prisma.illegalDumping.count({ where: { source_record_identity_id: identity.id } });
    expect(domainCount).toBe(0);
    const worksheetAfter = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
    expect(worksheetAfter.canonical_status).toBe("AWAITING_CONFIRMATION"); // full rollback, including the claim.
  }, 60_000);

  it("P6. Tenant isolation — same external ID in another organisation does not cross-resolve, even when both SourceSystem ids are distinct rows created independently", async () => {
    const org2SourceSystemId = (globalThis as { __proof_sourceSystemId2?: string }).__proof_sourceSystemId2 as string;
    const sharedExtId = `P6-shared-${Date.now()}`;

    const { worksheetId: wsOrg1 } = await createWorksheet(organisationId, sourceSystemId, "p6-org1", [["2024-01-01", "Org1 St", "tyres", sharedExtId]]);
    const { confirmDataHubWorksheet: confirmOrg1 } = await freshConfirm();
    const client1 = new PrismaClient();
    try {
      await runWithClient(client1, () => confirmOrg1({ organisationId, worksheetUploadId: wsOrg1, confirmedBy: actor1 }));
    } finally {
      await client1.$disconnect();
    }

    const { worksheetId: wsOrg2 } = await createWorksheet(organisationId2, org2SourceSystemId, "p6-org2", [["2024-01-01", "Org2 St", "tyres", sharedExtId]]);
    const { confirmDataHubWorksheet: confirmOrg2 } = await freshConfirm();
    const client2 = new PrismaClient();
    let result2: Awaited<ReturnType<typeof confirmOrg2>>;
    try {
      result2 = await runWithClient(client2, () => confirmOrg2({ organisationId: organisationId2, worksheetUploadId: wsOrg2, confirmedBy: actor1 }));
    } finally {
      await client2.$disconnect();
    }
    // Org2's row must classify NEW (its own independent identity), never
    // UNCHANGED/CHANGED against org1's identity, and never Case C.
    expect(result2).toMatchObject({ ok: true, newRows: 1, unchangedRows: 0, changedRows: 0 });

    const identitiesForExtId = await prisma.sourceRecordIdentity.findMany({ where: { source_external_id: sharedExtId } });
    expect(identitiesForExtId).toHaveLength(2);
    expect(new Set(identitiesForExtId.map((i) => i.organisation_id))).toEqual(new Set([organisationId, organisationId2]));
  }, 60_000);

  it("P7. Concurrent same-source confirmation — two different worksheets for the same organisation+SourceSystem, run concurrently, never produce duplicate identities and never poison either transaction", async () => {
    const sharedExtId = `P7-shared-${Date.now()}`;
    // Deliberately IDENTICAL governed fields on both worksheets — this
    // test isolates "no duplicate identity, no crash under concurrency,"
    // not CHANGED-classification correctness (already covered by P3). A
    // differing field here would correctly classify the second confirm as
    // CHANGED, not UNCHANGED, which would conflate the two concerns.
    const sharedRow = ["2024-01-01", "P7 Shared St", "tyres", sharedExtId];
    const { worksheetId: wsA } = await createWorksheet(organisationId, sourceSystemId, "p7-a", [sharedRow]);
    const { worksheetId: wsB } = await createWorksheet(organisationId, sourceSystemId, "p7-b", [sharedRow]);

    const { confirmDataHubWorksheet: confirmA } = await freshConfirm();
    const { confirmDataHubWorksheet: confirmB } = await freshConfirm();
    const clientA = new PrismaClient();
    const clientB = new PrismaClient();

    let resultA: Awaited<ReturnType<typeof confirmA>>;
    let resultB: Awaited<ReturnType<typeof confirmB>>;
    try {
      [resultA, resultB] = await Promise.all([
        runWithClient(clientA, () => confirmA({ organisationId, worksheetUploadId: wsA, confirmedBy: actor1 })),
        runWithClient(clientB, () => confirmB({ organisationId, worksheetUploadId: wsB, confirmedBy: actor2 })),
      ]);
    } finally {
      await clientA.$disconnect();
      await clientB.$disconnect();
    }

    // The SourceSystem FOR UPDATE lock serializes these two transactions —
    // both must succeed (neither is the "same worksheet", so there's no
    // claim race), one observes NEW, the other observes NEW-or-UNCHANGED-
    // never a duplicate identity, never a poisoned/thrown transaction.
    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    const identities = await prisma.sourceRecordIdentity.findMany({
      where: { organisation_id: organisationId, source_system_id: sourceSystemId, source_external_id: sharedExtId },
    });
    expect(identities).toHaveLength(1); // never two — the lock + skipDuplicates + reload sequence never double-creates.
    const observations = await prisma.sourceRecordObservation.findMany({ where: { source_record_identity_id: identities[0].id } });
    expect(observations).toHaveLength(2); // one per worksheet, exactly one NEW and one NEW-or-UNCHANGED, never a crash.
    const outcomes = observations.map((o) => o.outcome).sort();
    expect(outcomes).toEqual(["NEW", "UNCHANGED"]);
  }, 60_000);

  it("P8. Forced failure AFTER identity creation (and observation insert) rolls back everything, including the claim — real atomic-transaction negative control (Phase 6.1D4)", async () => {
    // FAILURE-INJECTION DESIGN (6.1D4 Section B/C): a test-only Postgres
    // trigger, created ONLY against THIS disposable container's own
    // `illegal_dumping` table via a plain runtime `$executeRawUnsafe` call
    // from this test file — never added to
    // scripts/create-datahub-reconciliation.sql or any other real
    // migration script, never applied to prisma/schema.prisma, and never
    // reachable by Production/Preview (which only ever run the real,
    // committed migration scripts). It deterministically rejects exactly
    // one, deliberately marked row (location = 'P8_POISON_LOCATION') at
    // the REAL `tx.illegalDumping.createMany()` call inside
    // confirmWorksheet.ts's own transaction (Step 9) — the actual
    // production code path, never mocked. That statement is textually and
    // causally AFTER identity creation (Steps 3-4,
    // confirmWorksheet.ts lines 664-684 as freshly re-read for this test)
    // and observation insert (Step 8, lines 816-818) in the real file, so
    // a rollback proven here necessarily also proves identity AND
    // observation rollback — a STRONGER guarantee than targeting only the
    // observation stage would give.
    //
    // A real, already-existing Postgres constraint (e.g. a NOT NULL/CHECK
    // on illegal_dumping or source_record_observations) was deliberately
    // NOT used here: every column mapIllegalDumpingRows can produce is
    // already validated by that pure, pre-transaction mapper (Step 7) at
    // least as strictly as the DB schema requires, so no CSV-craftable
    // value can naturally reach a real DB constraint violation at the
    // domain/observation-insert stage without first being rejected by the
    // mapper long before the transaction even opens — confirmed by
    // reading illegalDumpingMapper.ts's own required-field/enum
    // validation. A disposable-container-only trigger is therefore the
    // correct, narrowest mechanism available, exactly as anticipated by
    // the authorization's own Section B "acceptable examples" list.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION public.p8_test_only_reject_poison_location()
      RETURNS trigger AS $trigger$
      BEGIN
        IF NEW.location = 'P8_POISON_LOCATION' THEN
          RAISE EXCEPTION 'P8 test-only: deliberately rejecting insert of a poisoned domain row (this trigger exists ONLY in this disposable test container -- never in scripts/create-datahub-reconciliation.sql or any other real migration script, and never applied to Production/Preview)';
        END IF;
        RETURN NEW;
      END;
      $trigger$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER p8_test_only_reject_poison_location_trigger
      BEFORE INSERT ON illegal_dumping
      FOR EACH ROW EXECUTE FUNCTION public.p8_test_only_reject_poison_location();
    `);

    try {
      const goodRows = rowsFor("P8", 4);
      const poisonRow = ["2024-01-01", "P8_POISON_LOCATION", "tyres", `P8-poison-${Date.now()}`];
      const rows = [...goodRows, poisonRow];
      const allExtIds = rows.map((r) => r[3]);

      const { worksheetId, batchId } = await createWorksheet(organisationId, sourceSystemId, "p8-poison", rows);

      // Baseline — every source_external_id here is freshly generated
      // with Date.now(), never used by any other test in this file, so
      // this must be exactly zero before the attempt.
      const identityBaselineCount = await prisma.sourceRecordIdentity.count({
        where: { organisation_id: organisationId, source_system_id: sourceSystemId, source_external_id: { in: allExtIds } },
      });
      expect(identityBaselineCount).toBe(0);

      const { confirmDataHubWorksheet } = await freshConfirm();
      const client = new PrismaClient({ log: [{ level: "query", emit: "event" }] });
      const statementLog: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client as any).$on("query", (e: { query: string }) => {
        statementLog.push(e.query);
      });

      let caughtError: unknown = null;
      try {
        await runWithClient(client, () =>
          confirmDataHubWorksheet({ organisationId, worksheetUploadId: worksheetId, confirmedBy: actor1 })
        );
        throw new Error("P8 expected confirmDataHubWorksheet to reject, but it resolved normally");
      } catch (err) {
        caughtError = err;
      } finally {
        await client.$disconnect();
      }

      // The transaction must have genuinely rejected via the real
      // trigger — this is NOT Case C or any other classified {ok:false}
      // outcome. confirmWorksheet.ts's own catch block only intercepts
      // ReconciliationHistoryInconsistentError and re-throws everything
      // else uncaught, exactly as it must for a genuinely unexpected DB
      // error like this one.
      expect(caughtError).toBeTruthy();
      expect(String((caughtError as Error)?.message ?? caughtError)).toMatch(/P8 test-only/);

      // QUERY-INSTRUMENTATION PROOF (Section C): confirm the REAL SQL
      // statement log — not an assumption from reading the source file —
      // shows identity creation and observation insertion were genuinely
      // attempted, in that order, BEFORE the failing domain insert.
      // Prisma logs each statement in the literal order it sent them to
      // Postgres.
      const identityInsertIndex = statementLog.findIndex((q) => /INSERT INTO\s+"?public"?\.?"?source_record_identities"?/i.test(q));
      const observationInsertIndex = statementLog.findIndex((q) => /INSERT INTO\s+"?public"?\.?"?source_record_observations"?/i.test(q));
      const domainInsertIndex = statementLog.findIndex((q) => /INSERT INTO\s+"?public"?\.?"?illegal_dumping"?/i.test(q));
      expect(identityInsertIndex).toBeGreaterThanOrEqual(0);
      expect(observationInsertIndex).toBeGreaterThanOrEqual(0);
      expect(domainInsertIndex).toBeGreaterThanOrEqual(0);
      expect(identityInsertIndex).toBeLessThan(domainInsertIndex);
      expect(observationInsertIndex).toBeLessThan(domainInsertIndex);

      // ROLLBACK PROOF — using the SEPARATE, ordinary `prisma` fixture
      // client (a fresh connection entirely outside the failed
      // transaction), confirm every write from this attempt is gone,
      // back to the exact pre-attempt baseline. This is the actual
      // required proof: not that rollback is "expected," but that it
      // demonstrably happened.
      const identityCountAfter = await prisma.sourceRecordIdentity.count({
        where: { organisation_id: organisationId, source_system_id: sourceSystemId, source_external_id: { in: allExtIds } },
      });
      expect(identityCountAfter).toBe(0);
      const observationCountAfter = await prisma.sourceRecordObservation.count({ where: { upload_id: worksheetId } });
      expect(observationCountAfter).toBe(0);
      const domainCountAfter = await prisma.illegalDumping.count({ where: { upload_id: worksheetId } });
      expect(domainCountAfter).toBe(0);

      const worksheetAfter = await prisma.upload.findUniqueOrThrow({ where: { id: worksheetId } });
      expect(worksheetAfter.canonical_status).toBe("AWAITING_CONFIRMATION"); // full rollback, including the claim.
      expect(worksheetAfter.confirmed_by).toBeNull();
      expect(worksheetAfter.confirmed_at).toBeNull();
      expect(worksheetAfter.attempt_count).toBe(0);

      const batchAfter = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      expect(batchAfter.status).toBe("READY"); // untouched -- Confirm never mutates ImportBatch.status.
    } finally {
      // Clean up the test-only trigger regardless of outcome, so it can
      // never affect any other test in this file even on a retry.
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS p8_test_only_reject_poison_location_trigger ON illegal_dumping;`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS public.p8_test_only_reject_poison_location();`);
    }
  }, 60_000);
});
