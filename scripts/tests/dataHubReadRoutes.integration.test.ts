import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";

// Data Hub 5A.2H.3 — real disposable-Postgres integration harness for the
// four read-only Data Hub HTTP routes (app/api/data-hub/**).
//
// Run ONLY via scripts/tests/verify-datahub-read-routes.sh. Same guard
// rail as every sibling Data Hub integration spec: refuses to run
// without a localhost-only DATABASE_URL.
//
// TEST SEAM (Section 23 of the H.3 implementation spec): this suite uses
// a controlled auth seam — lib/org's requireRole is mocked so each test
// can set an exact session (organisationId, role) — but the CRITICAL
// tenant/lineage/tombstone/pagination boundary is NEVER mocked: every
// route handler here is the real, unmodified exported GET function,
// invoked directly (matching this repo's own established route-testing
// convention — see e.g. no jsdom/supertest anywhere in this codebase),
// running its real query against a real Postgres instance via read.ts's
// own prisma singleton (which picks up DATABASE_URL from the environment
// exactly as it does in production).

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "dataHubReadRoutes.integration.test.ts requires DATABASE_URL to point at a disposable Postgres " +
      "container (see scripts/tests/verify-datahub-read-routes.sh). Refusing to run without it."
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

// process.env.DATABASE_URL is already set by the harness script before
// vitest starts — lib/prisma.ts's own singleton (imported transitively by
// the route handlers via read.ts) picks it up with no extra wiring. This
// second, explicit PrismaClient instance is only for the TEST's own
// seeding/fixture work, mirroring worksheetReadService.integration.test.ts's
// exact convention.
const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

// ─── Controlled auth seam ────────────────────────────────────────────
// lib/org's requireRole is the ONLY mocked module in this suite. Each
// test sets `nextSession` (a resolved session) or `nextAuthError` (a
// rejection) immediately before invoking a route.

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

let GET_batches: typeof import("@/app/api/data-hub/import-batches/route").GET;
let GET_batch: typeof import("@/app/api/data-hub/import-batches/[id]/route").GET;
let GET_worksheets: typeof import("@/app/api/data-hub/import-batches/[id]/worksheets/route").GET;
let GET_worksheet: typeof import("@/app/api/data-hub/worksheets/[id]/route").GET;

