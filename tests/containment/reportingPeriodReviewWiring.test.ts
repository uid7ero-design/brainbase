import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";

// Data Hub 6.2C3 — reporting-period REVIEW wiring: server detection service,
// server-authoritative acceptance service, both routes, and the source-
// profile registry. Mocked Prisma + mocked storage composition root (the
// same convention as previewWorksheet.test.ts / selectWorksheetPeriod.test
// .ts). Workbook fixtures are REAL SheetJS-written XLSX bytes run through
// the real workbookParser safety primitives (archive guard, signature,
// bounded probe) — only Prisma and Blob storage are mocked. Every fixture
// value is synthetic; no real customer/PII value appears in this file.
//
// This file does not claim DB-level atomicity: a mocked $transaction cannot
// prove it. What it proves is that the write is ONE conditional updateMany
// whose WHERE repeats every eligibility predicate (so the database itself
// rejects a stale write), and that every lost-claim shape fails closed.

const ROOT = process.cwd();
function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8").replace(/\r\n/g, "\n");
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const DETECT_PATH = "lib/data-hub/reportingPeriod/detectWorksheetReportingPeriod.ts";
const ACCEPT_PATH = "lib/data-hub/reportingPeriod/acceptDetectedWorksheetPeriod.ts";
const PROFILES_PATH = "lib/data-hub/reportingPeriod/sourceProfiles.ts";
const DETECT_ROUTE_PATH = "app/api/data-hub/worksheets/[id]/period-detection/route.ts";
const ACCEPT_ROUTE_PATH = "app/api/data-hub/worksheets/[id]/period-detection/accept/route.ts";
const MANUAL_SERVICE_PATH = "lib/data-hub/importBatch/selectWorksheetPeriod.ts";
const MANUAL_ROUTE_PATH = "app/api/data-hub/worksheets/[id]/period-selection/route.ts";

const ONKA_NAME = "City of Onkaparinga operational export";
const JUNE_FILENAME = "City of Onkaparinga-Month-June-2026.xlsx";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const uploadFindFirstMock = vi.fn();
const importBatchFindUniqueMock = vi.fn();
const sourceSystemFindUniqueMock = vi.fn();
const txUploadFindFirstMock = vi.fn();
const txUploadUpdateManyMock = vi.fn();
const txImportBatchFindUniqueMock = vi.fn();
const txSourceSystemFindUniqueMock = vi.fn();
const transactionMock = vi.fn();
// Write traps — any call is a test failure for the detection service.
const writeTrap = {
  uploadUpdate: vi.fn(),
  uploadUpdateMany: vi.fn(),
  uploadCreate: vi.fn(),
  importBatchUpdate: vi.fn(),
  importBatchUpdateMany: vi.fn(),
  sourceSystemUpdate: vi.fn(),
  sourceSystemUpdateMany: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    upload: {
      findFirst: (...a: unknown[]) => uploadFindFirstMock(...a),
      update: (...a: unknown[]) => writeTrap.uploadUpdate(...a),
      updateMany: (...a: unknown[]) => writeTrap.uploadUpdateMany(...a),
      create: (...a: unknown[]) => writeTrap.uploadCreate(...a),
    },
    importBatch: {
      findUnique: (...a: unknown[]) => importBatchFindUniqueMock(...a),
      update: (...a: unknown[]) => writeTrap.importBatchUpdate(...a),
      updateMany: (...a: unknown[]) => writeTrap.importBatchUpdateMany(...a),
    },
    sourceSystem: {
      findUnique: (...a: unknown[]) => sourceSystemFindUniqueMock(...a),
      update: (...a: unknown[]) => writeTrap.sourceSystemUpdate(...a),
      updateMany: (...a: unknown[]) => writeTrap.sourceSystemUpdateMany(...a),
    },
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

const requireRoleMock = vi.fn();
vi.mock("@/lib/org", () => ({
  requireRole: (...a: unknown[]) => requireRoleMock(...a),
}));

function txStub() {
  return {
    upload: {
      findFirst: (...a: unknown[]) => txUploadFindFirstMock(...a),
      updateMany: (...a: unknown[]) => txUploadUpdateManyMock(...a),
    },
    importBatch: { findUnique: (...a: unknown[]) => txImportBatchFindUniqueMock(...a) },
    sourceSystem: { findUnique: (...a: unknown[]) => txSourceSystemFindUniqueMock(...a) },
  };
}

async function freshDetect() {
  vi.resetModules();
  return import("@/lib/data-hub/reportingPeriod/detectWorksheetReportingPeriod");
}
async function freshAccept() {
  vi.resetModules();
  return import("@/lib/data-hub/reportingPeriod/acceptDetectedWorksheetPeriod");
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

type Aoa = (string | number | null)[][];

function buildXlsx(sheets: Record<string, Aoa>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// Real-shape (sanitized) monthly workbook: report headings in A2 of three
// named sheets, plus an operational-row sheet whose dates are deliberately
// in a DIFFERENT month (May) to prove row dates are never consulted.
function onkaWorkbook(overrides: { overview?: string | null; setTotals?: string | null; trends?: string | null } = {}): Buffer {
  const heading = (v: string | null | undefined, fallback: string) => (v === undefined ? fallback : v);
  return buildXlsx({
    Overview: [["City of Onkaparinga"], [heading(overrides.overview, "Overview June")], ["Metric", "Count"], ["Collections", 120]],
    "Service Exception Totals": [
      ["City of Onkaparinga"],
      [heading(overrides.setTotals, "Service Exception Totals June")],
      ["Exception", "Total"],
      ["Missed bin", 4],
    ],
    Trends: [["City of Onkaparinga"], [heading(overrides.trends, "Trends March to June")], ["Month", "Total"], ["March", 10]],
    Data: [["Ticket #", "Call time"], ["00001", "13-05-2026 13:57"], ["00002", "20-05-2026 09:00"]],
  });
}

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function worksheetRow(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "worksheet-1", import_batch_id: "batch-1", canonical_status: "AWAITING_CONFIRMATION", ...overrides };
}
function batchRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: "READY",
    content_type: "xlsx",
    sha256: "unset",
    deleted_at: null,
    source_system_id: "source-onka",
    original_filename: JUNE_FILENAME,
    ...overrides,
  };
}

