import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";

// Data Hub 6.0C1 — dedicated mocked-behavioral proof for the temporary
// first-import / repeat-import fail-closed safety guard added to
// confirmWorksheet.ts's existing atomic transaction. Mirrors
// confirmWorksheet.test.ts's own established mock shape exactly (same
// module mocks, same fixture helpers) so this file exercises the REAL,
// unmodified confirmDataHubWorksheet — never a reimplementation.
//
// T13 (genuine concurrent-Postgres race, exactly one success) and M7
// (deterministic real-Postgres falsification of the FOR UPDATE
// serialization) are NOT here — a mocked prisma.$transaction cannot prove
// genuine Postgres row-locking. Both live in
// tests/postgres-proof/confirmWorksheetFirstImportGuard.postgres-proof.test.ts.

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
function csvBody(rows: string[][] = [["2024-01-01", "Main St", "tyres"]]) {
  const lines = ["report_date,location,waste_type", ...rows.map((r) => r.join(","))];
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

// A tiny in-memory "ledger" model of the real illegal_dumping/uploads/
// import_batches join, keyed exactly like the guard's own real query:
// organisation_id + source_system_id. Each entry in `priorSuccesses` is a
// {organisationId, sourceSystemId} pair standing in for a real committed
// IllegalDumping row's lineage. This is a MOCK of the SQL query's RESULT,
// never a reimplementation of the query itself — the real query text lives
// only in confirmWorksheet.ts, verified separately by the static/SQL-text
// assertions below and by the real-Postgres proof.
// ROW-AWARE (mirrors confirmWorksheet.test.ts's own established 5B.4D
// race-test pattern): rather than pre-computing "the correct answer" from
// values this test file already knows, this mock receives the REAL
// Prisma.sql query object the service itself constructed (`.values` are
// the actual bound parameters in order; `.strings` are the literal text
// segments immediately preceding each one) and evaluates it against a tiny
// ledger — exactly like a real `WHERE` clause would. A predicate that the
// mutated source code no longer interpolates is simply ABSENT from
// `.values`, which this mock (like real SQL) treats as "no filter" — this
// is what lets M2 (drop source_system_id) and M3 (drop organisation_id)
// be caught by a genuine behavioral difference, not a canned response.
function makeGuardQueryRawMock(opts: { sourceSystemExists?: boolean; priorSuccesses?: { organisationId: string; sourceSystemId: string }[] }) {
  const { sourceSystemExists = true, priorSuccesses = [] } = opts;
  let call = 0;
  return vi.fn().mockImplementation(async (query: { values: unknown[]; strings: string[] }) => {
    call += 1;
    const { values, strings } = query;
    if (call === 1) {
      // (a) the SourceSystem FOR UPDATE lock query — not a mutation target
      // in this suite (M2/M3 target the existence query only).
      return sourceSystemExists ? [{ id: values[0] }] : [];
    }
    // (b) the illegal_dumping existence query — genuinely evaluate the
    // REAL bound predicates against the ledger. Also recognizes
    // mapping_version_id/sha256 if a mutation adds them as NEW predicates
    // (M4/M5 targets) — the ledger's own ground-truth ("a prior success
    // exists for org+source, full stop") deliberately carries neither
    // field, so a mutated query that starts filtering by either one will
    // correctly fail to match, exposing the defect.
    const predicate: { organisationId?: unknown; sourceSystemId?: unknown; extra?: unknown } = {};
    for (let i = 0; i < values.length; i++) {
      const precedingText = strings[i] ?? "";
      if (/organisation_id/.test(precedingText)) predicate.organisationId = values[i];
      else if (/source_system_id/.test(precedingText)) predicate.sourceSystemId = values[i];
      else if (/mapping_version_id|sha256/.test(precedingText)) predicate.extra = values[i];
    }
    const found = priorSuccesses.some((p) => {
      if (predicate.organisationId !== undefined && p.organisationId !== predicate.organisationId) return false;
      if (predicate.sourceSystemId !== undefined && p.sourceSystemId !== predicate.sourceSystemId) return false;
      // The ledger never carries a mapping_version_id/sha256 field — any
      // predicate on either is structurally unsatisfiable against real
      // ground truth (Section 11: neither may ever narrow the identity).
      if (predicate.extra !== undefined) return false;
      return true;
    });
    return [{ prior_success: found }];
  });
}

function mockTransactionOnce(
  queryRawOpts: { sourceSystemExists?: boolean; priorSuccesses?: { organisationId: string; sourceSystemId: string }[] },
  claimBehavior: "claim" | "lose" | "throw" = "claim"
) {
  const updateManyMock = vi.fn();
  const createManyMock = vi.fn().mockResolvedValue(undefined);
  const findUniqueMock = vi.fn().mockResolvedValue({ canonical_status: "AWAITING_CONFIRMATION" });
  if (claimBehavior === "claim") updateManyMock.mockResolvedValue({ count: 1 });
  else if (claimBehavior === "lose") updateManyMock.mockResolvedValue({ count: 0 });
  else updateManyMock.mockRejectedValue(new Error("simulated claim failure"));

  transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    return callback({
      $queryRaw: makeGuardQueryRawMock(queryRawOpts),
      upload: { updateMany: updateManyMock, findUnique: findUniqueMock },
      illegalDumping: { createMany: createManyMock },
    });
  });
  return { updateManyMock, createManyMock, findUniqueMock };
}

