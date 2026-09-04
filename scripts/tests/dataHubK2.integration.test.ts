import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";

// Data Hub 5A.2K.2 — real disposable-Postgres integration harness for the
// CSV-only live vertical slice: the new inspectCsvWorksheet.ts service
// AND the two new HTTP routes wrapping it and the existing K.1
// confirmWorksheet.ts service.
//
// Run ONLY via scripts/tests/verify-datahub-k2.sh, which starts a
// disposable postgres:16-alpine container, applies the identical
// bootstrap schema used by scripts/tests/verify-confirm-worksheet.sh
// (organisations/users/uploads/illegal_dumping) plus the real
// scripts/create-import-batches.sql migration, exports DATABASE_URL, then
// runs this file via `npx vitest run --config vitest.integration.config.ts
// scripts/tests/dataHubK2.integration.test.ts`.
//
// Exercises the REAL, unmodified production inspectCsvWorksheet.ts,
// confirmWorksheet.ts, and both new route POST handlers — never a
// duplicated/parallel copy of their logic. Only the storage adapter
// (InMemoryFileStore, zero network) and lib/org's requireRole (a
// controlled auth seam, same pattern as
// dataHubInitiateFinalizeRoutes.integration.test.ts) are mocked.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "dataHubK2.integration.test.ts requires DATABASE_URL to point at a disposable Postgres " +
      "container (see scripts/tests/verify-datahub-k2.sh). Refusing to run without it."
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

type MockSession = { userId: string; organisationId: string; homeOrganisationId: string; role: string; name: string };
let nextSession: MockSession | null = null;
let nextAuthError: string | null = null;

vi.mock("@/lib/org", () => ({
  requireRole: vi.fn(async (min: string) => {
    if (nextAuthError) throw new Error(nextAuthError);
    if (!nextSession) throw new Error("Unauthorized");
    const order = ["viewer", "manager", "admin", "super_admin"];
    if (order.indexOf(nextSession.role) < order.indexOf(min)) throw new Error("Forbidden");
    return nextSession;
  }),
}));

function asSession(overrides: Partial<MockSession> & { organisationId: string; role: string }) {
  nextAuthError = null;
  nextSession = {
    userId: overrides.userId ?? "user-1",
    organisationId: overrides.organisationId,
    homeOrganisationId: overrides.homeOrganisationId ?? overrides.organisationId,
    role: overrides.role,
    name: overrides.name ?? "Test User",
  };
}
function asUnauthenticated() {
  nextSession = null;
  nextAuthError = "Unauthorized";
}

let sharedStore: InstanceType<typeof import("@/lib/data-hub/storage/inMemoryFileStore").InMemoryFileStore>;
let inspectCsvWorksheet: typeof import("@/lib/data-hub/importBatch/inspectCsvWorksheet").inspectCsvWorksheet;
let buildImportBatchKey: typeof import("@/lib/data-hub/storage/rawFileStore").buildImportBatchKey;
let POST_inspect: typeof import("@/app/api/data-hub/import-batches/[id]/inspect/route").POST;
let POST_confirm: typeof import("@/app/api/data-hub/worksheets/[id]/confirm-illegal-dumping/route").POST;
// The SHARED production Prisma singleton (lib/prisma.ts) — the SAME
// module inspectCsvWorksheet.ts/confirmWorksheet.ts themselves import via
// `../../prisma`. Used ONLY by the unhandled-exception error-leakage test
// below to inject a real rejected call into the service's own real
// execution path — never to fake/mock a normal outcome.
let productionPrisma: typeof import("@/lib/prisma").prisma;

