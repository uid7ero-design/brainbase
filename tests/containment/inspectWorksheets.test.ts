import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SERVICE_PATH = "lib/data-hub/importBatch/inspectWorksheets.ts";

// ─── Static darkness / import-discipline containment (Steps 20-21) ─────

describe("inspectWorksheets — static darkness/discipline containment", () => {
  const code = read(SERVICE_PATH);
  const stripped = stripComments(code);

  it("never imports xlsx directly", () => {
    expect(stripped).not.toMatch(/from\s+["']xlsx["']/);
    expect(stripped).not.toMatch(/require\(["']xlsx["']\)/);
  });

  it("only reaches SheetJS via inspectWorkbook, imported from workbookParser", () => {
    expect(stripped).toMatch(/from\s+["']\.\.\/workbookParser["']/);
    expect(stripped).toMatch(/\binspectWorkbook\b/);
    expect(stripped).not.toMatch(/\bdecodeWorksheet\(/);
    expect(stripped).not.toMatch(/XLSX\.read/);
  });

  it("never imports NextRequest/NextResponse or lib/org's session helpers", () => {
    expect(stripped).not.toMatch(/next\/server/);
    expect(stripped).not.toMatch(/requireSession|requireRole/);
    expect(stripped).not.toMatch(/from\s+["'].*lib\/org["']/);
  });

  it("never imports the legacy upload pipeline (services/upload.ts, app/api/upload/**, app/api/files/**)", () => {
    expect(stripped).not.toMatch(/services\/upload/);
    expect(stripped).not.toMatch(/api\/upload/);
    expect(stripped).not.toMatch(/api\/files/);
  });

  it("carries an AUTH BOUNDARY header comment", () => {
    expect(code).toMatch(/AUTH BOUNDARY/);
  });
});

describe("lib/data-hub/importBatch/ — no barrel/index.ts (re-confirmed here, Step 20)", () => {
  it("contains no index.ts / index.tsx", () => {
    const dir = path.join(process.cwd(), "lib", "data-hub", "importBatch");
    const entries = fs.readdirSync(dir);
    expect(entries).not.toContain("index.ts");
    expect(entries).not.toContain("index.tsx");
  });
});

describe("inspectWorksheets — repo-wide, no runtime caller exists yet (Step 20, self-contained re-check)", () => {
  const ROOT = process.cwd();
  function walk(dir: string, exts: string[]): string[] {
    const results: string[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return results;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...walk(full, exts));
      else if (exts.some((ext) => entry.name.endsWith(ext))) results.push(full);
    }
    return results;
  }
  it("no file under app/**, app/api/**, or components/** imports inspectWorksheets.ts", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components"]) {
      const full = path.join(ROOT, dir);
      if (!fs.existsSync(full)) continue;
      for (const file of walk(full, [".ts", ".tsx"])) {
        if (/from\s+["'][^"']*inspectWorksheets[^"']*["']/.test(fs.readFileSync(file, "utf8"))) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ─── Fixture builders ───────────────────────────────────────────────────

function csvBytes(content: string): Buffer {
  return Buffer.from(content, "utf8");
}

interface SheetSpec {
  name: string;
  rows: unknown[][];
  hidden?: 0 | 1 | 2;
}

function xlsxBytes(sheets: SheetSpec[]): Buffer {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Sheets: [] };
  sheets.forEach((spec, index) => {
    const ws = XLSX.utils.aoa_to_sheet(spec.rows);
    XLSX.utils.book_append_sheet(wb, ws, spec.name);
    wb.Workbook!.Sheets![index] = { Hidden: spec.hidden ?? 0 };
  });
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ─── Mocks ──────────────────────────────────────────────────────────────

const importBatchFindUniqueMock = vi.fn();
const importBatchUpdateMock = vi.fn();
const importBatchUpdateManyMock = vi.fn();
const uploadFindManyMock = vi.fn();
const uploadCreateManyMock = vi.fn();
const uploadUpdateMock = vi.fn();
const uploadUpdateManyMock = vi.fn();
const uploadDeleteMock = vi.fn();
const uploadDeleteManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    importBatch: {
      findUnique: (...args: unknown[]) => importBatchFindUniqueMock(...args),
      update: (...args: unknown[]) => importBatchUpdateMock(...args),
      updateMany: (...args: unknown[]) => importBatchUpdateManyMock(...args),
    },
    upload: {
      findMany: (...args: unknown[]) => uploadFindManyMock(...args),
      createMany: (...args: unknown[]) => uploadCreateManyMock(...args),
      update: (...args: unknown[]) => uploadUpdateMock(...args),
      updateMany: (...args: unknown[]) => uploadUpdateManyMock(...args),
      delete: (...args: unknown[]) => uploadDeleteMock(...args),
      deleteMany: (...args: unknown[]) => uploadDeleteManyMock(...args),
    },
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

// NOTE: deliberately does NOT reset any mock — only the module registry.
// Several tests set up mock return values in a describe-level beforeEach
// BEFORE calling freshService() inside the test body; resetting mocks here
// would silently wipe those out. The top-level beforeEach below is the
// single place responsible for resetting every mock before each test runs.
async function freshService() {
  vi.resetModules();
  return import("@/lib/data-hub/importBatch/inspectWorksheets");
}

function readyBatchRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: "READY",
    original_filename: "data.csv",
    content_type: "csv",
    sha256: null as string | null,
    ...overrides,
  };
}

beforeEach(() => {
  importBatchFindUniqueMock.mockReset();
  importBatchUpdateMock.mockReset();
  importBatchUpdateManyMock.mockReset();
  uploadFindManyMock.mockReset();
  uploadCreateManyMock.mockReset();
  uploadUpdateMock.mockReset();
  uploadUpdateManyMock.mockReset();
  uploadDeleteMock.mockReset();
  uploadDeleteManyMock.mockReset();
  storageGetMock.mockReset();
});

// ─── Tenant isolation (Step 6 / M — BATCH_NOT_FOUND / BATCH_NOT_READY) ──

describe("inspectWorksheets — tenant-scoped batch lookup", () => {
  it("genuinely nonexistent batch -> BATCH_NOT_FOUND", async () => {
    const { inspectWorksheets } = await freshService();
    importBatchFindUniqueMock.mockResolvedValue(null);
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
  });

  it("wrong-organisation batch -> the SAME BATCH_NOT_FOUND shape (findUnique's compound key excludes it, mock returns null)", async () => {
    const { inspectWorksheets } = await freshService();
    importBatchFindUniqueMock.mockResolvedValue(null);
    const result = await inspectWorksheets({ organisationId: "org-attacker", importBatchId: "batch-1" });
    expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
    // Both branches produce byte-identical result shapes — no TENANT_MISMATCH code exists anywhere.
    expect((result as { code: string }).code).not.toBe("TENANT_MISMATCH");
  });

  it("looks up via the compound (id, organisation_id) unique key in a single predicate", async () => {
    const { inspectWorksheets } = await freshService();
    importBatchFindUniqueMock.mockResolvedValue(null);
    await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(importBatchFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_organisation_id: { id: "batch-1", organisation_id: "org-1" } },
      })
    );
  });

  it.each(["AWAITING_UPLOAD", "PROCESSING", "FAILED", "DELETION_PENDING"])(
    "status=%s -> BATCH_NOT_READY",
    async (status) => {
      const { inspectWorksheets } = await freshService();
      importBatchFindUniqueMock.mockResolvedValue(readyBatchRow({ status }));
      const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
      expect(result).toMatchObject({ ok: false, code: "BATCH_NOT_READY" });
      expect(storageGetMock).not.toHaveBeenCalled();
    }
  );

  it("READY batch with an impossible NULL sha256 -> PROVIDER_FAILURE (defensive, never crashes)", async () => {
    const { inspectWorksheets } = await freshService();
    importBatchFindUniqueMock.mockResolvedValue(readyBatchRow({ sha256: null }));
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result).toMatchObject({ ok: false, code: "PROVIDER_FAILURE" });
  });
});

// ─── Storage retrieval (Step 7) ─────────────────────────────────────────

describe("inspectWorksheets — storage failure classification", () => {
  it("storage NOT_FOUND -> STORAGE_NOT_FOUND", async () => {
    const { inspectWorksheets } = await freshService();
    const { RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");
    importBatchFindUniqueMock.mockResolvedValue(readyBatchRow({ sha256: "a".repeat(64) }));
    storageGetMock.mockRejectedValue(new RawFileStoreError("NOT_FOUND", "gone"));
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result).toMatchObject({ ok: false, code: "STORAGE_NOT_FOUND" });
  });

  it("every other RawFileStoreErrorCode collapses to PROVIDER_FAILURE", async () => {
    const { inspectWorksheets } = await freshService();
    const { RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");
    importBatchFindUniqueMock.mockResolvedValue(readyBatchRow({ sha256: "a".repeat(64) }));
    storageGetMock.mockRejectedValue(new RawFileStoreError("SIZE_LIMIT", "too big"));
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result).toMatchObject({ ok: false, code: "PROVIDER_FAILURE" });
  });

  it("passes { maxBytes: MAX_SOURCE_FILE_BYTES } to storage.get()", async () => {
    const { inspectWorksheets } = await freshService();
    const { MAX_SOURCE_FILE_BYTES } = await import("@/lib/data-hub/limits");
    const body = csvBytes("a,b\n1,2\n");
    importBatchFindUniqueMock.mockResolvedValue(readyBatchRow({ sha256: sha256Of(body) }));
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: 1 });
    await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(storageGetMock).toHaveBeenCalledWith(expect.any(String), { maxBytes: MAX_SOURCE_FILE_BYTES });
  });
});

// ─── Mandatory SHA-256 re-verification (Step 8) ─────────────────────────

describe("inspectWorksheets — mandatory SHA-256 re-verification", () => {
  it("computed hash matches batch.sha256 -> proceeds", async () => {
    const { inspectWorksheets } = await freshService();
    const body = csvBytes("a,b\n1,2\n");
    importBatchFindUniqueMock.mockResolvedValue(readyBatchRow({ sha256: sha256Of(body) }));
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: 1 });
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result.ok).toBe(true);
  });

  it("computed hash mismatch vs batch.sha256 -> STORAGE_INTEGRITY_MISMATCH, never expected_sha256", async () => {
    const { inspectWorksheets } = await freshService();
    const body = csvBytes("a,b\n1,2\n");
    importBatchFindUniqueMock.mockResolvedValue(readyBatchRow({ sha256: "f".repeat(64) }));
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
    expect(uploadFindManyMock).not.toHaveBeenCalled();
    expect(uploadCreateManyMock).not.toHaveBeenCalled();
  });
});

// ─── Parser rejection -> zero writes (Step 18) ──────────────────────────

describe("inspectWorksheets — parser rejection never writes any row", () => {
  it("an xlsx-named file with an invalid signature -> PARSER_REJECTED, zero Upload writes", async () => {
    const { inspectWorksheets } = await freshService();
    const body = Buffer.from("not a real zip archive at all");
    importBatchFindUniqueMock.mockResolvedValue(
      readyBatchRow({ content_type: "xlsx", original_filename: "data.xlsx", sha256: sha256Of(body) })
    );
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result).toMatchObject({ ok: false, code: "PARSER_REJECTED" });
    expect(uploadFindManyMock).not.toHaveBeenCalled();
    expect(uploadCreateManyMock).not.toHaveBeenCalled();
  });

  it("never leaks the raw WorkbookParserError code/message text into the returned message", async () => {
    const { inspectWorksheets } = await freshService();
    const body = Buffer.from("not a real zip archive at all");
    importBatchFindUniqueMock.mockResolvedValue(
      readyBatchRow({ content_type: "xlsx", original_filename: "data.xlsx", sha256: sha256Of(body) })
    );
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect((result as { message: string }).message).not.toMatch(/MALFORMED_WORKBOOK|INVALID_FILE_SIGNATURE/);
  });
});

// ─── Real structural inspection: CSV / XLSX / XLS, status matrix ───────

describe("inspectWorksheets — real structural inspection", () => {
  it("CSV -> exactly one AWAITING_CONFIRMATION worksheet at index 0", async () => {
    const { inspectWorksheets } = await freshService();
    const body = csvBytes("a,b\n1,2\n3,4\n");
    importBatchFindUniqueMock.mockResolvedValue(
      readyBatchRow({ content_type: "csv", original_filename: "data.csv", sha256: sha256Of(body) })
    );
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: 1 });
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
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
  });

  it("multi-worksheet XLSX -> visible/hidden/veryHidden/empty status matrix", async () => {
    const { inspectWorksheets } = await freshService();
    const body = xlsxBytes([
      { name: "Visible", rows: [["a", "b"], [1, 2]], hidden: 0 },
      { name: "Hidden", rows: [["a"], [1]], hidden: 1 },
      { name: "VeryHidden", rows: [["a"], [1]], hidden: 2 },
      { name: "EmptyVisible", rows: [], hidden: 0 },
    ]);
    importBatchFindUniqueMock.mockResolvedValue(
      readyBatchRow({ content_type: "xlsx", original_filename: "data.xlsx", sha256: sha256Of(body) })
    );
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: 4 });
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    const worksheets = result.worksheets as unknown as Array<Record<string, unknown>>;
    expect(worksheets.map((w) => [w.worksheetIndex, w.worksheetVisibility, w.worksheetIsEmpty, w.canonicalStatus])).toEqual([
      [0, "visible", false, "AWAITING_CONFIRMATION"],
      [1, "hidden", false, "INELIGIBLE"],
      [2, "veryHidden", false, "INELIGIBLE"],
      [3, "visible", true, "INELIGIBLE"],
    ]);
  });

  it("multi-worksheet legacy XLS (biff8) -> real structural inspection succeeds", async () => {
    const { inspectWorksheets } = await freshService();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a"], [1]]), "One");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["b"], [2]]), "Two");
    const body = XLSX.write(wb, { type: "buffer", bookType: "biff8" }) as Buffer;
    importBatchFindUniqueMock.mockResolvedValue(
      readyBatchRow({ content_type: "xls", original_filename: "data.xls", sha256: sha256Of(body) })
    );
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: 2 });
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result.ok).toBe(true);
    expect((result as { worksheets: unknown[] }).worksheets).toHaveLength(2);
  });

  it("deterministic worksheet indexes across repeated calls against the same bytes", async () => {
    const body = xlsxBytes([
      { name: "A", rows: [["x"], [1]] },
      { name: "B", rows: [["y"], [2]] },
    ]);
    const runOnce = async () => {
      const { inspectWorksheets } = await freshService();
      importBatchFindUniqueMock.mockResolvedValue(
        readyBatchRow({ content_type: "xlsx", original_filename: "data.xlsx", sha256: sha256Of(body) })
      );
      storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
      uploadFindManyMock.mockResolvedValue([]);
      uploadCreateManyMock.mockResolvedValue({ count: 2 });
      return inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    };
    const first = await runOnce();
    const second = await runOnce();
    expect(first).toEqual(second);
  });
});

