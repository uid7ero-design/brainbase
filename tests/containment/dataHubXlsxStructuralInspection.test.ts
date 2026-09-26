import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Data Hub 6.2D1 — governed XLSX STRUCTURAL INSPECTION. XLSX may be
// selected, uploaded, finalized and structurally inspected into worksheet
// lineage; it must NOT become previewable, confirmable or importable. Covers
// the live inspect route's content_type dispatch (mocked delegates AND real
// delegates over mocked Prisma/storage), the browser orchestrator's new
// worksheetInventoryReady state (fresh + resume), the inventory UI, the
// picker, and repo-wide importer containment. No real network/DB/Blob.

// ─── Mocks ──────────────────────────────────────────────────────────────

const putMock = vi.fn();
vi.mock("@vercel/blob/client", () => ({
  put: (...args: unknown[]) => putMock(...args),
  getPayloadFromClientToken: vi.fn(),
}));

const requireRoleMock = vi.fn();
vi.mock("@/lib/org", () => ({ requireRole: (...a: unknown[]) => requireRoleMock(...a) }));

const importBatchFindUniqueMock = vi.fn();
const importBatchUpdateMock = vi.fn();
const importBatchUpdateManyMock = vi.fn();
const uploadFindManyMock = vi.fn();
const uploadFindFirstMock = vi.fn();
const uploadCreateManyMock = vi.fn();
const uploadUpdateMock = vi.fn();
const uploadUpdateManyMock = vi.fn();
const uploadDeleteManyMock = vi.fn();
const sourceSystemFindUniqueMock = vi.fn();
const sourceSystemUpdateMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    importBatch: {
      findUnique: (...a: unknown[]) => importBatchFindUniqueMock(...a),
      update: (...a: unknown[]) => importBatchUpdateMock(...a),
      updateMany: (...a: unknown[]) => importBatchUpdateManyMock(...a),
    },
    upload: {
      findMany: (...a: unknown[]) => uploadFindManyMock(...a),
      findFirst: (...a: unknown[]) => uploadFindFirstMock(...a),
      createMany: (...a: unknown[]) => uploadCreateManyMock(...a),
      update: (...a: unknown[]) => uploadUpdateMock(...a),
      updateMany: (...a: unknown[]) => uploadUpdateManyMock(...a),
      deleteMany: (...a: unknown[]) => uploadDeleteManyMock(...a),
    },
    sourceSystem: {
      findUnique: (...a: unknown[]) => sourceSystemFindUniqueMock(...a),
      update: (...a: unknown[]) => sourceSystemUpdateMock(...a),
    },
    mappingVersion: { findUnique: vi.fn() },
    sourceMapping: { findUnique: vi.fn() },
    $transaction: (...a: unknown[]) => transactionMock(...a),
  },
}));

const storageGetMock = vi.fn();
vi.mock("@/lib/data-hub/importBatch/compositionRoot", () => ({
  createImportBatchStorage: () => ({
    provider: "vercel-blob-private",
    put: vi.fn(),
    head: vi.fn(),
    get: (...a: unknown[]) => storageGetMock(...a),
    delete: vi.fn(),
  }),
}));

beforeEach(() => {
  for (const m of [
    putMock,
    requireRoleMock,
    importBatchFindUniqueMock,
    importBatchUpdateMock,
    importBatchUpdateManyMock,
    uploadFindManyMock,
    uploadFindFirstMock,
    uploadCreateManyMock,
    uploadUpdateMock,
    uploadUpdateManyMock,
    uploadDeleteManyMock,
    sourceSystemFindUniqueMock,
    sourceSystemUpdateMock,
    transactionMock,
    storageGetMock,
  ]) {
    m.mockReset();
  }
  requireRoleMock.mockResolvedValue({ organisationId: "org-1", userId: "user-1" });
  sourceSystemFindUniqueMock.mockResolvedValue({ reporting_period_required: false });
});

// ─── Fixtures ───────────────────────────────────────────────────────────

const ROOT = process.cwd();
function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

// A distinctive cell value planted in every fixture workbook. It must never
// appear in any persisted row, route response, or rendered inventory.
const SECRET_CELL = "SECRET-CELL-VALUE-do-not-leak";

interface SheetSpec {
  name: string;
  rows: unknown[][];
  hidden?: 0 | 1 | 2;
}

function xlsxBytes(sheets: SheetSpec[]): Buffer {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Sheets: [] };
  sheets.forEach((spec, index) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(spec.rows), spec.name);
    wb.Workbook!.Sheets![index] = { Hidden: spec.hidden ?? 0 };
  });
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const MATRIX_SHEETS: SheetSpec[] = [
  { name: "Visible", rows: [["Header"], [SECRET_CELL]], hidden: 0 },
  { name: "Hidden", rows: [["Header"], [SECRET_CELL]], hidden: 1 },
  { name: "VeryHidden", rows: [["Header"], [SECRET_CELL]], hidden: 2 },
  { name: "EmptyVisible", rows: [], hidden: 0 },
  { name: "Second Visible", rows: [["Header"], [SECRET_CELL]], hidden: 0 },
];

const EXPECTED_MATRIX = [
  [0, "Visible", "visible", false, "AWAITING_CONFIRMATION"],
  [1, "Hidden", "hidden", false, "INELIGIBLE"],
  [2, "VeryHidden", "veryHidden", false, "INELIGIBLE"],
  [3, "EmptyVisible", "visible", true, "INELIGIBLE"],
  [4, "Second Visible", "visible", false, "AWAITING_CONFIRMATION"],
];

// Onkaparinga monthly-workbook STRUCTURE: the 14 worksheet names in their
// real workbook order, verified (names/order only, plus: every sheet
// visible, every sheet non-empty) against the local June 2026 workbook
// during the 6.2D1 review. Generic operational sheet titles — no cell
// content, row, or PII is represented here; every fixture cell below is
// synthetic. The real workbook is not in the repository.
const ONKAPARINGA_SHEET_NAMES = [
  "Overview",
  "Trends",
  "Runs",
  "Driver Run",
  "Loads",
  "Jobs",
  "Tickets",
  "Ticket Tasks",
  "Vouchers",
  "Prestart Checks",
  "Contamination Inspections",
  "Service Exception Totals",
  "Service Exceptions",
  "Definitions",
];

function readyBatch(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: "READY",
    original_filename: "workbook.xlsx",
    content_type: "xlsx",
    sha256: null as string | null,
    deleted_at: null,
    ...overrides,
  };
}

function arrangeXlsx(bytes: Buffer, batchOverrides: Partial<Record<string, unknown>> = {}) {
  importBatchFindUniqueMock.mockResolvedValue(readyBatch({ sha256: sha256Of(bytes), ...batchOverrides }));
  storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: bytes.byteLength }, body: bytes });
}

function existingRowsFor(expected: unknown[][]) {
  return expected.map(([index, name, visibility, isEmpty, status]) => ({
    organisation_id: "org-1",
    import_batch_id: "batch-1",
    worksheet_index: index,
    worksheet_name: name,
    worksheet_visibility: visibility,
    worksheet_is_empty: isEmpty,
    lineage_kind: "DATA_HUB",
    canonical_status: status,
  }));
}

async function freshDispatcher() {
  vi.resetModules();
  return import("@/lib/data-hub/importBatch/inspectImportBatch");
}

async function freshRoute() {
  vi.resetModules();
  return import("@/app/api/data-hub/import-batches/[id]/inspect/route");
}

function routeCtx(id = "batch-1") {
  return { params: Promise.resolve({ id }) };
}

