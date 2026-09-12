import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";

// Data Hub 6.0C1 (SUPERSEDED BY 6.1B) — this file originally proved the
// temporary first-import / repeat-import fail-closed safety guard added to
// confirmWorksheet.ts's existing atomic transaction: a coarse, SourceSystem-
// wide EXISTS check that blocked EVERY worksheet after the first ever
// success for a given organisation+SourceSystem.
//
// 6.1B supersedes that coarse guard with per-record reconciliation (see
// confirmWorksheet.ts's own 6.1B header comment) — a second, third, Nth
// worksheet from the same SourceSystem is now EXPECTED to reach
// reconciliation, with each record individually classified NEW/UNCHANGED/
// CHANGED, rather than being rejected outright. This file is retargeted
// accordingly:
//   - Tests proving invariants that remain TRUE unchanged (same-worksheet
//     replay idempotency, NULL-source fail-closed gate, client-cannot-
//     bypass, customer-data independence, the SourceSystem lock's own SQL
//     shape) are KEPT, updated only for the new tx mock shape.
//   - Tests that specifically proved the REMOVED coarse-guard behavior
//     (second worksheet -> SOURCE_ALREADY_IMPORTED) are RETARGETED to prove
//     the new behavior instead: a second worksheet now reaches per-record
//     reconciliation and is classified, never silently treated as identical
//     to a first-ever import.
//
// T13 (genuine concurrent-Postgres race) and M7 (real-Postgres
// serialization falsification) are NOT here — a mocked prisma.$transaction
// cannot prove genuine Postgres row-locking. Both live in
// tests/postgres-proof/confirmWorksheetFirstImportGuard.postgres-proof.test.ts,
// retargeted for the 6.1B identity-creation race (see that file).

const ROOT = process.cwd();
function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const SERVICE_PATH = "lib/data-hub/importBatch/confirmWorksheet.ts";

const uploadFindFirstMock = vi.fn();
const uploadFindUniqueMock = vi.fn();
const importBatchFindUniqueMock = vi.fn();
const mappingVersionFindUniqueMock = vi.fn();
const sourceMappingFindUniqueMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    upload: {
      findFirst: (...args: unknown[]) => uploadFindFirstMock(...args),
      findUnique: (...args: unknown[]) => uploadFindUniqueMock(...args),
    },
    importBatch: {
      findUnique: (...args: unknown[]) => importBatchFindUniqueMock(...args),
    },
    mappingVersion: {
      findUnique: (...args: unknown[]) => mappingVersionFindUniqueMock(...args),
    },
    sourceMapping: {
      findUnique: (...args: unknown[]) => sourceMappingFindUniqueMock(...args),
    },
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

const storageGetMock = vi.fn();
vi.mock("@/lib/data-hub/importBatch/compositionRoot", () => ({
  createImportBatchStorage: () => ({
    provider: "vercel-blob-private",
    put: vi.fn(),
    head: vi.fn(),
    get: (...args: unknown[]) => storageGetMock(...args),
    delete: vi.fn(),
  }),
}));

async function freshService() {
  vi.resetModules();
  return import("@/lib/data-hub/importBatch/confirmWorksheet");
}

function worksheetRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "worksheet-1",
    import_batch_id: "batch-1",
    worksheet_index: 0,
    canonical_status: "AWAITING_CONFIRMATION",
    mapping_version_id: null,
    ...overrides,
  };
}
function batchRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: "READY",
    content_type: "csv",
    sha256: "deadbeef",
    storage_key: "datahub-batch:org-1:batch-1",
    deleted_at: null,
    source_system_id: "ss-1",
    ...overrides,
  };
}
// 6.1B — source_external_id joined the required headers; every row here
// gets a synthetic, unique value auto-appended unless the caller already
// supplied one, so this guard-focused fixture continues to compile+map
// successfully unchanged for every existing call site.
function csvBody(rows: string[][] = [["2024-01-01", "Main St", "tyres"]]) {
  const withExternalId = rows.map((r, i) => (r.length >= 4 ? r : [...r, `EXT-${i}`]));
  const lines = ["report_date,location,waste_type,source_external_id", ...withExternalId.map((r) => r.join(","))];
  const body = Buffer.from(lines.join("\n") + "\n", "utf8");
  return { body, sha256: createHash("sha256").update(body).digest("hex") };
}

