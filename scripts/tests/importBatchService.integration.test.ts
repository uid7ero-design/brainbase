import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";

// Data Hub 5A.2G.1 — real disposable-Postgres integration harness.
//
// Run ONLY via scripts/tests/verify-import-batch-service.sh, which starts
// a disposable postgres:16-alpine Docker container, applies the exact
// scripts/create-import-batches.sql migration against a minimal bootstrap
// schema, exports DATABASE_URL to point at that container, and then runs
// `npx vitest run --config vitest.integration.config.ts` (this file is
// the sole spec that config collects). NEVER run this file directly
// against any other DATABASE_URL — the guard rail below refuses to start
// if DATABASE_URL is unset or looks like a real hosted/Neon/production
// endpoint.
//
// This suite exercises the REAL, unmodified production code
// (initiate.ts's Prisma-based insert-first idempotency, and finalize.ts /
// staleReclaim.ts's raw-SQL atomic claim / fencing / stale-reclaim logic)
// against a REAL Postgres instance — never a duplicated/parallel copy of
// their SQL. Only two things are mocked, and only to stay within the
// phase's hard boundaries:
//   - lib/data-hub/importBatch/compositionRoot.ts's createImportBatchStorage
//     is overridden to return an InMemoryFileStore (real logic, zero
//     network) instead of the real Vercel Blob adapter — this suite must
//     never make a live Blob network call.
//   - @vercel/blob/client's generateClientTokenFromReadWriteToken is left
//     REAL (it is pure local HMAC signing with zero network I/O — verified
//     during 5A.2G.1 implementation — so exercising it for real here adds
//     coverage with no network risk), fed FAKE-but-correctly-shaped
//     DATAHUB_BLOB_* credentials.

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "importBatchService.integration.test.ts requires DATABASE_URL to point at a disposable Postgres " +
      "container (see scripts/tests/verify-import-batch-service.sh). Refusing to run without it."
  );
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error(
    "Refusing to run the Data Hub integration suite against a DATABASE_URL that looks like a real " +
      "hosted/Production database. This suite may ONLY run against a local disposable Docker container."
  );
}
if (!/^(localhost|127\.0\.0\.1)/.test(new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, "http://")).hostname)) {
  throw new Error(
    "Refusing to run the Data Hub integration suite against a non-localhost DATABASE_URL host."
  );
}

process.env.DATAHUB_BLOB_STORE_ID = "store_faketestharness0";
process.env.DATAHUB_BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_faketestharness0_fakeSecretNeverReal";

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

// A neon(@neondatabase/serverless)-compatible tagged-template `sql`
// function, backed by the SAME real Postgres connection via Prisma's
// $queryRawUnsafe — used ONLY to let finalize.ts/staleReclaim.ts's real,
// unmodified `sql\`...\`` calls (imported from lib/db.ts) run against a
// real database in this test harness, without ever touching
// @neondatabase/serverless's own HTTP-only wire protocol (which cannot
// reach a plain local Postgres container without a separate ws-proxy).
async function neonCompatibleSql(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    text += `$${i + 1}` + strings[i + 1];
  }
  return prisma.$queryRawUnsafe(text, ...values);
}

vi.doMock("@/lib/db", () => ({ default: neonCompatibleSql }));
vi.doMock("@/lib/data-hub/importBatch/compositionRoot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data-hub/importBatch/compositionRoot")>();
  return {
    ...actual,
    createImportBatchStorage: () => sharedStore,
  };
});

let sharedStore: InstanceType<typeof import("@/lib/data-hub/storage/inMemoryFileStore").InMemoryFileStore>;

