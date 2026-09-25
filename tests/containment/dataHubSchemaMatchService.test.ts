import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Data Hub 6.2D3C — read-only governed schema comparison: parser header
// reader, tenant-safe governed schema loader, service, route, client and UI
// containment. Every workbook is synthetic and built in-memory; the only
// "real" input is the committed D3B STRUCTURAL manifest (sheet names and
// literal headers — it contains no row values).

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const MANIFEST = JSON.parse(read("config/data-hub/onkaparinga-monthly-operations-v1.json"));
type ManifestSheet = { ordinal: number; logicalKey: string; name: string; headerRowOneBased: number | null; columns: { header: string; sensitivityClass: string }[] };
const SHEETS: ManifestSheet[] = MANIFEST.worksheets;

const SECRET_TITLE = "TITLE-ROW-SECRET";
const SECRET_VALUE = "PII-ROW-VALUE-SECRET";
const ORG = "org-1";
const SS = "ss-onk";

// ── Prisma / storage / auth mocks ─────────────────────────────────────────
const reads = {
  importBatchFindUnique: vi.fn(),
  uploadFindMany: vi.fn(),
  sourceSystemFindFirst: vi.fn(),
  datasetTypeFindFirst: vi.fn(),
  sourceSchemaVersionFindFirst: vi.fn(),
  sourceSchemaWorksheetFindMany: vi.fn(),
  sourceSchemaColumnFindMany: vi.fn(),
  profileVersionFindMany: vi.fn(),
};
const storageGet = vi.fn();
const requireRole = vi.fn();
const WRITE_METHODS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"] as const;
const writes: Record<string, ReturnType<typeof vi.fn>> = {};
function writeSurface(model: string) {
  return Object.fromEntries(
    WRITE_METHODS.map((m) => {
      const fn = vi.fn();
      writes[`${model}.${m}`] = fn;
      return [m, (...args: unknown[]) => fn(...args)];
    })
  );
}
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    importBatch: { ...writeSurface("importBatch"), findUnique: (...a: unknown[]) => reads.importBatchFindUnique(...a) },
    upload: { ...writeSurface("upload"), findMany: (...a: unknown[]) => reads.uploadFindMany(...a) },
    sourceSystem: { ...writeSurface("sourceSystem"), findFirst: (...a: unknown[]) => reads.sourceSystemFindFirst(...a) },
    datasetType: { ...writeSurface("datasetType"), findFirst: (...a: unknown[]) => reads.datasetTypeFindFirst(...a) },
    sourceSchemaVersion: { ...writeSurface("sourceSchemaVersion"), findFirst: (...a: unknown[]) => reads.sourceSchemaVersionFindFirst(...a) },
    sourceSchemaWorksheet: { ...writeSurface("sourceSchemaWorksheet"), findMany: (...a: unknown[]) => reads.sourceSchemaWorksheetFindMany(...a) },
    sourceSchemaColumn: { ...writeSurface("sourceSchemaColumn"), findMany: (...a: unknown[]) => reads.sourceSchemaColumnFindMany(...a) },
    worksheetMappingProfile: writeSurface("worksheetMappingProfile"),
    worksheetMappingProfileVersion: { ...writeSurface("worksheetMappingProfileVersion"), findMany: (...a: unknown[]) => reads.profileVersionFindMany(...a) },
    sourceMapping: writeSurface("sourceMapping"),
    mappingVersion: writeSurface("mappingVersion"),
    illegalDumping: writeSurface("illegalDumping"),
    auditLog: writeSurface("auditLog"),
    $transaction: (...a: unknown[]) => transaction(...a),
    $executeRaw: (...a: unknown[]) => transaction(...a),
    $queryRaw: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("@/lib/data-hub/importBatch/compositionRoot", () => ({
  createImportBatchStorage: () => ({ get: (...a: unknown[]) => storageGet(...a) }),
}));
vi.mock("@/lib/org", () => ({ requireRole: (...a: unknown[]) => requireRole(...a) }));

// ── Synthetic workbooks ───────────────────────────────────────────────────
type SheetSpec = { name: string; aoa: unknown[][]; hidden?: 0 | 1 | 2 };

function juneLikeSheets(edit: (name: string, headers: string[]) => string[] = (_n, h) => h): SheetSpec[] {
  return SHEETS.map((s) => ({
    name: s.name,
    aoa:
      s.columns.length === 0
        ? [["Trend chart placeholder"]]
        : [[`${SECRET_TITLE} ${s.name}`], ["Reporting period text"], edit(s.name, s.columns.map((c) => c.header)), s.columns.map((_, i) => `${SECRET_VALUE}-${i}`)],
  }));
}

function workbookBytes(sheets: SheetSpec[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.aoa), s.name);
  wb.Workbook = { Sheets: sheets.map((s) => ({ Hidden: s.hidden ?? 0 })) };
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

function descriptorsFor(sheets: SheetSpec[]) {
  return sheets.map((s, i) => ({
    worksheet_index: i,
    worksheet_name: s.name,
    worksheet_visibility: s.hidden === 1 ? "hidden" : s.hidden === 2 ? "veryHidden" : "visible",
    worksheet_is_empty: s.aoa.length === 0,
  }));
}

// ── Governed D3A/D3B rows (as the D3B seed inserts them) ──────────────────
function governedRows(org = ORG) {
  const worksheets = SHEETS.map((s) => ({
    id: `dhcfg-onk-mwco-ws-${s.logicalKey}`,
    organisation_id: org,
    source_schema_version_id: "dhcfg-onk-mwco-sv1",
    logical_key: s.logicalKey,
    expected_name: s.name,
    ordinal_hint: s.ordinal,
    presence: "OPTIONAL",
  }));
  const columns = SHEETS.flatMap((s) =>
    s.columns.map((c, ordinal) => ({ organisation_id: org, source_schema_worksheet_id: `dhcfg-onk-mwco-ws-${s.logicalKey}`, ordinal, source_header: c.header, presence: "OPTIONAL" }))
  );
  const profileVersions = SHEETS.map((s) => ({
    organisation_id: org,
    profile_document: { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: s.headerRowOneBased },
    profile: { organisation_id: org, source_schema_worksheet_id: `dhcfg-onk-mwco-ws-${s.logicalKey}` },
  }));
  return { worksheets, columns, profileVersions };
}