beforeEach(() => {
  uploadFindFirstMock.mockReset();
  uploadFindUniqueMock.mockReset();
  importBatchFindUniqueMock.mockReset();
  mappingVersionFindUniqueMock.mockReset();
  sourceMappingFindUniqueMock.mockReset();
  transactionMock.mockReset();
  storageGetMock.mockReset();
});

// 6.1B — default tx.sourceRecordIdentity/tx.sourceRecordObservation
// doubles: identity.create always succeeds (never throws P2002), so every
// mapped record classifies NEW by default. Tests specifically proving
// "a SECOND worksheet reaches reconciliation and is classified against
// EXISTING history" override this to simulate a pre-existing identity
// (P2002 on create, a resolvable findUniqueOrThrow, and a real prior
// observation to compare against).
function defaultReconciliationTxMocks() {
  let identityCounter = 0;
  return {
    sourceRecordIdentity: {
      create: vi.fn().mockImplementation(async () => ({ id: `sri-${++identityCounter}` })),
      findUniqueOrThrow: vi.fn(),
    },
    sourceRecordObservation: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
}

// 6.1B — a P2002-like error shape sourceRecordIdentity.create's own catch
// block recognizes as "identity already exists" (see confirmWorksheet.ts's
// own `err instanceof Prisma.PrismaClientKnownRequestError && err.code ===
// "P2002"` check). Constructing a real PrismaClientKnownRequestError
// requires @prisma/client's own class + a clientVersion string; simplest
// or most direct route in a unit test is to import the real class.
import { Prisma } from "@prisma/client";
function p2002Error(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

// 6.1B — simulates "this worksheet's SourceSystem already has a prior
// governed import" by making sourceRecordIdentity.create always reject
// with P2002 (identity pre-exists) and findUniqueOrThrow resolve to a
// fixed identity id, with a real prior observation available for hash
// comparison. `matchingHash: true` yields UNCHANGED; `false` yields
// CHANGED — either way, the record reaches classification, never a
// worksheet-level block.
function existingIdentityReconciliationTxMocks(opts: { priorHash: string; matchingHash: boolean }) {
  const observationCreateMock = vi.fn().mockResolvedValue({});
  return {
    sourceRecordIdentity: {
      create: vi.fn().mockRejectedValue(p2002Error()),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "sri-existing" }),
    },
    sourceRecordObservation: {
      create: observationCreateMock,
      findFirst: vi.fn().mockResolvedValue({
        canonical_hash: opts.matchingHash ? opts.priorHash : "0".repeat(64),
      }),
    },
    __observationCreateMock: observationCreateMock,
  };
}

function mockTransactionOnce(
  claimBehavior: "claim" | "lose" | "throw" = "claim",
  reconciliationTxMocks: ReturnType<typeof defaultReconciliationTxMocks> = defaultReconciliationTxMocks()
) {
  const updateManyMock = vi.fn();
  const createManyMock = vi.fn().mockResolvedValue(undefined);
  const illegalDumpingUpdateMock = vi.fn().mockResolvedValue(undefined);
  const findUniqueMock = vi.fn().mockResolvedValue({ canonical_status: "AWAITING_CONFIRMATION" });
  if (claimBehavior === "claim") updateManyMock.mockResolvedValue({ count: 1 });
  else if (claimBehavior === "lose") updateManyMock.mockResolvedValue({ count: 0 });
  else updateManyMock.mockRejectedValue(new Error("simulated claim failure"));

  // 6.1B — the SourceSystem FOR UPDATE lock is the ONLY tx.$queryRaw call
  // remaining (the coarse existence check is removed) — a single resolved
  // value serves it.
  const queryRawMock = vi.fn().mockResolvedValue([{ id: "ss-1" }]);

  // 6.1B — a no-op double for the SAVEPOINT/ROLLBACK TO SAVEPOINT pair
  // around identity creation (required by real Postgres transaction-abort
  // semantics — see confirmWorksheet.ts's own header comment).
  const executeRawMock = vi.fn().mockResolvedValue(undefined);

  transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    return callback({
      $queryRaw: queryRawMock,
      $executeRaw: executeRawMock,
      upload: { updateMany: updateManyMock, findUnique: findUniqueMock },
      illegalDumping: { createMany: createManyMock, update: illegalDumpingUpdateMock },
      ...reconciliationTxMocks,
    });
  });
  return { updateManyMock, createManyMock, illegalDumpingUpdateMock, findUniqueMock, queryRawMock };
}