function arrangeDetection(opts: {
  worksheet?: Partial<Record<string, unknown>> | null;
  batch?: Partial<Record<string, unknown>> | null;
  sourceName?: string | null;
  bytes?: Buffer;
  storedBytes?: Buffer;
}) {
  const bytes = opts.bytes ?? onkaWorkbook();
  uploadFindFirstMock.mockResolvedValue(opts.worksheet === null ? null : worksheetRow(opts.worksheet));
  importBatchFindUniqueMock.mockResolvedValue(
    opts.batch === null ? null : batchRow({ sha256: sha(bytes), ...opts.batch })
  );
  sourceSystemFindUniqueMock.mockResolvedValue(opts.sourceName === null ? null : { name: opts.sourceName ?? ONKA_NAME });
  storageGetMock.mockResolvedValue({ metadata: {}, body: opts.storedBytes ?? bytes });
  return bytes;
}

function expectNoWrites() {
  for (const trap of Object.values(writeTrap)) expect(trap).not.toHaveBeenCalled();
  expect(transactionMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  for (const m of [
    uploadFindFirstMock,
    importBatchFindUniqueMock,
    sourceSystemFindUniqueMock,
    txUploadFindFirstMock,
    txUploadUpdateManyMock,
    txImportBatchFindUniqueMock,
    txSourceSystemFindUniqueMock,
    transactionMock,
    storageGetMock,
    requireRoleMock,
    ...Object.values(writeTrap),
  ]) {
    m.mockReset();
  }
  transactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(txStub()));
});

// ─── Static containment ────────────────────────────────────────────────────