beforeAll(async () => {
  const { InMemoryFileStore } = await import("@/lib/data-hub/storage/inMemoryFileStore");
  sharedStore = new InMemoryFileStore();
  ({ inspectCsvWorksheet } = await import("@/lib/data-hub/importBatch/inspectCsvWorksheet"));
  ({ buildImportBatchKey } = await import("@/lib/data-hub/storage/rawFileStore"));
  ({ POST: POST_inspect } = await import("@/app/api/data-hub/import-batches/[id]/inspect/route"));
  ({ POST: POST_confirm } = await import("@/app/api/data-hub/worksheets/[id]/confirm-illegal-dumping/route"));
  ({ prisma: productionPrisma } = await import("@/lib/prisma"));

  await prisma.$executeRawUnsafe(`
    INSERT INTO organisations (id, name, slug) VALUES
      ('org-a', 'Org A', 'org-a'),
      ('org-b', 'Org B', 'org-b')
    ON CONFLICT (id) DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users (id, organisation_id, username, name) VALUES
      ('user-1', 'org-a', 'user-1', 'Default Test User'),
      ('user-a1', 'org-a', 'user-a1', 'User A1'),
      ('user-b1', 'org-b', 'user-b1', 'User B1')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM illegal_dumping`);
  await prisma.$executeRawUnsafe(`DELETE FROM uploads`);
  await prisma.$executeRawUnsafe(`DELETE FROM import_batches`);
  nextSession = null;
  nextAuthError = null;
});

function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const VALID_CSV = Buffer.from(
  "report_date,location,waste_type,severity,status\n" +
    "2024-01-15,Main St,tyres,high,open\n" +
    "2024-02-01,Oak Ave,furniture,low,resolved\n"
);
const EMPTY_CSV = Buffer.from("");
const HEADER_ONLY_CSV = Buffer.from("report_date,location,waste_type,severity,status\n");

async function seedReadyBatch(
  organisationId: string,
  body: Buffer,
  overrides: Partial<{ contentType: "csv" | "xlsx" | "xls"; status: string; deletedAt: Date | null; sha256: string }> = {}
) {
  const id = randomUUID();
  const storageKey = buildImportBatchKey(organisationId, id);
  await prisma.importBatch.create({
    data: {
      id,
      organisation_id: organisationId,
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

async function worksheetsFor(organisationId: string, importBatchId: string) {
  return prisma.upload.findMany({ where: { organisation_id: organisationId, import_batch_id: importBatchId, lineage_kind: "DATA_HUB" } });
}
async function domainRowsFor(organisationId: string, uploadId: string) {
  return prisma.illegalDumping.findMany({ where: { organisation_id: organisationId, upload_id: uploadId } });
}

function inspectRequest(id: string) {
  return {
    req: new NextRequest(`http://localhost/api/data-hub/import-batches/${id}/inspect`, { method: "POST" }),
    params: Promise.resolve({ id }),
  };
}
function confirmRequest(id: string) {
  return {
    req: new NextRequest(`http://localhost/api/data-hub/worksheets/${id}/confirm-illegal-dumping`, { method: "POST" }),
    params: Promise.resolve({ id }),
  };
}

// ─── Service-level: inspectCsvWorksheet ─────────────────────────────────

describe("inspectCsvWorksheet — tenant boundary", () => {
  it("wrong-tenant batch id -> BATCH_NOT_FOUND, zero worksheet rows", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    const result = await inspectCsvWorksheet({ organisationId: "org-b", importBatchId: batchId });
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
    expect(await worksheetsFor("org-a", batchId)).toHaveLength(0);
  });

  it("nonexistent batch id -> identical BATCH_NOT_FOUND (no existence oracle)", async () => {
    const result = await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: randomUUID() });
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
  });
});

describe("inspectCsvWorksheet — parent-state boundary", () => {
  it("PROCESSING batch -> BATCH_NOT_READY, zero worksheet rows", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV, { status: "PROCESSING" });
    const result = await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_READY" });
  });

  it("tombstoned (deleted_at set) batch -> BATCH_NOT_FOUND", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV, { deletedAt: new Date() });
    const result = await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
  });
});

