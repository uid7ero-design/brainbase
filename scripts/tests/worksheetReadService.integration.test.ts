import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// Data Hub 5A.2H.2 — real disposable-Postgres integration harness for the
// dark tenant-safe worksheet/ImportBatch read services (read.ts).
//
// Run ONLY via scripts/tests/verify-worksheet-read-service.sh, which
// starts a disposable postgres:16-alpine Docker container, applies the
// exact scripts/create-import-batches.sql migration against the same
// bootstrap schema used by inspectWorksheets.integration.test.ts
// (organisations/users/uploads, including the real SchemaType/
// UploadStatus/Module Postgres enums), exports DATABASE_URL to point at
// that container, then runs `npx vitest run --config
// vitest.integration.config.ts scripts/tests/worksheetReadService.integration.test.ts`.
// NEVER run this file directly against any other DATABASE_URL — the same
// guard rail as every sibling Data Hub integration spec refuses to start
// if DATABASE_URL is unset or looks like a real hosted/Neon/production
// endpoint.
//
// This suite exercises the REAL, unmodified production
// lib/data-hub/importBatch/read.ts functions against a REAL Postgres
// instance — never a duplicated/parallel copy of their SQL/Prisma calls.
// read.ts touches no storage adapter at all, so unlike its sibling specs
// there is no InMemoryFileStore/compositionRoot mock to wire up here.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "worksheetReadService.integration.test.ts requires DATABASE_URL to point at a disposable Postgres " +
      "container (see scripts/tests/verify-worksheet-read-service.sh). Refusing to run without it."
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

let getImportBatch: typeof import("@/lib/data-hub/importBatch/read").getImportBatch;
let listImportBatches: typeof import("@/lib/data-hub/importBatch/read").listImportBatches;
let getWorksheet: typeof import("@/lib/data-hub/importBatch/read").getWorksheet;
let listWorksheetsForBatch: typeof import("@/lib/data-hub/importBatch/read").listWorksheetsForBatch;