// ─── Static/SQL-text proof (Section 13/O — parameterized, never string-
//     interpolated; queries the illegal_dumping table directly, never
//     Upload.lineage_kind/canonical_status as a domain proxy) ────────────

describe("confirmWorksheet — 6.0C1 guard SQL shape (static)", () => {
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

  it("the existence query targets illegal_dumping directly (never Upload.canonical_status/lineage_kind as a domain proxy), joined through upload_id -> import_batch_id -> source_system_id", () => {
    const existsBlock = code.match(/SELECT EXISTS \([\s\S]*?\) AS prior_success/)?.[0] ?? "";
    expect(existsBlock).toMatch(/FROM illegal_dumping/);
    expect(existsBlock).toMatch(/JOIN uploads/);
    expect(existsBlock).toMatch(/JOIN import_batches/);
    expect(existsBlock).toMatch(/\$\{organisationId\}/);
    expect(existsBlock).toMatch(/\$\{sourceSystemId\}/);
    // Never filtered by lineage_kind/canonical_status — domain scoping
    // comes from the illegal_dumping table itself, not a generic flag.
    expect(existsBlock).not.toMatch(/lineage_kind/);
    expect(existsBlock).not.toMatch(/canonical_status/);
  });

  it("the existence query never filters by `active` (deactivation must not erase historical success — Section 20)", () => {
    const existsBlock = code.match(/SELECT EXISTS \([\s\S]*?\) AS prior_success/)?.[0] ?? "";
    expect(existsBlock).not.toMatch(/\bactive\b/);
  });

  it("the guard identity never includes mapping_version_id, sha256, filename, idempotency_key, ImportBatch id, or worksheet id (Section 11)", () => {
    const lockBlock = code.match(/SELECT id FROM source_systems[\s\S]*?FOR UPDATE/)?.[0] ?? "";
    const existsBlock = code.match(/SELECT EXISTS \([\s\S]*?\) AS prior_success/)?.[0] ?? "";
    for (const forbidden of ["mapping_version_id", "sha256", "idempotency_key", "worksheetUploadId"]) {
      expect(lockBlock).not.toMatch(new RegExp(forbidden));
      expect(existsBlock).not.toMatch(new RegExp(forbidden));
    }
  });

  it("the guard runs inside the SAME transaction, before the existing claim (tx.upload.updateMany)", () => {
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
});

// ─── T1 — first governed import succeeds ────────────────────────────────

describe("confirmWorksheet — 6.0C1 T1: first governed import succeeds", () => {
  it("a worksheet with a non-null SourceSystem and no prior success imports normally", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = csvBody();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    const { createManyMock } = mockTransactionOnce({ priorSuccesses: [] }, "claim");
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false, importedRows: 1 });
    expect(createManyMock).toHaveBeenCalledTimes(1);
  });
});