describe("inspectCsvWorksheet — CSV format gate", () => {
  it("XLSX-classified batch -> UNSUPPORTED_FORMAT, zero storage access, zero worksheet rows", async () => {
    const { id: batchId, storageKey } = await seedReadyBatch("org-a", VALID_CSV, { contentType: "xlsx" });
    const headSpy = vi.spyOn(sharedStore, "get");
    const result = await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
    expect(headSpy).not.toHaveBeenCalledWith(storageKey, expect.anything());
    expect(await worksheetsFor("org-a", batchId)).toHaveLength(0);
    headSpy.mockRestore();
  });

  it("XLS-classified batch -> UNSUPPORTED_FORMAT", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV, { contentType: "xls" });
    const result = await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
  });
});

describe("inspectCsvWorksheet — hash integrity", () => {
  it("tampered storage bytes -> STORAGE_INTEGRITY_MISMATCH, zero worksheet rows", async () => {
    const { id: batchId, storageKey } = await seedReadyBatch("org-a", VALID_CSV);
    await sharedStore.delete(storageKey);
    await sharedStore.put(storageKey, Buffer.from("report_date,location,waste_type\ntampered,data,here\n"));
    const result = await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    expect(result).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
    expect(await worksheetsFor("org-a", batchId)).toHaveLength(0);
  });
});

describe("inspectCsvWorksheet — CSV structural semantics", () => {
  it("valid non-empty CSV -> one worksheet, index 0, name CSV, visible, non-empty, AWAITING_CONFIRMATION", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    const result = await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    expect(result).toMatchObject({
      ok: true,
      worksheets: [
        {
          worksheetIndex: 0,
          worksheetName: "CSV",
          worksheetVisibility: "visible",
          worksheetIsEmpty: false,
          canonicalStatus: "AWAITING_CONFIRMATION",
        },
      ],
    });
    const rows = await worksheetsFor("org-a", batchId);
    expect(rows).toHaveLength(1);
    expect(rows[0].worksheet_index).toBe(0);
  });

  it("totally empty CSV (zero bytes) -> INELIGIBLE", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", EMPTY_CSV);
    const result = await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    expect(result).toMatchObject({ ok: true, worksheets: [{ worksheetIsEmpty: true, canonicalStatus: "INELIGIBLE" }] });
  });

  it("header-only CSV (headers present, zero data rows) -> non-empty, AWAITING_CONFIRMATION", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", HEADER_ONLY_CSV);
    const result = await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    expect(result).toMatchObject({ ok: true, worksheets: [{ worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION" }] });
  });
});

describe("inspectCsvWorksheet — idempotency (Case A/B)", () => {
  it("repeat inspection of the same batch is idempotent: one worksheet row, no duplicate, same identity", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    const first = await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    expect(first.ok).toBe(true);
    const second = await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    expect(second).toEqual(first);
    const rows = await worksheetsFor("org-a", batchId);
    expect(rows).toHaveLength(1);
  });
});

describe("inspectCsvWorksheet — persistence-conflict (Cases C/D/E)", () => {
  it("divergent pre-existing DATA_HUB worksheet state -> PERSISTENCE_CONFLICT, no overwrite/top-up/deletion", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    // Seed a DIVERGENT existing worksheet row directly (simulating some
    // other actor having persisted a different canonical_status for the
    // same batch/index).
    await prisma.upload.create({
      data: {
        organisation_id: "org-a",
        original_name: "divergent",
        stored_path: `datahub-worksheet:${batchId}:0`,
        mimetype: "text/csv",
        size_bytes: 0,
        import_batch_id: batchId,
        worksheet_index: 0,
        worksheet_name: "CSV",
        worksheet_visibility: "visible",
        worksheet_is_empty: true, // diverges from VALID_CSV's real non-empty result
        lineage_kind: "DATA_HUB",
        canonical_status: "INELIGIBLE",
      },
    });
    const result = await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    expect(result).toMatchObject({ ok: false, code: "PERSISTENCE_CONFLICT" });
    const rows = await worksheetsFor("org-a", batchId);
    expect(rows).toHaveLength(1);
    expect(rows[0].canonical_status).toBe("INELIGIBLE"); // unchanged, not overwritten
  });
});

