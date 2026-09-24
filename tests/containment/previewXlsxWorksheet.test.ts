import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

// Data Hub 6.2D2 — governed, read-only XLSX worksheet preview. Every
// workbook here is synthetic, built in-memory; no real workbook is used.

const uploadFindFirst = vi.fn();
const importBatchFindUnique = vi.fn();
const storageGet = vi.fn();
const requireRole = vi.fn();
// Every Prisma write surface the preview could conceivably touch. None may
// ever be called.
const writes = {
  uploadUpdate: vi.fn(),
  uploadUpdateMany: vi.fn(),
  uploadCreate: vi.fn(),
  uploadCreateMany: vi.fn(),
  importBatchUpdate: vi.fn(),
  importBatchUpdateMany: vi.fn(),
  illegalDumpingCreateMany: vi.fn(),
  transaction: vi.fn(),
  mappingVersionFindUnique: vi.fn(),
  sourceMappingFindUnique: vi.fn(),
  sourceSystemFindUnique: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    upload: {
      findFirst: (...args: unknown[]) => uploadFindFirst(...args),
      update: (...args: unknown[]) => writes.uploadUpdate(...args),
      updateMany: (...args: unknown[]) => writes.uploadUpdateMany(...args),
      create: (...args: unknown[]) => writes.uploadCreate(...args),
      createMany: (...args: unknown[]) => writes.uploadCreateMany(...args),
    },
    importBatch: {
      findUnique: (...args: unknown[]) => importBatchFindUnique(...args),
      update: (...args: unknown[]) => writes.importBatchUpdate(...args),
      updateMany: (...args: unknown[]) => writes.importBatchUpdateMany(...args),
    },
    illegalDumping: { createMany: (...args: unknown[]) => writes.illegalDumpingCreateMany(...args) },
    mappingVersion: { findUnique: (...args: unknown[]) => writes.mappingVersionFindUnique(...args) },
    sourceMapping: { findUnique: (...args: unknown[]) => writes.sourceMappingFindUnique(...args) },
    sourceSystem: { findUnique: (...args: unknown[]) => writes.sourceSystemFindUnique(...args) },
    $transaction: (...args: unknown[]) => writes.transaction(...args),
  },
}));
vi.mock("@/lib/data-hub/importBatch/compositionRoot", () => ({
  createImportBatchStorage: () => ({ get: (...args: unknown[]) => storageGet(...args) }),
}));
vi.mock("@/lib/org", () => ({ requireRole: (...args: unknown[]) => requireRole(...args) }));

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SECRET_OTHER_SHEET = "FIRST-SHEET-SECRET-CELL";

function worksheetRow(overrides: Record<string, unknown> = {}) {
  return {
    import_batch_id: "batch-1",
    worksheet_index: 1,
    worksheet_name: "Selected",
    worksheet_visibility: "visible",
    worksheet_is_empty: false,
    canonical_status: "AWAITING_CONFIRMATION",
    ...overrides,
  };
}

function xlsxBytes(wb: XLSX.WorkBook): Buffer {
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

/** Sheet 0 "First" holds a secret that must never leak; sheet 1 "Selected"
 * is 25 data rows x 55 columns with one long cell and a cached formula. */
function wideWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["wrong"], [SECRET_OTHER_SHEET]]), "First");
  const rows: string[][] = [Array.from({ length: 55 }, (_, i) => `header-${i}`)];
  for (let r = 0; r < 25; r++) rows.push(Array.from({ length: 55 }, (_, c) => (r === 0 && c === 0 ? "x".repeat(250) : `${r}:${c}`)));
  const selected = XLSX.utils.aoa_to_sheet(rows);
  selected.B2 = { t: "n", f: "1+1", v: 42 };
  XLSX.utils.book_append_sheet(wb, selected, "Selected");
  return xlsxBytes(wb);
}

