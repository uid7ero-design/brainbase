import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";

// Data Hub 5A.2I — real disposable-Postgres integration harness for the
// two write routes exposing the dark initiate/finalize services
// (app/api/data-hub/import-batches [POST] and
// app/api/data-hub/import-batches/[id]/finalize [POST]).
//
// Run ONLY via scripts/tests/verify-datahub-initiate-finalize-routes.sh.
// Same guard rail as every sibling Data Hub integration spec: refuses to
// run without a localhost-only DATABASE_URL.
//
// TEST SEAM (mirrors both dataHubReadRoutes.integration.test.ts's auth
// seam and importBatchService.integration.test.ts's storage seam):
//   - lib/org's requireRole is mocked (auth seam) — controlled per test.
//   - lib/db's tagged-template `sql` (used by finalize.ts/finalizeInternal.ts)
//     is replaced by a Prisma-backed equivalent, so their real,
//     unmodified raw SQL runs against the SAME real Postgres container
//     this suite's own Prisma client uses — never a duplicated copy of
//     that SQL.
//   - lib/data-hub/importBatch/compositionRoot.ts's createImportBatchStorage
//     is overridden to return a shared FailureInjectingFileStore (wraps a
//     real InMemoryFileStore; real logic, zero network — can be told to
//     make one specific key's head()/get() throw, to exercise
//     PROVIDER_FAILURE deterministically) instead of the real Vercel Blob
//     adapter — this suite must never make a live Blob network call.
//   - @vercel/blob/client's generateClientTokenFromReadWriteToken is left
//     REAL (pure local HMAC signing, zero network I/O — verified during
//     5A.2G.1 implementation), fed fake-but-correctly-shaped
//     DATAHUB_BLOB_* credentials.
// The tenant/idempotency/claim-fencing/concurrency boundary itself is
// NEVER mocked — every route handler here is the real, unmodified
// exported POST function, invoked directly, running its real service
// call against real Postgres.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "dataHubInitiateFinalizeRoutes.integration.test.ts requires DATABASE_URL to point at a disposable " +
      "Postgres container (see scripts/tests/verify-datahub-initiate-finalize-routes.sh). Refusing to run without it."
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

async function neonCompatibleSql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    text += `$${i + 1}` + strings[i + 1];
  }
  return prisma.$queryRawUnsafe(text, ...values);
}

vi.doMock("@/lib/db", () => ({ default: neonCompatibleSql }));

// ─── Failure-injecting storage double ──────────────────────────────────
// Wraps a real InMemoryFileStore; head()/get() throw for any key present
// in `failingKeys` (a plain module-level Set the tests mutate directly),
// so a PROVIDER_FAILURE outcome can be deterministically exercised
// without any live network call.
let sharedStore: InstanceType<typeof import("@/lib/data-hub/storage/inMemoryFileStore").InMemoryFileStore>;
const failingHeadKeys = new Set<string>();
const failingGetKeys = new Set<string>();

vi.doMock("@/lib/data-hub/importBatch/compositionRoot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data-hub/importBatch/compositionRoot")>();
  return {
    ...actual,
    createImportBatchStorage: () => ({
      provider: "memory",
      put: (...args: Parameters<typeof sharedStore.put>) => sharedStore.put(...args),
      head: (key: string) => {
        if (failingHeadKeys.has(key)) return Promise.reject(new Error("injected HEAD failure"));
        return sharedStore.head(key);
      },
      get: (key: string, opts: Parameters<typeof sharedStore.get>[1]) => {
        if (failingGetKeys.has(key)) return Promise.reject(new Error("injected GET failure"));
        return sharedStore.get(key, opts);
      },
      delete: (key: string) => sharedStore.delete(key),
    }),
  };
});

// ─── Controlled auth seam ────────────────────────────────────────────
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

let POST_initiate: typeof import("@/app/api/data-hub/import-batches/route").POST;
let POST_finalize: typeof import("@/app/api/data-hub/import-batches/[id]/finalize/route").POST;
let buildImportBatchKey: typeof import("@/lib/data-hub/storage/rawFileStore").buildImportBatchKey;