beforeAll(async () => {
  ({ getImportBatch, listImportBatches, getWorksheet, listWorksheetsForBatch } = await import(
    "@/lib/data-hub/importBatch/read"
  ));

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

// Each test seeds its own fresh rows (unique ids via randomUUID) rather
// than relying on truncation between tests — matches the sibling specs'
// convention (no global beforeEach reset in
// inspectWorksheets.integration.test.ts either) and avoids any risk of
// cross-test interference through shared fixed ids.

async function seedBatch(params: {
  organisationId: string;
  status?: string;
  sha256?: string | null;
  contentType?: string;
  originalFilename?: string;
  sizeBytes?: number;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
  lastFailureCode?: string | null;
  lastFailureMessage?: string | null;
  lastFailureRetryable?: boolean | null;
  attemptCount?: number;
  lastAttemptAt?: Date | null;
  uploadedBy?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await prisma.importBatch.create({
    data: {
      id,
      organisation_id: params.organisationId,
      original_filename: params.originalFilename ?? "fixture.csv",
      content_type: params.contentType ?? "csv",
      size_bytes: params.sizeBytes ?? 100,
      sha256: params.sha256 === undefined ? "a".repeat(64) : params.sha256,
      storage_provider: "vercel-blob-private",
      storage_key: `datahub/${params.organisationId}/${id}`,
      status: params.status ?? "READY",
      created_at: params.createdAt,
      updated_at: params.updatedAt,
      deleted_at: params.deletedAt ?? null,
      last_failure_code: params.lastFailureCode ?? null,
      last_failure_message: params.lastFailureMessage ?? null,
      last_failure_retryable: params.lastFailureRetryable ?? null,
      attempt_count: params.attemptCount ?? 0,
      last_attempt_at: params.lastAttemptAt ?? null,
      uploaded_by: params.uploadedBy ?? null,
    },
  });
  return id;
}

async function seedWorksheet(params: {
  organisationId: string;
  importBatchId: string;
  worksheetIndex: number;
  worksheetName?: string;
  worksheetVisibility?: string;
  worksheetIsEmpty?: boolean;
  canonicalStatus?: string;
  confirmedBy?: string | null;
  confirmedAt?: Date | null;
}): Promise<string> {
  const id = randomUUID();
  await prisma.upload.create({
    data: {
      id,
      organisation_id: params.organisationId,
      original_name: `fixture :: worksheet[${params.worksheetIndex}]`,
      stored_path: `datahub-worksheet:${params.importBatchId}:${params.worksheetIndex}`,
      mimetype: "text/csv",
      size_bytes: 0,
      import_batch_id: params.importBatchId,
      worksheet_index: params.worksheetIndex,
      worksheet_name: params.worksheetName ?? `Sheet${params.worksheetIndex}`,
      worksheet_visibility: params.worksheetVisibility ?? "visible",
      worksheet_is_empty: params.worksheetIsEmpty ?? false,
      lineage_kind: "DATA_HUB",
      canonical_status: params.canonicalStatus ?? "AWAITING_CONFIRMATION",
      confirmed_by: params.confirmedBy ?? null,
      confirmed_at: params.confirmedAt ?? null,
    },
  });
  return id;
}

async function seedLegacyUpload(organisationId: string): Promise<string> {
  const id = randomUUID();
  await prisma.upload.create({
    data: {
      id,
      organisation_id: organisationId,
      original_name: "legacy-fixture.csv",
      stored_path: "/tmp/legacy-fixture.csv",
      mimetype: "text/csv",
      size_bytes: 10,
      // lineage_kind defaults to LEGACY; import_batch_id/worksheet_index/
      // canonical_status all stay NULL per the coherence CHECK.
    },
  });
  return id;
}

// ─── 1/2 — tenant A cannot get/list tenant B's batches ─────────────────

describe("integration — batch tenant isolation", () => {
  it("1. tenant A cannot get tenant B's batch — BATCH_NOT_FOUND", async () => {
    const batchB = await seedBatch({ organisationId: "org-b" });
    const result = await getImportBatch({ organisationId: "org-a", importBatchId: batchB });
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
  });

  it("2. tenant A cannot list tenant B's batches", async () => {
    const batchB = await seedBatch({ organisationId: "org-b" });
    const result = await listImportBatches({ organisationId: "org-a" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.batches.map((b) => b.id)).not.toContain(batchB);
    }
  });
});

// ─── 3/4/5 — tenant A cannot get/list tenant B's worksheets ────────────

describe("integration — worksheet tenant isolation", () => {
  it("3/5. tenant A cannot get tenant B's worksheet (guessed cross-tenant id) — WORKSHEET_NOT_FOUND", async () => {
    const batchB = await seedBatch({ organisationId: "org-b" });
    const worksheetB = await seedWorksheet({ organisationId: "org-b", importBatchId: batchB, worksheetIndex: 0 });
    const result = await getWorksheet({ organisationId: "org-a", worksheetId: worksheetB });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
  });

  it("4. tenant A cannot list tenant B's worksheets via a guessed batch id — BATCH_NOT_FOUND", async () => {
    const batchB = await seedBatch({ organisationId: "org-b" });
    await seedWorksheet({ organisationId: "org-b", importBatchId: batchB, worksheetIndex: 0 });
    const result = await listWorksheetsForBatch({ organisationId: "org-a", importBatchId: batchB });
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
  });
});

// ─── 6 — LEGACY-lineage Upload id ───────────────────────────────────────

describe("integration — lineage isolation", () => {
  it("6. a LEGACY-lineage Upload id (correct tenant) returns WORKSHEET_NOT_FOUND", async () => {
    const legacyId = await seedLegacyUpload("org-a");
    const result = await getWorksheet({ organisationId: "org-a", worksheetId: legacyId });
    expect(result).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
  });
});

// ─── 7/8 — indistinguishable errors ─────────────────────────────────────

describe("integration — indistinguishable not-found errors (IDOR-safety proof)", () => {
  it("7. nonexistent batch and wrong-tenant batch produce byte-identical error", async () => {
    const batchB = await seedBatch({ organisationId: "org-b" });
    const wrongTenant = await getImportBatch({ organisationId: "org-a", importBatchId: batchB });
    const nonexistent = await getImportBatch({ organisationId: "org-a", importBatchId: randomUUID() });
    expect(wrongTenant).toEqual(nonexistent);
  });

  it("8. nonexistent worksheet, wrong-tenant worksheet, and legacy worksheet all produce byte-identical error", async () => {
    const batchB = await seedBatch({ organisationId: "org-b" });
    const worksheetB = await seedWorksheet({ organisationId: "org-b", importBatchId: batchB, worksheetIndex: 0 });
    const legacyId = await seedLegacyUpload("org-a");

    const nonexistent = await getWorksheet({ organisationId: "org-a", worksheetId: randomUUID() });
    const wrongTenant = await getWorksheet({ organisationId: "org-a", worksheetId: worksheetB });
    const legacy = await getWorksheet({ organisationId: "org-a", worksheetId: legacyId });

    expect(nonexistent).toEqual(wrongTenant);
    expect(wrongTenant).toEqual(legacy);
  });
});

// ─── 9 — deterministic worksheet ordering ───────────────────────────────

describe("integration — deterministic worksheet ordering", () => {
  it("9. listWorksheetsForBatch returns strictly worksheet_index ASC regardless of insertion order", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    // Insert out of order: 2, 0, 1.
    await seedWorksheet({ organisationId: "org-a", importBatchId: batch, worksheetIndex: 2 });
    await seedWorksheet({ organisationId: "org-a", importBatchId: batch, worksheetIndex: 0 });
    await seedWorksheet({ organisationId: "org-a", importBatchId: batch, worksheetIndex: 1 });

    const result = await listWorksheetsForBatch({ organisationId: "org-a", importBatchId: batch });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.worksheets.map((w) => w.worksheetIndex)).toEqual([0, 1, 2]);
    }
  });

  it("a valid tenant-owned batch with zero worksheets returns success with an empty array (not an error)", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    const result = await listWorksheetsForBatch({ organisationId: "org-a", importBatchId: batch });
    expect(result).toEqual({ ok: true, worksheets: [] });
  });
});

// ─── 10/11 — deterministic batch pagination ordering ────────────────────