function smallWorkbook(aoa: unknown[][], opts: { hideSelected?: 1 | 2 } = {}): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["wrong"], [SECRET_OTHER_SHEET]]), "First");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Selected");
  if (opts.hideSelected) {
    wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: opts.hideSelected }] };
  }
  return xlsxBytes(wb);
}

function readyBatch(bytes: Buffer, overrides: Record<string, unknown> = {}) {
  return {
    status: "READY",
    deleted_at: null,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    content_type: "xlsx",
    original_filename: "safe.xlsx",
    ...overrides,
  };
}

function arrange(bytes: Buffer, row: Record<string, unknown> = worksheetRow(), batchOverrides: Record<string, unknown> = {}) {
  uploadFindFirst.mockResolvedValue(row);
  importBatchFindUnique.mockResolvedValue(readyBatch(bytes, batchOverrides));
  storageGet.mockResolvedValue({ body: bytes });
}

async function service() {
  return (await import("@/lib/data-hub/importBatch/previewXlsxWorksheet")).previewXlsxWorksheet;
}

async function run(bytes: Buffer = wideWorkbook(), row?: Record<string, unknown>) {
  arrange(bytes, row);
  return (await service())({ organisationId: "org-1", worksheetId: "worksheet-1" });
}

function expectNoWrites() {
  for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled();
}

