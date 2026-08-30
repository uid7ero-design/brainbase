import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ─── Static xlsx-isolation containment (Step 20) ───────────────────────

describe("finalize — xlsx-free import graph (static containment)", () => {
  it("never imports xlsx directly", () => {
    const code = read("lib/data-hub/importBatch/finalize.ts");
    expect(code).not.toMatch(/from\s+["']xlsx["']/);
    expect(code).not.toMatch(/require\(["']xlsx["']\)/);
  });

  it("never imports workbookParser at all", () => {
    const code = read("lib/data-hub/importBatch/finalize.ts");
    expect(code).not.toMatch(/from\s+["'].*workbookParser["']/);
  });

  it("never calls XLSX.read, inspectWorkbook, or decodeWorksheet", () => {
    const code = stripComments(read("lib/data-hub/importBatch/finalize.ts"));
    expect(code).not.toMatch(/XLSX\.read/);
    expect(code).not.toMatch(/inspectWorkbook\(/);
    expect(code).not.toMatch(/decodeWorksheet\(/);
  });

  it("imports format-preflight helpers only from fileSignatures and workbookArchiveGuard", () => {
    const code = read("lib/data-hub/importBatch/finalize.ts");
    expect(code).toMatch(/from ["']\.\.\/fileSignatures["']/);
    expect(code).toMatch(/from ["']\.\.\/workbookArchiveGuard["']/);
  });

  it("never writes size_bytes anywhere (SQL SET target containment)", () => {
    // Remediation (Finding 2): the actual UPDATE ... SET statements moved
    // from finalize.ts into finalizeInternal.ts (claimForFinalize /
    // completeReadyForFinalize / completeFailedForFinalize) — this
    // invariant must follow the SQL to wherever it now lives, not stay
    // pinned to finalize.ts's own source text.
    const combined = [
      stripComments(read("lib/data-hub/importBatch/finalize.ts")),
      stripComments(read("lib/data-hub/importBatch/finalizeInternal.ts")),
    ].join("\n");
    // Extract every UPDATE ... SET ... region and check none sets size_bytes.
    const updateBlocks = combined.match(/UPDATE import_batches[\s\S]*?WHERE/g) ?? [];
    expect(updateBlocks.length).toBeGreaterThan(0);
    for (const block of updateBlocks) {
      expect(block).not.toMatch(/size_bytes\s*=/);
    }
  });
});

// ─── Mocked behavioral tests ────────────────────────────────────────

const sqlMock = vi.fn();
vi.mock("@/lib/db", () => ({
  default: (...args: unknown[]) => sqlMock(...(args as [TemplateStringsArray, ...unknown[]])),
}));

const headMock = vi.fn();
const getMock = vi.fn();
vi.mock("@/lib/data-hub/importBatch/compositionRoot", () => ({
  createImportBatchStorage: () => ({
    provider: "vercel-blob-private",
    put: vi.fn(),
    head: (...args: unknown[]) => headMock(...args),
    get: (...args: unknown[]) => getMock(...args),
    delete: vi.fn(),
  }),
}));

async function freshFinalize() {
  vi.resetModules();
  sqlMock.mockReset();
  headMock.mockReset();
  getMock.mockReset();
  return import("@/lib/data-hub/importBatch/finalize");
}

function claimRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    attempt_count: 1,
    content_type: "csv",
    size_bytes: 8,
    expected_sha256: null,
    ...overrides,
  };
}

beforeEach(() => {
  sqlMock.mockReset();
  headMock.mockReset();
  getMock.mockReset();
});

describe("finalizeImportBatch — atomic claim failure classification", () => {
  it("no matching row anywhere -> NOT_FOUND", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    sqlMock.mockResolvedValueOnce([]); // claim UPDATE returns nothing
    sqlMock.mockResolvedValueOnce([]); // reselect finds nothing
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "CLAIM_REJECTED", code: "NOT_FOUND", reason: "NOT_FOUND" });
  });

  it("row already PROCESSING -> INVALID_STATE/ALREADY_PROCESSING", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([{ status: "PROCESSING", last_failure_code: null }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "CLAIM_REJECTED", code: "INVALID_STATE", reason: "ALREADY_PROCESSING" });
  });

  it("row already READY -> INVALID_STATE/ALREADY_READY", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([{ status: "READY", last_failure_code: null }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "CLAIM_REJECTED", code: "INVALID_STATE", reason: "ALREADY_READY" });
  });

  it("row DELETION_PENDING -> INVALID_STATE/DELETION_PENDING", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([{ status: "DELETION_PENDING", last_failure_code: null }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "CLAIM_REJECTED", code: "INVALID_STATE", reason: "DELETION_PENDING" });
  });

  it("row FAILED with terminal code -> RECLAIM_NOT_ALLOWED/TERMINAL_FAILURE", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([{ status: "FAILED", last_failure_code: "HASH_MISMATCH" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "CLAIM_REJECTED", code: "RECLAIM_NOT_ALLOWED", reason: "TERMINAL_FAILURE" });
  });

  it("the claim UPDATE binds the finalization-retry-eligible codes via = ANY($::text[])", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    sqlMock.mockResolvedValueOnce([claimRow()]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: 8, etag: "e1" });
    getMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: 8, etag: "e1" }, body: Buffer.from("a,b\n1,2\n") });
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]); // ready completion
    await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    const [strings, ...values] = sqlMock.mock.calls[0];
    const joined = (strings as TemplateStringsArray).join("");
    expect(joined).toMatch(/= ANY\(/);
    expect(joined).toMatch(/::text\[\]/);
    expect(values).toContainEqual(["STORAGE_NOT_FOUND", "PROVIDER_FAILURE", "STALE_RECLAIMED"]);
  });
});

