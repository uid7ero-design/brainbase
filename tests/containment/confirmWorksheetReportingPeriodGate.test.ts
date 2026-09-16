import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// Data Hub 6.2B1 — K11/K12/K13/K16: confirmDataHubWorksheet's own new Step
// 3.6 REPORTING_PERIOD_REQUIRED gate. Uses the exact same
// "xlsx/xls batch -> UNSUPPORTED_FORMAT before storage is ever touched"
// technique confirmWorksheet.test.ts's own "CSV-only format gate" describe
// block already establishes: Step 3.6 runs BEFORE Step 4's format check, so
// an xlsx/xls batch that reaches UNSUPPORTED_FORMAT (rather than
// REPORTING_PERIOD_REQUIRED) proves Step 3.6 did NOT block — without
// needing any CSV/storage mocking at all. A batch that stops at
// REPORTING_PERIOD_REQUIRED proves the opposite. This file mocks
// lib/prisma independently of confirmWorksheet.test.ts's own module-level
// mock (a separate test file gets its own fresh module registry).

const uploadFindFirstMock = vi.fn();
const importBatchFindUniqueMock = vi.fn();
const sourceSystemFindUniqueMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    upload: { findFirst: (...a: unknown[]) => uploadFindFirstMock(...a) },
    importBatch: { findUnique: (...a: unknown[]) => importBatchFindUniqueMock(...a) },
    sourceSystem: { findUnique: (...a: unknown[]) => sourceSystemFindUniqueMock(...a) },
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
    period_start: null,
    period_end: null,
    ...overrides,
  };
}
function batchRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: "READY",
    // xlsx — guarantees a stop at Step 4's UNSUPPORTED_FORMAT gate (never
    // reaching storage/CSV parsing) whenever Step 3.6 itself did not block
    // first — isolates Step 3.6 from every later step.
    content_type: "xlsx",
    sha256: "deadbeef",
    storage_key: "datahub-batch:org-1:batch-1",
    deleted_at: null,
    source_system_id: "ss-1",
    ...overrides,
  };
}

beforeEach(() => {
  uploadFindFirstMock.mockReset();
  importBatchFindUniqueMock.mockReset();
  sourceSystemFindUniqueMock.mockReset();
  transactionMock.mockReset();
  storageGetMock.mockReset();
});

describe("confirmWorksheet — K11: reporting_period_required=false does not block confirm with a NULL period", () => {
  it("proceeds past Step 3.6 to Step 4's own format gate (UNSUPPORTED_FORMAT, not REPORTING_PERIOD_REQUIRED)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ period_start: null, period_end: null }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow());
    sourceSystemFindUniqueMock.mockResolvedValue({ reporting_period_required: false });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("confirmWorksheet — K12: reporting_period_required=true DOES block confirm with a NULL period", () => {
  it("both period_start and period_end null -> REPORTING_PERIOD_REQUIRED, transaction never opened, storage never touched", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ period_start: null, period_end: null }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow());
    sourceSystemFindUniqueMock.mockResolvedValue({ reporting_period_required: true });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "REPORTING_PERIOD_REQUIRED" });
    expect(transactionMock).not.toHaveBeenCalled();
    expect(storageGetMock).not.toHaveBeenCalled();
  });

  it("only period_start present (period_end still null) -> still REPORTING_PERIOD_REQUIRED (both must be present)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ period_start: new Date("2026-01-01"), period_end: null }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow());
    sourceSystemFindUniqueMock.mockResolvedValue({ reporting_period_required: true });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "REPORTING_PERIOD_REQUIRED" });
  });
});

describe("confirmWorksheet — K13: required source + a valid period permits confirm to proceed past Step 3.6", () => {
  it("both period_start and period_end present -> proceeds to Step 4 (UNSUPPORTED_FORMAT for this xlsx fixture, not REPORTING_PERIOD_REQUIRED)", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ period_start: new Date("2026-01-01"), period_end: new Date("2026-01-31") }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow());
    sourceSystemFindUniqueMock.mockResolvedValue({ reporting_period_required: true });
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_FORMAT" });
  });
});

describe("confirmWorksheet — a NULL source_system_id fails closed at Step 3.5, before Step 3.6 is ever reached", () => {
  it("SOURCE_LINEAGE_REQUIRED (Step 3.5's own pre-existing gate) — Step 3.6's SourceSystem lookup is never attempted", async () => {
    const { confirmDataHubWorksheet } = await freshService();
    uploadFindFirstMock.mockResolvedValue(worksheetRow({ period_start: null, period_end: null }));
    importBatchFindUniqueMock.mockResolvedValue(batchRow({ source_system_id: null }));
    const result = await confirmDataHubWorksheet({ organisationId: "org-1", worksheetUploadId: "worksheet-1", confirmedBy: "actor-1" });
    expect(result).toMatchObject({ ok: false, code: "SOURCE_LINEAGE_REQUIRED" });
    expect(sourceSystemFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe("confirmWorksheet — K16: Step 3.6 contains no filename/inference vocabulary", () => {
  const ROOT = process.cwd();
  const code = fs
    .readFileSync(path.join(ROOT, "lib/data-hub/importBatch/confirmWorksheet.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const step36 = code.slice(code.indexOf("authoritativeSourceSystem"), code.indexOf("REPORTING_PERIOD_REQUIRED") + 40);

  it("Step 3.6 never references a filename, a row's own report_date, or a MIN/MAX derivation", () => {
    expect(step36).not.toMatch(/originalFilename|original_filename/);
    expect(step36).not.toMatch(/report_date/);
    expect(step36).not.toMatch(/Math\.min|Math\.max/);
  });
});