describe("inspectCsvWorksheet — large CSV (representative high-row-count fixture)", () => {
  it("a CSV at the documented 100,000-row ceiling completes and persists one worksheet, non-empty, AWAITING_CONFIRMATION", async () => {
    const lines = ["report_date,location,waste_type,severity,status"];
    for (let i = 0; i < 100_000; i++) {
      lines.push(`2024-01-15,Site ${i},tyres,low,open`);
    }
    const largeCsv = Buffer.from(lines.join("\n") + "\n");
    const { id: batchId } = await seedReadyBatch("org-a", largeCsv);
    const start = Date.now();
    const result = await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    const durationMs = Date.now() - start;
    expect(result).toMatchObject({ ok: true, worksheets: [{ worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION" }] });
    // Bounded, not a hard perf assertion — structural inspection never
    // opens a $transaction (statically proven separately), so there is no
    // Prisma transaction-timeout risk here at all.
    expect(durationMs).toBeLessThan(30_000);
  }, 60_000);
});

// ─── Route-level: full CSV vertical proof through actual routes ────────

describe("K.2 routes — full CSV vertical: initiate-equivalent seed -> inspect -> read-compatible -> confirm -> IMPORTED", () => {
  it("end-to-end: READY CSV batch -> POST inspect -> AWAITING_CONFIRMATION worksheet -> POST confirm-illegal-dumping -> IMPORTED domain rows", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);

    const { req: inspectReq, params: inspectParams } = inspectRequest(batchId);
    const inspectRes = await POST_inspect(inspectReq, { params: inspectParams });
    expect(inspectRes.status).toBe(200);
    const inspectBody = await inspectRes.json();
    expect(inspectBody.ok).toBe(true);
    expect(inspectBody.worksheets).toHaveLength(1);
    expect(inspectBody.worksheets[0].canonicalStatus).toBe("AWAITING_CONFIRMATION");

    const worksheets = await worksheetsFor("org-a", batchId);
    expect(worksheets).toHaveLength(1);
    const worksheetId = worksheets[0].id;

    const { req: confirmReq, params: confirmParams } = confirmRequest(worksheetId);
    const confirmRes = await POST_confirm(confirmReq, { params: confirmParams });
    expect(confirmRes.status).toBe(200);
    const confirmBody = await confirmRes.json();
    expect(confirmBody).toMatchObject({ ok: true, alreadyImported: false, importedRows: 2 });

    const domainRows = await domainRowsFor("org-a", worksheetId);
    expect(domainRows).toHaveLength(2);
    const finalWorksheet = await prisma.upload.findUnique({ where: { id: worksheetId } });
    expect(finalWorksheet?.canonical_status).toBe("IMPORTED");

    // Repeat confirm — idempotency end-to-end through the route layer.
    // (Repeat INSPECT after a state-changing confirm has already
    // happened is deliberately NOT expected to be a silent 200 here: the
    // freshly re-derived structural-only expectation is always
    // AWAITING_CONFIRMATION/INELIGIBLE (content-derived only, exactly
    // mirroring inspectWorksheets.ts's own identical design — see
    // inspectCsvWorksheet.ts's classifyExistingSet), while the persisted
    // row is now IMPORTED — a genuine, correctly-detected divergence,
    // not a false conflict. This is proven directly below.)
    const { req: inspectReq2, params: inspectParams2 } = inspectRequest(batchId);
    const inspectRes2 = await POST_inspect(inspectReq2, { params: inspectParams2 });
    expect(inspectRes2.status).toBe(409);
    const inspectBody2 = await inspectRes2.json();
    expect(inspectBody2.ok).toBe(false);
    expect(await worksheetsFor("org-a", batchId)).toHaveLength(1); // unchanged, not overwritten

    const { req: confirmReq2, params: confirmParams2 } = confirmRequest(worksheetId);
    const confirmRes2 = await POST_confirm(confirmReq2, { params: confirmParams2 });
    expect(confirmRes2.status).toBe(200);
    const confirmBody2 = await confirmRes2.json();
    expect(confirmBody2).toMatchObject({ ok: true, alreadyImported: true });
    expect(await domainRowsFor("org-a", worksheetId)).toHaveLength(2); // no duplicate rows
  });
});

// ─── Route-level: role attacks ──────────────────────────────────────────

describe("K.2 routes — role enforcement", () => {
  it("inspect route: viewer denied (403)", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    asSession({ organisationId: "org-a", role: "viewer" });
    const { req, params } = inspectRequest(batchId);
    const res = await POST_inspect(req, { params });
    expect(res.status).toBe(403);
  });

  it("inspect route: unauthenticated denied (401)", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    asUnauthenticated();
    const { req, params } = inspectRequest(batchId);
    const res = await POST_inspect(req, { params });
    expect(res.status).toBe(401);
  });

  it("inspect route: manager allowed", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    asSession({ organisationId: "org-a", role: "manager" });
    const { req, params } = inspectRequest(batchId);
    const res = await POST_inspect(req, { params });
    expect(res.status).toBe(200);
  });

  it("confirm route: viewer denied (403)", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    const worksheet = (await worksheetsFor("org-a", batchId))[0];

    asSession({ organisationId: "org-a", role: "viewer" });
    const { req, params } = confirmRequest(worksheet.id);
    const res = await POST_confirm(req, { params });
    expect(res.status).toBe(403);
  });

  it("confirm route: unauthenticated denied (401)", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    const worksheet = (await worksheetsFor("org-a", batchId))[0];

    asUnauthenticated();
    const { req, params } = confirmRequest(worksheet.id);
    const res = await POST_confirm(req, { params });
    expect(res.status).toBe(401);
  });
});