beforeAll(async () => {
  ({ GET: GET_batches } = await import("@/app/api/data-hub/import-batches/route"));
  ({ GET: GET_batch } = await import("@/app/api/data-hub/import-batches/[id]/route"));
  ({ GET: GET_worksheets } = await import("@/app/api/data-hub/import-batches/[id]/worksheets/route"));
  ({ GET: GET_worksheet } = await import("@/app/api/data-hub/worksheets/[id]/route"));

  await prisma.$executeRawUnsafe(`
    INSERT INTO organisations (id, name, slug) VALUES
      ('org-a', 'Org A', 'org-a'),
      ('org-b', 'Org B', 'org-b')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedBatch(params: {
  organisationId: string;
  status?: string;
  deletedAt?: Date | null;
}): Promise<string> {
  const id = randomUUID();
  await prisma.importBatch.create({
    data: {
      id,
      organisation_id: params.organisationId,
      original_filename: "fixture.csv",
      content_type: "csv",
      size_bytes: 100,
      sha256: "a".repeat(64),
      storage_provider: "vercel-blob-private",
      storage_key: `datahub/${params.organisationId}/${id}`,
      status: params.status ?? "READY",
      deleted_at: params.deletedAt ?? null,
    },
  });
  return id;
}

async function seedWorksheet(params: {
  organisationId: string;
  importBatchId: string;
  worksheetIndex: number;
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
      worksheet_name: `Sheet${params.worksheetIndex}`,
      worksheet_visibility: "visible",
      worksheet_is_empty: false,
      lineage_kind: "DATA_HUB",
      canonical_status: "AWAITING_CONFIRMATION",
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
    },
  });
  return id;
}

function req(url: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost"));
}
function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ─── 1/2/3/4 — auth ──────────────────────────────────────────────────

describe("integration — HTTP auth", () => {
  it("1. unauthenticated -> 401", async () => {
    asUnauthenticated();
    const res = await GET_batches(req("/api/data-hub/import-batches"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("2. insufficient role (viewer) -> 403", async () => {
    asSession({ organisationId: "org-a", role: "viewer" });
    const res = await GET_batches(req("/api/data-hub/import-batches"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("3. manager succeeds -> 200", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await GET_batches(req("/api/data-hub/import-batches"));
    expect(res.status).toBe(200);
  });

  it("4. admin succeeds -> 200", async () => {
    asSession({ organisationId: "org-a", role: "admin" });
    const res = await GET_batches(req("/api/data-hub/import-batches"));
    expect(res.status).toBe(200);
  });
});

// ─── 5/6 — trusted tenant context ───────────────────────────────────

describe("integration — trusted tenant context", () => {
  it("5. super_admin impersonating org-b (organisationId != homeOrganisationId) sees org-b's own batch, not org-a's", async () => {
    const batchA = await seedBatch({ organisationId: "org-a" });
    const batchB = await seedBatch({ organisationId: "org-b" });
    asSession({ organisationId: "org-b", homeOrganisationId: "org-a", role: "super_admin" });
    const res = await GET_batches(req("/api/data-hub/import-batches"));
    const body = await res.json();
    const ids = body.batches.map((b: { id: string }) => b.id);
    expect(ids).toContain(batchB);
    expect(ids).not.toContain(batchA);
  });

  it("6. a client-supplied organisationId in the query string cannot override the trusted session organisation", async () => {
    const batchA = await seedBatch({ organisationId: "org-a" });
    const batchB = await seedBatch({ organisationId: "org-b" });
    asSession({ organisationId: "org-a", role: "manager" });
    // Attempt injection via an organisationId query param the route never
    // even reads — if it were (incorrectly) honored, org-b's batch would
    // leak into org-a's own session's result.
    const res = await GET_batches(req("/api/data-hub/import-batches?organisationId=org-b"));
    const body = await res.json();
    const ids = body.batches.map((b: { id: string }) => b.id);
    expect(ids).toContain(batchA);
    expect(ids).not.toContain(batchB);
  });
});

// ─── 7/8/9/10 — tenant isolation ────────────────────────────────────

describe("integration — tenant isolation", () => {
  it("7. tenant A cannot GET tenant B's batch -> 404", async () => {
    const batchB = await seedBatch({ organisationId: "org-b" });
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await GET_batch(req(`/api/data-hub/import-batches/${batchB}`), params(batchB));
    expect(res.status).toBe(404);
  });

  it("8. tenant A cannot list tenant B's batches", async () => {
    const batchB = await seedBatch({ organisationId: "org-b" });
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await GET_batches(req("/api/data-hub/import-batches"));
    const body = await res.json();
    expect(body.batches.map((b: { id: string }) => b.id)).not.toContain(batchB);
  });

  it("9. tenant A cannot GET tenant B's worksheet -> 404", async () => {
    const batchB = await seedBatch({ organisationId: "org-b" });
    const wsB = await seedWorksheet({ organisationId: "org-b", importBatchId: batchB, worksheetIndex: 0 });
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await GET_worksheet(req(`/api/data-hub/worksheets/${wsB}`), params(wsB));
    expect(res.status).toBe(404);
  });

  it("10. tenant A cannot list tenant B's worksheets (batch itself not found)", async () => {
    const batchB = await seedBatch({ organisationId: "org-b" });
    await seedWorksheet({ organisationId: "org-b", importBatchId: batchB, worksheetIndex: 0 });
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await GET_worksheets(req(`/api/data-hub/import-batches/${batchB}/worksheets`), params(batchB));
    expect(res.status).toBe(404);
  });
});

// ─── 11/12 — external indistinguishability ──────────────────────────

describe("integration — wrong-tenant/nonexistent/legacy indistinguishability", () => {
  it("11. wrong-tenant batch and nonexistent batch produce byte-identical 404 responses", async () => {
    const batchB = await seedBatch({ organisationId: "org-b" });
    asSession({ organisationId: "org-a", role: "manager" });
    const resWrongTenant = await GET_batch(req(`/api/data-hub/import-batches/${batchB}`), params(batchB));
    const resNonexistent = await GET_batch(req("/api/data-hub/import-batches/does-not-exist"), params("does-not-exist"));
    expect(resWrongTenant.status).toBe(resNonexistent.status);
    expect(await resWrongTenant.json()).toEqual(await resNonexistent.json());
  });

  it("12. wrong-tenant, nonexistent, and LEGACY worksheet ids all produce byte-identical 404 responses", async () => {
    const batchB = await seedBatch({ organisationId: "org-b" });
    const wsB = await seedWorksheet({ organisationId: "org-b", importBatchId: batchB, worksheetIndex: 0 });
    const batchA = await seedBatch({ organisationId: "org-a" });
    const legacyA = await seedLegacyUpload("org-a");
    asSession({ organisationId: "org-a", role: "manager" });
    void batchA;
    const [wrongTenant, nonexistent, legacy] = await Promise.all([
      GET_worksheet(req(`/api/data-hub/worksheets/${wsB}`), params(wsB)),
      GET_worksheet(req("/api/data-hub/worksheets/does-not-exist"), params("does-not-exist")),
      GET_worksheet(req(`/api/data-hub/worksheets/${legacyA}`), params(legacyA)),
    ]);
    const bodies = await Promise.all([wrongTenant.json(), nonexistent.json(), legacy.json()]);
    expect(wrongTenant.status).toBe(404);
    expect(nonexistent.status).toBe(404);
    expect(legacy.status).toBe(404);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
  });
});

// ─── 13/14 — tombstones ──────────────────────────────────────────────

describe("integration — tombstone behavior through HTTP", () => {
  it("13. a tombstoned batch is hidden (404) from GET", async () => {
    const batch = await seedBatch({ organisationId: "org-a", deletedAt: new Date() });
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await GET_batch(req(`/api/data-hub/import-batches/${batch}`), params(batch));
    expect(res.status).toBe(404);
  });

  it("14. a worksheet whose parent batch is tombstoned is hidden (404) from GET", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    const ws = await seedWorksheet({ organisationId: "org-a", importBatchId: batch, worksheetIndex: 0 });
    await prisma.importBatch.update({ where: { id: batch }, data: { deleted_at: new Date() } });
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await GET_worksheet(req(`/api/data-hub/worksheets/${ws}`), params(ws));
    expect(res.status).toBe(404);
  });
});

// ─── 15/16/17 — pagination input validation ─────────────────────────

describe("integration — pagination input validation", () => {
  it("15. invalid limit -> deterministic 400", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await GET_batches(req("/api/data-hub/import-batches?limit=0"));
    expect(res.status).toBe(400);
  });

  it("16. malformed cursor -> deterministic 400", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await GET_batches(req("/api/data-hub/import-batches?cursor=not-valid-base64!!"));
    expect(res.status).toBe(400);
  });

  it("17. oversized cursor (>2000 chars) -> deterministic 400 without reaching the H.2 service", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const huge = "a".repeat(2001);
    const res = await GET_batches(req(`/api/data-hub/import-batches?cursor=${huge}`));
    expect(res.status).toBe(400);
  });
});

// ─── 18 — valid pagination ───────────────────────────────────────────

describe("integration — valid pagination through HTTP", () => {
  it("18. valid pagination traverses all seeded batches with no omissions/duplicates", async () => {
    const org = `org-page-${randomUUID()}`;
    await prisma.$executeRawUnsafe(`INSERT INTO organisations (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, org, org, org);
    const ids = await Promise.all(Array.from({ length: 5 }, () => seedBatch({ organisationId: org })));
    asSession({ organisationId: org, role: "manager" });

    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const url = cursor
        ? `/api/data-hub/import-batches?limit=2&cursor=${encodeURIComponent(cursor)}`
        : "/api/data-hub/import-batches?limit=2";
      const res = await GET_batches(req(url));
      const body = await res.json();
      for (const b of body.batches) seen.add(b.id);
      if (!body.hasNextPage) break;
      cursor = body.nextCursor;
    }
    expect(seen).toEqual(new Set(ids));
  });
});