describe("integration — deterministic batch ordering", () => {
  it("10. listImportBatches orders strictly by created_at DESC", async () => {
    const older = await seedBatch({ organisationId: "org-a", createdAt: new Date("2026-01-01T00:00:00Z") });
    const newer = await seedBatch({ organisationId: "org-a", createdAt: new Date("2026-01-02T00:00:00Z") });

    const result = await listImportBatches({ organisationId: "org-a", limit: 200 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.batches.map((b) => b.id);
      expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older));
    }
  });

  it("11. identical created_at values tie-break by id DESC", async () => {
    const sameInstant = new Date("2026-03-01T00:00:00Z");
    const idA = randomUUID();
    const idB = randomUUID();
    const [lower, higher] = [idA, idB].sort();
    await prisma.importBatch.create({
      data: {
        id: lower,
        organisation_id: "org-a",
        original_filename: "tie-a.csv",
        content_type: "csv",
        size_bytes: 1,
        sha256: "a".repeat(64),
        storage_provider: "vercel-blob-private",
        storage_key: `datahub/org-a/${lower}`,
        status: "READY",
        created_at: sameInstant,
      },
    });
    await prisma.importBatch.create({
      data: {
        id: higher,
        organisation_id: "org-a",
        original_filename: "tie-b.csv",
        content_type: "csv",
        size_bytes: 1,
        sha256: "a".repeat(64),
        storage_provider: "vercel-blob-private",
        storage_key: `datahub/org-a/${higher}`,
        status: "READY",
        created_at: sameInstant,
      },
    });

    const result = await listImportBatches({ organisationId: "org-a", limit: 200 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.batches.map((b) => b.id);
      expect(ids.indexOf(higher)).toBeLessThan(ids.indexOf(lower));
    }
  });
});

// ─── 12/13/14 — real multi-page traversal ───────────────────────────────

describe("integration — keyset pagination correctness", () => {
  it("12. pagination across multiple pages has no duplicates or omissions", async () => {
    const orgId = `org-pg12-${randomUUID()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO organisations (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT (id) DO NOTHING`,
      orgId
    );
    const seededIds: string[] = [];
    for (let i = 0; i < 7; i++) {
      const id = await seedBatch({
        organisationId: orgId,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      });
      seededIds.push(id);
    }

    const collected: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await listImportBatches({ organisationId: orgId, limit: 3, cursor });
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      collected.push(...result.batches.map((b) => b.id));
      if (!result.hasNextPage) break;
      cursor = result.nextCursor ?? undefined;
    }

    expect(collected.length).toBe(7);
    expect(new Set(collected).size).toBe(7);
    expect(new Set(collected)).toEqual(new Set(seededIds));
  });

  it("12b. a keyset tie-break across a page boundary (identical created_at split across two pages) never re-includes the cursor's own row and never omits its tied sibling", async () => {
    const orgId = `org-pg12b-${randomUUID()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO organisations (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT (id) DO NOTHING`,
      orgId
    );
    const sameInstant = new Date("2026-06-01T00:00:00Z");
    const idA = randomUUID();
    const idB = randomUUID();
    const [higher, lower] = [idA, idB].sort().reverse(); // higher id sorts first (id DESC)
    for (const id of [higher, lower]) {
      await prisma.importBatch.create({
        data: {
          id,
          organisation_id: orgId,
          original_filename: "tie.csv",
          content_type: "csv",
          size_bytes: 1,
          sha256: "a".repeat(64),
          storage_provider: "vercel-blob-private",
          storage_key: `datahub/${orgId}/${id}`,
          status: "READY",
          created_at: sameInstant,
        },
      });
    }

    // limit=1 forces the tie to be split across exactly two pages.
    const page1 = await listImportBatches({ organisationId: orgId, limit: 1 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.batches.map((b) => b.id)).toEqual([higher]);
    expect(page1.hasNextPage).toBe(true);

    const page2 = await listImportBatches({ organisationId: orgId, limit: 1, cursor: page1.nextCursor ?? undefined });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    // The cursor's own row (higher) must never reappear; its tied sibling
    // (lower) must appear exactly once.
    expect(page2.batches.map((b) => b.id)).toEqual([lower]);
    expect(page2.hasNextPage).toBe(false);
  });

  it("13. inserting a newer batch between page requests does not corrupt an already-established keyset traversal", async () => {
    const orgId = `org-pg13-${randomUUID()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO organisations (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT (id) DO NOTHING`,
      orgId
    );
    const seededIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await seedBatch({
        organisationId: orgId,
        createdAt: new Date(Date.UTC(2026, 1, 1, 0, 0, i)),
      });
      seededIds.push(id);
    }

    const page1 = await listImportBatches({ organisationId: orgId, limit: 2 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.hasNextPage).toBe(true);

    // Insert a batch newer than everything seeded so far, strictly AFTER
    // page 1 was fetched.
    const intrudingId = await seedBatch({
      organisationId: orgId,
      createdAt: new Date(Date.UTC(2026, 1, 2, 0, 0, 0)),
    });

    const page2 = await listImportBatches({ organisationId: orgId, limit: 2, cursor: page1.nextCursor ?? undefined });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;

    // The intruding (newer-than-cursor) batch must never appear on page 2
    // — the keyset predicate is strictly "older than the cursor tuple".
    expect(page2.batches.map((b) => b.id)).not.toContain(intrudingId);

    const page3Ids: string[] = [];
    let cursor = page2.nextCursor ?? undefined;
    let hasNext = page2.hasNextPage;
    const allIds = [...page1.batches.map((b) => b.id), ...page2.batches.map((b) => b.id)];
    while (hasNext) {
      const next = await listImportBatches({ organisationId: orgId, limit: 2, cursor });
      expect(next.ok).toBe(true);
      if (!next.ok) break;
      allIds.push(...next.batches.map((b) => b.id));
      hasNext = next.hasNextPage;
      cursor = next.nextCursor ?? undefined;
    }

    // Every originally-seeded id was traversed exactly once; the intruder
    // never appears anywhere in the traversal that started before it existed.
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const id of seededIds) {
      expect(allIds).toContain(id);
    }
    expect(allIds).not.toContain(intrudingId);
    void page3Ids;
  });

  it("14. pagination never crosses tenant even across a full multi-page traversal", async () => {
    const orgA = `org-pg14a-${randomUUID()}`;
    const orgB = `org-pg14b-${randomUUID()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO organisations (id, name, slug) VALUES ($1, $1, $1), ($2, $2, $2) ON CONFLICT (id) DO NOTHING`,
      orgA,
      orgB
    );
    for (let i = 0; i < 4; i++) {
      await seedBatch({ organisationId: orgA, createdAt: new Date(Date.UTC(2026, 2, 1, 0, 0, i)) });
    }
    for (let i = 0; i < 9; i++) {
      await seedBatch({ organisationId: orgB, createdAt: new Date(Date.UTC(2026, 2, 1, 0, 0, i)) });
    }

    const collected: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await listImportBatches({ organisationId: orgA, limit: 1, cursor });
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      collected.push(...result.batches.map((b) => b.id));
      if (!result.hasNextPage) break;
      cursor = result.nextCursor ?? undefined;
    }
    expect(collected.length).toBe(4);

    const orgBRows = await prisma.importBatch.findMany({ where: { organisation_id: orgB }, select: { id: true } });
    const orgBIds = new Set(orgBRows.map((r) => r.id));
    for (const id of collected) {
      expect(orgBIds.has(id)).toBe(false);
    }
  });
});