function postRequest(body?: unknown, url = "http://x/api/data-hub/import-batches/batch-1/inspect") {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

// ─── A. Route dispatch — delegates mocked, dispatch observed directly ──

describe("D1 inspect route — dispatches on persisted content_type only (tests 3-6)", () => {
  const csvSpy = vi.fn();
  const xlsxSpy = vi.fn();
  // Set when the inspectWorksheets module (and so workbookParser/xlsx) is
  // actually LOADED — the dispatcher imports it lazily on the xlsx branch.
  let xlsxModuleLoaded = false;

  beforeEach(() => {
    xlsxModuleLoaded = false;
    csvSpy.mockReset().mockResolvedValue({ ok: true, worksheets: [{ worksheetIndex: 0, worksheetName: "CSV", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION" }] });
    xlsxSpy.mockReset().mockResolvedValue({ ok: true, worksheets: [] });
    vi.doMock("@/lib/data-hub/importBatch/inspectCsvWorksheet", () => ({ inspectCsvWorksheet: (...a: unknown[]) => csvSpy(...a) }));
    vi.doMock("@/lib/data-hub/importBatch/inspectWorksheets", () => {
      xlsxModuleLoaded = true;
      return { inspectWorksheets: (...a: unknown[]) => xlsxSpy(...a) };
    });
  });
  afterEach(() => {
    vi.doUnmock("@/lib/data-hub/importBatch/inspectCsvWorksheet");
    vi.doUnmock("@/lib/data-hub/importBatch/inspectWorksheets");
  });

  it("csv -> inspectCsvWorksheet only, with the session organisation", async () => {
    importBatchFindUniqueMock.mockResolvedValue(readyBatch({ content_type: "csv" }));
    const { POST } = await freshRoute();
    const res = await POST(postRequest(), routeCtx());
    expect(res.status).toBe(200);
    expect(csvSpy).toHaveBeenCalledTimes(1);
    expect(csvSpy).toHaveBeenCalledWith({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(xlsxSpy).not.toHaveBeenCalled();
    // CSV requests never load the xlsx inspection module at all.
    expect(xlsxModuleLoaded).toBe(false);
  });

  it("csv batch that is not READY still goes to inspectCsvWorksheet (its own gate order is preserved exactly)", async () => {
    importBatchFindUniqueMock.mockResolvedValue(readyBatch({ content_type: "csv", status: "PROCESSING" }));
    const { POST } = await freshRoute();
    await POST(postRequest(), routeCtx());
    expect(csvSpy).toHaveBeenCalledTimes(1);
    expect(xlsxSpy).not.toHaveBeenCalled();
  });

  it("xlsx -> inspectWorksheets only", async () => {
    importBatchFindUniqueMock.mockResolvedValue(readyBatch({ content_type: "xlsx" }));
    const { POST } = await freshRoute();
    const res = await POST(postRequest(), routeCtx());
    expect(res.status).toBe(200);
    expect(xlsxSpy).toHaveBeenCalledTimes(1);
    expect(xlsxSpy).toHaveBeenCalledWith({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(csvSpy).not.toHaveBeenCalled();
  });

  it.each(["xls", "pdf", "", "XLSX", "csv "])("content_type %j -> 422 UNSUPPORTED_FORMAT, no inspector call, no storage", async (contentType) => {
    importBatchFindUniqueMock.mockResolvedValue(readyBatch({ content_type: contentType }));
    const { POST } = await freshRoute();
    const res = await POST(postRequest(), routeCtx());
    expect(res.status).toBe(422);
    expect(csvSpy).not.toHaveBeenCalled();
    expect(xlsxSpy).not.toHaveBeenCalled();
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("xlsx batch not READY -> 409 before any inspector call", async () => {
    importBatchFindUniqueMock.mockResolvedValue(readyBatch({ content_type: "xlsx", status: "FAILED" }));
    const { POST } = await freshRoute();
    const res = await POST(postRequest(), routeCtx());
    expect(res.status).toBe(409);
    expect(xlsxSpy).not.toHaveBeenCalled();
  });

  it("wrong tenant / nonexistent batch -> 404, zero inspector calls, zero storage", async () => {
    importBatchFindUniqueMock.mockResolvedValue(null);
    const { POST } = await freshRoute();
    const res = await POST(postRequest(), routeCtx());
    expect(res.status).toBe(404);
    expect(csvSpy).not.toHaveBeenCalled();
    expect(xlsxSpy).not.toHaveBeenCalled();
    expect(storageGetMock).not.toHaveBeenCalled();
    expect(importBatchFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id_organisation_id: { id: "batch-1", organisation_id: "org-1" } } })
    );
  });

  it("tombstoned batch -> 404, zero inspector calls", async () => {
    importBatchFindUniqueMock.mockResolvedValue(readyBatch({ content_type: "xlsx", deleted_at: new Date() }));
    const { POST } = await freshRoute();
    expect((await POST(postRequest(), routeCtx())).status).toBe(404);
    expect(xlsxSpy).not.toHaveBeenCalled();
  });

  it("client payload / query / extension spoofing cannot influence dispatch", async () => {
    importBatchFindUniqueMock.mockResolvedValue(readyBatch({ content_type: "xlsx", original_filename: "workbook.xlsx" }));
    const { POST } = await freshRoute();
    const res = await POST(
      postRequest(
        { contentType: "csv", format: "csv", filename: "x.csv", organisationId: "org-EVIL" },
        "http://x/api/data-hub/import-batches/batch-1/inspect?contentType=csv&organisationId=org-EVIL"
      ),
      routeCtx()
    );
    expect(res.status).toBe(200);
    expect(xlsxSpy).toHaveBeenCalledWith({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(csvSpy).not.toHaveBeenCalled();
    expect(xlsxModuleLoaded).toBe(true);
  });

  // inspectWorkbook classifies by filename — an xlsx content_type whose own
  // persisted filename does not classify as xlsx would otherwise reach the
  // UNGUARDED xls parse branch. Fail closed before storage.
  it.each(["legacy.xls", "data.csv", "noextension", "workbook.xlsx.xls"])(
    "persisted content_type xlsx but persisted filename %j -> 422 UNSUPPORTED_FORMAT, no inspector, no storage",
    async (original_filename) => {
      importBatchFindUniqueMock.mockResolvedValue(readyBatch({ content_type: "xlsx", original_filename }));
      const { POST } = await freshRoute();
      const res = await POST(postRequest(), routeCtx());
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ ok: false, error: expect.any(String), code: "UNSUPPORTED_FORMAT" });
      expect(xlsxSpy).not.toHaveBeenCalled();
      expect(csvSpy).not.toHaveBeenCalled();
      expect(storageGetMock).not.toHaveBeenCalled();
    }
  );

  it("failure bodies carry the controlled failure code (never a raw delegate message)", async () => {
    importBatchFindUniqueMock.mockResolvedValue(readyBatch({ content_type: "xlsx" }));
    xlsxSpy.mockResolvedValue({ ok: false, code: "PARSER_REJECTED", message: "The file could not be read." });
    const { POST } = await freshRoute();
    const res = await POST(postRequest(), routeCtx());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "The file could not be read.", code: "PARSER_REJECTED" });

    importBatchFindUniqueMock.mockResolvedValue(readyBatch({ content_type: "xls", original_filename: "legacy.xls" }));
    const res2 = await POST(postRequest(), routeCtx());
    expect(await res2.json()).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
  });

  it("401/403 before any lookup", async () => {
    const { POST } = await freshRoute();
    requireRoleMock.mockRejectedValueOnce(new Error("Unauthorized"));
    expect((await POST(postRequest(), routeCtx())).status).toBe(401);
    requireRoleMock.mockRejectedValueOnce(new Error("Forbidden"));
    expect((await POST(postRequest(), routeCtx())).status).toBe(403);
    expect(importBatchFindUniqueMock).not.toHaveBeenCalled();
  });
});

// ─── B. Real delegates over mocked Prisma/storage (tests 7-12) ─────────

describe("D1 dispatcher -> real inspectWorksheets for xlsx", () => {
  it("hash mismatch -> STORAGE_INTEGRITY_MISMATCH, zero worksheet reads/writes", async () => {
    const bytes = xlsxBytes(MATRIX_SHEETS);
    arrangeXlsx(bytes, { sha256: "f".repeat(64) });
    const { inspectImportBatch } = await freshDispatcher();
    const r = await inspectImportBatch({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(r).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
    expect(uploadFindManyMock).not.toHaveBeenCalled();
    expect(uploadCreateManyMock).not.toHaveBeenCalled();
  });

  it("malformed xlsx (ZIP signature, garbage body) -> PARSER_REJECTED, never reaches SheetJS, zero writes, sanitized message", async () => {
    const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("not really a zip archive at all")]);
    arrangeXlsx(bytes);
    const { inspectImportBatch } = await freshDispatcher();
    const parser = await import("@/lib/data-hub/workbookParser");
    const readSpy = vi.spyOn(parser.xlsxAdapter, "read");
    const r = await inspectImportBatch({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(r).toMatchObject({ ok: false, code: "PARSER_REJECTED" });
    expect(readSpy).not.toHaveBeenCalled();
    expect(uploadFindManyMock).not.toHaveBeenCalled();
    expect(uploadCreateManyMock).not.toHaveBeenCalled();
    expect((r as { message: string }).message).not.toMatch(/UNSAFE_ARCHIVE|ARCHIVE_LIMIT|MALFORMED_WORKBOOK|INVALID_FILE_SIGNATURE|zip/i);
    readSpy.mockRestore();
  });

  it("valid multi-sheet xlsx -> ordered, structural-only rows; hidden/veryHidden/empty INELIGIBLE, visible non-empty AWAITING_CONFIRMATION", async () => {
    const bytes = xlsxBytes(MATRIX_SHEETS);
    arrangeXlsx(bytes);
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: MATRIX_SHEETS.length });
    const { inspectImportBatch } = await freshDispatcher();
    const r = await inspectImportBatch({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(r.ok).toBe(true);
    expect(uploadCreateManyMock).toHaveBeenCalledTimes(1);
    const data = (uploadCreateManyMock.mock.calls[0][0] as { data: Array<Record<string, unknown>> }).data;
    expect(data.map((d) => [d.worksheet_index, d.worksheet_name, d.worksheet_visibility, d.worksheet_is_empty, d.canonical_status])).toEqual(EXPECTED_MATRIX);
    for (const row of data) {
      expect(row).toMatchObject({ organisation_id: "org-1", import_batch_id: "batch-1", lineage_kind: "DATA_HUB", size_bytes: 0 });
    }
    expect(JSON.stringify(data)).not.toContain(SECRET_CELL);
    expect(JSON.stringify(r)).not.toContain(SECRET_CELL);
    expect(importBatchUpdateMock).not.toHaveBeenCalled();
    expect(importBatchUpdateManyMock).not.toHaveBeenCalled();
  });

  it("repeat inspect against the identical persisted set -> success, zero extra rows", async () => {
    const bytes = xlsxBytes(MATRIX_SHEETS);
    arrangeXlsx(bytes);
    uploadFindManyMock.mockResolvedValue(existingRowsFor(EXPECTED_MATRIX));
    const { inspectImportBatch } = await freshDispatcher();
    const r = await inspectImportBatch({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(r.ok).toBe(true);
    expect(uploadCreateManyMock).not.toHaveBeenCalled();
    expect(uploadUpdateMock).not.toHaveBeenCalled();
    expect(uploadUpdateManyMock).not.toHaveBeenCalled();
    expect(uploadDeleteManyMock).not.toHaveBeenCalled();
  });

  it("repeated exact-set verification (e.g. every refresh/resume re-inspect) writes nothing, however many times it runs", async () => {
    const bytes = xlsxBytes(MATRIX_SHEETS);
    arrangeXlsx(bytes);
    uploadFindManyMock.mockResolvedValue(existingRowsFor(EXPECTED_MATRIX));
    const { inspectImportBatch } = await freshDispatcher();
    for (let i = 0; i < 3; i++) {
      const r = await inspectImportBatch({ organisationId: "org-1", importBatchId: "batch-1" });
      expect(r.ok).toBe(true);
    }
    expect(uploadCreateManyMock).not.toHaveBeenCalled();
    expect(uploadUpdateMock).not.toHaveBeenCalled();
    expect(uploadUpdateManyMock).not.toHaveBeenCalled();
    expect(uploadDeleteManyMock).not.toHaveBeenCalled();
    expect(importBatchUpdateMock).not.toHaveBeenCalled();
    expect(importBatchUpdateManyMock).not.toHaveBeenCalled();
  });

  it("tombstone landing BETWEEN the dispatcher's read and inspectWorksheets' own read -> BATCH_NOT_FOUND, storage never touched", async () => {
    const bytes = xlsxBytes(MATRIX_SHEETS);
    arrangeXlsx(bytes);
    importBatchFindUniqueMock
      .mockReset()
      .mockResolvedValueOnce(readyBatch({ sha256: sha256Of(bytes) }))
      .mockResolvedValueOnce(readyBatch({ sha256: sha256Of(bytes), deleted_at: new Date() }));
    const { inspectImportBatch } = await freshDispatcher();
    expect(await inspectImportBatch({ organisationId: "org-1", importBatchId: "batch-1" })).toMatchObject({ ok: false, code: "BATCH_NOT_FOUND" });
    expect(importBatchFindUniqueMock).toHaveBeenCalledTimes(2);
    expect(storageGetMock).not.toHaveBeenCalled();
    expect(uploadFindManyMock).not.toHaveBeenCalled();
    expect(uploadCreateManyMock).not.toHaveBeenCalled();
  });

  it("partial existing set -> PERSISTENCE_CONFLICT, never topped up", async () => {
    const bytes = xlsxBytes(MATRIX_SHEETS);
    arrangeXlsx(bytes);
    uploadFindManyMock.mockResolvedValue(existingRowsFor(EXPECTED_MATRIX.slice(0, 2)));
    const { inspectImportBatch } = await freshDispatcher();
    expect(await inspectImportBatch({ organisationId: "org-1", importBatchId: "batch-1" })).toMatchObject({ ok: false, code: "PERSISTENCE_CONFLICT" });
    expect(uploadCreateManyMock).not.toHaveBeenCalled();
  });

  it("divergent existing set (hidden sheet persisted as AWAITING_CONFIRMATION) -> PERSISTENCE_CONFLICT, never overwritten", async () => {
    const bytes = xlsxBytes(MATRIX_SHEETS);
    arrangeXlsx(bytes);
    const divergent = existingRowsFor(EXPECTED_MATRIX);
    divergent[1] = { ...divergent[1], canonical_status: "AWAITING_CONFIRMATION" };
    uploadFindManyMock.mockResolvedValue(divergent);
    const { inspectImportBatch } = await freshDispatcher();
    expect(await inspectImportBatch({ organisationId: "org-1", importBatchId: "batch-1" })).toMatchObject({ ok: false, code: "PERSISTENCE_CONFLICT" });
    expect(uploadCreateManyMock).not.toHaveBeenCalled();
    expect(uploadUpdateMock).not.toHaveBeenCalled();
    expect(uploadUpdateManyMock).not.toHaveBeenCalled();
  });

  it("a REAL legacy .xls workbook is never inspected live -> UNSUPPORTED_FORMAT, storage never touched", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["a"], [1]]), "One");
    const bytes = XLSX.write(wb, { type: "buffer", bookType: "biff8" }) as Buffer;
    arrangeXlsx(bytes, { content_type: "xls", original_filename: "legacy.xls" });
    const { inspectImportBatch } = await freshDispatcher();
    expect(await inspectImportBatch({ organisationId: "org-1", importBatchId: "batch-1" })).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
    expect(storageGetMock).not.toHaveBeenCalled();
    expect(uploadCreateManyMock).not.toHaveBeenCalled();
  });

  it("route response for a successful xlsx inspect is structural-only (no cell values, no storage internals)", async () => {
    const bytes = xlsxBytes(MATRIX_SHEETS);
    arrangeXlsx(bytes);
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: MATRIX_SHEETS.length });
    const { POST } = await freshRoute();
    const res = await POST(postRequest(), routeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["ok", "worksheets"]);
    for (const w of body.worksheets) {
      expect(Object.keys(w).sort()).toEqual(["canonicalStatus", "worksheetIndex", "worksheetIsEmpty", "worksheetName", "worksheetVisibility"]);
    }
    const text = JSON.stringify(body);
    expect(text).not.toContain(SECRET_CELL);
    expect(text).not.toMatch(/storage|sha256|datahub-batch/i);
  });

  it("CSV through the real dispatcher is still the xlsx-free inspectCsvWorksheet (one visible CSV worksheet)", async () => {
    const bytes = Buffer.from("report_date,location,waste_type\n2026-01-01,loc,type\n", "utf8");
    importBatchFindUniqueMock.mockResolvedValue(readyBatch({ content_type: "csv", original_filename: "d.csv", sha256: sha256Of(bytes) }));
    storageGetMock.mockResolvedValue({ metadata: { provider: "vercel-blob-private", size: bytes.byteLength }, body: bytes });
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: 1 });
    const { inspectImportBatch } = await freshDispatcher();
    const parser = await import("@/lib/data-hub/workbookParser");
    const readSpy = vi.spyOn(parser.xlsxAdapter, "read");
    const r = await inspectImportBatch({ organisationId: "org-1", importBatchId: "batch-1" });
    expect(r).toEqual({
      ok: true,
      worksheets: [{ worksheetIndex: 0, worksheetName: "CSV", worksheetVisibility: "visible", worksheetIsEmpty: false, canonicalStatus: "AWAITING_CONFIRMATION" }],
    });
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();
  });
});

// ─── C. Onkaparinga 14-sheet structural fixture (test 21) ──────────────

describe("D1 — Onkaparinga verified sheet-structure fixture", () => {
  it("represents the 14 verified worksheet names in workbook order and inspects to 14 ordered structural rows without any cell content", async () => {
    expect(ONKAPARINGA_SHEET_NAMES).toHaveLength(14);
    expect(new Set(ONKAPARINGA_SHEET_NAMES).size).toBe(14);
    const bytes = xlsxBytes(ONKAPARINGA_SHEET_NAMES.map((name) => ({ name, rows: [["synthetic"], [SECRET_CELL]] })));
    arrangeXlsx(bytes, { original_filename: "City of Onkaparinga-Month-June-2026.xlsx" });
    uploadFindManyMock.mockResolvedValue([]);
    uploadCreateManyMock.mockResolvedValue({ count: 14 });
    const { inspectImportBatch } = await freshDispatcher();
    const r = await inspectImportBatch({ organisationId: "org-1", importBatchId: "batch-1" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.worksheets.map((w) => [w.worksheetIndex, w.worksheetName])).toEqual(ONKAPARINGA_SHEET_NAMES.map((n, i) => [i, n]));
    expect(r.worksheets.every((w) => w.canonicalStatus === "AWAITING_CONFIRMATION")).toBe(true);
    expect(JSON.stringify(uploadCreateManyMock.mock.calls[0][0])).not.toContain(SECRET_CELL);
  });
});

// ─── D. Preview / confirm still reject an XLSX-inspected worksheet (16-17)

describe("D1 — an XLSX-inspected AWAITING_CONFIRMATION worksheet is still neither previewable nor confirmable", () => {
  const xlsxWorksheetRow = {
    id: "worksheet-1",
    import_batch_id: "batch-1",
    worksheet_index: 0,
    worksheet_name: "Overview",
    canonical_status: "AWAITING_CONFIRMATION",
    mapping_version_id: null,
    period_start: null,
    period_end: null,
  };
  const xlsxBatchRow = {
    status: "READY",
    content_type: "xlsx",
    sha256: "a".repeat(64),
    storage_key: "k",
    deleted_at: null,
    source_system_id: "ss-1",
  };

  it("previewWorksheet -> UNSUPPORTED_FORMAT, storage never touched", async () => {
    uploadFindFirstMock.mockResolvedValue(xlsxWorksheetRow);
    importBatchFindUniqueMock.mockResolvedValue(xlsxBatchRow);
    vi.resetModules();
    const { previewWorksheet } = await import("@/lib/data-hub/importBatch/previewWorksheet");
    expect(await previewWorksheet({ organisationId: "org-1", worksheetId: "worksheet-1" })).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("confirmDataHubWorksheet -> UNSUPPORTED_FORMAT, no storage, no transaction, no canonical write", async () => {
    uploadFindFirstMock.mockResolvedValue(xlsxWorksheetRow);
    importBatchFindUniqueMock.mockResolvedValue(xlsxBatchRow);
    vi.resetModules();
    const { confirmDataHubWorksheet } = await import("@/lib/data-hub/importBatch/confirmWorksheet");
    const r = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "user-1" });
    expect(r).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
    expect(storageGetMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(uploadUpdateMock).not.toHaveBeenCalled();
    expect(uploadUpdateManyMock).not.toHaveBeenCalled();
  });

  it("confirm on an XLSX worksheet whose period was ACCEPTED (C3) under reporting_period_required=true is STILL UNSUPPORTED_FORMAT — a period never implies import readiness", async () => {
    uploadFindFirstMock.mockResolvedValue({ ...xlsxWorksheetRow, period_start: new Date("2026-06-01"), period_end: new Date("2026-06-30") });
    importBatchFindUniqueMock.mockResolvedValue(xlsxBatchRow);
    sourceSystemFindUniqueMock.mockResolvedValue({ reporting_period_required: true });
    vi.resetModules();
    const { confirmDataHubWorksheet } = await import("@/lib/data-hub/importBatch/confirmWorksheet");
    const r = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "user-1" });
    expect(r).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
    expect(storageGetMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  // Direct HTTP calls against an XLSX worksheet id — the server alone
  // decides, whatever the browser does.
  it("DIRECT preview API rejects an ineligible XLSX worksheet before storage", async () => {
    uploadFindFirstMock.mockResolvedValue({ ...xlsxWorksheetRow, worksheet_visibility: "hidden", worksheet_is_empty: false });
    importBatchFindUniqueMock.mockResolvedValue(xlsxBatchRow);
    vi.resetModules();
    const { GET } = await import("@/app/api/data-hub/worksheets/[id]/preview/route");
    const res = await GET(postRequest(undefined, "http://x/api/data-hub/worksheets/worksheet-1/preview"), routeCtx("worksheet-1"));
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).not.toContain(SECRET_CELL);
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("DIRECT confirm API on an XLSX worksheet -> 422, no storage, no transaction, no write", async () => {
    uploadFindFirstMock.mockResolvedValue(xlsxWorksheetRow);
    importBatchFindUniqueMock.mockResolvedValue(xlsxBatchRow);
    vi.resetModules();
    const { POST } = await import("@/app/api/data-hub/worksheets/[id]/confirm-illegal-dumping/route");
    const res = await POST(postRequest(undefined, "http://x/api/data-hub/worksheets/worksheet-1/confirm-illegal-dumping"), routeCtx("worksheet-1"));
    expect(res.status).toBe(422);
    expect(storageGetMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
    expect(uploadUpdateMock).not.toHaveBeenCalled();
    expect(uploadUpdateManyMock).not.toHaveBeenCalled();
  });

  it("DIRECT mapping-selection API on an XLSX worksheet -> 422 UNSUPPORTED_FORMAT, zero writes, no SourceSystem/SourceMapping read", async () => {
    uploadFindFirstMock.mockResolvedValue(xlsxWorksheetRow);
    importBatchFindUniqueMock.mockResolvedValue(xlsxBatchRow);
    const sourceMappingFindUnique = vi.fn();
    transactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        upload: { findFirst: uploadFindFirstMock, updateMany: uploadUpdateManyMock },
        importBatch: { findUnique: importBatchFindUniqueMock },
        sourceSystem: { findUnique: sourceSystemFindUniqueMock },
        sourceMapping: { findUnique: sourceMappingFindUnique },
        mappingVersion: { findUnique: vi.fn() },
      })
    );
    vi.resetModules();
    const { POST } = await import("@/app/api/data-hub/worksheets/[id]/mapping-selection/route");
    const res = await POST(
      postRequest({ sourceMappingId: "mapping-1" }, "http://x/api/data-hub/worksheets/worksheet-1/mapping-selection"),
      routeCtx("worksheet-1")
    );
    expect(res.status).toBe(422);
    expect(uploadUpdateManyMock).not.toHaveBeenCalled();
    expect(uploadUpdateMock).not.toHaveBeenCalled();
    expect(sourceSystemFindUniqueMock).not.toHaveBeenCalled();
    expect(sourceMappingFindUnique).not.toHaveBeenCalled();
  });

  it("both services keep their own CSV-only content_type gate in source (untouched by D1)", () => {
    for (const rel of ["lib/data-hub/importBatch/previewWorksheet.ts", "lib/data-hub/importBatch/confirmWorksheet.ts"]) {
      const code = stripComments(read(rel));
      expect(code).toMatch(/batch\.content_type\s*!==\s*"csv"\)\s*\{\s*return fail\("UNSUPPORTED_FORMAT"\)/);
      expect(code).not.toMatch(/workbookParser|from\s+["']xlsx["']|inspectWorksheets/);
    }
  });
});

// ─── E. Browser orchestrator (tests 13, 14, 18) ────────────────────────

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function worksheetDTO(index: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `ws-${index}`,
    worksheetIndex: index,
    worksheetName: `Sheet ${index}`,
    worksheetVisibility: "visible",
    worksheetIsEmpty: false,
    canonicalStatus: "AWAITING_CONFIRMATION",
    importBatchId: "batch-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    confirmedBy: null,
    confirmedAt: null,
    lastAttemptAt: null,
    attemptCount: 0,
    lastFailureCode: null,
    lastFailureMessage: null,
    lastFailureRetryable: null,
    importedRowCount: null,
    periodStart: null,
    periodEnd: null,
    periodSource: null,
    reportingPeriodRequired: false,
    ...overrides,
  };
}

/** The structural descriptor inspect returns for a listed worksheet (no id). */
function descriptorOf(w: unknown) {
  const { worksheetIndex, worksheetName, worksheetVisibility, worksheetIsEmpty, canonicalStatus } = w as Record<string, unknown>;
  return { worksheetIndex, worksheetName, worksheetVisibility, worksheetIsEmpty, canonicalStatus };
}

function batchDetail(contentType: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "batch-1",
    status: "READY",
    originalFilename: contentType === "csv" ? "d.csv" : "workbook.xlsx",
    contentType,
    sizeBytes: 8,
    sourceSystemId: "ss-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sha256: "abc",
    uploadedBy: "user-1",
    attemptCount: 1,
    lastAttemptAt: null,
    lastFailureCode: null,
    lastFailureMessage: null,
    lastFailureRetryable: null,
    deletedAt: null,
    ...overrides,
  };
}

/** Routes by URL + method; records every call. Unknown routes throw loudly. */
function routedFetch(routes: {
  batch?: unknown;
  worksheets?: unknown[] | (() => unknown[]);
  initiate?: unknown;
  finalize?: unknown;
  inspect?: unknown;
  preview?: unknown | ((url: string) => Promise<Response>);
}) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url).replace(/^https?:\/\/[^/]*/, "");
    const method = init?.method ?? "GET";
    calls.push(`${method} ${u}`);
    if (method === "POST" && u === "/api/data-hub/import-batches") return jsonResponse(200, routes.initiate);
    if (method === "POST" && u.endsWith("/finalize")) return jsonResponse(200, routes.finalize);
    if (method === "POST" && u.endsWith("/inspect")) {
      // Default: a successful inspect whose freshly-derived descriptors
      // exactly match the (array) worksheet list — the server's exact-set
      // Case A/B outcome. Tests of divergence pass `inspect` explicitly.
      const fallback = { ok: true, worksheets: Array.isArray(routes.worksheets) ? routes.worksheets.map(descriptorOf) : [] };
      const body = routes.inspect ?? fallback;
      const status = (body as { ok?: boolean }).ok === false ? 409 : 200;
      return jsonResponse(status, body);
    }
    if (method === "GET" && u.endsWith("/worksheets")) {
      const w = typeof routes.worksheets === "function" ? routes.worksheets() : routes.worksheets;
      return jsonResponse(200, { worksheets: w ?? [] });
    }
    if (method === "GET" && u.endsWith("/preview")) {
      return typeof routes.preview === "function" ? routes.preview(u) : jsonResponse(200, routes.preview);
    }
    if (method === "GET" && /\/import-batches\/[^/]+$/.test(u)) return jsonResponse(200, { batch: routes.batch });
    throw new Error(`unexpected request: ${method} ${u}`);
  });
  return { fetchImpl, calls };
}

