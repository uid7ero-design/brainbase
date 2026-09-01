import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";

// Data Hub 5A.2H.1 — real disposable-Postgres integration harness for the
// worksheet inspection/persistence service (inspectWorksheets.ts).
//
// Run ONLY via scripts/tests/verify-inspect-worksheets.sh, which starts a
// disposable postgres:16-alpine Docker container, applies the exact
// scripts/create-import-batches.sql migration against a minimal bootstrap
// schema (organisations/users/uploads), exports DATABASE_URL to point at
// that container, then runs `npx vitest run --config
// vitest.integration.config.ts scripts/tests/inspectWorksheets.integration.test.ts`.
// NEVER run this file directly against any other DATABASE_URL — the guard
// rail below refuses to start if DATABASE_URL is unset or looks like a
// real hosted/Neon/production endpoint. Mirrors
// scripts/tests/importBatchService.integration.test.ts's own harness
// pattern exactly (same guard rail, same neonCompatibleSql shim, same
// InMemoryFileStore override) — see that file's own header comment for
// the full rationale.
//
// This suite exercises the REAL, unmodified production
// lib/data-hub/importBatch/inspectWorksheets.ts against a REAL Postgres
// instance — never a duplicated/parallel copy of its SQL/Prisma calls.
// Only the storage adapter is overridden (InMemoryFileStore, zero
// network) — never a live Vercel Blob call.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "inspectWorksheets.integration.test.ts requires DATABASE_URL to point at a disposable Postgres " +
      "container (see scripts/tests/verify-inspect-worksheets.sh). Refusing to run without it."
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

vi.doMock("@/lib/data-hub/importBatch/compositionRoot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data-hub/importBatch/compositionRoot")>();
  return {
    ...actual,
    createImportBatchStorage: () => sharedStore,
  };
});

let sharedStore: InstanceType<typeof import("@/lib/data-hub/storage/inMemoryFileStore").InMemoryFileStore>;
let inspectWorksheets: typeof import("@/lib/data-hub/importBatch/inspectWorksheets").inspectWorksheets;
let buildImportBatchKey: typeof import("@/lib/data-hub/storage/rawFileStore").buildImportBatchKey;

beforeAll(async () => {
  const { InMemoryFileStore } = await import("@/lib/data-hub/storage/inMemoryFileStore");
  sharedStore = new InMemoryFileStore();
  ({ inspectWorksheets } = await import("@/lib/data-hub/importBatch/inspectWorksheets"));
  ({ buildImportBatchKey } = await import("@/lib/data-hub/storage/rawFileStore"));

  await prisma.$executeRawUnsafe(`
    INSERT INTO organisations (id, name, slug) VALUES
      ('org-a', 'Org A', 'org-a'),
      ('org-b', 'Org B', 'org-b')
    ON CONFLICT (id) DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users (id, organisation_id, username, name) VALUES
      ('user-a1', 'org-a', 'user-a1', 'User A1')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});

function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function seedReadyBatch(organisationId: string, body: Buffer, contentType: "csv" | "xlsx" | "xls" = "csv") {
  const id = randomUUID();
  const storageKey = buildImportBatchKey(organisationId, id);
  await prisma.importBatch.create({
    data: {
      id,
      organisation_id: organisationId,
      original_filename: `fixture.${contentType}`,
      content_type: contentType,
      size_bytes: body.byteLength,
      sha256: sha256Of(body),
      storage_provider: "vercel-blob-private",
      storage_key: storageKey,
      status: "READY",
    },
  });
  await sharedStore.put(storageKey, body);
  return id;
}

async function existingUploadRows(organisationId: string, importBatchId: string) {
  return prisma.upload.findMany({
    where: { organisation_id: organisationId, import_batch_id: importBatchId, lineage_kind: "DATA_HUB" },
    orderBy: { worksheet_index: "asc" },
  });
}

// ─── Real unique-index enforcement (raw INSERT, DB-level proof) ────────

describe("integration — real uploads_import_batch_worksheet_key unique index", () => {
  it("a raw direct duplicate (import_batch_id, worksheet_index) INSERT is rejected by Postgres itself", async () => {
    const body = Buffer.from("a,b\n1,2\n");
    const batchId = await seedReadyBatch("org-a", body);

    await prisma.$executeRawUnsafe(
      `INSERT INTO uploads (id, organisation_id, original_name, stored_path, mimetype, size_bytes,
         import_batch_id, worksheet_index, worksheet_name, worksheet_visibility, worksheet_is_empty,
         lineage_kind, canonical_status)
       VALUES ($1, 'org-a', 'raw-row', 'datahub-worksheet:x:0', 'text/csv', 0, $2, 0, 'CSV', 'visible', false, 'DATA_HUB', 'AWAITING_CONFIRMATION')`,
      randomUUID(),
      batchId
    );

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO uploads (id, organisation_id, original_name, stored_path, mimetype, size_bytes,
           import_batch_id, worksheet_index, worksheet_name, worksheet_visibility, worksheet_is_empty,
           lineage_kind, canonical_status)
         VALUES ($1, 'org-a', 'raw-row-2', 'datahub-worksheet:x:0', 'text/csv', 0, $2, 0, 'CSV', 'visible', false, 'DATA_HUB', 'AWAITING_CONFIRMATION')`,
        randomUUID(),
        batchId
      )
    ).rejects.toThrow();
  });
});