// ─── 5A.2H.2 remediation — sub-millisecond pagination precision ─────────
//
// This is the permanent regression for the blocker the independent
// adversarial review found: import_batches.created_at is a genuine
// microsecond-precision TIMESTAMPTZ, but every OTHER fixture in this file
// seeds created_at via a JS Date (through seedBatch/prisma.importBatch.create)
// or a `new Date(...)` literal — which is inherently millisecond-precision
// at the moment of construction, so it can never exercise the actual bug.
// This fixture instead inserts rows via raw, parameterized SQL with an
// explicit microsecond-bearing timestamp literal, bypassing the JS Date
// type entirely at seed time, then independently proves (via Postgres's
// own to_char output) that the distinct microseconds genuinely landed in
// the column before ever calling listImportBatches.
async function seedBatchWithRawTimestamp(
  organisationId: string,
  createdAtLiteral: string,
  explicitId?: string
): Promise<string> {
  const id = explicitId ?? randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO import_batches (
       id, organisation_id, original_filename, content_type, size_bytes,
       sha256, storage_provider, storage_key, status, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)`,
    id,
    organisationId,
    "sub-ms-fixture.csv",
    "csv",
    1,
    "a".repeat(64),
    "vercel-blob-private",
    `datahub/${organisationId}/${id}`,
    "READY",
    createdAtLiteral
  );
  return id;
}

describe("integration — sub-millisecond pagination precision (5A.2H.2 remediation regression)", () => {
  it("a full paginated traversal (limit=1) omits nothing and duplicates nothing when rows share a millisecond but differ only in microseconds", async () => {
    const orgId = `org-submsprec-${randomUUID()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO organisations (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT (id) DO NOTHING`,
      orgId
    );

    // Three rows, all within the SAME millisecond (.123), differing only in
    // the microsecond digits below it.
    //
    // The id<->timestamp pairing below is DELIBERATELY adversarial, not
    // random: ids are assigned in ASCENDING order to DESCENDING
    // timestamps (highest real created_at gets the SMALLEST id). This
    // makes the traversal's completeness deterministic regardless of
    // which precision the implementation actually orders by:
    //   - correct (millisecond-truncated ORDER BY, this bucket ties):
    //     falls through to id DESC -> deterministically idMax, idMid, idMin.
    //   - buggy (raw-precision ORDER BY, as in the pre-remediation
    //     candidate): returns highest-raw-timestamp first regardless of
    //     id, which is idMin here — so the very next page's `id <
    //     cursor.id` predicate can satisfy NO remaining row (idMin is
    //     already the smallest), deterministically truncating the
    //     traversal at 1 of 3 rows every run, not just probabilistically.
    // This was independently verified: an earlier version of this test
    // used unordered random ids and did NOT reliably catch a reintroduced
    // raw-precision ORDER BY mutation (whether omission occurred depended
    // on random id ordering vs. timestamp ordering, in this fixture
    // roughly a 1-in-3 make-it-pass-by-luck failure mode) — this
    // deterministic pairing was required to make the falsification proof
    // (Section 16 of the 5A.2H.2 remediation spec) reliable.
    const literals = [
      "2026-05-01 00:00:00.123900+00", // highest real timestamp
      "2026-05-01 00:00:00.123500+00",
      "2026-05-01 00:00:00.123100+00", // lowest real timestamp
    ];
    const rawIds = [randomUUID(), randomUUID(), randomUUID()].sort(); // ascending
    const [idMin, idMid, idMax] = rawIds;
    const idsByDescendingTimestamp = [idMin, idMid, idMax];
    const seededIds: string[] = [];
    for (let i = 0; i < literals.length; i++) {
      seededIds.push(await seedBatchWithRawTimestamp(orgId, literals[i], idsByDescendingTimestamp[i]));
    }

    // Prove the fixture genuinely retained distinct microseconds BEFORE
    // exercising listImportBatches at all — via Postgres's own to_char,
    // never via a JS Date round-trip (which is exactly what would erase
    // the distinction this test depends on).
    const rawRows = await prisma.$queryRawUnsafe<{ id: string; us: string }[]>(
      `SELECT id, to_char(created_at, 'YYYY-MM-DD HH24:MI:SS.US') AS us
       FROM import_batches WHERE organisation_id = $1 ORDER BY created_at ASC`,
      orgId
    );
    expect(rawRows).toHaveLength(3);
    const distinctMicrosecondValues = new Set(rawRows.map((r) => r.us));
    expect(distinctMicrosecondValues.size).toBe(3);
    for (const row of rawRows) {
      expect(row.us.startsWith("2026-05-01 00:00:00.123")).toBe(true);
    }

    // Expected traversal order once all three collapse into ONE
    // millisecond-truncated bucket: strictly id DESC among the tied rows
    // (see read.ts's PRECISION note on listImportBatches — ORDER BY and
    // the WHERE-clause cursor boundary both operate on
    // date_trunc('milliseconds', created_at)).
    const expectedOrder = [...seededIds].sort().reverse();

    const collected: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await listImportBatches({ organisationId: orgId, limit: 1, cursor });
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      collected.push(...result.batches.map((b) => b.id));
      if (!result.hasNextPage) break;
      cursor = result.nextCursor ?? undefined;
    }

    // The historical bug (pre-remediation): this traversal terminated after
    // exactly 1 of the 3 rows, silently and permanently omitting the other
    // two. Post-remediation: every row is visited exactly once.
    expect(collected.length).toBe(3);
    expect(new Set(collected).size).toBe(3);
    expect(new Set(collected)).toEqual(new Set(seededIds));
    expect(collected).toEqual(expectedOrder);
  });

  it("a single unpaginated call (limit >= row count) also returns every sub-millisecond-tied row exactly once", async () => {
    const orgId = `org-submsprec2-${randomUUID()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO organisations (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT (id) DO NOTHING`,
      orgId
    );
    const literals = ["2026-05-02 12:00:00.500010+00", "2026-05-02 12:00:00.500990+00"];
    const seededIds: string[] = [];
    for (const literal of literals) {
      seededIds.push(await seedBatchWithRawTimestamp(orgId, literal));
    }

    const result = await listImportBatches({ organisationId: orgId, limit: 200 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hasNextPage).toBe(false);
    expect(new Set(result.batches.map((b) => b.id))).toEqual(new Set(seededIds));
  });
});