describe("6.2C3 static containment", () => {
  it("detection service: zero write vocabulary, no $transaction, no session resolution", () => {
    const code = stripComments(read(DETECT_PATH));
    expect(code).not.toMatch(/(prisma|tx)\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\(/);
    expect(code).not.toMatch(/\$transaction/);
    expect(code).not.toMatch(/requireRole|requireSession|lib\/org/);
    expect(code).toMatch(/import "server-only"/);
  });

  it("detection service: every tenant/source/profile gate precedes storage.get()", () => {
    const code = stripComments(read(DETECT_PATH));
    const storageIdx = code.indexOf("storage.get(");
    expect(storageIdx).toBeGreaterThan(0);
    for (const marker of [
      "prisma.upload.findFirst(",
      "prisma.importBatch.findUnique(",
      "prisma.sourceSystem.findUnique(",
      "resolveReportingPeriodDetectorProfile(",
      'batch.content_type === "csv"',
    ]) {
      const idx = code.indexOf(marker);
      expect(idx, marker).toBeGreaterThan(0);
      expect(idx, marker).toBeLessThan(storageIdx);
    }
    // Integrity check precedes parsing.
    expect(code.indexOf("computedSha256 !== batch.sha256")).toBeLessThan(code.indexOf("probeWorkbookCells("));
  });

  it("detection service never reads operational rows (no decodeWorksheet/inspectWorkbook/csv decode) and never supplies a trendsYear", () => {
    const code = stripComments(read(DETECT_PATH));
    expect(code).not.toMatch(/decodeWorksheet|inspectWorkbook|decodeCsvOnly|csv-parse/);
    expect(code).toMatch(/trendsYear:\s*null/);
    expect(code).not.toMatch(/nonAuthoritativeEvidence/);
    expect(code).not.toMatch(/created_at|updated_at|uploaded_at|lastModified|mtime/);
  });

  it("detection service never logs", () => {
    expect(stripComments(read(DETECT_PATH))).not.toMatch(/console\./);
    expect(stripComments(read(ACCEPT_PATH))).not.toMatch(/console\./);
  });

  it("routes never log the caught error object (no workbook content can reach logs)", () => {
    for (const p of [DETECT_ROUTE_PATH, ACCEPT_ROUTE_PATH]) {
      const code = stripComments(read(p));
      expect(code).toMatch(/\}\s*catch\s*\{/);
      expect(code).not.toMatch(/console\.\w+\([^)]*,\s*\w+\)/);
    }
  });

  it("accept route never reads a request body", () => {
    const code = stripComments(read(ACCEPT_ROUTE_PATH));
    expect(code).not.toMatch(/\b_?req\.(json|text|formData|arrayBuffer|body)\b/);
    expect(code).not.toMatch(/searchParams/);
    // The only request-derived value is the path id.
    expect(code).toMatch(/const \{ id \} = await ctx\.params;/);
  });

  it("both routes are manager-gated and source organisationId only from the session", () => {
    for (const p of [DETECT_ROUTE_PATH, ACCEPT_ROUTE_PATH]) {
      const code = stripComments(read(p));
      expect(code).toMatch(/requireRole\("manager"\)/);
      expect(code).toMatch(/organisationId:\s*session\.organisationId/);
    }
  });

  it("accept service: period_source is the fixed literal DETECTED, written by ONE conditional updateMany repeating every eligibility predicate plus period-is-null", () => {
    const code = stripComments(read(ACCEPT_PATH));
    expect(code.match(/prisma\.\$transaction\(/g) ?? []).toHaveLength(1);
    expect(code.match(/\.updateMany\(/g) ?? []).toHaveLength(1);
    const call = code.match(/tx\.upload\.updateMany\(\{[\s\S]*?\}\);/)?.[0] ?? "";
    expect(call).toMatch(/id:\s*worksheetId/);
    expect(call).toMatch(/organisation_id:\s*organisationId/);
    expect(call).toMatch(/lineage_kind:\s*"DATA_HUB"/);
    expect(call).toMatch(/canonical_status:\s*"AWAITING_CONFIRMATION"/);
    expect(call).toMatch(/period_start:\s*null/);
    expect(call).toMatch(/period_end:\s*null/);
    expect(call).toMatch(/period_source:\s*"DETECTED"/);
    expect(code).not.toMatch(/prisma\.upload\.update/);
  });

  it("#14 manual selection path is untouched: still MANUAL-only and never imports the detection modules", () => {
    const service = read(MANUAL_SERVICE_PATH);
    expect(service).toMatch(/period_source:\s*"MANUAL"/);
    expect(service).not.toMatch(/DETECTED/);
    const route = read(MANUAL_ROUTE_PATH);
    expect(route).not.toMatch(/reportingPeriod/);
  });

  it("#22 no SourceSystem config/toggle mutation path and no reporting_period_required reference in any new 6.2C3 server file", () => {
    for (const p of [DETECT_PATH, ACCEPT_PATH, PROFILES_PATH, DETECT_ROUTE_PATH, ACCEPT_ROUTE_PATH]) {
      const code = stripComments(read(p));
      expect(code, p).not.toMatch(/sourceSystem\.(update|updateMany|create|upsert|delete)/);
      expect(code, p).not.toMatch(/reporting_period_required|reportingPeriodRequired/);
    }
  });

  it("source profile registry hard-codes no database id and keys only on the exact configured name", () => {
    const code = stripComments(read(PROFILES_PATH));
    expect(code).not.toMatch(/\bc[a-z0-9]{24}\b/); // cuid shape
    expect(code).not.toMatch(/toLowerCase|toUpperCase|\.trim\(|includes\(|startsWith|RegExp/);
  });

  it("the new reportingPeriod services have exactly the two authorized app/** importers", () => {
    const importers = (moduleName: string) => {
      const out = new Set<string>();
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) walk(full);
          else if (/\.(ts|tsx)$/.test(e.name) && new RegExp(`reportingPeriod/${moduleName}["']`).test(fs.readFileSync(full, "utf8"))) {
            out.add(path.relative(ROOT, full).replace(/\\/g, "/"));
          }
        }
      };
      walk(path.join(ROOT, "app"));
      if (fs.existsSync(path.join(ROOT, "components"))) walk(path.join(ROOT, "components"));
      return out;
    };
    expect(importers("detectWorksheetReportingPeriod")).toEqual(new Set([DETECT_ROUTE_PATH]));
    expect(importers("acceptDetectedWorksheetPeriod")).toEqual(new Set([ACCEPT_ROUTE_PATH]));
    expect(importers("sourceProfiles")).toEqual(new Set());
    expect(importers("onkaparingaDetector")).toEqual(new Set());
  });
});

// ─── Source profile registry ──────────────────────────────────────────────

describe("source profile registry — exact-name, fail-closed", () => {
  it("maps only the exact configured name", async () => {
    const { resolveReportingPeriodDetectorProfile } = await import("@/lib/data-hub/reportingPeriod/sourceProfiles");
    expect(resolveReportingPeriodDetectorProfile(ONKA_NAME)).toBe("ONKAPARINGA_MONTHLY_WORKBOOK");
    for (const near of [
      ONKA_NAME.toLowerCase(),
      ` ${ONKA_NAME}`,
      `${ONKA_NAME} `,
      "City of Onkaparinga",
      `${ONKA_NAME} (copy)`,
      "Some other council export",
      "",
    ]) {
      expect(resolveReportingPeriodDetectorProfile(near), JSON.stringify(near)).toBeNull();
    }
  });
});

// ─── Detection service ────────────────────────────────────────────────────

describe("detectWorksheetReportingPeriod — tenant/applicability gates (no storage)", () => {
  it("#1 wrong tenant -> WORKSHEET_NOT_FOUND, tenant in the SAME predicate, no storage", async () => {
    arrangeDetection({ worksheet: null });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-B", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
    expect(uploadFindFirstMock.mock.calls[0][0].where).toEqual({
      id: "worksheet-1",
      organisation_id: "org-B",
      lineage_kind: "DATA_HUB",
    });
    expect(importBatchFindUniqueMock).not.toHaveBeenCalled();
    expect(storageGetMock).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("deleted / foreign parent batch -> WORKSHEET_NOT_FOUND, batch lookup is tenant-scoped via the worksheet's own FK, no storage", async () => {
    arrangeDetection({ batch: { deleted_at: new Date() } });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "WORKSHEET_NOT_FOUND" });
    expect(importBatchFindUniqueMock.mock.calls[0][0].where).toEqual({
      id_organisation_id: { id: "batch-1", organisation_id: "org-A" },
    });
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("locked worksheet (not AWAITING_CONFIRMATION) -> WORKSHEET_NOT_ELIGIBLE, no batch/storage access", async () => {
    arrangeDetection({ worksheet: { canonical_status: "IMPORTED" } });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
    expect(importBatchFindUniqueMock).not.toHaveBeenCalled();
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("#2 legacy / no-source batch -> applicable:false, no SourceSystem lookup, no storage", async () => {
    arrangeDetection({ batch: { source_system_id: null } });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toEqual({ ok: true, applicable: false });
    expect(sourceSystemFindUniqueMock).not.toHaveBeenCalled();
    expect(storageGetMock).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("#3 other SourceSystem -> applicable:false, SourceSystem lookup tenant-scoped, no storage", async () => {
    arrangeDetection({ sourceName: "Some other council export" });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toEqual({ ok: true, applicable: false });
    expect(sourceSystemFindUniqueMock.mock.calls[0][0].where).toEqual({
      id_organisation_id: { id: "source-onka", organisation_id: "org-A" },
    });
    expect(storageGetMock).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("unresolvable SourceSystem (foreign/missing) -> applicable:false, no storage", async () => {
    arrangeDetection({ sourceName: null });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toEqual({ ok: true, applicable: false });
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("#4 Onkaparinga data.csv -> applicable ABSENT / NO_TRUSTED_PERIOD_SIGNAL with NO storage access at all", async () => {
    arrangeDetection({ batch: { content_type: "csv", original_filename: "data.csv" } });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({
      ok: true,
      applicable: true,
      detection: {
        outcome: "ABSENT",
        period: null,
        suggestedPeriod: null,
        reasonCode: "NO_TRUSTED_PERIOD_SIGNAL",
        requiresManualSelection: true,
      },
    });
    expect(storageGetMock).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("legacy .xls for the profile -> ABSENT without storage (the profile defines no XLS signal)", async () => {
    arrangeDetection({ batch: { content_type: "xls", original_filename: "report.xls" } });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: true, applicable: true, detection: { outcome: "ABSENT" } });
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("batch not READY -> BATCH_NOT_READY before storage", async () => {
    arrangeDetection({ batch: { status: "PROCESSING" } });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "BATCH_NOT_READY" });
    expect(storageGetMock).not.toHaveBeenCalled();
  });
});

describe("detectWorksheetReportingPeriod — XLSX content (real bytes, real parser)", () => {
  it("#5 real-shape June workbook: strict filename June 2026 + Overview June -> EXACT 2026-06-01..2026-06-30, operational May row dates ignored", async () => {
    arrangeDetection({});
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({
      ok: true,
      applicable: true,
      detection: {
        outcome: "EXACT",
        period: { start: "2026-06-01", end: "2026-06-30" },
        suggestedPeriod: null,
        reasonCode: "EXACT_CORROBORATED",
        requiresManualSelection: false,
      },
    });
    expect(storageGetMock).toHaveBeenCalledTimes(1);
    expect(storageGetMock.mock.calls[0][0]).toContain("org-A");
    expectNoWrites();
  });

  it("#5b Overview June alone (other headings blank) still corroborates EXACT — filename + one month is sufficient", async () => {
    const bytes = onkaWorkbook({ setTotals: null, trends: null });
    arrangeDetection({ bytes });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: true, applicable: true, detection: { outcome: "EXACT", period: { start: "2026-06-01", end: "2026-06-30" } } });
  });

  it("#5c VERIFIED real layout (sanitized): exact real filename casing + the three verified A2 headings -> EXACT June 2026", async () => {
    // Structural facts verified locally against the real workbook (sheet
    // counts and A2 text only). Every other cell here is synthetic; the real
    // workbook is never read by tests.
    const bytes = buildXlsx({
      Overview: [["synthetic"], ["Overview June"]],
      "Service Exception Totals": [["synthetic"], ["Service Exception Totals June"]],
      Trends: [["synthetic"], ["Trends March to June"]],
    });
    arrangeDetection({ bytes, batch: { original_filename: "city of onkaparinga-month-june-2026.xlsx" } });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({
      ok: true,
      applicable: true,
      detection: { outcome: "EXACT", period: { start: "2026-06-01", end: "2026-06-30" }, reasonCode: "EXACT_CORROBORATED" },
    });
  });

  it("content_type xlsx but a filename that does not classify as xlsx -> ABSENT before storage (probe can only take the archive-guarded branch)", async () => {
    for (const original_filename of ["City of Onkaparinga-Month-June-2026.xls", "City of Onkaparinga-Month-June-2026"]) {
      storageGetMock.mockClear();
      arrangeDetection({ batch: { original_filename } });
      const { detectWorksheetReportingPeriod } = await freshDetect();
      const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
      expect(r, original_filename).toMatchObject({ ok: true, applicable: true, detection: { outcome: "ABSENT", period: null } });
      expect(storageGetMock).not.toHaveBeenCalled();
    }
  });

  it("XLSX order: a hash-verified but archive-unsafe file is rejected by the archive guard and SheetJS is never invoked", async () => {
    const parser = await import("@/lib/data-hub/workbookParser");
    const readSpy = vi.spyOn(parser.xlsxAdapter, "read");
    const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
    arrangeDetection({ bytes });
    const { detectWorksheetReportingPeriod } = await import("@/lib/data-hub/reportingPeriod/detectWorksheetReportingPeriod");
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "PARSER_REJECTED" });
    expect(storageGetMock).toHaveBeenCalledTimes(1);
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();
  });

  it("the returned DTO carries ONLY the safe fields — no evidence, no heading text", async () => {
    arrangeDetection({});
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    if (!r.ok || !r.applicable) throw new Error("expected applicable");
    expect(Object.keys(r.detection).sort()).toEqual(["outcome", "period", "reasonCode", "requiresManualSelection", "suggestedPeriod"]);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/Overview June|Service Exception Totals June|Trends March|evidence/);
  });

  it("#6 filename June vs Overview July -> AMBIGUOUS TRUSTED_SIGNALS_CONFLICT, no period, filename suggestion only", async () => {
    arrangeDetection({ bytes: onkaWorkbook({ overview: "Overview July" }) });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({
      ok: true,
      applicable: true,
      detection: {
        outcome: "AMBIGUOUS",
        period: null,
        suggestedPeriod: { start: "2026-06-01", end: "2026-06-30" },
        reasonCode: "TRUSTED_SIGNALS_CONFLICT",
        requiresManualSelection: true,
      },
    });
  });

  it("missing required sheet (schema not matched) -> AMBIGUOUS, never EXACT", async () => {
    const bytes = buildXlsx({ Overview: [["x"], ["Overview June"]], Trends: [["x"], ["Trends March to June"]] });
    arrangeDetection({ bytes });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: true, applicable: true, detection: { outcome: "AMBIGUOUS", period: null, reasonCode: "EXPECTED_CONTENT_SIGNAL_MISSING" } });
  });

  it("A2 is read by exact address: a heading in A3 (not A2) is NOT used", async () => {
    const bytes = buildXlsx({
      Overview: [["City of Onkaparinga"], [null], ["Overview July"]],
      "Service Exception Totals": [["x"], ["Service Exception Totals June"]],
      Trends: [["x"], ["Trends March to June"]],
    });
    arrangeDetection({ bytes });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    // July in A3 would have produced a conflict if it were read — it wasn't.
    expect(r).toMatchObject({ ok: true, applicable: true, detection: { outcome: "EXACT", reasonCode: "EXACT_CORROBORATED" } });
  });

  it("strict filename grammar: a non-Onkaparinga filename is never EXACT from content alone", async () => {
    const bytes = onkaWorkbook();
    arrangeDetection({ bytes, batch: { original_filename: "monthly.xlsx" } });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: true, applicable: true, detection: { outcome: "AMBIGUOUS", period: null, reasonCode: "MONTH_WITHOUT_YEAR" } });
  });

  it("#7 malformed workbook -> PARSER_REJECTED with the generic taxonomy message; no raw parser error text", async () => {
    const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("SECRET-CELL-MARKER not a zip at all")]);
    arrangeDetection({ bytes });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toEqual({ ok: false, code: "PARSER_REJECTED", message: "The uploaded file could not be safely parsed as a workbook." });
    expect(JSON.stringify(r)).not.toMatch(/SECRET-CELL-MARKER|zip|archive/i);
    expectNoWrites();
  });

  it("#7b private heading text never leaves the service, even when it drives the outcome", async () => {
    arrangeDetection({ bytes: onkaWorkbook({ overview: "SECRET-CELL-MARKER July" }) });
    const { detectWorksheetReportingPeriod } = await freshDetect();
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: true, applicable: true, detection: { outcome: "AMBIGUOUS" } });
    expect(JSON.stringify(r)).not.toMatch(/SECRET-CELL-MARKER/);
  });

  it("#8 hash mismatch -> STORAGE_INTEGRITY_MISMATCH and SheetJS is never invoked", async () => {
    const parser = await import("@/lib/data-hub/workbookParser");
    const readSpy = vi.spyOn(parser.xlsxAdapter, "read");
    const bytes = onkaWorkbook();
    arrangeDetection({ bytes, storedBytes: onkaWorkbook({ overview: "Overview July" }) });
    const { detectWorksheetReportingPeriod } = await import("@/lib/data-hub/reportingPeriod/detectWorksheetReportingPeriod");
    const r = await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "STORAGE_INTEGRITY_MISMATCH" });
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();
  });

  it("storage NOT_FOUND / provider failure -> controlled codes", async () => {
    arrangeDetection({});
    let mod = await freshDetect();
    // Imported AFTER freshDetect()'s module reset so the class identity
    // matches the one the service's instanceof check sees.
    const { RawFileStoreError } = await import("@/lib/data-hub/storage/rawFileStore");
    storageGetMock.mockRejectedValueOnce(new RawFileStoreError("NOT_FOUND", "gone"));
    expect(await mod.detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" })).toMatchObject({
      ok: false,
      code: "STORAGE_NOT_FOUND",
    });
    storageGetMock.mockRejectedValueOnce(new Error("provider exploded with details"));
    mod = await freshDetect();
    const r = await mod.detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "PROVIDER_FAILURE" });
    expect(JSON.stringify(r)).not.toMatch(/exploded/);
  });

  it("#9 across every detection path, zero Prisma writes and no transaction", async () => {
    const scenarios: Parameters<typeof arrangeDetection>[0][] = [
      {},
      { bytes: onkaWorkbook({ overview: "Overview July" }) },
      { batch: { content_type: "csv", original_filename: "data.csv" } },
      { sourceName: "Other" },
      { batch: { source_system_id: null } },
      { worksheet: null },
    ];
    for (const s of scenarios) {
      arrangeDetection(s);
      const { detectWorksheetReportingPeriod } = await freshDetect();
      await detectWorksheetReportingPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    }
    expectNoWrites();
  });
});