// ─── First-time persistence (Case A / Step 15) ─────────────────────────

describe("inspectWorksheets — first-time persistence", () => {
  it("persists structural-only fields; no preview/header/cell content anywhere in the createMany payload", async () => {
    const { inspectWorksheets } = await freshService();
    const body = csvBytes("a,b\n1,2\n");
    importBatchFindUniqueMock.mockResolvedValue(
      readyBatchRow({ content_type: "csv", original_filename: "data.csv", sha256: sha256Of(body) })
    );
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: 1 });
    await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });

    expect(uploadCreateManyMock).toHaveBeenCalledTimes(1);
    const payload = uploadCreateManyMock.mock.calls[0][0] as { data: Array<Record<string, unknown>> };
    expect(payload.data).toHaveLength(1);
    const row = payload.data[0];
    expect(row).toMatchObject({
      organisation_id: "org-1",
      import_batch_id: "batch-1",
      worksheet_index: 0,
      worksheet_name: "CSV",
      worksheet_visibility: "visible",
      worksheet_is_empty: false,
      lineage_kind: "DATA_HUB",
      canonical_status: "AWAITING_CONFIRMATION",
      size_bytes: 0,
    });
    // No preview/header/cell/row-count fields anywhere in the payload.
    for (const forbidden of [
      "preview_rows",
      "columns_detected",
      "field_mappings",
      "validation_errors",
      "row_count",
      "column_count",
    ]) {
      expect(row).not.toHaveProperty(forbidden);
    }
    // Upload's own attempt/failure metadata columns are left at schema
    // defaults (Step 18) — never explicitly set by this service.
    for (const attemptField of [
      "attempt_count",
      "last_attempt_at",
      "last_failure_code",
      "last_failure_message",
      "last_failure_retryable",
    ]) {
      expect(row).not.toHaveProperty(attemptField);
    }
  });

  it("stored_path is the non-operable sentinel, never the real ImportBatch storage key", async () => {
    const { inspectWorksheets } = await freshService();
    const { buildImportBatchKey } = await import("@/lib/data-hub/storage/rawFileStore");
    const body = csvBytes("a,b\n1,2\n");
    importBatchFindUniqueMock.mockResolvedValue(
      readyBatchRow({ content_type: "csv", original_filename: "data.csv", sha256: sha256Of(body) })
    );
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: 1 });
    await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    const payload = uploadCreateManyMock.mock.calls[0][0] as { data: Array<Record<string, unknown>> };
    const storedPath = payload.data[0].stored_path as string;
    expect(storedPath).not.toBe(buildImportBatchKey("org-1", "batch-1"));
    expect(storedPath).toMatch(/^datahub-worksheet:/);
  });

  it("size_bytes is exactly 0, never the physical ImportBatch size", async () => {
    const { inspectWorksheets } = await freshService();
    const body = csvBytes("a,b\n1,2\n3,4\n5,6\n");
    importBatchFindUniqueMock.mockResolvedValue(
      readyBatchRow({ content_type: "csv", original_filename: "data.csv", sha256: sha256Of(body) })
    );
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: 1 });
    await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    const payload = uploadCreateManyMock.mock.calls[0][0] as { data: Array<Record<string, unknown>> };
    expect(payload.data[0].size_bytes).toBe(0);
    expect(payload.data[0].size_bytes).not.toBe(body.byteLength);
  });

  it("mimetype is derived from the physical content_type via a fixed map", async () => {
    const { inspectWorksheets } = await freshService();
    const body = xlsxBytes([{ name: "One", rows: [["a"], [1]] }]);
    importBatchFindUniqueMock.mockResolvedValue(
      readyBatchRow({ content_type: "xlsx", original_filename: "data.xlsx", sha256: sha256Of(body) })
    );
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: 1 });
    await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    const payload = uploadCreateManyMock.mock.calls[0][0] as { data: Array<Record<string, unknown>> };
    expect(payload.data[0].mimetype).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  it("createMany is called WITHOUT skipDuplicates", async () => {
    const { inspectWorksheets } = await freshService();
    const body = csvBytes("a,b\n1,2\n");
    importBatchFindUniqueMock.mockResolvedValue(
      readyBatchRow({ content_type: "csv", original_filename: "data.csv", sha256: sha256Of(body) })
    );
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: 1 });
    await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    const payload = uploadCreateManyMock.mock.calls[0][0] as { skipDuplicates?: boolean };
    expect(payload.skipDuplicates).not.toBe(true);
  });
});