// ─── 19/20/21 — response contract ────────────────────────────────────

describe("integration — response contract", () => {
  it("19. batch createdAt/updatedAt serialize as ISO date strings", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await GET_batch(req(`/api/data-hub/import-batches/${batch}`), params(batch));
    const body = await res.json();
    expect(typeof body.batch.createdAt).toBe("string");
    expect(new Date(body.batch.createdAt).toISOString()).toBe(body.batch.createdAt);
  });

  it("20. batch detail response contains exactly the approved DTO key set — no storage/legacy fields", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await GET_batch(req(`/api/data-hub/import-batches/${batch}`), params(batch));
    const body = await res.json();
    expect(new Set(Object.keys(body.batch))).toEqual(
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
  });

  it("20b. worksheet response contains exactly the approved DTO key set", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    const ws = await seedWorksheet({ organisationId: "org-a", importBatchId: batch, worksheetIndex: 0 });
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await GET_worksheet(req(`/api/data-hub/worksheets/${ws}`), params(ws));
    const body = await res.json();
    expect(new Set(Object.keys(body.worksheet))).toEqual(
      new Set([
        "id",
        "worksheetIndex",
        "worksheetName",
        "worksheetVisibility",
        "worksheetIsEmpty",
        "canonicalStatus",
        "importBatchId",
        "createdAt",
        "updatedAt",
      ])
    );
  });

  it("21. Cache-Control is private, no-store on both success and error responses", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const ok = await GET_batches(req("/api/data-hub/import-batches"));
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
    const err = await GET_batches(req("/api/data-hub/import-batches?limit=0"));
    expect(err.headers.get("Cache-Control")).toBe("private, no-store");
    const authErr = await (async () => {
      asUnauthenticated();
      return GET_batches(req("/api/data-hub/import-batches"));
    })();
    expect(authErr.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

// ─── worksheets-for-batch: empty list vs not-found ───────────────────

describe("integration — worksheets-for-batch semantics", () => {
  it("a valid tenant-owned batch with zero worksheets returns 200 with an empty array (never an error)", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await GET_worksheets(req(`/api/data-hub/import-batches/${batch}/worksheets`), params(batch));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worksheets).toEqual([]);
  });

  it("worksheets are ordered strictly by worksheet_index ascending", async () => {
    const batch = await seedBatch({ organisationId: "org-a" });
    await seedWorksheet({ organisationId: "org-a", importBatchId: batch, worksheetIndex: 2 });
    await seedWorksheet({ organisationId: "org-a", importBatchId: batch, worksheetIndex: 0 });
    await seedWorksheet({ organisationId: "org-a", importBatchId: batch, worksheetIndex: 1 });
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await GET_worksheets(req(`/api/data-hub/import-batches/${batch}/worksheets`), params(batch));
    const body = await res.json();
    expect(body.worksheets.map((w: { worksheetIndex: number }) => w.worksheetIndex)).toEqual([0, 1, 2]);
  });
});