// ─── probeWorkbookCells (parser-level proof of A2 semantics) ──────────────

describe("probeWorkbookCells — exact-address, bounded, string-only", () => {
  it("reads A2 exactly even when row 1 is blank and the declared range does not start at A1", async () => {
    const { probeWorkbookCells } = await import("@/lib/data-hub/workbookParser");
    const ws = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.sheet_add_aoa(ws, [["Overview June"]], { origin: "A2" });
    XLSX.utils.sheet_add_aoa(ws, [["Other B1"]], { origin: "B1" });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Overview");
    const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const r = await probeWorkbookCells(bytes, { filename: "x.xlsx" }, [
      { sheetName: "Overview", address: "A2" },
      { sheetName: "Overview", address: "A1" },
      { sheetName: "Missing", address: "A2" },
    ]);
    expect(r.cells).toEqual(["Overview June", null, null]);
    expect(r.sheetNames).toEqual(["Overview"]);
  });

  it("non-string cells and over-long text return null; CSV input is rejected", async () => {
    const { probeWorkbookCells, WorkbookParserError } = await import("@/lib/data-hub/workbookParser");
    const bytes = buildXlsx({ S: [["h"], [45000]], L: [["h"], ["x".repeat(500)]] });
    const r = await probeWorkbookCells(bytes, { filename: "x.xlsx" }, [
      { sheetName: "S", address: "A2" },
      { sheetName: "L", address: "A2" },
    ]);
    expect(r.cells).toEqual([null, null]);
    await expect(probeWorkbookCells(Buffer.from("a,b\n1,2\n"), { filename: "x.csv" }, [])).rejects.toBeInstanceOf(WorkbookParserError);
  });

  it("never materialises rows below the deepest probed address (sheetRows bound)", async () => {
    const parser = await import("@/lib/data-hub/workbookParser");
    // SheetJS mutates the options object it is given, so snapshot each
    // call's options at call time rather than inspecting mock.calls later.
    const original = parser.xlsxAdapter.read;
    const seen: XLSX.ParsingOptions[] = [];
    const readSpy = vi.spyOn(parser.xlsxAdapter, "read").mockImplementation((bytes, opts) => {
      seen.push({ ...opts });
      return original(bytes, opts);
    });
    await parser.probeWorkbookCells(onkaWorkbook(), { filename: JUNE_FILENAME }, [{ sheetName: "Overview", address: "A2" }]);
    const cellRead = seen.find((opts) => opts.sheetRows !== undefined);
    expect(cellRead?.sheetRows).toBe(2);
    expect(cellRead?.sheets).toEqual([0]);
    readSpy.mockRestore();
  });

  it("an address outside the bounded window is a programmer error (RangeError), not a parse", async () => {
    const { probeWorkbookCells } = await import("@/lib/data-hub/workbookParser");
    await expect(probeWorkbookCells(onkaWorkbook(), { filename: JUNE_FILENAME }, [{ sheetName: "Overview", address: "A500" }])).rejects.toBeInstanceOf(RangeError);
    await expect(probeWorkbookCells(onkaWorkbook(), { filename: JUNE_FILENAME }, [{ sheetName: "Overview", address: "A1:B2" }])).rejects.toBeInstanceOf(RangeError);
  });
});