// ─── Atomic multi-row createMany rollback (real DB error mid-batch) ────

describe("integration — first-time multi-row createMany is genuinely atomic", () => {
  it("one CHECK-violating row in the same createMany batch rolls back the entire statement — zero rows land", async () => {
    const body = Buffer.from("a,b\n1,2\n");
    const batchId = await seedReadyBatch("org-a", body);

    const validRow: Prisma.UploadCreateManyInput = {
      organisation_id: "org-a",
      original_name: "valid",
      stored_path: "datahub-worksheet:x:0",
      mimetype: "text/csv",
      size_bytes: 0,
      import_batch_id: batchId,
      worksheet_index: 0,
      worksheet_name: "CSV",
      worksheet_visibility: "visible",
      worksheet_is_empty: false,
      lineage_kind: "DATA_HUB",
      canonical_status: "AWAITING_CONFIRMATION",
    };
    // Violates uploads_canonical_status_check (not one of the four allowed values).
    const invalidRow: Prisma.UploadCreateManyInput = {
      ...validRow,
      worksheet_index: 1,
      canonical_status: "NOT_A_REAL_STATUS",
    };

    await expect(prisma.upload.createMany({ data: [validRow, invalidRow] })).rejects.toThrow();

    const rows = await existingUploadRows("org-a", batchId);
    expect(rows).toHaveLength(0);
  });

  it("a duplicate worksheet_index WITHIN the same createMany batch is rejected wholesale by the unique index — zero rows land", async () => {
    const body = Buffer.from("a,b\n1,2\n");
    const batchId = await seedReadyBatch("org-a", body);

    const rowAt0: Prisma.UploadCreateManyInput = {
      organisation_id: "org-a",
      original_name: "row-a",
      stored_path: "datahub-worksheet:x:0",
      mimetype: "text/csv",
      size_bytes: 0,
      import_batch_id: batchId,
      worksheet_index: 0,
      worksheet_name: "First",
      worksheet_visibility: "visible",
      worksheet_is_empty: false,
      lineage_kind: "DATA_HUB",
      canonical_status: "AWAITING_CONFIRMATION",
    };
    const duplicateIndexRow: Prisma.UploadCreateManyInput = {
      ...rowAt0,
      original_name: "row-b",
      worksheet_name: "Duplicate",
    };

    await expect(prisma.upload.createMany({ data: [rowAt0, duplicateIndexRow] })).rejects.toThrow();

    const rows = await existingUploadRows("org-a", batchId);
    expect(rows).toHaveLength(0);
  });
});

// ─── Real service: first-time persistence + concurrent identical retry ─