// ─── 15/16 — cursor/limit validation ────────────────────────────────────

describe("integration — cursor and limit validation", () => {
  it("15. a malformed cursor returns INVALID_CURSOR", async () => {
    const result = await listImportBatches({ organisationId: "org-a", cursor: "not-a-valid-cursor!!" });
    expect(result).toMatchObject({ ok: false, code: "INVALID_CURSOR" });
  });

  it("15b. a syntactically-valid-base64 but structurally wrong cursor returns INVALID_CURSOR", async () => {
    const bogus = Buffer.from(JSON.stringify({ foo: "bar" }), "utf8").toString("base64url");
    const result = await listImportBatches({ organisationId: "org-a", cursor: bogus });
    expect(result).toMatchObject({ ok: false, code: "INVALID_CURSOR" });
  });

  it("16. limit <= 0 returns INVALID_LIMIT", async () => {
    const zero = await listImportBatches({ organisationId: "org-a", limit: 0 });
    expect(zero).toMatchObject({ ok: false, code: "INVALID_LIMIT" });
    const negative = await listImportBatches({ organisationId: "org-a", limit: -5 });
    expect(negative).toMatchObject({ ok: false, code: "INVALID_LIMIT" });
  });

  it("16b. limit > 200 returns INVALID_LIMIT", async () => {
    const result = await listImportBatches({ organisationId: "org-a", limit: 201 });
    expect(result).toMatchObject({ ok: false, code: "INVALID_LIMIT" });
  });

  it("16c. a non-integer limit returns INVALID_LIMIT", async () => {
    const result = await listImportBatches({ organisationId: "org-a", limit: 1.5 });
    expect(result).toMatchObject({ ok: false, code: "INVALID_LIMIT" });
  });

  it("limit at exactly the max bound (200) is accepted", async () => {
    const result = await listImportBatches({ organisationId: "org-a", limit: 200 });
    expect(result.ok).toBe(true);
  });

  it("a cursor minted under tenant A returns only tenant B's own rows (or none) when submitted under tenant B's trusted context — never tenant A's rows", async () => {
    const orgA = `org-cursorforge-a-${randomUUID()}`;
    const orgB = `org-cursorforge-b-${randomUUID()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO organisations (id, name, slug) VALUES ($1, $1, $1), ($2, $2, $2) ON CONFLICT (id) DO NOTHING`,
      orgA,
      orgB
    );
    const aIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      aIds.push(await seedBatch({ organisationId: orgA, createdAt: new Date(Date.UTC(2026, 3, 1, 0, 0, i)) }));
    }
    const bIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      bIds.push(await seedBatch({ organisationId: orgB, createdAt: new Date(Date.UTC(2026, 3, 1, 0, 0, i)) }));
    }

    // Mint a real cursor under tenant A's own traversal.
    const forgedFrom = await listImportBatches({ organisationId: orgA, limit: 1 });
    expect(forgedFrom.ok).toBe(true);
    if (!forgedFrom.ok) return;
    expect(forgedFrom.hasNextPage).toBe(true);
    const forgedCursor = forgedFrom.nextCursor;
    expect(forgedCursor).toBeTruthy();

    // Submit that identical cursor string under tenant B's trusted context.
    const underB = await listImportBatches({ organisationId: orgB, limit: 200, cursor: forgedCursor ?? undefined });
    expect(underB.ok).toBe(true);
    if (!underB.ok) return;
    const returnedIds = new Set(underB.batches.map((b) => b.id));
    for (const id of aIds) {
      expect(returnedIds.has(id)).toBe(false);
    }
    for (const id of returnedIds) {
      expect(bIds).toContain(id);
    }
  });

  it("a syntactically-valid but entirely fabricated cursor tuple (no corresponding row) repositions harmlessly — no error, no leak, no altered ordering", async () => {
    const orgId = `org-cursorfab-${randomUUID()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO organisations (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT (id) DO NOTHING`,
      orgId
    );
    const realId = await seedBatch({ organisationId: orgId, createdAt: new Date("2026-04-15T00:00:00Z") });

    const fabricated = Buffer.from(
      JSON.stringify({ createdAt: new Date("2099-01-01T00:00:00Z").toISOString(), id: "does-not-exist-anywhere" }),
      "utf8"
    ).toString("base64url");

    const result = await listImportBatches({ organisationId: orgId, limit: 200, cursor: fabricated });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.batches.map((b) => b.id)).toEqual([realId]);
    expect(result.hasNextPage).toBe(false);
  });
});