// ─── Accept service ───────────────────────────────────────────────────────

function arrangeAcceptTx(opts: {
  worksheet?: Partial<Record<string, unknown>> | null;
  batch?: Partial<Record<string, unknown>> | null;
  sourceName?: string | null;
  claimCount?: number;
  reread?: Partial<Record<string, unknown>> | null;
  bytes: Buffer;
}) {
  txUploadFindFirstMock.mockResolvedValueOnce(
    opts.worksheet === null
      ? null
      : {
          import_batch_id: "batch-1",
          canonical_status: "AWAITING_CONFIRMATION",
          period_start: null,
          period_end: null,
          period_source: null,
          ...opts.worksheet,
        }
  );
  if (opts.reread !== undefined) {
    txUploadFindFirstMock.mockResolvedValueOnce(opts.reread);
  }
  txImportBatchFindUniqueMock.mockResolvedValue(
    opts.batch === null
      ? null
      : {
          status: "READY",
          content_type: "xlsx",
          original_filename: JUNE_FILENAME,
          source_system_id: "source-onka",
          sha256: sha(opts.bytes),
          deleted_at: null,
          ...opts.batch,
        }
  );
  txSourceSystemFindUniqueMock.mockResolvedValue(opts.sourceName === null ? null : { name: opts.sourceName ?? ONKA_NAME });
  txUploadUpdateManyMock.mockResolvedValue({ count: opts.claimCount ?? 1 });
}