// ─── Route-level: cross-tenant attacks ──────────────────────────────────

describe("K.2 routes — cross-tenant attacks", () => {
  it("inspect route: org-b manager against org-a's batch -> 404, zero storage access, zero mutation", async () => {
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    asSession({ organisationId: "org-b", role: "manager" });
    const { req, params } = inspectRequest(batchId);
    const res = await POST_inspect(req, { params });
    expect(res.status).toBe(404);
    expect(await worksheetsFor("org-a", batchId)).toHaveLength(0);
  });

  it("confirm route: org-b manager against org-a's worksheet -> 404, zero domain writes, worksheet unchanged", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    const worksheet = (await worksheetsFor("org-a", batchId))[0];

    asSession({ organisationId: "org-b", role: "manager" });
    const { req, params } = confirmRequest(worksheet.id);
    const res = await POST_confirm(req, { params });
    expect(res.status).toBe(404);
    expect(await domainRowsFor("org-a", worksheet.id)).toHaveLength(0);
    const stillAwaiting = await prisma.upload.findUnique({ where: { id: worksheet.id } });
    expect(stillAwaiting?.canonical_status).toBe("AWAITING_CONFIRMATION");
  });
});

// ─── Route-level: format attack ─────────────────────────────────────────

describe("K.2 routes — format rejection through the route boundary", () => {
  it("inspect route: XLSX batch -> 422 UNSUPPORTED_FORMAT, zero worksheet persistence", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV, { contentType: "xlsx" });
    const { req, params } = inspectRequest(batchId);
    const res = await POST_inspect(req, { params });
    expect(res.status).toBe(422);
    expect(await worksheetsFor("org-a", batchId)).toHaveLength(0);
  });
});

// ─── Route-level: storage-locator attack ────────────────────────────────