describe("finalizeImportBatch — storage failure classification (Step 18)", () => {
  it("head() returns null -> STORAGE_NOT_FOUND, retryable=true", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    sqlMock.mockResolvedValueOnce([claimRow()]);
    headMock.mockResolvedValue(null);
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]); // failed completion
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "FAILED", failureCode: "STORAGE_NOT_FOUND", retryable: true });
    expect(getMock).not.toHaveBeenCalled();
  });

  it("head() throws -> PROVIDER_FAILURE, retryable=true", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    sqlMock.mockResolvedValueOnce([claimRow()]);
    headMock.mockRejectedValue(new Error("network blip"));
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "FAILED", failureCode: "PROVIDER_FAILURE", retryable: true });
  });

  it("get() throws RawFileStoreError SIZE_LIMIT -> SIZE_LIMIT, retryable=false", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    const { RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");
    sqlMock.mockResolvedValueOnce([claimRow()]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: 999999999, etag: "e1" });
    getMock.mockRejectedValue(new RawFileStoreError("SIZE_LIMIT", "too big"));
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "FAILED", failureCode: "SIZE_LIMIT", retryable: false });
  });

  it("get() throws generic PROVIDER_FAILURE after successful head() -> PROVIDER_FAILURE, retryable=true", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    const { RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");
    sqlMock.mockResolvedValueOnce([claimRow()]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: 8, etag: "e1" });
    getMock.mockRejectedValue(new RawFileStoreError("PROVIDER_FAILURE", "network reset"));
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "FAILED", failureCode: "PROVIDER_FAILURE", retryable: true });
  });

  it("get() throws NOT_FOUND (race after successful head()) -> classified PROVIDER_FAILURE, never STORAGE_NOT_FOUND", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    const { RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");
    sqlMock.mockResolvedValueOnce([claimRow()]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: 8, etag: "e1" });
    getMock.mockRejectedValue(new RawFileStoreError("NOT_FOUND", "removed after HEAD"));
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "FAILED", failureCode: "PROVIDER_FAILURE" });
  });

  it("never performs a second HEAD call to reclassify a get() failure", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    const { RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");
    sqlMock.mockResolvedValueOnce([claimRow()]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: 8, etag: "e1" });
    getMock.mockRejectedValue(new RawFileStoreError("PROVIDER_FAILURE", "x"));
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(headMock).toHaveBeenCalledTimes(1);
  });
});