const JUNE_START = new Date(Date.UTC(2026, 5, 1));
const JUNE_END = new Date(Date.UTC(2026, 5, 30));

describe("acceptDetectedWorksheetPeriod — server-authoritative acceptance", () => {
  it("#10 EXACT -> persists start/end + DETECTED through the conditional write, only while AWAITING_CONFIRMATION", async () => {
    const bytes = arrangeDetection({});
    arrangeAcceptTx({ bytes });
    const { acceptDetectedWorksheetPeriod } = await freshAccept();
    const r = await acceptDetectedWorksheetPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toEqual({
      ok: true,
      worksheetUploadId: "worksheet-1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      periodSource: "DETECTED",
      alreadyRecorded: false,
    });
    expect(txUploadUpdateManyMock).toHaveBeenCalledTimes(1);
    const arg = txUploadUpdateManyMock.mock.calls[0][0];
    expect(arg.where).toEqual({
      id: "worksheet-1",
      organisation_id: "org-A",
      lineage_kind: "DATA_HUB",
      canonical_status: "AWAITING_CONFIRMATION",
      import_batch_id: "batch-1",
      period_start: null,
      period_end: null,
    });
    expect(arg.data).toEqual({ period_start: JUNE_START, period_end: JUNE_END, period_source: "DETECTED" });
    // Detection itself (outside the tx) wrote nothing.
    for (const trap of Object.values(writeTrap)) expect(trap).not.toHaveBeenCalled();
  });

  it("#11 AMBIGUOUS -> DETECTED_PERIOD_NOT_EXACT, no transaction, zero writes", async () => {
    arrangeDetection({ bytes: onkaWorkbook({ overview: "Overview July" }) });
    const { acceptDetectedWorksheetPeriod } = await freshAccept();
    const r = await acceptDetectedWorksheetPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "DETECTED_PERIOD_NOT_EXACT" });
    expectNoWrites();
    expect(txUploadUpdateManyMock).not.toHaveBeenCalled();
  });

  it("#11 ABSENT (CSV) -> DETECTED_PERIOD_NOT_EXACT, no transaction, zero writes, no storage", async () => {
    arrangeDetection({ batch: { content_type: "csv", original_filename: "data.csv" } });
    const { acceptDetectedWorksheetPeriod } = await freshAccept();
    const r = await acceptDetectedWorksheetPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "DETECTED_PERIOD_NOT_EXACT" });
    expectNoWrites();
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("not applicable (other source) -> DETECTION_NOT_APPLICABLE, zero writes", async () => {
    arrangeDetection({ sourceName: "Other" });
    const { acceptDetectedWorksheetPeriod } = await freshAccept();
    const r = await acceptDetectedWorksheetPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "DETECTION_NOT_APPLICABLE" });
    expectNoWrites();
  });

  it("detection failures pass through with their controlled code (wrong tenant, hash mismatch), zero writes", async () => {
    arrangeDetection({ worksheet: null });
    let mod = await freshAccept();
    expect(await mod.acceptDetectedWorksheetPeriod({ organisationId: "org-B", worksheetId: "worksheet-1" })).toMatchObject({
      ok: false,
      code: "WORKSHEET_NOT_FOUND",
    });
    arrangeDetection({ storedBytes: onkaWorkbook({ overview: "Overview July" }) });
    mod = await freshAccept();
    expect(await mod.acceptDetectedWorksheetPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" })).toMatchObject({
      ok: false,
      code: "STORAGE_INTEGRITY_MISMATCH",
    });
    expectNoWrites();
  });

  it("#12 worksheet already locked at detection time -> WORKSHEET_NOT_ELIGIBLE, no storage, no tx", async () => {
    arrangeDetection({ worksheet: { canonical_status: "IMPORTED" } });
    const { acceptDetectedWorksheetPeriod } = await freshAccept();
    const r = await acceptDetectedWorksheetPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
    expect(storageGetMock).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("#12 status changed between detection and the transaction (confirmed meanwhile) -> WORKSHEET_NOT_ELIGIBLE, no write", async () => {
    const bytes = arrangeDetection({});
    arrangeAcceptTx({ bytes, worksheet: { canonical_status: "IMPORTED" } });
    const { acceptDetectedWorksheetPeriod } = await freshAccept();
    const r = await acceptDetectedWorksheetPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
    expect(txUploadUpdateManyMock).not.toHaveBeenCalled();
  });

  it("#13 race: Confirm claims between the tx read and the conditional write -> zero rows -> WORKSHEET_NOT_ELIGIBLE", async () => {
    const bytes = arrangeDetection({});
    arrangeAcceptTx({ bytes, claimCount: 0, reread: { canonical_status: "IMPORTED" } });
    const { acceptDetectedWorksheetPeriod } = await freshAccept();
    const r = await acceptDetectedWorksheetPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "WORKSHEET_NOT_ELIGIBLE" });
  });

  it("#13 race: a manual selection lands between the tx read and the conditional write -> zero rows -> PERIOD_ALREADY_RECORDED (never overwritten)", async () => {
    const bytes = arrangeDetection({});
    arrangeAcceptTx({ bytes, claimCount: 0, reread: { canonical_status: "AWAITING_CONFIRMATION" } });
    const { acceptDetectedWorksheetPeriod } = await freshAccept();
    const r = await acceptDetectedWorksheetPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "PERIOD_ALREADY_RECORDED" });
  });

  it("#13 stale detection: batch hash / source / profile / batch id moved inside the tx -> DETECTION_STALE, no write", async () => {
    for (const variant of [
      { batch: { sha256: "different" } },
      { batch: { source_system_id: "source-other" } },
      { batch: { deleted_at: new Date() } },
      { batch: { status: "FAILED" } },
      { batch: { content_type: "csv" } },
      { batch: { original_filename: "City of Onkaparinga-Month-July-2026.xlsx" } },
      { sourceName: "Renamed source" },
      { worksheet: { import_batch_id: "batch-2" } },
    ] as const) {
      txUploadFindFirstMock.mockReset();
      txUploadUpdateManyMock.mockReset();
      const bytes = arrangeDetection({});
      arrangeAcceptTx({ bytes, ...(variant as object) });
      const { acceptDetectedWorksheetPeriod } = await freshAccept();
      const r = await acceptDetectedWorksheetPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
      expect(r, JSON.stringify(variant)).toMatchObject({ ok: false, code: "DETECTION_STALE" });
      expect(txUploadUpdateManyMock).not.toHaveBeenCalled();
    }
  });

  it("a DIFFERENT period already recorded (manual) -> PERIOD_ALREADY_RECORDED, never silently overwritten", async () => {
    const bytes = arrangeDetection({});
    arrangeAcceptTx({
      bytes,
      worksheet: { period_start: new Date(Date.UTC(2026, 4, 1)), period_end: new Date(Date.UTC(2026, 4, 31)), period_source: "MANUAL" },
    });
    const { acceptDetectedWorksheetPeriod } = await freshAccept();
    const r = await acceptDetectedWorksheetPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "PERIOD_ALREADY_RECORDED" });
    expect(txUploadUpdateManyMock).not.toHaveBeenCalled();
  });

  it("the same dates recorded MANUALLY -> PERIOD_ALREADY_RECORDED (provenance is never silently relabelled)", async () => {
    const bytes = arrangeDetection({});
    arrangeAcceptTx({ bytes, worksheet: { period_start: JUNE_START, period_end: JUNE_END, period_source: "MANUAL" } });
    const { acceptDetectedWorksheetPeriod } = await freshAccept();
    const r = await acceptDetectedWorksheetPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: false, code: "PERIOD_ALREADY_RECORDED" });
    expect(txUploadUpdateManyMock).not.toHaveBeenCalled();
  });

  it("idempotent: the same detected period already recorded as DETECTED -> ok, alreadyRecorded, no write", async () => {
    const bytes = arrangeDetection({});
    arrangeAcceptTx({ bytes, worksheet: { period_start: JUNE_START, period_end: JUNE_END, period_source: "DETECTED" } });
    const { acceptDetectedWorksheetPeriod } = await freshAccept();
    const r = await acceptDetectedWorksheetPeriod({ organisationId: "org-A", worksheetId: "worksheet-1" });
    expect(r).toMatchObject({ ok: true, periodStart: "2026-06-01", periodEnd: "2026-06-30", periodSource: "DETECTED", alreadyRecorded: true });
    expect(txUploadUpdateManyMock).not.toHaveBeenCalled();
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────

function routeCtx(id = "worksheet-1") {
  return { params: Promise.resolve({ id }) };
}

describe("period-detection routes — auth + exact wire shapes", () => {
  it("GET: 401/403 before any service work", async () => {
    requireRoleMock.mockRejectedValueOnce(new Error("Unauthorized"));
    vi.resetModules();
    const { GET } = await import("@/app/api/data-hub/worksheets/[id]/period-detection/route");
    expect((await GET(new Request("http://x"), routeCtx())).status).toBe(401);
    requireRoleMock.mockRejectedValueOnce(new Error("Forbidden"));
    expect((await GET(new Request("http://x"), routeCtx())).status).toBe(403);
    expect(uploadFindFirstMock).not.toHaveBeenCalled();
  });

  it("GET EXACT: exactly the safe wire fields, org from session only", async () => {
    requireRoleMock.mockResolvedValue({ organisationId: "org-A" });
    arrangeDetection({});
    vi.resetModules();
    const { GET } = await import("@/app/api/data-hub/worksheets/[id]/period-detection/route");
    const res = await GET(new Request("http://x?organisationId=org-EVIL"), routeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      applicable: true,
      outcome: "EXACT",
      period: { start: "2026-06-01", end: "2026-06-30" },
      suggestedPeriod: null,
      reasonCode: "EXACT_CORROBORATED",
      requiresManualSelection: false,
    });
    expect(uploadFindFirstMock.mock.calls[0][0].where.organisation_id).toBe("org-A");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("GET not applicable -> exactly { ok: true, applicable: false }", async () => {
    requireRoleMock.mockResolvedValue({ organisationId: "org-A" });
    arrangeDetection({ sourceName: "Other" });
    vi.resetModules();
    const { GET } = await import("@/app/api/data-hub/worksheets/[id]/period-detection/route");
    const res = await GET(new Request("http://x"), routeCtx());
    expect(await res.json()).toEqual({ ok: true, applicable: false });
  });

  it("GET failure -> { ok:false, error } with controlled status and no internal code/provenance", async () => {
    requireRoleMock.mockResolvedValue({ organisationId: "org-A" });
    arrangeDetection({ worksheet: null });
    vi.resetModules();
    const { GET } = await import("@/app/api/data-hub/worksheets/[id]/period-detection/route");
    const res = await GET(new Request("http://x"), routeCtx());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["error", "ok"]);
  });

  it("POST accept: success wire shape; a body containing dates is ignored entirely", async () => {
    requireRoleMock.mockResolvedValue({ organisationId: "org-A" });
    const bytes = arrangeDetection({});
    arrangeAcceptTx({ bytes });
    vi.resetModules();
    const { POST } = await import("@/app/api/data-hub/worksheets/[id]/period-detection/accept/route");
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ periodStart: "1999-01-01", periodEnd: "1999-12-31", periodSource: "MANUAL", organisationId: "org-EVIL" }),
    });
    const res = await POST(req, routeCtx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      worksheetUploadId: "worksheet-1",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      periodSource: "DETECTED",
    });
    expect(txUploadUpdateManyMock.mock.calls[0][0].data.period_start).toEqual(JUNE_START);
    expect(txUploadUpdateManyMock.mock.calls[0][0].where.organisation_id).toBe("org-A");
  });

  it("POST accept AMBIGUOUS -> 409 { ok:false, error }", async () => {
    requireRoleMock.mockResolvedValue({ organisationId: "org-A" });
    arrangeDetection({ bytes: onkaWorkbook({ overview: "Overview July" }) });
    vi.resetModules();
    const { POST } = await import("@/app/api/data-hub/worksheets/[id]/period-detection/accept/route");
    const res = await POST(new Request("http://x", { method: "POST" }), routeCtx());
    expect(res.status).toBe(409);
    expect(Object.keys(await res.json()).sort()).toEqual(["error", "ok"]);
    expectNoWrites();
  });

  it("POST accept: unexpected throw -> generic 500, the error object is never logged", async () => {
    requireRoleMock.mockResolvedValue({ organisationId: "org-A" });
    uploadFindFirstMock.mockRejectedValue(new Error("SECRET-CELL-MARKER boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { POST } = await import("@/app/api/data-hub/worksheets/[id]/period-detection/accept/route");
    const res = await POST(new Request("http://x", { method: "POST" }), routeCtx());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/SECRET-CELL-MARKER/);
    expect(JSON.stringify(errSpy.mock.calls)).not.toMatch(/SECRET-CELL-MARKER/);
    errSpy.mockRestore();
  });
});