async function freshSessionModule() {
  return import("@/lib/data-hub/client/orchestrator");
}

/** Drives a FRESH (non-resume) session: initiate replays a PROCESSING batch
 * (no upload token), finalize-uncertainty -> retryFinalize -> READY ->
 * inspect -> list worksheets. The File's own name is deliberately
 * independent of the server-classified contentType. */
async function driveFreshSession(opts: { fileName: string; serverContentType: string; worksheets: unknown[] }) {
  const { createIllegalDumpingImportSession } = await freshSessionModule();
  const { fetchImpl, calls } = routedFetch({
    initiate: {
      batch: { id: "batch-1", status: "PROCESSING", originalFilename: opts.fileName, contentType: opts.serverContentType, sizeBytes: 8, expectedSha256: null, attemptCount: 1, lastFailureCode: null },
      uploadToken: null,
      configurationError: false,
    },
    finalize: { outcome: "READY", sha256: "abc" },
    worksheets: opts.worksheets,
  });
  const session = createIllegalDumpingImportSession({ fetchImpl, generateIdempotencyKey: () => "idem-1" });
  const phases: string[] = [];
  session.subscribe((s) => phases.push(s.phase));
  await session.start(new File(["x"], opts.fileName));
  expect(session.getState().phase).toBe("finalizeUncertain");
  await session.retryFinalize();
  return { session, phases, calls };
}