beforeEach(() => {
  uploadFindFirst.mockReset();
  importBatchFindUnique.mockReset();
  storageGet.mockReset();
  requireRole.mockReset();
  requireRole.mockResolvedValue({ organisationId: "org-1", userId: "user-1" });
  for (const fn of Object.values(writes)) fn.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("previewXlsxWorksheet — gates before storage (tests 1-11)", () => {
  it("1/2. wrong tenant or legacy lineage: tenant+DATA_HUB predicate, WORKSHEET_NOT_FOUND, no storage", async () => {
    uploadFindFirst.mockResolvedValue(null);
    const r = await (await service())({ organisationId: "org-2", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
    expect(uploadFindFirst.mock.calls[0][0].where).toEqual({ id: "worksheet-1", organisation_id: "org-2", lineage_kind: "DATA_HUB" });
    expect(importBatchFindUnique).not.toHaveBeenCalled();
    expect(storageGet).not.toHaveBeenCalled();
  });

  it.each([
    ["3. hidden", { worksheet_visibility: "hidden" }],
    ["4. veryHidden", { worksheet_visibility: "veryHidden" }],
    ["5. empty", { worksheet_is_empty: true }],
    ["6. INELIGIBLE", { canonical_status: "INELIGIBLE" }],
    ["6. SKIPPED", { canonical_status: "SKIPPED" }],
    ["6. IMPORTED", { canonical_status: "IMPORTED" }],
    ["missing persisted index", { worksheet_index: null }],
    ["missing persisted name", { worksheet_name: null }],
  ])("%s -> WORKSHEET_NOT_ELIGIBLE before any batch/storage read", async (_name, overrides) => {
    uploadFindFirst.mockResolvedValue(worksheetRow(overrides));
    const r = await (await service())({ organisationId: "org-1", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
    expect(importBatchFindUnique).not.toHaveBeenCalled();
    expect(storageGet).not.toHaveBeenCalled();
  });

  it.each([
    ["missing batch", null, "WORKSHEET_NOT_FOUND"],
    ["8. tombstoned batch", { status: "READY", deleted_at: new Date(), sha256: "x", content_type: "xlsx", original_filename: "a.xlsx" }, "WORKSHEET_NOT_FOUND"],
    ["7. non-READY batch", { status: "PROCESSING", deleted_at: null, sha256: "x", content_type: "xlsx", original_filename: "a.xlsx" }, "BATCH_NOT_READY"],
    ["9. READY batch missing sha256", { status: "READY", deleted_at: null, sha256: null, content_type: "xlsx", original_filename: "a.xlsx" }, "PROVIDER_FAILURE"],
    ["11. legacy xls", { status: "READY", deleted_at: null, sha256: "x", content_type: "xls", original_filename: "a.xls" }, "UNSUPPORTED_FORMAT"],
    ["10. content_type csv", { status: "READY", deleted_at: null, sha256: "x", content_type: "csv", original_filename: "a.xlsx" }, "UNSUPPORTED_FORMAT"],
    ["10. filename .csv", { status: "READY", deleted_at: null, sha256: "x", content_type: "xlsx", original_filename: "a.csv" }, "UNSUPPORTED_FORMAT"],
    ["10. filename .xls", { status: "READY", deleted_at: null, sha256: "x", content_type: "xlsx", original_filename: "a.xls" }, "UNSUPPORTED_FORMAT"],
    ["10. filename unclassifiable", { status: "READY", deleted_at: null, sha256: "x", content_type: "xlsx", original_filename: "noext" }, "UNSUPPORTED_FORMAT"],
  ])("%s -> %s with exact code, tenant-scoped, before storage", async (_name, batch, code) => {
    uploadFindFirst.mockResolvedValue(worksheetRow());
    importBatchFindUnique.mockResolvedValue(batch);
    const r = await (await service())({ organisationId: "org-1", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code });
    expect(importBatchFindUnique.mock.calls[0][0].where).toEqual({ id_organisation_id: { id: "batch-1", organisation_id: "org-1" } });
    expect(storageGet).not.toHaveBeenCalled();
  });
});

describe("previewXlsxWorksheet — storage, integrity, parser (tests 12-15)", () => {
  it("12. server-derived key, bounded GET; storage NOT_FOUND vs provider failure", async () => {
    const { RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");
    const { MAX_SOURCE_FILE_BYTES } = await import("@/lib/data-hub/limits");
    const bytes = wideWorkbook();
    arrange(bytes);
    storageGet.mockRejectedValue(new RawFileStoreError("NOT_FOUND", "missing"));
    expect(await (await service())({ organisationId: "org-1", worksheetId: "worksheet-1" })).toMatchObject({ ok: false, code: "STORAGE_NOT_FOUND" });
    expect(storageGet.mock.calls[0][0]).toContain("org-1");
    expect(storageGet.mock.calls[0][0]).toContain("batch-1");
    expect(storageGet.mock.calls[0][1]).toEqual({ maxBytes: MAX_SOURCE_FILE_BYTES });
    storageGet.mockReset();
    storageGet.mockRejectedValue(new Error("provider exploded with secret detail"));
    const r = await (await service())({ organisationId: "org-1", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "PROVIDER_FAILURE" });
    expect(JSON.stringify(r)).not.toContain("secret detail");
  });

  it("13. hash mismatch -> STORAGE_INTEGRITY_MISMATCH, parser never reached", async () => {
    const { xlsxAdapter } = await import("@/lib/data-hub/workbookParser");
    const readSpy = vi.spyOn(xlsxAdapter, "read");
    const bytes = wideWorkbook();
    arrange(bytes, worksheetRow(), { sha256: "0".repeat(64) });
    expect(await (await service())({ organisationId: "org-1", worksheetId: "worksheet-1" })).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("14. malformed xlsx -> sanitized PARSER_REJECTED", async () => {
    const r = await run(Buffer.from("PK\x03\x04not-an-xlsx"));
    expect(r).toMatchObject({ ok: false, code: "PARSER_REJECTED" });
    expect(JSON.stringify(r)).not.toMatch(/zip|UNSAFE_ARCHIVE|MALFORMED_WORKBOOK|SheetJS/i);
  });

  it("15. archive-guard rejection (disallowed ZIP comment) -> PARSER_REJECTED, SheetJS never reached", async () => {
    const { xlsxAdapter } = await import("@/lib/data-hub/workbookParser");
    const readSpy = vi.spyOn(xlsxAdapter, "read");
    const valid = smallWorkbook([["a"], ["b"]]);
    expect(valid.readUInt32LE(valid.length - 22)).toBe(0x06054b50);
    const comment = Buffer.from("comment");
    const tampered = Buffer.concat([valid, comment]);
    tampered.writeUInt16LE(comment.length, valid.length - 2);
    const r = await run(tampered);
    expect(r).toMatchObject({ ok: false, code: "PARSER_REJECTED" });
    expect(readSpy).not.toHaveBeenCalled();
  });
});

describe("previewXlsxWorksheet — authoritative identity (tests 16-18)", () => {
  it("16/18. decodes ONLY the persisted worksheet_index of a multi-sheet workbook; other sheets never leak", async () => {
    const r = await run();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview).toMatchObject({ worksheetId: "worksheet-1", worksheetName: "Selected", worksheetIndex: 1 });
    expect(JSON.stringify(r)).not.toContain(SECRET_OTHER_SHEET);
    expect(JSON.stringify(r)).not.toContain("wrong");
    expectNoWrites();
  });

  it("16. an out-of-range persisted index fails closed — never a worksheet-0 fallback", async () => {
    const r = await run(wideWorkbook(), worksheetRow({ worksheet_index: 7 }));
    expect(r).toMatchObject({ ok: false, code: "PARSER_REJECTED" });
    expect(JSON.stringify(r)).not.toContain(SECRET_OTHER_SHEET);
  });

  it("TOCTOU: persisted name disagreeing with the hash-pinned bytes fails closed (STORAGE_INTEGRITY_MISMATCH)", async () => {
    const r = await run(wideWorkbook(), worksheetRow({ worksheet_name: "First" }));
    expect(r).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
    expect(JSON.stringify(r)).not.toContain(SECRET_OTHER_SHEET);
  });

  it("TOCTOU: persisted 'visible' but decoded hidden/veryHidden fails closed", async () => {
    for (const hidden of [1, 2] as const) {
      const r = await run(smallWorkbook([["h"], ["v"]], { hideSelected: hidden }));
      expect(r).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
    }
  });

  it("17. request cannot spoof index/name: route ignores query/body and the service accepts only organisationId + worksheetId", async () => {
    arrange(wideWorkbook());
    const { GET } = await import("@/app/api/data-hub/worksheets/[id]/preview/route");
    const req = new Request("http://x/api/data-hub/worksheets/worksheet-1/preview?worksheetIndex=0&worksheetName=First&format=csv&filename=a.csv", {
      method: "GET",
      headers: { "x-worksheet-index": "0" },
    });
    const res = await GET(req as never, { params: Promise.resolve({ id: "worksheet-1" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.preview).toMatchObject({ worksheetIndex: 1, worksheetName: "Selected" });
    expect(JSON.stringify(body)).not.toContain(SECRET_OTHER_SHEET);
    const src = stripComments(read("lib/data-hub/importBatch/previewXlsxWorksheet.ts"));
    expect(src).toMatch(/export async function previewXlsxWorksheet\(context: \{\s*organisationId: string;\s*worksheetId: string;\s*\}\)/);
    expect(src).toMatch(/\{ index: worksheet\.worksheet_index \}/);
  });
});

describe("previewXlsxWorksheet — bounds and truncation (tests 19-23)", () => {
  it("19-22. truthful counts; 20-row, 50-column, 200-char bounds", async () => {
    const r = await run();
    if (!r.ok) throw new Error("expected ok");
    expect(r.preview.rowCount).toBe(25);
    expect(r.preview.columnCount).toBe(55);
    expect(r.preview.headers).toHaveLength(50);
    expect(r.preview.headers[49]).toBe("header-49");
    expect(r.preview.sampleRows).toHaveLength(20);
    expect(r.preview.sampleRowCount).toBe(20);
    expect(r.preview.sampleRows.every((row) => row.length === 50)).toBe(true);
    expect(r.preview.sampleRows[0][0]).toBe(`${"x".repeat(200)}…(truncated)`);
    expect(r.preview.sampleRows.flat().every((cell) => cell.length <= 200 + "…(truncated)".length)).toBe(true);
    expect(r.preview.truncated).toBe(true);
  });

  it("23. small, in-bounds sheet -> truncated false", async () => {
    const r = await run(smallWorkbook([["a", "b"], ["1", "2"], ["3", "4"]]));
    if (!r.ok) throw new Error("expected ok");
    expect(r.preview).toMatchObject({ rowCount: 2, columnCount: 2, headers: ["a", "b"], sampleRows: [["1", "2"], ["3", "4"]], sampleRowCount: 2, truncated: false });
  });

  it("23. a ragged row wider than the header (still <= 50 columns) is NOT reported as truncated", async () => {
    const r = await run(smallWorkbook([["a"], ["1", "2", "3"]]));
    if (!r.ok) throw new Error("expected ok");
    expect(r.preview.columnCount).toBe(3);
    // SheetJS pads the header row to the sheet's declared range width.
    expect(r.preview.headers).toEqual(["a", "", ""]);
    expect(r.preview.sampleRows).toEqual([["1", "2", "3"]]);
    expect(r.preview.truncated).toBe(false);
  });

  it("23. exactly 20 rows x 50 columns x 200 chars is NOT truncated", async () => {
    const aoa = [Array.from({ length: 50 }, (_, c) => `h${c}`)];
    for (let r = 0; r < 20; r++) aoa.push(Array.from({ length: 50 }, () => "y".repeat(200)));
    const r = await run(smallWorkbook(aoa));
    if (!r.ok) throw new Error("expected ok");
    expect(r.preview).toMatchObject({ rowCount: 20, columnCount: 50, sampleRowCount: 20, truncated: false });
  });

  it("23. each single reason triggers truncated: omitted row, omitted column, long header, long displayed cell", async () => {
    const rows21 = [["h"], ...Array.from({ length: 21 }, (_, i) => [`${i}`])];
    const cols51 = [Array.from({ length: 51 }, (_, c) => `h${c}`), Array.from({ length: 51 }, () => "v")];
    const longHeader = [["h".repeat(201)], ["v"]];
    const longCell = [["h"], ["v".repeat(201)]];
    for (const aoa of [rows21, cols51, longHeader, longCell]) {
      const r = await run(smallWorkbook(aoa));
      if (!r.ok) throw new Error("expected ok");
      expect(r.preview.truncated).toBe(true);
    }
  });

  it("23. a long cell only in an omitted row is still flagged through row truncation, never shown", async () => {
    const aoa = [["h"], ...Array.from({ length: 20 }, () => ["v"]), ["z".repeat(500)]];
    const r = await run(smallWorkbook(aoa));
    if (!r.ok) throw new Error("expected ok");
    expect(r.preview.truncated).toBe(true);
    expect(JSON.stringify(r)).not.toContain("zzzz");
  });
});

describe("previewXlsxWorksheet — formulas, HTML, DTO, writes (tests 24, 25, 45)", () => {
  it("24. formulas are never executed: cached values only; formula text never returned; uncached formula is empty", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "First");
    const ws = XLSX.utils.aoa_to_sheet([["cached", "uncached", "html", "bool", "num"], ["", "", "<b>bold</b>", true, 1.5]]);
    ws.A2 = { t: "n", f: "1+1", v: 99 }; // deliberately wrong cached value: proves no recalculation
    ws.B2 = { t: "n", f: "SUM(Z1:Z9)" };
    XLSX.utils.book_append_sheet(wb, ws, "Selected");
    const r = await run(xlsxBytes(wb));
    if (!r.ok) throw new Error("expected ok");
    expect(r.preview.sampleRows[0][0]).toBe("99");
    expect(r.preview.sampleRows[0][0]).not.toBe("2");
    expect(r.preview.sampleRows[0][1]).toBe("");
    expect(r.preview.sampleRows[0][2]).toBe("<b>bold</b>");
    expect(r.preview.sampleRows[0].slice(3)).toEqual(["true", "1.5"]);
    expect(JSON.stringify(r)).not.toMatch(/SUM\(|1\+1/);
  });

  it("45. DTO carries generic fields only — no mapping/required-header/domain claims", async () => {
    const r = await run();
    if (!r.ok) throw new Error("expected ok");
    expect(Object.keys(r.preview).sort()).toEqual(
      ["columnCount", "headers", "rowCount", "sampleRowCount", "sampleRows", "truncated", "worksheetId", "worksheetIndex", "worksheetName"].sort()
    );
    expect(r.preview.headers.every((h) => typeof h === "string")).toBe(true);
    expect(r.preview.sampleRows.flat().every((c) => typeof c === "string")).toBe(true);
  });

  it("25. zero Prisma writes, zero $transaction, zero mapping/source-system reads across success and failure", async () => {
    await run();
    await run(Buffer.from("PK\x03\x04garbage"));
    await run(wideWorkbook(), worksheetRow({ worksheet_name: "First" }));
    expectNoWrites();
    const src = stripComments(read("lib/data-hub/importBatch/previewXlsxWorksheet.ts"));
    expect(src).not.toMatch(/prisma\.\w+\.(update|updateMany|create|createMany|upsert|delete|deleteMany)\(|\$transaction|\$executeRaw|\$queryRaw|\btx\./);
    expect(src.match(/prisma\.\w+\.\w+\(/g)).toEqual(["prisma.upload.findFirst(", "prisma.importBatch.findUnique("]);
    expect(src).not.toMatch(/mappingVersion|sourceMapping|sourceSystem|illegalDumping|IllegalDumping|reporting_period|console\./);
  });
});

describe("preview route — auth, tenant, headers (tests 26, 44)", () => {
  it("26. 401/403 before any lookup; private no-store on every response", async () => {
    const { GET } = await import("@/app/api/data-hub/worksheets/[id]/preview/route");
    for (const [msg, status] of [["Unauthorized", 401], ["Forbidden", 403]] as const) {
      requireRole.mockReset();
      requireRole.mockRejectedValue(new Error(msg));
      const res = await GET(new Request("http://x/p") as never, { params: Promise.resolve({ id: "worksheet-1" }) });
      expect(res.status).toBe(status);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(requireRole).toHaveBeenCalledWith("manager");
    expect(uploadFindFirst).not.toHaveBeenCalled();
    expect(storageGet).not.toHaveBeenCalled();
  });

  it("26/44. success uses the session tenant, private no-store, and generic fields only", async () => {
    arrange(wideWorkbook());
    const { GET } = await import("@/app/api/data-hub/worksheets/[id]/preview/route");
    const res = await GET(new Request("http://x/p") as never, { params: Promise.resolve({ id: "worksheet-1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    for (const call of uploadFindFirst.mock.calls) expect(call[0].where.organisation_id).toBe("org-1");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["ok", "preview"]);
    expect(body.preview).not.toHaveProperty("requiredHeadersPresent");
    expect(body.preview).not.toHaveProperty("mapping");
    expectNoWrites();
  });

  it("44. failures are private no-store with a controlled code; unexpected errors log no workbook detail", async () => {
    const { GET } = await import("@/app/api/data-hub/worksheets/[id]/preview/route");
    uploadFindFirst.mockResolvedValue(worksheetRow({ worksheet_visibility: "hidden" }));
    importBatchFindUnique.mockResolvedValue({ content_type: "xlsx" });
    const res = await GET(new Request("http://x/p") as never, { params: Promise.resolve({ id: "worksheet-1" }) });
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    uploadFindFirst.mockRejectedValue(new Error(`db failure containing ${SECRET_OTHER_SHEET}`));
    const res500 = await GET(new Request("http://x/p") as never, { params: Promise.resolve({ id: "worksheet-1" }) });
    expect(res500.status).toBe(500);
    expect(res500.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.stringify(await res500.json())).not.toContain(SECRET_OTHER_SHEET);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(SECRET_OTHER_SHEET);
  });

  it("26. the route reads no request body/query and passes only session tenant + path id", () => {
    const src = stripComments(read("app/api/data-hub/worksheets/[id]/preview/route.ts"));
    expect(src).not.toMatch(/req\.(json|text|formData|arrayBuffer|body)|searchParams|nextUrl|headers\.get/);
    expect(src).toMatch(/previewDataHubWorksheet\(\{ organisationId: session\.organisationId, worksheetId: id \}\)/);
    expect(src).toMatch(/requireRole\("manager"\)/);
  });
});

describe("after a SUCCESSFUL XLSX preview, import/confirm/mapping stay server-blocked (tests 38, 39, 40)", () => {
  it("38/39. real preview succeeds, then direct confirm-illegal-dumping and mapping-selection are 422 UNSUPPORTED_FORMAT with zero writes", async () => {
    const bytes = wideWorkbook();
    arrange(bytes, { ...worksheetRow(), id: "worksheet-1", mapping_version_id: null, period_start: null, period_end: null });
    const preview = await import("@/app/api/data-hub/worksheets/[id]/preview/route");
    const previewRes = await preview.GET(new Request("http://x/p") as never, { params: Promise.resolve({ id: "worksheet-1" }) });
    expect(previewRes.status).toBe(200);
    storageGet.mockClear();

    const confirm = await import("@/app/api/data-hub/worksheets/[id]/confirm-illegal-dumping/route");
    const confirmRes = await confirm.POST(
      new Request("http://x/c", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }) as never,
      { params: Promise.resolve({ id: "worksheet-1" }) }
    );
    expect(confirmRes.status).toBe(422);
    // The confirm route returns the controlled template message, not the code.
    const { getMessageTemplate } = await import("@/lib/data-hub/importBatch/failureTaxonomy");
    expect(await confirmRes.json()).toEqual({ ok: false, error: getMessageTemplate("UNSUPPORTED_FORMAT") });

    writes.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        upload: { findFirst: uploadFindFirst, updateMany: writes.uploadUpdateMany, update: writes.uploadUpdate },
        importBatch: { findUnique: importBatchFindUnique },
        sourceSystem: { findUnique: writes.sourceSystemFindUnique },
        sourceMapping: { findUnique: writes.sourceMappingFindUnique },
        mappingVersion: { findUnique: writes.mappingVersionFindUnique },
      })
    );
    const mapping = await import("@/app/api/data-hub/worksheets/[id]/mapping-selection/route");
    const mappingRes = await mapping.POST(
      new Request("http://x/m", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceMappingId: "mapping-1" }) }) as never,
      { params: Promise.resolve({ id: "worksheet-1" }) }
    );
    expect(mappingRes.status).toBe(422);
    expect(await mappingRes.json()).toEqual({ ok: false, error: getMessageTemplate("UNSUPPORTED_FORMAT") });

    expect(storageGet).not.toHaveBeenCalled();
    for (const [name, fn] of Object.entries(writes)) {
      // selectWorksheetMapping opens its tx before its format gate, and the
      // confirm route reads (never writes) the reporting-period flag — only
      // the write surfaces must stay untouched here.
      if (name === "transaction" || name.endsWith("FindUnique")) continue;
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("40/42. D2 runtime files touch no reporting-period/SourceSystem config, schema, or migrations", () => {
    for (const rel of [
      "lib/data-hub/importBatch/previewXlsxWorksheet.ts",
      "lib/data-hub/importBatch/previewDataHubWorksheet.ts",
      "lib/data-hub/previewBounds.ts",
      "app/api/data-hub/worksheets/[id]/preview/route.ts",
      "app/data-hub/import/_components/XlsxWorksheetPreviewPanel.tsx",
    ]) {
      const src = stripComments(read(rel));
      expect(src).not.toMatch(/reporting_period_required|reportingPeriodRequired|sourceSystem|SourceSystem|prisma\/migrations|schema\.prisma/);
    }
  });
});