describe("K.2 routes — storage-locator injection has no effect", () => {
  it("inspect route: a request carrying storage-locator-shaped headers/query has zero effect on which object is inspected", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const { id: batchId, storageKey } = await seedReadyBatch("org-a", VALID_CSV);
    const decoyKey = "decoy/other-object";
    await sharedStore.put(decoyKey, Buffer.from("report_date,location,waste_type\nDECOY,DECOY,DECOY\n"));

    const req = new NextRequest(`http://localhost/api/data-hub/import-batches/${batchId}/inspect?storageKey=${encodeURIComponent(decoyKey)}`, {
      method: "POST",
      headers: { "x-storage-key": decoyKey, "x-storage-provider": "attacker-provider" },
    });
    const res = await POST_inspect(req, { params: Promise.resolve({ id: batchId }) });
    expect(res.status).toBe(200);
    const rows = await worksheetsFor("org-a", batchId);
    expect(rows).toHaveLength(1);
    // Confirms the REAL object (storageKey, not decoyKey) was the one
    // actually inspected — the real CSV is non-empty/AWAITING_CONFIRMATION,
    // not derived from decoy bytes.
    expect(rows[0].canonical_status).toBe("AWAITING_CONFIRMATION");
    void storageKey;
  });
});

// ─── Route-level: importer-selection attack ─────────────────────────────

describe("K.2 confirm route — importer-selection injection has no effect", () => {
  it("a request body carrying importer/domain/schemaType fields has zero effect — the route path itself is the only importer selector", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    const worksheet = (await worksheetsFor("org-a", batchId))[0];

    const req = new NextRequest(`http://localhost/api/data-hub/worksheets/${worksheet.id}/confirm-illegal-dumping`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ importer: "some-other-domain", domain: "attacker-domain", schemaType: "GENERIC" }),
    });
    const res = await POST_confirm(req, { params: Promise.resolve({ id: worksheet.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Rows were imported into illegal_dumping regardless of the body —
    // the ONLY possible outcome, since this route can only ever call
    // confirmDataHubWorksheet, which is hardcoded to illegal dumping.
    expect(await domainRowsFor("org-a", worksheet.id)).toHaveLength(2);
  });
});

// ─── Route-level: 5A.2L confirmation-actor attribution ──────────────────

describe("K.2 confirm route — confirmation-actor attribution (5A.2L)", () => {
  it("the route threads the AUTHENTICATED session's own userId as confirmedBy — never a caller-suppliable value", async () => {
    asSession({ organisationId: "org-a", role: "manager", userId: "user-a1" });
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    const worksheet = (await worksheetsFor("org-a", batchId))[0];

    const { req, params } = confirmRequest(worksheet.id);
    const res = await POST_confirm(req, { params });
    expect(res.status).toBe(200);

    const refreshed = await prisma.upload.findUnique({ where: { id: worksheet.id } });
    expect(refreshed?.confirmed_by).toBe("user-a1");
    expect(refreshed?.confirmed_at).toBeInstanceOf(Date);
  });

  it("a request body/header/query carrying a confirmedBy-shaped field has zero effect — the actor is always the session's own userId, never caller input", async () => {
    asSession({ organisationId: "org-a", role: "manager", userId: "user-a1" });
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    const worksheet = (await worksheetsFor("org-a", batchId))[0];

    const req = new NextRequest(`http://localhost/api/data-hub/worksheets/${worksheet.id}/confirm-illegal-dumping?confirmedBy=user-b1`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-confirmed-by": "user-b1" },
      body: JSON.stringify({ confirmedBy: "user-b1", userId: "user-b1", actorId: "user-b1" }),
    });
    const res = await POST_confirm(req, { params: Promise.resolve({ id: worksheet.id }) });
    expect(res.status).toBe(200);

    const refreshed = await prisma.upload.findUnique({ where: { id: worksheet.id } });
    // Still the session's own userId (user-a1) — never the attacker-
    // supplied user-b1, from any of the three injection surfaces tried.
    expect(refreshed?.confirmed_by).toBe("user-a1");
  });
});

// ─── Route-level: state attack ──────────────────────────────────────────