describe("integration — inspectWorksheets first-time persistence and concurrency", () => {
  it("first-time persistence via the real service creates exactly the expected structural rows", async () => {
    const body = Buffer.from("a,b\n1,2\n3,4\n");
    const batchId = await seedReadyBatch("org-a", body, "csv");

    const result = await inspectWorksheets({ organisationId: "org-a", importBatchId: batchId });
    expect(result.ok).toBe(true);

    const rows = await existingUploadRows("org-a", batchId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      worksheet_index: 0,
      worksheet_name: "CSV",
      worksheet_visibility: "visible",
      worksheet_is_empty: false,
      lineage_kind: "DATA_HUB",
      canonical_status: "AWAITING_CONFIRMATION",
      size_bytes: 0,
      attempt_count: 0,
      last_failure_code: null,
      last_failure_message: null,
      last_failure_retryable: null,
    });
  });

  it("two concurrent, identical persistence attempts against the same batch converge to exactly one complete set, neither receiving a raw/unhandled error", async () => {
    const body = Buffer.from("a,b\n1,2\n3,4\n5,6\n");
    const batchId = await seedReadyBatch("org-a", body, "csv");

    const [r1, r2] = await Promise.all([
      inspectWorksheets({ organisationId: "org-a", importBatchId: batchId }),
      inspectWorksheets({ organisationId: "org-a", importBatchId: batchId }),
    ]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    const rows = await existingUploadRows("org-a", batchId);
    expect(rows).toHaveLength(1);
    expect(rows[0].worksheet_index).toBe(0);
  });

  it("an exact-identical retry after first-time success is idempotent (Case B) — zero additional rows", async () => {
    const body = Buffer.from("a,b\n1,2\n");
    const batchId = await seedReadyBatch("org-a", body, "csv");

    const first = await inspectWorksheets({ organisationId: "org-a", importBatchId: batchId });
    expect(first.ok).toBe(true);
    const second = await inspectWorksheets({ organisationId: "org-a", importBatchId: batchId });
    expect(second.ok).toBe(true);
    expect(second).toEqual(first);

    const rows = await existingUploadRows("org-a", batchId);
    expect(rows).toHaveLength(1);
  });
});

// ─── Real service: Cases C/D/E never repaired ──────────────────────────

describe("integration — pre-seeded divergent/partial existing sets are never repaired", () => {
  it("Case C — a pre-seeded partial existing set is detected as PERSISTENCE_CONFLICT and never topped up", async () => {
    // Two-worksheet source, but only ONE canonical row pre-seeded.
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a"], [1]]), "One");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["b"], [2]]), "Two");
    const body = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const batchId = await seedReadyBatch("org-a", body, "xlsx");

    await prisma.upload.create({
      data: {
        organisation_id: "org-a",
        original_name: "partial",
        stored_path: "datahub-worksheet:x:0",
        mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        size_bytes: 0,
        import_batch_id: batchId,
        worksheet_index: 0,
        worksheet_name: "One",
        worksheet_visibility: "visible",
        worksheet_is_empty: false,
        lineage_kind: "DATA_HUB",
        canonical_status: "AWAITING_CONFIRMATION",
      },
    });

    const result = await inspectWorksheets({ organisationId: "org-a", importBatchId: batchId });
    expect(result).toMatchObject({ ok: false, code: "PERSISTENCE_CONFLICT" });

    const rows = await existingUploadRows("org-a", batchId);
    expect(rows).toHaveLength(1); // never topped up to 2
  });

  it("Case E — a pre-seeded divergent row (same index, wrong canonical_status) is never overwritten", async () => {
    const body = Buffer.from("a,b\n1,2\n");
    const batchId = await seedReadyBatch("org-a", body, "csv");

    await prisma.upload.create({
      data: {
        organisation_id: "org-a",
        original_name: "divergent",
        stored_path: "datahub-worksheet:x:0",
        mimetype: "text/csv",
        size_bytes: 0,
        import_batch_id: batchId,
        worksheet_index: 0,
        worksheet_name: "CSV",
        worksheet_visibility: "visible",
        worksheet_is_empty: false,
        lineage_kind: "DATA_HUB",
        canonical_status: "INELIGIBLE", // real derivation would say AWAITING_CONFIRMATION
      },
    });

    const result = await inspectWorksheets({ organisationId: "org-a", importBatchId: batchId });
    expect(result).toMatchObject({ ok: false, code: "PERSISTENCE_CONFLICT" });

    const rows = await existingUploadRows("org-a", batchId);
    expect(rows).toHaveLength(1);
    expect(rows[0].canonical_status).toBe("INELIGIBLE"); // untouched, never overwritten
  });
});

// ─── Tenant isolation (real Postgres) ───────────────────────────────────

describe("integration — tenant isolation", () => {
  it("a batch belonging to a different organisation is BATCH_NOT_FOUND, never readable cross-tenant", async () => {
    const body = Buffer.from("a,b\n1,2\n");
    const batchId = await seedReadyBatch("org-a", body, "csv");
    const result = await inspectWorksheets({ organisationId: "org-b", importBatchId: batchId });
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
    const rows = await existingUploadRows("org-a", batchId);
    expect(rows).toHaveLength(0);
  });
});