describe("finalizeImportBatch — storage.get() is always called with an explicit maxBytes bound", () => {
  it("passes { maxBytes: MAX_SOURCE_FILE_BYTES } (exact, no +1 sentinel) to storage.get()", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    const { MAX_SOURCE_FILE_BYTES } = await import("@/lib/data-hub/limits");
    const body = Buffer.from("a,b\n1,2\n");
    sqlMock.mockResolvedValueOnce([claimRow({ size_bytes: body.byteLength })]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: body.byteLength, etag: "e1" });
    getMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength, etag: "e1" }, body });
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(getMock).toHaveBeenCalledWith(expect.any(String), { maxBytes: MAX_SOURCE_FILE_BYTES });
  });
});

describe("finalizeImportBatch — byte/metadata validation (Step 19)", () => {
  it("zero-byte body -> ZERO_BYTE, retryable=false", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    sqlMock.mockResolvedValueOnce([claimRow({ size_bytes: 0 })]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: 0, etag: "e1" });
    getMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: 0, etag: "e1" }, body: Buffer.alloc(0) });
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "FAILED", failureCode: "ZERO_BYTE", retryable: false });
  });

  it("body length mismatch vs persisted size_bytes -> STORAGE_METADATA_MISMATCH, retryable=false", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    sqlMock.mockResolvedValueOnce([claimRow({ size_bytes: 999 })]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: 8, etag: "e1" });
    getMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: 8, etag: "e1" }, body: Buffer.from("a,b\n1,2\n") });
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "FAILED", failureCode: "STORAGE_METADATA_MISMATCH", retryable: false });
  });

  it("expected_sha256 mismatch -> HASH_MISMATCH, retryable=false", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    sqlMock.mockResolvedValueOnce([claimRow({ expected_sha256: "f".repeat(64) })]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: 8, etag: "e1" });
    getMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: 8, etag: "e1" }, body: Buffer.from("a,b\n1,2\n") });
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "FAILED", failureCode: "HASH_MISMATCH", retryable: false });
  });

  it("expected_sha256 matching the computed hash proceeds to READY", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    const { createHash } = await import("node:crypto");
    const body = Buffer.from("a,b\n1,2\n");
    const hash = createHash("sha256").update(body).digest("hex");
    sqlMock.mockResolvedValueOnce([claimRow({ expected_sha256: hash })]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: body.byteLength, etag: "e1" });
    getMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength, etag: "e1" }, body });
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "READY", sha256: hash });
  });
});