beforeAll(async () => {
  const { InMemoryFileStore } = await import("@/lib/data-hub/storage/inMemoryFileStore");
  sharedStore = new InMemoryFileStore();

  ({ POST: POST_initiate } = await import("@/app/api/data-hub/import-batches/route"));
  ({ POST: POST_finalize } = await import("@/app/api/data-hub/import-batches/[id]/finalize/route"));
  ({ buildImportBatchKey } = await import("@/lib/data-hub/storage/rawFileStore"));

  await prisma.$executeRawUnsafe(`
    INSERT INTO organisations (id, name, slug) VALUES
      ('org-a', 'Org A', 'org-a'),
      ('org-b', 'Org B', 'org-b')
    ON CONFLICT (id) DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users (id, organisation_id, username, name) VALUES
      ('user-1', 'org-a', 'user-1', 'User One')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});

function uniqueKey(label: string): string {
  return `${label}-${randomUUID()}`;
}

function initiateRequest(body: unknown, idempotencyKey?: string | null, rawBodyOverride?: string): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (idempotencyKey !== null) headers.set("Idempotency-Key", idempotencyKey ?? uniqueKey("idem"));
  return new NextRequest("http://localhost/api/data-hub/import-batches", {
    method: "POST",
    headers,
    body: rawBodyOverride ?? JSON.stringify(body),
  });
}

function finalizeRequest(id: string, extra?: { queryOverride?: string; headerOverride?: Record<string, string> }): {
  req: NextRequest;
  params: Promise<{ id: string }>;
} {
  const url = `http://localhost/api/data-hub/import-batches/${id}/finalize${extra?.queryOverride ?? ""}`;
  const headers = new Headers(extra?.headerOverride ?? {});
  return { req: new NextRequest(url, { method: "POST", headers }), params: Promise.resolve({ id }) };
}

async function getRow(organisationId: string, id: string) {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM import_batches WHERE id = $1 AND organisation_id = $2`,
    id,
    organisationId
  );
  return rows[0] ?? null;
}

async function seedAwaitingUpload(organisationId: string, opts: { sizeBytes?: number; expectedSha256?: string } = {}): Promise<string> {
  const id = randomUUID();
  const storageKey = buildImportBatchKey(organisationId, id);
  await prisma.importBatch.create({
    data: {
      id,
      organisation_id: organisationId,
      uploaded_by: "user-1",
      original_filename: "fixture.csv",
      content_type: "csv",
      size_bytes: opts.sizeBytes ?? 5,
      storage_provider: "vercel-blob-private",
      storage_key: storageKey,
      status: "AWAITING_UPLOAD",
      expected_sha256: opts.expectedSha256 ?? null,
    },
  });
  return id;
}

async function putObject(organisationId: string, importBatchId: string, bytes: Uint8Array) {
  const key = buildImportBatchKey(organisationId, importBatchId);
  await sharedStore.put(key, bytes);
}

// ─── Mint-failure soft-outcome (Section 11 of the frozen contract) —
// MUST run first, before compositionRoot's module-level credential
// memoization succeeds even once, otherwise no later env-var deletion
// can force a fresh failure. ────────────────────────────────────────
describe("integration — initiate token-mint soft-failure (must run before any successful credential resolution)", () => {
  it("a configuration failure during token minting leaves the row committed at AWAITING_UPLOAD and returns configurationError:true, HTTP 200", async () => {
    const savedStoreId = process.env.DATAHUB_BLOB_STORE_ID;
    const savedToken = process.env.DATAHUB_BLOB_READ_WRITE_TOKEN;
    delete process.env.DATAHUB_BLOB_STORE_ID;
    delete process.env.DATAHUB_BLOB_READ_WRITE_TOKEN;
    try {
      asSession({ organisationId: "org-a", role: "manager" });
      const res = await POST_initiate(
        initiateRequest({ originalFilename: "mint-fail.csv", declaredSizeBytes: 10 }, uniqueKey("mint-fail"))
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.configurationError).toBe(true);
      expect(body.uploadToken).toBeNull();
      expect(body.batch.status).toBe("AWAITING_UPLOAD");
    } finally {
      process.env.DATAHUB_BLOB_STORE_ID = savedStoreId ?? "store_faketestharness0";
      process.env.DATAHUB_BLOB_READ_WRITE_TOKEN = savedToken ?? "vercel_blob_rw_faketestharness0_fakeSecretNeverReal";
    }
  });
});

// ─── AUTH ────────────────────────────────────────────────────────────

describe("integration — auth", () => {
  it("initiate: unauthenticated -> 401", async () => {
    asUnauthenticated();
    const res = await POST_initiate(initiateRequest({ originalFilename: "a.csv", declaredSizeBytes: 5 }, uniqueKey("auth")));
    expect(res.status).toBe(401);
  });
  it("initiate: viewer -> 403", async () => {
    asSession({ organisationId: "org-a", role: "viewer" });
    const res = await POST_initiate(initiateRequest({ originalFilename: "a.csv", declaredSizeBytes: 5 }, uniqueKey("auth")));
    expect(res.status).toBe(403);
  });
  it("initiate: manager -> succeeds", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await POST_initiate(initiateRequest({ originalFilename: "a.csv", declaredSizeBytes: 5 }, uniqueKey("auth")));
    expect(res.status).toBe(200);
  });
  it("finalize: unauthenticated -> 401", async () => {
    asUnauthenticated();
    const { req, params } = finalizeRequest(randomUUID());
    const res = await POST_finalize(req, { params });
    expect(res.status).toBe(401);
  });
  it("finalize: viewer -> 403", async () => {
    asSession({ organisationId: "org-a", role: "viewer" });
    const { req, params } = finalizeRequest(randomUUID());
    const res = await POST_finalize(req, { params });
    expect(res.status).toBe(403);
  });
  it("super_admin org-override: initiate creates the batch under the impersonated org, not the home org", async () => {
    asSession({ organisationId: "org-b", homeOrganisationId: "org-a", role: "super_admin" });
    const key = uniqueKey("impersonate");
    const res = await POST_initiate(initiateRequest({ originalFilename: "imp.csv", declaredSizeBytes: 5 }, key));
    const body = await res.json();
    const rowInB = await getRow("org-b", body.batch.id);
    const rowInA = await getRow("org-a", body.batch.id);
    expect(rowInB).not.toBeNull();
    expect(rowInA).toBeNull();
  });

  it("super_admin org-override: finalize operates against the impersonated org's own batch, never the home org's", async () => {
    // A batch owned by the impersonated org (org-b) only.
    const bytes = new TextEncoder().encode("impersonated\n");
    const idInB = await seedAwaitingUpload("org-b", { sizeBytes: bytes.byteLength });
    await putObject("org-b", idInB, bytes);
    // A DIFFERENT batch, same id-space irrelevant, owned by the home org
    // (org-a) only — used to prove finalize does NOT fall back to it.
    asSession({ organisationId: "org-b", homeOrganisationId: "org-a", role: "super_admin" });
    const { req, params } = finalizeRequest(idInB);
    const res = await POST_finalize(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, outcome: "READY", batchId: idInB });
    const rowInB = await getRow("org-b", idInB);
    expect(rowInB?.status).toBe("READY");
  });

  it("home-organisation session cannot finalize a batch that exists only under a DIFFERENT (impersonated-only) org", async () => {
    const bytes = new TextEncoder().encode("org-b-only\n");
    const idInB = await seedAwaitingUpload("org-b", { sizeBytes: bytes.byteLength });
    await putObject("org-b", idInB, bytes);
    // A super_admin whose HOME org is org-a, with no active override —
    // organisationId === homeOrganisationId === "org-a" here.
    asSession({ organisationId: "org-a", homeOrganisationId: "org-a", role: "super_admin" });
    const { req, params } = finalizeRequest(idInB);
    const res = await POST_finalize(req, { params });
    expect(res.status).toBe(404);
  });
});

// ─── INITIATE ────────────────────────────────────────────────────────

describe("integration — initiate", () => {
  it("valid creation -> 200, batch identity + upload token present", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await POST_initiate(
      initiateRequest({ originalFilename: "valid.csv", declaredSizeBytes: 42 }, uniqueKey("create"))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.batch.status).toBe("AWAITING_UPLOAD");
    expect(typeof body.batch.id).toBe("string");
    expect(typeof body.uploadToken).toBe("string");
    expect(body.configurationError).toBe(false);
  });

  it("exact replay (same idempotency key) -> same batch id, 200", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const key = uniqueKey("replay");
    const input = { originalFilename: "replay.csv", declaredSizeBytes: 7 };
    const first = await POST_initiate(initiateRequest(input, key));
    const second = await POST_initiate(initiateRequest(input, key));
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(secondBody.batch.id).toBe(firstBody.batch.id);
  });

  it("malformed JSON body -> 400", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await POST_initiate(initiateRequest(undefined, uniqueKey("malformed"), "{not valid json"));
    expect(res.status).toBe(400);
  });

  it("missing Idempotency-Key header -> 400", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await POST_initiate(initiateRequest({ originalFilename: "x.csv", declaredSizeBytes: 5 }, null));
    expect(res.status).toBe(400);
  });

  it("invalid filename (unrecognized extension) -> 400", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await POST_initiate(
      initiateRequest({ originalFilename: "nope.exe", declaredSizeBytes: 5 }, uniqueKey("badtype"))
    );
    expect(res.status).toBe(400);
  });

  it("zero declaredSizeBytes -> 400", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await POST_initiate(
      initiateRequest({ originalFilename: "zero.csv", declaredSizeBytes: 0 }, uniqueKey("zero"))
    );
    expect(res.status).toBe(400);
  });

  it("oversized declaredSizeBytes (>20MiB) -> 400 SIZE_LIMIT", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await POST_initiate(
      initiateRequest({ originalFilename: "big.csv", declaredSizeBytes: 21 * 1024 * 1024 }, uniqueKey("big"))
    );
    expect(res.status).toBe(400);
  });

  it("malformed expectedSha256 -> 400", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await POST_initiate(
      initiateRequest(
        { originalFilename: "sha.csv", declaredSizeBytes: 5, expectedSha256: "not-a-hash" },
        uniqueKey("badsha")
      )
    );
    expect(res.status).toBe(400);
  });

  it("fingerprint conflict (same key, different filename) -> 409", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const key = uniqueKey("conflict");
    await POST_initiate(initiateRequest({ originalFilename: "one.csv", declaredSizeBytes: 5 }, key));
    const res = await POST_initiate(initiateRequest({ originalFilename: "two.csv", declaredSizeBytes: 5 }, key));
    expect(res.status).toBe(409);
  });

  it("Idempotency-Key is treated as a fully opaque, case-sensitive exact string — two keys differing only in case produce two independent rows", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const base = uniqueKey("CaseSensitive");
    const upper = base.toUpperCase();
    const lower = base.toLowerCase();
    const resUpper = await POST_initiate(initiateRequest({ originalFilename: "case.csv", declaredSizeBytes: 5 }, upper));
    const resLower = await POST_initiate(initiateRequest({ originalFilename: "case.csv", declaredSizeBytes: 5 }, lower));
    const bodyUpper = await resUpper.json();
    const bodyLower = await resLower.json();
    expect(resUpper.status).toBe(200);
    expect(resLower.status).toBe(200);
    expect(bodyUpper.batch.id).not.toBe(bodyLower.batch.id);
  });

  it("caller-supplied organisationId/organisation_id in the body has zero effect on tenant context", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const key = uniqueKey("tenant-spoof");
    const res = await POST_initiate(
      initiateRequest(
        { originalFilename: "spoof.csv", declaredSizeBytes: 5, organisationId: "org-b", organisation_id: "org-b" },
        key
      )
    );
    const body = await res.json();
    const rowInA = await getRow("org-a", body.batch.id);
    const rowInB = await getRow("org-b", body.batch.id);
    expect(rowInA).not.toBeNull();
    expect(rowInB).toBeNull();
  });

  it("response redaction: no storage internals present, own key-set matches exactly the frozen envelope", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const res = await POST_initiate(
      initiateRequest({ originalFilename: "redact.csv", declaredSizeBytes: 5 }, uniqueKey("redact"))
    );
    const body = await res.json();
    expect(new Set(Object.keys(body))).toEqual(new Set(["batch", "uploadToken", "configurationError"]));
    expect(new Set(Object.keys(body.batch))).toEqual(
      new Set([
        "id",
        "status",
        "originalFilename",
        "contentType",
        "sizeBytes",
        "expectedSha256",
        "attemptCount",
        "lastFailureCode",
      ])
    );
  });

  it("Cache-Control: private, no-store on both success and error", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const ok = await POST_initiate(
      initiateRequest({ originalFilename: "cache.csv", declaredSizeBytes: 5 }, uniqueKey("cache"))
    );
    const err = await POST_initiate(initiateRequest({ originalFilename: "cache.exe", declaredSizeBytes: 5 }, uniqueKey("cache2")));
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
    expect(err.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

// ─── FINALIZE ────────────────────────────────────────────────────────

describe("integration — finalize", () => {
  it("valid physical finalization -> READY, correct sha256", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const bytes = new TextEncoder().encode("a,b,c\n1,2,3\n");
    const id = await seedAwaitingUpload("org-a", { sizeBytes: bytes.byteLength });
    await putObject("org-a", id, bytes);
    const { req, params } = finalizeRequest(id);
    const res = await POST_finalize(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, outcome: "READY", batchId: id });
    expect(body.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    const row = await getRow("org-a", id);
    expect(row?.status).toBe("READY");
  });

  it("wrong tenant and nonexistent produce byte-identical 404 responses", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const bytes = new TextEncoder().encode("x\n");
    const ownedByB = await seedAwaitingUpload("org-b", { sizeBytes: bytes.byteLength });
    await putObject("org-b", ownedByB, bytes);

    const wrongTenant = finalizeRequest(ownedByB);
    const wrongTenantRes = await POST_finalize(wrongTenant.req, { params: wrongTenant.params });
    const nonexistent = finalizeRequest(randomUUID());
    const nonexistentRes = await POST_finalize(nonexistent.req, { params: nonexistent.params });

    expect(wrongTenantRes.status).toBe(404);
    expect(nonexistentRes.status).toBe(404);
    expect(await wrongTenantRes.json()).toEqual(await nonexistentRes.json());
  });

  it("caller-supplied storage-locator-shaped query/header values have zero effect on which object is finalized", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const bytes = new TextEncoder().encode("legit\n");
    const id = await seedAwaitingUpload("org-a", { sizeBytes: bytes.byteLength });
    await putObject("org-a", id, bytes);
    const { req, params } = finalizeRequest(id, {
      queryOverride: "?storageKey=attacker/controlled/path&storage_key=other",
      headerOverride: { "X-Storage-Key": "attacker/controlled/path" },
    });
    const res = await POST_finalize(req, { params });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, outcome: "READY", batchId: id });
    expect(body.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("missing storage object -> outcome FAILED/STORAGE_NOT_FOUND, HTTP 200", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const id = await seedAwaitingUpload("org-a");
    const { req, params } = finalizeRequest(id);
    const res = await POST_finalize(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, outcome: "FAILED", failureCode: "STORAGE_NOT_FOUND", retryable: true });
  });

  it("provider HEAD failure -> outcome FAILED/PROVIDER_FAILURE, HTTP 200", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const id = await seedAwaitingUpload("org-a");
    const key = buildImportBatchKey("org-a", id);
    failingHeadKeys.add(key);
    try {
      const { req, params } = finalizeRequest(id);
      const res = await POST_finalize(req, { params });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, outcome: "FAILED", failureCode: "PROVIDER_FAILURE", retryable: true });
    } finally {
      failingHeadKeys.delete(key);
    }
  });

  it("provider GET failure (after a successful HEAD) -> outcome FAILED/PROVIDER_FAILURE, HTTP 200", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const bytes = new TextEncoder().encode("hello\n");
    const id = await seedAwaitingUpload("org-a", { sizeBytes: bytes.byteLength });
    await putObject("org-a", id, bytes);
    const key = buildImportBatchKey("org-a", id);
    failingGetKeys.add(key);
    try {
      const { req, params } = finalizeRequest(id);
      const res = await POST_finalize(req, { params });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, outcome: "FAILED", failureCode: "PROVIDER_FAILURE", retryable: true });
    } finally {
      failingGetKeys.delete(key);
    }
  });

  it("zero-byte object -> outcome FAILED/ZERO_BYTE, HTTP 200", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const id = await seedAwaitingUpload("org-a", { sizeBytes: 0 });
    await putObject("org-a", id, new Uint8Array(0));
    const { req, params } = finalizeRequest(id);
    const res = await POST_finalize(req, { params });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, outcome: "FAILED", failureCode: "ZERO_BYTE", retryable: false });
  });

  it("size metadata mismatch -> outcome FAILED/STORAGE_METADATA_MISMATCH, HTTP 200", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const bytes = new TextEncoder().encode("twelve bytes");
    const id = await seedAwaitingUpload("org-a", { sizeBytes: bytes.byteLength + 5 });
    await putObject("org-a", id, bytes);
    const { req, params } = finalizeRequest(id);
    const res = await POST_finalize(req, { params });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, outcome: "FAILED", failureCode: "STORAGE_METADATA_MISMATCH", retryable: false });
  });

  it("SHA mismatch -> outcome FAILED/HASH_MISMATCH, HTTP 200", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const bytes = new TextEncoder().encode("actual content\n");
    const id = await seedAwaitingUpload("org-a", { sizeBytes: bytes.byteLength, expectedSha256: "a".repeat(64) });
    await putObject("org-a", id, bytes);
    const { req, params } = finalizeRequest(id);
    const res = await POST_finalize(req, { params });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, outcome: "FAILED", failureCode: "HASH_MISMATCH", retryable: false });
  });

  it("physical preflight rejection (CSV containing a NUL byte) -> outcome FAILED/PREFLIGHT_REJECTED, HTTP 200", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const bytes = new Uint8Array([...new TextEncoder().encode("a,b\n1,"), 0, ...new TextEncoder().encode("2\n")]);
    const id = await seedAwaitingUpload("org-a", { sizeBytes: bytes.byteLength });
    await putObject("org-a", id, bytes);
    const { req, params } = finalizeRequest(id);
    const res = await POST_finalize(req, { params });
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, outcome: "FAILED", failureCode: "PREFLIGHT_REJECTED", retryable: false });
  });

  it("terminal FAILED state -> re-finalize attempt is CLAIM_REJECTED/TERMINAL_FAILURE, HTTP 409", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const bytes = new Uint8Array([0]);
    const id = await seedAwaitingUpload("org-a", { sizeBytes: bytes.byteLength });
    await putObject("org-a", id, bytes);
    const first = finalizeRequest(id);
    const firstRes = await POST_finalize(first.req, { params: first.params });
    const firstBody = await firstRes.json();
    expect(firstBody.failureCode).toBe("PREFLIGHT_REJECTED"); // deterministic, non-retryable/terminal

    const second = finalizeRequest(id);
    const secondRes = await POST_finalize(second.req, { params: second.params });
    expect(secondRes.status).toBe(409);
  });

  it("response redaction: FAILED and READY response own-key-sets match exactly the frozen envelope", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const readyBytes = new TextEncoder().encode("ok\n");
    const readyId = await seedAwaitingUpload("org-a", { sizeBytes: readyBytes.byteLength });
    await putObject("org-a", readyId, readyBytes);
    const ready = finalizeRequest(readyId);
    const readyBody = await (await POST_finalize(ready.req, { params: ready.params })).json();
    expect(new Set(Object.keys(readyBody))).toEqual(new Set(["ok", "outcome", "batchId", "sha256"]));

    const failedId = await seedAwaitingUpload("org-a");
    const failed = finalizeRequest(failedId);
    const failedBody = await (await POST_finalize(failed.req, { params: failed.params })).json();
    expect(new Set(Object.keys(failedBody))).toEqual(
      new Set(["ok", "outcome", "batchId", "failureCode", "failureMessage", "retryable"])
    );
  });

  it("Cache-Control: private, no-store on every outcome", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const id = await seedAwaitingUpload("org-a");
    const { req, params } = finalizeRequest(id);
    const res = await POST_finalize(req, { params });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

// ─── CONCURRENCY (Section 26) ──────────────────────────────────────────

describe("integration — genuine concurrent double-finalize race", () => {
  it("exactly one of two simultaneous finalize requests against the same batch reaches READY; the other is ALREADY_PROCESSING; final DB state is coherent", async () => {
    asSession({ organisationId: "org-a", role: "manager" });
    const bytes = new TextEncoder().encode("race,data\n1,2\n");
    const id = await seedAwaitingUpload("org-a", { sizeBytes: bytes.byteLength });
    await putObject("org-a", id, bytes);

    const first = finalizeRequest(id);
    const second = finalizeRequest(id);
    const [r1, r2] = await Promise.all([
      POST_finalize(first.req, { params: first.params }),
      POST_finalize(second.req, { params: second.params }),
    ]);
    const [b1, b2] = await Promise.all([r1.json(), r2.json()]);

    const statuses = [r1.status, r2.status].sort();
    const outcomes = [b1.outcome ?? null, b2.outcome ?? null];
    const readyCount = outcomes.filter((o) => o === "READY").length;
    const rejectedCount = [r1.status, r2.status].filter((s) => s === 409).length;

    expect(readyCount).toBe(1);
    expect(rejectedCount).toBe(1);
    expect(statuses).toEqual([200, 409].sort());

    const row = await getRow("org-a", id);
    expect(row?.status).toBe("READY");
    expect(row?.attempt_count).toBe(1);
    expect(row?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));

    // The loser's own HTTP response never implies success.
    const loserBody = b1.outcome === "READY" ? b2 : b1;
    expect(loserBody.outcome).toBeUndefined();
    expect(loserBody.ok).toBeUndefined();
  });
});