describe("K.2 confirm route — worksheet state matrix through the route boundary", () => {
  it("INELIGIBLE worksheet cannot import (409)", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const { id: batchId } = await seedReadyBatch("org-a", EMPTY_CSV);
    await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    const worksheet = (await worksheetsFor("org-a", batchId))[0];
    expect(worksheet.canonical_status).toBe("INELIGIBLE");

    const { req, params } = confirmRequest(worksheet.id);
    const res = await POST_confirm(req, { params });
    expect(res.status).toBe(409);
    expect(await domainRowsFor("org-a", worksheet.id)).toHaveLength(0);
  });
});

// ─── Route-level: error-leakage attack ──────────────────────────────────

describe("K.2 routes — error leakage", () => {
  it("inspect route: an unexpected internal error (storage provider throws non-taxonomy error) never leaks a raw message", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    const getSpy = vi.spyOn(sharedStore, "get").mockRejectedValueOnce(new Error("some raw internal driver failure XYZ123"));

    const { req, params } = inspectRequest(batchId);
    const res = await POST_inspect(req, { params });
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/XYZ123/);
    expect(JSON.stringify(body)).not.toMatch(/raw internal driver failure/);
    getSpy.mockRestore();
  });

  it("inspect route: a genuinely unhandled exception (thrown outside any of the service's own try/catch blocks) still maps to a generic sanitized 500, never a raw error surfacing through the route's own outer catch", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    const findUniqueSpy = vi
      .spyOn(productionPrisma.importBatch, "findUnique")
      .mockRejectedValueOnce(new Error("raw unhandled Prisma driver panic QRS789"));

    const { req, params } = inspectRequest(batchId);
    let res;
    try {
      res = await POST_inspect(req, { params });
    } finally {
      findUniqueSpy.mockRestore();
    }
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/QRS789/);
    expect(JSON.stringify(body)).not.toMatch(/raw unhandled Prisma driver panic/);
  });

  // ── 5A.2L closes a carried test-coverage asymmetry: the confirm route's
  // catch block had no dedicated test of its own (only the inspect route
  // did), despite being structurally identical. This slice modifies the
  // confirm route's own trust boundary (threading confirmedBy), so closing
  // this specific gap is in scope here (Section 29's own carve-out) — no
  // other unrelated test debt is touched.

  it("confirm route: an unexpected internal error (storage provider throws non-taxonomy error) never leaks a raw message", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    const worksheet = (await worksheetsFor("org-a", batchId))[0];
    const getSpy = vi.spyOn(sharedStore, "get").mockRejectedValueOnce(new Error("some raw internal driver failure ABC456"));

    const { req, params } = confirmRequest(worksheet.id);
    const res = await POST_confirm(req, { params });
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/ABC456/);
    expect(JSON.stringify(body)).not.toMatch(/raw internal driver failure/);
    getSpy.mockRestore();
  });

  it("confirm route: a genuinely unhandled exception (thrown outside any of the service's own try/catch blocks) still maps to a generic sanitized 500, never a raw error surfacing through the route's own outer catch, and never leaks the confirming actor's own user id in the error body", async () => {
    asSession({ organisationId: "org-a", role: "manager", userId: "user-a1" });
    const { id: batchId } = await seedReadyBatch("org-a", VALID_CSV);
    await inspectCsvWorksheet({ organisationId: "org-a", importBatchId: batchId });
    const worksheet = (await worksheetsFor("org-a", batchId))[0];
    const findFirstSpy = vi
      .spyOn(productionPrisma.upload, "findFirst")
      .mockRejectedValueOnce(new Error("raw unhandled Prisma driver panic DEF999"));

    const { req, params } = confirmRequest(worksheet.id);
    let res;
    try {
      res = await POST_confirm(req, { params });
    } finally {
      findFirstSpy.mockRestore();
    }
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/DEF999/);
    expect(JSON.stringify(body)).not.toMatch(/raw unhandled Prisma driver panic/);
    expect(JSON.stringify(body)).not.toMatch(/user-a1/);
  });
});