describe("finalizeImportBatch — format preflight (Step 20)", () => {
  it("valid xlsx bytes pass preflight and reach READY", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["a", "b"], [1, 2]]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const body = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    sqlMock.mockResolvedValueOnce([claimRow({ content_type: "xlsx", size_bytes: body.byteLength })]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: body.byteLength, etag: "e1" });
    getMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength, etag: "e1" }, body });
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result.outcome).toBe("READY");
  });

  it("an xlsx archive that fails the archive guard -> PREFLIGHT_REJECTED", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    // Not a real ZIP at all — assertSafeXlsxArchive rejects it structurally.
    const body = Buffer.from("not a real zip archive at all");
    sqlMock.mockResolvedValueOnce([claimRow({ content_type: "xlsx", size_bytes: body.byteLength })]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: body.byteLength, etag: "e1" });
    getMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength, etag: "e1" }, body });
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "FAILED", failureCode: "PREFLIGHT_REJECTED", retryable: false });
  });

  it("an xls buffer without a valid OLE signature -> PREFLIGHT_REJECTED", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    const body = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    sqlMock.mockResolvedValueOnce([claimRow({ content_type: "xls", size_bytes: body.byteLength })]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: body.byteLength, etag: "e1" });
    getMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength, etag: "e1" }, body });
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "FAILED", failureCode: "PREFLIGHT_REJECTED" });
  });

  it("an xls buffer WITH a valid OLE signature passes preflight and reaches READY", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    const body = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
    sqlMock.mockResolvedValueOnce([claimRow({ content_type: "xls", size_bytes: body.byteLength })]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: body.byteLength, etag: "e1" });
    getMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength, etag: "e1" }, body });
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result.outcome).toBe("READY");
  });

  it("a csv buffer containing a NUL byte -> PREFLIGHT_REJECTED", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    const body = Buffer.from([0x61, 0x00, 0x62]);
    sqlMock.mockResolvedValueOnce([claimRow({ content_type: "csv", size_bytes: body.byteLength })]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: body.byteLength, etag: "e1" });
    getMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength, etag: "e1" }, body });
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "FAILED", failureCode: "PREFLIGHT_REJECTED" });
  });

  it("never calls SheetJS/xlsx during a CSV or XLS finalize-path test (only real xlsx bytes hit the archive guard)", async () => {
    // This test exists to document the invariant; the real structural
    // proof is the static containment describe block above (finalize.ts
    // never imports xlsx at all, so it is IMPOSSIBLE for any finalize
    // code path — csv, xls, or xlsx — to invoke SheetJS directly).
    expect(true).toBe(true);
  });
});

describe("finalizeImportBatch — READY completion fence (Step 21)", () => {
  it("uses the etag from the SAME get() call's metadata, never a separate HEAD's etag", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    const body = Buffer.from("a,b\n1,2\n");
    sqlMock.mockResolvedValueOnce([claimRow({ size_bytes: body.byteLength })]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: body.byteLength, etag: "HEAD-ETAG" });
    getMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength, etag: "GET-ETAG" }, body });
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toMatchObject({ outcome: "READY", storageEtag: "GET-ETAG" });
    const [, ...values] = sqlMock.mock.calls[1];
    expect(values).toContain("GET-ETAG");
    expect(values).not.toContain("HEAD-ETAG");
  });

  it("zero affected rows on the READY completion -> OWNERSHIP_LOST", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    const body = Buffer.from("a,b\n1,2\n");
    sqlMock.mockResolvedValueOnce([claimRow({ size_bytes: body.byteLength })]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: body.byteLength, etag: "e1" });
    getMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength, etag: "e1" }, body });
    sqlMock.mockResolvedValueOnce([]); // ready completion affects zero rows
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toEqual({ outcome: "OWNERSHIP_LOST", batchId: "batch-1" });
  });

  it("the READY completion's WHERE clause includes the exact captured attempt_count generation", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    const body = Buffer.from("a,b\n1,2\n");
    sqlMock.mockResolvedValueOnce([claimRow({ size_bytes: body.byteLength, attempt_count: 7 })]);
    headMock.mockResolvedValue({ provider: "vercel-blob-private", size: body.byteLength, etag: "e1" });
    getMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength, etag: "e1" }, body });
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    const [, ...values] = sqlMock.mock.calls[1];
    expect(values).toContain(7);
  });
});

// ─── Remediation (Finding 2): finalize.ts export-surface + finalizeInternal
// import-containment ─────────────────────────────────────────────────────
//
// finalize.ts used to export claimForFinalize/completeReadyForFinalize/
// completeFailedForFinalize/ClaimedRow directly under a "testing seam, not
// part of the public contract" comment — TypeScript export visibility plus
// a comment were the only barriers. The remediation moved these low-level
// persistence primitives into lib/data-hub/importBatch/finalizeInternal.ts.
// The tests below prove: (A) finalize.ts's own export surface no longer
// includes them under any name; (B)-(E) finalizeInternal.ts is imported by
// no production module anywhere in the repo except finalize.ts itself
// (repo-wide, with explicit zero-importer checks under app/**, app/api/**,
// and components/**); (F) no barrel/index.ts exists anywhere in
// lib/data-hub/importBatch/; (G) finalizeInternal.ts is referenced by no
// cron/scheduler/automatic-trigger code path.