function arrange(sheets: SheetSpec[], opts: { bytes?: Buffer; batch?: Record<string, unknown>; descriptors?: unknown[] } = {}) {
  const bytes = opts.bytes ?? workbookBytes(sheets);
  reads.importBatchFindUnique.mockResolvedValue({
    status: "READY",
    deleted_at: null,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    content_type: "xlsx",
    original_filename: "june-2026.xlsx",
    source_system_id: SS,
    ...opts.batch,
  });
  reads.uploadFindMany.mockResolvedValue(opts.descriptors ?? descriptorsFor(sheets));
  reads.sourceSystemFindFirst.mockResolvedValue({ id: SS, organisation_id: ORG });
  reads.datasetTypeFindFirst.mockResolvedValue({ id: "dhcfg-onk-mwco-dt", organisation_id: ORG, source_system_id: SS, active: true });
  reads.sourceSchemaVersionFindFirst.mockResolvedValue({ id: "dhcfg-onk-mwco-sv1", organisation_id: ORG, dataset_type_id: "dhcfg-onk-mwco-dt", version_number: 1, status: "DRAFT" });
  const g = governedRows();
  reads.sourceSchemaWorksheetFindMany.mockResolvedValue(g.worksheets);
  reads.sourceSchemaColumnFindMany.mockResolvedValue(g.columns);
  reads.profileVersionFindMany.mockResolvedValue(g.profileVersions);
  storageGet.mockResolvedValue({ body: bytes });
  return bytes;
}

async function service() {
  return (await import("@/lib/data-hub/schemaMatch/matchImportBatchSchema")).matchImportBatchSchema;
}
async function runService(importBatchId = "batch-1", organisationId = ORG) {
  return (await service())({ organisationId, importBatchId });
}

function expectNoWrites() {
  for (const [name, fn] of Object.entries(writes)) expect(fn, name).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
}