// ─── 22 — sub-millisecond pagination precision through HTTP ─────────
// Reuses the exact 5A.2H.2-remediation technique (raw SQL seeding with
// genuine sub-millisecond-differing timestamps — never JS Date/Prisma
// typed create(), which cannot represent that precision) — proving the
// millisecond-normalization fix continues to hold when traversed through
// the actual HTTP route, not just the raw service function.

describe("integration — sub-millisecond pagination precision through HTTP (5A.2H.2 regression, HTTP boundary)", () => {
  it("a full limit=1 HTTP traversal visits every row exactly once, even when rows share a millisecond and differ only in microseconds", async () => {
    const org = `org-precision-${randomUUID()}`;
    await prisma.$executeRawUnsafe(`INSERT INTO organisations (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, org, org, org);

    const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
    // Same millisecond (.123), strictly increasing microseconds, paired
    // with ASCENDING ids against DESCENDING timestamps (the deterministic
    // pairing established during the 5A.2H.2 remediation's own
    // falsification pass — a random pairing has only a ~1-in-3 chance of
    // actually catching a reintroduced precision bug).
    const timestamps = ["2026-03-01 12:00:00.123100", "2026-03-01 12:00:00.123500", "2026-03-01 12:00:00.123900"];
    for (let i = 0; i < 3; i++) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO import_batches
           (id, organisation_id, original_filename, content_type, size_bytes, sha256,
            storage_provider, storage_key, status, created_at, updated_at)
         VALUES ($1, $2, 'fixture.csv', 'csv', 100, $3, 'vercel-blob-private', $4, 'READY', $5::timestamptz, now())`,
        ids[i],
        org,
        "a".repeat(64),
        `datahub/${org}/${ids[i]}`,
        timestamps[2 - i] // ids ascending <-> timestamps descending
      );
    }

    // Independently prove the fixture genuinely retained distinct
    // microseconds before trusting the traversal assertion below.
    const microCheck = await prisma.$queryRawUnsafe<{ us: string }[]>(
      `SELECT to_char(created_at, 'HH24:MI:SS.US') AS us FROM import_batches WHERE organisation_id = $1 ORDER BY created_at`,
      org
    );
    expect(new Set(microCheck.map((r) => r.us)).size).toBe(3);

    asSession({ organisationId: org, role: "manager" });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const url = cursor
        ? `/api/data-hub/import-batches?limit=1&cursor=${encodeURIComponent(cursor)}`
        : "/api/data-hub/import-batches?limit=1";
      const res = await GET_batches(req(url));
      const body = await res.json();
      for (const b of body.batches) seen.push(b.id);
      if (!body.hasNextPage) break;
      cursor = body.nextCursor;
    }
    expect(seen.length).toBe(3);
    expect(new Set(seen).size).toBe(3);
    expect(new Set(seen)).toEqual(new Set(ids));
  });
});

// ─── 22 (spec numbering) / route-level 500 mapping ───────────────────
// The tenant/lineage/pagination boundary above is always exercised
// against the real, unmocked read.ts. This one isolated case additionally
// mocks read.ts itself (never done anywhere else in this file) purely to
// prove the route's own catch-all 500 mapping never leaks a raw error
// message — a route-level concern, not a tenant-boundary one.

describe("integration — unexpected internal failure mapping", () => {
  it("an unexpected thrown error from the service layer maps to a generic 500, never the raw error text", async () => {
    vi.resetModules();
    vi.doMock("@/lib/data-hub/importBatch/read", () => ({
      getImportBatch: vi.fn(async () => {
        throw new Error("simulated unexpected internal failure: raw stack trace / SQL detail");
      }),
    }));
    const { GET: isolatedGetBatch } = await import("@/app/api/data-hub/import-batches/[id]/route");
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await isolatedGetBatch(req("/api/data-hub/import-batches/whatever"), params("whatever"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toMatch(/simulated unexpected internal failure/);
    expect(body.error).not.toMatch(/raw stack trace/);
    vi.doUnmock("@/lib/data-hub/importBatch/read");
    vi.resetModules();
  });
});