// ─── 17/18/19/20 — truthful worksheet metadata for every status ────────

describe("integration — truthful worksheet metadata for every visibility/status", () => {
  it("17. a hidden worksheet is returned truthfully, not filtered out", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    await seedWorksheet({
      organisationId: "org-a",
      importBatchId: batch,
      worksheetIndex: 0,
      worksheetVisibility: "hidden",
      canonicalStatus: "INELIGIBLE",
    });
    const result = await listWorksheetsForBatch({ organisationId: "org-a", importBatchId: batch });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.worksheets).toHaveLength(1);
      expect(result.worksheets[0].worksheetVisibility).toBe("hidden");
    }
  });

  it("18. a veryHidden worksheet is returned truthfully", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    await seedWorksheet({
      organisationId: "org-a",
      importBatchId: batch,
      worksheetIndex: 0,
      worksheetVisibility: "veryHidden",
      canonicalStatus: "INELIGIBLE",
    });
    const result = await listWorksheetsForBatch({ organisationId: "org-a", importBatchId: batch });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.worksheets[0].worksheetVisibility).toBe("veryHidden");
    }
  });

  it("19. an empty, INELIGIBLE worksheet is returned truthfully", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    await seedWorksheet({
      organisationId: "org-a",
      importBatchId: batch,
      worksheetIndex: 0,
      worksheetIsEmpty: true,
      canonicalStatus: "INELIGIBLE",
    });
    const result = await listWorksheetsForBatch({ organisationId: "org-a", importBatchId: batch });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.worksheets[0]).toMatchObject({ worksheetIsEmpty: true, canonicalStatus: "INELIGIBLE" });
    }
  });

  it("20. SKIPPED and IMPORTED canonical_status values remain representable/readable if legally seeded", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    const skippedId = await seedWorksheet({
      organisationId: "org-a",
      importBatchId: batch,
      worksheetIndex: 0,
      canonicalStatus: "SKIPPED",
    });
    const importedId = await seedWorksheet({
      organisationId: "org-a",
      importBatchId: batch,
      worksheetIndex: 1,
      canonicalStatus: "IMPORTED",
    });

    const skipped = await getWorksheet({ organisationId: "org-a", worksheetId: skippedId });
    const imported = await getWorksheet({ organisationId: "org-a", worksheetId: importedId });
    expect(skipped).toMatchObject({ ok: true, worksheet: { canonicalStatus: "SKIPPED" } });
    expect(imported).toMatchObject({ ok: true, worksheet: { canonicalStatus: "IMPORTED" } });

    const list = await listWorksheetsForBatch({ organisationId: "org-a", importBatchId: batch });
    expect(list.ok).toBe(true);
    if (list.ok) {
      const statuses = list.worksheets.map((w) => w.canonicalStatus).sort();
      expect(statuses).toEqual(["IMPORTED", "SKIPPED"]);
    }
  });
});