// ─── Existing-set policy: Cases B/C/D/E (Step 14) ──────────────────────

function existingRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organisation_id: "org-1",
    import_batch_id: "batch-1",
    worksheet_index: 0,
    worksheet_name: "CSV",
    worksheet_visibility: "visible",
    worksheet_is_empty: false,
    lineage_kind: "DATA_HUB",
    canonical_status: "AWAITING_CONFIRMATION",
    ...overrides,
  };
}

describe("inspectWorksheets — existing persisted set policy", () => {
  const body = csvBytes("a,b\n1,2\n");

  beforeEach(() => {
    importBatchFindUniqueMock.mockResolvedValue(
      readyBatchRow({ content_type: "csv", original_filename: "data.csv", sha256: sha256Of(body) })
    );
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
  });

  it("Case B — exact match -> idempotent success, zero writes", async () => {
    const { inspectWorksheets } = await freshService();
    uploadFindManyMock.mockResolvedValue([existingRow()]);
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result.ok).toBe(true);
    expect(uploadCreateManyMock).not.toHaveBeenCalled();
    expect(uploadUpdateMock).not.toHaveBeenCalled();
    expect(uploadUpdateManyMock).not.toHaveBeenCalled();
    expect(uploadDeleteMock).not.toHaveBeenCalled();
    expect(uploadDeleteManyMock).not.toHaveBeenCalled();
  });

  it("Case C — partial existing set (fewer rows than expected) -> PERSISTENCE_CONFLICT, never topped up", async () => {
    const { inspectWorksheets } = await freshService();
    const twoSheetBody = xlsxBytes([
      { name: "One", rows: [["a"], [1]] },
      { name: "Two", rows: [["b"], [2]] },
    ]);
    importBatchFindUniqueMock.mockResolvedValue(
      readyBatchRow({ content_type: "xlsx", original_filename: "data.xlsx", sha256: sha256Of(twoSheetBody) })
    );
    storageGetMock.mockResolvedValue({
      metadata: { provider: "vercel-blob-private", size: twoSheetBody.byteLength },
      body: twoSheetBody,
    });
    uploadFindManyMock.mockResolvedValue([existingRow({ worksheet_index: 0, worksheet_name: "One" })]);
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result).toMatchObject({ ok: false, code: "PERSISTENCE_CONFLICT" });
    expect(uploadCreateManyMock).not.toHaveBeenCalled();
    expect(uploadUpdateManyMock).not.toHaveBeenCalled();
  });

  it("Case D — extra existing row beyond the fresh set -> PERSISTENCE_CONFLICT, never truncated", async () => {
    const { inspectWorksheets } = await freshService();
    uploadFindManyMock.mockResolvedValue([existingRow(), existingRow({ worksheet_index: 1, worksheet_name: "Extra" })]);
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result).toMatchObject({ ok: false, code: "PERSISTENCE_CONFLICT" });
    expect(uploadDeleteMock).not.toHaveBeenCalled();
    expect(uploadDeleteManyMock).not.toHaveBeenCalled();
  });

  it("Case E — same index, divergent metadata -> PERSISTENCE_CONFLICT, never overwritten", async () => {
    const { inspectWorksheets } = await freshService();
    uploadFindManyMock.mockResolvedValue([existingRow({ canonical_status: "INELIGIBLE" })]);
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result).toMatchObject({ ok: false, code: "PERSISTENCE_CONFLICT" });
    expect(uploadUpdateMock).not.toHaveBeenCalled();
    expect(uploadUpdateManyMock).not.toHaveBeenCalled();
  });
});