// ─── T2 — same-worksheet replay remains idempotent (guard never reached) ─

describe("confirmWorksheet — 6.0C1 T2/M8: same-worksheet replay remains idempotent, guard never reached", () => {
  it("an already-IMPORTED worksheet short-circuits at Step 2, before any guard/transaction work", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ canonical_status: "IMPORTED" }));
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toEqual({ ok: true, alreadyImported: true, worksheetUploadId: "worksheet-1" });
    expect(importBatchFindUniqueMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

// ─── T3/M1 — second worksheet, same org/source/domain, blocked ──────────

describe("confirmWorksheet — 6.0C1 T3/M1: second worksheet same organisation+SourceSystem blocked", () => {
  it("a prior committed success for this organisation+SourceSystem blocks a second, different worksheet before its own claim/domain write", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = csvBody();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ id: "worksheet-2" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    const { updateManyMock, createManyMock } = mockTransactionOnce(
      { priorSuccesses: [{ organisationId: "org-1", sourceSystemId: "ss-1" }] },
      "claim"
    );
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-2", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_ALREADY_IMPORTED" });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it("the failure message never leaks organisation id, SourceSystem id, Upload id, ImportBatch id, prior worksheet id, or row counts", () => {
    const code = read("lib/data-hub/importBatch/failureTaxonomy.ts");
    const messageBlock = code.match(/SOURCE_ALREADY_IMPORTED:\s*\n?\s*"[^"]*"/)?.[0] ?? "";
    expect(messageBlock).not.toMatch(/org-|worksheet-|batch-|ss-\d/);
  });
});

// ─── T4/T5 — identity ignores file identity (same physical file / changed
//     snapshot in a new batch both blocked, via the SAME org+source check) ─

describe("confirmWorksheet — 6.0C1 T4/T5/M5: guard identity ignores file SHA — same or changed snapshot both blocked once a prior success exists", () => {
  it("a NEW worksheet with a DIFFERENT sha256 (a changed snapshot) is still blocked — the guard never reads sha256", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body } = csvBody([["2024-02-02", "Other St", "mattress"]]);
    const differentSha = createHash("sha256").update(body).digest("hex") + "-different";
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ id: "worksheet-3" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: createHash("sha256").update(body).digest("hex"), source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    void differentSha;
    mockTransactionOnce({ priorSuccesses: [{ organisationId: "org-1", sourceSystemId: "ss-1" }] }, "claim");
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-3", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_ALREADY_IMPORTED" });
  });
});

// ─── T6/M4 — different MappingVersion does not create a new allowance ───

describe("confirmWorksheet — 6.0C1 T6/M4: guard identity ignores mapping_version_id — a different frozen version is still blocked", () => {
  it("a mapped worksheet frozen at a DIFFERENT MappingVersion than the prior success is still blocked", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body } = csvBody([["2024-01-01", "Main St", "tyres"]]);
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ id: "worksheet-4", mapping_version_id: "mv-9" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256: createHash("sha256").update(body).digest("hex"), source_system_id: "ss-1" }));
    mappingVersionFindUniqueMock.mockResolvedValue({ source_mapping_id: "sm-1", mapping_document: { fields: { report_date: "report_date", location: "location", waste_type: "waste_type" } } });
    sourceMappingFindUniqueMock.mockResolvedValue({ source_system_id: "ss-1" });
    storageGetMock.mockResolvedValue({ body });
    mockTransactionOnce({ priorSuccesses: [{ organisationId: "org-1", sourceSystemId: "ss-1" }] }, "claim");
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-4", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_ALREADY_IMPORTED" });
  });
});

// ─── T7 — failed first attempt does not consume the allowance ───────────