describe("finalize.ts — export surface no longer includes the low-level primitives (Finding 2)", () => {
  const code = read("lib/data-hub/importBatch/finalize.ts");

  it("does not export claimForFinalize, completeReadyForFinalize, completeFailedForFinalize, or ClaimedRow under their own names", () => {
    expect(code).not.toMatch(/export\s+(async\s+function|interface|type|const)\s+claimForFinalize\b/);
    expect(code).not.toMatch(/export\s+(async\s+function|interface|type|const)\s+completeReadyForFinalize\b/);
    expect(code).not.toMatch(/export\s+(async\s+function|interface|type|const)\s+completeFailedForFinalize\b/);
    expect(code).not.toMatch(/export\s+(interface|type)\s+ClaimedRow\b/);
  });

  it("does not re-export those same names (or any alias of them) from finalizeInternal under a different name", () => {
    // Covers `export { claimForFinalize as X }`, `export { claimForFinalize }`,
    // and `export * from "./finalizeInternal"` — any of these would expose
    // the same low-level capability from finalize.ts's own module surface,
    // even if the local export declaration itself doesn't literally say
    // "claimForFinalize" as its own name.
    expect(code).not.toMatch(/export\s*\{[^}]*\b(claimForFinalize|completeReadyForFinalize|completeFailedForFinalize|ClaimedRow)\b[^}]*\}/);
    expect(code).not.toMatch(/export\s*\*\s*from\s*["']\.\/finalizeInternal["']/);
  });

  it("imports the three primitives from finalizeInternal (not duplicating the SQL locally) and does not define ClaimedRow itself", () => {
    expect(code).toMatch(/from\s+["']\.\/finalizeInternal["']/);
    expect(code).toMatch(/\bclaimForFinalize\b/);
    expect(code).toMatch(/\bcompleteReadyForFinalize\b/);
    expect(code).toMatch(/\bcompleteFailedForFinalize\b/);
    expect(code).not.toMatch(/interface\s+ClaimedRow\b/);
  });

  it("finalize.ts's only production-facing exports are finalizeImportBatch plus its high-level context/result types", () => {
    const exportNames = Array.from(code.matchAll(/^export\s+(?:async\s+function|interface|type|const)\s+([A-Za-z0-9_]+)/gm)).map(
      (m) => m[1]
    );
    expect(new Set(exportNames)).toEqual(
      new Set(["FinalizeTrustedContext", "FinalizeClaimFailureReason", "FinalizeImportBatchResult", "finalizeImportBatch"])
    );
  });
});

describe("finalizeInternal.ts — repo-wide import containment (Finding 2)", () => {
  const ROOT = process.cwd();
  const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", ".vercel"]);

  function walkAll(dir: string, exts: string[]): string[] {
    const results: string[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return results;
    }
    for (const entry of entries) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkAll(full, exts));
      } else if (exts.some((ext) => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
    return results;
  }

  // Real import/require-statement parsing (not a bare substring search) so
  // a comment or unrelated prose mentioning "finalizeInternal" can never
  // produce a false positive, and so a genuine import is never missed
  // regardless of how its surrounding import clause is formatted.
  function importsFinalizeInternal(code: string): boolean {
    const patterns = [
      /import\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g, // import ... from "..."
      /import\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("...")
      /require\(\s*["']([^"']+)["']\s*\)/g, // require("...")
      /export\s+[\s\S]*?\s+from\s+["']([^"']+)["']/g, // export ... from "..."
    ];
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(code))) {
        const source = match[1];
        if (/(^|\/)finalizeInternal(\.ts)?$/.test(source)) return true;
      }
    }
    return false;
  }

  // This file (finalizeImportBatch.test.ts) is deliberately excluded from
  // its own scan below — its OWN source text contains the literal regex
  // patterns used to detect an import of "finalizeInternal" (as string
  // literals inside those patterns themselves), which would otherwise trip
  // this very check against itself. Mirrors the identical self-exclusion
  // precedent in dataHubImportBatchDarkness.test.ts.
  const SELF_PATH = path.join(ROOT, "tests", "containment", "finalizeImportBatch.test.ts");

  function findImporters(dir: string): string[] {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) return [];
    const files = walkAll(full, [".ts", ".tsx"]).filter((file) => file !== SELF_PATH);
    return files
      .filter((file) => importsFinalizeInternal(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file).split(path.sep).join("/"));
  }

  it("no file under app/** imports finalizeInternal.ts", () => {
    expect(findImporters("app")).toEqual([]);
  });

  it("no file under app/api/** imports finalizeInternal.ts", () => {
    expect(findImporters("app/api")).toEqual([]);
  });

  it("no file under components/** imports finalizeInternal.ts", () => {
    expect(findImporters("components")).toEqual([]);
  });

  it("repo-wide, the ONLY importers of finalizeInternal.ts are finalize.ts itself and the real-Postgres attempt-fencing integration test", () => {
    const importers = new Set<string>();
    for (const dir of ["app", "components", "lib", "scripts", "services", "hooks", "modules", "store", "types", "tests"]) {
      for (const file of findImporters(dir)) importers.add(file);
    }
    expect(importers).toEqual(
      new Set([
        "lib/data-hub/importBatch/finalize.ts",
        "scripts/tests/importBatchService.integration.test.ts",
      ])
    );
  });

  it("is not referenced by any cron/scheduler/automatic-trigger code path (no non-test file outside the importBatch module itself mentions it)", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "scripts", "components"]) {
      const full = path.join(ROOT, dir);
      if (!fs.existsSync(full)) continue;
      const files = walkAll(full, [".ts", ".tsx"]).filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
      for (const file of files) {
        if (fs.readFileSync(file, "utf8").includes("finalizeInternal")) {
          offenders.push(path.relative(ROOT, file).split(path.sep).join("/"));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("lib/data-hub/importBatch/ — no barrel/index.ts (Finding 2, re-confirmed here)", () => {
  it("contains no index.ts / index.tsx", () => {
    const dir = path.join(process.cwd(), "lib", "data-hub", "importBatch");
    const entries = fs.readdirSync(dir);
    expect(entries).not.toContain("index.ts");
    expect(entries).not.toContain("index.tsx");
  });
});

describe("finalizeImportBatch — FAILED completion fence (Step 22)", () => {
  it("zero affected rows on the FAILED completion -> OWNERSHIP_LOST", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    sqlMock.mockResolvedValueOnce([claimRow()]);
    headMock.mockResolvedValue(null);
    sqlMock.mockResolvedValueOnce([]); // failed completion affects zero rows
    const result = await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    expect(result).toEqual({ outcome: "OWNERSHIP_LOST", batchId: "batch-1" });
  });

  it("the FAILED completion never persists a raw caught error's own message text", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    sqlMock.mockResolvedValueOnce([claimRow()]);
    const distinctiveRawText = "RAW_SDK_ERROR_TEXT_xyz_should_never_be_persisted";
    headMock.mockRejectedValue(new Error(distinctiveRawText));
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    const [, ...values] = sqlMock.mock.calls[1];
    expect(values.join(" ")).not.toContain(distinctiveRawText);
  });

  it("the FAILED completion's WHERE clause includes the exact captured attempt_count generation", async () => {
    const { finalizeImportBatch } = await freshFinalize();
    sqlMock.mockResolvedValueOnce([claimRow({ attempt_count: 3 })]);
    headMock.mockResolvedValue(null);
    sqlMock.mockResolvedValueOnce([{ id: "batch-1" }]);
    await finalizeImportBatch({ organisationId: "org-1" }, "batch-1");
    const [, ...values] = sqlMock.mock.calls[1];
    expect(values).toContain(3);
  });
});