// ─── Unique-index race (Step 15) ────────────────────────────────────────

describe("inspectWorksheets — createMany P2002 race resolution", () => {
  const body = csvBytes("a,b\n1,2\n");

  beforeEach(() => {
    importBatchFindUniqueMock.mockResolvedValue(
      readyBatchRow({ content_type: "csv", original_filename: "data.csv", sha256: sha256Of(body) })
    );
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
  });

  async function triggerP2002() {
    const { Prisma } = await import("@prisma/client");
    return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.22.0",
    });
  }

  it("a racing caller persisted the identical set -> idempotent success, never a raw Prisma error escaping", async () => {
    const { inspectWorksheets } = await freshService();
    uploadFindManyMock.mockResolvedValueOnce([]); // Step 14 pre-check: zero existing
    uploadCreateManyMock.mockRejectedValue(await triggerP2002());
    uploadFindManyMock.mockResolvedValueOnce([existingRow()]); // re-read after P2002
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result.ok).toBe(true);
  });

  it("a racing caller persisted divergent data -> PERSISTENCE_CONFLICT, never a raw Prisma error escaping", async () => {
    const { inspectWorksheets } = await freshService();
    uploadFindManyMock.mockResolvedValueOnce([]);
    uploadCreateManyMock.mockRejectedValue(await triggerP2002());
    uploadFindManyMock.mockResolvedValueOnce([existingRow({ canonical_status: "INELIGIBLE" })]);
    const result = await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(result).toMatchObject({ ok: false, code: "PERSISTENCE_CONFLICT" });
  });

  it("a non-P2002 createMany failure propagates as a sanitized error, never the raw message text", async () => {
    const { inspectWorksheets } = await freshService();
    const distinctiveRawText = "RAW_SDK_ERROR_TEXT_xyz_should_never_be_persisted";
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockRejectedValue(new Error(distinctiveRawText));
    let caught: unknown;
    try {
      await inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/unexpected failure/i);
    expect((caught as Error).message).not.toContain(distinctiveRawText);
  });
});