const FORBIDDEN_FOR_INVENTORY = ["confirmationReady", "previewing", "previewReady", "previewFailed", "confirming", "confirmFailed", "imported", "alreadyImported"];

describe("D1 orchestrator — fresh flow", () => {
  it("CSV still reaches confirmationReady exactly as before", async () => {
    const { session, phases } = await driveFreshSession({ fileName: "d.csv", serverContentType: "csv", worksheets: [worksheetDTO(0, { worksheetName: "CSV" })] });
    expect(session.getState().phase).toBe("confirmationReady");
    expect(phases.slice(-5)).toEqual(["finalizing", "physicalReady", "inspecting", "obtainingWorksheet", "confirmationReady"]);
  });

  it("CSV with more than one worksheet is still an honest obtainWorksheetFailed (unchanged)", async () => {
    const { session } = await driveFreshSession({ fileName: "d.csv", serverContentType: "csv", worksheets: [worksheetDTO(0), worksheetDTO(1)] });
    expect(session.getState()).toMatchObject({ phase: "obtainWorksheetFailed", message: "Expected exactly one CSV worksheet, found 2." });
  });

  it("XLSX multi-sheet -> worksheetInventoryReady with every worksheet ordered by index; never a confirmable/preview phase; no preview/confirm request", async () => {
    const shuffled = [worksheetDTO(2, { canonicalStatus: "INELIGIBLE", worksheetVisibility: "hidden" }), worksheetDTO(0), worksheetDTO(1, { worksheetIsEmpty: true, canonicalStatus: "INELIGIBLE" })];
    const { session, phases, calls } = await driveFreshSession({ fileName: "workbook.xlsx", serverContentType: "xlsx", worksheets: shuffled });
    const state = session.getState();
    expect(state.phase).toBe("worksheetInventoryReady");
    if (state.phase !== "worksheetInventoryReady") throw new Error("unreachable");
    expect(state.worksheets.map((w) => w.worksheetIndex)).toEqual([0, 1, 2]);
    expect(state.worksheets.map((w) => w.id)).toEqual(["ws-0", "ws-1", "ws-2"]);
    for (const p of FORBIDDEN_FOR_INVENTORY) expect(phases).not.toContain(p);
    expect(calls.some((c) => /\/preview|\/confirm-illegal-dumping|\/mapping-selection|\/period-/.test(c))).toBe(false);
  });

  it("XLSX single-sheet workbook is NOT auto-picked — still the inventory, never confirmationReady", async () => {
    const { session, phases } = await driveFreshSession({ fileName: "one.xlsx", serverContentType: "xlsx", worksheets: [worksheetDTO(0)] });
    expect(session.getState().phase).toBe("worksheetInventoryReady");
    expect(phases).not.toContain("confirmationReady");
  });

  it("dispatch follows the SERVER contentType, never the File name (csv-named file classified xlsx -> inventory; xlsx-named classified csv -> confirmationReady)", async () => {
    const a = await driveFreshSession({ fileName: "spoof.csv", serverContentType: "xlsx", worksheets: [worksheetDTO(0)] });
    expect(a.session.getState().phase).toBe("worksheetInventoryReady");
    const b = await driveFreshSession({ fileName: "spoof.xlsx", serverContentType: "csv", worksheets: [worksheetDTO(0)] });
    expect(b.session.getState().phase).toBe("confirmationReady");
  });

  it("eligible selection enters XLSX-only preview state; back restores inventory; confirm remains blocked", async () => {
    const worksheets = [worksheetDTO(0), worksheetDTO(2)];
    const { createIllegalDumpingImportSession } = await freshSessionModule();
    const { fetchImpl, calls } = routedFetch({
      batch: batchDetail("xlsx"), worksheets,
      preview: { ok: true, preview: { worksheetId: "ws-2", worksheetName: "Sheet 2", worksheetIndex: 2, rowCount: 1, columnCount: 1, headers: ["a"], sampleRows: [["b"]], sampleRowCount: 1, truncated: false } },
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("batch-1");
    const pending = session.previewXlsxWorksheet("ws-2");
    expect(session.getState().phase).toBe("xlsxWorksheetPreviewing");
    await pending;
    expect(session.getState().phase).toBe("xlsxWorksheetPreviewReady");
    await expect(session.confirm()).rejects.toThrow(/unexpected phase/);
    session.backToWorksheetInventory();
    const state = session.getState();
    expect(state.phase).toBe("worksheetInventoryReady");
    if (state.phase === "worksheetInventoryReady") expect(state.worksheets.map((w) => w.id)).toEqual(["ws-0", "ws-2"]);
    expect(calls.filter((call) => call.endsWith("/preview"))).toEqual(["GET /api/data-hub/worksheets/ws-2/preview"]);
  });

  it("back during an in-flight preview invalidates its late completion", async () => {
    let resolvePreview!: (response: Response) => void;
    const deferred = new Promise<Response>((resolve) => { resolvePreview = resolve; });
    const worksheets = [worksheetDTO(0)];
    const { createIllegalDumpingImportSession } = await freshSessionModule();
    const { fetchImpl } = routedFetch({ batch: batchDetail("xlsx"), worksheets, preview: () => deferred });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("batch-1");
    const pending = session.previewXlsxWorksheet("ws-0");
    expect(session.getState().phase).toBe("xlsxWorksheetPreviewing");
    session.backToWorksheetInventory();
    resolvePreview(jsonResponse(200, { ok: true, preview: { worksheetId: "ws-0", worksheetName: "Sheet 0", worksheetIndex: 0, rowCount: 1, columnCount: 1, headers: ["a"], sampleRows: [["late"]], sampleRowCount: 1, truncated: false } }));
    await pending;
    expect(session.getState().phase).toBe("worksheetInventoryReady");
  });

  it("a newer preview selection supersedes an older deferred request", async () => {
    const resolvers = new Map<string, (response: Response) => void>();
    const worksheets = [worksheetDTO(0), worksheetDTO(1)];
    const { createIllegalDumpingImportSession } = await freshSessionModule();
    const { fetchImpl } = routedFetch({
      batch: batchDetail("xlsx"),
      worksheets,
      preview: (url: string) => new Promise<Response>((resolve) => { resolvers.set(url, resolve); }),
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("batch-1");
    const older = session.previewXlsxWorksheet("ws-0");
    const newer = session.previewXlsxWorksheet("ws-1");
    resolvers.get("/api/data-hub/worksheets/ws-1/preview")!(jsonResponse(200, { ok: true, preview: { worksheetId: "ws-1", worksheetName: "Sheet 1", worksheetIndex: 1, rowCount: 1, columnCount: 1, headers: ["new"], sampleRows: [["winner"]], sampleRowCount: 1, truncated: false } }));
    await newer;
    expect(session.getState()).toMatchObject({ phase: "xlsxWorksheetPreviewReady", worksheet: { id: "ws-1" } });
    resolvers.get("/api/data-hub/worksheets/ws-0/preview")!(jsonResponse(500, { ok: false, code: "PROVIDER_FAILURE", error: "late failure" }));
    await older;
    expect(session.getState()).toMatchObject({ phase: "xlsxWorksheetPreviewReady", worksheet: { id: "ws-1" } });
  });

  it("dispose during an in-flight preview suppresses its late completion", async () => {
    let resolvePreview!: (response: Response) => void;
    const deferred = new Promise<Response>((resolve) => { resolvePreview = resolve; });
    const worksheets = [worksheetDTO(0)];
    const { createIllegalDumpingImportSession } = await freshSessionModule();
    const { fetchImpl } = routedFetch({ batch: batchDetail("xlsx"), worksheets, preview: () => deferred });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("batch-1");
    const pending = session.previewXlsxWorksheet("ws-0");
    session.dispose();
    resolvePreview(jsonResponse(200, { ok: true, preview: { worksheetId: "ws-0", worksheetName: "Sheet 0", worksheetIndex: 0, rowCount: 1, columnCount: 1, headers: ["a"], sampleRows: [["late"]], sampleRowCount: 1, truncated: false } }));
    await pending;
    expect(session.getState().phase).toBe("xlsxWorksheetPreviewing");
  });

  it("rejects a worksheet id outside the inventory without a request", async () => {
    const { session, calls } = await driveFreshSession({ fileName: "one.xlsx", serverContentType: "xlsx", worksheets: [worksheetDTO(0)] });
    const before = calls.length;
    await expect(session.previewXlsxWorksheet("foreign")).rejects.toThrow(/does not belong/);
    expect(calls).toHaveLength(before);
  });

  // ─── D2 — selection / retry / race / confirm-block hardening ───────────
  const xlsxPreviewBody = (id: string, cell = "v") => ({
    ok: true,
    preview: { worksheetId: id, worksheetName: `Sheet ${id.slice(3)}`, worksheetIndex: Number(id.slice(3)), rowCount: 1, columnCount: 1, headers: ["h"], sampleRows: [[cell]], sampleRowCount: 1, truncated: false },
  });

  it("D2-29. hidden / veryHidden / empty / INELIGIBLE / SKIPPED / IMPORTED selections throw with no request", async () => {
    const worksheets = [
      worksheetDTO(0, { worksheetVisibility: "hidden" }),
      worksheetDTO(1, { worksheetVisibility: "veryHidden" }),
      worksheetDTO(2, { worksheetIsEmpty: true }),
      worksheetDTO(3, { canonicalStatus: "INELIGIBLE" }),
      worksheetDTO(4, { canonicalStatus: "SKIPPED" }),
      worksheetDTO(5, { canonicalStatus: "IMPORTED" }),
    ];
    const { session, calls } = await driveFreshSession({ fileName: "w.xlsx", serverContentType: "xlsx", worksheets });
    const before = calls.length;
    for (const w of worksheets) await expect(session.previewXlsxWorksheet(w.id)).rejects.toThrow(/not eligible/);
    expect(calls).toHaveLength(before);
    expect(session.getState().phase).toBe("worksheetInventoryReady");
  });

  it("D2-30/31. no auto-preview; a single-sheet workbook needs an explicit selection, which sends exactly one GET", async () => {
    const { createIllegalDumpingImportSession } = await freshSessionModule();
    const { fetchImpl, calls } = routedFetch({ batch: batchDetail("xlsx"), worksheets: [worksheetDTO(0)], preview: xlsxPreviewBody("ws-0") });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("batch-1");
    expect(session.getState().phase).toBe("worksheetInventoryReady");
    expect(calls.some((c) => c.endsWith("/preview"))).toBe(false);
    await session.previewXlsxWorksheet("ws-0");
    expect(session.getState().phase).toBe("xlsxWorksheetPreviewReady");
    expect(calls.filter((c) => c.endsWith("/preview"))).toEqual(["GET /api/data-hub/worksheets/ws-0/preview"]);
  });

  it("D2-33. Retry re-requests the SAME worksheet after a failure; retry is refused outside the failed state", async () => {
    let attempt = 0;
    const { createIllegalDumpingImportSession } = await freshSessionModule();
    const { fetchImpl, calls } = routedFetch({
      batch: batchDetail("xlsx"),
      worksheets: [worksheetDTO(0), worksheetDTO(1)],
      preview: async () => (++attempt === 1 ? jsonResponse(500, { ok: false, code: "PROVIDER_FAILURE", error: "Storage failed." }) : jsonResponse(200, xlsxPreviewBody("ws-1"))),
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("batch-1");
    await session.previewXlsxWorksheet("ws-1");
    expect(session.getState()).toMatchObject({ phase: "xlsxWorksheetPreviewFailed", code: "PROVIDER_FAILURE", worksheet: { id: "ws-1" } });
    await session.retryXlsxWorksheetPreview();
    expect(session.getState()).toMatchObject({ phase: "xlsxWorksheetPreviewReady", worksheet: { id: "ws-1" } });
    expect(calls.filter((c) => c.endsWith("/preview"))).toEqual(["GET /api/data-hub/worksheets/ws-1/preview", "GET /api/data-hub/worksheets/ws-1/preview"]);
    await expect(session.retryXlsxWorksheetPreview()).rejects.toThrow(/unexpected phase/);
  });

  it("D2-32. Back from Ready and from Failed restores the identical verified inventory with no request", async () => {
    const worksheets = [worksheetDTO(0), worksheetDTO(1)];
    const { createIllegalDumpingImportSession } = await freshSessionModule();
    let ok = true;
    const { fetchImpl, calls } = routedFetch({
      batch: batchDetail("xlsx"), worksheets,
      preview: async () => (ok ? jsonResponse(200, xlsxPreviewBody("ws-0")) : jsonResponse(409, { ok: false, code: "WORKSHEET_NOT_ELIGIBLE", error: "Not eligible." })),
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("batch-1");
    const inventory = session.getState();
    for (const outcome of [true, false]) {
      ok = outcome;
      await session.previewXlsxWorksheet("ws-0");
      const before = calls.length;
      session.backToWorksheetInventory();
      expect(calls).toHaveLength(before);
      const restored = session.getState();
      expect(restored.phase).toBe("worksheetInventoryReady");
      if (restored.phase === "worksheetInventoryReady" && inventory.phase === "worksheetInventoryReady") {
        expect(restored.batch).toBe(inventory.batch);
        expect(restored.worksheets).toBe(inventory.worksheets);
      }
    }
    expect(() => session.backToWorksheetInventory()).toThrow(/unexpected phase/);
  });

  it("D2-35. B selected while A in flight: A's late SUCCESS cannot overwrite B's pending or failed state", async () => {
    const resolvers = new Map<string, (response: Response) => void>();
    const { createIllegalDumpingImportSession } = await freshSessionModule();
    const { fetchImpl } = routedFetch({
      batch: batchDetail("xlsx"), worksheets: [worksheetDTO(0), worksheetDTO(1)],
      preview: (url: string) => new Promise<Response>((resolve) => { resolvers.set(url, resolve); }),
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("batch-1");
    const a = session.previewXlsxWorksheet("ws-0");
    const b = session.previewXlsxWorksheet("ws-1");
    resolvers.get("/api/data-hub/worksheets/ws-0/preview")!(jsonResponse(200, xlsxPreviewBody("ws-0", "STALE-A")));
    await a;
    expect(session.getState()).toMatchObject({ phase: "xlsxWorksheetPreviewing", worksheet: { id: "ws-1" } });
    resolvers.get("/api/data-hub/worksheets/ws-1/preview")!(jsonResponse(500, { ok: false, code: "PROVIDER_FAILURE", error: "failed" }));
    await b;
    expect(session.getState()).toMatchObject({ phase: "xlsxWorksheetPreviewFailed", worksheet: { id: "ws-1" } });
    expect(JSON.stringify(session.getState())).not.toContain("STALE-A");
  });

  it("D2-34. a late response after resume/refresh cannot overwrite the re-verified inventory", async () => {
    let resolvePreview!: (response: Response) => void;
    const { createIllegalDumpingImportSession } = await freshSessionModule();
    const { fetchImpl } = routedFetch({
      batch: batchDetail("xlsx"), worksheets: [worksheetDTO(0)],
      preview: () => new Promise<Response>((resolve) => { resolvePreview = resolve; }),
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("batch-1");
    const pending = session.previewXlsxWorksheet("ws-0");
    await session.resumeFromBatchId("batch-1");
    expect(session.getState().phase).toBe("worksheetInventoryReady");
    resolvePreview(jsonResponse(200, xlsxPreviewBody("ws-0", "LATE")));
    await pending;
    expect(session.getState().phase).toBe("worksheetInventoryReady");
  });

  it("D2-45. a response for a different worksheet, or a CSV/mapping-shaped body, fails closed", async () => {
    const { createIllegalDumpingImportSession } = await freshSessionModule();
    let body: unknown = xlsxPreviewBody("ws-1");
    const { fetchImpl } = routedFetch({ batch: batchDetail("xlsx"), worksheets: [worksheetDTO(0), worksheetDTO(1)], preview: async () => jsonResponse(200, body) });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("batch-1");
    await session.previewXlsxWorksheet("ws-0");
    expect(session.getState()).toMatchObject({ phase: "xlsxWorksheetPreviewFailed", worksheet: { id: "ws-0" } });
    body = { ok: true, preview: { ...xlsxPreviewBody("ws-0").preview, requiredHeadersPresent: true, missingRequiredHeaders: [], mapping: null } };
    await session.retryXlsxWorksheetPreview();
    expect(session.getState()).toMatchObject({ phase: "xlsxWorksheetPreviewFailed", worksheet: { id: "ws-0" } });
  });

  it("D2-37. from every XLSX preview state, confirm/CSV-preview/mapping/period methods throw and send nothing; never confirmationReady/confirming", async () => {
    const { createIllegalDumpingImportSession } = await freshSessionModule();
    let resolvePreview: ((r: Response) => void) | null = null;
    let mode: "ok" | "fail" | "hang" = "ok";
    const { fetchImpl, calls } = routedFetch({
      batch: batchDetail("xlsx"), worksheets: [worksheetDTO(0)],
      preview: () => mode === "hang"
        ? new Promise<Response>((resolve) => { resolvePreview = resolve; })
        : Promise.resolve(mode === "ok" ? jsonResponse(200, xlsxPreviewBody("ws-0")) : jsonResponse(500, { ok: false, code: "PROVIDER_FAILURE", error: "x" })),
    });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    const phases: string[] = [];
    session.subscribe((s) => phases.push(s.phase));
    await session.resumeFromBatchId("batch-1");
    for (const m of ["ok", "fail", "hang"] as const) {
      mode = m;
      if (session.getState().phase !== "worksheetInventoryReady") session.backToWorksheetInventory();
      const pending = session.previewXlsxWorksheet("ws-0");
      if (m !== "hang") await pending;
      const before = calls.length;
      await expect(session.confirm()).rejects.toThrow(/unexpected phase/);
      await expect(session.retryConfirm()).rejects.toThrow(/unexpected phase/);
      await expect(session.loadPreview()).rejects.toThrow(/unexpected phase/);
      await expect(session.retryPreview()).rejects.toThrow(/unexpected phase/);
      await expect(session.selectMapping("m-1")).rejects.toThrow(/unexpected phase/);
      await expect(session.selectPeriod("2026-06-01", "2026-06-30")).rejects.toThrow(/unexpected phase/);
      await expect(session.loadPeriodDetection()).rejects.toThrow(/unexpected phase/);
      await expect(session.acceptDetectedPeriod()).rejects.toThrow(/unexpected phase/);
      expect(calls).toHaveLength(before);
    }
    (resolvePreview as ((r: Response) => void) | null)?.(jsonResponse(200, xlsxPreviewBody("ws-0")));
    for (const p of FORBIDDEN_FOR_INVENTORY) expect(phases).not.toContain(p);
    expect(calls.some((c) => /\/confirm-illegal-dumping|\/mapping-selection|\/period-|PUT |PATCH |DELETE /.test(c))).toBe(false);
  });

  it("every confirm/preview/mapping/period method throws from worksheetInventoryReady and sends nothing", async () => {
    const { session, calls } = await driveFreshSession({ fileName: "workbook.xlsx", serverContentType: "xlsx", worksheets: [worksheetDTO(0), worksheetDTO(1)] });
    const before = calls.length;
    await expect(session.confirm()).rejects.toThrow(/unexpected phase "worksheetInventoryReady"/);
    await expect(session.loadPreview()).rejects.toThrow(/unexpected phase/);
    await expect(session.retryPreview()).rejects.toThrow(/unexpected phase/);
    await expect(session.retryConfirm()).rejects.toThrow(/unexpected phase/);
    await expect(session.selectMapping("m-1")).rejects.toThrow(/unexpected phase/);
    await expect(session.selectPeriod("2026-06-01", "2026-06-30")).rejects.toThrow(/unexpected phase/);
    await expect(session.loadPeriodDetection()).rejects.toThrow(/unexpected phase/);
    await expect(session.acceptDetectedPeriod()).rejects.toThrow(/unexpected phase/);
    expect(calls.length).toBe(before);
    expect(session.getState().phase).toBe("worksheetInventoryReady");
  });

  it("inventory after a successful inspect with ZERO listed worksheets is an honest failure, never an empty inventory", async () => {
    const { session } = await driveFreshSession({ fileName: "workbook.xlsx", serverContentType: "xlsx", worksheets: [] });
    expect(session.getState()).toMatchObject({ phase: "obtainWorksheetFailed" });
  });
});

describe("D1 orchestrator — defense in depth: confirm()/loadPreview() refuse a non-CSV batch even from a review phase", () => {
  it("source guard exists in both methods, placed before any state change or request", () => {
    const src = stripComments(read("lib/data-hub/client/orchestrator.ts"));
    for (const method of ["confirm", "loadPreview"]) {
      const start = src.indexOf(`async ${method}(): Promise<void> {`);
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf("\n  }\n", start));
      const guardIdx = body.indexOf(`this.assertCsvBatch(batch, "${method}")`);
      expect(guardIdx).toBeGreaterThan(-1);
      const firstEffect = Math.min(
        ...[body.indexOf("this.setState("), body.indexOf("this.runLoadPreview(")].filter((i) => i > -1)
      );
      expect(guardIdx).toBeLessThan(firstEffect);
    }
  });
});

describe("D1 orchestrator — resume / refresh recovery (test 18)", () => {
  async function resume(contentType: string, worksheets: unknown[] | (() => unknown[]), inspect?: unknown) {
    const { createIllegalDumpingImportSession } = await freshSessionModule();
    const { fetchImpl, calls } = routedFetch({ batch: batchDetail(contentType), worksheets, inspect });
    const session = createIllegalDumpingImportSession({ fetchImpl });
    const phases: string[] = [];
    session.subscribe((s) => phases.push(s.phase));
    await session.resumeFromBatchId("batch-1");
    return { session, phases, calls };
  }

  // (A) exact persisted set: re-verified through the server's idempotent
  // inspect (exact-set Case B, zero writes — proven server-side in section
  // B above), then listed and cross-checked -> the full ordered inventory.
  it("A. READY XLSX with 14 persisted worksheets is RE-VERIFIED (inspect), then restores the full ordered inventory", async () => {
    const persisted = ONKAPARINGA_SHEET_NAMES.map((name, i) => worksheetDTO(i, { worksheetName: name }));
    const { session, calls, phases } = await resume("xlsx", persisted);
    const state = session.getState();
    expect(state.phase).toBe("worksheetInventoryReady");
    if (state.phase !== "worksheetInventoryReady") throw new Error("unreachable");
    expect(state.worksheets.map((w) => w.worksheetName)).toEqual(ONKAPARINGA_SHEET_NAMES);
    expect(state.worksheets.map((w) => w.worksheetIndex)).toEqual(ONKAPARINGA_SHEET_NAMES.map((_, i) => i));
    expect(calls).toEqual([
      "GET /api/data-hub/import-batches/batch-1",
      "GET /api/data-hub/import-batches/batch-1/worksheets",
      "POST /api/data-hub/import-batches/batch-1/inspect",
      "GET /api/data-hub/import-batches/batch-1/worksheets",
    ]);
    for (const p of FORBIDDEN_FOR_INVENTORY) expect(phases).not.toContain(p);
  });

  // (B) partial persisted set: the server's exact-set policy returns
  // PERSISTENCE_CONFLICT; the partial list is never shown as an inventory.
  it("B. READY XLSX with a PARTIAL persisted set -> server PERSISTENCE_CONFLICT -> inspectFailed, never an inventory", async () => {
    const partial = [worksheetDTO(0), worksheetDTO(1)];
    const { session, phases, calls } = await resume("xlsx", partial, {
      ok: false,
      error: "The worksheet records for this batch do not match the file.",
      code: "PERSISTENCE_CONFLICT",
    });
    expect(session.getState()).toMatchObject({ phase: "inspectFailed", code: "PERSISTENCE_CONFLICT" });
    expect(phases).not.toContain("worksheetInventoryReady");
    for (const p of FORBIDDEN_FOR_INVENTORY) expect(phases).not.toContain(p);
    // Only ONE worksheet list (the recovery probe) — the partial set is never
    // re-listed into an inventory after the failed verification.
    expect(calls.filter((c) => c.endsWith("/worksheets"))).toHaveLength(1);
  });

  // (C) divergent persisted descriptor vs the freshly-verified set (e.g. a
  // row changed between verification and listing) -> honest failure.
  it("C. READY XLSX whose listed rows DIVERGE from the verified descriptors -> obtainWorksheetFailed, never an inventory", async () => {
    const listed = [worksheetDTO(0), worksheetDTO(1, { worksheetVisibility: "hidden", canonicalStatus: "INELIGIBLE" })];
    for (const verified of [
      [descriptorOf(worksheetDTO(0)), descriptorOf(worksheetDTO(1))], // status/visibility diverge
      [descriptorOf(worksheetDTO(0))], // count diverges
      [descriptorOf(worksheetDTO(0)), descriptorOf(worksheetDTO(2, { worksheetVisibility: "hidden", canonicalStatus: "INELIGIBLE" }))], // index diverges
      [descriptorOf(worksheetDTO(0)), { ...descriptorOf(listed[1]), worksheetName: "Renamed" }], // name diverges
    ]) {
      const { session, phases } = await resume("xlsx", listed, { ok: true, worksheets: verified });
      expect(session.getState()).toMatchObject({ phase: "obtainWorksheetFailed" });
      expect(phases).not.toContain("worksheetInventoryReady");
    }
  });

  it("A'. READY XLSX with a single AWAITING_CONFIRMATION worksheet resumes (re-verified) to the inventory, never confirmationReady", async () => {
    const { session, phases } = await resume("xlsx", [worksheetDTO(0)]);
    expect(session.getState().phase).toBe("worksheetInventoryReady");
    expect(phases).not.toContain("confirmationReady");
  });

  it("READY XLSX not yet inspected -> existing inspect chain -> inventory", async () => {
    let listCount = 0;
    const listed = [worksheetDTO(0), worksheetDTO(1)];
    const { session, calls } = await resume("xlsx", () => (listCount++ === 0 ? [] : listed), { ok: true, worksheets: listed.map(descriptorOf) });
    expect(session.getState().phase).toBe("worksheetInventoryReady");
    expect(calls.filter((c) => c.endsWith("/inspect"))).toHaveLength(1);
  });

  // (D) repeated resume = repeated idempotent verification; the client
  // itself never sends a write-shaped request of any kind.
  it("D. repeated XLSX resume only ever re-sends the idempotent inspect — no other POST/PUT/PATCH/DELETE", async () => {
    const persisted = [worksheetDTO(0), worksheetDTO(1)];
    for (let i = 0; i < 3; i++) {
      const { session, calls } = await resume("xlsx", persisted);
      expect(session.getState().phase).toBe("worksheetInventoryReady");
      expect(calls.filter((c) => !c.startsWith("GET ") && !c.endsWith("/inspect"))).toEqual([]);
    }
  });

  it("retryObtainWorksheet() on an XLSX batch re-verifies via inspect first (never lists-and-trusts)", async () => {
    const listed = [worksheetDTO(0), worksheetDTO(1)];
    const { session, calls } = await resume("xlsx", listed, { ok: true, worksheets: [descriptorOf(listed[0])] });
    expect(session.getState()).toMatchObject({ phase: "obtainWorksheetFailed" });
    const before = calls.length;
    await session.retryObtainWorksheet();
    expect(calls.slice(before)).toEqual([
      "POST /api/data-hub/import-batches/batch-1/inspect",
      "GET /api/data-hub/import-batches/batch-1/worksheets",
    ]);
  });

  // (E) CSV recovery is unchanged — and never re-inspects.
  it("E. CSV resume behaviour is unchanged (AWAITING_CONFIRMATION -> confirmationReady; INELIGIBLE -> worksheetTerminal), no inspect call", async () => {
    const a = await resume("csv", [worksheetDTO(0)]);
    expect(a.session.getState().phase).toBe("confirmationReady");
    expect(a.calls.filter((c) => c.endsWith("/inspect"))).toHaveLength(0);
    const b = await resume("csv", [worksheetDTO(0, { canonicalStatus: "INELIGIBLE" })]);
    expect(b.session.getState().phase).toBe("worksheetTerminal");
    expect(b.calls.filter((c) => c.endsWith("/inspect"))).toHaveLength(0);
  });
});

// ─── F. UI (test 15) ────────────────────────────────────────────────────

describe("D1 UI — WorksheetInventoryPanel renders structural fields only and no Confirm", () => {
  async function render(worksheets: unknown[]) {
    const { default: WorksheetInventoryPanel } = await import("@/app/data-hub/import/_components/WorksheetInventoryPanel");
    const state = {
      phase: "worksheetInventoryReady" as const,
      batch: { id: "batch-1", status: "READY" as const, originalFilename: "workbook.xlsx", contentType: "xlsx", sizeBytes: 8, sourceSystemId: "ss-1" },
      worksheets: worksheets as never,
    };
    return renderToStaticMarkup(createElement(WorksheetInventoryPanel, { state, onPreview: () => {}, onCompareSchema: () => {}, onRestart: () => {} }));
  }

  it("shows name, index, visibility, emptiness and status for every worksheet, plus the not-enabled notice", async () => {
    const html = await render([
      worksheetDTO(0, { worksheetName: "Overview" }),
      worksheetDTO(1, { worksheetName: "Secret Tab", worksheetVisibility: "hidden", canonicalStatus: "INELIGIBLE" }),
      worksheetDTO(2, { worksheetName: "Deep", worksheetVisibility: "veryHidden", canonicalStatus: "INELIGIBLE" }),
      worksheetDTO(3, { worksheetName: "Blank", worksheetIsEmpty: true, canonicalStatus: "INELIGIBLE" }),
    ]);
    for (const s of ["Overview", "Secret Tab", "Deep", "Blank", "Visible", "Hidden", "Very hidden", "Empty", "Has content", "Not importable", "Awaiting confirmation (import not enabled)", "Excel worksheet preview is available"]) {
      expect(html).toContain(s);
    }
    expect(html).toMatch(/data-worksheet-index="3"/);
    expect(html).toMatch(/<tr data-worksheet-index="1" data-canonical-status="INELIGIBLE">/);
  });

  it("renders Preview only for eligible worksheets, plus Choose another file and no Confirm/Import affordance", async () => {
    const html = await render([
      worksheetDTO(0),
      worksheetDTO(1, { worksheetVisibility: "hidden", canonicalStatus: "INELIGIBLE" }),
      worksheetDTO(2, { worksheetVisibility: "veryHidden", canonicalStatus: "INELIGIBLE" }),
      worksheetDTO(3, { worksheetIsEmpty: true, canonicalStatus: "INELIGIBLE" }),
      worksheetDTO(4, { canonicalStatus: "SKIPPED" }),
    ]);
    expect((html.match(/>Preview<\/button>/g) ?? []).length).toBe(1);
    // 6.2D3C — plus the explicit read-only "Compare to governed schema".
    expect((html.match(/<button/g) ?? []).length).toBe(3);
    expect(html).toContain("Compare to governed schema");
    expect(html).toContain("Choose another file");
    expect(html).toContain("Preview");
    expect(html).not.toMatch(/Confirm import|>\s*Confirm\s*<|Import now|<input/i);
  });

  it("the component is never handed the session and never references confirm/preview/mapping/period APIs", () => {
    const code = stripComments(read("app/data-hub/import/_components/WorksheetInventoryPanel.tsx"));
    expect(code).not.toMatch(/session|confirm\(|loadPreview|selectMapping|selectPeriod|PeriodDetection|ConfirmAction|ReviewPanel/);
    for (const shell of ["app/data-hub/import/ImportClient.tsx", "app/data-hub/import/[batchId]/RecoveryClient.tsx"]) {
      const shellCode = stripComments(read(shell));
      const tag = shellCode.match(/<WorksheetInventoryPanel\b[\s\S]*?\/>/)?.[0] ?? "";
      expect(tag).not.toBe("");
      expect(tag).not.toMatch(/session=/);
    }
  });

  it("worksheetInventoryReady is its own screen group — never review/confirm, never an error overlay", async () => {
    const { deriveScreenGroup, isErrorOverlayPhase, deriveErrorOverlayCopy } = await import("@/app/data-hub/import/screenGroup");
    expect(deriveScreenGroup("worksheetInventoryReady")).toBe("inventory");
    expect(isErrorOverlayPhase("worksheetInventoryReady")).toBe(false);
    expect(deriveErrorOverlayCopy({ phase: "worksheetInventoryReady", batch: {} as never, worksheets: [] })).toBeNull();
    // confirmationReady etc. are unaffected.
    expect(deriveScreenGroup("confirmationReady")).toBe("review");
  });
});

describe("D2 UI — inert XLSX preview panel", () => {
  it("renders cached formula values as escaped text and exposes only back/restart", async () => {
    const { default: Panel } = await import("@/app/data-hub/import/_components/XlsxWorksheetPreviewPanel");
    const state = {
      phase: "xlsxWorksheetPreviewReady" as const,
      batch: { id: "batch-1", status: "READY" as const, originalFilename: "workbook.xlsx", contentType: "xlsx", sizeBytes: 8, sourceSystemId: "ss-1" },
      worksheets: [worksheetDTO(0)],
      worksheet: worksheetDTO(0),
      preview: { worksheetId: "ws-0", worksheetName: "Sheet 0", worksheetIndex: 0, rowCount: 1, columnCount: 1, headers: ["Formula"], sampleRows: [["<img src=x onerror=alert(1)>"]], sampleRowCount: 1, truncated: false },
    };
    const html = renderToStaticMarkup(createElement(Panel, { state: state as never, onBack: () => {}, onRetry: () => {}, onRestart: () => {} }));
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain("Back to workbook worksheets");
    expect(html).toContain("Choose another file");
    expect(html).not.toMatch(/>\s*Confirm(?: import)?\s*<|mapping|reporting period|<input/i);
  });

  it("receives no session/confirm/mapping/period callback and uses no unsafe HTML or browser persistence", () => {
    const code = stripComments(read("app/data-hub/import/_components/XlsxWorksheetPreviewPanel.tsx"));
    const props = code.match(/export default function XlsxWorksheetPreviewPanel\(\{[\s\S]*?\}: \{[\s\S]*?\n\}\)/)?.[0] ?? "";
    expect(props).not.toBe("");
    expect(props).not.toMatch(/session|confirm|mapping|period/i);
    expect(code).not.toMatch(/dangerouslySetInnerHTML|localStorage|sessionStorage/);
  });

  it("both shells hand the panel state + back/retry/restart callbacks only — never the session", () => {
    for (const shell of ["app/data-hub/import/ImportClient.tsx", "app/data-hub/import/[batchId]/RecoveryClient.tsx"]) {
      const tag = stripComments(read(shell)).match(/<XlsxWorksheetPreviewPanel\b[\s\S]*?\/>/)?.[0] ?? "";
      expect(tag).not.toBe("");
      expect(tag).not.toMatch(/session=|confirm|mapping|period/i);
      expect(tag).toMatch(/onBack=\{\(\) => session\.backToWorksheetInventory\(\)\}/);
      expect(tag).toMatch(/onRetry=\{\(\) => void session\.retryXlsxWorksheetPreview\(\)\}/);
    }
  });

  it("the XLSX preview phases are their own screen group — never review/confirm, never an error overlay", async () => {
    const { deriveScreenGroup, isErrorOverlayPhase } = await import("@/app/data-hub/import/screenGroup");
    for (const phase of ["xlsxWorksheetPreviewing", "xlsxWorksheetPreviewReady", "xlsxWorksheetPreviewFailed"] as const) {
      expect(deriveScreenGroup(phase)).toBe("xlsxPreview");
      expect(isErrorOverlayPhase(phase)).toBe(false);
    }
  });

  it("renders loading and failure states with Retry but no Confirm/mapping/period", async () => {
    const { default: Panel } = await import("@/app/data-hub/import/_components/XlsxWorksheetPreviewPanel");
    const base = { batch: { id: "batch-1", status: "READY" as const, originalFilename: "w.xlsx", contentType: "xlsx", sizeBytes: 8, sourceSystemId: "ss-1" }, worksheets: [worksheetDTO(0)], worksheet: worksheetDTO(0) };
    const loading = renderToStaticMarkup(createElement(Panel, { state: { ...base, phase: "xlsxWorksheetPreviewing" } as never, onBack: () => {}, onRetry: () => {}, onRestart: () => {} }));
    expect(loading).toContain("Loading worksheet preview");
    expect(loading).not.toContain(">Retry<");
    const failed = renderToStaticMarkup(createElement(Panel, { state: { ...base, phase: "xlsxWorksheetPreviewFailed", code: "PROVIDER_FAILURE", message: "Storage failed." } as never, onBack: () => {}, onRetry: () => {}, onRestart: () => {} }));
    expect(failed).toContain("Storage failed.");
    expect(failed).toContain(">Retry<");
    for (const html of [loading, failed]) expect(html).not.toMatch(/>\s*Confirm(?: import)?\s*<|mapping|reporting period|<input|<select/i);
  });
});

// ─── G. Picker + browser boundary (tests 1, 2) ─────────────────────────

describe("D1 picker — .csv and .xlsx only; .xls stays hidden", () => {
  it("accept string and advisory checks", async () => {
    const { FILE_INPUT_ACCEPT, validateSelectedFile } = await import("@/app/data-hub/import/fileValidation");
    const accept = FILE_INPUT_ACCEPT.toLowerCase().split(",");
    expect(accept).toContain(".csv");
    expect(accept).toContain(".xlsx");
    expect(accept).not.toContain(".xls");
    expect(FILE_INPUT_ACCEPT).not.toMatch(/\.xls(?!x)|ms-excel/i);
    expect(validateSelectedFile(new File(["x"], "w.xlsx")).ok).toBe(true);
    expect(validateSelectedFile(new File(["x"], "w.csv")).ok).toBe(true);
    expect(validateSelectedFile(new File(["x"], "w.xls")).ok).toBe(false);
    expect(validateSelectedFile(new File(["x"], "w.pdf")).ok).toBe(false);
  });

  it("no browser module (app/data-hub/import/**, lib/data-hub/client/**) imports xlsx/SheetJS/workbookParser or reads file content", () => {
    const files = [...walk(path.join(ROOT, "app", "data-hub", "import"), [".ts", ".tsx"]), ...walk(path.join(ROOT, "lib", "data-hub", "client"), [".ts"])];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      expect(code, file).not.toMatch(/from\s+["']xlsx["']|require\(["']xlsx["']\)|workbookParser|workbookArchiveGuard/);
      expect(code, file).not.toMatch(/data-hub\/importBatch\//);
    }
    const selector = read("app/data-hub/import/_components/FileSelector.tsx");
    expect(selector).not.toMatch(/\.arrayBuffer\(\)|FileReader|\.text\(\)/);
  });
});

// ─── H. Repo-wide containment (tests 19, 20, 22) ───────────────────────

describe("D1 containment — inspectWorksheets has exactly one runtime caller", () => {
  // Resolves every import/export-from specifier (alias "@/", relative, or
  // dynamic import()) to an absolute path, so relative sibling imports
  // inside lib/data-hub/importBatch/ are counted too.
  function importersOf(moduleName: string): string[] {
    const target = path.join(ROOT, "lib", "data-hub", "importBatch", moduleName);
    const files = ["app", "components", "lib"].flatMap((d) => walk(path.join(ROOT, d), [".ts", ".tsx"]));
    const middleware = path.join(ROOT, "middleware.ts");
    if (fs.existsSync(middleware)) files.push(middleware);
    const specifierRe = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
    return files
      .filter((f) => {
        if (path.join(path.dirname(f), path.basename(f, path.extname(f))) === target) return false;
        const code = stripComments(fs.readFileSync(f, "utf8"));
        for (const m of code.matchAll(specifierRe)) {
          const spec = m[1];
          const resolved = spec.startsWith("@/")
            ? path.join(ROOT, spec.slice(2))
            : spec.startsWith(".")
              ? path.resolve(path.dirname(f), spec)
              : null;
          if (resolved && resolved.replace(/\.(ts|tsx)$/, "") === target) return true;
        }
        return false;
      })
      .map((f) => path.relative(ROOT, f).replace(/\\/g, "/"))
      .sort();
  }

  it("inspectWorksheets.ts is imported ONLY by inspectImportBatch.ts", () => {
    expect(importersOf("inspectWorksheets")).toEqual(["lib/data-hub/importBatch/inspectImportBatch.ts"]);
  });

  it("inspectImportBatch.ts is imported ONLY by the inspect route", () => {
    expect(importersOf("inspectImportBatch")).toEqual(["app/api/data-hub/import-batches/[id]/inspect/route.ts"]);
  });

  it("inspectCsvWorksheet.ts is now reached only through the dispatcher", () => {
    expect(importersOf("inspectCsvWorksheet")).toEqual(["lib/data-hub/importBatch/inspectImportBatch.ts"]);
  });

  it("the dispatcher routes ONLY xlsx to inspectWorksheets, reads no request input, writes nothing, and touches no SourceSystem/reporting-period config", () => {
    const code = stripComments(read("lib/data-hub/importBatch/inspectImportBatch.ts"));
    // xlsx only, pinned by BOTH persisted content_type and persisted
    // filename classification, loaded lazily on that branch alone.
    expect(code).toMatch(
      /if \(batch\.content_type === "xlsx" && filenameClassifiesAsXlsx\(batch\.original_filename\)\) \{\s*const \{ inspectWorksheets \} = await import\("\.\/inspectWorksheets"\);\s*return inspectWorksheets\(/
    );
    expect(code).not.toMatch(/^import \{[^}]*\binspectWorksheets\b[^}]*\} from/m);
    expect((code.match(/inspectWorksheets\(/g) ?? []).length).toBe(1);
    expect((code.match(/inspectCsvWorksheet\(/g) ?? []).length).toBe(1);
    expect(code).not.toMatch(/"xls"/);
    expect(code).toMatch(/import \{ classifyFormat \} from "\.\.\/fileSignatures";/);
    expect(code).not.toMatch(/\.(update|updateMany|upsert|create|createMany|delete|deleteMany)\(/);
    expect(code).not.toMatch(/sourceSystem|reporting_period_required|reportingPeriodRequired/);
    expect(code).not.toMatch(/next\/server|requireRole|req\.|request/i);
  });

  it("the route reads no request body and calls the dispatcher exactly once with session-derived tenant", () => {
    const code = stripComments(read("app/api/data-hub/import-batches/[id]/inspect/route.ts"));
    expect(code).not.toMatch(/req\.json\(\)|_req\.json\(\)|searchParams|formData/);
    expect(code.match(/inspectImportBatch\(/g) ?? []).toHaveLength(1);
    expect(code).toMatch(/inspectImportBatch\(\{\s*organisationId:\s*session\.organisationId,\s*importBatchId:\s*id\s*\}\)/);
  });

  it("no D1 runtime file touches SourceSystem config, reporting_period_required, Prisma schema or migrations", () => {
    for (const rel of [
      "lib/data-hub/importBatch/inspectImportBatch.ts",
      "app/api/data-hub/import-batches/[id]/inspect/route.ts",
      "app/data-hub/import/_components/WorksheetInventoryPanel.tsx",
      "app/data-hub/import/worksheetInventoryCopy.ts",
    ]) {
      const code = stripComments(read(rel));
      expect(code, rel).not.toMatch(/reporting_period_required|sourceSystem\.(update|create|upsert)|\$executeRaw|ALTER TABLE|CREATE TABLE/);
    }
  });
});