let initiateImportBatch: typeof import("@/lib/data-hub/importBatch/initiate").initiateImportBatch;
let finalizeImportBatch: typeof import("@/lib/data-hub/importBatch/finalize").finalizeImportBatch;
let claimForFinalize: typeof import("@/lib/data-hub/importBatch/finalize").claimForFinalize;
let completeReadyForFinalize: typeof import("@/lib/data-hub/importBatch/finalize").completeReadyForFinalize;
let completeFailedForFinalize: typeof import("@/lib/data-hub/importBatch/finalize").completeFailedForFinalize;
let reclaimStaleImportBatches: typeof import("@/lib/data-hub/importBatch/staleReclaim").reclaimStaleImportBatches;
let buildImportBatchKey: typeof import("@/lib/data-hub/storage/rawFileStore").buildImportBatchKey;

beforeAll(async () => {
  const { InMemoryFileStore } = await import("@/lib/data-hub/storage/inMemoryFileStore");
  sharedStore = new InMemoryFileStore();

  ({ initiateImportBatch } = await import("@/lib/data-hub/importBatch/initiate"));
  ({
    finalizeImportBatch,
    claimForFinalize,
    completeReadyForFinalize,
    completeFailedForFinalize,
  } = await import("@/lib/data-hub/importBatch/finalize"));
  ({ reclaimStaleImportBatches } = await import("@/lib/data-hub/importBatch/staleReclaim"));
  ({ buildImportBatchKey } = await import("@/lib/data-hub/storage/rawFileStore"));

  // Minimal bootstrap: two tenants, two users each. Mirrors
  // scripts/tests/verify-import-batches-migration.sh's own bootstrap.
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

function uniqueKey(label: string): string {
  return `${label}-${randomUUID()}`;
}

async function getRow(organisationId: string, id: string) {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM import_batches WHERE id = $1 AND organisation_id = $2`,
    id,
    organisationId
  );
  return rows[0] ?? null;
}

async function setRow(id: string, set: Record<string, unknown>) {
  const keys = Object.keys(set);
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await prisma.$executeRawUnsafe(
    `UPDATE import_batches SET ${setClause} WHERE id = $1`,
    id,
    ...keys.map((k) => set[k])
  );
}

// ─── Insert-first idempotency (real Prisma, real Postgres) ────────────

describe("integration — insert-first idempotency", () => {
  it("two simultaneous identical-idempotency-key creates resolve to exactly one row", async () => {
    const key = uniqueKey("concurrent");
    const input = { originalFilename: "data.csv", declaredSizeBytes: 10, idempotencyKey: key };
    const [r1, r2] = await Promise.all([
      initiateImportBatch({ organisationId: "org-a", userId: "user-a1" }, input),
      initiateImportBatch({ organisationId: "org-a", userId: "user-a1" }, input),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const id1 = (r1 as { batch: { id: string } }).batch.id;
    const id2 = (r2 as { batch: { id: string } }).batch.id;
    expect(id1).toBe(id2);

    const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::int AS count FROM import_batches WHERE organisation_id = $1 AND idempotency_key = $2`,
      "org-a",
      key
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("same-key/same-fingerprint replay returns the existing row", async () => {
    const key = uniqueKey("replay-same");
    const input = { originalFilename: "same.csv", declaredSizeBytes: 20, idempotencyKey: key };
    const first = await initiateImportBatch({ organisationId: "org-a", userId: "user-a1" }, input);
    const second = await initiateImportBatch({ organisationId: "org-a", userId: "user-a1" }, input);
    expect(first.ok && second.ok).toBe(true);
    expect((first as { batch: { id: string } }).batch.id).toBe((second as { batch: { id: string } }).batch.id);
  });

  it("same-key/different-fingerprint returns IDEMPOTENCY_CONFLICT", async () => {
    const key = uniqueKey("replay-diff");
    await initiateImportBatch(
      { organisationId: "org-a", userId: "user-a1" },
      { originalFilename: "one.csv", declaredSizeBytes: 30, idempotencyKey: key }
    );
    const conflict = await initiateImportBatch(
      { organisationId: "org-a", userId: "user-a1" },
      { originalFilename: "different.csv", declaredSizeBytes: 30, idempotencyKey: key }
    );
    expect(conflict).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("cross-tenant identical idempotency-key strings produce two independent rows", async () => {
    const key = uniqueKey("cross-tenant");
    const inputA = { originalFilename: "a.csv", declaredSizeBytes: 40, idempotencyKey: key };
    const inputB = { originalFilename: "b.csv", declaredSizeBytes: 50, idempotencyKey: key };
    const resultA = await initiateImportBatch({ organisationId: "org-a", userId: "user-a1" }, inputA);
    const resultB = await initiateImportBatch({ organisationId: "org-b", userId: "user-b1" }, inputB);
    expect(resultA.ok && resultB.ok).toBe(true);
    expect((resultA as { batch: { id: string } }).batch.id).not.toBe(
      (resultB as { batch: { id: string } }).batch.id
    );
  });

  it("uploaded_by mismatch on a non-NULL existing value -> IDEMPOTENCY_CONFLICT; NULLed uploaded_by is skipped", async () => {
    const key = uniqueKey("uploaded-by");
    const input = { originalFilename: "owner.csv", declaredSizeBytes: 60, idempotencyKey: key };
    const created = await initiateImportBatch({ organisationId: "org-a", userId: "user-a1" }, input);
    expect(created.ok).toBe(true);
    const batchId = (created as { batch: { id: string } }).batch.id;

    const mismatch = await initiateImportBatch({ organisationId: "org-a", userId: "user-a2" }, input);
    expect(mismatch).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });

    // Simulate the uploader having been deleted (ON DELETE SET NULL).
    await setRow(batchId, { uploaded_by: null });

    const afterNull = await initiateImportBatch({ organisationId: "org-a", userId: "user-a2" }, input);
    expect(afterNull.ok).toBe(true);
    expect((afterNull as { batch: { id: string } }).batch.id).toBe(batchId);
  });
});

// ─── Atomic claim (real Postgres) ──────────────────────────────────────

describe("integration — atomic claim", () => {
  async function freshBatch(overrides: Record<string, unknown> = {}) {
    const id = randomUUID();
    const storageKey = buildImportBatchKey("org-a", id);
    await prisma.importBatch.create({
      data: {
        id,
        organisation_id: "org-a",
        uploaded_by: "user-a1",
        original_filename: "claim-test.csv",
        content_type: "csv",
        size_bytes: 8,
        storage_provider: "vercel-blob-private",
        storage_key: storageKey,
        status: "AWAITING_UPLOAD",
        ...overrides,
      },
    });
    return { id, storageKey };
  }

  it("exactly one of two simultaneous claim attempts against the same row succeeds; attempt_count increments exactly once", async () => {
    // Uses claimForFinalize directly (the raw atomic claim step) rather
    // than the full finalizeImportBatch pipeline — the full pipeline can
    // legitimately re-claim its OWN row a second time if the first
    // attempt completes (e.g. to a finalization-retry-eligible FAILED
    // code like STORAGE_NOT_FOUND) before the second attempt's claim
    // even runs, which would conflate a real design behavior with the
    // claim mutex property this test exists to prove. Calling the atomic
    // claim step itself, concurrently, isolates exactly that property.
    const { id } = await freshBatch();
    const [r1, r2] = await Promise.all([
      claimForFinalize("org-a", id),
      claimForFinalize("org-a", id),
    ]);
    const succeeded = [r1, r2].filter((r) => r !== null);
    const rejected = [r1, r2].filter((r) => r === null);
    expect(succeeded.length).toBe(1);
    expect(rejected.length).toBe(1);

    const row = await getRow("org-a", id);
    expect(row?.attempt_count).toBe(1);
    expect(row?.status).toBe("PROCESSING");
  });

  it("an ineligible FAILED row (terminal bad-object code) receives ZERO writes when a claim is attempted", async () => {
    const { id } = await freshBatch({
      status: "FAILED",
      last_failure_code: "HASH_MISMATCH",
      last_failure_message: "x",
      last_failure_retryable: false,
      attempt_count: 1,
    });
    const before = await getRow("org-a", id);
    const result = await finalizeImportBatch({ organisationId: "org-a" }, id);
    expect(result).toMatchObject({ outcome: "CLAIM_REJECTED", code: "RECLAIM_NOT_ALLOWED", reason: "TERMINAL_FAILURE" });
    const after = await getRow("org-a", id);
    expect(after).toEqual(before);
  });

  it("a raw-SQL attempt to violate an existing 5A.2G.0 CHECK constraint is still rejected by the database itself", async () => {
    const id = randomUUID();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO import_batches (id, organisation_id, uploaded_by, original_filename, content_type, size_bytes, storage_provider, storage_key)
         VALUES ($1, 'org-a', 'user-a1', 'bad.csv', 'not-a-real-format', 8, 'vercel-blob-private', $2)`,
        id,
        buildImportBatchKey("org-a", id)
      )
    ).rejects.toThrow();
  });
});

// ─── Attempt-fencing (Step 23, deterministic sequence) ─────────────────

describe("integration — attempt-fencing (Step 23)", () => {
  async function freshAwaitingUpload() {
    const id = randomUUID();
    await prisma.importBatch.create({
      data: {
        id,
        organisation_id: "org-a",
        uploaded_by: "user-a1",
        original_filename: "fence-test.csv",
        content_type: "csv",
        size_bytes: 8,
        storage_provider: "vercel-blob-private",
        storage_key: buildImportBatchKey("org-a", id),
        status: "AWAITING_UPLOAD",
      },
    });
    return id;
  }

  it("scenario A: attempt 1 claims N, external reclaim marks FAILED, attempt 2 claims N+1 — attempt 1's stale completion (READY and FAILED) both affect zero rows, and attempt 2's state is untouched", async () => {
    const id = await freshAwaitingUpload();

    const attempt1 = await claimForFinalize("org-a", id);
    expect(attempt1).not.toBeNull();
    const generation1 = attempt1!.attempt_count;

    // External stale-reclaim (simulated directly, matching exactly what
    // staleReclaim.ts's own UPDATE would produce for this row).
    await setRow(id, {
      status: "FAILED",
      last_failure_code: "STALE_RECLAIMED",
      last_failure_message: "reclaimed",
      last_failure_retryable: true,
    });

    const attempt2 = await claimForFinalize("org-a", id);
    expect(attempt2).not.toBeNull();
    const generation2 = attempt2!.attempt_count;
    expect(generation2).toBe(generation1 + 1);

    const readyResult = await completeReadyForFinalize("org-a", id, generation1, "a".repeat(64), "etag-1");
    expect(readyResult).toEqual({ outcome: "OWNERSHIP_LOST", batchId: id });

    const failedResult = await completeFailedForFinalize("org-a", id, generation1, "PROVIDER_FAILURE");
    expect(failedResult).toEqual({ outcome: "OWNERSHIP_LOST", batchId: id });

    // Attempt 2's own state remains authoritative/untouched by attempt 1's
    // stale completion attempts.
    const row = await getRow("org-a", id);
    expect(row?.attempt_count).toBe(generation2);
    expect(row?.status).toBe("PROCESSING");
  });

  it("scenario B: attempt 1 claims N, external reclaim marks FAILED, no attempt 2 ever claims — attempt 1's own completion (using its own captured N) still affects zero rows", async () => {
    const id = await freshAwaitingUpload();

    const attempt1 = await claimForFinalize("org-a", id);
    expect(attempt1).not.toBeNull();
    const generation1 = attempt1!.attempt_count;

    await setRow(id, {
      status: "FAILED",
      last_failure_code: "STALE_RECLAIMED",
      last_failure_message: "reclaimed",
      last_failure_retryable: true,
    });

    // attempt_count is numerically still generation1 in this scenario
    // (no second claim ever ran) — the fence must still reject because
    // status is no longer PROCESSING.
    const rowBeforeCompletion = await getRow("org-a", id);
    expect(rowBeforeCompletion?.attempt_count).toBe(generation1);
    expect(rowBeforeCompletion?.status).toBe("FAILED");

    const readyResult = await completeReadyForFinalize("org-a", id, generation1, "b".repeat(64), "etag-2");
    expect(readyResult).toEqual({ outcome: "OWNERSHIP_LOST", batchId: id });

    const failedResult = await completeFailedForFinalize("org-a", id, generation1, "PROVIDER_FAILURE");
    expect(failedResult).toEqual({ outcome: "OWNERSHIP_LOST", batchId: id });

    const rowAfter = await getRow("org-a", id);
    expect(rowAfter?.last_failure_code).toBe("STALE_RECLAIMED");
  });
});

// ─── Stale reclaim (real Postgres) ──────────────────────────────────────

describe("integration — stale reclaim", () => {
  async function freshProcessing(lastAttemptSql: string) {
    const id = randomUUID();
    await prisma.importBatch.create({
      data: {
        id,
        organisation_id: "org-a",
        uploaded_by: "user-a1",
        original_filename: "stale-test.csv",
        content_type: "csv",
        size_bytes: 8,
        storage_provider: "vercel-blob-private",
        storage_key: buildImportBatchKey("org-a", id),
        status: "PROCESSING",
        attempt_count: 1,
      },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE import_batches SET last_attempt_at = ${lastAttemptSql} WHERE id = $1`,
      id
    );
    return id;
  }

  it("reclaims a PROCESSING row whose last_attempt_at is older than the threshold", async () => {
    const id = await freshProcessing("now() - interval '1 hour'");
    const result = await reclaimStaleImportBatches(30 * 60 * 1000);
    expect(result.reclaimedIds).toContain(id);
    const row = await getRow("org-a", id);
    expect(row).toMatchObject({ status: "FAILED", last_failure_code: "STALE_RECLAIMED", last_failure_retryable: true });
    expect(row?.attempt_count).toBe(1); // never incremented by reclaim
  });

  it("excludes a row that already completed to READY before the reclaim sweep runs", async () => {
    const id = await freshProcessing("now() - interval '1 hour'");
    await setRow(id, { status: "READY", sha256: "c".repeat(64) });
    const result = await reclaimStaleImportBatches(30 * 60 * 1000);
    expect(result.reclaimedIds).not.toContain(id);
    const row = await getRow("org-a", id);
    expect(row?.status).toBe("READY");
  });

  it("excludes a row whose last_attempt_at was refreshed to a recent value before the reclaim sweep runs", async () => {
    const id = await freshProcessing("now() - interval '1 hour'");
    await prisma.$executeRawUnsafe(`UPDATE import_batches SET last_attempt_at = now() WHERE id = $1`, id);
    const result = await reclaimStaleImportBatches(30 * 60 * 1000);
    expect(result.reclaimedIds).not.toContain(id);
    const row = await getRow("org-a", id);
    expect(row?.status).toBe("PROCESSING");
  });

  it("a short injected threshold reclaims a row whose last_attempt_at is only a few seconds old", async () => {
    const id = await freshProcessing("now() - interval '5 seconds'");
    const result = await reclaimStaleImportBatches(1000); // 1 second threshold
    expect(result.reclaimedIds).toContain(id);
  });

  it("terminal bad-object FAILED states are never touched by stale reclaim (WHERE status='PROCESSING' excludes them structurally)", async () => {
    const id = randomUUID();
    await prisma.importBatch.create({
      data: {
        id,
        organisation_id: "org-a",
        uploaded_by: "user-a1",
        original_filename: "terminal.csv",
        content_type: "csv",
        size_bytes: 8,
        storage_provider: "vercel-blob-private",
        storage_key: buildImportBatchKey("org-a", id),
        status: "FAILED",
        last_failure_code: "ZERO_BYTE",
        last_failure_message: "x",
        last_failure_retryable: false,
        attempt_count: 1,
      },
    });
    await prisma.$executeRawUnsafe(`UPDATE import_batches SET last_attempt_at = now() - interval '1 day' WHERE id = $1`, id);
    const result = await reclaimStaleImportBatches(30 * 60 * 1000);
    expect(result.reclaimedIds).not.toContain(id);
    const row = await getRow("org-a", id);
    expect(row?.last_failure_code).toBe("ZERO_BYTE");
  });
});

// ─── Full pipeline + READY metadata clearing ────────────────────────────

describe("integration — full pipeline via the real service functions", () => {
  it("initiate -> (simulated upload) -> finalize reaches READY, size_bytes unchanged, failure metadata cleared", async () => {
    const key = uniqueKey("full-pipeline");
    const body = Buffer.from("a,b\n1,2\n");
    const created = await initiateImportBatch(
      { organisationId: "org-a", userId: "user-a1" },
      { originalFilename: "pipeline.csv", declaredSizeBytes: body.byteLength, idempotencyKey: key }
    );
    expect(created.ok).toBe(true);
    const batch = (created as { batch: { id: string; storageKey: string } }).batch;

    // Pre-existing failure metadata from a hypothetical prior attempt, to
    // prove READY completion clears it. Must go through PROCESSING first
    // (via a real claim) since the DB's own CHECK constraint requires
    // last_failure_retryable to be NULL whenever status <> 'FAILED' —
    // setting it directly on an AWAITING_UPLOAD row would violate that
    // constraint.
    const firstAttempt = await finalizeImportBatch({ organisationId: "org-a" }, batch.id);
    expect(firstAttempt).toMatchObject({ outcome: "FAILED", failureCode: "STORAGE_NOT_FOUND" });
    const afterFirstAttempt = await getRow("org-a", batch.id);
    expect(afterFirstAttempt?.last_failure_code).toBe("STORAGE_NOT_FOUND");

    // Simulate the browser's direct-to-Blob upload, then retry finalize —
    // STORAGE_NOT_FOUND is finalization-retry-eligible, so this re-claims
    // the same row (a fresh generation) and should now reach READY.
    await sharedStore.put(batch.storageKey, body);

    const finalized = await finalizeImportBatch({ organisationId: "org-a" }, batch.id);
    expect(finalized.outcome).toBe("READY");

    const row = await getRow("org-a", batch.id);
    expect(row?.status).toBe("READY");
    expect(row?.size_bytes).toBe(body.byteLength); // immutable — never overwritten
    expect(row?.last_failure_code).toBeNull();
    expect(row?.last_failure_message).toBeNull();
    expect(row?.last_failure_retryable).toBeNull();
    expect(row?.sha256).toHaveLength(64);
  });

  it("FAILED completion persists only the fixed, sanitized, bounded message (never a raw error)", async () => {
    const id = randomUUID();
    await prisma.importBatch.create({
      data: {
        id,
        organisation_id: "org-a",
        uploaded_by: "user-a1",
        original_filename: "failmsg.csv",
        content_type: "csv",
        size_bytes: 8,
        storage_provider: "vercel-blob-private",
        storage_key: buildImportBatchKey("org-a", id),
        status: "AWAITING_UPLOAD",
      },
    });
    // No object ever uploaded -> STORAGE_NOT_FOUND.
    const result = await finalizeImportBatch({ organisationId: "org-a" }, id);
    expect(result).toMatchObject({ outcome: "FAILED", failureCode: "STORAGE_NOT_FOUND", retryable: true });

    const { getMessageTemplate } = await import("@/lib/data-hub/importBatch/failureTaxonomy");
    const row = await getRow("org-a", id);
    expect(row?.last_failure_message).toBe(getMessageTemplate("STORAGE_NOT_FOUND"));
    expect((row?.last_failure_message as string).length).toBeLessThanOrEqual(500);
  });
});