describe("confirmWorksheet — 6.0C1 T7: a failed first attempt (mapping/PARSER_REJECTED) does not consume the allowance", () => {
  it("a malformed CSV fails before the transaction ever opens — the guard is never even reached, zero allowance consumed", async () => {
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

// ─── T8/M6 — transaction rollback does not consume the allowance ────────

describe("confirmWorksheet — 6.0C1 T8/M6: a rolled-back transaction (claim throws) never leaves a lingering allowance-consuming marker", () => {
  it("the guard reads ONLY committed illegal_dumping rows — this service creates no separate attempt/marker table of its own", () => {
    const code = read(SERVICE_PATH);
    // Structural proof: no INSERT/marker/attempt bookkeeping exists outside
    // the illegalDumping.createMany write itself.
    expect(code).not.toMatch(/attempt_marker|guard_ledger|import_attempt/i);
  });

  it("a claim-transaction throw propagates uncaught (Prisma's own rollback is the sole guarantee — no swallowing/partial-commit logic added by this guard)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = csvBody();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    mockTransactionOnce({ priorSuccesses: [] }, "throw");
    await expect(confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" })).rejects.toThrow(
      "simulated claim failure"
    );
  });
});

// ─── T9/M2 — different SourceSystem is unaffected ───────────────────────

describe("confirmWorksheet — 6.0C1 T9/M2: a different SourceSystem in the SAME organisation is unaffected by a prior success elsewhere", () => {
  it("a prior success for ss-1 does not block a first import for ss-2", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = csvBody();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-2" }));
    storageGetMock.mockResolvedValue({ body });
    const { createManyMock } = mockTransactionOnce({ priorSuccesses: [{ organisationId: "org-1", sourceSystemId: "ss-1" }] }, "claim");
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false });
    expect(createManyMock).toHaveBeenCalledTimes(1);
  });
});

// ─── T10/M3 — different organisation is unaffected (tenant isolation) ───

describe("confirmWorksheet — 6.0C1 T10/M3: a different organisation is unaffected by a prior success for the SAME SourceSystem id in another tenant", () => {
  it("a prior success recorded for org-1/ss-1 does not block org-2's own first import, even if org-2 also happens to reference a SourceSystem id 'ss-1'", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = csvBody();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    const { createManyMock } = mockTransactionOnce({ priorSuccesses: [{ organisationId: "org-1", sourceSystemId: "ss-1" }] }, "claim");
    const result = await confirmDataHubWorksheet({ organisationId: "org-2", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: true, alreadyImported: false });
    expect(createManyMock).toHaveBeenCalledTimes(1);
  });
});

// ─── T11 — a hypothetical different domain kind is not accidentally
//     blocked (structural: only illegal_dumping is ever queried) ────────

describe("confirmWorksheet — 6.0C1 T11: domain scoping is structural — a future different Data Hub domain sharing lineage_kind=DATA_HUB cannot be accidentally blocked", () => {
  it("the guard's existence query references only the illegal_dumping table — never a generic Upload.lineage_kind/canonical_status proxy for 'any domain'", () => {
    const code = read(SERVICE_PATH);
    const existsBlock = code.match(/SELECT EXISTS \([\s\S]*?\) AS prior_success/)?.[0] ?? "";
    expect(existsBlock).toMatch(/illegal_dumping/);
    expect(existsBlock).not.toMatch(/DATA_HUB/);
  });
});

// ─── T12 — deactivated SourceSystem after success still counts ──────────

describe("confirmWorksheet — 6.0C1 T12: a prior success remains authoritative even if the SourceSystem is later deactivated", () => {
  it("the guard's queries never reference `active` — deactivation cannot erase historical success (static, see also the SQL-shape block above)", () => {
    const code = read(SERVICE_PATH);
    const lockBlock = code.match(/SELECT id FROM source_systems[\s\S]*?FOR UPDATE/)?.[0] ?? "";
    expect(lockBlock).not.toMatch(/\bactive\b/);
  });

  it("a prior success still blocks a second worksheet even though the mocked SourceSystem lock succeeds regardless of any `active` state (the lock query itself never conditions on it)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    const { body, sha256 } = csvBody();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ id: "worksheet-5" }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ sha256, source_system_id: "ss-1" }));
    storageGetMock.mockResolvedValue({ body });
    mockTransactionOnce({ priorSuccesses: [{ organisationId: "org-1", sourceSystemId: "ss-1" }] }, "claim");
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-5", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_ALREADY_IMPORTED" });
  });
});