beforeEach(() => {
  for (const fn of Object.values(reads)) fn.mockReset();
  for (const fn of Object.values(writes)) fn.mockReset();
  transaction.mockReset();
  storageGet.mockReset();
  requireRole.mockReset();
  requireRole.mockResolvedValue({ organisationId: ORG, userId: "user-1" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
describe("6.2D3C parser — readWorksheetHeaderRows (structural-only exact header row)", () => {
  async function parser() {
    return import("@/lib/data-hub/workbookParser");
  }

  it("returns EVERY column of the exact header row (no 50-column preview cap) and never a data row or title", async () => {
    const { readWorksheetHeaderRows } = await parser();
    const wide = Array.from({ length: 120 }, (_, i) => `H${i}`);
    const bytes = workbookBytes([{ name: "Wide", aoa: [[SECRET_TITLE], [], wide, wide.map(() => SECRET_VALUE)] }]);
    const r = await readWorksheetHeaderRows(bytes, { filename: "w.xlsx" }, [{ index: 0, headerRowOneBased: 3 }]);
    expect(r.worksheets[0]).toEqual({ index: 0, name: "Wide", visibility: "visible", outcome: { status: "ok", cells: wide } });
    expect(JSON.stringify(r)).not.toMatch(new RegExp(`${SECRET_TITLE}|${SECRET_VALUE}`));
  });

  it("bounds the SheetJS read to the requested sheets and to sheetRows = deepest header row; unrequested sheets never materialize", async () => {
    const { readWorksheetHeaderRows, xlsxAdapter } = await parser();
    const spy = vi.spyOn(xlsxAdapter, "read");
    const bytes = workbookBytes([{ name: "A", aoa: [["t"], ["t"], ["h"]] }, { name: "B", aoa: [[SECRET_VALUE]] }]);
    const r = await readWorksheetHeaderRows(bytes, { filename: "w.xlsx" }, [{ index: 0, headerRowOneBased: 3 }]);
    const cellRead = spy.mock.calls.find((c) => (c[1] as XLSX.ParsingOptions).sheets !== undefined)!;
    expect(cellRead[1]).toMatchObject({ sheets: [0], sheetRows: 3, cellHTML: false });
    expect(r.sheetNames).toEqual(["A", "B"]);
    expect(JSON.stringify(r)).not.toContain(SECRET_VALUE);
  });

  it("cell policy: exact text (no trim/case-fold); blank, empty-string, number, date, bool and over-long cells are null; trailing nulls dropped", async () => {
    const { readWorksheetHeaderRows } = await parser();
    const ws = XLSX.utils.aoa_to_sheet([[" Id ", "", 42, true, new Date(Date.UTC(2026, 0, 1)), "x".repeat(201), "ok", null, ""]], { cellDates: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "S");
    const bytes = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const r = await readWorksheetHeaderRows(bytes, { filename: "w.xlsx" }, [{ index: 0, headerRowOneBased: 1 }]);
    expect(r.worksheets[0].outcome).toEqual({ status: "ok", cells: [" Id ", null, null, null, null, null, "ok"] });
  });

  it("formula header cells: cached string only, formula text never returned or evaluated", async () => {
    const { readWorksheetHeaderRows } = await parser();
    const ws = XLSX.utils.aoa_to_sheet([["a", "b"]]);
    ws.A1 = { t: "s", f: 'CONCAT("x","y")', v: "Cached" };
    ws.B1 = { t: "n", f: "1+1", v: 2 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "S");
    const r = await readWorksheetHeaderRows(Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })), { filename: "w.xlsx" }, [{ index: 0, headerRowOneBased: 1 }]);
    expect(r.worksheets[0].outcome).toEqual({ status: "ok", cells: ["Cached"] });
    expect(JSON.stringify(r)).not.toMatch(/CONCAT|1\+1/);
  });

  it("row absent (sheet shorter than header row, or header row blank) is a per-sheet outcome", async () => {
    const { readWorksheetHeaderRows } = await parser();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["only"]]), "Short");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["t"], [], [], ["x"]]), "BlankRow");
    const bytes = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const r = await readWorksheetHeaderRows(bytes, { filename: "w.xlsx" }, [0, 1].map((index) => ({ index, headerRowOneBased: 3 })));
    expect(r.worksheets.map((w) => w.outcome.status)).toEqual(["rowAbsent", "rowAbsent"]);
  });

  it("review F3: width comes from parsed header-row cells, never the <dimension> tag (under/overstated); ordinals are absolute", async () => {
    const { readWorksheetHeaderRows } = await parser();
    // Understated <dimension>: SheetJS's writer drops cells outside !ref, so
    // patch the real sheet XML (C3/D3 stay present) and re-zip with the
    // CFB utility bundled in xlsx.
    const underWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(underWb, XLSX.utils.aoa_to_sheet([["t"], [], ["A", "B", "C", "D"]]), "Under");
    const cfb = XLSX.CFB.read(XLSX.write(underWb, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
    const entry = XLSX.CFB.find(cfb, "/xl/worksheets/sheet1.xml")!;
    const xml = Buffer.from(entry.content as Uint8Array).toString("utf8");
    expect(xml).toContain('<dimension ref="A1:D3"/>');
    entry.content = Buffer.from(xml.replace('<dimension ref="A1:D3"/>', '<dimension ref="A1:B3"/>'));
    const underBytes = Buffer.from(XLSX.CFB.write(cfb, { type: "buffer", fileType: "zip" }) as Uint8Array);
    const under = await readWorksheetHeaderRows(underBytes, { filename: "w.xlsx" }, [{ index: 0, headerRowOneBased: 3 }]);
    expect(under.worksheets[0].outcome).toEqual({ status: "ok", cells: ["A", "B", "C", "D"] });

    const over = XLSX.utils.aoa_to_sheet([["t"], [], ["A", "B"]]);
    over["!ref"] = "A1:ALN3"; // 1002 columns declared, 2 real
    const sparse = XLSX.utils.sheet_add_aoa(XLSX.utils.aoa_to_sheet([]), [["h1", "h2"]], { origin: "C3" }); // used range starts at C3
    const wide = XLSX.utils.aoa_to_sheet([[], [], Array.from({ length: 8 }, (_, i) => `W${i}`)]);
    const wb = XLSX.utils.book_new();
    for (const [n, ws] of [["Over", over], ["Sparse", sparse], ["Wide", wide]] as const) XLSX.utils.book_append_sheet(wb, ws, n);
    const bytes = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const r = await readWorksheetHeaderRows(bytes, { filename: "w.xlsx" }, [0, 1, 2].map((index) => ({ index, headerRowOneBased: 3 })), { limits: { maxSelectedWorksheetColumns: 5 } });
    expect(r.worksheets.map((w) => w.outcome)).toEqual([
      { status: "ok", cells: ["A", "B"] },
      { status: "ok", cells: [null, null, "h1", "h2"] },
      { status: "limitExceeded" },
    ]);
  });

  it("rejects CSV, bad requests and out-of-range indices; archive guard runs before SheetJS", async () => {
    const { readWorksheetHeaderRows, WorkbookParserError, xlsxAdapter } = await parser();
    await expect(readWorksheetHeaderRows(Buffer.from("a,b\n1,2"), { filename: "a.csv" }, [])).rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });
    const bytes = workbookBytes([{ name: "A", aoa: [["h"]] }]);
    await expect(readWorksheetHeaderRows(bytes, { filename: "w.xlsx" }, [{ index: 0, headerRowOneBased: 21 }])).rejects.toBeInstanceOf(RangeError);
    await expect(readWorksheetHeaderRows(bytes, { filename: "w.xlsx" }, [{ index: 0, headerRowOneBased: 1 }, { index: 0, headerRowOneBased: 1 }])).rejects.toBeInstanceOf(RangeError);
    await expect(readWorksheetHeaderRows(bytes, { filename: "w.xlsx" }, [{ index: 5, headerRowOneBased: 1 }])).rejects.toBeInstanceOf(WorkbookParserError);
    const spy = vi.spyOn(xlsxAdapter, "read");
    const comment = Buffer.from("c");
    const tampered = Buffer.concat([bytes, comment]);
    tampered.writeUInt16LE(comment.length, bytes.length - 2);
    await expect(readWorksheetHeaderRows(tampered, { filename: "w.xlsx" }, [{ index: 0, headerRowOneBased: 1 }])).rejects.toBeInstanceOf(WorkbookParserError);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("6.2D3C service — exact governed D3B state (14 sheets / 295 columns)", () => {
  it("a June-v1-shaped synthetic workbook (title rows, header row 3, data rows) => EXACT_MATCH, zero writes, no row/title values", async () => {
    arrange(juneLikeSheets());
    const r = await runService();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report).toMatchObject({
      result: "EXACT_MATCH",
      exactMatch: true,
      sourceSchemaVersionId: "dhcfg-onk-mwco-sv1",
      sourceSchemaVersionNumber: 1,
      sourceSchemaStatus: "DRAFT",
      governedWorksheetCount: 14,
      matchedWorksheetCount: 14,
      differences: [],
    });
    const json = JSON.stringify(r);
    expect(json).not.toContain(SECRET_TITLE);
    expect(json).not.toContain(SECRET_VALUE);
    expect(json).not.toContain("june-2026.xlsx");
    expect(json).not.toMatch(/user-1|\d{4}-\d{2}-\d{2}T/);
    expectNoWrites();
  });

  it("consumes all 14/295 governed rows via tenant-scoped reads resolved from the batch's OWN source system", async () => {
    arrange(juneLikeSheets());
    await runService();
    expect(reads.importBatchFindUnique.mock.calls[0][0].where).toEqual({ id_organisation_id: { id: "batch-1", organisation_id: ORG } });
    expect(reads.uploadFindMany.mock.calls[0][0].where).toEqual({ organisation_id: ORG, import_batch_id: "batch-1", lineage_kind: "DATA_HUB" });
    expect(reads.sourceSystemFindFirst.mock.calls[0][0].where).toEqual({ id: SS, organisation_id: ORG });
    expect(reads.datasetTypeFindFirst.mock.calls[0][0].where).toEqual({ organisation_id: ORG, source_system_id: SS, name: "Monthly waste and collection operations" });
    expect(reads.sourceSchemaVersionFindFirst.mock.calls[0][0].where).toEqual({ organisation_id: ORG, dataset_type_id: "dhcfg-onk-mwco-dt", version_number: 1 });
    expect(reads.sourceSchemaWorksheetFindMany.mock.calls[0][0].where).toEqual({ organisation_id: ORG, source_schema_version_id: "dhcfg-onk-mwco-sv1" });
    expect(reads.sourceSchemaColumnFindMany.mock.calls[0][0].where.organisation_id).toBe(ORG);
    expect(reads.sourceSchemaColumnFindMany.mock.calls[0][0].where.source_schema_worksheet_id.in).toHaveLength(14);
    expect(reads.profileVersionFindMany.mock.calls[0][0].where).toMatchObject({ organisation_id: ORG, version_number: 1, profile: { organisation_id: ORG } });
    expect(storageGet.mock.calls[0][0]).toContain(ORG);
    expect(storageGet.mock.calls[0][0]).toContain("batch-1");
  });

  it("loader returns the exact governed structure (DRAFT, 14 sheets, 295 columns, header row 3, Trends none)", async () => {
    arrange(juneLikeSheets());
    const { loadGovernedSchemaForSourceSystem } = await import("@/lib/data-hub/schemaMatch/governedSchema");
    const r = await loadGovernedSchemaForSourceSystem({ organisationId: ORG, sourceSystemId: SS });
    if (!r.ok) throw new Error("expected ok");
    expect(r.schema.status).toBe("DRAFT");
    expect(r.schema.worksheets.map((w) => w.expectedName)).toEqual(SHEETS.map((s) => s.name));
    expect(r.schema.worksheets.reduce((n, w) => n + w.columns.length, 0)).toBe(295);
    expect(r.schema.worksheets.find((w) => w.expectedName === "Trends")).toMatchObject({ columns: [], headerRowOneBased: null });
    expect(r.schema.worksheets.filter((w) => w.columns.length > 0).every((w) => w.headerRowOneBased === 3)).toBe(true);
    expectNoWrites();
  });
});

describe("6.2D3C service — drift through the real parser", () => {
  it("changed-schema synthetic workbook (renamed header, renamed sheet, extra hidden sheet) => structural drift warnings", async () => {
    const sheets = juneLikeSheets((name, h) => (name === "Runs" ? h.map((x) => (x === "Loads" ? "Load Count" : x)) : h));
    sheets.find((s) => s.name === "Vouchers")!.name = "Voucher";
    sheets.push({ name: "Hidden Lookup", aoa: [[SECRET_VALUE]], hidden: 1 });
    arrange(sheets);
    const r = await runService();
    if (!r.ok) throw new Error(`expected ok: ${r.code}`);
    expect(r.report.result).toBe("MATCH_WITH_NON_BLOCKING_DRIFT");
    expect(r.report.differences.map((d) => [d.code, d.governedWorksheetName ?? d.observedWorksheetName, d.governedHeader, d.observedHeader])).toEqual([
      ["COLUMN_HEADER_CHANGED", "Runs", "Loads", "Load Count"],
      ["MISSING_OPTIONAL_WORKSHEET", "Vouchers", null, null],
      ["UNEXPECTED_WORKSHEET", "Voucher", null, null],
      ["UNEXPECTED_WORKSHEET", "Hidden Lookup", null, null],
    ]);
    expect(JSON.stringify(r)).not.toContain(SECRET_VALUE);
    expectNoWrites();
  });

  it("hidden/empty/unexpected sheets are inventoried but never decoded; only planned governed indices are read", async () => {
    const { xlsxAdapter } = await import("@/lib/data-hub/workbookParser");
    const spy = vi.spyOn(xlsxAdapter, "read");
    const sheets = juneLikeSheets();
    sheets.find((s) => s.name === "Jobs")!.hidden = 2;
    sheets.push({ name: "Unexpected", aoa: [["Secret header", SECRET_VALUE]] });
    arrange(sheets);
    const r = await runService();
    if (!r.ok) throw new Error("expected ok");
    const cellRead = spy.mock.calls.find((c) => Array.isArray((c[1] as XLSX.ParsingOptions).sheets))!;
    const requested = (cellRead[1] as XLSX.ParsingOptions).sheets as number[];
    expect(requested).not.toContain(SHEETS.findIndex((s) => s.name === "Jobs"));
    expect(requested).not.toContain(SHEETS.findIndex((s) => s.name === "Trends"));
    expect(requested).not.toContain(14);
    // 13 governed sheets define columns; Jobs is hidden -> 12 reads.
    expect(requested).toHaveLength(12);
    expect(r.report.differences.map((d) => [d.code, d.severity])).toEqual([
      ["SHEET_UNMATCHABLE", "WARNING"],
      ["UNEXPECTED_WORKSHEET", "WARNING"],
    ]);
    expect(JSON.stringify(r)).not.toMatch(/Secret header|PII-ROW/);
  });

  it("a workbook whose governed header row now holds data (no overlap) => HEADER_ROW_UNRESOLVED without echoing it", async () => {
    const sheets = juneLikeSheets();
    const vouchers = sheets.find((s) => s.name === "Vouchers")!;
    vouchers.aoa = [["V-SECRET-1", "Jane Citizen", "0400 000 000"], ["x"], ["V-SECRET-2", "John Citizen"]];
    arrange(sheets);
    const r = await runService();
    if (!r.ok) throw new Error("expected ok");
    expect(r.report.differences).toEqual([expect.objectContaining({ code: "HEADER_ROW_UNRESOLVED", severity: "BLOCKING", governedWorksheetName: "Vouchers" })]);
    expect(JSON.stringify(r)).not.toMatch(/SECRET|Citizen|0400/);
  });

  it("an invalid or conflicting governed profile header-row document => HEADER_ROW_UNRESOLVED (never guessed)", async () => {
    arrange(juneLikeSheets());
    const g = governedRows();
    g.profileVersions[2].profile_document = { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: 3, extra: true } as never;
    g.profileVersions.push({ ...g.profileVersions[4], profile_document: { documentVersion: 1, schemaStatus: "DRAFT", headerRowOneBased: 2 } });
    reads.profileVersionFindMany.mockResolvedValue(g.profileVersions);
    const r = await runService();
    if (!r.ok) throw new Error("expected ok");
    expect(r.report.differences.map((d) => [d.code, d.governedWorksheetName])).toEqual([
      ["HEADER_ROW_UNRESOLVED", "Runs"],
      ["HEADER_ROW_UNRESOLVED", "Loads"],
    ]);
  });
});

describe("6.2D3C service — gates, tenant and integrity fail closed", () => {
  it.each([
    ["missing / cross-tenant batch", null, "BATCH_NOT_FOUND"],
    ["tombstoned batch", { deleted_at: new Date() }, "BATCH_NOT_FOUND"],
    ["non-READY batch", { status: "PROCESSING" }, "BATCH_NOT_READY"],
    ["csv batch", { content_type: "csv" }, "UNSUPPORTED_FORMAT"],
    ["xls batch", { content_type: "xls", original_filename: "a.xls" }, "UNSUPPORTED_FORMAT"],
    ["xlsx content_type with csv filename", { original_filename: "a.csv" }, "UNSUPPORTED_FORMAT"],
    ["missing sha256", { sha256: null }, "PROVIDER_FAILURE"],
    ["no source-system lineage", { source_system_id: null }, "SOURCE_LINEAGE_REQUIRED"],
  ])("%s -> %s before any schema or storage read", async (_name, batch, code) => {
    arrange(juneLikeSheets(), { batch: batch ?? {} });
    if (batch === null) reads.importBatchFindUnique.mockResolvedValue(null);
    const r = await runService("batch-1", batch === null ? "org-2" : ORG);
    expect(r).toMatchObject({ ok: false, code });
    expect(reads.datasetTypeFindFirst).not.toHaveBeenCalled();
    expect(storageGet).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("no persisted descriptors, or a non-contiguous descriptor set -> INVALID_STATE before storage", async () => {
    arrange(juneLikeSheets(), { descriptors: [] });
    expect(await runService()).toMatchObject({ ok: false, code: "INVALID_STATE" });
    const d = descriptorsFor(juneLikeSheets());
    arrange(juneLikeSheets(), { descriptors: [d[0], d[2]] });
    expect(await runService()).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(storageGet).not.toHaveBeenCalled();
  });

  it.each([
    ["source system not in tenant", () => reads.sourceSystemFindFirst.mockResolvedValue(null)],
    ["source system row from another tenant", () => reads.sourceSystemFindFirst.mockResolvedValue({ id: SS, organisation_id: "org-2" })],
    ["source-system mismatch: no governed dataset for this source", () => reads.datasetTypeFindFirst.mockResolvedValue(null)],
    ["dataset for another source system", () => reads.datasetTypeFindFirst.mockResolvedValue({ id: "dhcfg-onk-mwco-dt", organisation_id: ORG, source_system_id: "ss-other", active: true })],
    ["dataset with a non-governed id", () => reads.datasetTypeFindFirst.mockResolvedValue({ id: "manual-dt", organisation_id: ORG, source_system_id: SS, active: true })],
    ["inactive dataset", () => reads.datasetTypeFindFirst.mockResolvedValue({ id: "dhcfg-onk-mwco-dt", organisation_id: ORG, source_system_id: SS, active: false })],
    ["no version 1", () => reads.sourceSchemaVersionFindFirst.mockResolvedValue(null)],
    ["RETIRED schema", () => reads.sourceSchemaVersionFindFirst.mockResolvedValue({ id: "dhcfg-onk-mwco-sv1", organisation_id: ORG, dataset_type_id: "dhcfg-onk-mwco-dt", version_number: 1, status: "RETIRED" })],
    ["version with a non-governed id", () => reads.sourceSchemaVersionFindFirst.mockResolvedValue({ id: "other-sv", organisation_id: ORG, dataset_type_id: "dhcfg-onk-mwco-dt", version_number: 1, status: "DRAFT" })],
    ["zero worksheets", () => reads.sourceSchemaWorksheetFindMany.mockResolvedValue([])],
    ["cross-tenant worksheet row", () => reads.sourceSchemaWorksheetFindMany.mockResolvedValue(governedRows("org-2").worksheets)],
    ["cross-tenant column row", () => reads.sourceSchemaColumnFindMany.mockResolvedValue(governedRows("org-2").columns)],
    ["cross-tenant profile row", () => reads.profileVersionFindMany.mockResolvedValue(governedRows("org-2").profileVersions)],
    ["unknown presence value", () => reads.sourceSchemaWorksheetFindMany.mockResolvedValue(governedRows().worksheets.map((w) => ({ ...w, presence: "MAYBE" })))],
  ])("%s -> GOVERNED_SCHEMA_UNAVAILABLE, no storage read, no write", async (_name, sabotage) => {
    arrange(juneLikeSheets());
    sabotage();
    const r = await runService();
    expect(r).toMatchObject({ ok: false, code: "GOVERNED_SCHEMA_UNAVAILABLE" });
    if (!r.ok) expect(r.message).not.toMatch(/Onkaparinga|Monthly waste|dhcfg|org-2|ss-/);
    expect(storageGet).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("storage NOT_FOUND / provider failure are sanitized", async () => {
    const { RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");
    arrange(juneLikeSheets());
    storageGet.mockRejectedValue(new RawFileStoreError("NOT_FOUND", "missing"));
    expect(await runService()).toMatchObject({ ok: false, code: "STORAGE_NOT_FOUND" });
    storageGet.mockRejectedValue(new Error(`provider leaked ${SECRET_VALUE}`));
    const r = await runService();
    expect(r).toMatchObject({ ok: false, code: "PROVIDER_FAILURE" });
    expect(JSON.stringify(r)).not.toContain(SECRET_VALUE);
  });

  it("SHA-256 mismatch -> STORAGE_INTEGRITY_MISMATCH; SheetJS never reached", async () => {
    const { xlsxAdapter } = await import("@/lib/data-hub/workbookParser");
    const spy = vi.spyOn(xlsxAdapter, "read");
    arrange(juneLikeSheets(), { batch: { sha256: "0".repeat(64) } });
    expect(await runService()).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("persisted descriptors disagreeing with the hash-pinned bytes (name, visibility, count) -> STORAGE_INTEGRITY_MISMATCH", async () => {
    const sheets = juneLikeSheets();
    for (const tamper of [
      (d: ReturnType<typeof descriptorsFor>) => { d[2].worksheet_name = "Loads"; d[4].worksheet_name = "Runs"; },
      (d: ReturnType<typeof descriptorsFor>) => { d[3].worksheet_visibility = "hidden"; },
      (d: ReturnType<typeof descriptorsFor>) => { d.pop(); },
    ]) {
      const d = descriptorsFor(sheets);
      tamper(d);
      arrange(sheets, { descriptors: d });
      const r = await runService();
      expect(r).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
      expect(JSON.stringify(r)).not.toContain(SECRET_VALUE);
    }
  });

  it("malformed workbook -> PARSER_REJECTED with no raw parser text", async () => {
    const bytes = Buffer.from("PK\x03\x04not-a-workbook");
    arrange(juneLikeSheets(), { bytes });
    const r = await runService();
    expect(r).toMatchObject({ ok: false, code: "PARSER_REJECTED" });
    expect(JSON.stringify(r)).not.toMatch(/zip|UNSAFE_ARCHIVE|MALFORMED_WORKBOOK|SheetJS|End of central/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("6.2D3C route — GET /api/data-hub/import-batches/[id]/schema-match", () => {
  async function route() {
    return import("@/app/api/data-hub/import-batches/[id]/schema-match/route");
  }

  it("401/403 before any lookup; private no-store", async () => {
    const { GET } = await route();
    for (const [msg, status] of [["Unauthorized", 401], ["Forbidden", 403]] as const) {
      requireRole.mockReset();
      requireRole.mockRejectedValue(new Error(msg));
      const res = await GET(new Request("http://x") as never, { params: Promise.resolve({ id: "batch-1" }) });
      expect(res.status).toBe(status);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(requireRole).toHaveBeenCalledWith("manager");
    expect(reads.importBatchFindUnique).not.toHaveBeenCalled();
  });

  it("uses the SESSION tenant; query/header org/schema ids cannot redirect scoping", async () => {
    arrange(juneLikeSheets());
    const { GET } = await route();
    const req = new Request("http://x/?organisationId=org-2&sourceSchemaVersionId=evil&sourceSystemId=ss-evil", { headers: { "x-organisation-id": "org-2" } });
    const res = await GET(req as never, { params: Promise.resolve({ id: "batch-1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["ok", "report"]);
    expect(body.report.result).toBe("EXACT_MATCH");
    for (const fn of Object.values(reads)) for (const call of fn.mock.calls) expect(JSON.stringify(call)).not.toMatch(/org-2|evil/);
    expectNoWrites();
  });

  it("maps failure codes to controlled statuses; unexpected errors log and return no workbook detail", async () => {
    const { GET } = await route();
    arrange(juneLikeSheets());
    reads.datasetTypeFindFirst.mockResolvedValue(null);
    const res409 = await GET(new Request("http://x") as never, { params: Promise.resolve({ id: "batch-1" }) });
    expect(res409.status).toBe(409);
    expect(await res409.json()).toMatchObject({ ok: false, code: "GOVERNED_SCHEMA_UNAVAILABLE" });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    reads.importBatchFindUnique.mockRejectedValue(new Error(`db failure ${SECRET_VALUE}`));
    const res500 = await GET(new Request("http://x") as never, { params: Promise.resolve({ id: "batch-1" }) });
    expect(res500.status).toBe(500);
    expect(res500.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.stringify(await res500.json())).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(SECRET_VALUE);
  });

  it("the route reads no body/query/headers and passes only session tenant + path id", () => {
    const src = stripComments(read("app/api/data-hub/import-batches/[id]/schema-match/route.ts"));
    expect(src).not.toMatch(/req\.(json|text|formData|arrayBuffer|body)|searchParams|nextUrl|headers\.get/);
    expect(src).toMatch(/matchImportBatchSchema\(\{ organisationId: session\.organisationId, importBatchId: id \}\)/);
    expect(src).toMatch(/requireRole\("manager"\)/);
    expect(src).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("6.2D3C no-write / execution-boundary proof (static)", () => {
  const D3C_FILES = [
    "lib/data-hub/schemaMatch/schemaMatcher.ts",
    "lib/data-hub/schemaMatch/governedSchema.ts",
    "lib/data-hub/schemaMatch/matchImportBatchSchema.ts",
    "app/api/data-hub/import-batches/[id]/schema-match/route.ts",
  ];

  it("no Prisma write method, transaction, raw SQL, audit write or console logging of details in any D3C server file", () => {
    for (const rel of D3C_FILES) {
      const src = stripComments(read(rel));
      expect(src, rel).not.toMatch(/\b(prisma|tx)\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$transaction|\$executeRaw|\$queryRaw|\btx\.|auditLog|writeAudit/);
      expect(src, rel).not.toMatch(/console\.(log|error|warn)\([^)"]*,/);
    }
  });

  it("the service's exact Prisma surface is read-only", () => {
    const service = stripComments(read("lib/data-hub/schemaMatch/matchImportBatchSchema.ts"));
    expect(service.match(/prisma\.\w+\.\w+\(/g)).toEqual(["prisma.importBatch.findUnique(", "prisma.upload.findMany("]);
  });

  it("never writes or reads ImportBatch lineage columns, schema activation, profile activation, mappings, staging or reconciliation", () => {
    for (const rel of D3C_FILES) {
      const src = stripComments(read(rel));
      expect(src, rel).not.toMatch(/activated_at|active_profile_version_id|disposition|sourceMapping|mappingVersion|illegalDumping|reconciliation|staging|confirmWorksheet|selectWorksheetMapping/i);
      // Only the loader names schema FK columns — as READ filters on the
      // schema tables themselves; it never touches ImportBatch at all.
      if (!rel.endsWith("governedSchema.ts")) expect(src, rel).not.toMatch(/dataset_type_id|source_schema_version_id/);
      else expect(src, rel).not.toMatch(/importBatch|import_batches|upload\b/);
    }
  });

  it("never uses the bounded preview DTO / preview bounds as the structural source (no 50-column truncation)", () => {
    for (const rel of D3C_FILES) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/previewXlsxWorksheet|previewDataHubWorksheet|previewBounds|boundColumns|PREVIEW_MAX|decodeWorksheet/);
    }
    expect(read("lib/data-hub/schemaMatch/matchImportBatchSchema.ts")).toContain("readWorksheetHeaderRows(");
  });

  it("selectWorksheetMapping / confirmWorksheet keep their non-CSV UNSUPPORTED_FORMAT gates and know nothing of D3C", () => {
    for (const rel of ["lib/data-hub/importBatch/selectWorksheetMapping.ts", "lib/data-hub/importBatch/confirmWorksheet.ts"]) {
      const src = read(rel).replace(/\r\n/g, "\n");
      expect(src, rel).toMatch(/if \(batch\.content_type !== "csv"\) \{\s*\n\s*return fail\("UNSUPPORTED_FORMAT"\);/);
      expect(src, rel).not.toMatch(/schemaMatch|SchemaMatch|governedSchema/);
    }
  });

  it("the preview service stays read-only and untouched by D3C", () => {
    const src = stripComments(read("lib/data-hub/importBatch/previewXlsxWorksheet.ts"));
    expect(src.match(/prisma\.\w+\.\w+\(/g)).toEqual(["prisma.upload.findFirst(", "prisma.importBatch.findUnique("]);
    expect(src).not.toMatch(/schemaMatch|governed/i);
  });

  it("no D3C file ships to the browser: client/UI code never imports the server matcher/loader/service", () => {
    for (const rel of [
      "lib/data-hub/client/orchestrator.ts",
      "lib/data-hub/client/types.ts",
      "lib/data-hub/client/httpClient.ts",
      "app/data-hub/import/_components/SchemaMatchReportPanel.tsx",
      "app/data-hub/import/schemaMatchCopy.ts",
      "app/data-hub/import/ImportClient.tsx",
      "app/data-hub/import/[batchId]/RecoveryClient.tsx",
    ]) {
      expect(read(rel), rel).not.toMatch(/from\s+["'][^"']*(schemaMatch\/|workbookParser|lib\/prisma|\/prisma["'])/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("6.2D3C client orchestrator — explicit, read-only compare phases", () => {
  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }
  function worksheetDTO(index: number) {
    return {
      id: `ws-${index}`, worksheetIndex: index, worksheetName: `Sheet ${index}`, worksheetVisibility: "visible", worksheetIsEmpty: false,
      canonicalStatus: "AWAITING_CONFIRMATION", importBatchId: "batch-1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      confirmedBy: null, confirmedAt: null, lastAttemptAt: null, attemptCount: 0, lastFailureCode: null, lastFailureMessage: null,
      lastFailureRetryable: null, importedRowCount: null, periodStart: null, periodEnd: null, periodSource: null, reportingPeriodRequired: false,
    };
  }
  const REPORT = {
    reportVersion: 1, sourceSchemaVersionId: "dhcfg-onk-mwco-sv1", sourceSchemaVersionNumber: 1, sourceSchemaStatus: "DRAFT", result: "EXACT_MATCH",
    exactMatch: true, blocking: false, observedWorksheetCount: 1, governedWorksheetCount: 1, matchedWorksheetCount: 1, missingRequiredWorksheetCount: 0,
    missingOptionalWorksheetCount: 0, unexpectedWorksheetCount: 0, totalDifferenceCount: 0, blockingDifferenceCount: 0, warningDifferenceCount: 0, differences: [],
  };

  async function inventorySession(contentType: string, schemaMatch: () => Promise<Response> | Response) {
    const calls: string[] = [];
    const worksheets = [worksheetDTO(0)];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url).replace(/^https?:\/\/[^/]*/, "");
      const method = init?.method ?? "GET";
      calls.push(`${method} ${u}`);
      if (method === "POST" && u.endsWith("/inspect")) {
        return jsonResponse(200, { ok: true, worksheets: worksheets.map(({ worksheetIndex, worksheetName, worksheetVisibility, worksheetIsEmpty, canonicalStatus }) => ({ worksheetIndex, worksheetName, worksheetVisibility, worksheetIsEmpty, canonicalStatus })) });
      }
      if (method === "GET" && u.endsWith("/worksheets")) return jsonResponse(200, { worksheets });
      if (method === "GET" && u.endsWith("/schema-match")) return schemaMatch();
      if (method === "GET" && /\/import-batches\/[^/]+$/.test(u)) {
        return jsonResponse(200, { batch: { id: "batch-1", status: "READY", originalFilename: "w.xlsx", contentType, sizeBytes: 8, sourceSystemId: "ss-1", createdAt: "x", updatedAt: "x", sha256: "abc", uploadedBy: "u", attemptCount: 1, lastAttemptAt: null, lastFailureCode: null, lastFailureMessage: null, lastFailureRetryable: null, deletedAt: null } });
      }
      throw new Error(`unexpected request: ${method} ${u}`);
    });
    const { createIllegalDumpingImportSession } = await import("@/lib/data-hub/client/orchestrator");
    const session = createIllegalDumpingImportSession({ fetchImpl });
    await session.resumeFromBatchId("batch-1");
    return { session, calls };
  }

  it("inventory -> schemaMatchLoading -> schemaMatchReady via ONE GET; confirm/mapping/period stay blocked; back restores inventory", async () => {
    const { session, calls } = await inventorySession("xlsx", () => jsonResponse(200, { ok: true, report: REPORT }));
    expect(session.getState().phase).toBe("worksheetInventoryReady");
    expect(calls.some((c) => c.endsWith("/schema-match"))).toBe(false); // never automatic
    const pending = session.compareToGovernedSchema();
    expect(session.getState().phase).toBe("schemaMatchLoading");
    await pending;
    expect(session.getState()).toMatchObject({ phase: "schemaMatchReady", report: { result: "EXACT_MATCH" } });
    await expect(session.confirm()).rejects.toThrow(/unexpected phase/);
    await expect(session.compareToGovernedSchema()).rejects.toThrow(/unexpected phase/);
    expect(calls.filter((c) => c.endsWith("/schema-match"))).toEqual(["GET /api/data-hub/import-batches/batch-1/schema-match"]);
    expect(calls.some((c) => /\/preview|\/confirm-illegal-dumping|\/mapping-selection|\/period-/.test(c) || c.startsWith("POST") && !c.endsWith("/inspect"))).toBe(false);
    session.backToWorksheetInventory();
    expect(session.getState().phase).toBe("worksheetInventoryReady");
  });

  it("server failure / invalid body -> schemaMatchFailed with the controlled message; retry re-requests", async () => {
    let body: unknown = { ok: false, code: "GOVERNED_SCHEMA_UNAVAILABLE", error: "No governed source schema is available." };
    const { session } = await inventorySession("xlsx", () => jsonResponse(409, body));
    await session.compareToGovernedSchema();
    expect(session.getState()).toMatchObject({ phase: "schemaMatchFailed", code: "GOVERNED_SCHEMA_UNAVAILABLE" });
    body = { ok: true, report: { ...REPORT, reportVersion: 2 } };
    await session.compareToGovernedSchema();
    expect(session.getState()).toMatchObject({ phase: "schemaMatchFailed", code: "UNKNOWN" });
    body = { ok: true, report: REPORT };
    await session.compareToGovernedSchema();
    expect(session.getState().phase).toBe("schemaMatchReady");
  });

  it("review F4: a null / primitive / malformed-difference body fails closed instead of sticking on loading", async () => {
    let raw = "null";
    const { session } = await inventorySession("xlsx", () => new Response(raw, { status: 200 }));
    for (const next of ["null", "42", JSON.stringify({ ok: true, report: { ...REPORT, differences: [null] } })]) {
      raw = next;
      await session.compareToGovernedSchema();
      expect(session.getState()).toMatchObject({ phase: "schemaMatchFailed", code: "UNKNOWN" });
    }
  });

  it("back during an in-flight comparison invalidates its late completion", async () => {
    let resolve!: (r: Response) => void;
    const deferred = new Promise<Response>((r) => { resolve = r; });
    const { session } = await inventorySession("xlsx", () => deferred);
    const pending = session.compareToGovernedSchema();
    session.backToWorksheetInventory();
    resolve(jsonResponse(200, { ok: true, report: REPORT }));
    await pending;
    expect(session.getState().phase).toBe("worksheetInventoryReady");
  });
});

describe("6.2D3C UI — report panel and inventory action", () => {
  const batch = { id: "batch-1", status: "READY" as const, originalFilename: "w.xlsx", contentType: "xlsx", sizeBytes: 8, sourceSystemId: "ss-1" };

  async function renderReport(report: Record<string, unknown>) {
    const { default: Panel } = await import("@/app/data-hub/import/_components/SchemaMatchReportPanel");
    const state = { phase: "schemaMatchReady" as const, batch, worksheets: [], report: report as never };
    return renderToStaticMarkup(createElement(Panel, { state, onBack: () => {}, onRetry: () => {}, onSelectSchema: () => {}, onRestart: () => {} }));
  }

  it("exact match reads as structural — never accepted/approved/activated/ready to import — and offers no import CTA", async () => {
    const html = await renderReport({
      reportVersion: 1, sourceSchemaVersionId: "dhcfg-onk-mwco-sv1", sourceSchemaVersionNumber: 1, sourceSchemaStatus: "DRAFT", result: "EXACT_MATCH",
      exactMatch: true, blocking: false, observedWorksheetCount: 14, governedWorksheetCount: 14, matchedWorksheetCount: 14, missingRequiredWorksheetCount: 0,
      missingOptionalWorksheetCount: 0, unexpectedWorksheetCount: 0, totalDifferenceCount: 0, blockingDifferenceCount: 0, warningDifferenceCount: 0, differences: [],
    });
    expect(html).toContain("Structure matches the governed schema v1 draft.");
    expect(html).toContain("Nothing has been accepted, activated, mapped or imported");
    expect(html).not.toMatch(/Ready to import|approved|Import now|>\s*Confirm\s*<|<input/i);
    expect((html.match(/<button/g) ?? []).map(() => 1)).toHaveLength(2);
    expect(html).toContain("Back to workbook worksheets");
  });

  it("drift renders structural differences only, as escaped text", async () => {
    const html = await renderReport({
      reportVersion: 1, sourceSchemaVersionId: "sv", sourceSchemaVersionNumber: 1, sourceSchemaStatus: "DRAFT", result: "MATCH_WITH_NON_BLOCKING_DRIFT",
      exactMatch: false, blocking: false, observedWorksheetCount: 14, governedWorksheetCount: 14, matchedWorksheetCount: 14, missingRequiredWorksheetCount: 0,
      missingOptionalWorksheetCount: 0, unexpectedWorksheetCount: 0, totalDifferenceCount: 1, blockingDifferenceCount: 0, warningDifferenceCount: 1,
      differences: [{ code: "COLUMN_HEADER_CHANGED", severity: "WARNING", worksheetLogicalKey: "runs", governedWorksheetName: "Runs", observedWorksheetName: "Runs", governedWorksheetOrdinalHint: 2, observedWorksheetIndex: 2, governedColumnOrdinal: 2, observedColumnOrdinal: 2, governedHeader: "Run", observedHeader: "<b>Run Name</b>", governedPresence: "OPTIONAL", messageKey: "k", deterministicKey: "key" }],
    });
    expect(html).toContain("(warnings only)");
    expect(html).toContain("Column 3 header is &quot;&lt;b&gt;Run Name&lt;/b&gt;&quot;; governed header is &quot;Run&quot;.");
    expect(html).not.toContain("<b>Run Name</b>");
  });

  it("the panel is never handed the session; both shells wire only narrow callbacks", () => {
    const code = stripComments(read("app/data-hub/import/_components/SchemaMatchReportPanel.tsx"));
    expect(code).not.toMatch(/session|confirm\(|loadPreview|selectMapping|selectPeriod|fetch\(/);
    for (const shell of ["app/data-hub/import/ImportClient.tsx", "app/data-hub/import/[batchId]/RecoveryClient.tsx"]) {
      const tag = stripComments(read(shell)).match(/<SchemaMatchReportPanel\b[\s\S]*?\/>/)?.[0] ?? "";
      expect(tag).not.toBe("");
      expect(tag).not.toMatch(/session=/);
      expect(tag).toContain("session.backToWorksheetInventory()");
    }
  });

  it("schemaMatch phases are their own screen group — never review/confirm, never an error overlay", async () => {
    const { deriveScreenGroup, isErrorOverlayPhase } = await import("@/app/data-hub/import/screenGroup");
    for (const phase of ["schemaMatchLoading", "schemaMatchReady", "schemaMatchFailed"] as const) {
      expect(deriveScreenGroup(phase)).toBe("schemaMatch");
      expect(isErrorOverlayPhase(phase)).toBe(false);
    }
  });
});
