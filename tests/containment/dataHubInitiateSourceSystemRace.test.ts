import { describe, it, expect, vi } from "vitest";

// Data Hub 5B.4A remediation — concurrency race PROOF/regression.
//
// BEFORE this remediation, the design was: create the ImportBatch row
// first, check SourceSystem.active AFTER, and issue a COMPENSATING DELETE
// if inactive. Before writing any implementation code, that design was
// empirically proven unsafe with a deterministic interleaved mocked test
// modeling the remediation task's own section-2 sequence: request A
// creates the row, then — BEFORE A reaches its own active-check/delete
// continuation — a concurrent identical (same idempotency key) request B
// hits the unique-constraint violation and enters resolveReplay(), which
// correctly never re-checks `active` (an exact replay must remain stable
// across later deactivation — see initiate.ts's own header comment) and
// therefore returned `ok: true` with the row A was about to delete. That
// proof run (against the pre-remediation source) produced exactly this
// failure:
//
//   AssertionError: expected { ok: true, …(3) } to match object { ok: false }
//
// confirming B could observe and successfully replay a transient,
// about-to-be-deleted row — the real bug this remediation fixes.
//
// THE FIX (see initiate.ts's own CONCURRENCY-SAFE CREATION header comment)
// makes the create() and the active check share ONE database transaction:
// if inactive, the function throws inside the transaction callback, which
// triggers a real SQL ROLLBACK. Because the row is then NEVER COMMITTED,
// it is — by ordinary PostgreSQL MVCC guarantees — NEVER visible to any
// OTHER database connection/transaction at any point. This specific
// cross-connection, real-transaction-visibility property is NOT something
// a mocked Prisma client can faithfully prove (a mock has no concept of
// commit/rollback or connection isolation) — it is proven instead against
// REAL PostgreSQL, with two independent database connections, in
// scripts/tests/verify-5b4a-source-atomicity.sh (see its own Proof1,
// which explicitly opens a second, fully independent PrismaClient
// connection and confirms it observes NOTHING while the first
// connection's transaction is still open).
//
// What THIS file proves at the mock level (the level mocks legitimately
// can prove): the create-then-throw-inside-transaction sequence actually
// occurs for an inactive source, deterministically, with NO compensating
// delete call anywhere — i.e. the OLD create-then-delete code path is
// provably absent from the remediated implementation.

const createMock = vi.fn();
const importBatchFindUniqueMock = vi.fn();
const deleteMock = vi.fn();
const sourceSystemFindUniqueMock = vi.fn();
const transactionMock = vi.fn(async (callback: (tx: unknown) => unknown) =>
  callback({
    importBatch: { create: (...args: unknown[]) => createMock(...args) },
    sourceSystem: { findUnique: (...args: unknown[]) => sourceSystemFindUniqueMock(...args) },
  })
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    importBatch: {
      create: (...args: unknown[]) => createMock(...args),
      findUnique: (...args: unknown[]) => importBatchFindUniqueMock(...args),
      delete: (...args: unknown[]) => deleteMock(...args),
    },
    sourceSystem: {
      findUnique: (...args: unknown[]) => sourceSystemFindUniqueMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...(args as [(tx: unknown) => unknown])),
  },
}));

const generateClientTokenMock = vi.fn();
vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: (...args: unknown[]) => generateClientTokenMock(...args),
}));

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "batch-A",
    organisation_id: "org-1",
    uploaded_by: "user-1",
    original_filename: "data.csv",
    content_type: "csv",
    size_bytes: 100,
    sha256: null,
    storage_provider: "vercel-blob-private",
    storage_key: "org_org-1/importbatch_batch-A",
    storage_etag: null,
    status: "AWAITING_UPLOAD",
    idempotency_key: "shared-key",
    expected_sha256: null,
    source_system_id: "ss-inactive",
    attempt_count: 0,
    last_failure_code: null,
    last_failure_message: null,
    last_failure_retryable: null,
    ...overrides,
  };
}

async function freshImport() {
  vi.resetModules();
  createMock.mockReset();
  importBatchFindUniqueMock.mockReset();
  deleteMock.mockReset();
  sourceSystemFindUniqueMock.mockReset();
  generateClientTokenMock.mockReset();
  transactionMock.mockClear();
  transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback({
      importBatch: { create: (...args: unknown[]) => createMock(...args) },
      sourceSystem: { findUnique: (...args: unknown[]) => sourceSystemFindUniqueMock(...args) },
    })
  );
  delete process.env.DATAHUB_BLOB_STORE_ID;
  delete process.env.DATAHUB_BLOB_READ_WRITE_TOKEN;
  return import("@/lib/data-hub/importBatch/initiate");
}

describe("initiate — concurrency race remediation (T7/T8)", () => {
  it("T7/T8 — inactive-source creation throws INSIDE the create+active-gate transaction; NO compensating delete exists anywhere in the remediated implementation", async () => {
    const { initiateImportBatch } = await freshImport();

    sourceSystemFindUniqueMock.mockResolvedValue({ active: false });
    createMock.mockResolvedValue(makeRow());

    const result = await initiateImportBatch(
      { organisationId: "org-1", userId: "user-1" },
      {
        originalFilename: "data.csv",
        declaredSizeBytes: 100,
        idempotencyKey: "shared-key",
        sourceSystemId: "ss-inactive",
      }
    );

    expect(result).toMatchObject({ ok: false, code: "SOURCE_SYSTEM_UNAVAILABLE" });
    // The insert IS attempted (inside the transaction) — that's expected
    // and correct; what matters is that the transaction as a whole never
    // succeeds, and that no separate compensating-delete call exists.
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("T7/T8 — a raw source-text check confirms initiate.ts contains no importBatch.delete(...) call anywhere (the old compensating-delete pattern is structurally absent, not merely untriggered in this test)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.join(process.cwd(), "lib/data-hub/importBatch/initiate.ts"), "utf8");
    expect(source.includes(".delete(")).toBe(false);
    expect(source.includes("importBatch.delete")).toBe(false);
  });
});

// Real cross-connection, real-PostgreSQL-transaction non-visibility proof:
// scripts/tests/verify-5b4a-source-atomicity.sh (Proof1/Proof2/Proof3) —
// not duplicated here, since a mocked Prisma client cannot faithfully
// represent commit/rollback visibility semantics across two independent
// database connections. See that script's own header comment for exactly
// what it proves and why it exists as a separate, narrow, correctly-
// bootstrapped harness (distinct from the pre-existing, separately-
// tracked-as-debt, unrelated scripts/tests/verify-datahub-initiate-finalize-routes.sh).