// ─── 21/22 — lifecycle read policy ──────────────────────────────────────

describe("integration — lifecycle read policy", () => {
  it("21. a FAILED batch's detail DTO exposes the approved failure metadata", async () => {
    const batch = await seedBatch({
      organisationId: "org-a",
      status: "FAILED",
      sha256: null,
      lastFailureCode: "PROVIDER_FAILURE",
      lastFailureMessage: "A storage provider error occurred while processing this file. This may be a temporary condition; a retry may succeed.",
      lastFailureRetryable: true,
      attemptCount: 2,
      lastAttemptAt: new Date("2026-04-01T00:00:00Z"),
    });
    const result = await getImportBatch({ organisationId: "org-a", importBatchId: batch });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.batch).toMatchObject({
        status: "FAILED",
        lastFailureCode: "PROVIDER_FAILURE",
        lastFailureRetryable: true,
        attemptCount: 2,
      });
      expect(result.batch.lastFailureMessage).toContain("storage provider error");
    }
  });

  it("22. a DELETION_PENDING batch remains readable via get, list, and worksheet listing", async () => {
    const batch = await seedBatch({ organisationId: "org-a", status: "DELETION_PENDING" });
    await seedWorksheet({ organisationId: "org-a", importBatchId: batch, worksheetIndex: 0 });

    const got = await getImportBatch({ organisationId: "org-a", importBatchId: batch });
    expect(got).toMatchObject({ ok: true, batch: { status: "DELETION_PENDING" } });

    const listed = await listImportBatches({ organisationId: "org-a", limit: 200 });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.batches.map((b) => b.id)).toContain(batch);
    }

    const worksheets = await listWorksheetsForBatch({ organisationId: "org-a", importBatchId: batch });
    expect(worksheets.ok).toBe(true);
    if (worksheets.ok) {
      expect(worksheets.worksheets).toHaveLength(1);
    }
  });

  it("a batch in every non-tombstoned lifecycle state is readable via getImportBatch", async () => {
    for (const status of ["AWAITING_UPLOAD", "PROCESSING", "READY", "FAILED", "DELETION_PENDING"]) {
      const batch = await seedBatch({
        organisationId: "org-a",
        status,
        sha256: status === "AWAITING_UPLOAD" || status === "PROCESSING" || status === "FAILED" ? null : "a".repeat(64),
        lastFailureCode: status === "FAILED" ? "PROVIDER_FAILURE" : null,
        lastFailureRetryable: status === "FAILED" ? true : null,
      });
      const result = await getImportBatch({ organisationId: "org-a", importBatchId: batch });
      expect(result).toMatchObject({ ok: true, batch: { status } });
    }
  });
});

// ─── 23 — tombstone exclusion + cascading worksheet exclusion ──────────

describe("integration — tombstone policy", () => {
  it("23. a tombstoned batch is excluded from getImportBatch and listImportBatches", async () => {
    const batch = await seedBatch({ organisationId: "org-a", deletedAt: new Date("2026-05-01T00:00:00Z") });

    const got = await getImportBatch({ organisationId: "org-a", importBatchId: batch });
    expect(got).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });

    const listed = await listImportBatches({ organisationId: "org-a", limit: 200 });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.batches.map((b) => b.id)).not.toContain(batch);
    }
  });

  it("23b. listWorksheetsForBatch on a tombstoned batch returns BATCH_NOT_FOUND, never an empty-list success", async () => {
    const batch = await seedBatch({ organisationId: "org-a", deletedAt: new Date("2026-05-01T00:00:00Z") });
    const result = await listWorksheetsForBatch({ organisationId: "org-a", importBatchId: batch });
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
  });

  it("23c. getWorksheet never exposes a worksheet whose parent batch is tombstoned — WORKSHEET_NOT_FOUND", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    const worksheetId = await seedWorksheet({ organisationId: "org-a", importBatchId: batch, worksheetIndex: 0 });

    // Confirm the worksheet IS readable before the parent is tombstoned.
    const before = await getWorksheet({ organisationId: "org-a", worksheetId });
    expect(before.ok).toBe(true);

    // Tombstone the parent batch directly (5A.2K's own deletion mechanics
    // don't exist yet; this test only proves read.ts's own exclusion).
    await prisma.importBatch.update({ where: { id: batch }, data: { deleted_at: new Date() } });

    const after = await getWorksheet({ organisationId: "org-a", worksheetId });
    expect(after).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
  });
});

// ─── 24 — empty tenant ──────────────────────────────────────────────────

describe("integration — empty tenant", () => {
  it("24. a tenant with zero batches gets an empty list, not an error", async () => {
    const emptyOrgId = `org-empty-${randomUUID()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO organisations (id, name, slug) VALUES ($1, $1, $1) ON CONFLICT (id) DO NOTHING`,
      emptyOrgId
    );
    const result = await listImportBatches({ organisationId: emptyOrgId });
    expect(result).toEqual({ ok: true, batches: [], hasNextPage: false, nextCursor: null });
  });
});