// ─── ImportBatch immutability (Step 18) ─────────────────────────────────

describe("inspectWorksheets — ImportBatch immutability", () => {
  it("never calls prisma.importBatch.update/updateMany on any success or failure path", async () => {
    const body = csvBytes("a,b\n1,2\n");

    // Success path.
    let svc = await freshService();
    importBatchFindUniqueMock.mockResolvedValue(
      readyBatchRow({ content_type: "csv", original_filename: "data.csv", sha256: sha256Of(body) })
    );
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: body.byteLength }, body });
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: 1 });
    await svc.inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(importBatchUpdateMock).not.toHaveBeenCalled();
    expect(importBatchUpdateManyMock).not.toHaveBeenCalled();

    // Failure path (storage not found).
    svc = await freshService();
    const { RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");
    importBatchFindUniqueMock.mockResolvedValue(readyBatchRow({ sha256: "a".repeat(64) }));
    storageGetMock.mockRejectedValue(new RawFileStoreError("NOT_FOUND", "gone"));
    await svc.inspectWorksheets({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(importBatchUpdateMock).not.toHaveBeenCalled();
    expect(importBatchUpdateManyMock).not.toHaveBeenCalled();
  });
});

// ─── stored_path sentinel rejected by the REAL RawFileStore validator ───