// ─── Static/SQL-text proof (Section 13/O — parameterized, never string-
//     interpolated; SourceSystem lock only, per 6.1B's own removal of the
//     coarse illegal_dumping existence check) ──────────────────────────

describe("confirmWorksheet — 6.0C1/6.1B SourceSystem lock SQL shape (static)", () => {
  const code = read(SERVICE_PATH);
  const stripped = stripComments(code);

  it("uses tx.$queryRaw with Prisma.sql (never $queryRawUnsafe, never string concatenation)", () => {
    expect(stripped).toMatch(/tx\.\$queryRaw[\s\S]{0,40}Prisma\.sql`/);
    expect(stripped).not.toMatch(/\$queryRawUnsafe/);
  });

  it("the SourceSystem lock query is parameterized (template interpolation), scoped by id AND organisation_id, and uses FOR UPDATE", () => {
    const lockBlock = code.match(/SELECT id FROM source_systems[\s\S]*?FOR UPDATE/)?.[0] ?? "";
    expect(lockBlock).toMatch(/\$\{sourceSystemId\}/);
    expect(lockBlock).toMatch(/\$\{organisationId\}/);
    expect(lockBlock).toMatch(/FOR UPDATE/);
  });

  // 6.1B RETARGETED (removed) — "the existence query targets illegal_dumping
  // directly..." and "the existence query never filters by active..." no
  // longer apply: that query (SELECT EXISTS (...) AS prior_success) is
  // deleted outright, per 6.1B's own guard-transition requirement. Their
  // underlying concerns are superseded by reconciliation's own tenant-safe
  // identity resolution (proven in the dedicated reconciliation tests
  // below and in the real-Postgres proof).

  it("the guard identity never includes mapping_version_id, sha256, filename, idempotency_key, ImportBatch id, or worksheet id (Section 11) — SourceSystem lock only", () => {
    const lockBlock = code.match(/SELECT id FROM source_systems[\s\S]*?FOR UPDATE/)?.[0] ?? "";
    for (const forbidden of ["mapping_version_id", "sha256", "idempotency_key", "worksheetUploadId"]) {
      expect(lockBlock).not.toMatch(new RegExp(forbidden));
    }
  });

  it("the lock runs inside the SAME transaction, immediately before the claim (tx.upload.updateMany) — 6.1B moved the claim up to directly follow the lock", () => {
    const txBody = code.slice(code.indexOf("prisma.$transaction(async (tx) => {"), code.indexOf("\n  });", code.indexOf("prisma.$transaction(")));
    const lockIdx = txBody.indexOf("FOR UPDATE");
    const claimIdx = txBody.indexOf("tx.upload.updateMany(");
    expect(lockIdx).toBeGreaterThan(0);
    expect(claimIdx).toBeGreaterThan(lockIdx);
  });

  it("Step 3.5's NULL-source gate runs before Step 5 storage retrieval (no wasted Blob work for a NULL-source worksheet)", () => {
    const nullGateIdx = code.indexOf("batch.source_system_id === null");
    const storageIdx = code.indexOf("storage.get(");
    expect(nullGateIdx).toBeGreaterThan(0);
    expect(storageIdx).toBeGreaterThan(nullGateIdx);
  });

  it("the coarse SourceSystem-wide existence check (SELECT EXISTS ... AS prior_success) no longer exists anywhere in the file", () => {
    expect(code).not.toMatch(/AS prior_success/);
    expect(code).not.toMatch(/JOIN uploads u ON d\.upload_id = u\.id/);
  });
});

// ─── T1 — first governed import succeeds ────────────────────────────────

describe("confirmWorksheet — 6.0C1 T1: first governed import succeeds", () => {
  it("a worksheet with a non-null SourceSystem and no prior identity imports normally, classified NEW", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = csvBody();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    const { createManyMock } = mockTransactionOnce("claim");
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1, newRows: 1, unchangedRows: 0, changedRows: 0 });
    expect(createManyMock).toHaveBeenCalledTimes(1);
  });
});

// ─── T2 — same-worksheet replay remains idempotent (unaffected by 6.1B) ─

describe("confirmWorksheet — 6.0C1 T2/M8: same-worksheet replay remains idempotent, unaffected by the guard transition", () => {
  it("an already-IMPORTED worksheet short-circuits at Step 2, before any reconciliation/transaction work", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ canonical_status: "IMPORTED" }));
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toEqual({ ok: true, alreadyImported: true, worksheetUploadId: "worksheet-1" });
    expect(importBatchFindUniqueMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

// ─── T3/M1 RETARGETED (6.1B) — second worksheet, same org/SourceSystem,
//     now REACHES reconciliation instead of being blocked ───────────────

describe("confirmWorksheet — 6.1B T3/M1 (supersedes 6.0C1): a second worksheet for the SAME organisation+SourceSystem now reaches per-record reconciliation instead of being blocked", () => {
  it("a second, different worksheet for the same organisation+SourceSystem is NOT blocked — its record is resolved against the existing identity and classified (UNCHANGED here: identical governed fields)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = csvBody([["2024-01-01", "Main St", "tyres", "EXT-1"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ id: "worksheet-2" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    // Precompute the same canonical hash the real mapped row will produce,
    // so the mocked prior observation genuinely matches (UNCHANGED) rather
    // than coincidentally.
    const { computeCanonicalHash } = await import("@/lib/data-hub/importBatch/reconciliation");
    const priorHash = computeCanonicalHash({
      report_date: new Date(Date.UTC(2024, 0, 1)),
      location: "Main St",
      suburb: null,
      zone: null,
      waste_type: "tyres",
      volume_estimate: null,
      severity: "MEDIUM",
      status: "OPEN",
      crew_assigned: null,
      resolution_date: null,
      cost_estimate: null,
      notes: null,
    });
    const { createManyMock, illegalDumpingUpdateMock } = mockTransactionOnce(
      "claim",
      existingIdentityReconciliationTxMocks({ priorHash, matchingHash: true })
    );
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-2", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1, newRows: 0, unchangedRows: 1, changedRows: 0 });
    // UNCHANGED never creates or updates an IllegalDumping row.
    expect(createManyMock).not.toHaveBeenCalled();
    expect(illegalDumpingUpdateMock).not.toHaveBeenCalled();
  });

  it("the failure message for the (still-declared, no-longer-emitted) SOURCE_ALREADY_IMPORTED code never leaks organisation id, SourceSystem id, Upload id, ImportBatch id, prior worksheet id, or row counts", () => {
    const code = read("lib/data-hub/importBatch/failureTaxonomy.ts");
    const messageBlock = code.match(/SOURCE_ALREADY_IMPORTED:\s*\n?\s*"[^"]*"/)?.[0] ?? "";
    expect(messageBlock).not.toMatch(/org-|worksheet-|batch-|ss-\d/);
  });
});

// ─── T4/T5 RETARGETED (6.1B) — file identity (sha256) still never
//     participates in reconciliation identity; a changed snapshot from a
//     new worksheet is classified CHANGED, not blocked ──────────────────

describe("confirmWorksheet — 6.1B T4/T5/M5 (supersedes 6.0C1): reconciliation identity ignores file SHA — a changed snapshot in a new worksheet is classified CHANGED, never blocked", () => {
  it("a NEW worksheet with a DIFFERENT sha256 (a changed snapshot) reaches reconciliation and is classified CHANGED, not blocked — the identity key never reads sha256", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = csvBody([["2024-02-02", "Other St", "mattress", "EXT-1"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ id: "worksheet-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    // A prior hash that will NOT match this row's real computed hash ->
    // CHANGED.
    const { illegalDumpingUpdateMock, createManyMock } = mockTransactionOnce(
      "claim",
      existingIdentityReconciliationTxMocks({ priorHash: "f".repeat(64), matchingHash: false })
    );
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-3", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false, newRows: 0, unchangedRows: 0, changedRows: 1 });
    expect(illegalDumpingUpdateMock).toHaveBeenCalledTimes(1);
    expect(createManyMock).not.toHaveBeenCalled();
  });
});

// ─── T6/M4 RETARGETED (6.1B) — a different frozen MappingVersion has no
//     bearing on reconciliation identity/classification ─────────────────

describe("confirmWorksheet — 6.1B T6/M4 (supersedes 6.0C1): reconciliation identity ignores mapping_version_id — a differently-mapped worksheet for the same identity still reconciles normally", () => {
  it("a mapped worksheet frozen at a DIFFERENT MappingVersion than a prior worksheet still reaches reconciliation for its own identity, never blocked by version mismatch", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body } = csvBody([["2024-01-01", "Main St", "tyres", "EXT-1"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ id: "worksheet-4", mapping_version_id: "mv-9" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: createHash("sha256").update(body).digest("hex"), source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue({ source_mapping_id: "sm-1", mapping_document: { fields: { report_date: "report_date", location: "location", waste_type: "waste_type", source_external_id: "source_external_id" } } });
    sourceMappingFindUniqueMock.mockResolvedValue({ source_system_id: "ss-1" });
    storageGetMock.mockResolvedValue({ body });
    const { createManyMock } = mockTransactionOnce("claim", defaultReconciliationTxMocks());
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-4", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false, newRows: 1 });
    expect(createManyMock).toHaveBeenCalledTimes(1);
  });
});

// ─── T7 — failed first attempt does not create any reconciliation state ─

describe("confirmWorksheet — 6.0C1 T7: a failed attempt (mapping/PARSER_REJECTED) creates zero reconciliation state", () => {
  it("a malformed CSV fails before the transaction ever opens — no identity/observation is ever created", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const body = Buffer.from("foo,bar\n1,2\n", "utf8");
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: createHash("sha256").update(body).digest("hex"), source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "PARSER_REJECTED" });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

// ─── T8/M6 — transaction rollback leaves no lingering reconciliation state ─

describe("confirmWorksheet — 6.0C1 T8/M6: a rolled-back transaction (claim throws) never leaves lingering reconciliation state", () => {
  it("the service creates no separate attempt/marker table of its own beyond the schema's own SourceRecordIdentity/SourceRecordObservation/IllegalDumping tables", () => {
    const code = read(SERVICE_PATH);
    expect(code).not.toMatch(/attempt_marker|guard_ledger|import_attempt/i);
  });

  it("a claim-transaction throw propagates uncaught (Prisma's own rollback is the sole guarantee — no swallowing/partial-commit logic added by this guard or by reconciliation)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = csvBody();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    mockTransactionOnce("throw");
    await expect(confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" })).rejects.toThrow(
      "simulated claim failure"
    );
  });

  it("a reconciliation-integrity failure (Case C) rolls back the claim too — RECONCILIATION_HISTORY_INCONSISTENT, not a swallowed/partial commit", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = csvBody();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    // Identity pre-exists (P2002) but has ZERO prior observations -> Case C.
    mockTransactionOnce("claim", {
      sourceRecordIdentity: {
        create: vi.fn().mockRejectedValue(p2002Error()),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "sri-existing" }),
      },
      sourceRecordObservation: {
        create: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "RECONCILIATION_HISTORY_INCONSISTENT" });
  });
});

// ─── T9/M2 — different SourceSystem is unaffected (unchanged by 6.1B) ───

describe("confirmWorksheet — 6.0C1 T9/M2: a different SourceSystem in the SAME organisation is unaffected by a prior identity elsewhere", () => {
  it("a first import for ss-2 is unaffected by any prior state for ss-1 — classified NEW, its own identity resolution never touches ss-1's", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = csvBody();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-2" }));
    storageGetMock.mockResolvedValue({ body });
    const { createManyMock } = mockTransactionOnce("claim");
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false, newRows: 1 });
    expect(createManyMock).toHaveBeenCalledTimes(1);
  });
});

// ─── T10/M3 — different organisation is unaffected (tenant isolation,
//     unchanged by 6.1B — the schema's own composite tenant-safe FKs are
//     the real enforcement, proven end-to-end in the real-Postgres proof) ─

describe("confirmWorksheet — 6.0C1 T10/M3: a different organisation is unaffected by a prior identity for the SAME SourceSystem id in another tenant", () => {
  it("org-2's own first import for a SourceSystem id 'ss-1' is unaffected by any org-1/ss-1 state — classified NEW", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = csvBody();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    const { createManyMock } = mockTransactionOnce("claim");
    const result = await confirmDataHubWorksheet({ organisationId: "org-2", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false, newRows: 1 });
    expect(createManyMock).toHaveBeenCalledTimes(1);
  });
});

// ─── T11 — domain scoping is structural (unaffected by 6.1B: the identity
//     key includes a fixed domain_kind literal, not a generic proxy) ────

describe("confirmWorksheet — 6.0C1/6.1B T11: domain scoping is structural — reconciliation identity is scoped by a fixed domain_kind, never a generic lineage/status proxy", () => {
  it("the reconciliation identity resolution uses a fixed 'ILLEGAL_DUMPING' domain_kind literal, never Upload.lineage_kind/canonical_status", () => {
    const code = read(SERVICE_PATH);
    expect(code).toMatch(/DOMAIN_KIND\s*=\s*["']ILLEGAL_DUMPING["']/);
  });
});

// ─── T12 RETARGETED (6.1B) — deactivated SourceSystem after a prior
//     identity/observation still counts (unchanged historical-preservation
//     principle, now enforced by reconciliation's own lack of any `active`
//     filter, mirroring the original guard's own rule) ──────────────────

describe("confirmWorksheet — 6.0C1/6.1B T12: prior reconciliation history remains authoritative even if the SourceSystem is later deactivated", () => {
  it("the SourceSystem lock query never references `active` — deactivation cannot erase historical reconciliation state (static, see also the SQL-shape block above)", () => {
    const code = read(SERVICE_PATH);
    const lockBlock = code.match(/SELECT id FROM source_systems[\s\S]*?FOR UPDATE/)?.[0] ?? "";
    expect(lockBlock).not.toMatch(/\bactive\b/);
  });

  it("reconciliation identity resolution itself never filters by SourceSystem/SourceMapping/MappingVersion `active` — a deactivated SourceSystem's prior identity is still found and reconciled against", () => {
    const code = read(SERVICE_PATH);
    // Scope the search to the reconciliation block only (between the claim
    // and the final createMany), avoiding false positives from unrelated
    // `active` references elsewhere in the file (there are none, but this
    // keeps the assertion precise about WHERE it holds).
    const reconciliationStart = code.indexOf("sourceRecordIdentity.create");
    const reconciliationEnd = code.indexOf("if (newDomainRows.length > 0)");
    const reconciliationBlock = code.slice(reconciliationStart, reconciliationEnd);
    expect(reconciliationBlock).not.toMatch(/\bactive\b/);
  });
});

// ─── T14/M9 — client omission/manipulation cannot bypass reconciliation
//     (unchanged trusted-input-only discipline) ─────────────────────────

describe("confirmWorksheet — 6.0C1 T14/M9: client cannot bypass reconciliation — trusted persisted values only, zero request body", () => {
  it("confirmDataHubWorksheet's ONLY parameters are organisationId/worksheetUploadId/confirmedBy — no sourceSystemId/expectedMappingVersionId/organisationId override of any kind can be supplied", () => {
    const code = read(SERVICE_PATH);
    const block = code.match(/export interface ConfirmWorksheetTrustedContext \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).not.toMatch(/sourceSystemId/);
  });

  it("sourceSystemId used by reconciliation identity resolution is read exclusively from the trusted, tenant-scoped ImportBatch row (batch.source_system_id) — never from any parameter", () => {
    const code = read(SERVICE_PATH);
    expect(code).toMatch(/const sourceSystemId = batch\.source_system_id;/);
  });

  it("a NULL-source worksheet fails closed BEFORE any domain write — cannot be routed around reconciliation by omitting SourceSystem at initiate (M9)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ source_system_id: null }));
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_LINEAGE_REQUIRED" });
    expect(storageGetMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

// ─── T15 — NULL-source Illegal Dumping Confirm fails closed (unchanged) ─

describe("confirmWorksheet — 6.0C1 T15: NULL-source Illegal Dumping Confirm fails closed, zero writes", () => {
  it("batch.source_system_id === null -> SOURCE_LINEAGE_REQUIRED, worksheet never transitions to IMPORTED, zero IllegalDumping rows", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ source_system_id: null }));
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toEqual({ ok: false, code: "SOURCE_LINEAGE_REQUIRED", message: expect.any(String) });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

// ─── T16 — customer-data independence (structural, unchanged) ──────────

describe("confirmWorksheet — 6.0C1 T16: SourceSystem lock identity/logic has zero dependency on customer/CSV row content", () => {
  it("the lock query's own code references no CSV/mapper-specific identifiers (Status/Site Address/Ticket #/etc.) — identity is organisation_id + source_system_id only", () => {
    const code = read(SERVICE_PATH);
    const lockBlock = code.match(/SELECT id FROM source_systems[\s\S]*?FOR UPDATE/)?.[0] ?? "";
    for (const forbidden of ["Ticket", "Site Address", "Status", "waste_type", "report_date"]) {
      expect(lockBlock).not.toMatch(forbidden);
    }
  });
});

// ─── M2/M3 mutation-target predicate shape proof (structural — the actual
//     mutation/restoration cycle is performed live during implementation
//     review, not re-executed on every CI run; this proves the exact
//     predicate shape the mutation would remove). Scoped to the
//     SourceSystem lock only, per 6.1B's removal of the existence query. ──

describe("confirmWorksheet — 6.0C1 mutation-target predicate shape (M2/M3 structural anchor)", () => {
  it("the lock query's WHERE clause has EXACTLY two predicates: id and organisation_id (removing either is the M2/M3 mutation target)", () => {
    const code = read(SERVICE_PATH);
    const lockBlock = code.match(/SELECT id FROM source_systems\s*\n\s*WHERE[\s\S]*?FOR UPDATE/)?.[0] ?? "";
    const whereClause = lockBlock.match(/WHERE([\s\S]*?)FOR UPDATE/)?.[1] ?? "";
    const predicateCount = (whereClause.match(/\$\{/g) ?? []).length;
    expect(predicateCount).toBe(2);
  });
});

// ─── 6.1B NEW — the reconciliation identity resolution's own compound key
//     shape (the schema-level enforcement is proven in the real-Postgres
//     proof; this is the mocked-behavioral analog confirming the SERVICE
//     actually supplies all four key components on every create attempt) ─

describe("confirmWorksheet — 6.1B reconciliation identity key shape", () => {
  it("every sourceRecordIdentity.create call supplies organisation_id, source_system_id, domain_kind, and source_external_id — never a partial key", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = csvBody([["2024-01-01", "Main St", "tyres", "EXT-42"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    const reconciliationMocks = defaultReconciliationTxMocks();
    mockTransactionOnce("claim", reconciliationMocks);
    await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(reconciliationMocks.sourceRecordIdentity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          organisation_id: "org-1",
          source_system_id: "ss-1",
          domain_kind: "ILLEGAL_DUMPING",
          source_external_id: "EXT-42",
        },
      })
    );
  });
});