// ─── 25 — DTO own-key-set proof (no forbidden field leakage) ───────────

describe("integration — DTO own-key-set leakage proof", () => {
  it("25a. getImportBatch's detail DTO exposes exactly the approved key set", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    const result = await getImportBatch({ organisationId: "org-a", importBatchId: batch });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new Set(Object.keys(result.batch))).toEqual(
        new Set([
          "id",
          "status",
          "originalFilename",
          "contentType",
          "sizeBytes",
          "createdAt",
          "updatedAt",
          "sha256",
          "uploadedBy",
          "attemptCount",
          "lastAttemptAt",
          "lastFailureCode",
          "lastFailureMessage",
          "lastFailureRetryable",
          "deletedAt",
        ])
      );
    }
  });

  it("25b. listImportBatches' summary DTO exposes exactly the approved key set", async () => {
    await seedBatch({ organisationId: "org-a" });
    const result = await listImportBatches({ organisationId: "org-a", limit: 1 });
    expect(result.ok).toBe(true);
    if (result.ok && result.batches[0]) {
      expect(new Set(Object.keys(result.batches[0]))).toEqual(
        new Set(["id", "status", "originalFilename", "contentType", "sizeBytes", "createdAt", "updatedAt"])
      );
    }
  });

  it("25c. getWorksheet/listWorksheetsForBatch's worksheet DTO exposes exactly the approved key set", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    const worksheetId = await seedWorksheet({ organisationId: "org-a", importBatchId: batch, worksheetIndex: 0 });
    const expectedKeys = new Set([
      "id",
      "worksheetIndex",
      "worksheetName",
      "worksheetVisibility",
      "worksheetIsEmpty",
      "canonicalStatus",
      "importBatchId",
      "createdAt",
      "updatedAt",
      // 5A.2L — durable confirmation-actor attribution.
      "confirmedBy",
      "confirmedAt",
    ]);

    const got = await getWorksheet({ organisationId: "org-a", worksheetId });
    expect(got.ok).toBe(true);
    if (got.ok) expect(new Set(Object.keys(got.worksheet))).toEqual(expectedKeys);

    const listed = await listWorksheetsForBatch({ organisationId: "org-a", importBatchId: batch });
    expect(listed.ok).toBe(true);
    if (listed.ok && listed.worksheets[0]) {
      expect(new Set(Object.keys(listed.worksheets[0]))).toEqual(expectedKeys);
    }
  });
});

// ─── 5A.2L — confirmation-actor attribution surfaced through reads ──────

describe("integration — 5A.2L confirmedBy/confirmedAt read exposure", () => {
  it("a worksheet never confirmed exposes confirmedBy/confirmedAt as null through both getWorksheet and listWorksheetsForBatch", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    const worksheetId = await seedWorksheet({ organisationId: "org-a", importBatchId: batch, worksheetIndex: 0 });

    const got = await getWorksheet({ organisationId: "org-a", worksheetId });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.worksheet.confirmedBy).toBeNull();
      expect(got.worksheet.confirmedAt).toBeNull();
    }

    const listed = await listWorksheetsForBatch({ organisationId: "org-a", importBatchId: batch });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.worksheets[0].confirmedBy).toBeNull();
      expect(listed.worksheets[0].confirmedAt).toBeNull();
    }
  });

  it("a confirmed worksheet's actor/timestamp round-trip correctly (raw id, no profile join) through both getWorksheet and listWorksheetsForBatch", async () => {
    const confirmedAt = new Date("2025-06-01T12:00:00.000Z");
    const batch = await seedBatch({ organisationId: "org-a" });
    const worksheetId = await seedWorksheet({
      organisationId: "org-a",
      importBatchId: batch,
      worksheetIndex: 0,
      canonicalStatus: "IMPORTED",
      confirmedBy: "user-a1",
      confirmedAt,
    });

    const got = await getWorksheet({ organisationId: "org-a", worksheetId });
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.worksheet.confirmedBy).toBe("user-a1");
      expect(got.worksheet.confirmedAt).toBeInstanceOf(Date);
      expect(got.worksheet.confirmedAt?.toISOString()).toBe(confirmedAt.toISOString());
    }

    const listed = await listWorksheetsForBatch({ organisationId: "org-a", importBatchId: batch });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.worksheets[0].confirmedBy).toBe("user-a1");
    }
  });

  it("cross-tenant reads cannot observe another tenant's confirmation-actor attribution — the existing WORKSHEET_NOT_FOUND/BATCH_NOT_FOUND abstraction covers these new fields too, never a partial/leaked DTO", async () => {
    const batchA = await seedBatch({ organisationId: "org-a" });
    const worksheetA = await seedWorksheet({
      organisationId: "org-a",
      importBatchId: batchA,
      worksheetIndex: 0,
      canonicalStatus: "IMPORTED",
      confirmedBy: "user-a1",
      confirmedAt: new Date(),
    });

    const crossTenantGet = await getWorksheet({ organisationId: "org-b", worksheetId: worksheetA });
    expect(crossTenantGet).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });

    const crossTenantList = await listWorksheetsForBatch({ organisationId: "org-b", importBatchId: batchA });
    expect(crossTenantList).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
  });
});