describe("inspectWorksheets — stored_path sentinel is genuinely non-operable", () => {
  it("the sentinel value is rejected as INVALID_KEY by RawFileStore's real, unmodified validateStorageKey", async () => {
    const { validateStorageKey, RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");
    const sentinel = "datahub-worksheet:batch-1:0";
    expect(() => validateStorageKey(sentinel)).toThrow(RawFileStoreError);
    try {
      validateStorageKey(sentinel);
      throw new Error("expected validateStorageKey to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RawFileStoreError);
      expect((err as InstanceType<typeof RawFileStoreError>).code).toBe("INVALID_KEY");
    }
  });

  it("if mistakenly passed to buildImportBatchKey's component validation, it is rejected before even reaching validateStorageKey", async () => {
    const { buildImportBatchKey } = await import("@/lib/data-hub/storage/rawFileStore");
    // buildImportBatchKey validates each ID component's grammar first (no
    // ':' allowed in a component) — passing the sentinel-shaped importBatchId
    // component is rejected as a TypeError at the component-validation layer.
    expect(() => buildImportBatchKey("org-1", "datahub-worksheet:batch-1:0")).toThrow(TypeError);
  });
});

// ─── Duplicate-name known limitation (Step 13) ──────────────────────────

describe("inspectWorksheets — duplicate worksheet names (known, documented limitation)", () => {
  it("a genuine duplicate-named-sheet xlsx fixture could NOT be constructed via SheetJS's own writer API", () => {
    // Both a straightforward `book_append_sheet(wb, ws, sameName)` call
    // TWICE (which throws its own "Worksheet with name already exists"
    // guard) and a hand-crafted `wb.SheetNames` array with a duplicate
    // entry inserted AFTER append (bypassing that guard) were tried
    // directly against the installed `xlsx` package during this phase's
    // implementation. Both fail identically: `XLSX.write(...)`'s own
    // internal `check_wb_names` validation throws
    // "Error: Duplicate Sheet Name: <name>" before any bytes are ever
    // produced — this is NOT a bug in this codebase, it is SheetJS's own
    // writer refusing to serialize an ambiguous workbook. Fabricating a
    // fixture that bypasses this would require hand-authoring raw OOXML/
        // ZIP bytes outside any library's structural safety checks — exactly
    // the class of "unsafe hack" this phase's task explicitly declined to
    // attempt. This test therefore documents the finding honestly (per
    // the task's own instruction) rather than fabricating a fixture or
    // silently skipping the scenario. See workbookParser.ts's own code
    // comment (near inspectSpreadsheetWorksheets) and this ADR's 5A.2H.1
    // section for the full write-up of the underlying limitation this
    // would have exercised: a duplicate-named worksheet's `isEmpty` (and
    // any preview-derived content) can reflect the WRONG physical sheet's
    // content for a colliding non-final index, because `wb.Sheets` is
    // keyed by name, not position, on a whole-workbook read. `index`,
    // `name`, and `worksheet_visibility` remain positionally correct
    // regardless (sheetNames/the visibility array are both consumed
    // positionally). This service persists NO preview content at all (Step
    // 10), so the blast radius of the underlying limitation — if it could
    // be exercised — would be limited to a possibly-incorrect
    // canonical_status (derived from isEmpty) for a duplicate-named
    // worksheet, never a wrong index/name/existence and never actual data
    // corruption.
    const wb = XLSX.utils.book_new();
    wb.Workbook = { Sheets: [] };
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a"], [1]]), "Dup");
    // Bypass book_append_sheet's own uniqueness guard by hand-editing
    // SheetNames directly.
    wb.SheetNames.push("Dup");
    wb.Sheets["Dup"] = XLSX.utils.aoa_to_sheet([["b"], [2]]);
    expect(() => XLSX.write(wb, { type: "buffer", bookType: "xlsx" })).toThrow(/Duplicate Sheet Name/);
  });
});