// ─── T14/M9 — client omission/manipulation cannot bypass the guard ──────

describe("confirmWorksheet — 6.0C1 T14/M9: client cannot bypass the guard — trusted persisted values only, zero request body", () => {
  it("confirmDataHubWorksheet's ONLY parameters are organisationId/worksheetUploadId/confirmedBy — no sourceSystemId/expectedMappingVersionId/organisationId override of any kind can be supplied", () => {
    const code = read(SERVICE_PATH);
    const block = code.match(/export interface ConfirmWorksheetTrustedContext \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(block).not.toMatch(/sourceSystemId/);
  });

  it("sourceSystemId used by the guard is read exclusively from the trusted, tenant-scoped ImportBatch row (batch.source_system_id) — never from any parameter", () => {
    const code = read(SERVICE_PATH);
    expect(code).toMatch(/const sourceSystemId = batch\.source_system_id;/);
  });

  it("a NULL-source worksheet fails closed BEFORE any domain write — cannot be routed around the guard by omitting SourceSystem at initiate (M9)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow());
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ source_system_id: null }));
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_LINEAGE_REQUIRED" });
    expect(storageGetMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

// ─── T15 — NULL-source Illegal Dumping Confirm fails closed ─────────────

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

// ─── T16 — customer-data independence (structural) ───────────────────────

describe("confirmWorksheet — 6.0C1 T16: guard identity/logic has zero dependency on customer/CSV row content", () => {
  it("the guard's own code references no CSV/mapper-specific identifiers (Status/Site Address/Ticket #/etc.) — identity is organisation_id + source_system_id only", () => {
    const code = read(SERVICE_PATH);
    const lockBlock = code.match(/SELECT id FROM source_systems[\s\S]*?FOR UPDATE/)?.[0] ?? "";
    const existsBlock = code.match(/SELECT EXISTS \([\s\S]*?\) AS prior_success/)?.[0] ?? "";
    for (const forbidden of ["Ticket", "Site Address", "Status", "waste_type", "report_date"]) {
      expect(lockBlock).not.toMatch(forbidden);
      expect(existsBlock).not.toMatch(forbidden);
    }
  });
});

// ─── M2/M3 mutation-target predicate shape proof (structural — the actual
//     mutation/restoration cycle is performed live during implementation
//     review, not re-executed on every CI run; this proves the exact
//     predicate shape the mutation would remove) ─────────────────────────

describe("confirmWorksheet — 6.0C1 mutation-target predicate shape (M2/M3 structural anchor)", () => {
  it("the lock query's WHERE clause has EXACTLY two predicates: id and organisation_id (removing either is the M2/M3 mutation target)", () => {
    const code = read(SERVICE_PATH);
    const lockBlock = code.match(/SELECT id FROM source_systems\s*\n\s*WHERE[\s\S]*?FOR UPDATE/)?.[0] ?? "";
    const whereClause = lockBlock.match(/WHERE([\s\S]*?)FOR UPDATE/)?.[1] ?? "";
    const predicateCount = (whereClause.match(/\$\{/g) ?? []).length;
    expect(predicateCount).toBe(2);
  });

  it("the existence query's WHERE clause has EXACTLY two predicates: organisation_id and source_system_id", () => {
    const code = read(SERVICE_PATH);
    const existsBlock = code.match(/SELECT EXISTS \([\s\S]*?\) AS prior_success/)?.[0] ?? "";
    const whereClause = existsBlock.match(/WHERE([\s\S]*?)\)/)?.[1] ?? "";
    const predicateCount = (whereClause.match(/\$\{/g) ?? []).length;
    expect(predicateCount).toBe(2);
  });
});
